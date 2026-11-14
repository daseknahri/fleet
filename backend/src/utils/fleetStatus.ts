import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Booking from '../models/Booking'
import Car from '../models/Car'
import { BOOKING_RESERVATION_STATUSES } from './bookingReservationHelper'

// Fleet statuses (scorecard #15): the derived status of a car and the
// counts behind the fleet list.
//
// Representation decision: a single operator-set enum `operationalStatus`
// (`inService` | `maintenance` | `stopped`, default `inService`) on the
// car. `rented` is NOT stored — it is derived here from live bookings
// with the same reservation predicate the availability engine uses
// (`BOOKING_RESERVATION_STATUSES` + unexpired Void holds, lifecycle not
// Completed/Cancelled, window covering now). The operator status wins
// over `rented`: a car in maintenance or stopped reads as such even
// while a booking covers it. A car with no stored value (legacy docs)
// reads as inService. A car that is in service, not rented and
// `available: false` is `unavailable` — it belongs to none of the four
// counted statuses and is excluded from the `available` count (same
// rule as the PAR-09 dashboard figure).

export type FleetStatus = bookcarsTypes.CarFleetStatus | 'unavailable'

export const FLEET_STATUSES: bookcarsTypes.CarFleetStatus[] = ['available', 'rented', 'maintenance', 'stopped']

export const isFleetStatus = (value: unknown): value is bookcarsTypes.CarFleetStatus =>
  typeof value === 'string' && (FLEET_STATUSES as string[]).includes(value)

/** In service when the operator status is `inService` or absent (legacy docs). */
export const isInService = (car: { operationalStatus?: string | null }): boolean =>
  !car.operationalStatus || car.operationalStatus === bookcarsTypes.CarOperationalStatus.InService

/** A car in maintenance or stopped is NOT bookable (booking create refuses it with 403). */
export const isNotBookable = (car: { operationalStatus?: string | null }): boolean =>
  car.operationalStatus === bookcarsTypes.CarOperationalStatus.Maintenance
  || car.operationalStatus === bookcarsTypes.CarOperationalStatus.Stopped

export const emptyFleetStatusCounts = (): bookcarsTypes.FleetStatusCounts => ({
  available: 0,
  rented: 0,
  maintenance: 0,
  stopped: 0,
})

/**
 * The cars with a live booking covering `now`, agency-scoped.
 * Mirrors the reservation predicate in bookingReservationHelper
 * (`reservesCar` + the booking window): statuses that reserve the car,
 * unexpired Void holds, lifecycle not run its course, `deletedAt: null`.
 */
export const findCurrentlyRentedCarIds = async (
  supplierIds: mongoose.Types.ObjectId[],
  now: Date = new Date(),
): Promise<Set<string>> => {
  if (supplierIds.length === 0) {
    return new Set()
  }
  const bookings = await Booking.find({
    supplier: { $in: supplierIds },
    // GA-PAR-22: a trashed booking does not reserve its car.
    deletedAt: null,
    lifecycle: { $nin: [bookcarsTypes.ContractLifecycle.Completed, bookcarsTypes.ContractLifecycle.Cancelled] },
    from: { $lte: now },
    to: { $gte: now },
    $or: [
      { status: { $in: BOOKING_RESERVATION_STATUSES } },
      { status: bookcarsTypes.BookingStatus.Void, expireAt: { $gt: now } },
    ],
  }).select('car').lean()
  return new Set(bookings.map((booking) => booking.car.toString()))
}

/** Derive the display status of one car row. The operator status wins over `rented`. */
export const deriveFleetStatus = (
  car: { _id: mongoose.Types.ObjectId | string, operationalStatus?: string | null, available?: boolean },
  rentedCarIds: Set<string>,
): FleetStatus => {
  if (car.operationalStatus === bookcarsTypes.CarOperationalStatus.Maintenance) {
    return 'maintenance'
  }
  if (car.operationalStatus === bookcarsTypes.CarOperationalStatus.Stopped) {
    return 'stopped'
  }
  if (rentedCarIds.has(car._id.toString())) {
    return 'rented'
  }
  return car.available ? 'available' : 'unavailable'
}

export interface FleetStatusForList {
  counts: bookcarsTypes.FleetStatusCounts
  rentedCarIds: Set<string>
}

/**
 * Counts + rented set for a car list, computed from the SAME filtered
 * set as the list (the caller's `$and` conditions, before any
 * fleetStatus filter is applied) so the counts always match the rows
 * the list can show. `rented` counts in-service cars with a live
 * booking; `available` counts in-service, available cars WITHOUT a
 * live booking (rented cars never inflate it).
 */
export const fleetStatusForList = async (
  andConditions: Record<string, unknown>[],
  supplierIds: mongoose.Types.ObjectId[],
): Promise<FleetStatusForList> => {
  const counts = emptyFleetStatusCounts()
  const rentedCarIds = await findCurrentlyRentedCarIds(supplierIds)
  const rentedIds = [...rentedCarIds]

  const baseFilter = { $and: andConditions }
  const grouped = await Car.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: { op: { $ifNull: ['$operationalStatus', bookcarsTypes.CarOperationalStatus.InService] }, avail: '$available' },
        n: { $sum: 1 },
      },
    },
  ])
  for (const group of grouped as { _id: { op: string, avail: boolean }, n: number }[]) {
    if (group._id.op === bookcarsTypes.CarOperationalStatus.Maintenance) {
      counts.maintenance += group.n
    } else if (group._id.op === bookcarsTypes.CarOperationalStatus.Stopped) {
      counts.stopped += group.n
    }
  }
  const inServiceAvailTrue = (grouped as { _id: { op: string, avail: boolean }, n: number }[])
    .filter((group) => group._id.op === bookcarsTypes.CarOperationalStatus.InService && group._id.avail === true)
    .reduce((sum, group) => sum + group.n, 0)

  const inServiceFilter = { operationalStatus: { $in: [bookcarsTypes.CarOperationalStatus.InService, null] } }
  const [rentedInService, rentedInServiceAvailTrue] = await Promise.all([
    Car.countDocuments({ $and: [...andConditions, inServiceFilter, { _id: { $in: rentedIds } }] }),
    Car.countDocuments({ $and: [...andConditions, inServiceFilter, { available: true }, { _id: { $in: rentedIds } }] }),
  ])
  counts.rented = rentedInService
  counts.available = Math.max(0, inServiceAvailTrue - rentedInServiceAvailTrue)
  return { counts, rentedCarIds }
}
