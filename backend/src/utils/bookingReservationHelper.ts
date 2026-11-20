import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import Car from '../models/Car'
import MaintenanceWorkOrder from '../models/MaintenanceWorkOrder'
import { findOverdueSchedule } from './maintenanceSchedule'

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
}

const reservesCar = (booking: env.Booking, now: Date) =>
  BOOKING_RESERVATION_STATUSES.includes(booking.status)
  || (booking.status === bookcarsTypes.BookingStatus.Void && !!booking.expireAt && booking.expireAt > now)
  || (booking.status === bookcarsTypes.BookingStatus.Pending && !!booking.expireAt && booking.expireAt > now)

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

export const saveBookingsWithAvailability = async (bookings: env.Booking[], options: BookingSaveOptions = {}) => {
  const now = new Date()
  const reservingBookings = bookings.filter((booking) => reservesCar(booking, now))

  if (reservingBookings.length === 0) {
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
  const release = await acquireLocks(carIds)
  try {
    return await executeLogic()
  } finally {
    release()
  }
}

export const saveBookingWithAvailability = async (booking: env.Booking, options?: BookingSaveOptions) =>
  saveBookingsWithAvailability([booking], options)

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
