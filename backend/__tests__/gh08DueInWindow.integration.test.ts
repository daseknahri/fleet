import 'dotenv/config'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import Booking from '../src/models/Booking'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import MaintenanceSchedule from '../src/models/MaintenanceSchedule'
import AgencyReturnSettings from '../src/models/AgencyReturnSettings'
import {
  checkBookingAvailability,
  DueInWindowMaintenanceError,
  findBookingConflictForRestore,
  findDueInWindowSchedule,
  OverdueMaintenanceError,
} from '../src/utils/bookingReservationHelper'
import { findBlockingScheduleForHandover } from '../src/utils/maintenanceSchedule'

// GH-08 — a maintenance schedule due DURING the rental blocks checkout
// and restore (gap-hunt 2026-11-24). Tested at the helper layer: the
// checkout path reaches it through checkBookingAvailability (called by
// saveBookingWithAvailability) and restore through
// findBookingConflictForRestore — both call sites are covered here
// without running a full Stripe/PayPal checkout.

const DAY = 86400000
const sod = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const rand = () => Math.random().toString(36).slice(2)

const ids = {
  users: [] as mongoose.Types.ObjectId[],
  cars: [] as mongoose.Types.ObjectId[],
  locations: [] as mongoose.Types.ObjectId[],
  values: [] as mongoose.Types.ObjectId[],
  bookings: [] as mongoose.Types.ObjectId[],
  schedules: [] as mongoose.Types.ObjectId[],
  settings: [] as mongoose.Types.ObjectId[],
}

const makeFixture = async (label: string, odometerKm = 10000) => {
  const supplier = await User.create({
    email: `gh08-supplier-${label}-${rand()}@test.bookcars.ma`,
    fullName: `GH-08 Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  ids.users.push(supplier._id)
  const driver = await User.create({
    email: `gh08-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `GH-08 Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  ids.users.push(driver._id)
  const value = await LocationValue.create({ language: 'en', value: `GH-08 Airport ${label}` })
  ids.values.push(value._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [value._id] })
  ids.locations.push(location._id)
  const car = await Car.create({
    name: `GH-08 car ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
    odometerKm,
  } as any)
  ids.cars.push(car._id)
  // One clock read for both ends: the rental is exactly 2 days.
  const now = Date.now()
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(now + 1 * DAY),
    to: new Date(now + 3 * DAY),
    status: bookcarsTypes.BookingStatus.Paid,
    lifecycle: bookcarsTypes.ContractLifecycle.Active,
    price: 1000,
    cancellation: false, amendments: false, theftProtection: false,
    collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
  } as any)
  ids.bookings.push(booking._id)
  return { supplier, driver, location, car, booking, now }
}

const makeSchedule = async (fixture: any, label: string, extra: Record<string, unknown>) => {
  const schedule = await MaintenanceSchedule.create({
    supplier: fixture.supplier._id, car: fixture.car._id,
    type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
    title: `GH-08 ${label}`,
    status: bookcarsTypes.MaintenanceScheduleStatus.Upcoming,
    ...extra,
  } as any)
  ids.schedules.push(schedule._id)
  return schedule
}

const setIncludedKmPerDay = async (fixture: any, includedKmPerDay: number) => {
  const settings = await AgencyReturnSettings.create({ supplier: fixture.supplier._id, includedKmPerDay })
  ids.settings.push(settings._id)
  return settings
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
})

afterAll(async () => {
  await databaseHelper.close()
})

afterEach(async () => {
  await MaintenanceSchedule.deleteMany({ _id: { $in: ids.schedules } })
  await AgencyReturnSettings.deleteMany({ _id: { $in: ids.settings } })
  await Booking.deleteMany({ _id: { $in: ids.bookings } })
  await Car.deleteMany({ _id: { $in: ids.cars } })
  await Location.deleteMany({ _id: { $in: ids.locations } })
  await LocationValue.deleteMany({ _id: { $in: ids.values } })
  await User.deleteMany({ _id: { $in: ids.users } })
  ids.schedules.length = 0
  ids.settings.length = 0
  ids.bookings.length = 0
  ids.cars.length = 0
  ids.locations.length = 0
  ids.values.length = 0
  ids.users.length = 0
})

describe('GH-08 — schedule due inside the rental window', () => {
  it('blocks checkout when the due date falls inside the rental (date leg)', async () => {
    const fixture = await makeFixture('date-leg')
    await makeSchedule(fixture, 'date-leg', { nextDueDate: new Date(fixture.now + 2 * DAY), intervalDays: 90 })
    const found = await findDueInWindowSchedule(
      fixture.supplier._id, fixture.car._id, new Date(fixture.booking.from), new Date(fixture.booking.to),
    )
    expect(found).not.toBeNull()
    expect(found!.trigger).toContain('falls inside the rental')
    await expect(checkBookingAvailability(fixture.booking, [fixture.booking._id]))
      .rejects.toThrow(DueInWindowMaintenanceError)
    await expect(checkBookingAvailability(fixture.booking, [fixture.booking._id]))
      .rejects.toThrow('due during the rental')
  })

  it('does not block checkout when the due date falls after the rental', async () => {
    const fixture = await makeFixture('date-after')
    await makeSchedule(fixture, 'date-after', { nextDueDate: new Date(fixture.now + 5 * DAY), intervalDays: 90 })
    const found = await findDueInWindowSchedule(
      fixture.supplier._id, fixture.car._id, new Date(fixture.booking.from), new Date(fixture.booking.to),
    )
    expect(found).toBeNull()
    await expect(checkBookingAvailability(fixture.booking, [fixture.booking._id])).resolves.toBeUndefined()
  })

  it('blocks checkout when the projected odometer reaches the next due mileage (mileage leg)', async () => {
    const fixture = await makeFixture('mileage-leg')
    // 2 rental days x 100 km/day from 10,000 km = 10,200 km projected;
    // the schedule is due at 10,150 km, inside the rental.
    await setIncludedKmPerDay(fixture, 100)
    await makeSchedule(fixture, 'mileage-leg', { nextDueMileage: 10150 })
    const found = await findDueInWindowSchedule(
      fixture.supplier._id, fixture.car._id, new Date(fixture.booking.from), new Date(fixture.booking.to),
    )
    expect(found).not.toBeNull()
    expect(found!.trigger).toContain('projected odometer 10200 km reaches next due 10150 km')
    await expect(checkBookingAvailability(fixture.booking, [fixture.booking._id]))
      .rejects.toThrow(DueInWindowMaintenanceError)
  })

  it('does not block checkout when the next due mileage is beyond the projected odometer', async () => {
    const fixture = await makeFixture('mileage-beyond')
    await setIncludedKmPerDay(fixture, 100)
    await makeSchedule(fixture, 'mileage-beyond', { nextDueMileage: 10500 })
    const found = await findDueInWindowSchedule(
      fixture.supplier._id, fixture.car._id, new Date(fixture.booking.from), new Date(fixture.booking.to),
    )
    expect(found).toBeNull()
    await expect(checkBookingAvailability(fixture.booking, [fixture.booking._id])).resolves.toBeUndefined()
  })

  it('skips the mileage leg when includedKmPerDay is null (unlimited km — no invented km/day)', async () => {
    const fixture = await makeFixture('mileage-unlimited')
    // No AgencyReturnSettings row at all: includedKmPerDay is null,
    // so a mileage-only schedule due at 10,150 km must NOT block.
    await makeSchedule(fixture, 'mileage-unlimited', { nextDueMileage: 10150 })
    const found = await findDueInWindowSchedule(
      fixture.supplier._id, fixture.car._id, new Date(fixture.booking.from), new Date(fixture.booking.to),
    )
    expect(found).toBeNull()
    await expect(checkBookingAvailability(fixture.booking, [fixture.booking._id])).resolves.toBeUndefined()
  })

  it('still throws OverdueMaintenanceError for a schedule that is already overdue now (control)', async () => {
    const fixture = await makeFixture('overdue-now')
    await makeSchedule(fixture, 'overdue-now', { nextDueDate: new Date(fixture.now - 1 * DAY), intervalDays: 90 })
    await expect(checkBookingAvailability(fixture.booking, [fixture.booking._id]))
      .rejects.toThrow(OverdueMaintenanceError)
  })

  it('reports a due-in-window schedule on restore', async () => {
    const fixture = await makeFixture('restore')
    await makeSchedule(fixture, 'restore', { nextDueDate: new Date(fixture.now + 2 * DAY), intervalDays: 90 })
    const conflict = await findBookingConflictForRestore(fixture.booking)
    expect(conflict.overdueSchedule).toBeDefined()
    expect(conflict.overdueSchedule!.title).toBe('GH-08 restore')
    expect(conflict.overdueSchedule!.trigger).toContain('falls inside the rental')
  })

  it('reports no conflict on restore when nothing is due in the window', async () => {
    const fixture = await makeFixture('restore-clean')
    await makeSchedule(fixture, 'restore-clean', { nextDueDate: new Date(fixture.now + 5 * DAY), intervalDays: 90 })
    const conflict = await findBookingConflictForRestore(fixture.booking)
    expect(conflict).toEqual({})
  })

  it('blocks checkout when the schedule is due on the pickup day at midnight (R2-B13)', async () => {
    const fixture = await makeFixture('b13-pickup-day')
    const pickupDay = sod(new Date(fixture.booking.from))
    await makeSchedule(fixture, 'b13-pickup-day', { nextDueDate: pickupDay, intervalDays: 90 })
    const found = await findDueInWindowSchedule(
      fixture.supplier._id, fixture.car._id, new Date(fixture.booking.from), new Date(fixture.booking.to),
    )
    expect(found).not.toBeNull()
    await expect(checkBookingAvailability(fixture.booking, [fixture.booking._id]))
      .rejects.toThrow(DueInWindowMaintenanceError)
  })

  it('blocks checkout when the schedule is due on the return day at midnight (R2-B13)', async () => {
    const fixture = await makeFixture('b13-return-day')
    const returnDay = sod(new Date(fixture.booking.to))
    await makeSchedule(fixture, 'b13-return-day', { nextDueDate: returnDay, intervalDays: 90 })
    const found = await findDueInWindowSchedule(
      fixture.supplier._id, fixture.car._id, new Date(fixture.booking.from), new Date(fixture.booking.to),
    )
    expect(found).not.toBeNull()
    await expect(checkBookingAvailability(fixture.booking, [fixture.booking._id]))
      .rejects.toThrow(DueInWindowMaintenanceError)
  })

  it('does not block when the schedule is due the day after return (R2-B13)', async () => {
    const fixture = await makeFixture('b13-day-after')
    const dayAfter = new Date(sod(new Date(fixture.booking.to)).getTime() + DAY)
    await makeSchedule(fixture, 'b13-day-after', { nextDueDate: dayAfter, intervalDays: 90 })
    const found = await findDueInWindowSchedule(
      fixture.supplier._id, fixture.car._id, new Date(fixture.booking.from), new Date(fixture.booking.to),
    )
    expect(found).toBeNull()
    await expect(checkBookingAvailability(fixture.booking, [fixture.booking._id])).resolves.toBeUndefined()
  })

  it('handover returns a schedule due on the pickup day at midnight (R2-B13)', async () => {
    const fixture = await makeFixture('b13-handover')
    const pickupDay = sod(new Date(fixture.booking.from))
    await makeSchedule(fixture, 'b13-handover', { nextDueDate: pickupDay, intervalDays: 90 })
    const blocking = await findBlockingScheduleForHandover(
      fixture.supplier._id, fixture.car._id, new Date(fixture.booking.from), new Date(fixture.booking.to),
    )
    expect(blocking).not.toBeNull()
    expect(blocking!.title).toBe('GH-08 b13-handover')
  })

})