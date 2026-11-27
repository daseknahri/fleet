import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import ContractCharge from '../src/models/ContractCharge'
import Approval from '../src/models/Approval'
import ContractInspection from '../src/models/ContractInspection'
import Notification from '../src/models/Notification'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import { postRentalPayment } from '../src/utils/ledger'

// Workstream A, cluster F3 — cancel / refund workflow (W1 #1, #3, #9,
// #11, #18; W4 GAP-11). Same harness as finalisationIntegrity: mocked
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

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
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
    email: `f3-supplier-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F3 Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `f3-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F3 Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `F3 Casablanca Airport ${label}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: `F3 car ${label}`, supplier: supplier._id, minimumAge: 21,
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
  // Next pass - inspections require a photo each: the contract file the
  // upload endpoint would store, pre-created on disk.
  const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9])
  const handoverFilename = `inspection_${booking._id}_handover.jpg`
  await fs.writeFile(path.resolve(env.CDN_CONTRACTS, handoverFilename), photoBytes)
  fixtureSnapshotFiles.push(handoverFilename)
  return { supplier, driver, location, car, booking }
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

const paymentsOf = async (bookingId: mongoose.Types.ObjectId) =>
  RentalPayment.find({ booking: bookingId }).sort({ purpose: 1, createdAt: 1 }).lean()

const cancelAsAdmin = (bookingId: string, body: object) =>
  request(app).post(`/api/bookings/${bookingId}/cancel`).set(env.X_ACCESS_TOKEN, adminToken).send(body)

const mockPayPalOrderWithCapture = (orderId: string, captureId: string, amount: string) => {
  paypalGetOrder.mockResolvedValue({
    id: orderId, status: 'COMPLETED',
    purchase_units: [{
      invoice_id: 'unused',
      amount: { currency_code: 'MAD', value: amount },
      payments: { captures: [{ id: captureId, status: 'COMPLETED', amount: { currency_code: 'MAD', value: amount } }] },
    }],
  })
}

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'f3-admin', email: `f3-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true,
  })
  adminId = admin._id.toString()
  // The admin is NOT tracked in fixtureUserIds: afterEach deletes the
  // per-test fixtures, and the admin token must stay valid for the
  // whole file (deleted in afterAll instead).
  adminToken = await authHelper.encryptJWT({ id: adminId })
  stripeRefundCreate.mockResolvedValue({ id: 're_f3_test' })
  paypalRefundCapture.mockResolvedValue({})
})

afterAll(async () => {
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

afterEach(async () => {
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await ContractCharge.deleteMany({ booking: { $in: fixtureBookingIds } })
  await ContractInspection.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Notification.deleteMany({ booking: { $in: fixtureBookingIds } })
  for (const filename of fixtureSnapshotFiles) {
    await fs.unlink(path.resolve(env.CDN_CONTRACTS, filename)).catch(() => undefined)
  }
  fixtureSnapshotFiles.length = 0
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
  stripeRefundCreate.mockResolvedValue({ id: 're_f3_test' })
  paypalRefundCapture.mockResolvedValue({})
})

describe('F3 / W1 #1 — staff cancel of paid/deposit bookings', () => {
  it('cancels an unpaid Pending booking with refund none: status + lifecycle Cancelled, no money moved', async () => {
    const fixture = await makeFixture('cancel-pending')
    const response = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer asked to cancel', refundDecision: 'none' })
    expect(response.status).toBe(200)
    expect(response.body.booking.status).toBe(bookcarsTypes.BookingStatus.Cancelled)
    expect(response.body.booking.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Cancelled)
    expect(response.body.booking.cancelRequest).toBe(false)
    expect(response.body.refund.status).toBe('none')
    expect(response.body.refund.rentPaid).toBe(0)
    expect(response.body.refund.depositPaid).toBe(0)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Cancelled)
    expect(booking?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Cancelled)
    expect(booking?.cancellationRecord?.reason).toBe('Customer asked to cancel')
    expect(booking?.cancellationRecord?.refundDecision).toBe('none')
  })

  it('cancels a Stripe-paid booking with refund full: provider refunded first, ledger reversed', async () => {
    const fixture = await makeFixture('cancel-paid-full', { status: bookcarsTypes.BookingStatus.Paid })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, 'stripe', 'pi_f3_paid_full')
    const response = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled before pickup', refundDecision: 'full' })
    expect(response.status).toBe(200)
    expect(response.body.refund.status).toBe('refunded')
    expect(response.body.refund.rentPaid).toBe(1000)
    expect(response.body.refund.refundedRent).toBe(1000)
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_f3_paid_full' },
      expect.objectContaining({ idempotencyKey: expect.stringContaining('refund-reversal-') }),
    )
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments.filter((p) => p.status === bookcarsTypes.RentalPaymentStatus.Reversed)).toHaveLength(2)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Cancelled)
    expect(booking?.cancellationRecord?.refundStatus).toBe('refunded')
  })

  it('cancels a Stripe-paid booking with refund none: provider untouched, payments stay Posted', async () => {
    const fixture = await makeFixture('cancel-paid-none', { status: bookcarsTypes.BookingStatus.Paid })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, 'stripe', 'pi_f3_paid_none')
    const response = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'No-show, no refund per staff decision', refundDecision: 'none' })
    expect(response.status).toBe(200)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(1)
    expect(payments[0].status).toBe(bookcarsTypes.RentalPaymentStatus.Posted)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Cancelled)
    expect(booking?.cancellationRecord?.refundStatus).toBe('none')
  })

  it('cancels a Stripe-paid booking with refund manual: cancelled now, refund left pending for staff', async () => {
    const fixture = await makeFixture('cancel-paid-manual', { status: bookcarsTypes.BookingStatus.Paid })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, 'stripe', 'pi_f3_paid_manual')
    const response = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Partial refund to be decided', refundDecision: 'manual' })
    expect(response.status).toBe(200)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(1)
    expect(payments[0].status).toBe(bookcarsTypes.RentalPaymentStatus.Posted)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Cancelled)
    expect(booking?.cancellationRecord?.refundStatus).toBe('pending')
    expect(booking?.cancellationRecord?.rentPaid).toBe(1000)
  })

  it('cancels a Deposit booking with refund full: the deposit leg is refunded, not the rent', async () => {
    const fixture = await makeFixture('cancel-deposit-full', { status: bookcarsTypes.BookingStatus.Deposit, amountDueNow: 250 })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Deposit, 250, 'stripe', 'pi_f3_deposit_full')
    const response = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'full' })
    expect(response.status).toBe(200)
    expect(response.body.refund.depositPaid).toBe(250)
    expect(response.body.refund.refundedDeposit).toBe(250)
    expect(response.body.refund.refundedRent).toBe(0)
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_f3_deposit_full' },
      expect.anything(),
    )
  })

  it('refuses a cancel with no reason, with an invalid refund decision, and of an already-cancelled booking', async () => {
    const fixture = await makeFixture('cancel-invalid')
    const noReason = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'x', refundDecision: 'none' })
    expect(noReason.status).toBe(400)
    const badDecision = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'half' })
    expect(badDecision.status).toBe(400)
    const ok = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'none' })
    expect(ok.status).toBe(200)
    const again = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled again', refundDecision: 'none' })
    expect(again.status).toBe(409)
    expect(again.text).toContain('ALREADY_CANCELLED')
  })

  it('refuses a cancel of a Void temp booking and of a handed-over (Active) booking', async () => {
    const temp = await makeFixture('cancel-void', { status: bookcarsTypes.BookingStatus.Void })
    const tempResponse = await cancelAsAdmin(temp.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'none' })
    expect(tempResponse.status).toBe(409)
    expect(tempResponse.text).toContain('TEMP_BOOKING')
    const active = await makeFixture('cancel-active', { status: bookcarsTypes.BookingStatus.Paid, lifecycle: bookcarsTypes.ContractLifecycle.Active })
    const activeResponse = await cancelAsAdmin(active.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'none' })
    expect(activeResponse.status).toBe(409)
    expect(activeResponse.text).toContain('CANCEL_AFTER_HANDOVER')
  })

  it('refuses a cancel while a contract charge is pending', async () => {
    const fixture = await makeFixture('cancel-charge', { status: bookcarsTypes.BookingStatus.Paid })
    await ContractCharge.create({
      supplier: fixture.supplier._id, booking: fixture.booking._id,
      type: bookcarsTypes.ContractChargeType.Damage, reason: 'Scratch', amount: 100, currency: 'MAD',
      status: bookcarsTypes.ApprovalDecision.Pending,
    })
    const response = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'none' })
    expect(response.status).toBe(409)
    expect(response.text).toContain('CANCEL_PENDING_CHARGES')
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
  })

  it('refuses the whole cancel (502) when the provider refund fails: booking stays Paid, money untouched', async () => {
    const fixture = await makeFixture('cancel-refund-fail', { status: bookcarsTypes.BookingStatus.Paid })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, 'stripe', 'pi_f3_refund_fail')
    stripeRefundCreate.mockRejectedValueOnce(new Error('card_declined'))
    const response = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'full' })
    expect(response.status).toBe(502)
    expect(response.text).toContain('REFUND_FAILED')
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(1)
    expect(payments[0].status).toBe(bookcarsTypes.RentalPaymentStatus.Posted)
  })

  it('frees the car dates: a new booking for the same car and dates succeeds after the cancel', async () => {
    const fixture = await makeFixture('cancel-frees-car', { status: bookcarsTypes.BookingStatus.Paid })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, 'stripe', 'pi_f3_frees_car')
    const cancelled = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'none' })
    expect(cancelled.status).toBe(200)
    const rebook = await request(app).post('/api/create-booking').set(env.X_ACCESS_TOKEN, adminToken).send({
      booking: {
        supplier: fixture.supplier._id.toString(), car: fixture.car._id.toString(), driver: fixture.driver._id.toString(),
        pickupLocation: fixture.location._id.toString(), dropOffLocation: fixture.location._id.toString(),
        from: fixture.booking.from, to: fixture.booking.to,
        status: bookcarsTypes.BookingStatus.Pending, price: 1000,
        cancellation: false, amendments: false, theftProtection: false,
        collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
      },
    })
    expect(rebook.status).toBe(200)
    fixtureBookingIds.push(rebook.body._id)
  })

  it('forbids a cross-agency cancel and a customer cancel through the staff endpoint', async () => {
    const fixture = await makeFixture('cancel-scope', { status: bookcarsTypes.BookingStatus.Paid })
    const otherSupplier = await User.create({
      email: `f3-other-${rand()}@test.bookcars.ma`, fullName: 'F3 Other Supplier',
      language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false,
    })
    fixtureUserIds.push(otherSupplier._id)
    const otherToken = await authHelper.encryptJWT({ id: otherSupplier._id.toString() })
    const cross = await request(app).post(`/api/bookings/${fixture.booking._id.toString()}/cancel`)
      .set(env.X_ACCESS_TOKEN, otherToken).send({ reason: 'Customer cancelled', refundDecision: 'none' })
    expect(cross.status).toBe(403)
    const driverToken = await authHelper.encryptJWT({ id: fixture.driver._id.toString() })
    const customer = await request(app).post(`/api/bookings/${fixture.booking._id.toString()}/cancel`)
      .set(env.X_ACCESS_TOKEN, driverToken).send({ reason: 'Customer cancelled', refundDecision: 'none' })
    expect(customer.status).toBe(403)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
  })
})

describe('F3 / W1 #18 — Cancelled is no longer a bare 400 dead-end', () => {
  it('updateStatus to Cancelled from Paid refuses with the cancel-workflow redirect', async () => {
    const fixture = await makeFixture('status-paid-cancel', { status: bookcarsTypes.BookingStatus.Paid })
    const response = await request(app).post('/api/update-booking-status').set(env.X_ACCESS_TOKEN, adminToken).send({
      ids: [fixture.booking._id.toString()], status: bookcarsTypes.BookingStatus.Cancelled,
    })
    expect(response.status).toBe(400)
    expect(response.text).toContain('CANCEL_VIA_WORKFLOW')
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
  })

  it('update to Cancelled from Paid refuses with the cancel-workflow redirect', async () => {
    const fixture = await makeFixture('update-paid-cancel', { status: bookcarsTypes.BookingStatus.Paid })
    const response = await request(app).put('/api/update-booking').set(env.X_ACCESS_TOKEN, adminToken).send({
      booking: {
        _id: fixture.booking._id.toString(), supplier: fixture.supplier._id.toString(),
        car: fixture.car._id.toString(), driver: fixture.driver._id.toString(),
        pickupLocation: fixture.location._id.toString(), dropOffLocation: fixture.location._id.toString(),
        from: fixture.booking.from, to: fixture.booking.to,
        status: bookcarsTypes.BookingStatus.Cancelled, price: 1000,
        cancellation: true, amendments: false, theftProtection: false,
        collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
      },
    })
    expect(response.status).toBe(400)
    expect(response.text).toContain('CANCEL_VIA_WORKFLOW')
  })

  it('updateStatus to Cancelled from Pending succeeds and sets lifecycle Cancelled', async () => {
    const fixture = await makeFixture('status-pending-cancel')
    const response = await request(app).post('/api/update-booking-status').set(env.X_ACCESS_TOKEN, adminToken).send({
      ids: [fixture.booking._id.toString()], status: bookcarsTypes.BookingStatus.Cancelled,
    })
    expect(response.status).toBe(200)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Cancelled)
    expect(booking?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Cancelled)
  })
})

describe('F3 / W1 #3 — one payment path (Wave 1.1: confirmManualPayment deleted)', () => {
  // Wave 1.1 — the deleted confirm-payment endpoint used to be the cash
  // path. The rental-payment create path below is now the ONLY way to take
  // money: it posts with a UUID idempotency key and derives the booking
  // status from the ledger via refreshBookingPaymentStatus.
  const postCash = (bookingId: mongoose.Types.ObjectId, amount: number, purpose: bookcarsTypes.RentalPaymentPurpose, key: string) =>
    request(app).post('/api/rental-payments').set(env.X_ACCESS_TOKEN, adminToken).send({
      booking: bookingId.toString(), date: new Date(), amount,
      method: bookcarsTypes.RentalPaymentMethod.Cash, purpose, idempotencyKey: key,
    })

  it('confirms a Pending booking to Paid when the full cash amount is posted', async () => {
    const fixture = await makeFixture('confirm-full-cash')
    const response = await postCash(fixture.booking._id, 1000, bookcarsTypes.RentalPaymentPurpose.Rent, `w1-full-${rand()}`)
    expect(response.status).toBe(201)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(1)
    expect(payments[0].method).toBe(bookcarsTypes.RentalPaymentMethod.Cash)
    expect(payments[0].status).toBe(bookcarsTypes.RentalPaymentStatus.Posted)
  })

  it('reports a partial cash collection as not-confirmed with the outstanding balance', async () => {
    const fixture = await makeFixture('confirm-partial-cash')
    const response = await postCash(fixture.booking._id, 400, bookcarsTypes.RentalPaymentPurpose.Rent, `w1-partial-${rand()}`)
    expect(response.status).toBe(201)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    const overdue = await request(app).get('/api/rental-payments/overdue').set(env.X_ACCESS_TOKEN, adminToken)
    expect(overdue.status).toBe(200)
    const row = (overdue.body.rows as any[]).find((r) => r.booking._id === fixture.booking._id.toString())
    expect(row?.outstandingBalance).toBe(600)
  })

  it('replaying a cash posting with the same idempotency key posts only once (M4 closed)', async () => {
    const fixture = await makeFixture('confirm-idempotent-replay')
    const key = `w1-replay-${rand()}`
    const first = await postCash(fixture.booking._id, 1000, bookcarsTypes.RentalPaymentPurpose.Rent, key)
    expect(first.status).toBe(201)
    const replay = await postCash(fixture.booking._id, 1000, bookcarsTypes.RentalPaymentPurpose.Rent, key)
    expect(replay.status).toBe(201)
    expect(replay.body._id).toBe(first.body._id)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(1)
    const mismatch = await postCash(fixture.booking._id, 500, bookcarsTypes.RentalPaymentPurpose.Rent, key)
    expect(mismatch.status).toBe(409)
    expect(mismatch.text).toContain('Idempotency key is already used')
  })

  it('confirms a Deposit booking to PaidInFull once the rent balance is collected', async () => {
    const fixture = await makeFixture('confirm-deposit-full', { status: bookcarsTypes.BookingStatus.Deposit, amountDueNow: 250 })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Deposit, 250, 'stripe', 'pi_f3_confirm_deposit')
    const response = await postCash(fixture.booking._id, 1000, bookcarsTypes.RentalPaymentPurpose.Rent, `w1-deposit-${rand()}`)
    expect(response.status).toBe(201)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.PaidInFull)
  })

  it('refuses an overpayment and a payment on a cancelled booking', async () => {
    const fixture = await makeFixture('confirm-overpay')
    const over = await postCash(fixture.booking._id, 1001, bookcarsTypes.RentalPaymentPurpose.Rent, `w1-overpay-${rand()}`)
    expect(over.status).toBe(400)
    expect(over.text).toContain('exceeds the remaining rental balance')
    const cancelled = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'Customer cancelled', refundDecision: 'none' })
    expect(cancelled.status).toBe(200)
    const closed = await postCash(fixture.booking._id, 1000, bookcarsTypes.RentalPaymentPurpose.Rent, `w1-closed-${rand()}`)
    expect(closed.status).toBe(404)
  })
  it('a full rent posting on the Payments page flips the booking to Paid by itself', async () => {
    const fixture = await makeFixture('confirm-via-payments-page')
    const response = await request(app).post('/api/rental-payments').set(env.X_ACCESS_TOKEN, adminToken).send({
      booking: fixture.booking._id.toString(), date: new Date(), amount: 1000,
      method: bookcarsTypes.RentalPaymentMethod.Cash, purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
    })
    expect(response.status).toBe(201)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
  })
})

describe('F3 / W1 #9 + W4 GAP-11 — cancel-request queue and customer cancel of a paid booking', () => {
  const requestCancelAsDriver = async (fixture: any) => {
    const driverToken = await authHelper.encryptJWT({ id: fixture.driver._id.toString() })
    return request(app).post(`/api/cancel-booking/${fixture.booking._id.toString()}`).set(env.X_ACCESS_TOKEN, driverToken)
  }

  const queueAsAdmin = async (supplierId: string) =>
    request(app).post('/api/cancel-requests/1/30/en').set(env.X_ACCESS_TOKEN, adminToken).send({ suppliers: [supplierId] })

  it('customer cancel request lands in the queue with the amounts at stake; approve cancels it', async () => {
    const fixture = await makeFixture('queue-approve', { status: bookcarsTypes.BookingStatus.Paid })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, 'stripe', 'pi_f3_queue_approve')
    const requested = await requestCancelAsDriver(fixture)
    expect(requested.status).toBe(200)
    const queue = await queueAsAdmin(fixture.supplier._id.toString())
    expect(queue.status).toBe(200)
    const rows = queue.body[0].resultData as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].booking._id).toBe(fixture.booking._id.toString())
    expect(rows[0].rentPaid).toBe(1000)
    expect(rows[0].depositPaid).toBe(0)
    expect(rows[0].outstandingBalance).toBe(0)
    expect(rows[0].requestedAt).toBeTruthy()
    const decided = await request(app).post(`/api/bookings/${fixture.booking._id.toString()}/decide-cancel-request`)
      .set(env.X_ACCESS_TOKEN, adminToken).send({ decision: 'approve', reason: 'Customer cancelled before pickup', refundDecision: 'none' })
    expect(decided.status).toBe(200)
    expect(decided.body.booking.status).toBe(bookcarsTypes.BookingStatus.Cancelled)
    expect(decided.body.booking.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Cancelled)
    const queueAfter = await queueAsAdmin(fixture.supplier._id.toString())
    expect((queueAfter.body[0].resultData as any[])).toHaveLength(0)
  })

  it('deny clears the flag and leaves the booking untouched', async () => {
    const fixture = await makeFixture('queue-deny', { status: bookcarsTypes.BookingStatus.Paid })
    const requested = await requestCancelAsDriver(fixture)
    expect(requested.status).toBe(200)
    const denied = await request(app).post(`/api/bookings/${fixture.booking._id.toString()}/decide-cancel-request`)
      .set(env.X_ACCESS_TOKEN, adminToken).send({ decision: 'deny', reason: 'Outside the cancellation window' })
    expect(denied.status).toBe(200)
    expect(denied.body.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect(denied.body.cancelRequest).toBe(false)
    const queue = await queueAsAdmin(fixture.supplier._id.toString())
    expect((queue.body[0].resultData as any[])).toHaveLength(0)
  })

  it('decide without a pending request refuses 409, and approve needs a refund decision', async () => {
    const fixture = await makeFixture('queue-no-request', { status: bookcarsTypes.BookingStatus.Paid })
    const noRequest = await request(app).post(`/api/bookings/${fixture.booking._id.toString()}/decide-cancel-request`)
      .set(env.X_ACCESS_TOKEN, adminToken).send({ decision: 'approve', reason: 'Customer cancelled', refundDecision: 'none' })
    expect(noRequest.status).toBe(409)
    expect(noRequest.text).toContain('NO_CANCEL_REQUEST')
    await requestCancelAsDriver(fixture)
    const noDecision = await request(app).post(`/api/bookings/${fixture.booking._id.toString()}/decide-cancel-request`)
      .set(env.X_ACCESS_TOKEN, adminToken).send({ decision: 'approve', reason: 'Customer cancelled' })
    expect(noDecision.status).toBe(400)
  })

  it('approve with refund full on a PayPal-paid booking refunds the capture (W4 GAP-11)', async () => {
    const fixture = await makeFixture('queue-paypal-full', { status: bookcarsTypes.BookingStatus.Paid })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 1000, 'paypal', 'order_f3_paypal_full')
    mockPayPalOrderWithCapture('order_f3_paypal_full', 'cap_f3_paypal_full', '1000')
    await requestCancelAsDriver(fixture)
    const decided = await request(app).post(`/api/bookings/${fixture.booking._id.toString()}/decide-cancel-request`)
      .set(env.X_ACCESS_TOKEN, adminToken).send({ decision: 'approve', reason: 'Customer cancelled', refundDecision: 'full' })
    expect(decided.status).toBe(200)
    expect(decided.body.refund.status).toBe('refunded')
    expect(paypalRefundCapture).toHaveBeenCalledWith('cap_f3_paypal_full', expect.stringContaining('refund-reversal-'))
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments.filter((p) => p.status === bookcarsTypes.RentalPaymentStatus.Reversed)).toHaveLength(2)
  })

  it('the queue is agency-scoped: another supplier sees none of this agency’s requests', async () => {
    const fixture = await makeFixture('queue-scope', { status: bookcarsTypes.BookingStatus.Paid })
    await requestCancelAsDriver(fixture)
    const otherSupplier = await User.create({
      email: `f3-otherq-${rand()}@test.bookcars.ma`, fullName: 'F3 Other Queue Supplier',
      language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false,
    })
    fixtureUserIds.push(otherSupplier._id)
    const otherToken = await authHelper.encryptJWT({ id: otherSupplier._id.toString() })
    const queue = await request(app).post('/api/cancel-requests/1/30/en')
      .set(env.X_ACCESS_TOKEN, otherToken).send({ suppliers: [otherSupplier._id.toString()] })
    expect(queue.status).toBe(200)
    expect((queue.body[0].resultData as any[])).toHaveLength(0)
  })
})

describe('F3 / W1 #11 — handover payment gate', () => {
  // GA5: a handover now requires its readings (odometer + fuel) - the
  // payment-gate tests hand over with a realistic body.
  const handoverAsAdmin = (fixture: any, body: object = { occurredAt: new Date().toISOString(), odometer: 100, fuelLevel: 80, photoFiles: ['handover.jpg'] }) =>
    request(app).post(`/api/contract-operations/${fixture.booking._id.toString()}/handover?supplier=${fixture.supplier._id.toString()}`)
      .set(env.X_ACCESS_TOKEN, adminToken).send(body)

  it('refuses handover on an unpaid Pending booking, naming the outstanding balance', async () => {
    const fixture = await makeFixture('handover-unpaid')
    const response = await handoverAsAdmin(fixture)
    expect(response.status).toBe(409)
    expect(response.text).toContain('PAYMENT_NOT_CONFIRMED')
    expect(response.text).toContain('1000')
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Draft)
  })

  it('allows handover once the payment is confirmed (cash at the counter, then handover)', async () => {
    const fixture = await makeFixture('handover-after-confirm')
    const confirmed = await request(app).post('/api/rental-payments').set(env.X_ACCESS_TOKEN, adminToken).send({
      booking: fixture.booking._id.toString(), date: new Date(), amount: 1000,
      method: bookcarsTypes.RentalPaymentMethod.Cash, purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
      idempotencyKey: `w1-handover-${rand()}`,
    })
    expect(confirmed.status).toBe(201)
    const paid = await Booking.findById(fixture.booking._id).lean()
    expect(paid?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    // 2.2: handover also requires the refundable deposit collected —
    // the counter takes rent + deposit together before the keys.
    const deposit = await request(app).post('/api/rental-payments').set(env.X_ACCESS_TOKEN, adminToken).send({
      booking: fixture.booking._id.toString(), date: new Date(), amount: 250,
      method: bookcarsTypes.RentalPaymentMethod.Cash, purpose: bookcarsTypes.RentalPaymentPurpose.Deposit,
      idempotencyKey: `w1-handover-deposit-${rand()}`,
    })
    expect(deposit.status).toBe(201)
    const response = await handoverAsAdmin(fixture)
    expect(response.status).toBe(201)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Active)
  })

  it('allows handover on a zero-total Pending booking (nothing outstanding)', async () => {
    const fixture = await makeFixture('handover-zero-total', { rentalTotal: 0, depositAmount: 0, amountDueNow: 0 })
    const response = await handoverAsAdmin(fixture)
    expect(response.status).toBe(201)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Active)
  })
})

describe('R6-19 — top-up approval when the existing approval is Approved-but-insufficient', () => {
  it('an Approved 5000 against a 12000 refund refuses 409, opens a 12000 top-up, and the cancel succeeds once the top-up is approved', async () => {
    const fixture = await makeFixture('r619-topup', { status: bookcarsTypes.BookingStatus.Paid, rentalTotal: 12000, amountDueNow: 12000 })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 12000, 'stripe', 'pi_r6_19_topup')
    await Approval.create({
      supplier: fixture.supplier._id, subject: fixture.booking._id.toString(), subjectType: 'booking-cancel',
      amount: 5000, currency: 'MAD', status: bookcarsTypes.ApprovalDecision.Approved,
      requestedBy: adminId, reason: 'R6-19 seed: approved for 5000 only',
    })
    try {
      const refused = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'R6-19 test cancel', refundDecision: 'full' })
      expect(refused.status).toBe(409)
      expect(refused.text).toContain('CANCEL_APPROVAL_REQUIRED')
      expect(refused.text).toContain('5000')
      expect(refused.text).toContain('12000')
      // A NEW Pending top-up for the full refund exists; the old
      // Approved 5000 is untouched; the booking stays Paid.
      const pending = await Approval.findOne({ supplier: fixture.supplier._id, subject: fixture.booking._id.toString(), status: bookcarsTypes.ApprovalDecision.Pending }).lean()
      expect(pending).toBeDefined()
      expect(pending!.amount).toBe(12000)
      const approved = await Approval.findOne({ supplier: fixture.supplier._id, subject: fixture.booking._id.toString(), status: bookcarsTypes.ApprovalDecision.Approved }).lean()
      expect(approved).toBeDefined()
      expect(approved!.amount).toBe(5000)
      expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Paid)
      // Retrying while the top-up is pending reports PENDING (the
      // top-up is now the latest approval), not REQUIRED again.
      const again = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'R6-19 test cancel retry', refundDecision: 'full' })
      expect(again.status).toBe(409)
      expect(again.text).toContain('CANCEL_APPROVAL_PENDING')
      // Approve the top-up: the next cancel goes through and refunds.
      await Approval.updateOne({ _id: pending!._id }, { $set: { status: bookcarsTypes.ApprovalDecision.Approved } })
      const done = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'R6-19 test cancel after approval', refundDecision: 'full' })
      expect(done.status).toBe(200)
      expect(done.body.refund.status).toBe('refunded')
      expect(done.body.refund.refundedRent).toBe(12000)
    } finally {
      await Approval.deleteMany({ supplier: fixture.supplier._id, subject: fixture.booking._id.toString() })
    }
  })

  it('an Approved 12000 against a 12000 refund cancels directly (control)', async () => {
    const fixture = await makeFixture('r619-control', { status: bookcarsTypes.BookingStatus.Paid, rentalTotal: 12000, amountDueNow: 12000 })
    await postPaid(fixture.booking, bookcarsTypes.RentalPaymentPurpose.Rent, 12000, 'stripe', 'pi_r6_19_control')
    await Approval.create({
      supplier: fixture.supplier._id, subject: fixture.booking._id.toString(), subjectType: 'booking-cancel',
      amount: 12000, currency: 'MAD', status: bookcarsTypes.ApprovalDecision.Approved,
      requestedBy: adminId, reason: 'R6-19 control seed',
    })
    try {
      const done = await cancelAsAdmin(fixture.booking._id.toString(), { reason: 'R6-19 control cancel', refundDecision: 'full' })
      expect(done.status).toBe(200)
      expect(done.body.refund.status).toBe('refunded')
    } finally {
      await Approval.deleteMany({ supplier: fixture.supplier._id, subject: fixture.booking._id.toString() })
    }
  })
})
