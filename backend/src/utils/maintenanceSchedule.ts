import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Car from '../models/Car'
import MaintenanceSchedule from '../models/MaintenanceSchedule'

/**
 * F7 / W3 M-4 — mileage-aware schedule due status.
 *
 * The stored `status` on a schedule is still the date-derived one
 * (the controller's `normalize` cannot see the car's odometer), but
 * every live evaluation — the list payload (`present()`), the booking
 * block, the restore check — runs through `resolveScheduleDue` here,
 * which merges the date leg and the mileage leg:
 * - date leg: overdue when the due date has passed; due within 30
 *   days; otherwise upcoming (the pre-existing date rule, unchanged);
 * - mileage leg: overdue when the car's current odometer
 *   (`Car.odometerKm`) has reached the effective next-due mileage —
 *   the stored `nextDueMileage`, or `lastServiceMileage + intervalKm`
 *   when both are present. There is NO mileage "due soon" state: no
 *   threshold for it exists in the data, so mileage only ever marks
 *   a schedule Overdue, never Due.
 * The merged status is the worst of the two legs; Completed is
 * always Completed. A schedule whose car has no odometer reading is
 * evaluated date-only.
 */

export interface ScheduleDueInput {
  // GAP-MAINT-P0-1 — a km-only schedule (intervalKm, no intervalDays,
  // no explicit due date) carries no nextDueDate: the date leg is
  // skipped for it and the mileage leg governs.
  nextDueDate?: Date | string | null
  nextDueMileage?: number | null
  intervalKm?: number | null
  lastServiceMileage?: number | null
  status: bookcarsTypes.MaintenanceScheduleStatus
  car?: { odometerKm?: number | null } | string | null
}

export interface ScheduleDue {
  status: bookcarsTypes.MaintenanceScheduleStatus
  dueByDate: boolean
  dueByMileage: boolean
  effectiveNextDueMileage: number | null
  odometerKm?: number | null
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

export const effectiveNextDueMileage = (schedule: ScheduleDueInput): number | null => {
  if (schedule.nextDueMileage !== undefined && schedule.nextDueMileage !== null) {
    return schedule.nextDueMileage
  }
  if (schedule.intervalKm !== undefined && schedule.intervalKm !== null
    && schedule.lastServiceMileage !== undefined && schedule.lastServiceMileage !== null) {
    return schedule.lastServiceMileage + schedule.intervalKm
  }
  return null
}

export const resolveScheduleDue = (schedule: ScheduleDueInput, now = new Date()): ScheduleDue => {
  const nextMileage = effectiveNextDueMileage(schedule)
  if (schedule.status === bookcarsTypes.MaintenanceScheduleStatus.Completed) {
    return { status: bookcarsTypes.MaintenanceScheduleStatus.Completed, dueByDate: false, dueByMileage: false, effectiveNextDueMileage: nextMileage }
  }
  const today = startOfDay(now)
  // GAP-MAINT-P0-1 — no due date (km-only schedule): the date leg is
  // skipped entirely; the schedule is due only by mileage.
  const due = schedule.nextDueDate ? startOfDay(new Date(schedule.nextDueDate)) : null
  const dueByDate = due !== null && due.getTime() < today.getTime()
  const odometerKm = schedule.car && typeof schedule.car === 'object' ? schedule.car.odometerKm : undefined
  const dueByMileage = nextMileage !== null && odometerKm !== undefined && odometerKm !== null && odometerKm >= nextMileage
  const soon = new Date(today)
  soon.setDate(soon.getDate() + 30)
  const status = dueByDate || dueByMileage
    ? bookcarsTypes.MaintenanceScheduleStatus.Overdue
    : due !== null && due.getTime() <= soon.getTime()
      ? bookcarsTypes.MaintenanceScheduleStatus.Due
      : bookcarsTypes.MaintenanceScheduleStatus.Upcoming
  return { status, dueByDate, dueByMileage, effectiveNextDueMileage: nextMileage, odometerKm: odometerKm ?? null }
}

export const isScheduleOverdue = (schedule: ScheduleDueInput, now = new Date()): boolean =>
  resolveScheduleDue(schedule, now).status === bookcarsTypes.MaintenanceScheduleStatus.Overdue

/** Human-readable trigger for the booking-block / restore 409. */
export const overdueTriggerLabel = (due: ScheduleDue, schedule: ScheduleDueInput): string => {
  const parts: string[] = []
  if (due.dueByDate && schedule.nextDueDate) {
    parts.push(`due date ${new Date(schedule.nextDueDate).toISOString().slice(0, 10)} passed`)
  }
  if (due.dueByMileage) {
    parts.push(`odometer ${due.odometerKm} km reached next due ${due.effectiveNextDueMileage} km`)
  }
  return parts.join(' and ')
}

export interface OverdueSchedule {
  id: string
  title: string
  due: ScheduleDue
  trigger: string
}

/**
 * The first overdue (date or mileage) non-completed schedule for a
 * car, evaluated live against the car's current odometer — never the
 * stored status, which is date-only and can be stale. Returns null
 * when no schedule blocks the car.
 */
export const findOverdueSchedule = async (
  supplier: mongoose.Types.ObjectId | string,
  carId: mongoose.Types.ObjectId | string,
  dbSession?: mongoose.ClientSession,
): Promise<OverdueSchedule | null> => {
  const query = MaintenanceSchedule.find({
    supplier,
    car: new mongoose.Types.ObjectId(carId),
    status: { $ne: bookcarsTypes.MaintenanceScheduleStatus.Completed },
  }).select('title nextDueDate nextDueMileage intervalKm lastServiceMileage status').lean()
  if (dbSession) {
    query.session(dbSession)
  }
  const schedules = await query
  if (schedules.length === 0) {
    return null
  }
  const carQuery = Car.findById(carId).select('odometerKm').lean()
  if (dbSession) {
    carQuery.session(dbSession)
  }
  const car = await carQuery
  for (const schedule of schedules) {
    const due = resolveScheduleDue({ ...schedule, car: car ? { odometerKm: car.odometerKm } : null })
    if (due.status === bookcarsTypes.MaintenanceScheduleStatus.Overdue) {
      return { id: schedule._id.toString(), title: schedule.title, due, trigger: overdueTriggerLabel(due, { ...schedule, car: undefined }) }
    }
  }
  return null
}

/**
 * Wave 2 remainder — 2.2. The maintenance re-check at handover: a
 * car must not leave the lot with maintenance overdue, nor with a
 * service that falls due inside the rental window (the car would come
 * back past its service). Returns the blocking schedule — overdue-NOW
 * first, else the earliest due-in-window — or null when nothing
 * blocks the handover. Same live evaluation as findOverdueSchedule
 * (date + mileage legs against the car's current odometer).
 */
export const findBlockingScheduleForHandover = async (
  supplier: mongoose.Types.ObjectId | string,
  carId: mongoose.Types.ObjectId | string,
  from: Date,
  to: Date,
  dbSession?: mongoose.ClientSession,
): Promise<OverdueSchedule | null> => {
  const overdue = await findOverdueSchedule(supplier, carId, dbSession)
  if (overdue) {
    return overdue
  }
  const query = MaintenanceSchedule.find({
    supplier,
    car: new mongoose.Types.ObjectId(carId),
    status: { $ne: bookcarsTypes.MaintenanceScheduleStatus.Completed },
    nextDueDate: { $ne: null, $gte: from, $lte: to },
  }).select('title nextDueDate nextDueMileage intervalKm lastServiceMileage status').sort({ nextDueDate: 1 }).lean()
  if (dbSession) {
    query.session(dbSession)
  }
  const schedules = await query
  if (schedules.length === 0) {
    return null
  }
  const carQuery = Car.findById(carId).select('odometerKm').lean()
  if (dbSession) {
    carQuery.session(dbSession)
  }
  const car = await carQuery
  for (const schedule of schedules) {
    const due = resolveScheduleDue({ ...schedule, car: car ? { odometerKm: car.odometerKm } : null })
    if (due.status !== bookcarsTypes.MaintenanceScheduleStatus.Completed) {
      return { id: schedule._id.toString(), title: schedule.title, due, trigger: overdueTriggerLabel(due, { ...schedule, car: undefined }) }
    }
  }
  return null
}
