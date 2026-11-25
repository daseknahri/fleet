import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import app from '../src/app'
import Booking from '../src/models/Booking'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// GH-16 — checkout / admin create / update refuse a past pickup date,
// same rule as amend (AMENDMENT_PAST_FROM): server-local start of today.
// A pickup later today is allowed; an update that only extends `to` on a
// booking whose pickup already passed must not trip.

const DAY = 86400000
const HOUR = 3600000
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

let adminToken: string
let adminId: string
let supplierId: string
let driverId: string
let locationId: string
let carCheckoutId: string
let carPastId: string
let carSeedId: string
let bookingId: string
let pastBookingId: string

const makeCar = async (label: string, supplier: mongoose.Types.ObjectId, location: mongoose.Types.ObjectId) => {
  const car = await Car.create({
    name: `GH-16 car ${label}`, supplier, minimumAge: 21,
    locations: [location], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  return car
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh16-admin', email: `gh16-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  const supplier = await User.create({
    email: `gh16-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-16 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  supplierId = supplier._id.toString()
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `gh16-driver-${rand()}@test.bookcars.ma`, fullName: 'GH-16 Driver',
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  driverId = driver._id.toString()
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: 'GH-16 Casablanca Airport' })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  locationId = location._id.toString()

  const carSeed = await makeCar('seed', supplier._id, location._id)
  carSeedId = carSeed._id.toString()
  const carCheckout = await makeCar('checkout', supplier._id, location._id)
  carCheckoutId = carCheckout._id.toString()
  const carPast = await makeCar('past', supplier._id, location._id)
  carPastId = carPast._id.toString()

  const now = Date.now()
  const booking = await Booking.create({
    supplier: supplier._id, car: carSeed._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(now + 1 * DAY),
    to: new Date(now + 3 * DAY),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: 1000,
    cancellation: true,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD', mode: bookcarsTypes.CheckoutPaymentMode.Full,
      rentalTotal: 1000, depositAmount: 250,
      amountDueNow: 1000, amountDueNowInPaymentCurrency: 1000,
      quotedAt: new Date(),
    },
  } as any)
  bookingId = booking._id.toString()
  fixtureBookingIds.push(booking._id)

  // A Draft booking whose pickup already passed (for the extend-only-`to` case).
  // Snapshot-LESS on purpose: the checkout-terms lock (bookingController
  // :1712) refuses any date change on a booking with a real snapshot, so a
  // snapshot booking can never exercise the extend-`to` path via update.
  const pastBooking = await Booking.create({
    supplier: supplier._id, car: carPast._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(now - 2 * DAY),
    to: new Date(now + 2 * DAY),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: 1000,
    cancellation: true,
  } as any)
  pastBookingId = pastBooking._id.toString()
  fixtureBookingIds.push(pastBooking._id)
})

afterAll(async () => {
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-16 past pickup', () => {
  const checkoutPayload = (from: Date, to: Date) => ({
    booking: {
      supplier: supplierId,
      car: carCheckoutId,
      driver: driverId,
      pickupLocation: locationId,
      dropOffLocation: locationId,
      from,
      to,
      status: bookcarsTypes.BookingStatus.Pending,
      cancellation: true,
      amendments: true,
      theftProtection: false,
      collisionDamageWaiver: false,
      fullInsurance: false,
      price: 312,
      additionalDriver: false,
    },
    paymentMode: bookcarsTypes.CheckoutPaymentMode.PayLater,
    paymentGateway: bookcarsTypes.PaymentGateway.Stripe,
    currency: 'MAD',
  })

  test('checkout with from yesterday returns 400 CHECKOUT_PAST_FROM', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send(checkoutPayload(new Date(Date.now() - 1 * DAY), new Date(Date.now() + 1 * DAY)))
    expect(res.status).toBe(400)
    expect(res.text).toContain('CHECKOUT_PAST_FROM')
  })

  test('checkout with from later today passes the date guard', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send(checkoutPayload(new Date(Date.now() + 2 * HOUR), new Date(Date.now() + 2 * DAY)))
    expect(res.status).toBe(200)
    if (res.body.bookingId) {
      fixtureBookingIds.push(new mongoose.Types.ObjectId(res.body.bookingId))
    }
  })

  test('checkout with from tomorrow passes the date guard', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send(checkoutPayload(new Date(Date.now() + 5 * DAY), new Date(Date.now() + 7 * DAY)))
    expect(res.status).toBe(200)
    if (res.body.bookingId) {
      fixtureBookingIds.push(new mongoose.Types.ObjectId(res.body.bookingId))
    }
  })

  test('admin create with from yesterday returns 400 CREATE_PAST_FROM', async () => {
    const res = await request(app)
      .post('/api/create-booking')
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({
        booking: {
          supplier: supplierId,
          car: carCheckoutId,
          driver: driverId,
          pickupLocation: locationId,
          dropOffLocation: locationId,
          from: new Date(Date.now() - 1 * DAY),
          to: new Date(Date.now() + 1 * DAY),
          status: bookcarsTypes.BookingStatus.Pending,
          cancellation: true,
          amendments: true,
          theftProtection: false,
          collisionDamageWaiver: false,
          fullInsurance: false,
          price: 312,
          additionalDriver: false,
        },
      })
    expect(res.status).toBe(400)
    expect(res.text).toContain('CREATE_PAST_FROM')
  })

  test('update moving from to yesterday on a Draft booking returns 400 UPDATE_PAST_FROM', async () => {
    const res = await request(app)
      .put('/api/update-booking')
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({
        booking: {
          _id: bookingId,
          supplier: supplierId,
          car: carSeedId,
          driver: driverId,
          pickupLocation: locationId,
          dropOffLocation: locationId,
          from: new Date(Date.now() - 1 * DAY),
          to: new Date(Date.now() + 3 * DAY),
          status: bookcarsTypes.BookingStatus.Pending,
          cancellation: true,
          amendments: true,
          theftProtection: false,
          collisionDamageWaiver: false,
          fullInsurance: false,
          price: 1000,
          additionalDriver: false,
        },
      })
    expect(res.status).toBe(400)
    expect(res.text).toContain('UPDATE_PAST_FROM')
  })

  test('update extending only to on a booking whose from already passed does not trip', async () => {
    // Submit the EXACT stored `from` (millisecond-identical): the guard
    // keys on fromChanged, and a freshly-computed "2 days ago" would
    // differ by milliseconds and trip it.
    const stored = await Booking.findById(pastBookingId).lean()
    const res = await request(app)
      .put('/api/update-booking')
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({
        booking: {
          _id: pastBookingId,
          supplier: supplierId,
          car: carPastId,
          driver: driverId,
          pickupLocation: locationId,
          dropOffLocation: locationId,
          from: stored!.from,
          to: new Date(Date.now() + 4 * DAY),
          status: bookcarsTypes.BookingStatus.Pending,
          cancellation: true,
          amendments: true,
          theftProtection: false,
          collisionDamageWaiver: false,
          fullInsurance: false,
          price: 1000,
          additionalDriver: false,
        },
      })
    expect(res.status).toBe(200)
  })
})
