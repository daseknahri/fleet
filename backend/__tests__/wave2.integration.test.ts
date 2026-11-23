import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import fs from 'fs'
import path from 'path'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import ContractCharge from '../src/models/ContractCharge'
import ContractInspection from '../src/models/ContractInspection'
import ContractSnapshot from '../src/models/ContractSnapshot'
import Notification from '../src/models/Notification'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import BankDetails from '../src/models/BankDetails'
import CashSession from '../src/models/CashSession'
import CashMovement from '../src/models/CashMovement'
import MaintenanceExpense from '../src/models/MaintenanceExpense'
import MaintenanceExpensePayment from '../src/models/MaintenanceExpensePayment'
import AgencyMembership from '../src/models/AgencyMembership'
import AgencyReturnSettings from '../src/models/AgencyReturnSettings'
import Approval from '../src/models/Approval'
import AdminAccessLog from '../src/models/AdminAccessLog'
import { postRentalPayment, reverseRentalPayment } from '../src/utils/ledger'
import { getContractReceivable } from '../src/utils/contractReceivable'
import { defaultDeposit } from '../src/utils/depositDefaults'
import MaintenanceSchedule from '../src/models/MaintenanceSchedule'

// Wave 2 â€” money-flow build (2.1, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 2.10,
// 2.11). Same harness as cancelRefundWorkflow (F3): mocked providers
// (no Stripe/PayPal credentials, no live money) against the real
// Mongo-backed app, imported dynamically in beforeAll AFTER the mocks.

const stripeRefundCreate: any = jest.fn()
const paypalGetOrder: any = jest.fn()
const paypalRefundCapture: any = jest.fn()
const paypalCreateOrder: any = jest.fn()
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
  createOrder: paypalCreateOrder,
}))
jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: mailSendMock,
}))

let app: any
let adminToken: string
let adminId: string

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixtureMembershipIds: mongoose.Types.ObjectId[] = []
const fixtureSnapshotFiles: string[] = []

type FixtureOpts = {
  status?: bookcarsTypes.BookingStatus
  lifecycle?: bookcarsTypes.ContractLifecycle
  rentalTotal?: number
  depositAmount?: number
  amountDueNow?: number
  cancellation?: boolean
  fromOffsetDays?: number
  toOffsetDays?: number
}

const makeFixture = async (label: string, opts: FixtureOpts = {}) => {
  const supplier = await User.create({
    email: `w2-supplier-${label}-${rand()}@test.bookcars.ma`,
    fullName: `W2 Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `w2-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `W2 Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `W2 Casablanca Airport ${label}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: `W2 car ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: opts.depositAmount ?? 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  const rentalTotal = opts.rentalTotal ?? 1000
  const depositAmount = opts.depositAmount ?? 250
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(Date.now() + (opts.fromOffsetDays ?? 1) * 86400000),
    to: new Date(Date.now() + (opts.toOffsetDays ?? 3) * 86400000),
    status: opts.status ?? bookcarsTypes.BookingStatus.Pending,
    lifecycle: opts.lifecycle ?? bookcarsTypes.ContractLifecycle.Draft,
    price: rentalTotal,
    cancellation: opts.cancellation ?? true,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD', mode: bookcarsTypes.CheckoutPaymentMode.Full,
      rentalTotal, depositAmount,
      amountDueNow: opts.amountDueNow ?? rentalTotal,
      amountDueNowInPaymentCurrency: opts.amountDueNow ?? rentalTotal,
      quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
  const supplierToken = await authHelper.encryptJWT({ id: supplier._id.toString() })
  const driverToken = await authHelper.encryptJWT({ id: driver._id.toString() })
  return { supplier, driver, location, car, booking, supplierToken, driverToken }
}

const makeStaff = async (supplier: any, role: bookcarsTypes.AgencyRole) => {
  const staff = await User.create({
    email: `w2-staff-${role}-${rand()}@test.bookcars.ma`, fullName: `W2 ${role}`,
    language: 'en', type: bookcarsTypes.UserType.Staff,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(staff._id)
  const membership = await AgencyMembership.create({
    supplier: supplier._id, user: staff._id, role, status: bookcarsTypes.AgencyMembershipStatus.Active,
  })
  fixtureMembershipIds.push(membership._id)
  const token = await authHelper.encryptJWT({ id: staff._id.toString() })
  return { staff, token }
}

const postPaid = async (booking: any, purpose: bookcarsTypes.RentalPaymentPurpose, amount: number, provider: 'stripe' | 'paypal', providerReference: string) => {
  const payment = await postRentalPayment({
    bookingId: booking._id.toString(),
    date: new Date(),
    amount,
    currency: 'MAD',
    method: bookcarsTypes.RentalPaymentMethod.Card,
    purpose,
    source: provider === 'stripe' ? bookcarsTypes.RentalPaymentSource.Stripe : bookcarsTypes.RentalPaymentSource.PayPal,
    providerReference,
    actorId: adminId,
  })
  return payment
}

const postManual = async (booking: any, purpose: bookcarsTypes.RentalPaymentPurpose, amount: number, method: bookcarsTypes.RentalPaymentMethod) => {
  const payment = await postRentalPayment({
    bookingId: booking._id.toString(),
    date: new Date(),
    amount,
    currency: 'MAD',
    method,
    purpose,
    source: bookcarsTypes.RentalPaymentSource.Manual,
    actorId: adminId,
  })
  return payment
}

// Wave 2 remainder — 2.2: the handover gate is balance-based, so a
// fixture that hands over must carry real money (status Paid alone no
// longer opens the gate). Rent + deposit at the fixture's snapshot
// amounts, via the counter (manual cash) path.
const payInFull = async (fixture: any) => {
  const rentalTotal = fixture.booking.financialSnapshot?.rentalTotal ?? 1000
  const depositAmount = fixture.booking.financialSnapshot?.depositAmount ?? 250
  await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, rentalTotal, bookcarsTypes.RentalPaymentMethod.Cash)
  await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Deposit, depositAmount, bookcarsTypes.RentalPaymentMethod.Cash)
}

const openSession = async (token: string, account: bookcarsTypes.CashAccountType, openingBalance = 0) => {
  const res = await request(app).post('/api/cash/sessions').set(env.X_ACCESS_TOKEN, token).send({
    account, openingBalance, openingDifferenceReason: 'W2 fixture',
  })
  expect(res.status).toBe(201)
  return res.body as { _id: string }
}

const confirmAs = (token: string, bookingId: string) =>
  request(app).post(`/api/bookings/${bookingId}/confirm-reservation`).set(env.X_ACCESS_TOKEN, token).send({})

const cancelAsAdmin = (bookingId: string, body: object) =>
  request(app).post(`/api/bookings/${bookingId}/cancel`).set(env.X_ACCESS_TOKEN, adminToken).send(body)

const ops = (fixture: any) => {
  const base = `/api/contract-operations/${fixture.booking._id.toString()}`
  const header = { [env.X_ACCESS_TOKEN]: fixture.supplierToken }
  const adminHeader = { [env.X_ACCESS_TOKEN]: adminToken }
  return {
    handover: (body: object = { occurredAt: new Date().toISOString(), odometer: 100, fuelLevel: 80 }) =>
      request(app).post(`${base}/handover`).set(header).send(body),
    return: (body: object = { occurredAt: new Date().toISOString(), odometer: 130, fuelLevel: 70 }) =>
      request(app).post(`${base}/return`).set(header).send(body),
    // decideCharge forbids self-approval: the supplier requested the
    // charge, so the decision comes from the admin.
    decideCharge: (chargeId: string, body: object) =>
      request(app).post(`${base}/charges/${chargeId}/decide`).set(adminHeader).send(body),
    createCharge: (body: object) => request(app).post(`${base}/charges`).set(header).send(body),
    disputeCharge: (chargeId: string, body: object) => request(app).post(`${base}/charges/${chargeId}/dispute`).set(header).send(body),
    snapshot: () => request(app).post(`${base}/snapshots`).set(header),
    complete: (body?: object) => request(app).post(`${base}/complete`).set(header).send(body || {}),
  }
}

// Paid booking, rent + deposit posted, handed over and returned.
const toReturnReview = async (fixture: any) => {
  const api = ops(fixture)
  const handed = await api.handover()
  expect(handed.status).toBe(201)
  const returned = await api.return()
  expect(returned.status).toBe(201)
  return api
}

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'w2-admin', email: `w2-admin-${rand()}@test.bookcars.ma`, language: 'en',
    type: bookcarsTypes.UserType.Admin, password: passwordHash
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })
  stripeRefundCreate.mockResolvedValue({ id: 're_w2_test' })
  paypalRefundCapture.mockResolvedValue({})
  paypalCreateOrder.mockResolvedValue('ORDER-NEW')
})

afterAll(async () => {
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

afterEach(async () => {
  for (const file of fixtureSnapshotFiles) {
    try { fs.unlinkSync(path.resolve(env.CDN_CONTRACTS, file)) } catch { /* already gone */ }
  }
  fixtureSnapshotFiles.length = 0
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await ContractCharge.deleteMany({ booking: { $in: fixtureBookingIds } })
  await ContractInspection.deleteMany({ booking: { $in: fixtureBookingIds } })
  await ContractSnapshot.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Notification.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await AgencyMembership.deleteMany({ _id: { $in: fixtureMembershipIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await BankDetails.deleteMany({})
  await CashMovement.deleteMany({})
  await CashSession.deleteMany({})
  await MaintenanceExpensePayment.deleteMany({})
  await MaintenanceExpense.deleteMany({})
  await MaintenanceSchedule.deleteMany({ car: { $in: fixtureCarIds } })
  await AgencyReturnSettings.deleteMany({})
  await Approval.deleteMany({})
  await AdminAccessLog.deleteMany({})
  fixtureBookingIds.length = 0
  fixtureCarIds.length = 0
  fixtureLocationIds.length = 0
  fixtureLocationValueIds.length = 0
  fixtureUserIds.length = 0
  fixtureMembershipIds.length = 0
  jest.resetAllMocks()
  mailSendMock.mockResolvedValue({})
  stripeRefundCreate.mockResolvedValue({ id: 're_w2_test' })
  paypalRefundCapture.mockResolvedValue({})
  paypalCreateOrder.mockResolvedValue('ORDER-NEW')
})

describe('W2 2.1 â€” confirm reservation', () => {
  it('confirms a Pending Draft hold as admin: lifecycle Confirmed, expireAt cleared, by/at stamped; second confirm is a safe retry', async () => {
    const fixture = await makeFixture('confirm-admin')
    const res = await confirmAs(adminToken, fixture.booking._id.toString())
    expect(res.status).toBe(200)
    expect(res.body.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Confirmed)
    expect(res.body.expireAt).toBeNull()
    expect(res.body.confirmedBy).toBe(adminId)
    expect(res.body.confirmedAt).toBeTruthy()
    const again = await confirmAs(adminToken, fixture.booking._id.toString())
    expect(again.status).toBe(200)
    expect(again.body.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Confirmed)
  })

  it('the confirm response carries the populated booking (GA5: the workspace crashed on the bare-id doc)', async () => {
    const fixture = await makeFixture('confirm-populated')
    const res = await confirmAs(adminToken, fixture.booking._id.toString())
    expect(res.status).toBe(200)
    expect(res.body.car).toMatchObject({ _id: fixture.car._id.toString(), name: fixture.car.name })
    expect(res.body.car.supplier).toMatchObject({ _id: fixture.supplier._id.toString() })
    expect(res.body.driver).toMatchObject({ _id: fixture.driver._id.toString(), fullName: fixture.driver.fullName })
    expect(res.body.supplier).toMatchObject({ _id: fixture.supplier._id.toString(), fullName: fixture.supplier.fullName })
  })

  it('a Manager staff confirms, a CounterAgent staff gets 403', async () => {
    const fixture = await makeFixture('confirm-roles')
    const manager = await makeStaff(fixture.supplier, bookcarsTypes.AgencyRole.Manager)
    const ok = await confirmAs(manager.token, fixture.booking._id.toString())
    expect(ok.status).toBe(200)
    expect(ok.body.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Confirmed)
    const fixture2 = await makeFixture('confirm-counter')
    const counter = await makeStaff(fixture2.supplier, bookcarsTypes.AgencyRole.CounterAgent)
    const denied = await confirmAs(counter.token, fixture2.booking._id.toString())
    expect(denied.status).toBe(403)
  })

  it('refuses to confirm a Cancelled booking', async () => {
    const fixture = await makeFixture('confirm-cancelled')
    const cancelled = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'none' })
    expect(cancelled.status).toBe(200)
    const res = await confirmAs(adminToken, fixture.booking._id.toString())
    expect(res.status).toBe(409)
  })

  it('watchlist lists the confirmed unpaid hold, drops the fully-paid one, and flags the legacy Reserved row', async () => {
    const unpaid = await makeFixture('watch-unpaid')
    await confirmAs(adminToken, unpaid.booking._id.toString())
    const paid = await makeFixture('watch-paid')
    await confirmAs(adminToken, paid.booking._id.toString())
    await postPaid(paid.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, 'stripe', 'pi_w2_watch_paid')
    // Legacy Reserved row, created 3 days ago: its 48h confirm-or-cancel
    // deadline is already past.
    const legacy = await Booking.create({
      supplier: unpaid.supplier._id, car: unpaid.car._id, driver: unpaid.driver._id,
      pickupLocation: unpaid.location._id, dropOffLocation: unpaid.location._id,
      from: new Date(Date.now() + 86400000), to: new Date(Date.now() + 3 * 86400000),
      status: bookcarsTypes.BookingStatus.Reserved, lifecycle: bookcarsTypes.ContractLifecycle.Draft,
      price: 1000, cancellation: true,
      financialSnapshot: {
        version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD', mode: bookcarsTypes.CheckoutPaymentMode.Full,
        rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000, amountDueNowInPaymentCurrency: 1000, quotedAt: new Date(),
      },
      createdAt: new Date(Date.now() - 3 * 86400000),
    } as any)
    fixtureBookingIds.push(legacy._id)
    const res = await request(app).post('/api/confirmed-unpaid-bookings/1/30/en').set(env.X_ACCESS_TOKEN, adminToken).send({ suppliers: [unpaid.supplier._id.toString()] })
    expect(res.status).toBe(200)
    const rows = res.body[0].resultData as any[]
    const unpaidRow = rows.find((row) => row.booking._id === unpaid.booking._id.toString())
    expect(unpaidRow).toBeDefined()
    expect(unpaidRow.outstandingBalance).toBe(1000)
    expect(unpaidRow.depositDue).toBe(250)
    expect(unpaidRow.legacyReserved).toBe(false)
    expect(rows.find((row) => row.booking._id === paid.booking._id.toString())).toBeUndefined()
    const legacyRow = rows.find((row) => row.booking._id === legacy._id.toString())
    expect(legacyRow).toBeDefined()
    expect(legacyRow.legacyReserved).toBe(true)
    expect(legacyRow.confirmBy).toBeTruthy()
  })
})

describe('W2 2.5 â€” Reserved closed as a staff status', () => {
  it('create with Reserved returns 400', async () => {
    const fixture = await makeFixture('reserved-create')
    const res = await request(app).post('/api/create-booking').set(env.X_ACCESS_TOKEN, adminToken).send({
      booking: {
        supplier: fixture.supplier._id.toString(), car: fixture.car._id.toString(), driver: fixture.driver._id.toString(),
        pickupLocation: fixture.location._id.toString(), dropOffLocation: fixture.location._id.toString(),
        from: fixture.booking.from, to: fixture.booking.to,
        status: bookcarsTypes.BookingStatus.Reserved, price: 1000,
        cancellation: false, amendments: false, theftProtection: false,
        collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
      },
    })
    expect(res.status).toBe(400)
  })

  it('updateStatus to Reserved returns 400 and update to Reserved returns 400', async () => {
    const fixture = await makeFixture('reserved-status')
    const byStatus = await request(app).post('/api/update-booking-status').set(env.X_ACCESS_TOKEN, adminToken).send({
      ids: [fixture.booking._id.toString()], status: bookcarsTypes.BookingStatus.Reserved, suppliers: [fixture.supplier._id.toString()],
    })
    expect(byStatus.status).toBe(400)
    const byUpdate = await request(app).put('/api/update-booking').set(env.X_ACCESS_TOKEN, adminToken).send({
      booking: {
        _id: fixture.booking._id.toString(), supplier: fixture.supplier._id.toString(), car: fixture.car._id.toString(),
        driver: fixture.driver._id.toString(), pickupLocation: fixture.location._id.toString(), dropOffLocation: fixture.location._id.toString(),
        from: fixture.booking.from, to: fixture.booking.to,
        status: bookcarsTypes.BookingStatus.Reserved, price: 1000,
        cancellation: true, amendments: false, theftProtection: false,
        collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
      },
    })
    expect(byUpdate.status).toBe(400)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Pending)
  })
})

describe('W2 2.6 â€” journal = close formula, bank linkage, per-agency RIB', () => {
  it('a reversed cash deposit lands in the depositRefunds bucket and the expected balance nets it', async () => {
    const fixture = await makeFixture('journal-refund', { status: bookcarsTypes.BookingStatus.Paid })
    // Post before the session opens: a posted cash payment auto-links to
    // an open session, so linking afterwards would 409 as already linked.
    const deposit = await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Deposit, 250, bookcarsTypes.RentalPaymentMethod.Cash)
    const session = await openSession(fixture.supplierToken, bookcarsTypes.CashAccountType.Cash, 0)
    const linked = await request(app).post(`/api/rental-payments/${deposit._id.toString()}/link-cash-session`).set(env.X_ACCESS_TOKEN, fixture.supplierToken).send({ cashSessionId: session._id })
    expect(linked.status).toBe(200)
    await reverseRentalPayment({ paymentId: deposit._id.toString(), idempotencyKey: 'w2-journal-rev-1', actorId: adminId })
    const journal = await request(app).get(`/api/cash/journal?sessionId=${session._id}`).set(env.X_ACCESS_TOKEN, fixture.supplierToken)
    expect(journal.status).toBe(200)
    expect(journal.body.totals.deposits).toBe(250)
    expect(journal.body.totals.depositRefunds).toBe(250)
    expect(journal.body.totals.expectedBalance).toBe(0)
    const closed = await request(app).post(`/api/cash/sessions/${session._id}/close`).set(env.X_ACCESS_TOKEN, fixture.supplierToken).send({ countedClosingBalance: 0, closingNote: 'W2 journal check' })
    expect(closed.status).toBe(200)
    expect(closed.body.expectedClosingBalance).toBe(journal.body.totals.expectedBalance)
  })

  it('bank details are scoped per agency: a supplier sees only its own RIB, admin picks by ?supplier=', async () => {
    const a = await makeFixture('rib-a')
    const b = await makeFixture('rib-b')
    const rib = { accountHolder: 'W2 RIB A', bankName: 'W2 Bank', iban: 'DE89370400440532013000', swiftBic: 'DEUTDEFF', showBankDetailsPage: true }
    const upserted = await request(app).post('/api/upsert-bank-details').set(env.X_ACCESS_TOKEN, a.supplierToken).send(rib)
    expect(upserted.status).toBe(200)
    expect(upserted.body.supplier?.toString() || upserted.body.supplier).toBe(a.supplier._id.toString())
    const own = await request(app).get('/api/bank-details').set(env.X_ACCESS_TOKEN, a.supplierToken)
    expect(own.status).toBe(200)
    expect(own.body.iban).toBe('DE89370400440532013000')
    const other = await request(app).get('/api/bank-details').set(env.X_ACCESS_TOKEN, b.supplierToken)
    expect(other.status).toBe(200)
    expect(other.body).toBeNull()
    const adminGlobal = await request(app).get('/api/bank-details').set(env.X_ACCESS_TOKEN, adminToken)
    expect(adminGlobal.status).toBe(200)
    expect(adminGlobal.body).toBeNull()
    const adminScoped = await request(app).get(`/api/bank-details?supplier=${a.supplier._id.toString()}`).set(env.X_ACCESS_TOKEN, adminToken)
    expect(adminScoped.status).toBe(200)
    expect(adminScoped.body.iban).toBe('DE89370400440532013000')
  })

  it('linkBankSession links a posted wire payment into an open Bank session, 404s without one, 409s on relink', async () => {
    const fixture = await makeFixture('link-bank', { status: bookcarsTypes.BookingStatus.Paid })
    const payment = await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Deposit, 250, bookcarsTypes.RentalPaymentMethod.BankTransfer)
    const missing = await request(app).post(`/api/rental-payments/${payment._id.toString()}/link-bank-session`).set(env.X_ACCESS_TOKEN, fixture.supplierToken).send({ bankSessionId: oid().toString() })
    expect(missing.status).toBe(404)
    const session = await openSession(fixture.supplierToken, bookcarsTypes.CashAccountType.Bank, 0)
    const linked = await request(app).post(`/api/rental-payments/${payment._id.toString()}/link-bank-session`).set(env.X_ACCESS_TOKEN, fixture.supplierToken).send({ bankSessionId: session._id })
    expect(linked.status).toBe(200)
    const again = await request(app).post(`/api/rental-payments/${payment._id.toString()}/link-bank-session`).set(env.X_ACCESS_TOKEN, fixture.supplierToken).send({ bankSessionId: session._id })
    expect(again.status).toBe(409)
    const stored = await RentalPayment.findById(payment._id).lean()
    expect(stored?.bankSession?.toString()).toBe(session._id)
  })
})

describe('W2 2.3 â€” cancel + refund as one action (core)', () => {
  it('refund plan shows rent/deposit/outstanding/total and the per-method split before confirm', async () => {
    const fixture = await makeFixture('refund-plan', { status: bookcarsTypes.BookingStatus.Paid })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, 'stripe', 'pi_w2_plan_rent')
    await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Deposit, 250, bookcarsTypes.RentalPaymentMethod.Cash)
    const res = await request(app).get(`/api/bookings/${fixture.booking._id.toString()}/refund-plan`).set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(200)
    expect(res.body.rentPaid).toBe(1000)
    expect(res.body.depositPaid).toBe(250)
    expect(res.body.outstandingBalance).toBe(0)
    expect(res.body.totalRefund).toBe(1250)
    expect(res.body.approvalRequired).toBe(false)
    expect(res.body.cashSessionOpen).toBe(false)
    expect(res.body.bankSessionOpen).toBe(false)
    const byMethod = res.body.byMethod as Array<{ method: string, amount: number }>
    expect(byMethod.find((row) => row.method === bookcarsTypes.RentalPaymentMethod.Card)?.amount).toBe(1000)
    expect(byMethod.find((row) => row.method === bookcarsTypes.RentalPaymentMethod.Cash)?.amount).toBe(250)
  })

  it('a refund at or above 10,000 MAD needs approval first: 409, then 200 once approved', async () => {
    const fixture = await makeFixture('refund-gate', { status: bookcarsTypes.BookingStatus.Paid, rentalTotal: 12000, amountDueNow: 12000 })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 12000, 'stripe', 'pi_w2_gate_rent')
    const refused = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled a big booking', refundDecision: 'full' })
    expect(refused.status).toBe(409)
    expect(String(refused.text)).toContain('CANCEL_APPROVAL_REQUIRED')
    const stillPaid = await Booking.findById(fixture.booking._id).lean()
    expect(stillPaid?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    const gate = await Approval.findOne({ subject: fixture.booking._id.toString(), subjectType: 'booking-cancel' }).lean()
    expect(gate).not.toBeNull()
    expect(gate?.amount).toBe(12000)
    await Approval.updateOne({ _id: gate!._id }, { status: bookcarsTypes.ApprovalDecision.Approved, amount: 12000 })
    const done = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled a big booking', refundDecision: 'full' })
    expect(done.status).toBe(200)
    expect(done.body.refund.status).toBe('refunded')
  })

  it('a cash refund with no open cash session refuses the whole cancel; with a session it refunds', async () => {
    const fixture = await makeFixture('refund-cash', { status: bookcarsTypes.BookingStatus.Paid })
    await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, bookcarsTypes.RentalPaymentMethod.Cash)
    const refused = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'full' })
    expect(refused.status).toBe(409)
    expect(String(refused.text)).toContain('CANCEL_NO_CASH_SESSION')
    const stillPaid = await Booking.findById(fixture.booking._id).lean()
    expect(stillPaid?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    await openSession(fixture.supplierToken, bookcarsTypes.CashAccountType.Cash, 0)
    const done = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'full' })
    expect(done.status).toBe(200)
    expect(done.body.refund.status).toBe('refunded')
  })

  it('a wire refund with no open Bank session still cancels but surfaces wireRefundPending', async () => {
    const fixture = await makeFixture('refund-wire', { status: bookcarsTypes.BookingStatus.Paid })
    await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, bookcarsTypes.RentalPaymentMethod.BankTransfer)
    const res = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'full' })
    expect(res.status).toBe(200)
    expect(res.body.refund.status).toBe('pending')
    expect(res.body.refund.wireRefundPending).toBe(true)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Cancelled)
  })
})

describe('W2 2.4 â€” deposit settlement posts in complete()', () => {
  const settleFixture = async (label: string) => {
    const fixture = await makeFixture(label, { status: bookcarsTypes.BookingStatus.Paid })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, 'stripe', `pi_w2_settle_${label}`)
    await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Deposit, 250, bookcarsTypes.RentalPaymentMethod.Cash)
    await openSession(fixture.supplierToken, bookcarsTypes.CashAccountType.Cash, 0)
    const api = await toReturnReview(fixture)
    const charge = await api.createCharge({ type: bookcarsTypes.ContractChargeType.ExtraKm, amount: 100, currency: 'MAD', reason: 'Extra kilometres driven' })
    expect(charge.status).toBe(201)
    const decided = await api.decideCharge(charge.body._id, { decision: bookcarsTypes.ApprovalDecision.Approved, note: 'Confirmed at return' })
    expect(decided.status).toBe(200)
    const snapshot = await api.snapshot()
    expect(snapshot.status).toBe(201)
    fixtureSnapshotFiles.push(snapshot.body.pdfFile)
    return { fixture, api, chargeId: charge.body._id as string }
  }

  it('posts the return reversal and the kept Charge credit, stamps settledAt and the settlement payment ids', async () => {
    const { fixture, api, chargeId } = await settleFixture('settle-ok')
    const res = await api.complete({ depositSettlement: { heldAmount: 250, keptAmount: 100, returnedAmount: 150, method: 'cash', note: 'W2 settlement' } })
    expect(res.status).toBe(200)
    expect(res.body.booking.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Completed)
    const payments = await RentalPayment.find({ booking: fixture.booking._id }).lean()
    const kept = payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Charge)
    expect(kept).toBeDefined()
    expect(kept?.amount).toBe(100)
    expect(kept?.status).toBe(bookcarsTypes.RentalPaymentStatus.Posted)
    const returned = payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit && p.direction === bookcarsTypes.RentalPaymentDirection.Debit)
    expect(returned).toBeDefined()
    expect(returned?.amount).toBe(150)
    const charge = await ContractCharge.findById(chargeId).lean()
    expect(charge?.settledAt).toBeTruthy()
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.depositSettlement?.returnedPaymentIds?.length).toBe(1)
    expect(booking?.depositSettlement?.keptPaymentIds?.length).toBe(1)
    expect(booking?.depositSettlement?.keptPaymentIds?.[0]?.toString()).toBe(kept?._id.toString())
  })

  it('refuses a settlement whose held amount does not match the posted deposits', async () => {
    const { api } = await settleFixture('settle-held')
    const res = await api.complete({ depositSettlement: { heldAmount: 999, keptAmount: 100, returnedAmount: 899, method: 'cash' } })
    expect(res.status).toBe(409)
  })

  it('refuses a settlement whose kept amount does not match the approved unsettled charges', async () => {
    const { api } = await settleFixture('settle-kept')
    const res = await api.complete({ depositSettlement: { heldAmount: 250, keptAmount: 50, returnedAmount: 200, method: 'cash' } })
    expect(res.status).toBe(409)
  })
})

describe('W2 2.8 â€” contract guards', () => {
  it('createCharge on a Cancelled booking returns 404', async () => {
    const fixture = await makeFixture('c6-charge', { status: bookcarsTypes.BookingStatus.Paid })
    await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Cancelled first', refundDecision: 'none' })
    const api = ops(fixture)
    const res = await api.createCharge({ type: bookcarsTypes.ContractChargeType.Fee, amount: 50, currency: 'MAD', reason: 'Late fee' })
    expect(res.status).toBe(404)
  })

  it('a snapshot while a charge dispute is open returns 409', async () => {
    const fixture = await makeFixture('c18-snap', { status: bookcarsTypes.BookingStatus.Paid })
    await payInFull(fixture)
    const api = await toReturnReview(fixture)
    const charge = await api.createCharge({ type: bookcarsTypes.ContractChargeType.Damage, amount: 150, currency: 'MAD', reason: 'Bumper mark review' })
    expect(charge.status).toBe(201)
    const raised = await api.disputeCharge(charge.body._id, { reason: 'The mark was already there at handover' })
    expect(raised.status).toBe(201)
    const blocked = await api.snapshot()
    expect(blocked.status).toBe(409)
  })

  it('reactivation needs a reason and clears the cancellation record; without one it is 400', async () => {
    const fixture = await makeFixture('c13-react')
    await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'none' })
    const noReason = await request(app).post('/api/update-booking-status').set(env.X_ACCESS_TOKEN, adminToken).send({
      ids: [fixture.booking._id.toString()], status: bookcarsTypes.BookingStatus.Pending, suppliers: [fixture.supplier._id.toString()],
    })
    expect(noReason.status).toBe(400)
    expect(String(noReason.text)).toContain('REACTIVATION_REASON')
    const withReason = await request(app).post('/api/update-booking-status').set(env.X_ACCESS_TOKEN, adminToken).send({
      ids: [fixture.booking._id.toString()], status: bookcarsTypes.BookingStatus.Pending, reason: 'Customer changed their mind', suppliers: [fixture.supplier._id.toString()],
    })
    expect(withReason.status).toBe(200)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    expect(booking?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Draft)
    expect(booking?.cancellationRecord).toBeUndefined()
    expect(booking?.expireAt).toBeTruthy()
  })

  it('a term change once the contract is active returns 409', async () => {
    const fixture = await makeFixture('c8-active', { status: bookcarsTypes.BookingStatus.Paid })
    await payInFull(fixture)
    const api = ops(fixture)
    const handed = await api.handover()
    expect(handed.status).toBe(201)
    const res = await request(app).put('/api/update-booking').set(env.X_ACCESS_TOKEN, adminToken).send({
      booking: {
        _id: fixture.booking._id.toString(), supplier: fixture.supplier._id.toString(), car: fixture.car._id.toString(),
        driver: fixture.driver._id.toString(), pickupLocation: fixture.location._id.toString(), dropOffLocation: fixture.location._id.toString(),
        from: new Date(Date.now() + 2 * 86400000), to: new Date(Date.now() + 4 * 86400000),
        status: bookcarsTypes.BookingStatus.Paid, price: 1000,
        cancellation: true, amendments: false, theftProtection: false,
        collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
      },
    })
    expect(res.status).toBe(409)
  })

  it('a handover with an occurredAt in the future returns 400', async () => {
    const fixture = await makeFixture('c15-future', { status: bookcarsTypes.BookingStatus.Paid })
    await payInFull(fixture)
    const api = ops(fixture)
    const res = await api.handover({ occurredAt: new Date(Date.now() + 3600000).toISOString(), odometer: 100, fuelLevel: 80 })
    expect(res.status).toBe(400)
  })

  it('complete with priced extra-km and no return odometer returns 409', async () => {
    const fixture = await makeFixture('c9-odo', { status: bookcarsTypes.BookingStatus.Paid })
    await AgencyReturnSettings.create({ supplier: fixture.supplier._id, includedKmPerDay: 100, extraKmPrice: 5 })
    await payInFull(fixture)
    const api = ops(fixture)
    const handed = await api.handover()
    expect(handed.status).toBe(201)
    const returned = await api.return({ occurredAt: new Date().toISOString(), fuelLevel: 70 })
    expect(returned.status).toBe(201)
    const snapshot = await api.snapshot()
    expect(snapshot.status).toBe(201)
    fixtureSnapshotFiles.push(snapshot.body.pdfFile)
    const res = await api.complete()
    expect(res.status).toBe(409)
  })

  it('complete refuses when a charge is decided after the snapshot (stale snapshot)', async () => {
    const fixture = await makeFixture('c5-stale', { status: bookcarsTypes.BookingStatus.Paid })
    await payInFull(fixture)
    const api = await toReturnReview(fixture)
    const snapshot = await api.snapshot()
    expect(snapshot.status).toBe(201)
    fixtureSnapshotFiles.push(snapshot.body.pdfFile)
    const charge = await api.createCharge({ type: bookcarsTypes.ContractChargeType.Fee, amount: 40, currency: 'MAD', reason: 'Cleaning fee' })
    expect(charge.status).toBe(201)
    const decided = await api.decideCharge(charge.body._id, { decision: bookcarsTypes.ApprovalDecision.Approved, note: 'Approved after snapshot' })

    expect(decided.status).toBe(200)
    const res = await api.complete()
    expect(res.status).toBe(409)
  })
})

describe('W2 2.9 â€” windows + customer cancel + PayPal order reuse', () => {
  it('a customer cancel on a booking that cannot be cancelled online returns 409 with a plain message', async () => {
    const fixture = await makeFixture('cust-cancel', { cancellation: false })
    const res = await request(app).post(`/api/cancel-booking/${fixture.booking._id.toString()}`).set(env.X_ACCESS_TOKEN, fixture.driverToken).send({})
    expect(res.status).toBe(409)
    expect(String(res.text)).toContain('cannot be cancelled online')
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Pending)
  })

  it('a stored PayPal order in a dead state is NOT reused: a fresh order is created', async () => {
    const fixture = await makeFixture('paypal-dead')
    await Booking.findByIdAndUpdate(fixture.booking._id, {
      status: bookcarsTypes.BookingStatus.Void,
      expireAt: new Date(Date.now() + 3600000),
      paypalOrderId: 'ORDER-OLD',
    })
    paypalGetOrder.mockResolvedValue({ id: 'ORDER-OLD', status: 'COMPLETED' })
    const res = await request(app).post('/api/create-paypal-order').send({
      bookingId: fixture.booking._id.toString(), name: 'W2 rental', description: 'W2 PayPal order',
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe('ORDER-NEW')
    expect(paypalCreateOrder).toHaveBeenCalled()
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.paypalOrderId).toBe('ORDER-NEW')
  })

  it('a stored PayPal order that is still CREATED is reused without creating a new one', async () => {
    const fixture = await makeFixture('paypal-live')
    await Booking.findByIdAndUpdate(fixture.booking._id, {
      status: bookcarsTypes.BookingStatus.Void,
      expireAt: new Date(Date.now() + 3600000),
      paypalOrderId: 'ORDER-OLD',
    })
    paypalGetOrder.mockResolvedValue({ id: 'ORDER-OLD', status: 'CREATED' })
    const res = await request(app).post('/api/create-paypal-order').send({
      bookingId: fixture.booking._id.toString(), name: 'W2 rental', description: 'W2 PayPal order',
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe('ORDER-OLD')
    expect(paypalCreateOrder).not.toHaveBeenCalled()
  })
})

describe('W2 2.10 â€” cash discipline on expenses', () => {
  const makeExpense = async (fixture: any, amount = 500) => {
    const res = await request(app).post('/api/maintenance-expenses').set(env.X_ACCESS_TOKEN, fixture.supplierToken).send({
      car: fixture.car._id.toString(), date: new Date().toISOString(), type: bookcarsTypes.MaintenanceExpenseType.Repair,
      amount, vendor: 'W2 Vendor',
    })
    expect(res.status).toBe(201)
    return res.body._id as string
  }
  const payExpense = (token: string, expenseId: string, body: object) =>
    request(app).post(`/api/maintenance-expenses/${expenseId}/payments`).set(env.X_ACCESS_TOKEN, token).send(body)

  it('caps payments at the expense amount, replays an idempotency key, and refuses cash with no open session', async () => {
    const fixture = await makeFixture('expense-cap')
    const expenseId = await makeExpense(fixture, 500)
    const over = await payExpense(fixture.supplierToken, expenseId, {
      date: new Date().toISOString(), amount: 600, method: bookcarsTypes.RentalPaymentMethod.Cash,
    })
    expect(over.status).toBe(409)
    expect(String(over.text)).toContain('EXPENSE_OVERPAY')
    const noSession = await payExpense(fixture.supplierToken, expenseId, {
      date: new Date().toISOString(), amount: 200, method: bookcarsTypes.RentalPaymentMethod.Cash,
    })
    expect(noSession.status).toBe(409)
    expect(String(noSession.text)).toContain('No cash session is open')
    await openSession(fixture.supplierToken, bookcarsTypes.CashAccountType.Cash, 0)
    const first = await payExpense(fixture.supplierToken, expenseId, {
      date: new Date().toISOString(), amount: 200, method: bookcarsTypes.RentalPaymentMethod.Cash, idempotencyKey: 'w2-expense-key-001',
    })
    expect(first.status).toBe(201)
    expect(first.body.payment.cashMovement).toBeTruthy()
    const replay = await payExpense(fixture.supplierToken, expenseId, {
      date: new Date().toISOString(), amount: 200, method: bookcarsTypes.RentalPaymentMethod.Cash, idempotencyKey: 'w2-expense-key-001',
    })
    expect(replay.status).toBe(200)
    expect(replay.body.payment._id).toBe(first.body.payment._id)
    const overAfter = await payExpense(fixture.supplierToken, expenseId, {
      date: new Date().toISOString(), amount: 400, method: bookcarsTypes.RentalPaymentMethod.Cash,
    })
    expect(overAfter.status).toBe(409)
    expect(String(overAfter.text)).toContain('EXPENSE_OVERPAY')
  })

  it('a wire payment posts unlinked when no Bank session is open, and delete is blocked while payments exist', async () => {
    const fixture = await makeFixture('expense-wire')
    const expenseId = await makeExpense(fixture, 500)
    const wire = await payExpense(fixture.supplierToken, expenseId, {
      date: new Date().toISOString(), amount: 100, method: bookcarsTypes.RentalPaymentMethod.BankTransfer,
    })
    expect(wire.status).toBe(201)
    expect(wire.body.payment.bankMovement).toBeUndefined()
    const blocked = await request(app).delete(`/api/maintenance-expenses/${expenseId}`).set(env.X_ACCESS_TOKEN, fixture.supplierToken).send({ reason: 'W2 test â€” payments exist' })
    expect(blocked.status).toBe(409)
  })
})

describe('W2 2.11 â€” admin bypass audit', () => {
  it('an admin collection call without an agency selector returns 400', async () => {
    const fixture = await makeFixture('admin-400')
    const res = await request(app).post('/api/bookings/1/30/en').set(env.X_ACCESS_TOKEN, adminToken).send({
      statuses: [bookcarsTypes.BookingStatus.Pending],
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Agency is required')
  })

  it('an admin collection call with a selector succeeds and writes an AdminAccessLog row', async () => {
    const fixture = await makeFixture('admin-log')
    const res = await request(app).post('/api/bookings/1/30/en').set(env.X_ACCESS_TOKEN, adminToken).send({
      suppliers: [fixture.supplier._id.toString()], statuses: [bookcarsTypes.BookingStatus.Pending],
    })
    expect(res.status).toBe(200)
    const row = await AdminAccessLog.findOne({ actor: adminId, agency: fixture.supplier._id }).lean()
    expect(row).not.toBeNull()
    expect(row?.action).toContain('readBookings')
  })

  it('a platform admin lists cash sessions unscoped (Treasury widget) while an agency user sees only its own agency', async () => {
    const a = await makeFixture('treasury-a')
    const b = await makeFixture('treasury-b')
    const sessionA = await openSession(a.supplierToken, bookcarsTypes.CashAccountType.Cash, 0)
    const sessionB = await openSession(b.supplierToken, bookcarsTypes.CashAccountType.Cash, 0)

    // Platform admin, no selector: the unscoped list the Dashboard
    // Treasury widget relies on (Dashboard.tsx keeps scope undefined
    // for the platform admin).
    const adminList = await request(app).get('/api/cash/sessions').set(env.X_ACCESS_TOKEN, adminToken)
    expect(adminList.status).toBe(200)
    const adminIds = (adminList.body as Array<{ _id: string }>).map((s) => s._id)
    expect(adminIds).toContain(sessionA._id)
    expect(adminIds).toContain(sessionB._id)

    // Admin with an explicit selector still scopes to that agency.
    const scoped = await request(app).get(`/api/cash/sessions?supplier=${a.supplier._id.toString()}`).set(env.X_ACCESS_TOKEN, adminToken)
    expect(scoped.status).toBe(200)
    expect((scoped.body as Array<{ _id: string }>).map((s) => s._id)).toEqual([sessionA._id])

    // Agency user, no selector: only its own agency's sessions.
    const agencyList = await request(app).get('/api/cash/sessions').set(env.X_ACCESS_TOKEN, a.supplierToken)
    expect(agencyList.status).toBe(200)
    expect((agencyList.body as Array<{ _id: string }>).map((s) => s._id)).toEqual([sessionA._id])

    // Treasury movements for the admin, no selector: 200 (the session
    // id attributes the call, as before).
    const movements = await request(app).get(`/api/cash/sessions/${sessionA._id}/movements`).set(env.X_ACCESS_TOKEN, adminToken)
    expect(movements.status).toBe(200)
    expect(movements.body).toEqual([])
  })

  it('a platform admin reads the current session, the journal and the invoice list unscoped (GA5: CashJournal + invoices, same class as Treasury)', async () => {
    const a = await makeFixture('ga5-current-a')
    const b = await makeFixture('ga5-current-b')
    const sessionA = await openSession(a.supplierToken, bookcarsTypes.CashAccountType.Cash, 0)
    const sessionB = await openSession(b.supplierToken, bookcarsTypes.CashAccountType.Cash, 0)

    // Current session, no selector: the CashJournal onLoad calls this
    // alongside listSessions; before the fix it 400d and the page
    // showed "Could not load journal entries" with no session open.
    const current = await request(app).get('/api/cash/sessions/current?account=cash').set(env.X_ACCESS_TOKEN, adminToken)
    expect(current.status).toBe(200)
    expect([sessionA._id, sessionB._id]).toContain(current.body?._id)

    // Journal for one session, no selector: the controller scopes by
    // the session id, so the unscoped admin read is valid.
    const journal = await request(app).get(`/api/cash/journal?sessionId=${sessionA._id}`).set(env.X_ACCESS_TOKEN, adminToken)
    expect(journal.status).toBe(200)
    expect(journal.body.session._id).toBe(sessionA._id)
    expect(journal.body.rows).toEqual([])

    // Invoice list, no selector: the controller already returns the
    // unscoped view for admins; the middleware blocked it before.
    const createdA = await request(app).post('/api/invoices').set(env.X_ACCESS_TOKEN, a.supplierToken).send({ booking: a.booking._id.toString() })
    expect(createdA.status).toBe(201)
    const createdB = await request(app).post('/api/invoices').set(env.X_ACCESS_TOKEN, b.supplierToken).send({ booking: b.booking._id.toString() })
    expect(createdB.status).toBe(201)
    const adminList = await request(app).get('/api/invoices').set(env.X_ACCESS_TOKEN, adminToken)
    expect(adminList.status).toBe(200)
    const adminIds = (adminList.body as Array<{ _id: string }>).map((inv) => inv._id)
    expect(adminIds).toContain(createdA.body._id)
    expect(adminIds).toContain(createdB.body._id)
    const agencyList = await request(app).get('/api/invoices').set(env.X_ACCESS_TOKEN, a.supplierToken)
    expect(agencyList.status).toBe(200)
    expect((agencyList.body as Array<{ _id: string }>).map((inv) => inv._id)).toEqual([createdA.body._id])
  })
})

describe('W2 remainder — 2.2 balance-based handover + completion gates (M5/C2/C3, Q14)', () => {
  it('a booking with an approved charge outstanding cannot hand over even with rent + deposit paid (409 PAYMENT_NOT_CONFIRMED)', async () => {
    const fixture = await makeFixture('g22-charge-block')
    await payInFull(fixture)
    const api = ops(fixture)
    const charge = await api.createCharge({ type: bookcarsTypes.ContractChargeType.Fee, amount: 100, currency: 'MAD', reason: 'Cleaning fee' })
    expect(charge.status).toBe(201)
    const decided = await api.decideCharge(charge.body._id, { decision: bookcarsTypes.ApprovalDecision.Approved, note: 'Approved before handover' })
    expect(decided.status).toBe(200)
    const res = await api.handover()
    expect(res.status).toBe(409)
    expect(String(res.text)).toContain('PAYMENT_NOT_CONFIRMED')
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Draft)
  })

  it('a rent-paid booking with the deposit uncollected cannot hand over (409 DEPOSIT_NOT_COLLECTED)', async () => {
    const fixture = await makeFixture('g22-rent-only')
    await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, bookcarsTypes.RentalPaymentMethod.Cash)
    const api = ops(fixture)
    const res = await api.handover()
    expect(res.status).toBe(409)
    expect(String(res.text)).toContain('DEPOSIT_NOT_COLLECTED')
  })

  it('rent + deposit paid hands over (201) and saves the handover odometer onto the car (GPS option A)', async () => {
    const fixture = await makeFixture('g22-odo')
    await payInFull(fixture)
    const api = ops(fixture)
    const res = await api.handover()
    expect(res.status).toBe(201)
    expect(res.body.booking.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Active)
    const car = await Car.findById(fixture.car._id).lean()
    expect(car?.odometerKm).toBe(100)
    const returned = await api.return()
    expect(returned.status).toBe(201)
    const carAfterReturn = await Car.findById(fixture.car._id).lean()
    expect(carAfterReturn?.odometerKm).toBe(130)
  })

  it('handover without odometer/fuel readings is refused (400) and leaves the booking Draft (GA5)', async () => {
    const fixture = await makeFixture('g22-readings')
    await payInFull(fixture)
    const api = ops(fixture)
    const blank = await api.handover({ occurredAt: new Date().toISOString() })
    expect(blank.status).toBe(400)
    const noFuel = await api.handover({ occurredAt: new Date().toISOString(), odometer: 100 })
    expect(noFuel.status).toBe(400)
    const noOdo = await api.handover({ occurredAt: new Date().toISOString(), fuelLevel: 80 })
    expect(noOdo.status).toBe(400)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Draft)
    const ok = await api.handover()
    expect(ok.status).toBe(201)
    expect(ok.body.booking.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Active)
  })

  it('Q14: rent outstanding with deposit collected and no future booking hands over; a future confirmed booking blocks it', async () => {
    const fixture = await makeFixture('g22-q14')
    await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Deposit, 250, bookcarsTypes.RentalPaymentMethod.Cash)
    const api = ops(fixture)
    // No future confirmed booking for the car: rent-at-return is allowed.
    const allowed = await api.handover()
    expect(allowed.status).toBe(201)
    // A second booking, manager-confirmed for a later week on the same
    // car and agency, reserves the car.
    const futureBooking = await Booking.create({
      supplier: fixture.supplier._id, car: fixture.car._id, driver: fixture.driver._id,
      pickupLocation: fixture.location._id, dropOffLocation: fixture.location._id,
      from: new Date(Date.now() + 5 * 86400000), to: new Date(Date.now() + 7 * 86400000),
      status: bookcarsTypes.BookingStatus.Pending,
      lifecycle: bookcarsTypes.ContractLifecycle.Confirmed,
      price: 1000, cancellation: true, expireAt: null,
      financialSnapshot: {
        version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD', mode: bookcarsTypes.CheckoutPaymentMode.Full,
        rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000, amountDueNowInPaymentCurrency: 1000, quotedAt: new Date(),
      },
    } as any)
    fixtureBookingIds.push(futureBooking._id)
    // Back to Draft: the same handover shape must now refuse (the car
    // is reserved) — rebuild the state on the first booking.
    await Booking.findByIdAndUpdate(fixture.booking._id, { lifecycle: bookcarsTypes.ContractLifecycle.Draft })
    await ContractInspection.deleteMany({ booking: fixture.booking._id })
    const blocked = await api.handover()
    expect(blocked.status).toBe(409)
    expect(String(blocked.text)).toContain('PAYMENT_NOT_CONFIRMED')
  })

  it('an overdue maintenance schedule blocks handover (409 MAINTENANCE_BLOCKS_HANDOVER)', async () => {
    const fixture = await makeFixture('g22-maint')
    await payInFull(fixture)
    await MaintenanceSchedule.create({
      supplier: fixture.supplier._id, car: fixture.car._id,
      type: bookcarsTypes.MaintenanceExpenseType.Oil, title: 'W2 overdue oil service',
      nextDueDate: new Date(Date.now() - 86400000),
    })
    const api = ops(fixture)
    const res = await api.handover()
    expect(res.status).toBe(409)
    expect(String(res.text)).toContain('MAINTENANCE_BLOCKS_HANDOVER')
  })

  it('complete with rent outstanding and no reason returns 409; with a reason it closes and records closeWithBalance', async () => {
    const fixture = await makeFixture('g22-complete')
    await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Deposit, 250, bookcarsTypes.RentalPaymentMethod.Cash)
    const api = ops(fixture)
    // Q14 gets the car out with rent outstanding; return it.
    const handed = await api.handover()
    expect(handed.status).toBe(201)
    const returned = await api.return()
    expect(returned.status).toBe(201)
    const snapshot = await api.snapshot()
    expect(snapshot.status).toBe(201)
    fixtureSnapshotFiles.push(snapshot.body.pdfFile)
    const refused = await api.complete()
    expect(refused.status).toBe(409)
    expect(String(refused.text)).toContain('BALANCE_OUTSTANDING')
    const closed = await api.complete({ closeWithBalanceReason: 'Customer will wire the balance tomorrow; manager approved the close.' })
    expect(closed.status).toBe(200)
    expect(closed.body.booking.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Completed)
    expect(closed.body.booking.closeWithBalance?.reason).toContain('wire the balance')
    expect(closed.body.receivable.outstandingBalance).toBe(1000)
  })

  it('complete with the deposit never collected and no settlement returns 409', async () => {
    const fixture = await makeFixture('g22-dep-missing')
    await payInFull(fixture)
    const api = ops(fixture)
    const handed = await api.handover()
    expect(handed.status).toBe(201)
    const returned = await api.return()
    expect(returned.status).toBe(201)
    // The deposit is reversed after return: nothing held, no settlement.
    const depositPayment = await RentalPayment.findOne({ booking: fixture.booking._id, purpose: bookcarsTypes.RentalPaymentPurpose.Deposit, status: bookcarsTypes.RentalPaymentStatus.Posted }).lean()
    expect(depositPayment).not.toBeNull()
    await reverseRentalPayment({ paymentId: depositPayment!._id.toString(), idempotencyKey: 'w2-g22-dep-reversal', actorId: adminId })
    const snapshot = await api.snapshot()
    expect(snapshot.status).toBe(201)
    fixtureSnapshotFiles.push(snapshot.body.pdfFile)
    const refused = await api.complete()
    expect(refused.status).toBe(409)
    expect(String(refused.text)).toContain('DEPOSIT_NOT_COLLECTED')
  })
})

describe('W2 remainder — 2.7 VAT-inclusive rent cap + receivable (Q11 = HT, M6)', () => {
  it('getContractReceivable adds VAT to the rent when the supplier has VAT on; 0% when off', async () => {
    const fixture = await makeFixture('g27-vat')
    const booking = await Booking.findById(fixture.booking._id).lean()
    const off = await getContractReceivable(booking as any)
    expect(off.vatRate).toBe(0)
    expect(off.vatAmount).toBe(0)
    expect(off.rentalTotalInclVat).toBe(1000)
    expect(off.outstandingBalance).toBe(1000)
    await User.findByIdAndUpdate(fixture.supplier._id, { vatEnabled: true, vatRate: 20 })
    const on = await getContractReceivable(booking as any)
    expect(on.vatRate).toBe(20)
    expect(on.vatAmount).toBe(200)
    expect(on.rentalTotalInclVat).toBe(1200)
    expect(on.outstandingBalance).toBe(1200)
    await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, bookcarsTypes.RentalPaymentMethod.Cash)
    const partial = await getContractReceivable(booking as any)
    expect(partial.outstandingBalance).toBe(200)
    await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 200, bookcarsTypes.RentalPaymentMethod.Cash)
    const settled = await getContractReceivable(booking as any)
    expect(settled.outstandingBalance).toBe(0)
  })

  it('the Rent purpose cap is VAT-inclusive: a VAT-on invoice can be paid in full, a further centime is refused', async () => {
    const fixture = await makeFixture('g27-cap')
    await User.findByIdAndUpdate(fixture.supplier._id, { vatEnabled: true, vatRate: 20 })
    await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, bookcarsTypes.RentalPaymentMethod.Cash)
    await postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 200, bookcarsTypes.RentalPaymentMethod.Cash)
    await expect(
      postManual(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1, bookcarsTypes.RentalPaymentMethod.Cash),
    ).rejects.toThrow()
    const control = await makeFixture('g27-cap-off')
    await postManual(control.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, bookcarsTypes.RentalPaymentMethod.Cash)
    await expect(
      postManual(control.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1, bookcarsTypes.RentalPaymentMethod.Cash),
    ).rejects.toThrow()
  })
})

describe('W2 remainder — Q13 defaultDeposit (5× daily rate, nearest 500, [1,500–5,000])', () => {
  it('rounds 5× the daily rate to the nearest 500 within the bounds', () => {
    expect(defaultDeposit(300)).toBe(1500)
    expect(defaultDeposit(320)).toBe(1500)
    expect(defaultDeposit(420)).toBe(2000)
    expect(defaultDeposit(450)).toBe(2500)
    expect(defaultDeposit(1000)).toBe(5000)
    expect(defaultDeposit(1200)).toBe(5000)
    expect(defaultDeposit(100)).toBe(1500)
  })

  it('falls back to the 1,500 floor for non-positive or invalid input', () => {
    expect(defaultDeposit(0)).toBe(1500)
    expect(defaultDeposit(-50)).toBe(1500)
    expect(defaultDeposit(Number.NaN)).toBe(1500)
    expect(defaultDeposit(undefined)).toBe(1500)
    expect(defaultDeposit('420' as any)).toBe(1500)
  })
})
