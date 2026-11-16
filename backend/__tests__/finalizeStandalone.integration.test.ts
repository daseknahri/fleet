import 'dotenv/config'
import { jest } from '@jest/globals'
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
import { supportsTransactions } from '../src/utils/ledger'

// bookingController is imported dynamically in beforeAll, AFTER the
// provider/mail mocks below are registered (same ESM timing note as in
// finalisationIntegrity.integration.test.ts: a static import would load
// the real Stripe client + mailer before the mocks execute).

// Workstream A, cluster F1 — W4 GAP-07.
// Runs ONLY against a standalone mongod (no replica set): the runner
// (run-f1-tests.ps1 -Standalone) points BC_DB_URI at a throwaway standalone
// container. The test asserts the topology really is standalone, then
// proves a paid checkout finalises without transactions — the exact path
// that threw `withTransaction` unconditionally before the fix.
//
// The Stripe module is mocked because bookingController imports it
// statically and `new Stripe('')` throws without a key; finalisation
// itself never touches the provider. Mail is mocked because the laptop
// host cannot resolve the mailpit hostname.
jest.unstable_mockModule('../src/payment/stripe.js', () => ({
  default: {},
}))
jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: jest.fn(async () => ({})),
}))

let finalizePaidCheckoutBooking: (
  booking: any,
  provider: 'stripe' | 'paypal',
  reference: string,
) => Promise<boolean>

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)

const fixtureIds = {
  users: [] as mongoose.Types.ObjectId[],
  cars: [] as mongoose.Types.ObjectId[],
  locations: [] as mongoose.Types.ObjectId[],
  locationValues: [] as mongoose.Types.ObjectId[],
  bookings: [] as mongoose.Types.ObjectId[],
}

beforeAll(async () => {
  finalizePaidCheckoutBooking = (await import('../src/controllers/bookingController')).finalizePaidCheckoutBooking
  await databaseHelper.connect(env.DB_URI, false, false)
})
afterAll(async () => {
  await databaseHelper.close()
})
afterEach(async () => {
  await RentalPayment.deleteMany({ booking: { $in: fixtureIds.bookings } })
  await Invoice.deleteMany({ booking: { $in: fixtureIds.bookings } })
  await Notification.deleteMany({ booking: { $in: fixtureIds.bookings } })
  await Booking.deleteMany({ _id: { $in: fixtureIds.bookings } })
  await Car.deleteMany({ _id: { $in: fixtureIds.cars } })
  await Location.deleteMany({ _id: { $in: fixtureIds.locations } })
  await LocationValue.deleteMany({ _id: { $in: fixtureIds.locationValues } })
  await User.deleteMany({ _id: { $in: fixtureIds.users } })
  fixtureIds.bookings.length = 0
  fixtureIds.cars.length = 0
  fixtureIds.locations.length = 0
  fixtureIds.locationValues.length = 0
  fixtureIds.users.length = 0
})

describe('F1 — paid checkout finalises on standalone Mongo (W4 GAP-07)', () => {
  it('reports no transaction support and still finalises a Full-mode checkout', async () => {
    expect(supportsTransactions()).toBe(false)

    const supplier = await User.create({
      email: `f1-standalone-supplier-${rand()}@test.bookcars.ma`,
      fullName: 'F1 Standalone Supplier',
      language: 'en', type: bookcarsTypes.UserType.Supplier,
      active: true, verified: true, blacklisted: false, payLater: true,
    })
    fixtureIds.users.push(supplier._id)
    const driver = await User.create({
      email: `f1-standalone-driver-${rand()}@test.bookcars.ma`,
      fullName: 'F1 Standalone Driver',
      language: 'en', type: bookcarsTypes.UserType.User,
      active: true, verified: true, blacklisted: false,
      expireAt: new Date(Date.now() + 3600000),
    })
    fixtureIds.users.push(driver._id)
    const value = await LocationValue.create({ language: 'en', value: 'F1 Standalone Airport' })
    fixtureIds.locationValues.push(value._id)
    const location = await Location.create({ country: oid(), values: [value._id] })
    fixtureIds.locations.push(location._id)
    const car = await Car.create({
      name: 'F1 standalone car', supplier: supplier._id, minimumAge: 21,
      locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
      type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
      aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
      mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
      collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
      range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
    } as any)
    fixtureIds.cars.push(car._id)
    const booking = await Booking.create({
      supplier: supplier._id, car: car._id, driver: driver._id,
      pickupLocation: location._id, dropOffLocation: location._id,
      from: new Date(Date.now() + 86400000), to: new Date(Date.now() + 3 * 86400000),
      status: bookcarsTypes.BookingStatus.Void, price: 1000,
      sessionId: `cs-f1-standalone-${rand()}`,
      expireAt: new Date(Date.now() + 3600000),
      financialSnapshot: {
        version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
        mode: bookcarsTypes.CheckoutPaymentMode.Full,
        rentalTotal: 1000, depositAmount: 250,
        amountDueNow: 1250, amountDueNowInPaymentCurrency: 1250,
        quotedAt: new Date(),
      },
    } as any)
    fixtureIds.bookings.push(booking._id)

    const finalized = await finalizePaidCheckoutBooking(booking, 'stripe', 'pi_f1_standalone')
    expect(finalized).toBe(true)

    const saved = await Booking.findById(booking._id).lean()
    expect(saved?.status).toBe(bookcarsTypes.BookingStatus.PaidInFull)
    expect(saved?.expireAt).toBeUndefined()
    const payments = await RentalPayment.find({ booking: booking._id }).lean()
    expect(payments).toHaveLength(2)
    expect(payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Rent)?.amount).toBe(1000)
    expect(payments.find((p) => p.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit)?.amount).toBe(250)
    const savedCar = await Car.findById(car._id).lean()
    expect(savedCar?.trips).toBe(1)
    const savedDriver = await User.findById(driver._id).lean()
    expect(savedDriver?.expireAt).toBeUndefined()
  })
})
