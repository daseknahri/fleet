import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import { casablancaDayBounds, casablancaTodayStart, casablancaWeekBounds, wallDay } from '../src/utils/casablancaDate'
import { workOrderStaleDays } from '../src/utils/workOrderStale'
import * as authHelper from '../src/utils/authHelper'
import app from '../src/app'
import Booking from '../src/models/Booking'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// GH-16 — checkout / admin create / update refuse a past pickup date,
// same rule as amend (AMENDMENT_PAST_FROM): start of the current
// Africa/Casablanca wall day (R3-07). A pickup later today is allowed;
// an update that only extends `to` on a booking whose pickup already
// passed must not trip.

const DAY = 86400000
const HOUR = 3600000
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

let adminToken: string
let adminId: string
let supplierId: string
let driverId: string
let locationId: string
let carCheckoutId: string
let carPastId: string
let carSeedId: string
let bookingId: string
let pastBookingId: string

const makeCar = async (label: string, supplier: mongoose.Types.ObjectId, location: mongoose.Types.ObjectId) => {
  const car = await Car.create({
    name: `GH-16 car ${label}`, supplier, minimumAge: 21,
    locations: [location], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  return car
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh16-admin', email: `gh16-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  const supplier = await User.create({
    email: `gh16-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-16 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  supplierId = supplier._id.toString()
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `gh16-driver-${rand()}@test.bookcars.ma`, fullName: 'GH-16 Driver',
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  driverId = driver._id.toString()
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: 'GH-16 Casablanca Airport' })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  locationId = location._id.toString()

  const carSeed = await makeCar('seed', supplier._id, location._id)
  carSeedId = carSeed._id.toString()
  const carCheckout = await makeCar('checkout', supplier._id, location._id)
  carCheckoutId = carCheckout._id.toString()
  const carPast = await makeCar('past', supplier._id, location._id)
  carPastId = carPast._id.toString()

  const now = Date.now()
  const booking = await Booking.create({
    supplier: supplier._id, car: carSeed._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(now + 1 * DAY),
    to: new Date(now + 3 * DAY),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: 1000,
    cancellation: true,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD', mode: bookcarsTypes.CheckoutPaymentMode.Full,
      rentalTotal: 1000, depositAmount: 250,
      amountDueNow: 1000, amountDueNowInPaymentCurrency: 1000,
      quotedAt: new Date(),
    },
  } as any)
  bookingId = booking._id.toString()
  fixtureBookingIds.push(booking._id)

  // A Draft booking whose pickup already passed (for the extend-only-`to` case).
  // Snapshot-LESS on purpose: the checkout-terms lock (bookingController
  // :1712) refuses any date change on a booking with a real snapshot, so a
  // snapshot booking can never exercise the extend-`to` path via update.
  const pastBooking = await Booking.create({
    supplier: supplier._id, car: carPast._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(now - 2 * DAY),
    to: new Date(now + 2 * DAY),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: 1000,
    cancellation: true,
  } as any)
  pastBookingId = pastBooking._id.toString()
  fixtureBookingIds.push(pastBooking._id)
})

afterAll(async () => {
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-16 past pickup', () => {
  const checkoutPayload = (from: Date, to: Date) => ({
    booking: {
      supplier: supplierId,
      car: carCheckoutId,
      driver: driverId,
      pickupLocation: locationId,
      dropOffLocation: locationId,
      from,
      to,
      status: bookcarsTypes.BookingStatus.Pending,
      cancellation: true,
      amendments: true,
      theftProtection: false,
      collisionDamageWaiver: false,
      fullInsurance: false,
      price: 312,
      additionalDriver: false,
    },
    paymentMode: bookcarsTypes.CheckoutPaymentMode.PayLater,
    paymentGateway: bookcarsTypes.PaymentGateway.Stripe,
    currency: 'MAD',
  })

  test('checkout with from yesterday returns 400 CHECKOUT_PAST_FROM', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send(checkoutPayload(new Date(Date.now() - 1 * DAY), new Date(Date.now() + 1 * DAY)))
    expect(res.status).toBe(400)
    expect(res.text).toContain('CHECKOUT_PAST_FROM')
  })

  test('checkout with from later today passes the date guard', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send(checkoutPayload(new Date(Date.now() + 2 * HOUR), new Date(Date.now() + 2 * DAY)))
    expect(res.status).toBe(200)
    if (res.body.bookingId) {
      fixtureBookingIds.push(new mongoose.Types.ObjectId(res.body.bookingId))
    }
  })

  test('checkout with from tomorrow passes the date guard', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send(checkoutPayload(new Date(Date.now() + 5 * DAY), new Date(Date.now() + 7 * DAY)))
    expect(res.status).toBe(200)
    if (res.body.bookingId) {
      fixtureBookingIds.push(new mongoose.Types.ObjectId(res.body.bookingId))
    }
  })

  test('admin create with from yesterday returns 400 CREATE_PAST_FROM', async () => {
    const res = await request(app)
      .post('/api/create-booking')
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({
        booking: {
          supplier: supplierId,
          car: carCheckoutId,
          driver: driverId,
          pickupLocation: locationId,
          dropOffLocation: locationId,
          from: new Date(Date.now() - 1 * DAY),
          to: new Date(Date.now() + 1 * DAY),
          status: bookcarsTypes.BookingStatus.Pending,
          cancellation: true,
          amendments: true,
          theftProtection: false,
          collisionDamageWaiver: false,
          fullInsurance: false,
          price: 312,
          additionalDriver: false,
        },
      })
    expect(res.status).toBe(400)
    expect(res.text).toContain('CREATE_PAST_FROM')
  })

  test('update moving from to yesterday on a Draft booking returns 400 UPDATE_PAST_FROM', async () => {
    const res = await request(app)
      .put('/api/update-booking')
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({
        booking: {
          _id: bookingId,
          supplier: supplierId,
          car: carSeedId,
          driver: driverId,
          pickupLocation: locationId,
          dropOffLocation: locationId,
          from: new Date(Date.now() - 1 * DAY),
          to: new Date(Date.now() + 3 * DAY),
          status: bookcarsTypes.BookingStatus.Pending,
          cancellation: true,
          amendments: true,
          theftProtection: false,
          collisionDamageWaiver: false,
          fullInsurance: false,
          price: 1000,
          additionalDriver: false,
        },
      })
    expect(res.status).toBe(400)
    expect(res.text).toContain('UPDATE_PAST_FROM')
  })

  test('update extending only to on a booking whose from already passed does not trip', async () => {
    // Submit the EXACT stored `from` (millisecond-identical): the guard
    // keys on fromChanged, and a freshly-computed "2 days ago" would
    // differ by milliseconds and trip it.
    const stored = await Booking.findById(pastBookingId).lean()
    const res = await request(app)
      .put('/api/update-booking')
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({
        booking: {
          _id: pastBookingId,
          supplier: supplierId,
          car: carPastId,
          driver: driverId,
          pickupLocation: locationId,
          dropOffLocation: locationId,
          from: stored!.from,
          to: new Date(Date.now() + 4 * DAY),
          status: bookcarsTypes.BookingStatus.Pending,
          cancellation: true,
          amendments: true,
          theftProtection: false,
          collisionDamageWaiver: false,
          fullInsurance: false,
          price: 1000,
          additionalDriver: false,
        },
      })
    expect(res.status).toBe(200)
  })

  test('amend moving from to yesterday on a Draft booking returns 400 AMENDMENT_PAST_FROM', async () => {
    const res = await request(app)
      .post(`/api/bookings/${bookingId}/amend`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({
        from: new Date(Date.now() - 1 * DAY),
        to: new Date(Date.now() + 3 * DAY),
        reason: 'R3-07 test: move pickup to yesterday',
      })
    expect(res.status).toBe(400)
    expect(res.text).toContain('AMENDMENT_PAST_FROM')
  })

  test('amend moving from to tomorrow passes the past-pickup gate', async () => {
    const res = await request(app)
      .post(`/api/bookings/${bookingId}/amend`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({
        from: new Date(Date.now() + 1 * DAY),
        to: new Date(Date.now() + 3 * DAY),
        reason: 'R3-07 test: move pickup to tomorrow',
      })
    expect(res.status).toBe(200)
  })

  test('R5-07 dateBetween finds a booking at 00:30 local on the queried summer wall date', async () => {
    // Booking entirely inside the July 6 Casablanca wall day, entirely
    // before UTC midnight: 00:30–00:45 local (23:30–23:45Z July 5).
    // The old process-local setHours(0,0,0,0)/(23,59,59,999) window
    // [July 6 00:00Z, July 6 23:59:59Z] never matched it (its `to` is
    // before the window start); the true-midnight [23:00Z, 23:00Z)
    // window does. Control: a July 5 wall-day booking must not match.
    const wallBooking = await Booking.create({
      supplier: supplierId, car: carSeedId, driver: driverId,
      pickupLocation: locationId, dropOffLocation: locationId,
      from: new Date('2026-07-05T23:30:00Z'),
      to: new Date('2026-07-05T23:45:00Z'),
      status: bookcarsTypes.BookingStatus.Pending,
      lifecycle: bookcarsTypes.ContractLifecycle.Draft,
      price: 1000,
      cancellation: true,
    } as any)
    fixtureBookingIds.push(wallBooking._id)
    const controlBooking = await Booking.create({
      supplier: supplierId, car: carSeedId, driver: driverId,
      pickupLocation: locationId, dropOffLocation: locationId,
      from: new Date('2026-07-05T10:00:00Z'),
      to: new Date('2026-07-05T11:00:00Z'),
      status: bookcarsTypes.BookingStatus.Pending,
      lifecycle: bookcarsTypes.ContractLifecycle.Draft,
      price: 1000,
      cancellation: true,
    } as any)
    fixtureBookingIds.push(controlBooking._id)
    const res = await request(app)
      .post('/api/bookings/1/5/en')
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({
        suppliers: [supplierId],
        statuses: Object.values(bookcarsTypes.BookingStatus),
        filter: { dateBetween: '2026-07-06' },
      })
    expect(res.status).toBe(200)
    const rows = res.body[0].resultData as { _id: string }[]
    expect(rows.some((row) => row._id === wallBooking._id.toString())).toBe(true)
    expect(rows.some((row) => row._id === controlBooking._id.toString())).toBe(false)
  })
})

describe('R3-07 casablancaTodayStart', () => {
  test('July 2026, 00:30 Casablanca: wall day is Monday 07-06, not Sunday 07-05 (UTC)', () => {
    // 2026-07-05T23:30:00Z is Monday 00:30 in Casablanca (UTC+1) but
    // still Sunday 23:30 UTC — the old process-local start of day
    // would return 2026-07-05.
    // R5-07 — true local midnight, not UTC midnight of the wall date:
    // Monday July 6 starts at 23:00Z July 5 in summer (UTC+1).
    expect(casablancaTodayStart(new Date('2026-07-05T23:30:00Z')).toISOString()).toBe('2026-07-05T23:00:00.000Z')
  })

  test('July 2026, 01:30 Casablanca: same wall day as 00:30', () => {
    expect(casablancaTodayStart(new Date('2026-07-06T00:30:00Z')).toISOString()).toBe('2026-07-05T23:00:00.000Z')
  })

  test('November 2026 (Casablanca == UTC): wall day is the UTC day', () => {
    expect(casablancaTodayStart(new Date('2026-11-26T10:00:00Z')).toISOString()).toBe('2026-11-26T00:00:00.000Z')
  })

  test('default (no argument) returns true local midnight for the current wall day', () => {
    const start = casablancaTodayStart()
    // 00:00 on the Casablanca wall clock, not 00:00 UTC: in summer the
    // instant is 23:00Z the previous day.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(start)
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
    expect(get('hour')).toBe('00')
    expect(get('minute')).toBe('00')
    expect(get('second')).toBe('00')
    expect(start.getTime()).toBeLessThanOrEqual(Date.now())
    expect(Date.now() - start.getTime()).toBeLessThan(2 * DAY)
  })

  test('R5-07 July 2026, 00:30 Casablanca is NOT past-pickup: from is at/after true local midnight', () => {
    // 2026-07-05T23:30:00Z is 00:30 local on Monday July 6 — in the
    // future locally, but before the old UTC-midnight "today start"
    // (2026-07-06T00:00:00Z), which refused it as past-pickup.
    const from = new Date('2026-07-05T23:30:00Z')
    expect(from.getTime()).toBeGreaterThanOrEqual(casablancaTodayStart(from).getTime())
    expect(casablancaTodayStart(from).toISOString()).toBe('2026-07-05T23:00:00.000Z')
  })

  test('R5-07 casablancaDayBounds: a July wall day runs 23:00Z to 23:00Z next day', () => {
    const [start, end] = casablancaDayBounds(new Date('2026-07-06T12:00:00Z'))
    expect(start.toISOString()).toBe('2026-07-05T23:00:00.000Z')
    expect(end.toISOString()).toBe('2026-07-06T23:00:00.000Z')
    const [winterStart, winterEnd] = casablancaDayBounds(new Date('2026-11-26T10:00:00Z'))
    expect(winterStart.toISOString()).toBe('2026-11-26T00:00:00.000Z')
    expect(winterEnd.toISOString()).toBe('2026-11-27T00:00:00.000Z')
  })

  test('R5-07 casablancaWeekBounds: the wall week is Monday 00:00 local to next Monday 00:00 local', () => {
    const [start, end] = casablancaWeekBounds(new Date('2026-07-08T12:00:00Z'))
    expect(start.toISOString()).toBe('2026-07-05T23:00:00.000Z')
    expect(end.toISOString()).toBe('2026-07-12T23:00:00.000Z')
    const [winterStart, winterEnd] = casablancaWeekBounds(new Date('2026-11-25T12:00:00Z'))
    expect(winterStart.toISOString()).toBe('2026-11-23T00:00:00.000Z')
    expect(winterEnd.toISOString()).toBe('2026-11-30T00:00:00.000Z')
  })
})

describe('R5-09 wallDay (shared helper)', () => {
  test('wallDay and workOrderStaleDays agree on the shared July case', () => {
    // 2026-07-05T23:30:00Z is Monday 00:30 in Casablanca (UTC+1).
    expect(wallDay(new Date('2026-07-05T23:30:00Z'))).toBe('2026-07-06')
    expect(wallDay(new Date('2026-07-01T12:00:00Z'))).toBe('2026-07-01')
    // 2026-07-01 12:00Z (13:00 local) to 2026-07-08 23:30Z (July 9 00:30
    // local) is 8 wall days — asserted through both helpers.
    expect(workOrderStaleDays(new Date('2026-07-01T12:00:00Z'), new Date('2026-07-08T23:30:00Z'))).toBe(8)
    expect(wallDay(new Date('2026-07-08T23:30:00Z'))).toBe('2026-07-09')
  })
})
