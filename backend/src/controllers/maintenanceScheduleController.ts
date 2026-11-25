import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Car from '../models/Car'
import MaintenanceSchedule from '../models/MaintenanceSchedule'
import MaintenanceScheduleAudit from '../models/MaintenanceScheduleAudit'
import MaintenanceCategory from '../models/MaintenanceCategory'
import MaintenanceWorkOrder from '../models/MaintenanceWorkOrder'
import { resolveScheduleDue } from '../utils/maintenanceSchedule'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId, logAdminCrossAgencyAccess } from '../utils/agencyAuthorization'

const scope = (req: Request): Record<string, unknown> => req.user?.type === bookcarsTypes.UserType.Admin
  ? {}
  : { supplier: agencySupplierId(req) || '000000000000000000000000' }

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const dueStatus = (date: Date | undefined, completed?: boolean) => {
  if (completed) {
return bookcarsTypes.MaintenanceScheduleStatus.Completed
}
  // GAP-MAINT-P0-1 — a km-only schedule has no due date: its stored
  // status is Upcoming and the mileage leg (resolveScheduleDue) is
  // what upgrades it live when the odometer crosses.
  if (!date) {
return bookcarsTypes.MaintenanceScheduleStatus.Upcoming
}
  const today = startOfDay(new Date())
  const due = startOfDay(date)
  const soon = new Date(today)
  soon.setDate(soon.getDate() + 30)
  if (due < today) {
return bookcarsTypes.MaintenanceScheduleStatus.Overdue
}
  if (due <= soon) {
return bookcarsTypes.MaintenanceScheduleStatus.Due
}
  return bookcarsTypes.MaintenanceScheduleStatus.Upcoming
}

const normalize = (input: bookcarsTypes.UpsertMaintenanceSchedulePayload) => {
  const title = String(input.title || '').trim()
  // Next pass - category: undefined = not supplied, null = uncategorised.
  const category = input.category === undefined
    ? undefined
    : input.category === null
      ? null
      : String(input.category).trim()
  const lastDate = input.lastServiceDate ? new Date(input.lastServiceDate) : undefined
  const requestedDue = input.nextDueDate ? new Date(input.nextDueDate) : undefined
  const intervalDays = input.intervalDays === undefined || input.intervalDays === null ? undefined : Number(input.intervalDays)
  const intervalKm = input.intervalKm === undefined || input.intervalKm === null ? undefined : Number(input.intervalKm)
  const lastMileage = input.lastServiceMileage === undefined || input.lastServiceMileage === null ? undefined : Number(input.lastServiceMileage)
  const nextMileage = input.nextDueMileage === undefined || input.nextDueMileage === null ? undefined : Number(input.nextDueMileage)
  if (!mongoose.isValidObjectId(input.car) || !title || title.length > 200
    || !Object.values(bookcarsTypes.MaintenanceExpenseType).includes(input.type)
    || (lastDate && Number.isNaN(lastDate.getTime()))
    || (requestedDue && Number.isNaN(requestedDue.getTime()))
    || (intervalDays !== undefined && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650))
    || (intervalKm !== undefined && (!Number.isInteger(intervalKm) || intervalKm < 1 || intervalKm > 1000000))
    || (lastMileage !== undefined && (!Number.isFinite(lastMileage) || lastMileage < 0))
    || (nextMileage !== undefined && (!Number.isFinite(nextMileage) || nextMileage < 0))
    || (intervalDays === undefined && intervalKm === undefined && !requestedDue)
    || (category !== undefined && category !== null && !mongoose.isValidObjectId(category))
    || String(input.note || '').trim().length > 1000) {
return null
}
  // GAP-MAINT-P0-1 — do NOT default a km-only schedule's due date to
  // today: that made the reminder fire once at creation (nothing due)
  // and never when the odometer crossed. A km-only schedule carries
  // no due date; the mileage leg governs it. (The validation above
  // still requires at least one interval or an explicit due date.)
  const nextDueDate = requestedDue || (lastDate && intervalDays ? new Date(lastDate.getTime() + intervalDays * 86400000) : undefined)
  if (nextDueDate && Number.isNaN(nextDueDate.getTime())) {
return null
}
  const status = input.status === bookcarsTypes.MaintenanceScheduleStatus.Completed
    ? bookcarsTypes.MaintenanceScheduleStatus.Completed
    : dueStatus(nextDueDate)
  return { car: input.car, title, type: input.type, intervalDays, intervalKm, lastServiceDate: lastDate, lastServiceMileage: lastMileage, nextDueDate, nextDueMileage: nextMileage, status, note: String(input.note || '').trim(), ...(category !== undefined ? { category } : {}) }
}

const carInScope = async (carId: string, supplierId?: string, admin = false) => admin
  ? Car.findById(carId).select('_id supplier')
  : Car.findOne({ _id: carId, supplier: supplierId }).select('_id supplier')

const present = (row: env.MaintenanceSchedule) => {
  const item = row.toObject ? row.toObject() : row
  // F7 / W3 M-4 — the live status merges the date leg and the mileage
  // leg (utils/maintenanceSchedule.ts): the stored status is date-only
  // and can be stale, so the payload always carries the merged status
  // plus whether mileage is the trigger. Completed stays Completed.
  const due = resolveScheduleDue(item as unknown as Parameters<typeof resolveScheduleDue>[0])
  item.status = due.status
  ;(item as unknown as Record<string, unknown>).dueByMileage = due.dueByMileage
  ;(item as unknown as Record<string, unknown>).effectiveNextDueMileage = due.effectiveNextDueMileage
  return item
}

export const list = async (req: Request, res: Response) => {
  try {
    // GH-18 - filter the PRESENTED (live-merged) status, not the stored
    // one: the stored status is date-only and can be stale, so a
    // schedule the list shows as Due was invisible to ?status=due.
    // No writes on a GET: the merged status is never persisted here.
    const requestedStatus = String(req.query.status || '').trim()
    const validStatus = Object.values(bookcarsTypes.MaintenanceScheduleStatus).includes(requestedStatus as bookcarsTypes.MaintenanceScheduleStatus)
      ? requestedStatus as bookcarsTypes.MaintenanceScheduleStatus
      : undefined
    const rows = await MaintenanceSchedule.find(scope(req)).sort({ nextDueDate: 1, createdAt: -1 }).populate('car', 'name licensePlate odometerKm').populate('supplier', 'fullName').populate('category', 'name color')
    const presented = rows.map(present)
    res.json(validStatus ? presented.filter((row) => row.status === validStatus) : presented)
  } catch (err) {
 logger.error('[maintenanceSchedule.list]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const create = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const payload = normalize(req.body as bookcarsTypes.UpsertMaintenanceSchedulePayload)
    const supplierId = agencySupplierId(req) || (user?.type === bookcarsTypes.UserType.Admin ? req.body?.supplier : undefined)
    if (!user || !payload || (!mongoose.isValidObjectId(supplierId) && user.type !== bookcarsTypes.UserType.Admin)) {
 res.status(400).send('Invalid maintenance schedule'); return 
}
    const car = await carInScope(payload.car, supplierId, user.type === bookcarsTypes.UserType.Admin)
    if (!car) {
 res.status(404).send('Vehicle not found'); return 
}
    // Wave 2.11 fix — the admin reached this car without a selector;
    // audit the access with the car's agency.
    if (user?.type === bookcarsTypes.UserType.Admin) {
      await logAdminCrossAgencyAccess(req, [car.supplier.toString()], 'maintenance-schedule:create')
    }
    // Next pass - the category must belong to the schedule's agency.
    if (payload.category) {
      const category = await MaintenanceCategory.findOne({ _id: payload.category, supplier: car.supplier })
      if (!category) {
        res.status(400).send('Category not found for this schedule')
        return
      }
    }
    // GH-20 - one active schedule per car + type + category: a second
    // live plan for the same service would double-notify and double-block.
    // Completed schedules are finished plans and do not count.
    const duplicate = await MaintenanceSchedule.findOne({
      supplier: car.supplier,
      car: car._id,
      type: payload.type,
      ...(payload.category ? { category: new mongoose.Types.ObjectId(payload.category) } : { category: { $in: [null, undefined] as unknown as mongoose.Types.ObjectId[] } }),
      status: { $ne: bookcarsTypes.MaintenanceScheduleStatus.Completed },
    }).select('_id').lean()
    if (duplicate) {
      res.status(409).send('An active schedule already exists for this vehicle with the same type and category')
      return
    }
    const row = await MaintenanceSchedule.create({ ...payload, supplier: car.supplier })
    await row.populate([{ path: 'car', select: 'name licensePlate odometerKm' }, { path: 'supplier', select: 'fullName' }, { path: 'category', select: 'name color' }])
    res.status(201).json(present(row))
  } catch (err) {
 logger.error('[maintenanceSchedule.create]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const update = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
 res.status(400).send('Invalid maintenance schedule'); return 
}
    const payload = normalize(req.body as bookcarsTypes.UpsertMaintenanceSchedulePayload)
    const row = await MaintenanceSchedule.findOne({ _id: req.params.id, ...scope(req) })
    if (!row || !payload) {
 res.status(row ? 400 : 404).send(row ? 'Invalid maintenance schedule' : 'Not found'); return 
}
    const car = await carInScope(payload.car, row.supplier.toString(), req.user?.type === bookcarsTypes.UserType.Admin)
    if (!car || car.supplier.toString() !== row.supplier.toString()) {
 res.status(400).send('Vehicle must belong to the schedule agency'); return 
}
    // Next pass - the category must belong to the schedule's agency.
    if (payload.category) {
      const category = await MaintenanceCategory.findOne({ _id: payload.category, supplier: row.supplier })
      if (!category) {
        res.status(400).send('Category not found for this schedule')
        return
      }
    }
    // GH-20 - same guard as create(): the merged car/type/category
    // (payload wins, row keeps what the payload omits) must not match
    // another active schedule. The row itself is excluded.
    const nextCar = car._id
    const nextType = payload.type
    const nextCategory = payload.category !== undefined ? payload.category : (row.category ? row.category.toString() : null)
    const duplicate = await MaintenanceSchedule.findOne({
      _id: { $ne: row._id },
      supplier: row.supplier,
      car: nextCar,
      type: nextType,
      ...(nextCategory ? { category: new mongoose.Types.ObjectId(nextCategory) } : { category: { $in: [null, undefined] as unknown as mongoose.Types.ObjectId[] } }),
      status: { $ne: bookcarsTypes.MaintenanceScheduleStatus.Completed },
    }).select('_id').lean()
    if (duplicate) {
      res.status(409).send('An active schedule already exists for this vehicle with the same type and category')
      return
    }
    Object.assign(row, payload, { car: car._id })
    await row.save()
    await row.populate([{ path: 'car', select: 'name licensePlate odometerKm' }, { path: 'supplier', select: 'fullName' }, { path: 'category', select: 'name color' }])
    res.json(present(row))
  } catch (err) {
 logger.error('[maintenanceSchedule.update]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

// GAP-MAINT-P0-2 — run a function inside a transaction when the
// topology supports one (same check as bookingReservationHelper),
// otherwise run it plain. The maintenance loop closes atomically
// only on a replica set; on a standalone the steps still run in
// order, just without the all-or-nothing guarantee.
const runInTransaction = async <T>(fn: (session?: mongoose.ClientSession) => Promise<T>): Promise<T> => {
  const client = mongoose.connection.getClient() as unknown as { topology?: { description?: { type?: string } } } | null
  const topologyType = client?.topology?.description?.type
  if (topologyType && topologyType !== 'Single' && topologyType !== 'Unknown') {
    return mongoose.connection.transaction(fn)
  }
  return fn()
}

/**
 * GAP-MAINT-P0-2 — one "Complete service" action that closes the
 * maintenance loop in a single call:
 * - closes the linked work order (if one is given) with the service
 *   date and odometer,
 * - records the service date + odometer on the schedule and marks it
 *   Completed,
 * - rolls the next interval forward as a new schedule (date leg from
 *   intervalDays, mileage leg from intervalKm + the service reading),
 * - updates the car's odometer to the service reading.
 * A km-interval schedule requires the odometer reading, because the
 * next due mileage cannot be computed without it. Completing an
 * already-completed schedule, or a cancelled work order, is a 409.
 * Returns `{ schedule, nextSchedule }` (nextSchedule is null when
 * the schedule has no interval to roll forward).
 */
export const completeService = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
 res.status(400).send('Invalid maintenance schedule'); return 
}
    const body = req.body as bookcarsTypes.CompleteServicePayload
    const workOrderId = typeof body.workOrderId === 'string' && mongoose.isValidObjectId(body.workOrderId) ? body.workOrderId : undefined
    const serviceDate = body.serviceDate ? new Date(body.serviceDate) : new Date()
    const odometerKm = body.odometerKm === undefined || body.odometerKm === null ? undefined : Number(body.odometerKm)
    const note = String(body.note || '').trim()
    if (Number.isNaN(serviceDate.getTime())
      || (odometerKm !== undefined && (!Number.isFinite(odometerKm) || odometerKm < 0))
      || note.length > 1000) {
 res.status(400).send('Invalid service record'); return 
}

    const row = await MaintenanceSchedule.findOne({ _id: req.params.id, ...scope(req) })
    if (!row) {
 res.status(404).send('Not found'); return 
}
    if (row.status === bookcarsTypes.MaintenanceScheduleStatus.Completed) {
 res.status(409).send('Schedule already completed'); return 
}
    if (row.intervalKm && odometerKm === undefined) {
 res.status(400).send('Odometer reading is required for this schedule'); return 
}

    const result = await runInTransaction(async (session): Promise<
      | { error: 404 | 409, message: string }
      | { error: null, schedule: env.MaintenanceSchedule, nextSchedule: env.MaintenanceSchedule | null }
    > => {
      const sessionOpt = session ? { session } : {}

      let workOrder: env.MaintenanceWorkOrder | null = null
      if (workOrderId) {
        workOrder = await MaintenanceWorkOrder.findOne({ _id: workOrderId, supplier: row.supplier, car: row.car }, null, sessionOpt)
        if (!workOrder) {
          return { error: 404, message: 'Work order not found' }
        }
        if (workOrder.status === bookcarsTypes.WorkOrderStatus.Completed) {
          return { error: 409, message: 'Work order already completed' }
        }
        if (workOrder.status === bookcarsTypes.WorkOrderStatus.Cancelled) {
          return { error: 409, message: 'Work order is cancelled' }
        }
        workOrder.status = bookcarsTypes.WorkOrderStatus.Completed
        workOrder.completedAt = serviceDate
        if (odometerKm !== undefined) {
          workOrder.odometer = odometerKm
        }
        if (note) {
          workOrder.note = workOrder.note ? `${workOrder.note}\n${note}` : note
        }
        await workOrder.save(sessionOpt)
      }

      row.lastServiceDate = serviceDate
      if (odometerKm !== undefined) {
        row.lastServiceMileage = odometerKm
      }
      row.status = bookcarsTypes.MaintenanceScheduleStatus.Completed
      await row.save(sessionOpt)

      let next: env.MaintenanceSchedule | null = null
      if (row.intervalDays || row.intervalKm) {
        const nextDueDate = row.intervalDays ? new Date(serviceDate.getTime() + row.intervalDays * 86400000) : undefined
        const nextDueMileage = row.intervalKm && row.lastServiceMileage !== undefined ? row.lastServiceMileage + row.intervalKm : undefined
        next = new MaintenanceSchedule({
          supplier: row.supplier,
          car: row.car,
          type: row.type,
          title: row.title,
          intervalDays: row.intervalDays,
          intervalKm: row.intervalKm,
          lastServiceDate: serviceDate,
          lastServiceMileage: odometerKm,
          nextDueDate,
          nextDueMileage,
          status: dueStatus(nextDueDate),
          note: row.note,
        })
        await next.save(sessionOpt)
      }

      if (odometerKm !== undefined) {
        await Car.updateOne({ _id: row.car }, { $set: { odometerKm } }, sessionOpt)
      }

      return { error: null, schedule: row, nextSchedule: next }
    })

    if (result.error) {
 res.status(result.error).send(result.message); return 
}
    res.json({ schedule: present(result.schedule), nextSchedule: result.nextSchedule ? present(result.nextSchedule) : null })
  } catch (err) {
 logger.error('[maintenanceSchedule.completeService]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const remove = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
 res.status(400).send('Invalid maintenance schedule'); return 
}
    // GH-09 — mirror the expense remove() pattern (F7 / W3 M-7): a
    // hard delete requires a recorded reason (at least 3 characters)
    // and the audit row is written BEFORE the delete, so the trail
    // survives it (the schedule id is kept on the row). A schedule
    // has no payments or linked expenses to guard — nothing
    // references a schedule — so there is no 409 leg here (unlike
    // the work-order delete, which refuses when expenses exist).
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
    if (reason.length < 3) {
      res.status(400).send('A reason is required to delete a maintenance schedule')
      return
    }
    const row = await MaintenanceSchedule.findOne({ _id: req.params.id, ...scope(req) }).select('_id supplier')
    if (!row) {
 res.sendStatus(404); return 
}
    await MaintenanceScheduleAudit.create({
      supplier: row.supplier,
      schedule: row._id,
      action: bookcarsTypes.MaintenanceExpenseAuditAction.Deleted,
      actor: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : undefined,
      reason,
    })
    await MaintenanceSchedule.deleteOne({ _id: row._id })
    res.sendStatus(200)
  } catch (err) {
 logger.error('[maintenanceSchedule.remove]', err); res.status(400).send(i18n.t('ERROR')) 
}
}
