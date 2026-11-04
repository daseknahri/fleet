import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import Booking from '../src/models/Booking'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import app from '../src/app'

const stripeSessionRetrieve: any = jest.fn()
const stripeIntentRetrieve: any = jest.fn()
const stripeRefundCreate: any = jest.fn()
const paypalGetOrder: any = jest.fn()
const paypalRefundCapture: any = jest.fn()
const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

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

const oid = () => new mongoose.Types.ObjectId()
const snapshot = () => ({
  version: 1,
  baseCurrency: 'MAD',
  paymentCurrency: 'MAD',
  mode: bookcarsTypes.CheckoutPaymentMode.Full,
  rentalTotal: 1000,
  depositAmount: 250,
  amountDueNow: 1000,
  amountDueNowInPaymentCurrency: 1000,
  quotedAt: new Date(),
})
const makeConflictFixture = async (label: string) => {
  const supplier = await User.create({
    email: `provider-${label}-${Math.random().toString(36).slice(2)}@test.bookcars.ma`,
    fullName: `Provider ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `driver-${label}-${Math.random().toString(36).slice(2)}@test.bookcars.ma`,
    fullName: `Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const value = await LocationValue.create({ language: 'en', value: `Provider ${label}` })
  fixtureLocationValueIds.push(value._id)
  const location = await Location.create({ country: oid(), values: [value._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: `Provider ${label} car`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  const from = new Date(Date.now() + 86400000)
  const to = new Date(Date.now() + 3 * 86400000)
  const conflictingBooking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from, to, status: bookcarsTypes.BookingStatus.Reserved, price: 1000,
    cancellation: false, amendments: false, theftProtection: false,
    collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
  } as any)
  fixtureBookingIds.push(conflictingBooking._id)
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from, to, status: bookcarsTypes.BookingStatus.Void, price: 1000,
    sessionId: `cs-current-${Math.random().toString(36).slice(2)}`,
    expireAt: new Date(Date.now() + 3600000), financialSnapshot: snapshot(),
  } as any)
  fixtureBookingIds.push(booking._id)
  return { booking, car, supplier, driver, location, value }
}

const makeBooking = async (overrides: Record<string, unknown> = {}) => Booking.create({
  supplier: oid(), car: oid(), driver: oid(), pickupLocation: oid(), dropOffLocation: oid(),
  from: new Date(Date.now() + 86400000), to: new Date(Date.now() + 3 * 86400000),
  status: bookcarsTypes.BookingStatus.Void, price: 1000,
  sessionId: `cs-current-${Math.random().toString(36).slice(2)}`,
  expireAt: new Date(Date.now() + 3600000), financialSnapshot: snapshot(),
  ...overrides,
} as any)

beforeAll(async () => {
 await databaseHelper.connect(env.DB_URI, false, false) 
})
afterAll(async () => {
 await databaseHelper.close() 
})
afterEach(async () => {
  await Booking.deleteMany({ sessionId: /^cs-current-/ })
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
  jest.clearAllMocks()
})

describe('current server-priced provider callback contract', () => {
  it('rejects a Stripe callback whose session metadata does not identify the booking', async () => {
    const booking = await makeBooking()
    stripeSessionRetrieve.mockResolvedValue({
      id: booking.sessionId,
      payment_status: 'paid',
      metadata: { bookingId: oid().toString() },
      payment_intent: 'pi_current_mismatch',
    })
    const response = await request(app).post(`/api/check-checkout-session/${booking.sessionId}`)
    expect(response.status).toBe(409)
    expect(stripeIntentRetrieve).not.toHaveBeenCalled()
    expect(stripeRefundCreate).not.toHaveBeenCalled()
  })

  it('returns manual-review status when Stripe is unavailable', async () => {
    const booking = await makeBooking()
    stripeSessionRetrieve.mockRejectedValue(new Error('stripe timeout'))
    const response = await request(app).post(`/api/check-checkout-session/${booking.sessionId}`)
    expect(response.status).toBe(503)
    expect(response.text).toContain('support review')
    expect(await Booking.exists({ _id: booking._id })).toBeTruthy()
  })
  it('treats a replayed Stripe callback as idempotent after the booking is already paid', async () => {
    const booking = await makeBooking({ status: bookcarsTypes.BookingStatus.Paid, paymentIntentId: 'pi_current_replay' })
    stripeSessionRetrieve.mockResolvedValue({
      id: booking.sessionId,
      payment_status: 'paid',
      metadata: { bookingId: booking._id.toString() },
      currency: 'mad',
      amount_total: 100000,
      payment_intent: 'pi_current_replay',
    })
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_current_replay', status: 'succeeded', metadata: { bookingId: booking._id.toString() },
      currency: 'MAD', amount_received: 100000,
    })
    const response = await request(app).post(`/api/check-checkout-session/${booking.sessionId}`)
    expect(response.status).toBe(200)
    expect(stripeRefundCreate).not.toHaveBeenCalled()
  })

  it('returns manual-review status when Stripe has no payment intent', async () => {
    const booking = await makeBooking()
    stripeSessionRetrieve.mockResolvedValue({
      id: booking.sessionId,
      payment_status: 'paid',
      metadata: { bookingId: booking._id.toString() },
      currency: 'mad',
      amount_total: 100000,
    })
    const response = await request(app).post(`/api/check-checkout-session/${booking.sessionId}`)
    expect(response.status).toBe(409)
    expect(response.text).toContain('support review')
    expect(await Booking.exists({ _id: booking._id })).toBeTruthy()
  })

  it('returns manual-review status when PayPal has no verified capture', async () => {
    const booking = await makeBooking({ paypalOrderId: 'order-current-no-capture' })
    paypalGetOrder.mockResolvedValue({
      id: 'order-current-no-capture', status: 'COMPLETED',
      purchase_units: [{ invoice_id: booking._id.toString(), amount: { currency_code: 'MAD', value: '1000.00' }, payments: { captures: [] } }],
    })
    const response = await request(app).post(`/api/check-paypal-order/${booking._id}/order-current-no-capture`)
    expect(response.status).toBe(409)
    expect(response.text).toContain('support review')
    expect(paypalRefundCapture).not.toHaveBeenCalled()
    expect(await Booking.exists({ _id: booking._id })).toBeTruthy()
  })

  it('returns manual-review status when PayPal is unavailable', async () => {
    const booking = await makeBooking({ paypalOrderId: 'order-current-timeout' })
    paypalGetOrder.mockRejectedValue(new Error('paypal timeout'))
    const response = await request(app).post(`/api/check-paypal-order/${booking._id}/order-current-timeout`)
    expect(response.status).toBe(503)
    expect(response.text).toContain('support review')
    expect(await Booking.exists({ _id: booking._id })).toBeTruthy()
  })
  it('preserves the Stripe booking and requires support review when conflict refund fails', async () => {
    const fixture = await makeConflictFixture('stripe-refund-failure')
    stripeSessionRetrieve.mockResolvedValue({
      id: fixture.booking.sessionId, payment_status: 'paid',
      metadata: { bookingId: fixture.booking._id.toString() }, currency: 'mad', amount_total: 100000,
      payment_intent: 'pi_current_conflict',
    })
    stripeIntentRetrieve.mockResolvedValue({
      id: 'pi_current_conflict', status: 'succeeded',
      metadata: { bookingId: fixture.booking._id.toString() }, currency: 'MAD', amount_received: 100000,
    })
    stripeRefundCreate.mockRejectedValue(new Error('refund unavailable'))
    const response = await request(app).post(`/api/check-checkout-session/${fixture.booking.sessionId}`)
    expect(response.status).toBe(500)
    expect(response.text).toContain('support review')
    expect(stripeRefundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_current_conflict' },
      { idempotencyKey: `booking-conflict-${fixture.booking.sessionId}` },
    )
    expect(await Booking.exists({ _id: fixture.booking._id, status: bookcarsTypes.BookingStatus.Void })).toBeTruthy()
  })

  it('preserves the PayPal booking and requires support review when conflict refund fails', async () => {
    const fixture = await makeConflictFixture('paypal-refund-failure')
    const orderId = 'order-current-conflict'
    await Booking.updateOne({ _id: fixture.booking._id }, { paypalOrderId: orderId })
    paypalGetOrder.mockResolvedValue({
      id: orderId, status: 'COMPLETED',
      purchase_units: [{ invoice_id: fixture.booking._id.toString(), amount: { currency_code: 'MAD', value: '1000.00' },
        payments: { captures: [{ id: 'cap-current-conflict', status: 'COMPLETED', amount: { currency_code: 'MAD', value: '1000.00' } }] } }],
    })
    paypalRefundCapture.mockRejectedValue(new Error('refund unavailable'))
    const response = await request(app).post(`/api/check-paypal-order/${fixture.booking._id}/${orderId}`)
    expect(response.status).toBe(500)
    expect(response.text).toContain('support review')
    expect(paypalRefundCapture).toHaveBeenCalledWith('cap-current-conflict', `bc-refund-${fixture.booking._id}`)
    expect(await Booking.exists({ _id: fixture.booking._id, status: bookcarsTypes.BookingStatus.Void })).toBeTruthy()
  })

  it('rejects a PayPal callback whose order is not linked to the booking', async () => {
    const booking = await makeBooking({ paypalOrderId: 'order-current-linked' })
    paypalGetOrder.mockResolvedValue({
      id: 'order-current-unlinked', status: 'COMPLETED',
      purchase_units: [{ invoice_id: booking._id.toString(), amount: { currency_code: 'MAD', value: '1000.00' }, payments: { captures: [{ id: 'cap-current', status: 'COMPLETED', amount: { currency_code: 'MAD', value: '1000.00' } }] } }],
    })
    const response = await request(app).post(`/api/check-paypal-order/${booking._id}/${'order-current-unlinked'}`)
    expect(response.status).toBe(400)
    expect(paypalRefundCapture).not.toHaveBeenCalled()
  })
})

