import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import crypto from 'node:crypto'
import Stripe from 'stripe'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import Invoice from '../src/models/Invoice'
import Notification from '../src/models/Notification'
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

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

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
  await databaseHelper.connect(env.DB_URI, false, false)
})
afterAll(async () => {
  await databaseHelper.close()
})
afterEach(async () => {
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Invoice.deleteMany({ booking: { $in: fixtureBookingIds } })
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
