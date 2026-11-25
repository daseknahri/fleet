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
import { postRentalPayment, refreshBookingPaymentStatus, reverseRentalPayment } from '../src/utils/ledger'

// GH-17 — isPayedInFull is derived from the ledger, never from the
// checkout payment mode. Modelled on receivablesWave31: mocked
// providers (no Stripe/PayPal credentials, no live money) against the
// real Mongo-backed app. The app is imported dynamically in beforeAll,
// AFTER the provider/mail mocks below are registered.

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

const makeBooking = async (opts: {
  from: Date, to: Date, price: number, deposit: number,
  lifecycle?: bookcarsTypes.ContractLifecycle, status?: bookcarsTypes.BookingStatus,
  mode?: bookcarsTypes.CheckoutPaymentMode,
}) => {
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: opts.from, to: opts.to,
    status: opts.status || bookcarsTypes.BookingStatus.Pending,
    lifecycle: opts.lifecycle || bookcarsTypes.ContractLifecycle.Draft,
    price: opts.price,
    financialSnapshot: snapshot(opts.price, opts.deposit, opts.mode),
  } as any)
  fixtureBookingIds.push(booking._id)
  return booking
}

const postPayment = async (bookingId: mongoose.Types.ObjectId, amount: number, purpose: bookcarsTypes.RentalPaymentPurpose) =>
  postRentalPayment({
    bookingId: bookingId.toString(),
    date: new Date(),
    amount,
    currency: 'MAD',
    method: bookcarsTypes.RentalPaymentMethod.Card,
    purpose,
    source: bookcarsTypes.RentalPaymentSource.Stripe,
    providerReference: `pi_gh17_${rand()}`,
    actorId: adminId,
  })

const storedFlag = async (bookingId: mongoose.Types.ObjectId) => {
  const row = await Booking.findById(bookingId).select('isPayedInFull').lean()
  return row?.isPayedInFull
}

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh17-admin', email: `gh17-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })
  stripeRefundCreate.mockResolvedValue({ id: 're_gh17_test' })
  paypalRefundCapture.mockResolvedValue({})

  supplier = await User.create({
    email: `gh17-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-17 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `gh17-driver-${rand()}@test.bookcars.ma`, fullName: 'GH-17 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `GH-17 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'GH-17 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
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

describe('GH-17 isPayedInFull from the ledger', () => {
  test('Deposit booking: flag false until the remaining rent posts, then true', async () => {
    const booking = await makeBooking({ from: at(1), to: at(3), price: 300, deposit: 100 })
    expect(await storedFlag(booking._id)).toBe(false)
    await postPayment(booking._id, 300, bookcarsTypes.RentalPaymentPurpose.Rent)
    expect(await storedFlag(booking._id)).toBe(true)
  })

  test('reversing the rent reopens the balance: flag becomes false again', async () => {
    const booking = await makeBooking({ from: at(1), to: at(3), price: 300, deposit: 100 })
    const payment = await postPayment(booking._id, 300, bookcarsTypes.RentalPaymentPurpose.Rent)
    expect(await storedFlag(booking._id)).toBe(true)
    await reverseRentalPayment({
      paymentId: payment._id,
      actorId: adminId,
      idempotencyKey: `gh17-reversal-${rand()}`,
    })
    expect(await storedFlag(booking._id)).toBe(false)
  })

  test('an approved charge outstanding reads false until the charge credit posts', async () => {
    const booking = await makeBooking({ from: at(1), to: at(3), price: 200, deposit: 0 })
    await postPayment(booking._id, 200, bookcarsTypes.RentalPaymentPurpose.Rent)
    expect(await storedFlag(booking._id)).toBe(true)
    const charge = await ContractCharge.create({
      supplier: supplier._id, booking: booking._id,
      type: bookcarsTypes.ContractChargeType.ExtraKm,
      reason: 'GH-17 extra kilometres', amount: 50, currency: 'MAD',
      status: bookcarsTypes.ApprovalDecision.Approved,
      requestedBy: adminId, decidedBy: adminId, decidedAt: new Date(),
    })
    fixtureChargeIds.push(charge._id)
    // The charge decision path refreshes the booking; here the charge was
    // seeded directly, so refresh explicitly — the flag must follow.
    await refreshBookingPaymentStatus(booking._id)
    expect(await storedFlag(booking._id)).toBe(false)
    await postPayment(booking._id, 50, bookcarsTypes.RentalPaymentPurpose.Charge)
    expect(await storedFlag(booking._id)).toBe(true)
  })

  test('GET /api/booking/:id derives the flag for a legacy row whose stored flag is false', async () => {
    const booking = await makeBooking({
      from: at(1), to: at(3), price: 200, deposit: 0,
      lifecycle: bookcarsTypes.ContractLifecycle.Confirmed, status: bookcarsTypes.BookingStatus.Paid,
    })
    await postPayment(booking._id, 200, bookcarsTypes.RentalPaymentPurpose.Rent)
    expect(await storedFlag(booking._id)).toBe(true)
    // Force the legacy lie: stored false while the ledger is fully paid.
    await Booking.updateOne({ _id: booking._id }, { $set: { isPayedInFull: false } })
    expect(await storedFlag(booking._id)).toBe(false)
    const res = await request(app)
      .get(`/api/booking/${booking._id.toString()}/en`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(200)
    expect(res.body.isPayedInFull).toBe(true)
    // The read-time derive does not rewrite the stored value.
    expect(await storedFlag(booking._id)).toBe(false)
  })
})
