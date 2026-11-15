import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
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
import { postRentalPayment, reverseRentalPayment } from '../src/utils/ledger'

// The app is imported dynamically in beforeAll, AFTER the provider/mail
// mocks below are registered. With native ESM Jest, a static `import app`
// would load bookingController (and the real Stripe client + mailer) before
// the mock registrations execute, so the mocks would never apply.

// Workstream A, cluster F1 — finalisation integrity (the money loop).
// Every test uses mocked providers (no Stripe/PayPal credentials, no live
// money) against the real Mongo-backed app, following the
// providerCurrent.integration.test.ts harness.

const stripeSessionRetrieve: any = jest.fn()
const stripeIntentRetrieve: any = jest.fn()
const stripeRefundCreate: any = jest.fn()
const paypalGetOrder: any = jest.fn()
const paypalRefundCapture: any = jest.fn()
const mailSendMock: any = jest.fn(async () => ({}))

jest.unstable_mockModule('../src/payment/stripe.js', () => ({
  default: {
    checkout: { sessions: { retrieve: stripeSessionRetrieve } },
    paymentIntents: { retrieve: stripeIntentRetrieve },
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
  driverLanguage = 'en',
) => {
  const supplier = await User.create({
    email: `f1-supplier-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F1 Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `f1-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F1 Driver ${label}`,
    language: driverLanguage, type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
    expireAt: new Date(Date.now() + 3600000),
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `F1 Casablanca Airport ${label}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: `F1 car ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: amounts.depositAmount, available: true,
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
    from: new Date(Date.now() + 86400000), to: new Date(Date.now() + 3 * 86400000),
    status: bookcarsTypes.BookingStatus.Void, price: amounts.rentalTotal,
    sessionId: `cs-f1-${rand()}`,
    expireAt: new Date(Date.now() + 3600000),
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD', mode,
      rentalTotal: amounts.rentalTotal, depositAmount: amounts.depositAmount,
      amountDueNow: amounts.amountDueNow, amountDueNowInPaymentCurrency: amounts.amountDueNow,
      quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
  return { supplier, driver, location, car, booking }
}

const mockStripeSuccess = (booking: any, intentId: string, amountMinor: number) => {
  stripeSessionRetrieve.mockResolvedValue({
    id: booking.sessionId, payment_status: 'paid',
    metadata: { bookingId: booking._id.toString() },
    currency: 'mad', amount_total: amountMinor, payment_intent: intentId,
  })
  stripeIntentRetrieve.mockResolvedValue({
    id: intentId, status: 'succeeded',
    metadata: { bookingId: booking._id.toString() },
    currency: 'MAD', amount_received: amountMinor,
  })
}

const mockPayPalCompleted = (booking: any, orderId: string, captureId: string, amount: string) => {
  paypalGetOrder.mockResolvedValue({
    id: orderId, status: 'COMPLETED',
    purchase_units: [{
      invoice_id: booking._id.toString(),
      amount: { currency_code: 'MAD', value: amount },
      payments: { captures: [{ id: captureId, status: 'COMPLETED', amount: { currency_code: 'MAD', value: amount } }] },
    }],
  })
}

const paymentsOf = async (bookingId: mongoose.Types.ObjectId) =>
  RentalPayment.find({ booking: bookingId }).sort({ purpose: 1 }).lean()

beforeAll(async () => {
  app = (await import('../src/app')).default
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
  // resetAllMocks (not clearAllMocks): per-test mockResolvedValue /
  // mockRejectedValue implementations must not leak into the next test.
  jest.resetAllMocks()
  mailSendMock.mockResolvedValue({})
})

describe('F1 — provider checkout posting splits rent and deposit (W3 P-2)', () => {
  it('finalises a Full-mode Stripe checkout with deposit: rent and deposit post under their own purposes', async () => {
    const fixture = await makeFixture('full-stripe', bookcarsTypes.CheckoutPaymentMode.Full, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    mockStripeSuccess(fixture.booking, 'pi_f1_full', 125000)
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(200)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.PaidInFull)
    expect(booking?.expireAt).toBeUndefined()
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(2)
    const rent = payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Rent)
    const deposit = payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit)
    expect(rent?.amount).toBe(1000)
    expect(deposit?.amount).toBe(250)
    expect(rent?.source).toBe(bookcarsTypes.RentalPaymentSource.Stripe)
    expect(deposit?.providerReference).toBe('pi_f1_full')
    expect(rent?.idempotencyKey).toBe('stripe-checkout-pi_f1_full-rent')
    expect(deposit?.idempotencyKey).toBe('stripe-checkout-pi_f1_full-deposit')
    const car = await Car.findById(fixture.car._id).lean()
    expect(car?.trips).toBe(1)
    const driver = await User.findById(fixture.driver._id).lean()
    expect(driver?.expireAt).toBeUndefined()
    expect(mailSendMock).toHaveBeenCalled()
  })

  it('finalises a Deposit-mode Stripe checkout: only a Deposit posting, no rent', async () => {
    const fixture = await makeFixture('deposit-stripe', bookcarsTypes.CheckoutPaymentMode.Deposit, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 250 })
    mockStripeSuccess(fixture.booking, 'pi_f1_deposit', 25000)
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(200)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Deposit)
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(1)
    expect(payments[0].purpose).toBe(bookcarsTypes.RentalPaymentPurpose.Deposit)
    expect(payments[0].amount).toBe(250)
  })

  it('finalises a Rental-mode Stripe checkout: only a Rent posting', async () => {
    const fixture = await makeFixture('rental-stripe', bookcarsTypes.CheckoutPaymentMode.Rental, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 })
    mockStripeSuccess(fixture.booking, 'pi_f1_rental', 100000)
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(200)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(1)
    expect(payments[0].purpose).toBe(bookcarsTypes.RentalPaymentPurpose.Rent)
    expect(payments[0].amount).toBe(1000)
  })

  it('finalises a Full-mode PayPal checkout with deposit split the same way', async () => {
    const fixture = await makeFixture('full-paypal', bookcarsTypes.CheckoutPaymentMode.Full, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    const orderId = 'order-f1-full'
    await Booking.updateOne({ _id: fixture.booking._id }, { paypalOrderId: orderId })
    mockPayPalCompleted(fixture.booking, orderId, 'cap-f1-full', '1250.00')
    const response = await request(app).post(`/api/check-paypal-order/${fixture.booking._id}/${orderId}`)
    expect(response.status).toBe(200)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.PaidInFull)
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(2)
    expect(payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Rent)?.amount).toBe(1000)
    expect(payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit)?.amount).toBe(250)
  })
})

describe('F1 — post-payment verification mismatch refunds first (W4 GAP-05)', () => {
  it('refunds a succeeded Stripe intent on amount mismatch and returns manual-review 409', async () => {
    const fixture = await makeFixture('stripe-amount', bookcarsTypes.CheckoutPaymentMode.Full, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    stripeSessionRetrieve.mockResolvedValue({
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'mad', amount_total: 99900, payment_intent: 'pi_f1_mismatch_amount',
    })
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_f1_mismatch_amount', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'MAD', amount_received: 99900,
    })
    stripeRefundCreate.mockResolvedValue({ id: 're_f1_mismatch_amount' })
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(409)
    expect(response.text).toContain('refunded')
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_f1_mismatch_amount' },
      { idempotencyKey: 'refund-pi_f1_mismatch_amount-mismatch' },
    )
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
    expect(await paymentsOf(fixture.booking._id)).toHaveLength(0)
  })

  it('refunds a succeeded Stripe intent on currency mismatch', async () => {
    const fixture = await makeFixture('stripe-currency', bookcarsTypes.CheckoutPaymentMode.Full, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    stripeSessionRetrieve.mockResolvedValue({
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'eur', amount_total: 125000, payment_intent: 'pi_f1_mismatch_currency',
    })
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_f1_mismatch_currency', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'EUR', amount_received: 125000,
    })
    stripeRefundCreate.mockResolvedValue({ id: 're_f1_mismatch_currency' })
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(409)
    expect(response.text).toContain('refunded')
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_f1_mismatch_currency' },
      { idempotencyKey: 'refund-pi_f1_mismatch_currency-mismatch' },
    )
  })

  it('refunds a succeeded Stripe intent on intent mismatch', async () => {
    const fixture = await makeFixture('stripe-intent', bookcarsTypes.CheckoutPaymentMode.Full, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    mockStripeSuccess(fixture.booking, 'pi_f1_mismatch_intent', 125000)
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_f1_mismatch_intent', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'MAD', amount_received: 120000,
    })
    stripeRefundCreate.mockResolvedValue({ id: 're_f1_mismatch_intent' })
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(409)
    expect(response.text).toContain('refunded')
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_f1_mismatch_intent' },
      { idempotencyKey: 'refund-pi_f1_mismatch_intent-mismatch' },
    )
  })

  it('refunds a succeeded intent when finalisation itself throws (inconsistent Full-mode snapshot)', async () => {
    const fixture = await makeFixture('stripe-finalize-throw', bookcarsTypes.CheckoutPaymentMode.Full, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 900 })
    mockStripeSuccess(fixture.booking, 'pi_f1_finalize_throw', 90000)
    stripeRefundCreate.mockResolvedValue({ id: 're_f1_finalize_throw' })
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(409)
    expect(response.text).toContain('refunded')
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_f1_finalize_throw' },
      { idempotencyKey: 'refund-pi_f1_finalize_throw-mismatch' },
    )
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
  })

  it('refunds a completed PayPal capture on capture amount mismatch', async () => {
    const fixture = await makeFixture('paypal-capture', bookcarsTypes.CheckoutPaymentMode.Full, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    const orderId = 'order-f1-capture-mismatch'
    await Booking.updateOne({ _id: fixture.booking._id }, { paypalOrderId: orderId })
    paypalGetOrder.mockResolvedValue({
      id: orderId, status: 'COMPLETED',
      purchase_units: [{
        invoice_id: fixture.booking._id.toString(),
        amount: { currency_code: 'MAD', value: '1250.00' },
        payments: { captures: [{ id: 'cap-f1-capture', status: 'COMPLETED', amount: { currency_code: 'MAD', value: '1200.00' } }] },
      }],
    })
    const response = await request(app).post(`/api/check-paypal-order/${fixture.booking._id}/${orderId}`)
    expect(response.status).toBe(409)
    expect(response.text).toContain('refunded')
    expect(paypalRefundCapture).toHaveBeenCalledWith('cap-f1-capture', 'refund-cap-f1-capture-mismatch')
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.Void)
  })

  it('refunds a succeeded mobile PaymentIntent on verification mismatch', async () => {
    const fixture = await makeFixture('mobile-mismatch', bookcarsTypes.CheckoutPaymentMode.Full, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    await Booking.updateOne({ _id: fixture.booking._id }, { paymentIntentId: 'pi_f1_mobile' })
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_f1_mobile', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'MAD', amount_received: 120000,
    })
    stripeRefundCreate.mockResolvedValue({ id: 're_f1_mobile' })
    const response = await request(app).post('/api/confirm-payment-intent').send({ bookingId: fixture.booking._id.toString(), paymentIntentId: 'pi_f1_mobile' })
    expect(response.status).toBe(409)
    expect(response.text).toContain('refunded')
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_f1_mobile' },
      { idempotencyKey: 'refund-pi_f1_mobile-mismatch' },
    )
  })
})

describe('F1 — failed confirmation email never fails a paid booking (W4 GAP-06, W1 #2)', () => {
  it('still finalises when the confirmation email throws: booking paid, trips counted, guest expiry cleared', async () => {
    const fixture = await makeFixture('email-failure', bookcarsTypes.CheckoutPaymentMode.Full, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    mockStripeSuccess(fixture.booking, 'pi_f1_email', 125000)
    mailSendMock.mockRejectedValueOnce(new Error('smtp down'))
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(200)
    const booking = await Booking.findById(fixture.booking._id).lean()
    expect(booking?.status).toBe(bookcarsTypes.BookingStatus.PaidInFull)
    const car = await Car.findById(fixture.car._id).lean()
    expect(car?.trips).toBe(1)
    const driver = await User.findById(fixture.driver._id).lean()
    expect(driver?.expireAt).toBeUndefined()
  })

  it('resolves location names for an Arabic-language customer whose locations have no Arabic value', async () => {
    const fixture = await makeFixture('ar-location', bookcarsTypes.CheckoutPaymentMode.Full, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 }, 'ar')
    mockStripeSuccess(fixture.booking, 'pi_f1_ar', 125000)
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(200)
    expect(mailSendMock).toHaveBeenCalled()
    const sentMail = mailSendMock.mock.calls.map((call: any[]) => call[0]).find((options: any) => options?.to === fixture.driver.email)
    expect(sentMail).toBeDefined()
    expect(sentMail.html).toContain('F1 Casablanca Airport ar-location')
    const read = await request(app).get(`/api/booking/${fixture.booking._id}/ar?sessionId=${fixture.booking.sessionId}`)
    expect(read.status).toBe(200)
    expect(read.body.pickupLocation.name).toBe('F1 Casablanca Airport ar-location')
    expect(read.body.dropOffLocation.name).toBe('F1 Casablanca Airport ar-location')
  })
})

describe('F1 — reversing a provider payment refunds at the provider (W3 P-5)', () => {
  it('refunds at Stripe before reversing the books and records the refund reference', async () => {
    const fixture = await makeFixture('reversal-stripe', bookcarsTypes.CheckoutPaymentMode.Full, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    mockStripeSuccess(fixture.booking, 'pi_f1_reversal', 125000)
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(200)
    const original = await RentalPayment.findOne({ booking: fixture.booking._id, purpose: bookcarsTypes.RentalPaymentPurpose.Rent }).lean()
    expect(original).toBeTruthy()
    stripeRefundCreate.mockResolvedValue({ id: 're_f1_reversal' })
    const reversal = await reverseRentalPayment({
      paymentId: original!._id,
      actorId: fixture.supplier._id,
      idempotencyKey: 'f1-reversal-key-1',
    })
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_f1_reversal' },
      { idempotencyKey: `refund-reversal-${original!._id.toString()}` },
    )
    expect(reversal.refundProviderReference).toBe('re_f1_reversal')
    expect(reversal.refundedAt).toBeDefined()
    const flipped = await RentalPayment.findById(original!._id).lean()
    expect(flipped?.status).toBe(bookcarsTypes.RentalPaymentStatus.Reversed)
  })

  it('refuses the reversal when the provider refund fails and leaves the books untouched', async () => {
    const fixture = await makeFixture('reversal-failure', bookcarsTypes.CheckoutPaymentMode.Rental, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 })
    mockStripeSuccess(fixture.booking, 'pi_f1_reversal_fail', 100000)
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(200)
    const original = await RentalPayment.findOne({ booking: fixture.booking._id }).lean()
    expect(original).toBeTruthy()
    stripeRefundCreate.mockRejectedValue(new Error('refund unavailable'))
    await expect(reverseRentalPayment({
      paymentId: original!._id,
      actorId: fixture.supplier._id,
      idempotencyKey: 'f1-reversal-key-2',
    })).rejects.toMatchObject({ name: 'LedgerError', code: 'REFUND_FAILED' })
    const untouched = await RentalPayment.findById(original!._id).lean()
    expect(untouched?.status).toBe(bookcarsTypes.RentalPaymentStatus.Posted)
    expect(await RentalPayment.countDocuments({ reversedFrom: original!._id })).toBe(0)
  })

  it('reverses a manual payment without touching any provider', async () => {
    const fixture = await makeFixture('reversal-manual', bookcarsTypes.CheckoutPaymentMode.Rental, { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1000 })
    await Booking.updateOne(
      { _id: fixture.booking._id },
      { status: bookcarsTypes.BookingStatus.Pending, expireAt: null },
    )
    const manual = await postRentalPayment({
      bookingId: fixture.booking._id.toString(),
      date: new Date(),
      amount: 100,
      currency: 'MAD',
      method: bookcarsTypes.RentalPaymentMethod.Cash,
      purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
      source: bookcarsTypes.RentalPaymentSource.Manual,
      idempotencyKey: 'f1-manual-payment-1',
    })
    const reversal = await reverseRentalPayment({
      paymentId: manual._id,
      actorId: fixture.supplier._id,
      idempotencyKey: 'f1-reversal-key-3',
    })
    expect(stripeRefundCreate).not.toHaveBeenCalled()
    expect(paypalRefundCapture).not.toHaveBeenCalled()
    expect(reversal.refundProviderReference).toBeUndefined()
    const flipped = await RentalPayment.findById(manual._id).lean()
    expect(flipped?.status).toBe(bookcarsTypes.RentalPaymentStatus.Reversed)
  })
})
