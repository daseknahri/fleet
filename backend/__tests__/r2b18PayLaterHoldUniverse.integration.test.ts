import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// R2-B18 (option a, MAINTAINER decision) — the dictionary says
// unexpired checkout placeholders (expireAt set) are excluded from
// the dashboard/collections universe; the queries now apply it.
// Same harness as receivablesWave31: mocked providers against the
// real Mongo-backed app.
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
let adminToken: string
let adminId: string

const day = 86400000
const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const at = (days: number) => new Date(Date.now() + days * day)
const dstr = (days: number) => at(days).toISOString().slice(0, 10)
const endOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59) }

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

let supplier: any
let driver: any
let location: any
let car: any

const B: Record<string, mongoose.Types.ObjectId> = {}

const snapshot = (rentalTotal: number, depositAmount: number, mode: bookcarsTypes.CheckoutPaymentMode = bookcarsTypes.CheckoutPaymentMode.Deposit) => ({
  version: 1,
  baseCurrency: 'MAD',
  paymentCurrency: 'MAD',
  mode,
  rentalTotal,
  depositAmount,
  amountDueNow: rentalTotal,
  amountDueNowInPaymentCurrency: rentalTotal,
  quotedAt: new Date(),
})

const makeBooking = async (
  label: string,
  opts: {
    from: Date, to: Date, price: number, deposit: number,
    lifecycle?: bookcarsTypes.ContractLifecycle, status?: bookcarsTypes.BookingStatus,
    expireAt?: Date, mode?: bookcarsTypes.CheckoutPaymentMode,
  },
) => {
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: opts.from, to: opts.to,
    status: opts.status || bookcarsTypes.BookingStatus.Pending,
    lifecycle: opts.lifecycle || bookcarsTypes.ContractLifecycle.Draft,
    price: opts.price,
    financialSnapshot: snapshot(opts.price, opts.deposit, opts.mode),
    ...(opts.expireAt ? { expireAt: opts.expireAt } : {}),
  } as any)
  fixtureBookingIds.push(booking._id)
  B[label] = booking._id
  return booking
}

const getDashboard = () => request(app).get('/api/dashboard/summary')
  .query({ supplier: supplier._id.toString(), from: dstr(-30), to: dstr(30) })
  .set(env.X_ACCESS_TOKEN, adminToken)
const getCollections = () => request(app).get('/api/rental-payments/collections-summary')
  .query({ supplier: supplier._id.toString() })
  .set(env.X_ACCESS_TOKEN, adminToken)
const getOverdue = () => request(app).get('/api/rental-payments/overdue')
  .set(env.X_ACCESS_TOKEN, adminToken)

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'b18-admin', email: `b18-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  supplier = await User.create({
    email: `b18-supplier-${rand()}@test.bookcars.ma`, fullName: 'B18 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `b18-driver-${rand()}@test.bookcars.ma`, fullName: 'B18 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `B18 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'B18 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)

  // Confirmed contract, rental 1000, no expireAt.
  await makeBooking('confirmed', {
    from: at(1), to: at(3), price: 1000, deposit: 0,
    lifecycle: bookcarsTypes.ContractLifecycle.Confirmed, status: bookcarsTypes.BookingStatus.Pending,
  })
  // Live pay-later hold, rental 500, expireAt end of today.
  await makeBooking('hold', {
    from: at(1), to: at(3), price: 500, deposit: 0,
    expireAt: endOfToday(), mode: bookcarsTypes.CheckoutPaymentMode.PayLater,
  })
})

afterAll(async () => {
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('R2-B18 \u2014 pay-later hold universe', () => {
  it('a live pay-later hold is excluded from dashboard and collections', async () => {
    const dash = await getDashboard()
    expect(dash.status).toBe(200)
    expect(dash.body.contractAmount).toBe(1000)
    expect(dash.body.contracts).toBe(1)
    const coll = await getCollections()
    expect(coll.status).toBe(200)
    expect(coll.body.contractAmount).toBe(1000)
    expect(coll.body.bookingsCount).toBe(1)
  })

  it('overdue() still lists the hold (regression lock)', async () => {
    const res = await getOverdue()
    expect(res.status).toBe(200)
    const rows = res.body.rows as Array<{ booking: { _id: string }, outstandingBalance: number }>
    const row = rows.find((r) => r.booking._id === B.hold.toString())
    expect(row).toBeDefined()
    expect(row!.outstandingBalance).toBe(500)
  })

  it('an expired hold stays excluded', async () => {
    // The sweeper would void it in production; the filter excludes it
    // either way — the exclusion does not depend on the hold being
    // unexpired.
    await Booking.updateOne({ _id: B.hold }, { expireAt: at(-1) })
    const dash = await getDashboard()
    expect(dash.body.contractAmount).toBe(1000)
    expect(dash.body.contracts).toBe(1)
    const coll = await getCollections()
    expect(coll.body.contractAmount).toBe(1000)
    expect(coll.body.bookingsCount).toBe(1)
  })

  it('confirming the hold brings it back in', async () => {
    await Booking.updateOne(
      { _id: B.hold },
      { $set: { expireAt: null, lifecycle: bookcarsTypes.ContractLifecycle.Confirmed } },
    )
    const dash = await getDashboard()
    expect(dash.body.contractAmount).toBe(1500)
    expect(dash.body.contracts).toBe(2)
    const coll = await getCollections()
    expect(coll.body.contractAmount).toBe(1500)
    expect(coll.body.bookingsCount).toBe(2)
  })

  it('an admin Draft with no expireAt stays included (12c edge)', async () => {
    await makeBooking('draft', { from: at(5), to: at(7), price: 700, deposit: 0 })
    const dash = await getDashboard()
    expect(dash.body.contractAmount).toBe(2200)
    expect(dash.body.contracts).toBe(3)
    const coll = await getCollections()
    expect(coll.body.contractAmount).toBe(2200)
    expect(coll.body.bookingsCount).toBe(3)
  })
})
