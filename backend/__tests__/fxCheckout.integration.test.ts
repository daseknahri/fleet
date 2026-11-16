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

// The app + bookcars-helper are imported dynamically in beforeAll,
// AFTER the mocks below are registered. With native ESM Jest, static
// imports would load the real rate service (easy-currencies) and the
// real Stripe client before the mock registrations execute.

// Workstream A, cluster F2 — FX cache + 503 (W4 GAP-02) and FX snapshot
// + settled ledger legs (W4 GAP-10), following the
// finalisationIntegrity harness. The rate service is mocked at the
// easy-currencies boundary (no network); the providers are mocked
// (no Stripe credentials, no live money) against the real Mongo-backed
// app.

const mockConvert: any = jest.fn()
jest.unstable_mockModule('easy-currencies', () => ({
  __esModule: true,
  Convert: mockConvert,
}))

const stripeSessionRetrieve: any = jest.fn()
const stripeIntentRetrieve: any = jest.fn()
const stripeRefundCreate: any = jest.fn()
const stripeCustomersList: any = jest.fn()
const stripeCustomersCreate: any = jest.fn()
const stripeSessionCreate: any = jest.fn()
const mailSendMock: any = jest.fn(async () => ({}))

jest.unstable_mockModule('../src/payment/stripe.js', () => ({
  default: {
    checkout: {
      sessions: { retrieve: stripeSessionRetrieve, create: stripeSessionCreate },
    },
    customers: { list: stripeCustomersList, create: stripeCustomersCreate },
    paymentIntents: { retrieve: stripeIntentRetrieve },
    refunds: { create: stripeRefundCreate },
    webhooks: { constructEvent: jest.fn() },
  },
}))
jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: mailSendMock,
}))

let app: any
let bookcarsHelper: any

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
    sessionId?: string
    expireAt?: Date
  } = {},
) => {
  const supplier = await User.create({
    email: `f2fx-supplier-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F2FX Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `f2fx-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F2FX Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
    expireAt: new Date(Date.now() + 3600000),
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `F2FX Casablanca Airport ${label}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: `F2FX car ${label}`, supplier: supplier._id, minimumAge: 21,
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
    sessionId: opts.sessionId || `cs-f2fx-${rand()}`,
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

// Default rate-service behaviour for this file: 1 MAD = 0.092 EUR,
// 1 MAD = 0.10 USD. Set per test file run in beforeEach (afterEach
// resetAllMocks clears implementations).
const setDefaultRates = () => {
  mockConvert.mockImplementation((amount: number) => ({
    from: (_from: string) => ({
      to: (to: string) => Promise.resolve(amount * (to === 'EUR' ? 0.092 : to === 'USD' ? 0.1 : 1)),
    }),
  }))
}

const paymentsOf = async (bookingId: mongoose.Types.ObjectId) =>
  RentalPayment.find({ booking: bookingId }).sort({ purpose: 1 }).lean()

beforeAll(async () => {
  app = (await import('../src/app')).default
  bookcarsHelper = await import(':bookcars-helper')
  await databaseHelper.connect(env.DB_URI, false, false)
})
afterAll(async () => {
  await databaseHelper.close()
})
beforeEach(() => {
  bookcarsHelper.clearFxRateCache()
  setDefaultRates()
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
  // must not leak into the next test.
  jest.resetAllMocks()
  mailSendMock.mockResolvedValue({})
})

describe('F2 — convertPrice caches the FX rate per pair for one hour (W4 GAP-02)', () => {
  it('fetches the rate once and reuses it for the same pair and amount', async () => {
    expect(await bookcarsHelper.convertPrice(100, 'MAD', 'EUR')).toBe(9.2)
    expect(mockConvert).toHaveBeenCalledTimes(1)
    expect(await bookcarsHelper.convertPrice(100, 'MAD', 'EUR')).toBe(9.2)
    expect(mockConvert).toHaveBeenCalledTimes(1)
  })

  it('reuses the cached rate for a different amount of the same pair', async () => {
    expect(await bookcarsHelper.convertPrice(100, 'MAD', 'EUR')).toBe(9.2)
    expect(await bookcarsHelper.convertPrice(200, 'MAD', 'EUR')).toBe(18.4)
    expect(mockConvert).toHaveBeenCalledTimes(1)
  })

  it('fetches again for a different pair', async () => {
    await bookcarsHelper.convertPrice(100, 'MAD', 'EUR')
    expect(await bookcarsHelper.convertPrice(100, 'MAD', 'USD')).toBe(10)
    expect(mockConvert).toHaveBeenCalledTimes(2)
  })

  it('does not call the rate service for a same-currency conversion', async () => {
    expect(await bookcarsHelper.convertPrice(100, 'MAD', 'MAD')).toBe(100)
    expect(mockConvert).not.toHaveBeenCalled()
  })

  it('refetches after the cache is cleared', async () => {
    await bookcarsHelper.convertPrice(100, 'MAD', 'EUR')
    expect(mockConvert).toHaveBeenCalledTimes(1)
    bookcarsHelper.clearFxRateCache()
    expect(await bookcarsHelper.convertPrice(100, 'MAD', 'EUR')).toBe(9.2)
    expect(mockConvert).toHaveBeenCalledTimes(2)
  })

  it('still rejects a non-positive amount instead of serving it from the cache', async () => {
    await expect(bookcarsHelper.convertPrice(0, 'MAD', 'EUR')).rejects.toThrow('amount should be a positive number')
    await expect(bookcarsHelper.convertPrice(-5, 'MAD', 'EUR')).rejects.toThrow('amount should be a positive number')
    expect(mockConvert).not.toHaveBeenCalled()
  })
})

describe('F2 — checkout answers 503 (not 400) when the rate service fails (W4 GAP-02)', () => {
  it('returns 503 with a retryable message and creates no booking', async () => {
    const fixture = await makeFixture('checkout-503', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 200, depositAmount: 250, amountDueNow: 200 })
    mockConvert.mockImplementation(() => {
      throw new Error('rate service down')
    })
    const before = await Booking.countDocuments({ driver: fixture.driver._id })
    const response = await request(app).post('/api/checkout').send({
      booking: {
        car: fixture.car._id.toString(),
        driver: fixture.driver._id.toString(),
        pickupLocation: fixture.location._id.toString(),
        dropOffLocation: fixture.location._id.toString(),
        // Different dates from the fixture booking (+1d..+3d): the
        // fixture booking already holds the car for those days.
        from: new Date(Date.now() + 10 * 86400000),
        to: new Date(Date.now() + 12 * 86400000),
        status: bookcarsTypes.BookingStatus.Pending,
        cancellation: false, amendments: false, theftProtection: false,
        collisionDamageWaiver: false, fullInsurance: false,
        price: 200, additionalDriver: false,
      },
      paymentMode: bookcarsTypes.CheckoutPaymentMode.Rental,
      currency: 'EUR',
      paymentGateway: bookcarsTypes.PaymentGateway.Stripe,
    })
    expect(response.status).toBe(503)
    expect(response.text).toContain('temporarily unavailable')
    expect(response.text).toContain('retry')
    expect(await Booking.countDocuments({ driver: fixture.driver._id })).toBe(before)
  })

  it('stores the FX rate on the snapshot when the rate service succeeds', async () => {
    const fixture = await makeFixture('checkout-fx', bookcarsTypes.CheckoutPaymentMode.Rental,
      { rentalTotal: 200, depositAmount: 250, amountDueNow: 200 })
    stripeCustomersList.mockResolvedValue({ data: [] })
    stripeCustomersCreate.mockResolvedValue({ id: `cus_f2fx_${rand()}` })
    stripeSessionCreate.mockResolvedValue({ id: `cs-f2fx-checkout-${rand()}`, client_secret: 'cs_secret_f2fx' })
    const response = await request(app).post('/api/checkout').send({
      booking: {
        car: fixture.car._id.toString(),
        driver: fixture.driver._id.toString(),
        pickupLocation: fixture.location._id.toString(),
        dropOffLocation: fixture.location._id.toString(),
        // Different dates from the fixture booking (+1d..+3d): the
        // fixture booking already holds the car for those days.
        from: new Date(Date.now() + 10 * 86400000),
        to: new Date(Date.now() + 12 * 86400000),
        status: bookcarsTypes.BookingStatus.Pending,
        cancellation: false, amendments: false, theftProtection: false,
        collisionDamageWaiver: false, fullInsurance: false,
        price: 200, additionalDriver: false,
      },
      paymentMode: bookcarsTypes.CheckoutPaymentMode.Rental,
      currency: 'EUR',
      paymentGateway: bookcarsTypes.PaymentGateway.Stripe,
    })
    expect(response.status).toBe(200)
    expect(response.body.bookingId).toBeTruthy()
    const booking = await Booking.findById(response.body.bookingId).lean()
    expect(booking?.financialSnapshot?.amountDueNow).toBe(200)
    expect(booking?.financialSnapshot?.amountDueNowInPaymentCurrency).toBe(18.4)
    expect(booking?.financialSnapshot?.paymentCurrency).toBe('EUR')
    expect(booking?.financialSnapshot?.fxRate).toBe(0.092)
    expect(booking?.financialSnapshot?.fxSource).toBe('easy-currencies')
    expect(booking?.financialSnapshot?.fxAt).toBeDefined()
    // The checkout-created booking is a fixture too: track it for cleanup.
    fixtureBookingIds.push(booking!._id)
  })
})

describe('F2 — ledger stores the provider-settled leg alongside the base posting (W4 GAP-10)', () => {
  it('posts EUR settled legs whose sum is the provider total exactly', async () => {
    const fixture = await makeFixture('ledger-eur', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 },
      { paymentCurrency: 'EUR', amountDueNowInPaymentCurrency: 115, fxRate: 0.092 })
    stripeSessionRetrieve.mockResolvedValue({
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'eur', amount_total: 11500, payment_intent: 'pi_f2fx_eur',
    })
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_f2fx_eur', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'EUR', amount_received: 11500,
    })
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(200)
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(2)
    const rent = payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Rent)
    const deposit = payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit)
    // Base-currency posting is unchanged (ledger caps still apply).
    expect(rent?.amount).toBe(1000)
    expect(rent?.currency).toBe('MAD')
    expect(deposit?.amount).toBe(250)
    expect(deposit?.currency).toBe('MAD')
    // Settled legs reconcile to the provider settlement exactly.
    expect(rent?.settledAmount).toBe(92)
    expect(rent?.settledCurrency).toBe('EUR')
    expect(rent?.fxRate).toBe(0.092)
    expect(rent?.fxSource).toBe('easy-currencies')
    expect(deposit?.settledAmount).toBe(23)
    expect(deposit?.settledCurrency).toBe('EUR')
    expect(Number((rent!.settledAmount! + deposit!.settledAmount!).toFixed(2))).toBe(115)
  })

  it('stores settled legs equal to the base amounts for a same-currency checkout', async () => {
    const fixture = await makeFixture('ledger-mad', bookcarsTypes.CheckoutPaymentMode.Full,
      { rentalTotal: 1000, depositAmount: 250, amountDueNow: 1250 })
    stripeSessionRetrieve.mockResolvedValue({
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'mad', amount_total: 125000, payment_intent: 'pi_f2fx_mad',
    })
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_f2fx_mad', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() },
      currency: 'MAD', amount_received: 125000,
    })
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(200)
    const payments = await paymentsOf(fixture.booking._id)
    expect(payments).toHaveLength(2)
    const rent = payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Rent)
    const deposit = payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit)
    expect(rent?.settledAmount).toBe(1000)
    expect(rent?.settledCurrency).toBe('MAD')
    expect(rent?.fxRate).toBe(1)
    expect(deposit?.settledAmount).toBe(250)
    expect(deposit?.settledCurrency).toBe('MAD')
  })
})
