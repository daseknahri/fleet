import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Car from '../models/Car'
import MaintenanceExpense from '../models/MaintenanceExpense'
import MaintenanceWorkOrder from '../models/MaintenanceWorkOrder'
import MaintenanceWorkOrderAudit from '../models/MaintenanceWorkOrderAudit'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'
import { isWorkOrderStale, staleWorkOrderCutoff, workOrderStaleDays } from '../utils/workOrderStale'

const scope = (req: Request): Record<string, unknown> => req.user?.type === bookcarsTypes.UserType.Admin
  ? {}
  : { supplier: agencySupplierId(req) || '000000000000000000000000' }

const normalize = (input: bookcarsTypes.UpsertMaintenanceWorkOrderPayload) => {
  const start = new Date(input.scheduledStart)
  const end = new Date(input.scheduledEnd)
  const title = String(input.title || '').trim()
  const vendor = String(input.vendor || '').trim()
  const note = String(input.note || '').trim()
  const odometer = input.odometer === undefined || input.odometer === null ? undefined : Number(input.odometer)
  const status = input.status || bookcarsTypes.WorkOrderStatus.Scheduled
  if (!mongoose.isValidObjectId(input.car) || !title || title.length > 200
    || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end
    || !Object.values(bookcarsTypes.MaintenanceExpenseType).includes(input.type)
    || !Object.values(bookcarsTypes.WorkOrderStatus).includes(status)
    || (odometer !== undefined && (!Number.isFinite(odometer) || odometer < 0))
    || vendor.length > 160 || note.length > 1000) {
return null
}
  return { car: input.car, title, type: input.type, status, scheduledStart: start, scheduledEnd: end, odometer, vendor, note }
}

const carInScope = async (carId: string, supplierId?: string, admin = false) => admin
  ? Car.findById(carId).select('_id supplier')
  : Car.findOne({ _id: carId, supplier: supplierId }).select('_id supplier')

export const list = async (req: Request, res: Response) => {
  try {
    // GH-21 - ?status= filters the stored status; ?stale=true lists
    // only work orders still Scheduled N days after their planned
    // start. Stale implies Scheduled, so it overrides an explicit
    // ?status= rather than AND-ing into an empty set.
    const query: Record<string, unknown> = { ...scope(req) }
    const requestedStatus = String(req.query.status || '').trim()
    if (Object.values(bookcarsTypes.WorkOrderStatus).includes(requestedStatus as bookcarsTypes.WorkOrderStatus)) {
      query.status = requestedStatus
    }
    if (req.query.stale === 'true') {
      query.status = bookcarsTypes.WorkOrderStatus.Scheduled
      query.scheduledStart = { $lt: staleWorkOrderCutoff() }
    }
    const rows = await MaintenanceWorkOrder.find(query).sort({ scheduledStart: 1, createdAt: -1 }).populate('car', 'name licensePlate').populate('supplier', 'fullName')
    // F7 / W3 M-5 — each work order carries the total amount and count
    // of the expenses linked to it, so the UI can show the cost of a
    // job without a second round-trip.
    const totals = await MaintenanceExpense.aggregate([
      { $match: { workOrder: { $in: rows.map((row) => row._id) } } },
      { $group: { _id: '$workOrder', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ])
    const byId = new Map(totals.map((row) => [row._id.toString(), { total: Number(row.total), count: row.count }]))
    res.json(rows.map((row) => {
      const obj = row.toObject() as unknown as Record<string, unknown>
      const total = byId.get(row._id.toString())
      const stale = isWorkOrderStale(row.status, row.scheduledStart)
      return { ...obj, expenseTotal: total ? Number(total.total.toFixed(2)) : 0, expenseCount: total ? total.count : 0, stale, daysStale: stale ? workOrderStaleDays(row.scheduledStart) : 0 }
    }))
  } catch (err) {
 logger.error(`[workOrder.list] ${i18n.t('ERROR')}`, err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const create = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const payload = normalize(req.body as bookcarsTypes.UpsertMaintenanceWorkOrderPayload)
    const supplierId = agencySupplierId(req) || (user?.type === bookcarsTypes.UserType.Admin ? req.body?.supplier : undefined)
    if (!user || !payload || (!mongoose.isValidObjectId(supplierId) && user.type !== bookcarsTypes.UserType.Admin)) {
 res.status(400).send('Invalid work order'); return 
}
    const car = await carInScope(payload.car, supplierId, user.type === bookcarsTypes.UserType.Admin)
    if (!car) {
 res.status(404).send('Vehicle not found'); return 
}
    const row = await MaintenanceWorkOrder.create({ ...payload, supplier: car.supplier, completedAt: payload.status === bookcarsTypes.WorkOrderStatus.Completed ? new Date() : undefined })
    await row.populate([{ path: 'car', select: 'name licensePlate' }, { path: 'supplier', select: 'fullName' }])
    res.status(201).json(row)
  } catch (err) {
 logger.error(`[workOrder.create] ${i18n.t('ERROR')}`, err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const update = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
 res.status(400).send('Invalid work order'); return 
}
    const payload = normalize(req.body as bookcarsTypes.UpsertMaintenanceWorkOrderPayload)
    const row = await MaintenanceWorkOrder.findOne({ _id: req.params.id, ...scope(req) })
    if (!row || !payload) {
 res.status(row ? 400 : 404).send(row ? 'Invalid work order' : 'Not found'); return 
}
    const car = await carInScope(payload.car, row.supplier.toString(), req.user?.type === bookcarsTypes.UserType.Admin)
    if (!car || car.supplier.toString() !== row.supplier.toString()) {
 res.status(400).send('Vehicle must belong to the work order agency'); return 
}
    row.car = car._id; row.title = payload.title; row.type = payload.type; row.status = payload.status; row.scheduledStart = payload.scheduledStart; row.scheduledEnd = payload.scheduledEnd; row.odometer = payload.odometer; row.vendor = payload.vendor; row.note = payload.note
    row.completedAt = payload.status === bookcarsTypes.WorkOrderStatus.Completed ? (row.completedAt || new Date()) : undefined
    await row.save(); await row.populate([{ path: 'car', select: 'name licensePlate' }, { path: 'supplier', select: 'fullName' }]); res.json(row)
  } catch (err) {
 logger.error(`[workOrder.update] ${i18n.t('ERROR')}`, err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const remove = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).send('Invalid work order')
      return
    }
    // GH-09 — mirror the expense remove() pattern (F7 / W3 M-7): a
    // hard delete requires a recorded reason (at least 3 characters)
    // and the audit row is written BEFORE the delete, so the trail
    // survives it (the work order id is kept on the row).
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
    if (reason.length < 3) {
      res.status(400).send('A reason is required to delete a work order')
      return
    }
    const row = await MaintenanceWorkOrder.findOne({ _id: req.params.id, ...scope(req) }).select('_id supplier')
    if (!row) {
      res.sendStatus(404)
      return
    }
    // A work order with linked expenses cannot be hard-deleted: the
    // expenses (and their payments) would be orphaned with no work
    // order to explain them — the same 409 the expense delete applies
    // to expenses with payments. Remove or unlink the expenses first.
    const expenseCount = await MaintenanceExpense.countDocuments({ workOrder: row._id })
    if (expenseCount > 0) {
      res.status(409).send('This work order has linked expenses and cannot be deleted. Remove or unlink the expenses first.')
      return
    }
    await MaintenanceWorkOrderAudit.create({
      supplier: row.supplier,
      workOrder: row._id,
      action: bookcarsTypes.MaintenanceExpenseAuditAction.Deleted,
      actor: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : undefined,
      reason,
    })
    await MaintenanceWorkOrder.deleteOne({ _id: row._id })
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[workOrder.remove] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

