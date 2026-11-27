import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// R6-20 — past-dated re-entry is refused (409) at all three points
// where a booking comes back as a live rental: confirm, reactivate
// (updateStatus Cancelled -> live), restore. The guard is
// booking.from < casablancaTodayStart() — the same wall-day basis as
// the past-pickup rule at create/checkout/update/amend. Future-dated
// re-entries still work, and the already-Confirmed safe retry still
// succeeds (idempotent).
const stripeRefundCreate: any = jest.fn()
const paypalGetOrder: any = jest.fn()
const paypalRefundCapture: any = jest.fn()
const mailSendMock: any = jest.fn(async () => ({}))

jest.unstable_mockModule('../src/payment/stripe.js', () => ({
  default: {
    checkout: { sessions: { retrieve: jest.fn() } },
    paymentIntents: { retrieve: jest.fn() },
    refunds: { create: stripeRefundCreate },
  },
}))
jest.unstable_mockModule('../src/payment/paypal.js', () => ({
  getOrder: paypalGetOrder,
  refundCapture: paypalRefundCapture,
}))
jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: mailSendMock,
}))

let app: any

const day = 86400000
const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

let supplier: any
let supplierToken: string
let driver: any
let location: any

const snapshot = (rentalTotal: number) => ({
  version: 1,
  baseCurrency: 'MAD',
  paymentCurrency: 'MAD',
  mode: bookcarsTypes.CheckoutPaymentMode.PayLater,
  rentalTotal,
  depositAmount: 0,
  amountDueNow: rentalTotal,
  amountDueNowInPaymentCurrency: rentalTotal,
  quotedAt: new Date(),
})

// Every booking gets its own car: updateStatus reactivates through
// saveBookingsWithAvailability, so two bookings on one car with
// overlapping windows 409 on availability, not on the guard.
const makeBooking = async (
  label: string,
  opts: {
    fromOffsetDays?: number,
    toOffsetDays?: number,
    status?: bookcarsTypes.BookingStatus,
    lifecycle?: bookcarsTypes.ContractLifecycle,
    trashed?: boolean,
  },
) => {
  const testCar = await Car.create({
    name: `R6-20 ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(testCar._id)
  const booking = await Booking.create({
    supplier: supplier._id, car: testCar._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(Date.now() + (opts.fromOffsetDays ?? 1) * day),
    to: new Date(Date.now() + (opts.toOffsetDays ?? 3) * day),
    status: opts.status || bookcarsTypes.BookingStatus.Pending,
    lifecycle: opts.lifecycle || bookcarsTypes.ContractLifecycle.Draft,
    price: 1000,
    cancellation: true,
    financialSnapshot: snapshot(1000),
    ...(opts.trashed ? { deletedAt: new Date() } : {}),
  } as any)
  fixtureBookingIds.push(booking._id)
  return booking
}

const confirmAs = (bookingId: string) =>
  request(app).post(`/api/bookings/${bookingId}/confirm-reservation`).set(env.X_ACCESS_TOKEN, supplierToken).send({})

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')

  supplier = await User.create({
    email: `r620-supplier-${rand()}@test.bookcars.ma`, fullName: 'R6-20 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  supplierToken = await authHelper.encryptJWT({ id: supplier._id.toString() })
  driver = await User.create({
    email: `r620-driver-${rand()}@test.bookcars.ma`, fullName: 'R6-20 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `R6-20 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
})

afterAll(async () => {
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})

describe('R6-20 — refuse past-dated re-entry', () => {
  it('confirming a pay-later hold whose pickup is yesterday → 409, stays Pending + unconfirmed', async () => {
    const booking = await makeBooking('confirm-past', { fromOffsetDays: -1, toOffsetDays: 2 })
    const res = await confirmAs(booking._id.toString())
    expect(res.status).toBe(409)
    expect(String(res.text)).toContain('CONFIRM_PAST_PICKUP')
    const stored = await Booking.findById(booking._id).lean()
    expect(stored?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    expect(stored?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Draft)
    expect(stored?.expireAt ?? null).toBeNull()
  })

  it('confirming a future-dated hold still works, and the already-Confirmed safe retry still succeeds', async () => {
    const booking = await makeBooking('confirm-future', { fromOffsetDays: 1, toOffsetDays: 3 })
    const res = await confirmAs(booking._id.toString())
    expect(res.status).toBe(200)
    const stored = await Booking.findById(booking._id).lean()
    expect(stored?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Confirmed)
    expect(stored?.expireAt).toBeNull()
    // Safe retry on the now-confirmed booking (its pickup is still in
    // the future here); then move its pickup into the past and retry
    // again — the idempotent re-confirm still succeeds.
    const again = await confirmAs(booking._id.toString())
    expect(again.status).toBe(200)
    await Booking.updateOne({ _id: booking._id }, { from: new Date(Date.now() - day) })
    const pastRetry = await confirmAs(booking._id.toString())
    expect(pastRetry.status).toBe(200)
  })

  it('reactivating a Cancelled booking with past dates → 409, stays Cancelled', async () => {
    const booking = await makeBooking('reactivate-past', {
      fromOffsetDays: -1, toOffsetDays: 2,
      status: bookcarsTypes.BookingStatus.Cancelled,
      lifecycle: bookcarsTypes.ContractLifecycle.Cancelled,
    })
    const res = await request(app).post('/api/update-booking-status')
      .set(env.X_ACCESS_TOKEN, supplierToken)
      .send({ ids: [booking._id.toString()], status: bookcarsTypes.BookingStatus.Pending, reason: 'Customer asked to reactivate' })
    expect(res.status).toBe(409)
    expect(String(res.text)).toContain('REACTIVATION_PAST_PICKUP')
    const stored = await Booking.findById(booking._id).lean()
    expect(stored?.status).toBe(bookcarsTypes.BookingStatus.Cancelled)
    expect(stored?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Cancelled)
  })

  it('reactivating a future-dated Cancelled booking still works', async () => {
    const booking = await makeBooking('reactivate-future', {
      fromOffsetDays: 1, toOffsetDays: 3,
      status: bookcarsTypes.BookingStatus.Cancelled,
      lifecycle: bookcarsTypes.ContractLifecycle.Cancelled,
    })
    const res = await request(app).post('/api/update-booking-status')
      .set(env.X_ACCESS_TOKEN, supplierToken)
      .send({ ids: [booking._id.toString()], status: bookcarsTypes.BookingStatus.Pending, reason: 'Customer asked to reactivate' })
    expect(res.status).toBe(200)
    const stored = await Booking.findById(booking._id).lean()
    expect(stored?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    expect(stored?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Draft)
    expect(stored?.expireAt).not.toBeNull()
  })

  it('restoring a trashed booking with past dates → 409, stays trashed', async () => {
    const booking = await makeBooking('restore-past', { fromOffsetDays: -1, toOffsetDays: 2, trashed: true })
    const res = await request(app).post('/api/restore-bookings')
      .set(env.X_ACCESS_TOKEN, supplierToken)
      .send({ ids: [booking._id.toString()] })
    expect(res.status).toBe(409)
    expect(String(res.text)).toContain('RESTORE_PAST_PICKUP')
    const stored = await Booking.findById(booking._id).lean()
    expect(stored?.deletedAt).not.toBeNull()
  })

  it('restoring a future-dated trashed booking still works', async () => {
    const booking = await makeBooking('restore-future', { fromOffsetDays: 1, toOffsetDays: 3, trashed: true })
    const res = await request(app).post('/api/restore-bookings')
      .set(env.X_ACCESS_TOKEN, supplierToken)
      .send({ ids: [booking._id.toString()] })
    expect(res.status).toBe(200)
    const stored = await Booking.findById(booking._id).lean()
    // applyRestore unsets deletedAt (undefined), it does not null it.
    expect(stored?.deletedAt).toBeUndefined()
  })
})
