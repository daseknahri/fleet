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
import ContractInspection from '../src/models/ContractInspection'
import Notification from '../src/models/Notification'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import { postRentalPayment, refreshBookingPaymentStatus } from '../src/utils/ledger'

// Wave 1.6 — the status must move DOWN when money becomes owed again.
// A Paid/PaidInFull booking that gains an approved charge (or a price
// increase) falls back to Deposit, so the label can never claim "paid"
// while money is owed. Same harness as cancelRefundWorkflow: mocked
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
let admin2Token: string
let admin2Id: string

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

const makeFixture = async (label: string) => {
  const supplier = await User.create({
    email: `w16-supplier-${label}-${rand()}@test.bookcars.ma`,
    fullName: `W1.6 Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `w16-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `W1.6 Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `W1.6 Casablanca Airport ${label}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: `W1.6 car ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(Date.now() + 1 * 86400000),
    to: new Date(Date.now() + 3 * 86400000),
    status: bookcarsTypes.BookingStatus.Paid,
    lifecycle: bookcarsTypes.ContractLifecycle.Confirmed,
    price: 1000,
    cancellation: true,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD', mode: bookcarsTypes.CheckoutPaymentMode.Full,
      rentalTotal: 1000, depositAmount: 250,
      amountDueNow: 1000,
      amountDueNowInPaymentCurrency: 1000,
      quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
  return { supplier, driver, location, car, booking }
}

const postRent = async (booking: any, amount: number) =>
  postRentalPayment({
    bookingId: booking._id.toString(),
    date: new Date(),
    amount,
    currency: 'MAD',
    method: bookcarsTypes.RentalPaymentMethod.Card,
    purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
    source: bookcarsTypes.RentalPaymentSource.Stripe,
    providerReference: `pi_w16_${rand()}`,
    actorId: adminId,
  })

const statusOf = async (bookingId: mongoose.Types.ObjectId) =>
  (await Booking.findById(bookingId).lean())?.status

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'w16-admin', email: `w16-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })
  // Second admin: decideCharge enforces four-eyes (the requester cannot
  // decide their own charge), so the HTTP decide test uses a different
  // decider than the creator.
  const admin2 = await User.create({
    fullName: 'w16-admin2', email: `w16-admin2-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  admin2Id = admin2._id.toString()
  admin2Token = await authHelper.encryptJWT({ id: admin2Id })
  stripeRefundCreate.mockResolvedValue({ id: 're_w16_test' })
  paypalRefundCapture.mockResolvedValue({})
})

afterAll(async () => {
  await User.deleteOne({ _id: adminId })
  await User.deleteOne({ _id: admin2Id })
  await databaseHelper.close()
})

afterEach(async () => {
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await ContractCharge.deleteMany({ booking: { $in: fixtureBookingIds } })
  await ContractInspection.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Notification.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  fixtureBookingIds.length = 0
  fixtureCarIds.length = 0
  fixtureLocationIds.length = 0
  fixtureLocationValueIds.length = 0
  fixtureUserIds.length = 0
  jest.resetAllMocks()
  mailSendMock.mockResolvedValue({})
  stripeRefundCreate.mockResolvedValue({ id: 're_w16_test' })
  paypalRefundCapture.mockResolvedValue({})
})

describe('Wave 1.6 — refreshBookingPaymentStatus downgrade', () => {
  it('a Paid booking with rent still owed downgrades to Deposit', async () => {
    const fixture = await makeFixture('downgrade-owes')
    const refresh = await refreshBookingPaymentStatus(fixture.booking._id)
    expect(refresh.updated).toBe(true)
    expect(refresh.status).toBe(bookcarsTypes.BookingStatus.Deposit)
    expect(refresh.outstandingBalance).toBe(1000)
    expect(await statusOf(fixture.booking._id)).toBe(bookcarsTypes.BookingStatus.Deposit)
  })

  it('a Paid booking with nothing outstanding stays Paid', async () => {
    const fixture = await makeFixture('stays-paid')
    await postRent(fixture.booking, 1000)
    const refresh = await refreshBookingPaymentStatus(fixture.booking._id)
    expect(refresh.updated).toBe(false)
    expect(refresh.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect(refresh.outstandingBalance).toBe(0)
    expect(await statusOf(fixture.booking._id)).toBe(bookcarsTypes.BookingStatus.Paid)
  })

  it('an approved charge on a fully-paid booking downgrades it to Deposit', async () => {
    const fixture = await makeFixture('downgrade-charge')
    await postRent(fixture.booking, 1000)
    await ContractCharge.create({
      supplier: fixture.supplier._id,
      booking: fixture.booking._id,
      type: bookcarsTypes.ContractChargeType.Fee,
      reason: 'Late return fee',
      amount: 150,
      currency: 'MAD',
      status: bookcarsTypes.ApprovalDecision.Approved,
      requestedBy: adminId,
      decidedBy: adminId,
    })
    const refresh = await refreshBookingPaymentStatus(fixture.booking._id)
    expect(refresh.updated).toBe(true)
    expect(refresh.status).toBe(bookcarsTypes.BookingStatus.Deposit)
    expect(refresh.outstandingBalance).toBe(150)
    expect(await statusOf(fixture.booking._id)).toBe(bookcarsTypes.BookingStatus.Deposit)
  })

  it('a Pending charge does not downgrade a fully-paid booking', async () => {
    const fixture = await makeFixture('pending-charge')
    await postRent(fixture.booking, 1000)
    await ContractCharge.create({
      supplier: fixture.supplier._id,
      booking: fixture.booking._id,
      type: bookcarsTypes.ContractChargeType.Fee,
      reason: 'Disputed fee, not yet decided',
      amount: 150,
      currency: 'MAD',
      status: bookcarsTypes.ApprovalDecision.Pending,
      requestedBy: adminId,
    })
    const refresh = await refreshBookingPaymentStatus(fixture.booking._id)
    expect(refresh.updated).toBe(false)
    expect(refresh.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect(refresh.outstandingBalance).toBe(0)
  })

  it('decideCharge approving a charge downgrades the booking via HTTP', async () => {
    const fixture = await makeFixture('downgrade-http')
    await postRent(fixture.booking, 1000)
    // Contract operations scope by supplier: the supplier token carries
    // it; an admin caller must pass ?supplier=. The charge is created
    // by the supplier and decided by a different admin (four-eyes: the
    // requester can never decide their own charge).
    const supplierToken = await authHelper.encryptJWT({ id: fixture.supplier._id.toString() })
    const created = await request(app)
      .post(`/api/contract-operations/${fixture.booking._id.toString()}/charges`)
      .set(env.X_ACCESS_TOKEN, supplierToken)
      .send({ type: bookcarsTypes.ContractChargeType.Damage, amount: 150, currency: 'MAD', reason: 'Bumper mark review' })
    expect(created.status).toBe(201)
    const decided = await request(app)
      .post(`/api/contract-operations/${fixture.booking._id.toString()}/charges/${created.body._id}/decide?supplier=${fixture.supplier._id.toString()}`)
      .set(env.X_ACCESS_TOKEN, admin2Token)
      .send({ decision: bookcarsTypes.ApprovalDecision.Approved, note: 'Reviewed with return inspection' })
    expect(decided.status).toBe(200)
    expect(await statusOf(fixture.booking._id)).toBe(bookcarsTypes.BookingStatus.Deposit)
  })
})
