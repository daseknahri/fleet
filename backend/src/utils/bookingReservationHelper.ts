import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import Car from '../models/Car'
import MaintenanceSchedule from '../models/MaintenanceSchedule'
import MaintenanceWorkOrder from '../models/MaintenanceWorkOrder'
import AgencyReturnSettings from '../models/AgencyReturnSettings'
import { effectiveNextDueMileage, findOverdueSchedule } from './maintenanceSchedule'
import { nextBookingReference } from './bookingReference'
import * as helper from '../utils/helper'

// R2-B13 - calendar-day comparison (same server-local convention
// as maintenanceSchedule.ts:47; helper exposes no startOfDay).
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

export const BOOKING_RESERVATION_STATUSES = [
  bookcarsTypes.BookingStatus.Deposit,
  bookcarsTypes.BookingStatus.Paid,
  bookcarsTypes.BookingStatus.PaidInFull,
  bookcarsTypes.BookingStatus.Reserved,
]

/**
 * GAP-C1/M1 — the single definition of "this booking reserves the car"
 * for queries. `Pending` is deliberately NOT in
 * `BOOKING_RESERVATION_STATUSES`: a pay-later hold reserves the car
 * only while its hold window (`expireAt`, stamped by checkout) is
 * still open — a hold without an expiry, or with an expired one,
 * reserves nothing. `reservesCar` below is the in-memory mirror of
 * this `$or`; keep the two in sync. Every availability read (the
 * enforcement helper, the search aggregations, fleet status, the
 * import pre-check) must use this predicate, never the bare list.
 */
export const reservationStatusOr = (now: Date) => ([
  { status: { $in: BOOKING_RESERVATION_STATUSES } },
  { status: bookcarsTypes.BookingStatus.Void, expireAt: { $gt: now } },
  { status: bookcarsTypes.BookingStatus.Pending, expireAt: { $gt: now } },
  // Wave 2.1 — a CONFIRMED pay-later hold (lifecycle Confirmed,
  // expireAt cleared by the confirm action) reserves the car
  // indefinitely, with no expiry to outlive.
  { status: bookcarsTypes.BookingStatus.Pending, lifecycle: bookcarsTypes.ContractLifecycle.Confirmed },
])

/**
 * GAP-C1/M1 — "not a temporary checkout placeholder". `expireAt` no
 * longer means "temporary" on its own: a pay-later (Pending) booking
 * carries it as its hold window and is a live booking. Only a Void
 * booking with `expireAt` set is a temporary checkout placeholder.
 * Use this wherever a list must exclude placeholders but keep holds.
 * A function (not a shared object) so each query gets a fresh filter.
 */
export const notTemporaryBookingFilter = () => ({
  $or: [{ expireAt: null }, { status: { $ne: bookcarsTypes.BookingStatus.Void } }],
})

export class BookingConflictError extends Error {
  /** GA-PAR-10: the conflicting booking's id when the conflict is a
   * booking-vs-booking overlap (never set for maintenance conflicts). */
  conflictingBookingId?: string

  constructor(conflictingBookingId?: string) {
    super('The car is no longer available for the selected rental dates')
    this.name = 'BookingConflictError'
    this.conflictingBookingId = conflictingBookingId
  }
}

/**
 * F7 / W3 M-4 — a car with an overdue maintenance schedule cannot be
 * booked. Extends BookingConflictError, so every existing `instanceof
 * BookingConflictError` catch answers 409 with this message — including
 * the Stripe/PayPal refund paths, where refusing the booking is the
 * correct behaviour. The message names the schedule and the trigger
 * (overdue date and/or mileage) so the operator knows what to service.
 */
export class OverdueMaintenanceError extends BookingConflictError {
  constructor(scheduleTitle: string, trigger: string) {
    super()
    this.name = 'OverdueMaintenanceError'
    this.message = `The car has an overdue maintenance schedule (${scheduleTitle}: ${trigger}) and cannot be booked until it is serviced`
  }
}

/**
 * GH-08 — a maintenance schedule that becomes due DURING the rental
 * blocks the booking, even though it is not overdue yet. Extends
 * BookingConflictError like OverdueMaintenanceError, so every existing
 * `instanceof BookingConflictError` catch answers 409 with this
 * message; no overlap exception bypasses it.
 */
export class DueInWindowMaintenanceError extends BookingConflictError {
  constructor(scheduleTitle: string, trigger: string) {
    super()
    this.name = 'DueInWindowMaintenanceError'
    this.message = `The car has a maintenance schedule due during the rental (${scheduleTitle}: ${trigger}) and cannot be booked until it is serviced`
  }
}

export interface BookingSaveOptions {
  expectedStatus?: bookcarsTypes.BookingStatus
  requireExpireAt?: boolean
  session?: mongoose.ClientSession
  /**
   * GA-PAR-10: when true, booking-vs-booking conflicts are bypassed and
   * reported through `onBookingConflict` instead of throwing; the caller
   * is responsible for persisting the exception record on the booking.
   * Maintenance work-order conflicts are NEVER bypassed - they throw
   * BookingConflictError regardless of this flag (coordinator ruling N9).
   */
  allowOverlapException?: boolean
  /** GA-PAR-10: receives the conflicting booking's id for a bypassed
   * booking-vs-booking conflict. */
  onBookingConflict?: (conflictingBookingId: string) => void
  /** Wave 1.5 (S2) — skip the in-process per-car lock in the
   * non-transactional path. Only set when the caller already holds the
   * lock via `withCarLock` (TOCTOU double-check: re-check, then save
   * under one lock). Setting it without holding the lock re-opens the
   * check-then-save race. */
  skipCarLock?: boolean
}

const reservesCar = (booking: env.Booking, now: Date) =>
  BOOKING_RESERVATION_STATUSES.includes(booking.status)
  || (booking.status === bookcarsTypes.BookingStatus.Void && !!booking.expireAt && booking.expireAt > now)
  || (booking.status === bookcarsTypes.BookingStatus.Pending && !!booking.expireAt && booking.expireAt > now)
  // Wave 2.1 — mirror of the confirmed leg above: a Confirmed hold
  // with no expireAt still reserves the car.
  || (booking.status === bookcarsTypes.BookingStatus.Pending && booking.lifecycle === bookcarsTypes.ContractLifecycle.Confirmed)

/**
 * F4 / W1 #4 (= W4 GAP-09) — the boundary rule is strict: two rentals
 * touch but do not overlap when one pickup is exactly the previous
 * return (`first.to === second.from`). Back-to-back / same-day turnaround
 * is a normal rental operation and must not 409. The earlier inclusive
 * predicate (`<=` / `>=`) blocked it with no cited decision. If a
 * turnaround buffer is ever wanted, it must be an explicit, named,
 * configurable gap — never a silent inclusive boundary.
 */
const overlaps = (first: env.Booking, second: env.Booking) =>
  first.from < second.to && first.to > second.from

// Simple queue-based lock for non-transactional environments
const carLocks = new Map<string, Promise<void>>()

const acquireLocks = async (carIds: string[]): Promise<() => void> => {
  const sortedCarIds = [...new Set(carIds)].sort()
  const releaseFns: (() => void)[] = []

  for (const carId of sortedCarIds) {
    let release: () => void
    const nextLock = new Promise<void>((resolve) => {
      release = resolve
    })

    const currentLock = carLocks.get(carId) || Promise.resolve()
    carLocks.set(carId, currentLock.then(() => nextLock))

    await currentLock
    releaseFns.push(release!)
  }

  return () => {
    for (const release of releaseFns) {
      release()
    }
  }
}

/**
 * Wave 1.5 (S2) — run `fn` while holding the in-process per-car lock
 * for `carIds`. The lock serialises the non-transactional save path
 * (see `saveBookingsWithAvailability`); a caller that re-checks
 * availability and then saves inside this lock closes the
 * check-then-save race without deadlocking on its own lock (pass
 * `skipCarLock: true` to the save inside).
 */
export const withCarLock = async <T>(carIds: string[], fn: () => Promise<T>): Promise<T> => {
  const release = await acquireLocks(carIds)
  try {
    return await fn()
  } finally {
    release()
  }
}

/**
 * Wave 1.5 (S2) — the availability re-check, extracted from
 * `saveBookingsWithAvailability` so a caller can run it as the second
 * half of a TOCTOU double-check (re-check, then save) without the save
 * re-running the check. Downtime work-order and overdue-schedule
 * conflicts are never bypassed (GA-PAR-10 / ruling N9);
 * booking-vs-booking conflicts follow `options.allowOverlapException`.
 *
 * @param {env.Booking} booking
 * @param {(mongoose.Types.ObjectId | string)[]} bookingIds ids being saved (excluded from the conflict search)
 * @param {BookingSaveOptions} options
 * @param {mongoose.ClientSession} session
 */
export const checkBookingAvailability = async (
  booking: env.Booking,
  bookingIds: (mongoose.Types.ObjectId | string)[],
  options: BookingSaveOptions = {},
  session?: mongoose.ClientSession,
) => {
  const now = new Date()
  const carId = booking.car.toString()
  const downtimeQuery = MaintenanceWorkOrder.findOne({
    supplier: booking.supplier,
    car: new mongoose.Types.ObjectId(carId),
    status: { $in: [bookcarsTypes.WorkOrderStatus.Scheduled, bookcarsTypes.WorkOrderStatus.InProgress] },
    scheduledStart: { $lt: booking.to },
    scheduledEnd: { $gt: booking.from },
  }).select('_id').lean()
  if (session) {
    downtimeQuery.session(session)
  }
  if (await downtimeQuery) {
    // GA-PAR-10 / ruling N9: maintenance work-order conflicts are
    // NEVER bypassed by an overlap exception - no flag overrides this.
    throw new BookingConflictError()
  }
  // F7 / W3 M-4 — an overdue maintenance schedule blocks the
  // booking outright (same never-bypassed rule as downtime: no
  // overlap exception applies, whatever the booking dates are).
  const overdue = await findOverdueSchedule(booking.supplier, carId, session)
  if (overdue) {
    throw new OverdueMaintenanceError(overdue.title, overdue.trigger)
  }
  // GH-08 — a schedule that becomes due DURING the rental blocks it
  // too (date or mileage leg), same never-bypassed rule.
  const dueInWindow = await findDueInWindowSchedule(booking.supplier, carId, new Date(booking.from), new Date(booking.to), session)
  if (dueInWindow) {
    throw new DueInWindowMaintenanceError(dueInWindow.title, dueInWindow.trigger)
  }
  const query = Booking.findOne({
    _id: { $nin: bookingIds },
    car: new mongoose.Types.ObjectId(carId),
    // GA-PAR-22: a trashed booking does not reserve its car.
    deletedAt: null,
    // F4 / W1 #4 — strict range: a booking whose pickup is exactly
    // this booking's return (or vice versa) does not overlap.
    from: { $lt: booking.to },
    to: { $gt: booking.from }, $or: reservationStatusOr(now),
    // A contract that already ran its course (or was cancelled at the
    // lifecycle level) no longer reserves the car, whatever its payment
    // status still says (GAQ12B1: completed lifecycle + reserved status
    // blocked the car for its window indefinitely).
    lifecycle: { $nin: [bookcarsTypes.ContractLifecycle.Completed, bookcarsTypes.ContractLifecycle.Cancelled] },
  }).select('_id').lean()

  if (session) {
    query.session(session)
  }
  const conflict = await query

  if (conflict) {
    if (options.allowOverlapException) {
      options.onBookingConflict?.(conflict._id.toString())
    } else {
      throw new BookingConflictError(conflict._id.toString())
    }
  }
}

export const saveBookingsWithAvailability = async (bookings: env.Booking[], options: BookingSaveOptions = {}) => {
  const now = new Date()
  const reservingBookings = bookings.filter((booking) => reservesCar(booking, now))

  if (reservingBookings.length === 0) {
    // R3-04 — same guarded allocation as the reserving branch: the
    // bare save below is the only failure left, so the burn is narrowed
    // to save-time failures, not eliminated.
    for (const booking of bookings) {
      if (!booking.reference) {
        booking.reference = await nextBookingReference(booking.supplier)
      }
    }
    for (const booking of bookings) {
      await booking.save()
    }
    return true
  }

  const client = mongoose.connection.getClient() as any
  const topologyType = client?.topology?.description?.type
  const supportsTransactions = topologyType && topologyType !== 'Single' && topologyType !== 'Unknown'

  const executeLogic = async (session?: mongoose.ClientSession) => {
    const sessionOpt = session ? { session } : {}

    if (options.expectedStatus) {
      const query = Booking.findOne({
        _id: bookings[0]._id,
        status: options.expectedStatus,
        ...(options.requireExpireAt ? { expireAt: { $gt: now } } : {}),
      }).select('_id').lean()

      if (session) {
        query.session(session)
      }
      const expectedBooking = await query

      if (!expectedBooking) {
        return false
      }
    }

    const carIds = [...new Set(reservingBookings.map((booking) => booking.car.toString()))].sort()

    // GAP-M2 — the overlap check always runs: `blockOnPay` no longer
    // gates it. The version bump below is kept (it stamps the car so
    // concurrent booking saves serialize on the document), but the flag
    // is never read here anymore.
    for (const carId of carIds) {
      const query = Car.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(carId) },
        { $inc: { bookingReservationVersion: 1 } },
        { new: true, timestamps: false, ...sessionOpt },
      ).select('_id').lean()

      const car = await query

      if (!car) {
        throw new Error(`Car ${carId} not found`)
      }
    }

    const bookingIds = bookings.map((booking) => booking._id).filter(Boolean)

    for (const booking of reservingBookings) {
      await checkBookingAvailability(booking, bookingIds, options, session)
    }

    for (let firstIndex = 0; firstIndex < reservingBookings.length; firstIndex += 1) {
      const first = reservingBookings[firstIndex]

      for (let secondIndex = firstIndex + 1; secondIndex < reservingBookings.length; secondIndex += 1) {
        const second = reservingBookings[secondIndex]
        if (first.car.toString() === second.car.toString() && overlaps(first, second)) {
          if (options.allowOverlapException) {
            const otherId = (second._id || first._id)?.toString()
            if (otherId) {
              options.onBookingConflict?.(otherId)
            }
          } else {
            throw new BookingConflictError((second._id || first._id)?.toString())
          }
        }
      }
    }

    // R3-04 — allocate the reference here, after the internal re-check
    // has passed and immediately before the save: no failure after this
    // point can 409/throw except the save's own write, so a refused
    // checkout or create no longer burns a number. Only bookings with
    // no reference allocate — update/amend/status-change callers pass
    // bookings that already carry one.
    for (const booking of bookings) {
      if (!booking.reference) {
        booking.reference = await nextBookingReference(booking.supplier)
      }
    }
    for (const booking of bookings) {
      await booking.save(sessionOpt)
    }

    return true
  }

  if (options.session) {
    return executeLogic(options.session)
  }

  if (supportsTransactions) {
    return mongoose.connection.transaction(executeLogic)
  }

  const carIds = reservingBookings.map((b) => b.car.toString())
  // Wave 1.5 (S2) — a caller that already holds the lock (withCarLock)
  // skips re-acquiring it here; the lock is never taken twice.
  const release = options.skipCarLock ? () => {} : await acquireLocks(carIds)
  try {
    return await executeLogic()
  } finally {
    release()
  }
}

export const saveBookingWithAvailability = async (booking: env.Booking, options?: BookingSaveOptions) =>
  saveBookingsWithAvailability([booking], options)

export interface DueInWindowSchedule {
  id: string
  title: string
  trigger: string
}

/**
 * GH-08 — the first non-completed maintenance schedule for a car that
 * becomes due at any point in [from, to], or null when none does.
 * Evaluated live (never the stored date-only status):
 * - date leg: nextDueDate inside [from, to] (inclusive — the same
 *   bounds as the handover check findBlockingScheduleForHandover);
 * - mileage leg: the car's current odometer + the rental's expected
 *   km, where expected km = the supplier's includedKmPerDay x the
 *   rental days (helper.days, floored at 1 — the same day count the
 *   price logic and the settlement preview use). The schedule blocks
 *   when its effective next-due mileage (stored nextDueMileage, else
 *   lastServiceMileage + intervalKm) is reached by the projected
 *   odometer. When includedKmPerDay is null (the agency's km are
 *   unlimited) or the car has no odometer reading, the mileage leg is
 *   SKIPPED — no km/day number is invented. A schedule already overdue
 *   now is caught by findOverdueSchedule first at both call sites, so
 *   in practice this leg only fires for newly-due schedules; the
 *   `<= projected` test still blocks it if called standalone.
 * Candidates are checked earliest-due-date-first so the reported
 * blocker is deterministic.
 */
export const findDueInWindowSchedule = async (
  supplier: mongoose.Types.ObjectId | string,
  carId: mongoose.Types.ObjectId | string,
  from: Date,
  to: Date,
  dbSession?: mongoose.ClientSession,
): Promise<DueInWindowSchedule | null> => {
  const scheduleQuery = MaintenanceSchedule.find({
    supplier,
    car: new mongoose.Types.ObjectId(carId),
    status: { $ne: bookcarsTypes.MaintenanceScheduleStatus.Completed },
  }).select('title nextDueDate nextDueMileage intervalKm lastServiceMileage status').lean()
  if (dbSession) {
    scheduleQuery.session(dbSession)
  }
  const schedules = await scheduleQuery
  if (schedules.length === 0) {
    return null
  }
  const carQuery = Car.findById(carId).select('odometerKm').lean()
  if (dbSession) {
    carQuery.session(dbSession)
  }
  const car = await carQuery
  const settingsQuery = AgencyReturnSettings.findOne({ supplier }).select('includedKmPerDay').lean()
  if (dbSession) {
    settingsQuery.session(dbSession)
  }
  const settings = await settingsQuery
  const rentalDays = Math.max(1, helper.days(from, to))
  const includedKmPerDay = typeof settings?.includedKmPerDay === 'number' ? settings.includedKmPerDay : null
  const odometerKm = typeof car?.odometerKm === 'number' ? car.odometerKm : null
  const projectedOdometerKm = includedKmPerDay !== null && odometerKm !== null
    ? odometerKm + includedKmPerDay * rentalDays
    : null
  const fromLabel = new Date(from).toISOString().slice(0, 10)
  const toLabel = new Date(to).toISOString().slice(0, 10)
  const sorted = [...schedules].sort((a, b) => {
    const aDue = a.nextDueDate ? new Date(a.nextDueDate).getTime() : Number.POSITIVE_INFINITY
    const bDue = b.nextDueDate ? new Date(b.nextDueDate).getTime() : Number.POSITIVE_INFINITY
    return aDue - bDue
  })
  for (const schedule of sorted) {
    if (schedule.nextDueDate) {
      // R2-B13 - calendar-day comparison: a schedule due ON the
      // pickup day blocks the booking. nextDueDate is stored at
      // midnight while from/to carry pickup/return times, so a raw
      // datetime comparison misses the whole pickup day.
      const dueDate = startOfDay(new Date(schedule.nextDueDate))
      if (dueDate >= startOfDay(from) && dueDate <= startOfDay(to)) {
        return {
          id: schedule._id.toString(),
          title: schedule.title,
          trigger: `due date ${dueDate.toISOString().slice(0, 10)} falls inside the rental (${fromLabel} to ${toLabel})`,
        }
      }
    }
    const nextMileage = effectiveNextDueMileage(schedule as unknown as Parameters<typeof effectiveNextDueMileage>[0])
    if (nextMileage !== null && projectedOdometerKm !== null && nextMileage <= projectedOdometerKm) {
      return {
        id: schedule._id.toString(),
        title: schedule.title,
        trigger: `projected odometer ${projectedOdometerKm} km reaches next due ${nextMileage} km during the rental (${rentalDays} days x ${includedKmPerDay} km/day from ${odometerKm} km)`,
      }
    }
  }
  return null
}

export interface RestoreConflict {
  conflictingBookingId?: string
  /** A scheduled/in-progress maintenance work order covers the window. */
  maintenance?: boolean
  /** F7 / W3 M-4 — an overdue maintenance schedule blocks the car. */
  overdueSchedule?: { title: string, trigger: string }
}

/**
 * GA-PAR-22 — restore re-validation (design §2.6d): re-run the
 * availability check for a booking whose status reserves the car and
 * whose lifecycle has not run its course, against LIVE bookings only.
 * Mirrors the conflict logic inside `saveBookingsWithAvailability`
 * (maintenance downtime first, then the live-booking overlap,
 * excluding the booking itself; GAP-M2 — the check always runs,
 * `blockOnPay` no longer gates it). A booking that does not
 * reserve the car (or whose lifecycle is Completed/Cancelled) never
 * conflicts. The caller names the blocker in the 409 (`OVERLAP` with
 * the conflicting id, or a maintenance conflict).
 */
export const findBookingConflictForRestore = async (booking: env.Booking): Promise<RestoreConflict> => {
  const now = new Date()
  if (!reservesCar(booking, now)) {
    return {}
  }
  if (
    booking.lifecycle === bookcarsTypes.ContractLifecycle.Completed
    || booking.lifecycle === bookcarsTypes.ContractLifecycle.Cancelled
  ) {
    return {}
  }

  const carId = booking.car.toString()
  const downtime = await MaintenanceWorkOrder.findOne({
    supplier: booking.supplier,
    car: new mongoose.Types.ObjectId(carId),
    status: { $in: [bookcarsTypes.WorkOrderStatus.Scheduled, bookcarsTypes.WorkOrderStatus.InProgress] },
    scheduledStart: { $lt: booking.to },
    scheduledEnd: { $gt: booking.from },
  }).select('_id').lean()

  if (downtime) {
    return { maintenance: true }
  }

  // F7 / W3 M-4 — an overdue schedule blocks a restore exactly like
  // it blocks a fresh booking (evaluated live, never the stored
  // date-only status).
  const overdue = await findOverdueSchedule(booking.supplier, carId)
  if (overdue) {
    return { overdueSchedule: { title: overdue.title, trigger: overdue.trigger } }
  }
  // GH-08 — a schedule due DURING the rental blocks a restore too.
  // Reported through the existing `overdueSchedule` field (the restore
  // endpoint in bookingController.ts is out of scope for this pass, so
  // no new field is added there); the trigger names the in-window
  // reason, so the 409 still reads correctly.
  const dueInWindow = await findDueInWindowSchedule(booking.supplier, carId, new Date(booking.from), new Date(booking.to))
  if (dueInWindow) {
    return { overdueSchedule: { title: dueInWindow.title, trigger: dueInWindow.trigger } }
  }

  const conflict = await Booking.findOne({
    _id: { $nin: [booking._id] },
    car: new mongoose.Types.ObjectId(carId),
    // GA-PAR-22: only LIVE bookings can block a restore.
    deletedAt: null,
    // F4 / W1 #4 — strict range, same boundary rule as above.
    from: { $lt: booking.to },
    to: { $gt: booking.from },
    $or: reservationStatusOr(now),
    lifecycle: { $nin: [bookcarsTypes.ContractLifecycle.Completed, bookcarsTypes.ContractLifecycle.Cancelled] },
  }).select('_id').lean()

  return conflict ? { conflictingBookingId: conflict._id.toString() } : {}
}