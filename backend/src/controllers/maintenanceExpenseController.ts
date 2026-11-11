import { Request, Response } from 'express'
import path from 'node:path'
import asyncFs from 'node:fs/promises'
import { nanoid } from 'nanoid'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Car from '../models/Car'
import MaintenanceExpense from '../models/MaintenanceExpense'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'
import { contentMatchesExtension } from '../utils/fileContent'
import * as helper from '../utils/helper'

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
  const paidAmount = payload.paidAmount === undefined
    ? undefined
    : payload.paidAmount === null
      ? null
      : Number(payload.paidAmount)

  if ((car !== undefined && !mongoose.isValidObjectId(car))
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

  return { car, date, type: payload.type, amount, paidAmount, mileage, vendor, note, receipt }
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
    const expenses = await MaintenanceExpense.find(getScope(req))
      .sort({ date: -1, createdAt: -1 })
      .populate('car', 'name licensePlate')
      .populate('supplier', 'fullName')

    res.json(expenses.map((expense) => withPaymentState(expense)))
  } catch (err) {
    logger.error(`[maintenanceExpense.list] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const create = async (req: Request, res: Response) => {
  try {
    const user = req.user
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

    const receipt = await moveReceiptIntoPrivateStorage(payload.receipt, expenseSupplier)
    const expense = new MaintenanceExpense({
      ...payload,
      car: car ? car._id : undefined,
      paidAmount: payload.paidAmount === undefined ? undefined : payload.paidAmount,
      ...(receipt ? { receipt } : {}),
      supplier: expenseSupplier,
    })
    await expense.save()
    await expense.populate([
      { path: 'car', select: 'name licensePlate' },
      { path: 'supplier', select: 'fullName' },
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

    // GA-PAR-16: the car may be set, changed, or cleared (general).
    let car: Awaited<ReturnType<typeof getCarInScope>> = null
    if (payload.car) {
      car = await getCarInScope(payload.car, expense.supplier.toString(), user.type === bookcarsTypes.UserType.Admin)
      if (!car || car.supplier.toString() !== expense.supplier.toString()) {
        res.status(400).send('Vehicle must belong to the expense agency')
        return
      }
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
    if (payload.paidAmount !== undefined) {
      expense.paidAmount = payload.paidAmount
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
    await expense.populate([
      { path: 'car', select: 'name licensePlate' },
      { path: 'supplier', select: 'fullName' },
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

    const expense = await MaintenanceExpense.findOne({ _id: req.params.id, ...getScope(req) }).select('receipt')
    if (!expense) {
 res.sendStatus(404); return 
}
    await MaintenanceExpense.deleteOne({ _id: expense._id })
    await removePrivateReceipt(expense.receipt)
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[maintenanceExpense.remove] ${i18n.t('ERROR')}`, err)
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
      { $group: { _id: '$type', count: { $sum: 1 }, total: { $sum: '$amount' }, receipts: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$receipt', null] }, null] }, 1, 0] } } } },
      { $sort: { total: -1, _id: 1 } },
    ])
    const categories = rows.map((row) => ({ category: row._id, count: row.count, total: Number(Number(row.total).toFixed(2)), receipts: row.receipts }))
    res.json({ currency: env.BASE_CURRENCY.toUpperCase(), from, to, total: Number(categories.reduce((sum, row) => sum + row.total, 0).toFixed(2)), categories })
  } catch (err) {
 logger.error('[maintenanceExpense.report]', err); res.status(400).send(i18n.t('ERROR')) 
}
}


