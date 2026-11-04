import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Car from '../models/Car'
import MaintenanceSchedule from '../models/MaintenanceSchedule'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'

const scope = (req: Request): Record<string, unknown> => req.user?.type === bookcarsTypes.UserType.Admin
  ? {}
  : { supplier: agencySupplierId(req) || '000000000000000000000000' }

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const dueStatus = (date: Date, completed?: boolean) => {
  if (completed) {
return bookcarsTypes.MaintenanceScheduleStatus.Completed
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
    || String(input.note || '').trim().length > 1000) {
return null
}
  const nextDueDate = requestedDue || (lastDate && intervalDays ? new Date(lastDate.getTime() + intervalDays * 86400000) : new Date())
  if (!nextDueDate || Number.isNaN(nextDueDate.getTime())) {
return null
}
  const status = input.status === bookcarsTypes.MaintenanceScheduleStatus.Completed
    ? bookcarsTypes.MaintenanceScheduleStatus.Completed
    : dueStatus(nextDueDate)
  return { car: input.car, title, type: input.type, intervalDays, intervalKm, lastServiceDate: lastDate, lastServiceMileage: lastMileage, nextDueDate, nextDueMileage: nextMileage, status, note: String(input.note || '').trim() }
}

const carInScope = async (carId: string, supplierId?: string, admin = false) => admin
  ? Car.findById(carId).select('_id supplier')
  : Car.findOne({ _id: carId, supplier: supplierId }).select('_id supplier')

const present = (row: env.MaintenanceSchedule) => {
  const item = row.toObject ? row.toObject() : row
  if (item.status !== bookcarsTypes.MaintenanceScheduleStatus.Completed) {
item.status = dueStatus(new Date(item.nextDueDate))
}
  return item
}

export const list = async (req: Request, res: Response) => {
  try {
    const query: Record<string, unknown> = { ...scope(req) }
    const requestedStatus = String(req.query.status || '').trim()
    if (Object.values(bookcarsTypes.MaintenanceScheduleStatus).includes(requestedStatus as bookcarsTypes.MaintenanceScheduleStatus)) {
query.status = requestedStatus
}
    const rows = await MaintenanceSchedule.find(query).sort({ nextDueDate: 1, createdAt: -1 }).populate('car', 'name licensePlate').populate('supplier', 'fullName')
    res.json(rows.map(present))
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
    const row = await MaintenanceSchedule.create({ ...payload, supplier: car.supplier })
    await row.populate([{ path: 'car', select: 'name licensePlate' }, { path: 'supplier', select: 'fullName' }])
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
    Object.assign(row, payload, { car: car._id })
    await row.save()
    await row.populate([{ path: 'car', select: 'name licensePlate' }, { path: 'supplier', select: 'fullName' }])
    res.json(present(row))
  } catch (err) {
 logger.error('[maintenanceSchedule.update]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const remove = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
 res.status(400).send('Invalid maintenance schedule'); return 
}
    const result = await MaintenanceSchedule.deleteOne({ _id: req.params.id, ...scope(req) })
    if (!result.deletedCount) {
 res.sendStatus(404); return 
}
    res.sendStatus(200)
  } catch (err) {
 logger.error('[maintenanceSchedule.remove]', err); res.status(400).send(i18n.t('ERROR')) 
}
}
