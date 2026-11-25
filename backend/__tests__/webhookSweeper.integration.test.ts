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

let app: any
let runCheckoutSweep: (now?: Date) => Promise<any>
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

const mockPayPalOrder = (orderId: string, bookingId: string, status: string, amount: string, captureAmount?: string, currency = 'MAD') => {
  paypalGetOrder.mockResolvedValue({
    id: orderId, status,
    purchase_units: [{
      invoice_id: bookingId,
      amount: { currency_code: currency, value: amount },
      payments: status === 'COMPLETED'
        ? { captures: [{ id: `cap-f2-${rand()}`, status: 'COMPLETED', amount: { currency_code: currency, value: captureAmount ?? amount } }] }
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

  it('is safe to run twice: the second sweep re-issues the refund under the same idempotency key', async () => {
    const fixture = await makeFixture('sweep-twice', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { expireAt: new Date(Date.now() - 3600000) })
    mockStripeSessionPaid(fixture.booking, 'pi_f2_sweep_twice', 'MAD', 99900)
    stripeRefundCreate.mockResolvedValue({ id: 're_f2_sweep_twice' })
    await runCheckoutSweep()
    await runCheckoutSweep()
    expect(stripeRefundCreate).toHaveBeenCalledTimes(2)
    for (const call of stripeRefundCreate.mock.calls) {
      expect(call[1]).toEqual({ idempotencyKey: 'refund-pi_f2_sweep_twice-mismatch' })
    }
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
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
})
