import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import crypto from 'node:crypto'
import Stripe from 'stripe'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import Invoice from '../src/models/Invoice'
import Notification from '../src/models/Notification'
import NotificationDelivery from '../src/models/NotificationDelivery'
import MaintenanceSchedule from '../src/models/MaintenanceSchedule'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// The app + sweeper are imported dynamically in beforeAll, AFTER the
// provider/mail mocks below are registered. With native ESM Jest, a
// static `import app` would load bookingController (and the real Stripe
// client + mailer) before the mock registrations execute, so the mocks
// would never apply.

// Workstream A, cluster F2 — Stripe webhook + checkout sweeper
// (W4 GAP-04), following the providerCurrent / finalisationIntegrity
// harness. Every test uses mocked providers (no Stripe/PayPal
// credentials, no live money) against the real Mongo-backed app.

const stripeSessionRetrieve: any = jest.fn()
const stripeIntentRetrieve: any = jest.fn()
const stripeRefundCreate: any = jest.fn()
// R5-01 - charge retrieve, for the already-refunded intent check.
const stripeChargeRetrieve: any = jest.fn()
const stripeCustomersList: any = jest.fn()
const stripeCustomersCreate: any = jest.fn()
const stripeSessionCreate: any = jest.fn()
const paypalGetOrder: any = jest.fn()
const paypalRefundCapture: any = jest.fn()
const mailSendMock: any = jest.fn(async () => ({}))

// The webhook signature is verified for real: the mock's constructEvent
// delegates to a genuine Stripe instance (dummy key, no network), and
// the tests sign payloads with HMAC-SHA256 exactly as Stripe does.
const realStripe = new Stripe('sk_test_f2_dummy')
const WEBHOOK_SECRET = 'whsec_f2_test_secret'

jest.unstable_mockModule('../src/payment/stripe.js', () => ({
  default: {
    checkout: {
      sessions: { retrieve: stripeSessionRetrieve, create: stripeSessionCreate },
    },
    customers: { list: stripeCustomersList, create: stripeCustomersCreate },
    paymentIntents: { retrieve: stripeIntentRetrieve },
    refunds: { create: stripeRefundCreate },
    charges: { retrieve: stripeChargeRetrieve },
    webhooks: {
      constructEvent: (payload: string | Buffer, header: string | string[], secret: string) =>
        realStripe.webhooks.constructEvent(payload, header, secret),
    },
  },
}))
jest.unstable_mockModule('../src/payment/paypal.js', () => ({
  getOrder: paypalGetOrder,
  refundCapture: paypalRefundCapture,
}))
jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: mailSendMock,
}))

// R3-13 — mock logger (gh33 pattern) so the error-vs-warn de-noise
// is observable synchronously and deterministically.
const loggerWarnMock: any = jest.fn()
const loggerErrorMock: any = jest.fn()
const loggerInfoMock: any = jest.fn()

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  info: loggerInfoMock,
  warn: loggerWarnMock,
  error: loggerErrorMock,
  enableLogging: jest.fn(),
  disableLogging: jest.fn(),
  enableErrorLogging: jest.fn(),
  disableErrorLogging: jest.fn(),
}))

let app: any
let runCheckoutSweep: (now?: Date) => Promise<any>
let reconcileOneVoidBooking: (booking: any, now?: Date, heldThisPass?: Set<string>) => Promise<any>
let ledger: any

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixtureScheduleIds: mongoose.Types.ObjectId[] = []

type SnapshotAmounts = { rentalTotal: number, depositAmount: number, amountDueNow: number }

const makeFixture = async (
  label: string,
  mode: bookcarsTypes.CheckoutPaymentMode,
  amounts: SnapshotAmounts,
  opts: {
    paymentCurrency?: string
    amountDueNowInPaymentCurrency?: number
    fxRate?: number
    fxSource?: string
    sessionId?: string | null
    paymentIntentId?: string | null
    paypalOrderId?: string | null
    expireAt?: Date
  } = {},
) => {
  const supplier = await User.create({
    email: `f2-supplier-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F2 Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `f2-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F2 Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
    expireAt: new Date(Date.now() + 3600000),
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `F2 Casablanca Airport ${label}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: `F2 car ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: amounts.depositAmount, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  const paymentCurrency = opts.paymentCurrency || 'MAD'
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(Date.now() + 86400000), to: new Date(Date.now() + 3 * 86400000),
    status: bookcarsTypes.BookingStatus.Void, price: amounts.rentalTotal,
    sessionId: opts.sessionId === null ? undefined : (opts.sessionId || `cs_test_f2_${rand()}`),
    paymentIntentId: opts.paymentIntentId || undefined,
    paypalOrderId: opts.paypalOrderId || undefined,
    expireAt: opts.expireAt || new Date(Date.now() + 3600000),
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency, mode,
      rentalTotal: amounts.rentalTotal, depositAmount: amounts.depositAmount,
      amountDueNow: amounts.amountDueNow,
      amountDueNowInPaymentCurrency: opts.amountDueNowInPaymentCurrency ?? amounts.amountDueNow,
      quotedAt: new Date(),
      ...(opts.fxRate !== undefined ? { fxRate: opts.fxRate, fxSource: opts.fxSource || 'easy-currencies', fxAt: new Date() } : {}),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
  return { supplier, driver, location, car, booking }
}

const mockStripeIntentSuccess = (intentId: string, bookingId: string, currency: string, amountMinor: number) => {
  stripeIntentRetrieve.mockResolvedValue({
    id: intentId, status: 'succeeded',
    metadata: { bookingId },
    currency, amount_received: amountMinor,
  })
}

const mockStripeSessionPaid = (booking: any, intentId: string, currency: string, amountMinor: number) => {
  stripeSessionRetrieve.mockResolvedValue({
    id: booking.sessionId, payment_status: 'paid',
    metadata: { bookingId: booking._id.toString() },
    currency: currency.toLowerCase(), amount_total: amountMinor, payment_intent: intentId,
  })
  mockStripeIntentSuccess(intentId, booking._id.toString(), currency, amountMinor)
}

// R6-01 - opts model a refunded capture: `captureStatus` for the
// REFUNDED / PARTIALLY_REFUNDED status signal, `refunds` for the
// order payload's payments.refunds array (the capture itself still
// reads COMPLETED with its gross amount).
const mockPayPalOrder = (orderId: string, bookingId: string, status: string, amount: string, captureAmount?: string, currency = 'MAD', opts: {
  captureStatus?: string
  refunds?: Array<{ id?: string, status?: string, amount?: { currency_code?: string, value?: string } }>
} = {}) => {
  paypalGetOrder.mockResolvedValue({
    id: orderId, status,
    purchase_units: [{
      invoice_id: bookingId,
      amount: { currency_code: currency, value: amount },
      payments: status === 'COMPLETED'
        ? {
          captures: [{ id: `cap-f2-${rand()}`, status: opts.captureStatus || 'COMPLETED', amount: { currency_code: currency, value: captureAmount ?? amount } }],
          ...(opts.refunds ? { refunds: opts.refunds } : {}),
        }
        : {},
    }],
  })
}

const signPayload = (payload: string, secret: string = WEBHOOK_SECRET) => {
  const t = Math.floor(Date.now() / 1000)
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
  return `t=${t},v1=${v1}`
}

const postWebhookEvent = (type: string, object: any, signature?: string | null) => {
  const payload = JSON.stringify({ id: `evt-f2-${rand()}`, type, data: { object } })
  const req = request(app).post('/api/stripe/webhook').set('Content-Type', 'application/json')
  if (signature === undefined) {
    req.set('stripe-signature', signPayload(payload))
  } else if (signature !== null) {
    req.set('stripe-signature', signature)
  }
  return req.send(payload)
}

const paymentsOf = async (bookingId: mongoose.Types.ObjectId) =>
  RentalPayment.find({ booking: bookingId }).sort({ purpose: 1 }).lean()

beforeAll(async () => {
  // The handler reads the secret per request (live process.env read),
  // so setting it here — before any webhook request — is enough.
  process.env.BC_STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  app = (await import('../src/app')).default
  runCheckoutSweep = (await import('../src/utils/checkoutSweeper')).runCheckoutSweep
  reconcileOneVoidBooking = (await import('../src/utils/checkoutSweeper')).reconcileOneVoidBooking
  ledger = await import('../src/utils/ledger')
  await databaseHelper.connect(env.DB_URI, false, false)
})
afterAll(async () => {
  await databaseHelper.close()
})
afterEach(async () => {
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Invoice.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Notification.deleteMany({ booking: { $in: fixtureBookingIds } })
  // R6-28 — the hold notifiers write delivery rows (auto.holdReview);
  // they are fixture-scoped by subjectId, so they clean up here.
  await NotificationDelivery.deleteMany({ subjectId: { $in: fixtureBookingIds.map((id) => id.toString()) } })
  await MaintenanceSchedule.deleteMany({ _id: { $in: fixtureScheduleIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  fixtureBookingIds.length = 0
  fixtureScheduleIds.length = 0
  fixtureCarIds.length = 0
  fixtureLocationIds.length = 0
  fixtureLocationValueIds.length = 0
  fixtureUserIds.length = 0
  // resetAllMocks (not clearAllMocks): per-test mock implementations
  // must not leak into the next test. The constructEvent mock is a
  // plain function, not a jest.fn, so it survives the reset.
  jest.resetAllMocks()
  mailSendMock.mockResolvedValue({})
  process.env.BC_STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
})

describe('F2 — Stripe webhook finalises a paid checkout without the browser (W4 GAP-04)', () => {
  it('finalises a paid EUR checkout on a validly signed checkout.session.completed event', async () => {
    const fixture = await makeFixture('webhook-eur', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { paymentCurrency: 'EUR', amountDueNowInPaymentCurrency: 115, fxRate: 0.092 })
    mockStripeIntentSuccess('pi_f2_webhook_eur', fixture.booking._id.toString(), 'EUR', 11500)
    stripeRefundCreate.mockResolvedValue({ id: 're_f2_webhook_eur' })
    const response = await postWebhookEvent('checkout.session.completed', {
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'eur', amount_total: 11500, payment_intent: 'pi_f2_webhook_eur',
    })
    expect(response.status).toBe(200)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.PaidInFull)
    expect(booking?.expireAt).toBeUndefined()
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(2)
    const rent = payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Rent)
    const deposit = payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit)
    expect(rent?.amount).toBe(1000)
    expect(rent?.settledAmount).toBe(92)
    expect(rent?.settledCurrency).toBe('EUR')
    expect(rent?.fxRate).toBe(0.092)
    expect(deposit?.amount).toBe(250)
    expect(deposit?.settledAmount).toBe(23)
    expect(deposit?.settledCurrency).toBe('EUR')
    expect(stripeRefundCreate).not.toHaveBeenCalled()
  })

  it('is idempotent: a redelivered event does not finalise or post twice', async () => {
    const fixture = await makeFixture('webhook-redeliver', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    mockStripeIntentSuccess('pi_f2_redeliver', fixture.booking._id.toString(), 'MAD', 125000)
    const event = {
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'mad', amount_total: 125000, payment_intent: 'pi_f2_redeliver',
    }
    expect((await postWebhookEvent('checkout.session.completed', event)).status).toBe(200)
    expect((await postWebhookEvent('checkout.session.completed', event)).status).toBe(200)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.PaidInFull)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(2)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
  })

  it('rejects an event with an invalid signature and leaves the booking Void', async () => {
    const fixture = await makeFixture('webhook-badsig', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    mockStripeIntentSuccess('pi_f2_badsig', fixture.booking._id.toString(), 'MAD', 125000)
    const response = await postWebhookEvent('checkout.session.completed', {
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'mad', amount_total: 125000, payment_intent: 'pi_f2_badsig',
    }, 't=1234567890,v1=deadbeef')
    expect(response.status).toBe(400)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('rejects an event with no signature header', async () => {
    const fixture = await makeFixture('webhook-nosig', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    const response = await postWebhookEvent('checkout.session.completed', {
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'mad', amount_total: 125000, payment_intent: 'pi_f2_nosig',
    }, null)
    expect(response.status).toBe(400)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
  })

  it('fails closed with 503 when the webhook secret is not configured', async () => {
    const fixture = await makeFixture('webhook-nosecret', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    process.env.BC_STRIPE_WEBHOOK_SECRET = ''
    try {
      const response = await postWebhookEvent('checkout.session.completed', {
        id: fixture.booking.sessionId, payment_status: 'paid',
        metadata: { bookingId: fixture.booking._id.toString() },
        currency: 'mad', amount_total: 125000, payment_intent: 'pi_f2_nosecret',
      })
      expect(response.status).toBe(503)
    } finally {
      process.env.BC_STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    }
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
  })

  it('finalises a PaymentSheet booking on payment_intent.succeeded', async () => {
    const fixture = await makeFixture('webhook-intent', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `f2-random-${rand()}`, paymentIntentId: 'pi_f2_sheet' })
    const response = await postWebhookEvent('payment_intent.succeeded', {
      id: 'pi_f2_sheet', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'MAD', amount_received: 100000,
    })
    expect(response.status).toBe(200)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(1)
  })

  it('refunds on amount mismatch and still acknowledges the event with 200', async () => {
    const fixture = await makeFixture('webhook-mismatch', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    mockStripeIntentSuccess('pi_f2_mismatch', fixture.booking._id.toString(), 'MAD', 99900)
    stripeRefundCreate.mockResolvedValue({ id: 're_f2_mismatch' })
    const response = await postWebhookEvent('checkout.session.completed', {
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'mad', amount_total: 99900, payment_intent: 'pi_f2_mismatch',
    })
    expect(response.status).toBe(200)
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_f2_mismatch' },
      { idempotencyKey: 'refund-pi_f2_mismatch-mismatch' },
    )
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('refunds an orphan paid session whose booking is gone', async () => {
    const goneBookingId = oid().toString()
    mockStripeIntentSuccess('pi_f2_orphan', goneBookingId, 'MAD', 125000)
    stripeRefundCreate.mockResolvedValue({ id: 're_f2_orphan' })
    const response = await postWebhookEvent('checkout.session.completed', {
      id: `cs-f2-orphan-${rand()}`, payment_status: 'paid',
      metadata: { bookingId: goneBookingId },
      currency: 'mad', amount_total: 125000, payment_intent: 'pi_f2_orphan',
    })
    expect(response.status).toBe(200)
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_f2_orphan' },
      { idempotencyKey: 'orphan-session-pi_f2_orphan' },
    )
  })

  it('R6-06 (a) a Void booking moved to Cancelled while its payment is in flight is refunded, not reported already-finalised', async () => {
    const fixture = await makeFixture('r606-cancelled', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeIntentSuccess('pi_r606_cancelled', fixture.booking._id.toString(), 'MAD', 125000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r606_cancelled' })
    // Staff bulk-cancels the Void checkout while the payment is in
    // flight (updateStatus allows Void -> Cancelled). Pre-fix the
    // late webhook answered already-finalized and no refund was ever
    // issued for the cancelled booking.
    await Booking.updateOne({ _id: fixture.booking._id }, { $set: { status: bookcarsTypes.BookingStatus.Cancelled } })
    const response = await postWebhookEvent('checkout.session.completed', {
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'mad', amount_total: 125000, payment_intent: 'pi_r606_cancelled',
    })
    expect(response.status).toBe(200)
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_r606_cancelled' },
      { idempotencyKey: 'booking-unavailable-pi_r606_cancelled' },
    )
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Cancelled)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-06 (b) a Void booking moved to Pending reconciles to refund, not already-finalised', async () => {
    const fixture = await makeFixture('r606-pending', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeIntentSuccess('pi_r606_pending', fixture.booking._id.toString(), 'MAD', 125000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r606_pending' })
    await Booking.updateOne({ _id: fixture.booking._id }, { $set: { status: bookcarsTypes.BookingStatus.Pending } })
    const response = await postWebhookEvent('checkout.session.completed', {
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'mad', amount_total: 125000, payment_intent: 'pi_r606_pending',
    })
    expect(response.status).toBe(200)
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_r606_pending' },
      { idempotencyKey: 'booking-unavailable-pi_r606_pending' },
    )
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-06 (c) a genuinely Paid booking still returns already-finalised, with no refund', async () => {
    const fixture = await makeFixture('r606-paid', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeIntentSuccess('pi_r606_paid', fixture.booking._id.toString(), 'MAD', 125000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r606_paid' })
    await Booking.updateOne({ _id: fixture.booking._id }, { $set: { status: bookcarsTypes.BookingStatus.Paid } })
    const response = await postWebhookEvent('checkout.session.completed', {
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'mad', amount_total: 125000, payment_intent: 'pi_r606_paid',
    })
    expect(response.status).toBe(200)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('acknowledges and ignores unknown event types', async () => {
    const response = await postWebhookEvent('customer.created', { id: `cus_f2_${rand()}` })
    expect(response.status).toBe(200)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
  })
})

describe('F2 — checkout sweeper reconciles expired Void bookings (W4 GAP-04)', () => {
  it('finalises an expired Void Stripe booking whose session is paid', async () => {
    const fixture = await makeFixture('sweep-stripe', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_f2_sweep', 'MAD', 125000)
    stripeRefundCreate.mockResolvedValue({ id: 're_f2_sweep' })
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.finalized).toBe(1)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.PaidInFull)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(2)
  })

  it('finalises an expired Void PaymentSheet booking from its intent', async () => {
    const fixture = await makeFixture('sweep-intent', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `f2-random-${rand()}`, paymentIntentId: 'pi_f2_sweep_intent', expireAt: new Date(Date.now() - 3600000) })
    mockStripeIntentSuccess('pi_f2_sweep_intent', fixture.booking._id.toString(), 'MAD', 100000)
    const summary = await runCheckoutSweep()
    expect(summary.finalized).toBe(1)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
  })

  it('leaves an expired Void booking alone when its session never paid', async () => {
    const fixture = await makeFixture('sweep-unpaid', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    stripeSessionRetrieve.mockResolvedValue({
      id: fixture.booking.sessionId, payment_status: 'unpaid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'mad', amount_total: 125000, payment_intent: 'pi_f2_unpaid',
    })
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.notPaid).toBe(1)
    expect(summary.finalized).toBe(0)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
  })

  it('does not touch a Void booking whose expiry has not passed yet', async () => {
    const fixture = await makeFixture('sweep-unexpired', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() + 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_f2_unexpired', 'MAD', 125000)
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(0)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(stripeSessionRetrieve).not.toHaveBeenCalled()
  })

  it('refunds an expired Void booking whose paid session mismatches the snapshot', async () => {
    const fixture = await makeFixture('sweep-mismatch', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_f2_sweep_mismatch', 'MAD', 99900)
    stripeRefundCreate.mockResolvedValue({ id: 're_f2_sweep_mismatch' })
    const summary = await runCheckoutSweep()
    expect(summary.refunded).toBe(1)
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_f2_sweep_mismatch' },
      { idempotencyKey: 'refund-pi_f2_sweep_mismatch-mismatch' },
    )
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
  })

  it('is safe to run twice: a re-swept refunded booking is skipped by the refunded marker (R6-23), never re-refunds, expireAt unrefreshed', async () => {
    const fixture = await makeFixture('sweep-twice', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_f2_sweep_twice', 'MAD', 99900)
    stripeRefundCreate.mockResolvedValue({ id: 're_f2_sweep_twice' })
    const first = await runCheckoutSweep()
    expect(first.refunded).toBe(1)
    const afterFirst = await Booking.findById(fixture.booking._id).lean()
    // R6-23 — the refunded arm stamps the terminal 'refunded'
    // marker, and the sweep query skips it: the R5-01 pack's
    // "absent from the next sweep's checked" IS achievable now
    // (the old fix-forward note above is superseded). The second
    // sweep sees nothing — no second refund, no expireAt refresh —
    // so the TTL still fires ~70 min after the refund and the car
    // stays free. No provider read is needed for the skip.
    expect(afterFirst?.reconciliationStatus).toBe('refunded')
    const second = await runCheckoutSweep()
    expect(second.checked).toBe(0)
    expect(second.notPaid).toBe(0)
    expect(second.refunded).toBe(0)
    expect(stripeRefundCreate).toHaveBeenCalledTimes(1)
    expect(stripeRefundCreate.mock.calls[0][1]).toEqual({ idempotencyKey: 'refund-pi_f2_sweep_twice-mismatch' })
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    // R5-01 - the refund no longer clears expireAt to null (null
    // matches the sweep $lte and never TTL-deletes); it is set to the
    // sweep's now, so the record TTL-cleans ~70 min later - and the
    // second sweep must NOT refresh it (a not-paid outcome has no
    // side effect in reconcileOneVoidBooking).
    expect(booking?.expireAt).not.toBeNull()
    expect(Math.abs(new Date(booking?.expireAt as unknown as Date).getTime() - Date.now())).toBeLessThan(60_000)
    expect(new Date(booking?.expireAt as unknown as Date).getTime())
      .toBe(new Date(afterFirst?.expireAt as unknown as Date).getTime())
  })

  it('finalises an expired Void PayPal booking whose order completed', async () => {
    const fixture = await makeFixture('sweep-paypal', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { paypalOrderId: 'order-f2-sweep', expireAt: new Date(Date.now() - 3600000) })
    mockPayPalOrder('order-f2-sweep', fixture.booking._id.toString(), 'COMPLETED', '1250.00')
    const summary = await runCheckoutSweep()
    expect(summary.finalized).toBe(1)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.PaidInFull)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(2)
  })

  it('refunds an expired Void PayPal booking whose capture mismatches', async () => {
    const fixture = await makeFixture('sweep-paypal-mismatch', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { paypalOrderId: 'order-f2-sweep-mismatch', expireAt: new Date(Date.now() - 3600000) })
    const captureId = `cap-f2-${rand()}`
    paypalGetOrder.mockResolvedValue({
      id: 'order-f2-sweep-mismatch', status: 'COMPLETED',
      purchase_units: [{
        invoice_id: fixture.booking._id.toString(),
        amount: { currency_code: 'MAD', value: '1250.00' },
        payments: { captures: [{ id: captureId, status: 'COMPLETED', amount: { currency_code: 'MAD', value: '1200.00' } }] },
      }],
    })
    paypalRefundCapture.mockResolvedValue({})
    const summary = await runCheckoutSweep()
    expect(summary.refunded).toBe(1)
    expect(paypalRefundCapture).toHaveBeenCalledWith(captureId, `refund-${captureId}-mismatch`)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
  })

  it('leaves an expired Void PayPal booking alone while its order is not completed', async () => {
    const fixture = await makeFixture('sweep-paypal-open', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { paypalOrderId: 'order-f2-sweep-open', expireAt: new Date(Date.now() - 3600000) })
    mockPayPalOrder('order-f2-sweep-open', fixture.booking._id.toString(), 'APPROVED', '1250.00')
    const summary = await runCheckoutSweep()
    expect(summary.notPaid).toBe(1)
    expect(summary.finalized).toBe(0)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(paypalRefundCapture).not.toHaveBeenCalled()
  })

  it('skips an expired Void booking whose session id is not a retrievable Stripe reference', async () => {
    const fixture = await makeFixture('sweep-noref', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      // A random (non-Stripe) session id with no intent and no PayPal
      // order: the booking matches the sweep query (it has a sessionId)
      // but there is no provider object to retrieve.
      { sessionId: `f2-random-${rand()}`, expireAt: new Date(Date.now() - 3600000) })
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.skipped).toBe(1)
    expect(stripeSessionRetrieve).not.toHaveBeenCalled()
    expect(paypalGetOrder).not.toHaveBeenCalled()
  })

  it('does not finalise twice when the sweep runs again after finalising', async () => {
    const fixture = await makeFixture('sweep-again', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_f2_sweep_again', 'MAD', 125000)
    const first = await runCheckoutSweep()
    expect(first.finalized).toBe(1)
    const second = await runCheckoutSweep()
    expect(second.checked).toBe(0)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(2)
  })
})

describe('W2 remainder — 2.1 sweeper must not void a manager-confirmed hold (deploy blocker)', () => {
  it('does not void a confirmed hold (Pending, lifecycle Confirmed, expireAt null)', async () => {
    const fixture = await makeFixture('sweep-confirmed', bookcarsTypes.CheckoutPaymentMode.PayLater,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    // The state confirmReservation leaves behind: Pending + Confirmed
    // with the deadline cleared.
    await Booking.updateOne({ _id: fixture.booking._id }, {
      $set: { status: bookcarsTypes.BookingStatus.Pending, lifecycle: bookcarsTypes.ContractLifecycle.Confirmed, expireAt: null },
    })
    const summary = await runCheckoutSweep()
    expect(summary.expiredHolds).toBe(0)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    expect(booking?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Confirmed)
  })

  it('still voids an expired unconfirmed Draft hold', async () => {
    const fixture = await makeFixture('sweep-expired-hold', bookcarsTypes.CheckoutPaymentMode.PayLater,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    await Booking.updateOne({ _id: fixture.booking._id }, {
      $set: { status: bookcarsTypes.BookingStatus.Pending, lifecycle: bookcarsTypes.ContractLifecycle.Draft },
    })
    const summary = await runCheckoutSweep()
    expect(summary.expiredHolds).toBe(1)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
  })
})

// GH-32 — the sweeper must not throw away a paid booking whose
// confirmation is blocked: Path A holds the expired pay-later hold
// instead of voiding it, Path B holds a provider-paid Void booking
// instead of refunding it, and the held bookings surface on the
// confirmed-unpaid watchlist as paid-but-unconfirmed.
describe('GH-32 — sweeper holds paid-but-unconfirmed bookings', () => {
  const blockCar = async (supplierId: mongoose.Types.ObjectId, carId: mongoose.Types.ObjectId) => {
    const schedule = await MaintenanceSchedule.create({
      supplier: supplierId, car: carId,
      type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
      title: 'GH-32 overdue oil change',
      status: bookcarsTypes.MaintenanceScheduleStatus.Upcoming,
      nextDueDate: new Date(Date.now() - 86400000),
    } as any)
    fixtureScheduleIds.push(schedule._id)
    return schedule
  }

  // R5-02 / R5-04 / R5-05 — one admin token + one paid-unconfirmed
  // read, shared by the new tests (same boilerplate as the R4-02
  // filter test, factored out instead of copied five times).
  const makeAdminToken = async (label: string) => {
    const passwordHash = await authHelper.hashPassword('Un1tTest5')
    const admin = await User.create({
      fullName: label, email: `${label}-${rand()}@test.bookcars.ma`, language: 'en',
      password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
    })
    fixtureUserIds.push(admin._id)
    return authHelper.encryptJWT({ id: admin._id.toString() })
  }

  type PaidUnconfirmedRow = {
    booking: { _id: string } | string
    status?: string
    outstandingBalance?: number
    paidRent?: number
    depositHeld?: number
    depositDue?: number
    holdReason?: string
    holdDetail?: string
    // R6-28 — the chase history from the delivery log.
    lastRemindedAt?: string
    reminderCount?: number
    actions?: { canTakePayment: boolean, canConfirm: boolean }
  }

  const paidUnconfirmedRows = async (adminToken: string): Promise<PaidUnconfirmedRow[]> => {
    const res = await request(app)
      .get('/api/rental-payments/overdue')
      .query({ filter: 'paid-unconfirmed' })
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(200)
    return res.body.rows as PaidUnconfirmedRow[]
  }

  const rowFor = (rows: PaidUnconfirmedRow[], id: mongoose.Types.ObjectId) =>
    rows.find((r) => String((r.booking as any)?._id || r.booking) === id.toString())

  const holdsExpiringRows = async (adminToken: string): Promise<PaidUnconfirmedRow[]> => {
    const res = await request(app)
      .get('/api/rental-payments/overdue')
      .query({ filter: 'holds-expiring' })
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(200)
    return res.body.rows as PaidUnconfirmedRow[]
  }

  it('Path A: a fully-paid expired hold is held, not voided; an unpaid one still voids; the held row is on the watchlist', async () => {
    // Held booking: pay-later hold, expired, fully paid, car blocked.
    const held = await makeFixture('gh32-held', bookcarsTypes.CheckoutPaymentMode.PayLater,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    await Booking.updateOne({ _id: held.booking._id }, {
      $set: { status: bookcarsTypes.BookingStatus.Pending, lifecycle: bookcarsTypes.ContractLifecycle.Draft },
    })
    await blockCar(held.supplier._id, held.car._id)
    await ledger.postRentalPayment({
      bookingId: held.booking._id, date: new Date(), amount: 1000,
      currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
      purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
    })
    // The refresh conflict is real: the overdue schedule refuses the flip.
    const refresh = await ledger.refreshBookingPaymentStatus(held.booking._id)
    expect(refresh.conflict).toBe(true)
    expect(refresh.outstandingBalance).toBe(0)
    expect(refresh.status).toBe(bookcarsTypes.BookingStatus.Pending)

    // Control: an unpaid expired hold on a different car.
    const unpaid = await makeFixture('gh32-unpaid', bookcarsTypes.CheckoutPaymentMode.PayLater,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    await Booking.updateOne({ _id: unpaid.booking._id }, {
      $set: { status: bookcarsTypes.BookingStatus.Pending, lifecycle: bookcarsTypes.ContractLifecycle.Draft },
    })

    // R3-01 — the hold defuses the TTL: the new deadline is now +
    // review window (7d default), far past the 70-minute TTL fuse.
    mailSendMock.mockClear()
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(0)
    expect(summary.held).toBe(1)
    expect(summary.expiredHolds).toBe(1)
    const heldBooking = await Booking.findById(held.booking._id).lean()
    expect(heldBooking?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    expect(heldBooking?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Draft)
    const nowMs = Date.now()
    const newExpireAt = new Date(heldBooking?.expireAt as unknown as Date).getTime()
    expect(newExpireAt).toBeGreaterThan(nowMs + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000 - 5 * 60 * 1000)
    expect(newExpireAt).toBeLessThanOrEqual(nowMs + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000 + 5 * 60 * 1000)
    // R3-01 — the hold notifies the agency once: one in-app row for the
    // owner (with a View destination to the booking) and one email to
    // the owner — distinct from the unpaid control's expiry mail, which
    // goes to that booking's driver.
    const heldNotes = await Notification.find({ user: held.supplier._id, subjectType: 'booking', subjectId: held.booking._id.toString() }).lean()
    expect(heldNotes).toHaveLength(1)
    expect(heldNotes[0].booking?.toString()).toBe(held.booking._id.toString())
    const heldMail = mailSendMock.mock.calls.filter((c: any) => c[0]?.to === held.supplier.email)
    expect(heldMail).toHaveLength(1)
    expect(heldMail[0][0].subject).toMatch(/held for manual review/)
    const unpaidMail = mailSendMock.mock.calls.filter((c: any) => c[0]?.to === unpaid.driver.email)
    expect(unpaidMail).toHaveLength(1)
    // R3-01 — the extension gates re-holding: an immediate second sweep
    // sees nothing (the held booking's deadline is 7 days out) and
    // notifies no second time.
    const secondSweep = await runCheckoutSweep()
    expect(secondSweep.held).toBe(0)
    expect(secondSweep.expiredHolds).toBe(0)
    expect((await Notification.find({ user: held.supplier._id, subjectType: 'booking', subjectId: held.booking._id.toString() }).lean())).toHaveLength(1)
    const unpaidBooking = await Booking.findById(unpaid.booking._id).lean()
    expect(unpaidBooking?.status).toBe(bookcarsTypes.BookingStatus.Void)

    // The held row surfaces on the watchlist, flagged paid-but-unconfirmed.
    const passwordHash = await authHelper.hashPassword('Un1tTest5')
    const admin = await User.create({
      fullName: 'gh32-admin', email: `gh32-admin-${rand()}@test.bookcars.ma`, language: 'en',
      password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
    })
    fixtureUserIds.push(admin._id)
    const adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })
    const watchlist = await request(app)
      .post('/api/confirmed-unpaid-bookings/1/10/en')
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ suppliers: [held.supplier._id.toString()] })
    expect(watchlist.status).toBe(200)
    const rows = watchlist.body[0].resultData as Array<{ booking: { _id: string }, outstandingBalance: number, paidButUnconfirmed?: boolean }>
    const row = rows.find((r) => r.booking._id === held.booking._id.toString())
    expect(row).toBeDefined()
    expect(row?.outstandingBalance).toBe(0)
    expect(row?.paidButUnconfirmed).toBe(true)
    expect(rows.some((r) => r.booking._id === unpaid.booking._id.toString())).toBe(false)
  })

  it('Path B: a provider-paid Void booking whose finalisation conflicts is held, not refunded; the next tick finalises it once the blocker clears', async () => {
    const fixture = await makeFixture('gh32-pathb', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `gh32-random-${rand()}`, paymentIntentId: 'pi_gh32_held', expireAt: new Date(Date.now() - 3600000) })
    const schedule = await blockCar(fixture.supplier._id, fixture.car._id)
    mockStripeIntentSuccess('pi_gh32_held', fixture.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_gh32_held' })

    const first = await runCheckoutSweep()
    expect(first.checked).toBe(1)
    expect(first.held).toBe(1)
    expect(first.refunded).toBe(0)
    expect(first.finalized).toBe(0)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
    const heldBooking = await Booking.findById(fixture.booking._id).lean()
    expect(heldBooking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
    // R3-01 — the hold defuses the TTL (new deadline now + review
    // window) and notifies the agency once.
    const nowMs = Date.now()
    const newExpireAt = new Date(heldBooking?.expireAt as unknown as Date).getTime()
    expect(newExpireAt).toBeGreaterThan(nowMs + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000 - 5 * 60 * 1000)
    expect(newExpireAt).toBeLessThanOrEqual(nowMs + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000 + 5 * 60 * 1000)
    const heldNotes = await Notification.find({ user: fixture.supplier._id, subjectType: 'booking', subjectId: fixture.booking._id.toString() }).lean()
    expect(heldNotes).toHaveLength(1)
    expect(heldNotes[0].booking?.toString()).toBe(fixture.booking._id.toString())

    // The blocker clears; the next tick finalises instead of refunding.
    // R3-01 — the tick must run past the extended deadline: the hold
    // dropped the booking out of the sweep queries until then, so an
    // immediate second sweep would see nothing.
    await MaintenanceSchedule.deleteOne({ _id: schedule._id })
    const second = await runCheckoutSweep(new Date(Date.now() + 8 * 86400000))
    expect(second.checked).toBe(1)
    expect(second.finalized).toBe(1)
    expect(second.held).toBe(0)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
    const finalBooking = await Booking.findById(fixture.booking._id).lean()
    expect(finalBooking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(1)
    expect(payments[0].amount).toBe(1000)
  })

  it('Path C: the extended deadline sits far beyond the 70-minute TTL window (no wall-clock TTL wait)', async () => {
    // Same shape as Path A: pay-later hold, expired, fully paid, car blocked.
    const held = await makeFixture('gh32-ttlm', bookcarsTypes.CheckoutPaymentMode.PayLater,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    await Booking.updateOne({ _id: held.booking._id }, {
      $set: { status: bookcarsTypes.BookingStatus.Pending, lifecycle: bookcarsTypes.ContractLifecycle.Draft },
    })
    await blockCar(held.supplier._id, held.car._id)
    await ledger.postRentalPayment({
      bookingId: held.booking._id, date: new Date(), amount: 1000,
      currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
      purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
    })
    const refresh = await ledger.refreshBookingPaymentStatus(held.booking._id)
    expect(refresh.conflict).toBe(true)

    await runCheckoutSweep()
    const heldBooking = await Booking.findById(held.booking._id).lean()
    expect(heldBooking?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    const marginMs = new Date(heldBooking?.expireAt as unknown as Date).getTime() - Date.now()
    // The TTL would fire at expireAt + BOOKING_EXPIRE_AT (4200 s); the
    // new deadline is ~7 days out — orders of magnitude beyond it. No
    // wall-clock TTL wait: the TTL monitor's 60 s cadence makes a real
    // wait test slow and flaky; the mechanism assertion is the proof.
    expect(marginMs).toBeGreaterThan(env.BOOKING_EXPIRE_AT * 1000)
    expect(marginMs).toBeLessThanOrEqual(env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000 + 5 * 60 * 1000)
  })

  it('R3-10 an overpaid Draft+Pending hold is served by paid-unconfirmed (outstandingBalance 0, paidRent over contractTotal)', async () => {
    // Same shape as Path A, then overpaid: 1000 rent via the ledger
    // (fully paid) + a duplicate 500 rent by direct insert (the
    // ledger refuses overpayment, so the duplicate cannot go through
    // postRentalPayment). The receivable clamps outstandingBalance at
    // 0 and reports the excess as overpaidAmount; the row therefore
    // carries outstandingBalance 0 with paidRent 1500 > contractTotal 1000.
    const held = await makeFixture('r310-overpaid', bookcarsTypes.CheckoutPaymentMode.PayLater,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    await Booking.updateOne({ _id: held.booking._id }, {
      $set: { status: bookcarsTypes.BookingStatus.Pending, lifecycle: bookcarsTypes.ContractLifecycle.Draft },
    })
    await blockCar(held.supplier._id, held.car._id)
    await ledger.postRentalPayment({
      bookingId: held.booking._id, date: new Date(), amount: 1000,
      currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
      purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
    })
    await RentalPayment.create({
      supplier: held.supplier._id, booking: held.booking._id, date: new Date(), amount: 500,
      currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
      purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
      direction: bookcarsTypes.RentalPaymentDirection.Credit, source: bookcarsTypes.RentalPaymentSource.Manual,
      status: bookcarsTypes.RentalPaymentStatus.Posted,
    } as any)
    const refresh = await ledger.refreshBookingPaymentStatus(held.booking._id)
    expect(refresh.conflict).toBe(true)
    expect(refresh.outstandingBalance).toBe(0)

    const passwordHash = await authHelper.hashPassword('Un1tTest5')
    const admin = await User.create({
      fullName: 'r310-admin', email: `r310-admin-${rand()}@test.bookcars.ma`, language: 'en',
      password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
    })
    fixtureUserIds.push(admin._id)
    const adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })
    const res = await request(app)
      .get('/api/rental-payments/overdue')
      .query({ filter: 'paid-unconfirmed' })
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(200)
    const rows = res.body.rows as Array<{ booking: { _id: string } | string, outstandingBalance: number, paidRent: number, overpaidAmount: number, contractTotal: number, lifecycle: string, status: string }>
    const row = rows.find((r) => String((r.booking as any)?._id || r.booking) === held.booking._id.toString())
    expect(row).toBeDefined()
    expect(row?.outstandingBalance).toBe(0)
    expect(row?.paidRent).toBe(1500)
    // R5-08 — the row now surfaces the ledger's overpaidAmount (500),
    // instead of leaving the manager to subtract paidRent - contractTotal.
    expect(row?.overpaidAmount).toBe(500)
    expect(row?.contractTotal).toBe(1000)
    expect(row?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Draft)
    expect(row?.status).toBe(bookcarsTypes.BookingStatus.Pending)
  })

  it('R3-13 a re-held booking logs error once, then warn (expired-holds loop)', async () => {
    // Same shape as Path A: pay-later hold, expired, fully paid, car blocked.
    const held = await makeFixture('gh32-r313', bookcarsTypes.CheckoutPaymentMode.PayLater,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    await Booking.updateOne({ _id: held.booking._id }, {
      $set: { status: bookcarsTypes.BookingStatus.Pending, lifecycle: bookcarsTypes.ContractLifecycle.Draft },
    })
    await blockCar(held.supplier._id, held.car._id)
    await ledger.postRentalPayment({
      bookingId: held.booking._id, date: new Date(), amount: 1000,
      currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
      purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
    })
    const refresh = await ledger.refreshBookingPaymentStatus(held.booking._id)
    expect(refresh.conflict).toBe(true)

    // First sight: this booking is held, and it logs error (not warn).
    // Assertions are per-booking-id: earlier tests leave other holds
    // that the same sweeps also hold, so the summary counts are not exact.
    const idStr = held.booking._id.toString()
    const callsFor = (mock: any) => mock.mock.calls.filter((c: any) => String(c[0]).includes(idStr))
    loggerErrorMock.mockClear()
    loggerWarnMock.mockClear()
    const first = await runCheckoutSweep()
    expect(first.held).toBeGreaterThanOrEqual(1)
    const heldBooking = await Booking.findById(held.booking._id).lean()
    expect(heldBooking?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    expect(new Date(heldBooking?.expireAt as unknown as Date).getTime()).toBeGreaterThan(Date.now())
    const firstErrors = callsFor(loggerErrorMock)
    expect(firstErrors).toHaveLength(1)
    // The expired-holds message says 'fully paid but unconfirmed ...
    // needs manual review' — it never contains 'held for manual review'.
    expect(firstErrors[0][0]).toMatch(/fully paid but unconfirmed/)
    expect(callsFor(loggerWarnMock)).toHaveLength(0)

    // The extension drops the booking out of the sweep queries until
    // the review window lapses, so the re-hold needs now + 8 days
    // (past the 7-day window). This time it logs warn, not error.
    loggerErrorMock.mockClear()
    loggerWarnMock.mockClear()
    const second = await runCheckoutSweep(new Date(Date.now() + 8 * 86400000))
    expect(second.held).toBeGreaterThanOrEqual(1)
    const stillHeld = await Booking.findById(held.booking._id).lean()
    expect(stillHeld?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    expect(callsFor(loggerErrorMock)).toHaveLength(0)
    const secondWarns = callsFor(loggerWarnMock)
    expect(secondWarns).toHaveLength(1)
    expect(secondWarns[0][0]).toMatch(/still fully paid but unconfirmed/)
  })

  it('R4-02 a held Void booking is served by paid-unconfirmed (and by no other filter)', async () => {
    const fixture = await makeFixture('r402-filter', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r402-random-${rand()}`, paymentIntentId: 'pi_r402_filter', expireAt: new Date(Date.now() - 3600000) })
    await blockCar(fixture.supplier._id, fixture.car._id)
    mockStripeIntentSuccess('pi_r402_filter', fixture.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r402_filter' })

    const sweep = await runCheckoutSweep()
    expect(sweep.held).toBeGreaterThanOrEqual(1)
    const heldBooking = await Booking.findById(fixture.booking._id).lean()
    expect(heldBooking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(new Date(heldBooking?.expireAt as unknown as Date).getTime()).toBeGreaterThan(Date.now())

    const passwordHash = await authHelper.hashPassword('Un1tTest5')
    const admin = await User.create({
      fullName: 'r402-admin', email: `r402-admin-${rand()}@test.bookcars.ma`, language: 'en',
      password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
    })
    fixtureUserIds.push(admin._id)
    const adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })
    const res = await request(app)
      .get('/api/rental-payments/overdue')
      .query({ filter: 'paid-unconfirmed' })
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(200)
    const rows = res.body.rows as Array<{ booking: { _id: string } | string, outstandingBalance: number, paidRent: number, status: string, lifecycle: string }>
    const row = rows.find((r) => String((r.booking as any)?._id || r.booking) === fixture.booking._id.toString())
    expect(row).toBeDefined()
    expect(row?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(row?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Draft)
    // Provider-paid: the row previews the post-finalise ledger.
    expect(row?.outstandingBalance).toBe(0)
    expect(row?.paidRent).toBe(1000)

    // No other filter serves it: Void holds live in their own list.
    const paidInFull = await request(app)
      .get('/api/rental-payments/overdue')
      .query({ filter: 'paid-in-full' })
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(paidInFull.status).toBe(200)
    const otherRows = [...(paidInFull.body.rows as any[]), ...(paidInFull.body.paidInFullRows as any[])]
    expect(otherRows.some((r) => String((r.booking as any)?._id || r.booking) === fixture.booking._id.toString())).toBe(false)
  })

  it('R4-02 retrying a held Void booking conflicts while blocked, then finalises once the blocker clears', async () => {
    const fixture = await makeFixture('r402-retry', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r402-random-${rand()}`, paymentIntentId: 'pi_r402_retry', expireAt: new Date(Date.now() - 3600000) })
    const schedule = await blockCar(fixture.supplier._id, fixture.car._id)
    mockStripeIntentSuccess('pi_r402_retry', fixture.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r402_retry' })

    const sweep = await runCheckoutSweep()
    expect(sweep.held).toBeGreaterThanOrEqual(1)
    expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Void)

    const passwordHash = await authHelper.hashPassword('Un1tTest5')
    const admin = await User.create({
      fullName: 'r402-retry-admin', email: `r402-retry-admin-${rand()}@test.bookcars.ma`, language: 'en',
      password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
    })
    fixtureUserIds.push(admin._id)
    const adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })

    // Still blocked: the retry re-reconciles, re-holds, and reports the conflict.
    const blocked = await request(app)
      .post(`/api/bookings/${fixture.booking._id.toString()}/refresh-payment-status`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(blocked.status).toBe(200)
    expect(blocked.body.conflict).toBe(true)
    expect(blocked.body.updated).toBe(false)
    expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Void)

    // The blocker clears; the retry finalises instead of refunding.
    await MaintenanceSchedule.deleteOne({ _id: schedule._id })
    const retried = await request(app)
      .post(`/api/bookings/${fixture.booking._id.toString()}/refresh-payment-status`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(retried.status).toBe(200)
    expect(retried.body.conflict).toBe(false)
    expect(retried.body.updated).toBe(true)
    expect(retried.body.status).toBe(bookcarsTypes.BookingStatus.Paid)
    const finalBooking = await Booking.findById(fixture.booking._id).lean()
    expect(finalBooking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect(finalBooking?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Confirmed)
    expect(finalBooking?.expireAt).toBeFalsy()
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(1)
    expect(payments[0].amount).toBe(1000)

    // The row leaves the paid-unconfirmed queue.
    const res = await request(app)
      .get('/api/rental-payments/overdue')
      .query({ filter: 'paid-unconfirmed' })
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(200)
    const rows = res.body.rows as Array<{ booking: { _id: string } | string }>
    expect(rows.some((r) => String((r.booking as any)?._id || r.booking) === fixture.booking._id.toString())).toBe(false)
  })

  it('R5-01 (a) R6-23 — a re-swept refunded booking is skipped: checked 0, refunded does not grow, no second refund, marker stamped', async () => {
    // Existing mismatch fixture shape: paid session, amount mismatch.
    const fixture = await makeFixture('r501-once', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r501_once', 'MAD', 99900)
    stripeRefundCreate.mockResolvedValue({ id: 're_r501_once' })
    const first = await runCheckoutSweep()
    expect(first.refunded).toBe(1)
    expect(stripeRefundCreate).toHaveBeenCalledTimes(1)
    const afterFirst = await Booking.findById(fixture.booking._id).lean()
    // R6-23 — the refunded arm stamps the terminal 'refunded'
    // marker, and the sweep query skips it: the old R5-01
    // fix-forward note ("absent from the next sweep's checked" is
    // unachievable) is superseded — the marker is the lever that
    // makes it achievable. The second sweep sees nothing, so
    // `refunded` stops growing, no second refund is issued, and
    // expireAt is not refreshed - the TTL still fires ~70 min
    // after the refund. No provider read is needed for the skip.
    expect(afterFirst?.reconciliationStatus).toBe('refunded')
    const second = await runCheckoutSweep()
    expect(second.checked).toBe(0)
    expect(second.notPaid).toBe(0)
    expect(second.refunded).toBe(0)
    expect(stripeRefundCreate).toHaveBeenCalledTimes(1)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(new Date(booking?.expireAt as unknown as Date).getTime())
      .toBe(new Date(afterFirst?.expireAt as unknown as Date).getTime())
  })

  it('R5-01 (a2) R6-23 — same for the PaymentSheet intent path: a refunded booking is skipped on the next sweep', async () => {
    // Intent path (reconcileStripeIntent), amount-mismatch branch.
    const fixture = await makeFixture('r501-intent-once', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r501-random-${rand()}`, paymentIntentId: 'pi_r501_intent_once', expireAt: new Date(Date.now() - 3600000) })
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_r501_intent_once', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'MAD', amount_received: 99900,
    })
    stripeRefundCreate.mockResolvedValue({ id: 're_r501_intent_once' })
    const first = await runCheckoutSweep()
    expect(first.refunded).toBe(1)
    expect(stripeRefundCreate).toHaveBeenCalledTimes(1)
    const afterFirst = await Booking.findById(fixture.booking._id).lean()
    // R6-23 — same as (a): the terminal marker skips the booking
    // on the next sweep (no provider read, no second refund).
    expect(afterFirst?.reconciliationStatus).toBe('refunded')
    const second = await runCheckoutSweep()
    expect(second.checked).toBe(0)
    expect(second.notPaid).toBe(0)
    expect(second.refunded).toBe(0)
    expect(stripeRefundCreate).toHaveBeenCalledTimes(1)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(new Date(booking?.expireAt as unknown as Date).getTime())
      .toBe(new Date(afterFirst?.expireAt as unknown as Date).getTime())
  })

  it('R5-01 (b) a refunded booking TTL-cleans: expireAt is a real Date approx now, not null', async () => {
    const fixture = await makeFixture('r501-ttl', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r501_ttl', 'MAD', 99900)
    stripeRefundCreate.mockResolvedValue({ id: 're_r501_ttl' })
    const summary = await runCheckoutSweep()
    expect(summary.refunded).toBe(1)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    // No wall-clock TTL wait: the TTL monitor's 60 s cadence makes a
    // real wait test slow and flaky; the mechanism assertion is the
    // proof (R3-01 / GH-32 Path C precedent).
    expect(booking?.expireAt).not.toBeNull()
    expect(booking?.expireAt).toBeInstanceOf(Date)
    expect(Math.abs(new Date(booking?.expireAt as unknown as Date).getTime() - Date.now())).toBeLessThan(10_000)
  })

  it('R5-01 (c) a second reconcile of an already-refunded intent never finalises', async () => {
    const fixture = await makeFixture('r501-refunded-intent', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r501-random-${rand()}`, paymentIntentId: 'pi_r501_refunded', expireAt: new Date(Date.now() - 3600000) })
    // The intent still verifies as succeeded; its charge is refunded.
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_r501_refunded', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'MAD', amount_received: 100000,
      latest_charge: 'ch_r501_refunded',
    })
    stripeChargeRetrieve.mockResolvedValue({ id: 'ch_r501_refunded', refunded: true })
    stripeRefundCreate.mockResolvedValue({ id: 're_r501_refunded' })
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.notPaid).toBe(1)
    expect(summary.finalized).toBe(0)
    expect(summary.refunded).toBe(0)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-01 (a) a partially-refunded Stripe intent never finalises: outcome not-paid, booking stays Void, no ledger legs', async () => {
    const fixture = await makeFixture('r601-partial', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r601_partial', 'MAD', 125000)
    // The intent verifies as succeeded and matches the snapshot; only
    // its charge shows the partial refund (refunded: false,
    // amount_refunded: 500) - the R5-01 check saw only `refunded`.
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_r601_partial', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'MAD', amount_received: 125000,
      latest_charge: 'ch_r601_partial',
    })
    stripeChargeRetrieve.mockResolvedValue({ id: 'ch_r601_partial', refunded: false, amount_refunded: 500 })
    stripeRefundCreate.mockResolvedValue({ id: 're_r601_partial' })
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.notPaid).toBe(1)
    expect(summary.finalized).toBe(0)
    expect(summary.refunded).toBe(0)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-01 (b) a partially-refunded PayPal capture never finalises in full: outcome not-paid, no second refund', async () => {
    const fixture = await makeFixture('r601-paypal', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { paypalOrderId: 'order-r601-partial', expireAt: new Date(Date.now() - 3600000) })
    // The capture still reads COMPLETED with its gross amount (the
    // amount checks cannot see the refund); the refund lives in the
    // order's payments.refunds array. Pre-fix this finalised in full.
    mockPayPalOrder('order-r601-partial', fixture.booking._id.toString(), 'COMPLETED', '1250.00', undefined, 'MAD', {
      refunds: [{ id: 're-r601-partial', status: 'COMPLETED', amount: { currency_code: 'MAD', value: '500.00' } }],
    })
    paypalRefundCapture.mockResolvedValue({})
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.notPaid).toBe(1)
    expect(summary.finalized).toBe(0)
    expect(summary.refunded).toBe(0)
    expect(paypalRefundCapture).not.toHaveBeenCalled()
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-01 (c) a PayPal capture whose status is PARTIALLY_REFUNDED never finalises', async () => {
    const fixture = await makeFixture('r601-paypal-status', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { paypalOrderId: 'order-r601-status', expireAt: new Date(Date.now() - 3600000) })
    mockPayPalOrder('order-r601-status', fixture.booking._id.toString(), 'COMPLETED', '1250.00', undefined, 'MAD', { captureStatus: 'PARTIALLY_REFUNDED' })
    paypalRefundCapture.mockResolvedValue({})
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.notPaid).toBe(1)
    expect(summary.finalized).toBe(0)
    expect(paypalRefundCapture).not.toHaveBeenCalled()
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-02 (a) a failed charge read surfaces as provider-error, never as a finalisation', async () => {
    const fixture = await makeFixture('r602-throw', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r602_throw', 'MAD', 125000)
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_r602_throw', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'MAD', amount_received: 125000,
      latest_charge: 'ch_r602_throw',
    })
    // R6-02 - the old `catch { return false }` read this transient
    // Stripe error as "not refunded" and finalised the booking. Now
    // the throw must reach the sweeper's provider-error defuse.
    stripeChargeRetrieve.mockRejectedValue(new Error('Stripe API blip'))
    stripeRefundCreate.mockResolvedValue({ id: 're_r602_throw' })
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.providerErrors).toBe(1)
    expect(summary.finalized).toBe(0)
    expect(summary.refunded).toBe(0)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(booking?.reconciliationStatus).toBe('provider-error')
    expect(new Date(booking?.expireAt as unknown as Date).getTime()).toBeGreaterThan(Date.now())
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-02 (b) a 404 charge-read error behaves the same: provider-error, not false', async () => {
    const fixture = await makeFixture('r602-404', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r602_404', 'MAD', 125000)
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_r602_404', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'MAD', amount_received: 125000,
      latest_charge: 'ch_r602_404',
    })
    stripeChargeRetrieve.mockRejectedValue(Object.assign(new Error('No such charge'), { statusCode: 404 }))
    stripeRefundCreate.mockResolvedValue({ id: 're_r602_404' })
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.providerErrors).toBe(1)
    expect(summary.finalized).toBe(0)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(booking?.reconciliationStatus).toBe('provider-error')
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-07 a transient DB error on the refunded arm $set does NOT stamp provider-error, extend expireAt, or notify', async () => {
    const fixture = await makeFixture('r607-db-error', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r607_dberr', 'MAD', 99900)
    stripeRefundCreate.mockResolvedValue({ id: 're_r607_dberr' })
    mailSendMock.mockClear()
    // Fail ONLY the refunded arm's TTL-clear ($set expireAt): every
    // other write goes through to the real collection. Pre-fix the
    // catch-all read this as a provider failure and resurrected the
    // refunded booking into a 7-day provider-error hold.
    const origUpdateOne = Booking.updateOne.bind(Booking)
    const spy = jest.spyOn(Booking, 'updateOne').mockImplementation(((filter: any, update: any, ...rest: any[]) => {
      if (update?.$set?.expireAt !== undefined) {
        throw new Error('transient DB error')
      }
      return (origUpdateOne as any)(filter, update, ...rest)
    }) as any)
    try {
      const summary = await runCheckoutSweep()
      expect(summary.checked).toBe(1)
      expect(summary.errors).toBe(1)
      expect(summary.refunded).toBe(0)
      expect(summary.providerErrors).toBe(0)
      const booking = await Booking.findById(fixture.booking._id).lean()
      expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
      expect(booking?.reconciliationStatus).toBeUndefined()
      // The deadline was NOT extended: the booking keeps its past
      // expireAt and TTL-cleans instead of being re-held 7 days.
      expect(new Date(booking?.expireAt as unknown as Date).getTime()).toBeLessThan(Date.now())
      expect(await Notification.find({ booking: fixture.booking._id }).lean()).toHaveLength(0)
      expect(mailSendMock).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('R6-08 a throwing booking does not abort the sweep loop: later bookings are still checked and counted', async () => {
    const broken = await makeFixture('r608-broken', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    const healthy = await makeFixture('r608-healthy', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    // Keyed provider mocks: the broken booking mismatches (refund
    // path) while the healthy one matches (finalise path).
    stripeSessionRetrieve.mockImplementation(async (id: string) => {
      if (id === broken.booking.sessionId) {
        return { id, payment_status: 'paid', metadata: { bookingId: broken.booking._id.toString() }, currency: 'mad', amount_total: 99900, payment_intent: 'pi_r608_broken' }
      }
      return { id, payment_status: 'paid', metadata: { bookingId: healthy.booking._id.toString() }, currency: 'mad', amount_total: 125000, payment_intent: 'pi_r608_healthy' }
    })
    stripeIntentRetrieve.mockImplementation(async (id: string) => {
      if (id === 'pi_r608_broken') {
        return { id, status: 'succeeded', metadata: { bookingId: broken.booking._id.toString() }, currency: 'MAD', amount_received: 99900 }
      }
      return { id, status: 'succeeded', metadata: { bookingId: healthy.booking._id.toString() }, currency: 'MAD', amount_received: 125000 }
    })
    stripeRefundCreate.mockResolvedValue({ id: 're_r608_broken' })
    // The broken booking's refunded-arm $set throws (R6-07 shape):
    // its side-effect error escapes reconcileOneVoidBooking. Pre-fix
    // the outer catch logged only after the loop had already aborted,
    // so the healthy booking was never checked on this tick.
    const origUpdateOne = Booking.updateOne.bind(Booking)
    const brokenId = broken.booking._id.toString()
    const spy = jest.spyOn(Booking, 'updateOne').mockImplementation(((filter: any, update: any, ...rest: any[]) => {
      if (update?.$set?.expireAt !== undefined && String((filter as any)?._id) === brokenId) {
        throw new Error('transient DB error')
      }
      return (origUpdateOne as any)(filter, update, ...rest)
    }) as any)
    try {
      const summary = await runCheckoutSweep()
      expect(summary.checked).toBe(2)
      expect(summary.errors).toBe(1)
      expect(summary.finalized).toBe(1)
      expect(summary.refunded).toBe(0)
      expect((await Booking.findById(broken.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Void)
      expect((await Booking.findById(broken.booking._id).lean())?.reconciliationStatus).toBeUndefined()
      const healthyBooking = await Booking.findById(healthy.booking._id).lean()
      expect(healthyBooking?.status).toBe(bookcarsTypes.BookingStatus.PaidInFull)
      expect(await paymentsOf(healthy.booking._id)).toHaveLength(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('R6-09 two concurrent manual retries on a still-blocked hold notify exactly once', async () => {
    const fixture = await makeFixture('r609-race', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r609-random-${rand()}`, paymentIntentId: 'pi_r609_race', expireAt: new Date(Date.now() - 3600000) })
    await blockCar(fixture.supplier._id, fixture.car._id)
    mockStripeIntentSuccess('pi_r609_race', fixture.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r609_race' })
    // Both retries load the pre-extension document (past expireAt),
    // so both see a fresh defuse — only the conditional extension
    // decides the winner. Pre-fix both re-notified + re-extended.
    const now = new Date()
    const firstLoad = await Booking.findById(fixture.booking._id).lean()
    const secondLoad = await Booking.findById(fixture.booking._id).lean()
    mailSendMock.mockClear()
    const [first, second] = await Promise.all([
      reconcileOneVoidBooking(firstLoad, now, new Set<string>()),
      reconcileOneVoidBooking(secondLoad, now, new Set<string>()),
    ])
    expect(first.outcome).toBe('held')
    expect(second.outcome).toBe('held')
    const notes = await Notification.find({ user: fixture.supplier._id, subjectType: 'booking', subjectId: fixture.booking._id.toString() }).lean()
    expect(notes).toHaveLength(1)
    const mail = mailSendMock.mock.calls.filter((c: any) => c[0]?.to === fixture.supplier.email)
    expect(mail).toHaveLength(1)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    const expireAt = new Date(booking?.expireAt as unknown as Date).getTime()
    expect(Math.abs(expireAt - (now.getTime() + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000))).toBeLessThan(60_000)
  })

  it('R6-10 (a) R6-23 — a redelivered webhook after a mismatch refund is skipped: checked 0, no second refund, marker stamped', async () => {
    const fixture = await makeFixture('r610-redeliver', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r610_redeliver', 'MAD', 99900)
    // The intent carries a charge: the first sweep refunds it, the
    // charge then shows refunded, and the redelivery must see that
    // instead of issuing a second refund under the orphan key.
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_r610_redeliver', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'MAD', amount_received: 99900,
      latest_charge: 'ch_r610_redeliver',
    })
    stripeChargeRetrieve.mockResolvedValue({ id: 'ch_r610_redeliver', refunded: false, amount_refunded: 0 })
    stripeRefundCreate.mockResolvedValue({ id: 're_r610_redeliver' })
    const first = await runCheckoutSweep()
    expect(first.checked).toBe(1)
    expect(first.refunded).toBe(1)
    expect(stripeRefundCreate).toHaveBeenCalledTimes(1)
    expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Void)
    // R6-23 — the refunded arm stamped the terminal marker.
    expect((await Booking.findById(fixture.booking._id).lean())?.reconciliationStatus).toBe('refunded')

    // The mismatch refund landed; the next sweep skips the booking
    // on the marker before any provider read — the charge mock is
    // no longer consulted.
    const second = await runCheckoutSweep()
    expect(second.checked).toBe(0)
    expect(second.notPaid).toBe(0)
    expect(second.refunded).toBe(0)
    expect(stripeRefundCreate).toHaveBeenCalledTimes(1)
    expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-10 (b) a dashboard refund between the pre-finalise check and the finalise-fail refund yields refunded, not refund-failed', async () => {
    // The Rental snapshot is inconsistent (amountDueNow 900 <
    // rentalTotal 1000), so finalisation throws before any leg posts
    // (R6-12) and the finalise-fail refund runs — by then the
    // dashboard has already refunded the charge, so Stripe raises
    // already-refunded on the create.
    const fixture = await makeFixture('r610-dashboard', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 900 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r610_dashboard', 'MAD', 90000)
    stripeRefundCreate.mockRejectedValue(Object.assign(new Error('Charge ch_r610_dashboard has already been refunded'), { code: 'charge_already_refunded' }))
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.refunded).toBe(1)
    expect(summary.errors).toBe(0)
    expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-10 (c) a redelivered webhook for an orphan session whose charge is already refunded does not refund again or 500', async () => {
    const goneBookingId = oid().toString()
    // The intent carries a charge that already shows refunded (the
    // mismatch refund landed before the booking TTL-deleted).
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_r610_orphan_session', status: 'succeeded',
      metadata: { bookingId: goneBookingId },
      currency: 'MAD', amount_received: 125000,
      latest_charge: 'ch_r610_orphan_session',
    })
    stripeChargeRetrieve.mockResolvedValue({ id: 'ch_r610_orphan_session', refunded: true, amount_refunded: 125000 })
    stripeRefundCreate.mockResolvedValue({ id: 're_r610_orphan_session' })
    const response = await postWebhookEvent('checkout.session.completed', {
      id: `cs-f2-orphan-${rand()}`, payment_status: 'paid',
      metadata: { bookingId: goneBookingId },
      currency: 'mad', amount_total: 125000, payment_intent: 'pi_r610_orphan_session',
    })
    expect(response.status).toBe(200)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
  })

  it('R6-10 (d) same for the orphan intent path: an already-refunded charge is reported, not refunded again', async () => {
    const goneBookingId = oid().toString()
    stripeChargeRetrieve.mockResolvedValue({ id: 'ch_r610_orphan_intent', refunded: true, amount_refunded: 100000 })
    stripeRefundCreate.mockResolvedValue({ id: 're_r610_orphan_intent' })
    const response = await postWebhookEvent('payment_intent.succeeded', {
      id: 'pi_r610_orphan_intent', status: 'succeeded',
      metadata: { bookingId: goneBookingId },
      currency: 'MAD', amount_received: 100000,
      latest_charge: 'ch_r610_orphan_intent',
    })
    expect(response.status).toBe(200)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
  })

  it('R6-11 a failed receivable read on an expired pay-later hold defuses it instead of stranding it to TTL deletion', async () => {
    const fixture = await makeFixture('r611-receivable', bookcarsTypes.CheckoutPaymentMode.PayLater,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    await Booking.updateOne({ _id: fixture.booking._id }, {
      $set: { status: bookcarsTypes.BookingStatus.Pending, lifecycle: bookcarsTypes.ContractLifecycle.Draft },
    })
    // Corrupt the snapshot currency: getContractReceivable throws
    // `Unsupported currency INVALID` on the read (verified against
    // Node ICU: 'INVALID' is not a currency code). Pre-fix the catch
    // only logged and the hold was left with a past expireAt for the
    // TTL to delete ~70 min later, paid or not.
    await Booking.updateOne({ _id: fixture.booking._id }, { $set: { 'financialSnapshot.baseCurrency': 'INVALID' } })
    mailSendMock.mockClear()
    const summary = await runCheckoutSweep()
    expect(summary.expiredHolds).toBe(0)
    expect(summary.held).toBe(1)
    expect(summary.errors).toBe(1)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    expect(booking?.reconciliationStatus).toBe('provider-error')
    expect(new Date(booking?.expireAt as unknown as Date).getTime()).toBeGreaterThan(Date.now())
    const notes = await Notification.find({ user: fixture.supplier._id, subjectType: 'booking', subjectId: fixture.booking._id.toString() }).lean()
    expect(notes).toHaveLength(1)
    const mail = mailSendMock.mock.calls.filter((c: any) => c[0]?.to === fixture.supplier.email)
    expect(mail).toHaveLength(1)
    // A second sweep sees nothing: the hold is out of the expired
    // query until the review window lapses — it is not voided and
    // not left for the TTL.
    const second = await runCheckoutSweep()
    expect(second.expiredHolds).toBe(0)
    expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Pending)
  })

  it('R6-12 (a) a Rental snapshot short on rent does NOT confirm: finalise fails, the payment is refunded, the booking stays Void', async () => {
    // amountDueNow 900 < rentalTotal 1000. Pre-fix the rent leg
    // posted short (900) and the booking flipped to Paid with 100
    // of rent still owed and no hold, refund, or alert.
    const fixture = await makeFixture('r612-short', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 900 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r612_short', 'MAD', 90000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r612_short' })
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.refunded).toBe(1)
    expect(summary.finalized).toBe(0)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-12 (b) a Rental snapshot over on rent behaves the same: the throw happens before any leg posts', async () => {
    const fixture = await makeFixture('r612-over', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1100 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r612_over', 'MAD', 110000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r612_over' })
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.refunded).toBe(1)
    expect(summary.finalized).toBe(0)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('R6-21 a fully-paid expired hold is stamped held: the paid-unconfirmed row carries it, and a confirming refresh clears it', async () => {
    // Path A shape: pay-later hold, expired, fully paid, car blocked.
    const held = await makeFixture('r621-held', bookcarsTypes.CheckoutPaymentMode.PayLater,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    await Booking.updateOne({ _id: held.booking._id }, {
      $set: { status: bookcarsTypes.BookingStatus.Pending, lifecycle: bookcarsTypes.ContractLifecycle.Draft },
    })
    const schedule = await blockCar(held.supplier._id, held.car._id)
    await ledger.postRentalPayment({
      bookingId: held.booking._id, date: new Date(), amount: 1000,
      currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
      purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
    })
    expect((await ledger.refreshBookingPaymentStatus(held.booking._id)).conflict).toBe(true)

    const summary = await runCheckoutSweep()
    expect(summary.held).toBe(1)
    const heldBooking = await Booking.findById(held.booking._id).lean()
    expect(heldBooking?.status).toBe(bookcarsTypes.BookingStatus.Pending)
    expect(heldBooking?.reconciliationStatus).toBe('held')
    // The paid-unconfirmed row carries the stamp for triage.
    const adminToken = await makeAdminToken('r621-admin')
    const rows = await paidUnconfirmedRows(adminToken)
    const row = rowFor(rows, held.booking._id)
    expect(row).toBeDefined()
    expect(row?.holdReason).toBe('held')

    // The blocker clears; the retry finalises and clears the stamp.
    await MaintenanceSchedule.deleteOne({ _id: schedule._id })
    const retried = await request(app)
      .post(`/api/bookings/${held.booking._id.toString()}/refresh-payment-status`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(retried.status).toBe(200)
    expect(retried.body.status).toBe(bookcarsTypes.BookingStatus.Paid)
    const finalBooking = await Booking.findById(held.booking._id).lean()
    expect(finalBooking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect(finalBooking?.reconciliationStatus).toBeUndefined()
    expect(finalBooking?.holdDetail).toBeUndefined()
  })

  it('R6-24 a provider-error retry on a concurrently-finalised booking is skipped, not provider-error (DEVIATION: skipped, not already-finalized)', async () => {
    // Stale-doc shape (R6-09 precedent): load the doc pre-finalise,
    // finalise it via a successful sweep, then retry the stale doc
    // with the provider down. The stale doc's expireAt is overridden
    // in-memory to the future, so the defuse is non-fresh — the
    // branch the pack covers. The pack's test wording says
    // "already-finalized", but the change text allows
    // skipped/already-finalized, and skipped is the honest outcome:
    // no provider object was read (the fresh branch returns skipped
    // in exactly this situation).
    const fixture = await makeFixture('r624-stale', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r624-random-${rand()}`, paymentIntentId: 'pi_r624_stale', expireAt: new Date(Date.now() - 3600000) })
    mockStripeIntentSuccess('pi_r624_stale', fixture.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r624_stale' })
    const stale = await Booking.findById(fixture.booking._id).lean()
    if (!stale) {
      throw new Error('R6-24 fixture booking missing')
    }
    const first = await runCheckoutSweep()
    expect(first.checked).toBe(1)
    expect(first.finalized).toBe(1)
    expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Paid)

    // The provider is down now; the stale doc's deadline is already
    // extended (non-fresh defuse).
    stripeIntentRetrieve.mockRejectedValue(new Error('provider down'))
    stale.expireAt = new Date(Date.now() + 86400000)
    const retry = await reconcileOneVoidBooking(stale, new Date(), new Set<string>())
    expect(retry.outcome).toBe('skipped')
    // The booking stays Paid and no stamp landed (the stamp's
    // `status: Void` guard makes it a no-op on the Paid booking).
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect(booking?.reconciliationStatus).toBeUndefined()
  })

  it('R6-28 a held Void booking shows its chase history on the paid-unconfirmed row (delivery log)', async () => {
    // R4-02 shape: provider-paid Void booking whose finalisation
    // conflicts (car blocked) — the sweep holds it and notifies.
    const fixture = await makeFixture('r628-held', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r628-random-${rand()}`, paymentIntentId: 'pi_r628_held', expireAt: new Date(Date.now() - 3600000) })
    await blockCar(fixture.supplier._id, fixture.car._id)
    mockStripeIntentSuccess('pi_r628_held', fixture.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r628_held' })
    const summary = await runCheckoutSweep()
    expect(summary.held).toBe(1)
    expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Void)
    // The hold notifier wrote a delivery row (auto.holdReview).
    const deliveries = await NotificationDelivery.find({ supplier: fixture.supplier._id, templateKey: 'auto.holdReview' as bookcarsTypes.NotificationTemplateKey, subjectId: fixture.booking._id.toString() }).lean()
    expect(deliveries.length).toBeGreaterThanOrEqual(1)
    expect(deliveries[0].status).toBe('sent')
    // The paid-unconfirmed row shows the chase history.
    const adminToken = await makeAdminToken('r628-admin')
    const rows = await paidUnconfirmedRows(adminToken)
    const row = rowFor(rows, fixture.booking._id)
    expect(row).toBeDefined()
    expect(row?.lastRemindedAt).toBeDefined()
    expect((row?.reminderCount || 0)).toBeGreaterThanOrEqual(1)
  })

  it('R5-03 (a) a manual retry on a still-blocked hold does not re-notify or re-extend', async () => {
    // Path B shape: provider-paid Void booking whose finalisation
    // conflicts (car blocked) — the sweep holds it, then the manual
    // retry re-runs reconcileOneVoidBooking directly on the full
    // document, with a fresh heldThisPass set and the same now.
    const fixture = await makeFixture('r503-norenotify', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r503-random-${rand()}`, paymentIntentId: 'pi_r503_norenotify', expireAt: new Date(Date.now() - 3600000) })
    await blockCar(fixture.supplier._id, fixture.car._id)
    mockStripeIntentSuccess('pi_r503_norenotify', fixture.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r503_norenotify' })

    const now = new Date()
    mailSendMock.mockClear()
    const first = await runCheckoutSweep(now)
    expect(first.checked).toBe(1)
    expect(first.held).toBe(1)
    const heldBooking = await Booking.findById(fixture.booking._id).lean()
    expect(heldBooking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    const firstExpireAt = new Date(heldBooking?.expireAt as unknown as Date).getTime()
    expect(firstExpireAt).toBeGreaterThan(now.getTime())
    const notesFor = async () => Notification.find({ user: fixture.supplier._id, subjectType: 'booking', subjectId: fixture.booking._id.toString() }).lean()
    expect(await notesFor()).toHaveLength(1)
    const mailFor = () => mailSendMock.mock.calls.filter((c: any) => c[0]?.to === fixture.supplier.email)
    expect(mailFor()).toHaveLength(1)

    // Manual-retry shape: same now, fresh set — still inside the
    // live review window, so no second notification round and no
    // moved deadline; the outcome is still held.
    const retry = await reconcileOneVoidBooking(heldBooking, now, new Set<string>())
    expect(retry.outcome).toBe('held')
    expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await notesFor()).toHaveLength(1)
    expect(mailFor()).toHaveLength(1)
    const retryExpireAt = new Date((await Booking.findById(fixture.booking._id).lean())?.expireAt as unknown as Date).getTime()
    expect(retryExpireAt).toBe(firstExpireAt)
  })

  it('R5-03 (b) a manual retry after the window lapses notifies again', async () => {
    // Same shape as (a): hold via the sweep, then retry at now + 8d
    // (past the 7-day review window) — a fresh defuse, so exactly
    // one additional notification + one additional email, and the
    // deadline is re-extended to the new window.
    const fixture = await makeFixture('r503-renotify', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r503-random-${rand()}`, paymentIntentId: 'pi_r503_renotify', expireAt: new Date(Date.now() - 3600000) })
    await blockCar(fixture.supplier._id, fixture.car._id)
    mockStripeIntentSuccess('pi_r503_renotify', fixture.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r503_renotify' })

    const now = new Date()
    mailSendMock.mockClear()
    const first = await runCheckoutSweep(now)
    expect(first.checked).toBe(1)
    expect(first.held).toBe(1)
    const heldBooking = await Booking.findById(fixture.booking._id).lean()
    const firstExpireAt = new Date(heldBooking?.expireAt as unknown as Date).getTime()
    const notesFor = async () => Notification.find({ user: fixture.supplier._id, subjectType: 'booking', subjectId: fixture.booking._id.toString() }).lean()
    expect(await notesFor()).toHaveLength(1)
    const mailFor = () => mailSendMock.mock.calls.filter((c: any) => c[0]?.to === fixture.supplier.email)
    expect(mailFor()).toHaveLength(1)

    const later = new Date(now.getTime() + 8 * 86400000)
    const retry = await reconcileOneVoidBooking(heldBooking, later, new Set<string>())
    expect(retry.outcome).toBe('held')
    expect(await notesFor()).toHaveLength(2)
    expect(mailFor()).toHaveLength(2)
    const retryExpireAt = new Date((await Booking.findById(fixture.booking._id).lean())?.expireAt as unknown as Date).getTime()
    expect(retryExpireAt).toBeGreaterThan(firstExpireAt)
    expect(Math.abs(retryExpireAt - (later.getTime() + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000))).toBeLessThan(60_000)
  })

  it('R5-06 a second manual retry on a refund-failed booking logs warn, not error', async () => {
    // R4-01 refund-failed shape: paid session, amount mismatch, the
    // refund itself fails. First sight logs error; a manual retry
    // (same now, fresh set) logs warn, not error.
    const fixture = await makeFixture('r506-log', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r506_log', 'MAD', 99900)
    stripeRefundCreate.mockRejectedValue(new Error('refund failed'))
    const idStr = fixture.booking._id.toString()
    const callsFor = (mock: any, re: RegExp) => mock.mock.calls.filter((c: any) => String(c[0]).includes(idStr) && re.test(String(c[0])))
    loggerErrorMock.mockClear()
    loggerWarnMock.mockClear()
    const now = new Date()
    const first = await runCheckoutSweep(now)
    expect(first.errors).toBe(1)
    expect(callsFor(loggerErrorMock, /needs manual review: provider refund failed/)).toHaveLength(1)
    expect(callsFor(loggerWarnMock, /refund failed/)).toHaveLength(0)
    const failedBooking = await Booking.findById(fixture.booking._id).lean()
    expect(failedBooking?.status).toBe(bookcarsTypes.BookingStatus.Void)

    loggerErrorMock.mockClear()
    loggerWarnMock.mockClear()
    const retry = await reconcileOneVoidBooking(failedBooking, now, new Set<string>())
    expect(retry.outcome).toBe('refund-failed')
    expect(callsFor(loggerErrorMock, /refund failed/)).toHaveLength(0)
    const warns = callsFor(loggerWarnMock, /still needs manual review: provider refund failed/)
    expect(warns).toHaveLength(1)
  })

  it('R5-02 (a) a Void hold with an inconsistent Full snapshot falls back to ledger figures (paidRent 0, outstanding full)', async () => {
    // Hold first with a WELL-FORMED snapshot (blocked car -> held),
    // then corrupt it by direct model update: finalize splits the
    // snapshot before the availability save, so a snapshot corrupted
    // up front would throw a plain Error and refund instead of
    // holding. The corruption models a corrupt/legacy snapshot
    // reaching the queue — the row must show ledger figures, not
    // confidently-wrong previewed legs.
    const fixture = await makeFixture('r502-full', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { sessionId: `r502-random-${rand()}`, paymentIntentId: 'pi_r502_full', expireAt: new Date(Date.now() - 3600000) })
    await blockCar(fixture.supplier._id, fixture.car._id)
    mockStripeIntentSuccess('pi_r502_full', fixture.booking._id.toString(), 'MAD', 125000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r502_full' })
    const sweep = await runCheckoutSweep()
    expect(sweep.held).toBeGreaterThanOrEqual(1)
    expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Void)

    // Corrupt AFTER the hold: amountDueNow 500 < rentalTotal 1000.
    // amountDueNowInPaymentCurrency stays 1250 (the provider proof).
    await Booking.updateOne({ _id: fixture.booking._id }, { $set: { 'financialSnapshot.amountDueNow': 500 } })

    const adminToken = await makeAdminToken('r502-full-admin')
    const row = rowFor(await paidUnconfirmedRows(adminToken), fixture.booking._id)
    expect(row).toBeDefined()
    expect(row?.status).toBe(bookcarsTypes.BookingStatus.Void)
    // Zero legs: ledger figures stand — no rent previewed, nothing written off.
    expect(row?.paidRent).toBe(0)
    expect(row?.outstandingBalance).toBe(1000)
    expect(row?.depositHeld).toBe(0)
  })

  it('R5-02 (b) a Void hold with an inconsistent Deposit snapshot falls back to ledger figures (depositHeld 0)', async () => {
    const fixture = await makeFixture('r502-dep', bookcarsTypes.CheckoutPaymentMode.Deposit,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 250 },
      { sessionId: `r502-random-${rand()}`, paymentIntentId: 'pi_r502_dep', expireAt: new Date(Date.now() - 3600000) })
    await blockCar(fixture.supplier._id, fixture.car._id)
    mockStripeIntentSuccess('pi_r502_dep', fixture.booking._id.toString(), 'MAD', 25000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r502_dep' })
    const sweep = await runCheckoutSweep()
    expect(sweep.held).toBeGreaterThanOrEqual(1)
    expect((await Booking.findById(fixture.booking._id).lean())?.status).toBe(bookcarsTypes.BookingStatus.Void)

    // Corrupt AFTER the hold: amountDueNow 500 > depositAmount 250.
    await Booking.updateOne({ _id: fixture.booking._id }, { $set: { 'financialSnapshot.amountDueNow': 500 } })

    const adminToken = await makeAdminToken('r502-dep-admin')
    const row = rowFor(await paidUnconfirmedRows(adminToken), fixture.booking._id)
    expect(row).toBeDefined()
    expect(row?.status).toBe(bookcarsTypes.BookingStatus.Void)
    // Zero legs: the deposit is NOT previewed as held.
    expect(row?.depositHeld).toBe(0)
    expect(row?.paidRent).toBe(0)
    expect(row?.outstandingBalance).toBe(1000)
  })

  it('R5-04 a Deposit-mode Void hold offers no TAKE_PAYMENT; its Pending counterpart does', async () => {
    // Well-formed Deposit hold: the rent (1000) is genuinely
    // outstanding, so before the fix canTakePayment was true and the
    // manager filled a payment form the backend refuses (Void).
    // After the fix it is false; the retry button is the action here.
    const fixture = await makeFixture('r504-dep', bookcarsTypes.CheckoutPaymentMode.Deposit,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 250 },
      { sessionId: `r504-random-${rand()}`, paymentIntentId: 'pi_r504_dep', expireAt: new Date(Date.now() - 3600000) })
    await blockCar(fixture.supplier._id, fixture.car._id)
    mockStripeIntentSuccess('pi_r504_dep', fixture.booking._id.toString(), 'MAD', 25000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r504_dep' })
    const sweep = await runCheckoutSweep()
    expect(sweep.held).toBeGreaterThanOrEqual(1)
    const adminToken = await makeAdminToken('r504-admin')
    const row = rowFor(await paidUnconfirmedRows(adminToken), fixture.booking._id)
    expect(row).toBeDefined()
    expect(row?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(row?.outstandingBalance).toBe(1000)
    expect(row?.actions?.canTakePayment).toBe(false)
    expect(row?.actions?.canConfirm).toBe(false)

    // Pending counterpart: an unpaid Draft hold served by filter=all
    // still offers TAKE_PAYMENT — the fix touches Void rows only.
    const pending = await makeFixture('r504-pending', bookcarsTypes.CheckoutPaymentMode.PayLater,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    await Booking.updateOne({ _id: pending.booking._id }, {
      $set: { status: bookcarsTypes.BookingStatus.Pending, lifecycle: bookcarsTypes.ContractLifecycle.Draft },
    })
    const all = await request(app)
      .get('/api/rental-payments/overdue')
      .query({ filter: 'all' })
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(all.status).toBe(200)
    const allRows = all.body.rows as Array<{ booking: { _id: string } | string, actions?: { canTakePayment: boolean } }>
    const pendingRow = allRows.find((r) => String((r.booking as any)?._id || r.booking) === pending.booking._id.toString())
    expect(pendingRow).toBeDefined()
    expect(pendingRow?.actions?.canTakePayment).toBe(true)
  })

  it('R5-05 (a) each defuse stamps its reason on the queue row: held / refund-failed / provider-error', async () => {
    const adminToken = await makeAdminToken('r505-admin')
    // held: Path B shape, blocked car.
    const held = await makeFixture('r505-held', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r505-random-${rand()}`, paymentIntentId: 'pi_r505_held', expireAt: new Date(Date.now() - 3600000) })
    await blockCar(held.supplier._id, held.car._id)
    mockStripeIntentSuccess('pi_r505_held', held.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r505_held' })
    const first = await runCheckoutSweep()
    expect(first.held).toBeGreaterThanOrEqual(1)
    expect((await Booking.findById(held.booking._id).lean())?.reconciliationStatus).toBe('held')

    // refund-failed: paid session, amount mismatch, the refund fails.
    const failed = await makeFixture('r505-rf', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(failed.booking, 'pi_r505_rf', 'MAD', 99900)
    stripeRefundCreate.mockRejectedValue(new Error('refund failed'))
    const second = await runCheckoutSweep()
    expect(second.errors).toBeGreaterThanOrEqual(1)
    expect((await Booking.findById(failed.booking._id).lean())?.reconciliationStatus).toBe('refund-failed')

    // provider-error: the session retrieve throws.
    const unreachable = await makeFixture('r505-pe', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    stripeSessionRetrieve.mockRejectedValue(new Error('socket hang up'))
    const third = await runCheckoutSweep()
    expect(third.providerErrors).toBeGreaterThanOrEqual(1)
    expect((await Booking.findById(unreachable.booking._id).lean())?.reconciliationStatus).toBe('provider-error')

    // All three rows carry their reason (+ detail) in the queue.
    const rows = await paidUnconfirmedRows(adminToken)
    const heldRow = rowFor(rows, held.booking._id)
    expect(heldRow?.holdReason).toBe('held')
    expect(heldRow?.holdDetail).toMatch(/no longer available/)
    const failedRow = rowFor(rows, failed.booking._id)
    expect(failedRow?.holdReason).toBe('refund-failed')
    expect(failedRow?.holdDetail).toMatch(/amount mismatch/)
    const unreachableRow = rowFor(rows, unreachable.booking._id)
    expect(unreachableRow?.holdReason).toBe('provider-error')
    expect(unreachableRow?.holdDetail).toMatch(/socket hang up/)
  })

  it('R5-05 (b) a resolved hold has its hold fields cleared on the booking', async () => {
    const fixture = await makeFixture('r505-clear', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r505-random-${rand()}`, paymentIntentId: 'pi_r505_clear', expireAt: new Date(Date.now() - 3600000) })
    const schedule = await blockCar(fixture.supplier._id, fixture.car._id)
    mockStripeIntentSuccess('pi_r505_clear', fixture.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r505_clear' })
    const sweep = await runCheckoutSweep()
    expect(sweep.held).toBeGreaterThanOrEqual(1)
    const heldBooking = await Booking.findById(fixture.booking._id).lean()
    expect(heldBooking?.reconciliationStatus).toBe('held')
    expect(heldBooking?.holdDetail).toMatch(/no longer available/)

    // The blocker clears; the retry finalises — and the stamp clears with it.
    await MaintenanceSchedule.deleteOne({ _id: schedule._id })
    const adminToken = await makeAdminToken('r505-clear-admin')
    const retried = await request(app)
      .post(`/api/bookings/${fixture.booking._id.toString()}/refresh-payment-status`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(retried.status).toBe(200)
    expect(retried.body.updated).toBe(true)
    expect(retried.body.status).toBe(bookcarsTypes.BookingStatus.Paid)
    const finalBooking = await Booking.findById(fixture.booking._id).lean()
    expect(finalBooking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect(finalBooking?.reconciliationStatus).toBeUndefined()
    expect(finalBooking?.holdDetail).toBeUndefined()
  })

  it('R5-10 a Void hold expiring inside 24h appears in holds-expiring; one 7 days out does not', async () => {
    const adminToken = await makeAdminToken('r510-admin')
    // Void hold, held by the sweep (~7 days out), then pulled into the
    // 24 h window by direct update. The deadline must ALSO stay beyond
    // the Void-hold queue gate (expireAt > now + BOOKING_EXPIRE_AT):
    // in this test env BC_STRIPE_SESSION_EXPIRE_AT=82800, so the gate
    // is ~23.2 h out and the expiring hold lives in the narrow
    // (gate, 24 h] sliver — gate + 30 min, ~20 min inside the window.
    // In production (default 70-min fuse) the window is far wider.
    const soon = await makeFixture('r510-soon', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r510-random-${rand()}`, paymentIntentId: 'pi_r510_soon', expireAt: new Date(Date.now() - 3600000) })
    await blockCar(soon.supplier._id, soon.car._id)
    mockStripeIntentSuccess('pi_r510_soon', soon.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r510_soon' })
    const sweep = await runCheckoutSweep()
    expect(sweep.held).toBeGreaterThanOrEqual(1)
    await Booking.updateOne({ _id: soon.booking._id }, { $set: { expireAt: new Date(Date.now() + (env.BOOKING_EXPIRE_AT + 1800) * 1000) } })
    // A second Void hold left at the full ~7-day review deadline.
    const later = await makeFixture('r510-later', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 },
      { sessionId: `r510-random-${rand()}`, paymentIntentId: 'pi_r510_later', expireAt: new Date(Date.now() - 3600000) })
    await blockCar(later.supplier._id, later.car._id)
    mockStripeIntentSuccess('pi_r510_later', later.booking._id.toString(), 'MAD', 100000)
    stripeRefundCreate.mockResolvedValue({ id: 're_r510_later' })
    const second = await runCheckoutSweep()
    expect(second.held).toBeGreaterThanOrEqual(1)

    const rows = await holdsExpiringRows(adminToken)
    expect(rowFor(rows, soon.booking._id)).toBeDefined()
    expect(rowFor(rows, later.booking._id)).toBeUndefined()
  })
})

describe('R4-01 - sweeper defuses + notifies refund-failed and provider errors', () => {
  it('refund-failed: expireAt extended to the review window, agency notified once, booking still Void', async () => {
    const fixture = await makeFixture('r401-refund-failed', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r401_rf', 'MAD', 99900)
    stripeRefundCreate.mockRejectedValue(new Error('refund failed'))
    mailSendMock.mockClear()
    const summary = await runCheckoutSweep()
    expect(summary.checked).toBe(1)
    expect(summary.errors).toBe(1)
    expect(summary.providerErrors).toBe(0)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    const nowMs = Date.now()
    const newExpireAt = new Date(booking?.expireAt as unknown as Date).getTime()
    expect(newExpireAt).toBeGreaterThan(nowMs + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000 - 5 * 60 * 1000)
    expect(newExpireAt).toBeLessThanOrEqual(nowMs + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000 + 5 * 60 * 1000)
    const notes = await Notification.find({ user: fixture.supplier._id, subjectType: 'booking', subjectId: fixture.booking._id.toString() }).lean()
    expect(notes).toHaveLength(1)
    expect(notes[0].booking?.toString()).toBe(fixture.booking._id.toString())
    const mail = mailSendMock.mock.calls.filter((c: any) => c[0]?.to === fixture.supplier.email)
    expect(mail).toHaveLength(1)
    expect(mail[0][0].subject).toMatch(/Refund failed/)
    expect(mail[0][0].html).toMatch(/1250 MAD/)
    expect(mail[0][0].html).toMatch(/Payment currency or amount mismatch/)
  })

  it('refund-failed: a second immediate sweep sees nothing (booking dropped out until the window lapses)', async () => {
    const fixture = await makeFixture('r401-rf-second', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r401_rf2', 'MAD', 99900)
    stripeRefundCreate.mockRejectedValue(new Error('refund failed'))
    const first = await runCheckoutSweep()
    expect(first.errors).toBe(1)
    mailSendMock.mockClear()
    const second = await runCheckoutSweep()
    expect(second.checked).toBe(0)
    expect(second.errors).toBe(0)
    const notes = await Notification.find({ user: fixture.supplier._id, subjectType: 'booking', subjectId: fixture.booking._id.toString() }).lean()
    expect(notes).toHaveLength(1)
  })

  it('refunded after a hold: the review-window extension is cleared so the car frees', async () => {
    const fixture = await makeFixture('r401-refunded', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_r401_ref', 'MAD', 99900)
    stripeRefundCreate.mockRejectedValue(new Error('refund failed'))
    const first = await runCheckoutSweep()
    expect(first.errors).toBe(1)
    const heldBooking = await Booking.findById(fixture.booking._id).lean()
    expect(new Date(heldBooking?.expireAt as unknown as Date).getTime()).toBeGreaterThan(Date.now())
    stripeRefundCreate.mockResolvedValue({ id: 're_r401_ref' })
    // R5-01 (d) - the sweep runs at now + 8d, so the refunded booking's
    // expireAt is set to THAT now, not to the wall-clock now.
    const sweepNow = new Date(Date.now() + 8 * 86400000)
    const second = await runCheckoutSweep(sweepNow)
    expect(second.refunded).toBe(1)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(booking?.expireAt).not.toBeNull()
    expect(Math.abs(new Date(booking?.expireAt as unknown as Date).getTime() - sweepNow.getTime())).toBeLessThan(60_000)
  })

  it('provider error: expireAt extended, counted under providerErrors, notified once per window', async () => {
    const fixture = await makeFixture('r401-provider', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    stripeSessionRetrieve.mockRejectedValue(new Error('socket hang up'))
    mailSendMock.mockClear()
    const first = await runCheckoutSweep()
    expect(first.checked).toBe(1)
    expect(first.providerErrors).toBe(1)
    expect(first.errors).toBe(0)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(new Date(booking?.expireAt as unknown as Date).getTime()).toBeGreaterThan(Date.now())
    const notes = await Notification.find({ user: fixture.supplier._id, subjectType: 'booking', subjectId: fixture.booking._id.toString() }).lean()
    expect(notes).toHaveLength(1)
    expect(notes[0].booking?.toString()).toBe(fixture.booking._id.toString())
    const mail = mailSendMock.mock.calls.filter((c: any) => c[0]?.to === fixture.supplier.email)
    expect(mail).toHaveLength(1)
    expect(mail[0][0].subject).toMatch(/provider unreachable/)
    expect(mail[0][0].html).toMatch(/socket hang up/)
    expect(mail[0][0].html).toContain(new Date(Date.now() + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000).toISOString().slice(0, 10))
    const second = await runCheckoutSweep()
    expect(second.checked).toBe(0)
    expect(second.providerErrors).toBe(0)
  })
})
