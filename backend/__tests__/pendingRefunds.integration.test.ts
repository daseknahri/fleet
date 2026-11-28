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

// GH-11 — GET /api/rental-payments/pending-refunds: the list for
// money the agency owes back (wire refunds with no bank movement,
// `manual`-decision refunds). Same harness as the receivables tests:
// mocked providers, real Mongo-backed app, dynamic app import.

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
let supplierToken: string

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixturePaymentIds: mongoose.Types.ObjectId[] = []

let supplier: any
let driver: any
let location: any
let car: any

const B: Record<string, mongoose.Types.ObjectId> = {}

const makeCancelled = async (
  label: string,
  record: {
    reason: string, refundDecision: bookcarsTypes.CancelRefundDecision, refundStatus: bookcarsTypes.CancelRefundStatus,
    rentPaid: number, depositPaid: number, refundedRent: number, refundedDeposit: number,
    cancelledAt?: Date,
  },
) => {
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(Date.now() - 5 * 86400000), to: new Date(Date.now() - 2 * 86400000),
    status: bookcarsTypes.BookingStatus.Cancelled,
    lifecycle: bookcarsTypes.ContractLifecycle.Cancelled,
    price: record.rentPaid,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD', mode: bookcarsTypes.CheckoutPaymentMode.Full,
      rentalTotal: record.rentPaid, depositAmount: record.depositPaid,
      amountDueNow: record.rentPaid, amountDueNowInPaymentCurrency: record.rentPaid, quotedAt: new Date(),
    },
    cancellationRecord: {
      reason: record.reason,
      cancelledBy: new mongoose.Types.ObjectId(adminId),
      cancelledAt: record.cancelledAt || new Date('2026-11-20T10:00:00.000Z'),
      refundDecision: record.refundDecision,
      refundStatus: record.refundStatus,
      rentPaid: record.rentPaid,
      depositPaid: record.depositPaid,
      refundedRent: record.refundedRent,
      refundedDeposit: record.refundedDeposit,
      refundProviderReferences: [],
    },
  } as any)
  fixtureBookingIds.push(booking._id)
  B[label] = booking._id
  return booking
}

// Fixture payments are created directly: postRentalPayment refuses
// Cancelled bookings, but these rows represent money collected BEFORE
// the cancel (the real-world state of a pending refund).
const postPayment = async (bookingId: mongoose.Types.ObjectId, amount: number, purpose: bookcarsTypes.RentalPaymentPurpose, method = bookcarsTypes.RentalPaymentMethod.Card) => {
  const payment = await RentalPayment.create({
    supplier: supplier._id, booking: bookingId, date: new Date(), amount, currency: 'MAD',
    method, purpose, direction: bookcarsTypes.RentalPaymentDirection.Credit,
    source: bookcarsTypes.RentalPaymentSource.Stripe, providerReference: `pi_w31pr_${rand()}`,
    status: bookcarsTypes.RentalPaymentStatus.Posted,
  } as any)
  fixturePaymentIds.push(payment._id)
  return payment
}

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'w31pr-admin', email: `w31pr-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })
  stripeRefundCreate.mockResolvedValue({ id: 're_w31pr_test' })
  paypalRefundCapture.mockResolvedValue({})

  supplier = await User.create({
    email: `w31pr-supplier-${rand()}@test.bookcars.ma`, fullName: 'W3.1PR Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  supplierToken = await authHelper.encryptJWT({ id: supplier._id.toString() })
  driver = await User.create({
    email: `w31pr-driver-${rand()}@test.bookcars.ma`, fullName: 'W3.1PR Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `W3.1PR Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'W3.1PR car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)

  // R1 — manual refund pending: 500 rent (card) + 250 deposit (wire).
  await makeCancelled('manual', {
    reason: 'Customer asked to cancel', refundDecision: 'manual', refundStatus: 'pending',
    rentPaid: 500, depositPaid: 250, refundedRent: 0, refundedDeposit: 0,
  })
  await postPayment(B.manual, 500, bookcarsTypes.RentalPaymentPurpose.Rent, bookcarsTypes.RentalPaymentMethod.Card)
  await postPayment(B.manual, 250, bookcarsTypes.RentalPaymentPurpose.Deposit, bookcarsTypes.RentalPaymentMethod.BankTransfer)
  // R2 — already refunded: must not appear.
  await makeCancelled('refunded', {
    reason: 'Customer asked to cancel', refundDecision: 'full', refundStatus: 'refunded',
    rentPaid: 100, depositPaid: 0, refundedRent: 100, refundedDeposit: 0,
  })
  // R3 — pending on the record but nothing left to refund: skipped.
  await makeCancelled('zero', {
    reason: 'Customer asked to cancel', refundDecision: 'full', refundStatus: 'pending',
    rentPaid: 100, depositPaid: 0, refundedRent: 100, refundedDeposit: 0,
  })
  // R4 — full-decision wire refund whose reversal has no bank
  // movement: wireRefundPending must be true.
  await makeCancelled('wire', {
    reason: 'Customer asked to cancel', refundDecision: 'full', refundStatus: 'pending',
    rentPaid: 200, depositPaid: 0, refundedRent: 0, refundedDeposit: 0,
  })
  await postPayment(B.wire, 200, bookcarsTypes.RentalPaymentPurpose.Rent, bookcarsTypes.RentalPaymentMethod.BankTransfer)
  const reversal = await RentalPayment.create({
    supplier: supplier._id, booking: B.wire, date: new Date(), amount: 200, currency: 'MAD',
    method: bookcarsTypes.RentalPaymentMethod.BankTransfer, purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
    direction: bookcarsTypes.RentalPaymentDirection.Debit, source: bookcarsTypes.RentalPaymentSource.Adjustment,
    status: bookcarsTypes.RentalPaymentStatus.Posted, note: 'Cancellation refund of booking (wire, no bank session)',
  } as any)
  fixturePaymentIds.push(reversal._id)
})

afterAll(async () => {
  await RentalPayment.deleteMany({ _id: { $in: fixturePaymentIds } })
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

type PendingRow = {
  booking: { _id: string }
  amount: number
  currency: string
  method: string | null
  methods: Array<{ method: string, amount: number }>
  reason: string
  since?: string
  refundDecision: string
  wireRefundPending: boolean
  rentPaid: number
  depositPaid: number
  refundedRent: number
  refundedDeposit: number
}

describe('GH-11 — pending wire/manual refunds list', () => {
  it('lists pending refunds with booking, amount, method, reason, since', async () => {
    const res = await request(app).get('/api/rental-payments/pending-refunds').set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
    expect(res.body.total).toBe(950)
    expect(res.body.currency).toBe('MAD')
    const rows = res.body.rows as PendingRow[]
    const manual = rows.find((r) => r.booking._id === B.manual.toString())
    expect(manual).toBeDefined()
    expect(manual!.amount).toBe(750)
    // The refund most likely follows the largest posted leg (card 500).
    expect(manual!.method).toBe(bookcarsTypes.RentalPaymentMethod.Card)
    expect(manual!.methods).toHaveLength(2)
    expect(manual!.reason).toBe('Customer asked to cancel')
    expect(manual!.since).toBe('2026-11-20T10:00:00.000Z')
    expect(manual!.refundDecision).toBe('manual')
    expect(manual!.wireRefundPending).toBe(false)
    expect(manual!.rentPaid).toBe(500)
    expect(manual!.depositPaid).toBe(250)
    // Oldest first.
    expect(rows[0].booking._id).toBe(B.manual.toString())
  })

  it('flags a wire reversal with no bank movement as wire-pending', async () => {
    const res = await request(app).get('/api/rental-payments/pending-refunds').set(env.X_ACCESS_TOKEN, adminToken)
    const rows = res.body.rows as PendingRow[]
    const wire = rows.find((r) => r.booking._id === B.wire.toString())
    expect(wire).toBeDefined()
    expect(wire!.amount).toBe(200)
    expect(wire!.method).toBe(bookcarsTypes.RentalPaymentMethod.BankTransfer)
    expect(wire!.wireRefundPending).toBe(true)
  })

  it('excludes refunded bookings and zero-amount pendings', async () => {
    const res = await request(app).get('/api/rental-payments/pending-refunds').set(env.X_ACCESS_TOKEN, adminToken)
    const rows = res.body.rows as PendingRow[]
    const ids = rows.map((r) => r.booking._id)
    expect(ids).not.toContain(B.refunded.toString())
    expect(ids).not.toContain(B.zero.toString())
  })

  it('is agency-scoped for the supplier token', async () => {
    const res = await request(app).get('/api/rental-payments/pending-refunds').set(env.X_ACCESS_TOKEN, supplierToken)
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
  })

  it('requires a token', async () => {
    const res = await request(app).get('/api/rental-payments/pending-refunds')
    expect(res.status).toBe(403)
  })

  it('R6-33 a Posted debit nets against its method in the per-method split', async () => {
    // Own booking: 2000 cash rent leg, then a 500 manual refund
    // debit against it — the split must show cash 1500, not 2000.
    // The row amount stays the cancellation-record figure (2000):
    // row-amount staleness is B12 5c, carried, not this pack.
    await makeCancelled('r633-debit', {
      reason: 'Customer asked to cancel', refundDecision: 'manual', refundStatus: 'pending',
      rentPaid: 2000, depositPaid: 0, refundedRent: 0, refundedDeposit: 0,
      cancelledAt: new Date('2026-11-21T10:00:00.000Z'),
    })
    await postPayment(B['r633-debit'], 2000, bookcarsTypes.RentalPaymentPurpose.Rent, bookcarsTypes.RentalPaymentMethod.Cash)
    const debit = await RentalPayment.create({
      supplier: supplier._id, booking: B['r633-debit'], date: new Date(), amount: 500, currency: 'MAD',
      method: bookcarsTypes.RentalPaymentMethod.Cash, purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
      direction: bookcarsTypes.RentalPaymentDirection.Debit, source: bookcarsTypes.RentalPaymentSource.Manual,
      status: bookcarsTypes.RentalPaymentStatus.Posted, note: 'R6-33 manual refund debit',
    } as any)
    fixturePaymentIds.push(debit._id)
    const res = await request(app).get('/api/rental-payments/pending-refunds').set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(200)
    const rows = res.body.rows as PendingRow[]
    const row = rows.find((r) => r.booking._id === B['r633-debit'].toString())
    expect(row).toBeDefined()
    expect(row!.methods).toHaveLength(1)
    expect(row!.methods[0]).toEqual({ method: bookcarsTypes.RentalPaymentMethod.Cash, amount: 1500 })
    expect(row!.method).toBe(bookcarsTypes.RentalPaymentMethod.Cash)
    expect(row!.amount).toBe(2000)
  })
})
