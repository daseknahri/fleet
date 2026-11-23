import { Request, Response } from 'express'
import path from 'node:path'
import asyncFs from 'node:fs/promises'
import { nanoid } from 'nanoid'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Car from '../models/Car'
import MaintenanceExpense from '../models/MaintenanceExpense'
import MaintenanceCategory from '../models/MaintenanceCategory'
import MaintenanceExpenseAudit from '../models/MaintenanceExpenseAudit'
import MaintenanceExpensePayment from '../models/MaintenanceExpensePayment'
import MaintenanceWorkOrder from '../models/MaintenanceWorkOrder'
import CashSession from '../models/CashSession'
import { linkExpensePaymentToBank, linkExpensePaymentToCash, recomputeExpensePaid } from '../utils/expensePayment'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId, logAdminCrossAgencyAccess } from '../utils/agencyAuthorization'
import { contentMatchesExtension } from '../utils/fileContent'
import * as helper from '../utils/helper'
import { parsePagination, pagedResponse, paginationSkip } from '../utils/pagination'

const getScope = (req: Request): Record<string, unknown> => {
  if (req.user?.type === bookcarsTypes.UserType.Admin) {
    return {}
  }
  return { supplier: agencySupplierId(req) || '000000000000000000000000' }
}

/**
 * GA-PAR-16 — derived payment status: computed in payloads, never
 * stored. paid when paidAmount >= amount; partial when
 * 0 < paidAmount < amount; unpaid when paidAmount is 0 or null
 * (null = untracked/legacy).
 */
export const expensePaymentStatus = (amount: number, paidAmount?: number | null): bookcarsTypes.MaintenanceExpensePaymentStatus => {
  if (paidAmount === undefined || paidAmount === null || paidAmount <= 0) {
    return bookcarsTypes.MaintenanceExpensePaymentStatus.Unpaid
  }
  return paidAmount >= amount
    ? bookcarsTypes.MaintenanceExpensePaymentStatus.Paid
    : bookcarsTypes.MaintenanceExpensePaymentStatus.Partial
}

/** Serialize an expense document/populated object with the GA-PAR-16 derived fields. */
export const withPaymentState = (expense: unknown): Record<string, unknown> => {
  const obj = (typeof (expense as { toObject?: unknown })?.toObject === 'function'
    ? (expense as { toObject: () => Record<string, unknown> }).toObject()
    : { ...(expense as Record<string, unknown>) })
  const paidAmount = obj.paidAmount === undefined || obj.paidAmount === null ? null : Number(obj.paidAmount)
  return {
    ...obj,
    car: obj.car === undefined ? null : obj.car,
    paidAmount,
    paymentStatus: expensePaymentStatus(Number(obj.amount || 0), paidAmount),
  }
}

const normalizePayload = (payload: bookcarsTypes.UpsertMaintenanceExpensePayload) => {
  const date = new Date(payload.date)
  const amount = Number(payload.amount)
  const mileage = payload.mileage === undefined || payload.mileage === null ? undefined : Number(payload.mileage)
  const vendor = String(payload.vendor || '').trim()
  const note = String(payload.note || '').trim()
  const receipt = payload.receipt === null ? null : (payload.receipt === undefined ? undefined : String(payload.receipt).trim())
  // GA-PAR-16: car is OPTIONAL (absent/null/'' = general expense).
  const carRaw = payload.car === null || payload.car === undefined ? '' : String(payload.car).trim()
  const car = carRaw === '' ? undefined : carRaw
  // GA-PAR-16: paidAmount — undefined = not supplied, null = untracked,
  // otherwise a number that must satisfy 0 <= paidAmount <= amount.
  // F7 / W3 M-2: a NUMBER here is rejected by create/update before
  // normalizePayload is reached (see rejectDeclaredPaidAmount) — paid
  // amounts are recorded only via the payment endpoint, backed by a
  // MaintenanceExpensePayment record. null/undefined still flow through.
  const paidAmount = payload.paidAmount === undefined
    ? undefined
    : payload.paidAmount === null
      ? null
      : Number(payload.paidAmount)
  // F7 / W3 M-5: workOrder — undefined = not supplied, null = unlink,
  // otherwise an id validated by the caller (must exist, belong to the
  // expense's agency, and to the expense's car when it has one).
  const workOrder = payload.workOrder === undefined
    ? undefined
    : payload.workOrder === null
      ? null
      : String(payload.workOrder).trim()
  // Next pass - category: undefined = not supplied, null = uncategorised,
  // otherwise an id (validated by the caller against the agency).
  const category = payload.category === undefined
    ? undefined
    : payload.category === null
      ? null
      : String(payload.category).trim()

  if ((car !== undefined && !mongoose.isValidObjectId(car))
    || (workOrder !== undefined && workOrder !== null && !mongoose.isValidObjectId(workOrder))
    || (category !== undefined && category !== null && !mongoose.isValidObjectId(category))
    || Number.isNaN(date.getTime())
    || !Object.values(bookcarsTypes.MaintenanceExpenseType).includes(payload.type)
    || !Number.isFinite(amount)
    || amount <= 0
    || (paidAmount !== undefined && paidAmount !== null && (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > amount))
    || (mileage !== undefined && (!Number.isFinite(mileage) || mileage < 0))
    || vendor.length > 160
    || note.length > 1000
    || (receipt !== undefined && receipt !== null && (receipt.length > 255 || receipt !== path.basename(receipt) || receipt.includes('\0')))) {
    return null
  }

  return { car, date, type: payload.type, amount, paidAmount, mileage, vendor, note, receipt, workOrder, category }
}

/**
 * F7 / W3 M-2 — a typed-in paidAmount must never again stand for money
 * paid: paid amounts are recorded only via the payment endpoint, backed
 * by a MaintenanceExpensePayment record (and, for cash, a CashMovement).
 * Rejects a number OR a numeric string; null/undefined/blank pass
 * (untracked / leave unchanged).
 */
const rejectDeclaredPaidAmount = (req: Request, res: Response): boolean => {
  const raw = req.body?.paidAmount
  if (typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw)))) {
    res.status(400).send('Record expense payments via the payment endpoint')
    return true
  }
  return false
}

/** F7 / W3 M-7 — one audit row per expense change (append-only). */
const recordAudit = async (
  supplier: mongoose.Types.ObjectId | string,
  expenseId: mongoose.Types.ObjectId | string,
  action: bookcarsTypes.MaintenanceExpenseAuditAction,
  actor: mongoose.Types.ObjectId | undefined,
  reason?: string,
  changes?: Array<{ field: string, before?: string | number | null, after?: string | number | null }>,
) => {
  await MaintenanceExpenseAudit.create({ supplier, expense: expenseId, action, actor, reason: reason || undefined, changes })
}

const changeValue = (value: unknown): string | number | null => {
  if (value === undefined || value === null) {
    return null
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'number') {
    return value
  }
  return String(value)
}

/** F7 / W3 M-5 — the work order must exist, belong to the agency, and
 * (when the expense has a car) to that same car. */
// Next pass - the category must belong to the expense's agency.
const getCategoryInScope = async (categoryId: string, supplierId: string) => MaintenanceCategory.findOne({ _id: categoryId, supplier: supplierId })

const getWorkOrderInScope = async (workOrderId: string, supplierId: string, carId?: string | null) => {
  const workOrder = await MaintenanceWorkOrder.findOne({ _id: workOrderId, supplier: supplierId }).select('_id car supplier')
  if (!workOrder) {
    return null
  }
  if (carId && workOrder.car.toString() !== carId.toString()) {
    return null
  }
  return workOrder
}

const isAllowedReceipt = (filename: string) => {
  const ext = path.extname(filename).toLowerCase()
  return env.allowedMaintenanceReceiptExtensions.includes(ext)
}

const moveReceiptIntoPrivateStorage = async (receipt: string | null | undefined, supplierId: string) => {
  if (receipt === undefined) {
return undefined
}
  if (receipt === null || receipt === '') {
return null
}
  if (receipt !== path.basename(receipt) || !isAllowedReceipt(receipt)) {
throw new Error('Invalid receipt file')
}
  const sourceDir = path.resolve(env.CDN_TEMP_MAINTENANCE)
  const targetDir = path.resolve(env.CDN_MAINTENANCE)
  const sourcePath = path.resolve(sourceDir, receipt)
  if (!sourcePath.startsWith(`${sourceDir}${path.sep}`) || !(await helper.pathExists(sourcePath))) {
throw new Error('Receipt file not found')
}
  const filename = `${supplierId}_${Date.now()}_${nanoid()}${path.extname(receipt).toLowerCase()}`
  const targetPath = path.resolve(targetDir, filename)
  if (!targetPath.startsWith(`${targetDir}${path.sep}`)) {
throw new Error('Invalid receipt file')
}
  await asyncFs.rename(sourcePath, targetPath)
  return filename
}

const removePrivateReceipt = async (filename?: string) => {
  if (!filename || filename !== path.basename(filename)) {
return
}
  const base = path.resolve(env.CDN_MAINTENANCE)
  const target = path.resolve(base, filename)
  if (target.startsWith(`${base}${path.sep}`) && await helper.pathExists(target)) {
await asyncFs.unlink(target)
}
}

const getCarInScope = async (carId: string, supplierId?: string, isAdmin = false) => {
  if (isAdmin) {
    return Car.findById(carId).select('_id supplier')
  }
  return Car.findOne({ _id: carId, supplier: supplierId }).select('_id supplier')
}

export const list = async (req: Request, res: Response) => {
  try {
    // F6 / W3 X-1 — server-side pagination + type / date / car filters.
    // No page/size params keeps the legacy full-array response.
    const parsed = parsePagination(req)
    if ('error' in parsed) {
      res.status(400).send(parsed.error)
      return
    }
    const filter: Record<string, unknown> = { ...getScope(req) }
    if (typeof req.query.type === 'string' && req.query.type) {
      if (!Object.values(bookcarsTypes.MaintenanceExpenseType).includes(req.query.type as bookcarsTypes.MaintenanceExpenseType)) {
        res.status(400).send('Invalid expense type filter')
        return
      }
      filter.type = req.query.type
    }
    if (typeof req.query.car === 'string' && req.query.car) {
      if (!mongoose.isValidObjectId(req.query.car)) {
        res.status(400).send('Invalid car filter')
        return
      }
      filter.car = req.query.car
    }
    if (typeof req.query.category === 'string' && req.query.category) {
      if (req.query.category === 'uncategorised') {
        filter.category = null
      } else if (!mongoose.isValidObjectId(req.query.category)) {
        res.status(400).send('Invalid category filter')
        return
      } else {
        filter.category = req.query.category
      }
    }
    const from = typeof req.query.from === 'string' && req.query.from ? new Date(req.query.from) : null
    const to = typeof req.query.to === 'string' && req.query.to ? new Date(req.query.to) : null
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      res.status(400).send('Invalid expense date filter')
      return
    }
    if (from || to) {
      filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
    }
    if (!parsed.pagination) {
      const expenses = await MaintenanceExpense.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .populate('car', 'name licensePlate')
        .populate('supplier', 'fullName')
        .populate('workOrder', 'title status')
        .populate('category', 'name color')

      res.json(expenses.map((expense) => withPaymentState(expense)))
      return
    }
    const total = await MaintenanceExpense.countDocuments(filter)
    const expenses = await MaintenanceExpense.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip(paginationSkip(parsed.pagination))
      .limit(parsed.pagination.size)
      .populate('car', 'name licensePlate')
      .populate('supplier', 'fullName')
      .populate('workOrder', 'title status')
      .populate('category', 'name color')

    res.json(pagedResponse(expenses.map((expense) => withPaymentState(expense)), total, parsed.pagination))
  } catch (err) {
    logger.error(`[maintenanceExpense.list] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const create = async (req: Request, res: Response) => {
  try {
    const user = req.user
    // F7 / W3 M-2 — a typed-in paidAmount is rejected (400), never stored.
    if (rejectDeclaredPaidAmount(req, res)) {
      return
    }
    const payload = normalizePayload(req.body as bookcarsTypes.UpsertMaintenanceExpensePayload)
    const supplierId = agencySupplierId(req)
    if (!user || !payload || (!supplierId && user.type !== bookcarsTypes.UserType.Admin)) {
      res.status(400).send('Invalid maintenance expense')
      return
    }

    const isAdmin = user.type === bookcarsTypes.UserType.Admin
    // GA-PAR-16: with a car, the expense's supplier is the car's agency
    // (unchanged); without a car (general expense) it is the caller's
    // agency context — a platform Admin without an agency context
    // cannot create a general expense (no agency to own it).
    let car: Awaited<ReturnType<typeof getCarInScope>> = null
    let expenseSupplier: string | undefined
    if (payload.car) {
      car = await getCarInScope(payload.car, supplierId, isAdmin)
      if (!car) {
        res.status(404).send('Vehicle not found')
        return
      }
      expenseSupplier = car.supplier.toString()
    } else {
      expenseSupplier = supplierId || undefined
      if (!expenseSupplier) {
        res.status(400).send('Invalid maintenance expense')
        return
      }
    }

    // Wave 2.11 fix — the admin reached this car without a selector;
    // audit the access with the car's agency.
    if (isAdmin && car) {
      await logAdminCrossAgencyAccess(req, [expenseSupplier], 'maintenance-expense:create')
    }

    // F7 / W3 M-5 — the linked work order must belong to the expense's
    // agency and, when the expense has a car, to that same car.
    if (payload.workOrder) {
      const workOrder = await getWorkOrderInScope(payload.workOrder, expenseSupplier, car ? car._id.toString() : null)
      if (!workOrder) {
        res.status(400).send('Work order not found for this expense')
        return
      }
    }

    // Next pass - the category must belong to the expense's agency.
    if (payload.category) {
      const category = await getCategoryInScope(payload.category, expenseSupplier)
      if (!category) {
        res.status(400).send('Category not found for this expense')
        return
      }
    }

    const receipt = await moveReceiptIntoPrivateStorage(payload.receipt, expenseSupplier)
    const expense = new MaintenanceExpense({
      ...payload,
      car: car ? car._id : undefined,
      paidAmount: payload.paidAmount === undefined ? undefined : payload.paidAmount,
      ...(receipt ? { receipt } : {}),
      supplier: expenseSupplier,
    })
    await expense.save()
    // F7 / W3 M-7 — the creation itself is audited.
    await recordAudit(expenseSupplier, expense._id, bookcarsTypes.MaintenanceExpenseAuditAction.Created, new mongoose.Types.ObjectId(user._id), undefined, [
      { field: 'date', after: changeValue(expense.date) },
      { field: 'type', after: expense.type },
      { field: 'amount', after: expense.amount },
      { field: 'car', after: changeValue(car ? car._id : null) },
      { field: 'workOrder', after: changeValue(expense.workOrder) },
      { field: 'category', after: changeValue(expense.category) },
    ])
    await expense.populate([
      { path: 'car', select: 'name licensePlate' },
      { path: 'supplier', select: 'fullName' },
      { path: 'workOrder', select: 'title status' },
      { path: 'category', select: 'name color' },
    ])
    res.status(201).json(withPaymentState(expense))
  } catch (err) {
    logger.error(`[maintenanceExpense.create] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const update = async (req: Request, res: Response) => {
  try {
    const user = req.user
    // F7 / W3 M-2 — a typed-in paidAmount is rejected (400), never stored.
    if (rejectDeclaredPaidAmount(req, res)) {
      return
    }
    const payload = normalizePayload(req.body as bookcarsTypes.UpsertMaintenanceExpensePayload)
    if (!user || !payload || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).send('Invalid maintenance expense')
      return
    }

    const expense = await MaintenanceExpense.findOne({ _id: req.params.id, ...getScope(req) })
    if (!expense) {
      res.sendStatus(404)
      return
    }

    // F7 / W3 M-7 — an update may carry a reason (recorded on the
    // audit row); when present it must be at least 3 characters.
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
    if (reason && reason.length < 3) {
      res.status(400).send('A reason of at least 3 characters is required')
      return
    }

    // GA-PAR-16: the car may be set, changed, or cleared (general).
    let car: Awaited<ReturnType<typeof getCarInScope>> = null
    if (payload.car) {
      car = await getCarInScope(payload.car, expense.supplier.toString(), user.type === bookcarsTypes.UserType.Admin)
      if (!car || car.supplier.toString() !== expense.supplier.toString()) {
        res.status(400).send('Vehicle must belong to the expense agency')
        return
      }
    }

    // F7 / W3 M-5 — a linked work order must belong to the expense's
    // agency and, when the expense ends up with a car, to that car.
    // (payload.car omitted clears the car, so the effective car is
    // payload.car or none.)
    if (payload.workOrder) {
      const workOrder = await getWorkOrderInScope(payload.workOrder, expense.supplier.toString(), car ? car._id.toString() : null)
      if (!workOrder) {
        res.status(400).send('Work order not found for this expense')
        return
      }
    }

    // Next pass - the category must belong to the expense's agency.
    if (payload.category) {
      const category = await getCategoryInScope(payload.category, expense.supplier.toString())
      if (!category) {
        res.status(400).send('Category not found for this expense')
        return
      }
    }

    // F7 / W3 M-7 — snapshot the before-values for the audit trail.
    const before = {
      car: expense.car ? expense.car.toString() : null,
      date: expense.date,
      type: expense.type,
      amount: expense.amount,
      mileage: expense.mileage,
      vendor: expense.vendor,
      note: expense.note,
      receipt: expense.receipt,
      workOrder: expense.workOrder ? expense.workOrder.toString() : null,
      category: expense.category ? expense.category.toString() : null,
    }

    const previousReceipt = expense.receipt
    const receipt = await moveReceiptIntoPrivateStorage(payload.receipt, expense.supplier.toString())
    expense.car = car ? car._id : null as unknown as typeof expense.car
    expense.date = payload.date
    expense.type = payload.type
    expense.amount = payload.amount
    // GA-PAR-16: paidAmount omitted = leave unchanged (so legacy
    // clients that never send it cannot silently wipe the state);
    // explicit null clears it back to untracked.
    // F7 / W3 M-2: once payment records exist, paidAmount is the SUM
    // of those records — an update must never wipe it back to null.
    if (payload.paidAmount !== undefined) {
      const hasPayments = await MaintenanceExpensePayment.exists({ expense: expense._id })
      if (!hasPayments) {
        expense.paidAmount = payload.paidAmount
      }
    }
    if (payload.workOrder !== undefined) {
      expense.workOrder = payload.workOrder ? new mongoose.Types.ObjectId(payload.workOrder) : null as unknown as typeof expense.workOrder
    }
    if (payload.category !== undefined) {
      expense.category = payload.category ? new mongoose.Types.ObjectId(payload.category) : null as unknown as typeof expense.category
    }
    expense.mileage = payload.mileage
    expense.vendor = payload.vendor
    expense.note = payload.note
    if (payload.receipt !== undefined) {
expense.receipt = receipt || undefined
}
    await expense.save()
    if (payload.receipt !== undefined && previousReceipt && previousReceipt !== expense.receipt) {
await removePrivateReceipt(previousReceipt)
}
    // F7 / W3 M-7 — audit only the fields that actually changed.
    const after = {
      car: expense.car ? expense.car.toString() : null,
      date: expense.date,
      type: expense.type,
      amount: expense.amount,
      mileage: expense.mileage,
      vendor: expense.vendor,
      note: expense.note,
      receipt: expense.receipt,
      workOrder: expense.workOrder ? expense.workOrder.toString() : null,
      category: expense.category ? expense.category.toString() : null,
    }
    const changes = (Object.keys(before) as Array<keyof typeof before>)
      .filter((field) => changeValue(before[field]) !== changeValue(after[field]))
      .map((field) => ({ field, before: changeValue(before[field]), after: changeValue(after[field]) }))
    if (changes.length > 0) {
      await recordAudit(expense.supplier, expense._id, bookcarsTypes.MaintenanceExpenseAuditAction.Updated, new mongoose.Types.ObjectId(user._id), reason || undefined, changes)
    }
    await expense.populate([
      { path: 'car', select: 'name licensePlate' },
      { path: 'supplier', select: 'fullName' },
      { path: 'workOrder', select: 'title status' },
      { path: 'category', select: 'name color' },
    ])
    res.json(withPaymentState(expense))
  } catch (err) {
    logger.error(`[maintenanceExpense.update] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const remove = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).send('Invalid maintenance expense')
      return
    }

    // F7 / W3 M-7 — a hard delete now requires a recorded reason
    // (at least 3 characters). The audit row is written BEFORE the
    // delete, and the trail survives it (the expense id is kept).
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
    if (reason.length < 3) {
      res.status(400).send('A reason is required to delete an expense')
      return
    }

    const expense = await MaintenanceExpense.findOne({ _id: req.params.id, ...getScope(req) }).select('receipt supplier')
    if (!expense) {
 res.sendStatus(404); return 
}
    // Wave 2.10 (P1-6) — an expense with payments cannot be hard-deleted:
    // the payments (and their cash/bank movements) would be orphaned
    // with no expense to explain them. Reverse the payments first, or
    // keep the expense as the ledger's anchor.
    const paymentCount = await MaintenanceExpensePayment.countDocuments({ expense: expense._id })
    if (paymentCount > 0) {
      res.status(409).send('This expense has payments and cannot be deleted. Reverse the payments first.')
      return
    }
    await recordAudit(expense.supplier, expense._id, bookcarsTypes.MaintenanceExpenseAuditAction.Deleted, req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : undefined, reason)
    await MaintenanceExpense.deleteOne({ _id: expense._id })
    await removePrivateReceipt(expense.receipt)
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[maintenanceExpense.remove] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * F7 / W3 M-2 — record one payment against an expense. The payment is
 * append-only; after it is saved, a cash payment is linked to the open
 * cash session (confirmed Out, F6 C-7 pattern) and the expense's
 * paidAmount is recomputed as the sum of its payment records.
 */
export const recordPayment = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).send('Invalid maintenance expense')
      return
    }
    const expense = await MaintenanceExpense.findOne({ _id: req.params.id, ...getScope(req) })
    if (!expense) {
      res.sendStatus(404)
      return
    }
    const date = new Date(req.body?.date)
    const amount = Number(req.body?.amount)
    const method = req.body?.method as bookcarsTypes.RentalPaymentMethod
    const reference = String(req.body?.reference || '').trim()
    const note = String(req.body?.note || '').trim()
    // Wave 2.10 — optional idempotency key (8-200 chars). A replay of
    // the same key returns the original payment (200), never a second
    // record — a flaky retry must not double-pay an expense.
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : ''
    if (Number.isNaN(date.getTime())
      || !Number.isFinite(amount) || amount <= 0
      || !Object.values(bookcarsTypes.RentalPaymentMethod).includes(method)
      || reference.length > 160 || note.length > 1000
      || (idempotencyKey !== '' && (idempotencyKey.length < 8 || idempotencyKey.length > 200))) {
      res.status(400).send('Invalid expense payment')
      return
    }
    if (idempotencyKey !== '') {
      const existing = await MaintenanceExpensePayment.findOne({ idempotencyKey })
      if (existing) {
        const replayExpense = await MaintenanceExpense.findById(expense._id)
          .populate('car', 'name licensePlate')
          .populate('supplier', 'fullName')
          .populate('workOrder', 'title status')
        res.status(200).json({ payment: existing, expense: replayExpense ? withPaymentState(replayExpense) : null })
        return
      }
    }
    // Wave 2.10 — cap: payments on an expense never exceed the expense
    // amount. The cap is the sum of the payment records, falling back
    // to the legacy declared paidAmount when no records exist.
    const recorded = await MaintenanceExpensePayment.aggregate<{ total: number }>([
      { $match: { expense: expense._id } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    const alreadyPaid = Math.max(recorded[0]?.total || 0, expense.paidAmount || 0)
    if (alreadyPaid + amount > expense.amount + 0.000001) {
      res.status(409).send(`EXPENSE_OVERPAY: This payment would exceed the expense amount (${expense.amount} ${env.BASE_CURRENCY.toUpperCase()}; ${alreadyPaid} already paid).`)
      return
    }
    // Wave 2.10 — a cash payment needs an open Cash session: without
    // one the money never enters the drawer, so the payment is refused
    // instead of posted silently unlinked (P1-4). A wire payment posts
    // unlinked when no Bank session is open (it can be linked later via
    // linkBankSession) — the F7 "records a bank payment unlinked"
    // behaviour, kept deliberately; a wire 409 here would break it.
    if (method === bookcarsTypes.RentalPaymentMethod.Cash) {
      const session = await CashSession.findOne({ supplier: expense.supplier, account: bookcarsTypes.CashAccountType.Cash, status: bookcarsTypes.CashSessionStatus.Open }).select('_id').lean()
      if (!session) {
        res.status(409).send('No cash session is open. Open a cash session first, then record the payment.')
        return
      }
    }
    const payment = new MaintenanceExpensePayment({
      supplier: expense.supplier,
      expense: expense._id,
      date,
      amount,
      currency: env.BASE_CURRENCY.toUpperCase(),
      method,
      reference: reference || undefined,
      note: note || undefined,
      actor: req.user?._id,
      ...(idempotencyKey !== '' ? { idempotencyKey } : {}),
    })
    await payment.save()
    if (method === bookcarsTypes.RentalPaymentMethod.BankTransfer) {
      await linkExpensePaymentToBank(payment)
    } else {
      await linkExpensePaymentToCash(payment)
    }
    await recomputeExpensePaid(expense._id)
    const updated = await MaintenanceExpense.findById(expense._id)
      .populate('car', 'name licensePlate')
      .populate('supplier', 'fullName')
      .populate('workOrder', 'title status')
    res.status(201).json({ payment, expense: updated ? withPaymentState(updated) : null })
  } catch (err) {
    logger.error(`[maintenanceExpense.recordPayment] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const listPayments = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).send('Invalid maintenance expense')
      return
    }
    const expense = await MaintenanceExpense.findOne({ _id: req.params.id, ...getScope(req) }).select('_id')
    if (!expense) {
      res.sendStatus(404)
      return
    }
    const payments = await MaintenanceExpensePayment.find({ expense: expense._id }).sort({ date: -1, createdAt: -1 })
    res.json(payments)
  } catch (err) {
    logger.error(`[maintenanceExpense.listPayments] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * F7 / W3 M-7 — the audit trail for one expense. The expense itself
 * is NOT required to exist: the trail survives a hard delete, and
 * this endpoint is how it is read afterwards. Scoped by supplier.
 */
export const listAudit = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).send('Invalid maintenance expense')
      return
    }
    const rows = await MaintenanceExpenseAudit.find({ expense: req.params.id, ...getScope(req) })
      .sort({ createdAt: -1 })
      .populate('actor', 'fullName')
    res.json(rows)
  } catch (err) {
    logger.error(`[maintenanceExpense.listAudit] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}


export const uploadReceipt = async (req: Request, res: Response) => {
  try {
    const file = req.file
    if (!file || file.size <= 0 || file.size > 5 * 1024 * 1024) {
 res.status(400).send('Invalid receipt file'); return 
}
    const ext = path.extname(file.originalname).toLowerCase()
    if (!env.allowedMaintenanceReceiptExtensions.includes(ext)) {
 res.status(400).send('Invalid receipt file type'); return 
}
    const allowedMime = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    if (file.mimetype && !allowedMime.includes(file.mimetype.toLowerCase())) {
 res.status(400).send('Invalid receipt content type'); return 
}
    if (!contentMatchesExtension(file.buffer, ext)) {
      res.status(400).send('Invalid receipt content')
      return
    }
    const userId = req.user?._id
    if (!userId) {
 res.status(403).send('Authentication required'); return 
}
    const filename = `${userId}_${nanoid()}${ext}`
    await asyncFs.writeFile(path.resolve(env.CDN_TEMP_MAINTENANCE, filename), file.buffer)
    res.status(201).json({ filename })
  } catch (err) {
 logger.error('[maintenanceExpense.uploadReceipt]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const deleteTempReceipt = async (req: Request, res: Response) => {
  try {
    const filename = String(req.params.file || '')
    const userId = req.user?._id?.toString()
    if (!filename || filename !== path.basename(filename) || filename.includes('\0') || (!req.user || req.user.type !== bookcarsTypes.UserType.Admin && !filename.startsWith(`${userId}_`))) {
 res.status(403).send('Forbidden'); return 
}
    const base = path.resolve(env.CDN_TEMP_MAINTENANCE)
    const target = path.resolve(base, filename)
    if (!target.startsWith(`${base}${path.sep}`)) {
 res.status(403).send('Forbidden'); return 
}
    if (await helper.pathExists(target)) {
await asyncFs.unlink(target)
}
    res.sendStatus(200)
  } catch (err) {
 logger.error('[maintenanceExpense.deleteTempReceipt]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const report = async (req: Request, res: Response) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(new Date().getFullYear(), 0, 1)
    const to = req.query.to ? new Date(String(req.query.to)) : new Date()
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
 res.status(400).send('Invalid report range'); return 
}
    const supplier = agencySupplierId(req)
    const match: Record<string, unknown> = {
      date: { $gte: from, $lte: to },
      ...(supplier ? { supplier: new mongoose.Types.ObjectId(supplier) } : {}),
    }
    if (req.query.car && mongoose.isValidObjectId(String(req.query.car))) {
match.car = new mongoose.Types.ObjectId(String(req.query.car))
}
    const rows = await MaintenanceExpense.aggregate([
      { $match: match },
      { $group: { _id: '$type', count: { $sum: 1 }, total: { $sum: '$amount' }, paidTotal: { $sum: { $ifNull: ['$paidAmount', 0] } }, untracked: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$paidAmount', null] }, null] }, 1, 0] } }, receipts: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$receipt', null] }, null] }, 1, 0] } } } },
      { $sort: { total: -1, _id: 1 } },
    ])
    // F7 / W3 R-7 — the category report carries the same cash/accrual
    // split as the reports builder: `total` is the full accrued
    // amount, `paidTotal` is what was actually paid (null or absent
    // paidAmount counts as 0 paid, and `untracked` says how many rows
    // those are). NB: `$eq` on null alone misses rows where the field
    // is absent (SERVER-20166); the counter normalises with `$ifNull`.
    // Next pass - the same totals grouped by the agency-created category
    // (an uncategorised expense has category null/absent, which groups
    // under _id null). The lookup resolves the category name.
    const byCategoryRows = await MaintenanceExpense.aggregate([
      { $match: match },
      { $group: { _id: '$category', count: { $sum: 1 }, total: { $sum: '$amount' }, paidTotal: { $sum: { $ifNull: ['$paidAmount', 0] } }, untracked: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$paidAmount', null] }, null] }, 1, 0] } }, receipts: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$receipt', null] }, null] }, 1, 0] } } } },
      { $lookup: { from: 'MaintenanceCategory', localField: '_id', foreignField: '_id', as: 'categoryDoc' } },
      { $sort: { total: -1, _id: 1 } },
    ])
    const byCategory = byCategoryRows.map((row) => ({ category: row._id ? row._id.toString() : null, name: (row.categoryDoc as Array<{ name?: string }> | undefined)?.[0]?.name ?? null, count: row.count, total: Number(Number(row.total).toFixed(2)), paidTotal: Number(Number(row.paidTotal || 0).toFixed(2)), untracked: row.untracked, receipts: row.receipts }))
    const categories = rows.map((row) => ({ category: row._id, count: row.count, total: Number(Number(row.total).toFixed(2)), paidTotal: Number(Number(row.paidTotal || 0).toFixed(2)), untracked: row.untracked, receipts: row.receipts }))
    res.json({ currency: env.BASE_CURRENCY.toUpperCase(), from, to, total: Number(categories.reduce((sum, row) => sum + row.total, 0).toFixed(2)), paidTotal: Number(categories.reduce((sum, row) => sum + row.paidTotal, 0).toFixed(2)), untrackedCount: categories.reduce((sum, row) => sum + row.untracked, 0), categories, byCategory })
  } catch (err) {
 logger.error('[maintenanceExpense.report]', err); res.status(400).send(i18n.t('ERROR')) 
}
}


