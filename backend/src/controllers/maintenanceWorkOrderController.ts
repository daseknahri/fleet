import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Car from '../models/Car'
import MaintenanceWorkOrder from '../models/MaintenanceWorkOrder'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'

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
    const rows = await MaintenanceWorkOrder.find(scope(req)).sort({ scheduledStart: 1, createdAt: -1 }).populate('car', 'name licensePlate').populate('supplier', 'fullName')
    res.json(rows)
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
 res.status(400).send('Invalid work order'); return 
}; const result = await MaintenanceWorkOrder.deleteOne({ _id: req.params.id, ...scope(req) }); if (!result.deletedCount) {
 res.sendStatus(404); return 
}; res.sendStatus(200) 
} catch (err) {
 logger.error(`[workOrder.remove] ${i18n.t('ERROR')}`, err); res.status(400).send(i18n.t('ERROR')) 
}
}

