import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import User from '../src/models/User'
import Booking from '../src/models/Booking'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// GH-37 — a guest checkout that matches an existing account by email
// must also match on name + phone, or it is a 409. Digits-only phone
// comparison is deliberate (no country-code collapsing).
//
// The app is imported dynamically in beforeAll, AFTER the mail mock
// below is registered: the new-guest branch sends an activation email
// (bare await in bookingController), and the real mailer throws on the
// unreachable test SMTP host. With native ESM Jest a static `import
// app` would load the real mailer before the mock applies.

const mailSendMock: any = jest.fn(async () => ({}))

jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: mailSendMock,
}))

let app: any

const DAY = 86400000
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

let supplierId: string
let locationId: string
let seededId: string
let legacyId: string
const carIds: string[] = []

const SEEDED_EMAIL = 'a@example.com'
const LEGACY_EMAIL = 'legacy@example.com'

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)

  // A stale seeded user from a crashed run would break the "no new
  // User row" assertion; the email is the pack's literal value.
  await User.deleteMany({ email: { $in: [SEEDED_EMAIL, LEGACY_EMAIL] } })

  const supplier = await User.create({
    email: `gh37-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-37 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  supplierId = supplier._id.toString()
  fixtureUserIds.push(supplier._id)

  const seeded = await User.create({
    email: SEEDED_EMAIL, fullName: 'Test User', phone: '+212600000000',
    birthDate: new Date(1992, 5, 25), language: 'en',
    type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  seededId = seeded._id.toString()
  fixtureUserIds.push(seeded._id)

  const legacy = await User.create({
    email: LEGACY_EMAIL, fullName: 'Legacy User',
    birthDate: new Date(1990, 0, 1), language: 'en',
    type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  legacyId = legacy._id.toString()
  fixtureUserIds.push(legacy._id)

  const valueEn = await LocationValue.create({ language: 'en', value: `GH-37 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  locationId = location._id.toString()

  for (let i = 0; i < 5; i += 1) {
    const car = await Car.create({
      name: `GH-37 car ${i}`, supplier: supplier._id, minimumAge: 21,
      locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
      type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
      aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
      mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
      collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
      range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
    } as any)
    fixtureCarIds.push(car._id)
    carIds.push(car._id.toString())
  }
})

afterAll(async () => {
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})

describe('GH-37 guest checkout account match', () => {
  const checkout = (carIndex: number, fromDays: number, toDays: number, driver: object) => request(app)
    .post('/api/checkout')
    .send({
      booking: {
        supplier: supplierId,
        car: carIds[carIndex],
        pickupLocation: locationId,
        dropOffLocation: locationId,
        from: new Date(Date.now() + fromDays * DAY),
        to: new Date(Date.now() + toDays * DAY),
        status: bookcarsTypes.BookingStatus.Pending,
        cancellation: true,
        amendments: true,
        theftProtection: false,
        collisionDamageWaiver: false,
        fullInsurance: false,
        price: 312,
        additionalDriver: false,
      },
      driver: {
        birthDate: new Date(1992, 5, 25),
        language: 'en',
        ...driver,
      },
      paymentMode: bookcarsTypes.CheckoutPaymentMode.PayLater,
      paymentGateway: bookcarsTypes.PaymentGateway.Stripe,
      currency: 'MAD',
    })

  test('same email + same name + same phone (different formatting, same digits) attaches to the seeded user', async () => {
    const res = await checkout(0, 1, 3, {
      fullName: 'Test User', email: SEEDED_EMAIL, phone: '+212 600 000 000',
    })
    expect(res.status).toBe(200)
    expect(res.body.bookingId).toBeDefined()
    fixtureBookingIds.push(new mongoose.Types.ObjectId(res.body.bookingId))
    const booking = await Booking.findById(res.body.bookingId).lean()
    expect(booking?.driver?.toString()).toBe(seededId)
    // No new User row was created for the match.
    expect(await User.countDocuments({ email: SEEDED_EMAIL })).toBe(1)
  })

  test('same email + different name returns 409 CHECKOUT_ACCOUNT_MISMATCH', async () => {
    const res = await checkout(1, 1, 3, {
      fullName: 'Someone Else', email: SEEDED_EMAIL, phone: '+212600000000',
    })
    expect(res.status).toBe(409)
    expect(res.text).toContain('CHECKOUT_ACCOUNT_MISMATCH')
    expect(await Booking.countDocuments({ car: carIds[1] })).toBe(0)
  })

  test('same email + same name + different phone returns 409 CHECKOUT_ACCOUNT_MISMATCH', async () => {
    const res = await checkout(2, 1, 3, {
      fullName: 'Test User', email: SEEDED_EMAIL, phone: '+212611111111',
    })
    expect(res.status).toBe(409)
    expect(res.text).toContain('CHECKOUT_ACCOUNT_MISMATCH')
    expect(await Booking.countDocuments({ car: carIds[2] })).toBe(0)
  })

  test('same email + same name with no stored phone attaches (name-only fallback for legacy accounts)', async () => {
    const res = await checkout(3, 1, 3, {
      fullName: 'Legacy User', email: LEGACY_EMAIL, phone: '+212622222222',
    })
    expect(res.status).toBe(200)
    expect(res.body.bookingId).toBeDefined()
    fixtureBookingIds.push(new mongoose.Types.ObjectId(res.body.bookingId))
    const booking = await Booking.findById(res.body.bookingId).lean()
    expect(booking?.driver?.toString()).toBe(legacyId)
    expect(await User.countDocuments({ email: LEGACY_EMAIL })).toBe(1)
  })

  test('new email creates a new guest account as before (regression lock)', async () => {
    const newEmail = `new-${rand()}@example.com`
    const res = await checkout(4, 1, 3, {
      fullName: 'New Guest', email: newEmail, phone: '+212633333333',
    })
    expect(res.status).toBe(200)
    expect(res.body.bookingId).toBeDefined()
    fixtureBookingIds.push(new mongoose.Types.ObjectId(res.body.bookingId))
    const guest = await User.findOne({ email: newEmail }).lean()
    expect(guest).not.toBeNull()
    fixtureUserIds.push(guest!._id)
    const booking = await Booking.findById(res.body.bookingId).lean()
    expect(booking?.driver?.toString()).toBe(guest!._id.toString())
  })
})
