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
import ContractCharge from '../src/models/ContractCharge'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// R2-B17 — dashboard `remaining` must net posted Charge credits
// (a charge settled from the kept deposit is paid, not remaining),
// exactly as collectionsSummary already does. Same harness as
// receivablesWave31: mocked providers against the real Mongo-backed
// app. NOTE: the pack's test note cites /api/reports/dashboard-summary;
// the real route is /api/dashboard/summary (reportRoutes.config.ts).
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

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixtureChargeIds: mongoose.Types.ObjectId[] = []

let supplier: any
let driver: any
let location: any
let car: any

const B: Record<string, mongoose.Types.ObjectId> = {}

const snapshot = (rentalTotal: number, depositAmount: number) => ({
  version: 1,
  baseCurrency: 'MAD',
  paymentCurrency: 'MAD',
  mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
  rentalTotal,
  depositAmount,
  amountDueNow: rentalTotal,
  amountDueNowInPaymentCurrency: rentalTotal,
  quotedAt: new Date(),
})

const makeBooking = async (label: string, price: number) => {
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: at(-1), to: at(2),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price,
    financialSnapshot: snapshot(price, 0),
  } as any)
  fixtureBookingIds.push(booking._id)
  B[label] = booking._id
  return booking
}

const postPayment = async (bookingId: mongoose.Types.ObjectId, amount: number, purpose: bookcarsTypes.RentalPaymentPurpose) => {
  const p = await RentalPayment.create({
    supplier: supplier._id, booking: bookingId, date: new Date(),
    amount, currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
    purpose, direction: bookcarsTypes.RentalPaymentDirection.Credit,
    source: bookcarsTypes.RentalPaymentSource.Manual,
    status: bookcarsTypes.RentalPaymentStatus.Posted,
  } as any)
  return p
}

const getDashboard = () => request(app).get('/api/dashboard/summary')
  .query({ supplier: supplier._id.toString(), from: dstr(-30), to: dstr(30) })
  .set(env.X_ACCESS_TOKEN, adminToken)
const getCollections = () => request(app).get('/api/rental-payments/collections-summary')
  .query({ supplier: supplier._id.toString() })
  .set(env.X_ACCESS_TOKEN, adminToken)

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'b17-admin', email: `b17-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  supplier = await User.create({
    email: `b17-supplier-${rand()}@test.bookcars.ma`, fullName: 'B17 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `b17-driver-${rand()}@test.bookcars.ma`, fullName: 'B17 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `B17 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'B17 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)

  // charged: rental 1000 + APPROVED charge 200, rent paid 1000,
  // Charge credit 200 -> remaining 0 (was 200 before R2-B17).
  await makeBooking('charged', 1000)
  const charge = await ContractCharge.create({
    supplier: supplier._id, booking: B.charged, type: bookcarsTypes.ContractChargeType.Damage,
    reason: 'R2-B17 test charge', amount: 200, currency: 'MAD', status: bookcarsTypes.ApprovalDecision.Approved,
  } as any)
  fixtureChargeIds.push(charge._id)
  await postPayment(B.charged, 1000, bookcarsTypes.RentalPaymentPurpose.Rent)
  await postPayment(B.charged, 200, bookcarsTypes.RentalPaymentPurpose.Charge)
  // overCredit: rental 500, rent paid 300, Charge credit 400 ->
  // remaining clamps at 0, never -200, and never spills elsewhere.
  await makeBooking('overCredit', 500)
  await postPayment(B.overCredit, 300, bookcarsTypes.RentalPaymentPurpose.Rent)
  await postPayment(B.overCredit, 400, bookcarsTypes.RentalPaymentPurpose.Charge)
  // plain: rental 300, rent paid 100 -> remaining 200 (regression lock).
  await makeBooking('plain', 300)
  await postPayment(B.plain, 100, bookcarsTypes.RentalPaymentPurpose.Rent)
})

afterAll(async () => {
  await ContractCharge.deleteMany({ _id: { $in: fixtureChargeIds } })
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('R2-B17 \u2014 dashboard Charge credits', () => {
  it('dashboard remaining nets posted Charge credits; collected and contractAmount unchanged', async () => {
    const res = await getDashboard()
    expect(res.status).toBe(200)
    // charged 1200/1000 -> 0, overCredit 500/300 -> 0, plain 300/100 -> 200.
    expect(res.body.contractAmount).toBe(2000)
    expect(res.body.collected).toBe(1400)
    expect(res.body.remaining).toBe(200)
  })

  it('collections summary ties out with the dashboard', async () => {
    const dash = await getDashboard()
    const coll = await getCollections()
    expect(coll.status).toBe(200)
    expect(coll.body.contractAmount).toBe(2000)
    expect(coll.body.collected).toBe(1400)
    expect(coll.body.remaining).toBe(200)
    expect(coll.body.bookingsCount).toBe(3)
    expect(coll.body.remaining).toBe(dash.body.remaining)
    expect(coll.body.contractAmount).toBe(dash.body.contractAmount)
    expect(coll.body.collected).toBe(dash.body.collected)
  })

  it('a live over-credit clamps remaining at zero, never negative', async () => {
    // Post a Charge credit that exceeds the plain booking's balance
    // (300 contract, 100 rent paid -> 200 left; credit 500).
    const extra = await postPayment(B.plain, 500, bookcarsTypes.RentalPaymentPurpose.Charge)
    try {
      const res = await getDashboard()
      expect(res.status).toBe(200)
      // charged 0 + overCredit 0 + plain max(0, 300-100-500) = 0.
      expect(res.body.remaining).toBe(0)
      expect(res.body.contractAmount).toBe(2000)
      expect(res.body.collected).toBe(1400)
    } finally {
      await RentalPayment.deleteOne({ _id: extra._id })
    }
  })
})
