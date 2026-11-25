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

// GH-15 — the booking reference is allocated only after validation
// passes: a refused checkout or create burns no number, so successive
// references differ by exactly 1 across the refusal in between.
// (An admin-created Draft never reserves the car — O-02 — so a plain
// overlapping create does not 409; the create-funnel no-gap proof here
// is a 400 after the old allocation point, and the 409 proof lives on
// the checkout funnel, where the pay-later hold reserves the car.)

const DAY = 86400000
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
let carId: string

const suffix = (reference: string) => {
  const parts = reference.split('-')
  return Number(parts[parts.length - 1])
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh15-admin', email: `gh15-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  const supplier = await User.create({
    email: `gh15-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-15 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  supplierId = supplier._id.toString()
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `gh15-driver-${rand()}@test.bookcars.ma`, fullName: 'GH-15 Driver',
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  driverId = driver._id.toString()
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: 'GH-15 Casablanca Airport' })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  locationId = location._id.toString()
  const car = await Car.create({
    name: 'GH-15 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  carId = car._id.toString()
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

describe('GH-15 reference after validation', () => {
  const bookingFields = (from: Date, to: Date) => ({
    supplier: supplierId,
    car: carId,
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
  })

  const checkout = (from: Date, to: Date) => request(app).post('/api/checkout').send({
    booking: bookingFields(from, to),
    paymentMode: bookcarsTypes.CheckoutPaymentMode.PayLater,
    paymentGateway: bookcarsTypes.PaymentGateway.Stripe,
    currency: 'MAD',
  })

  const adminCreate = (from: Date, to: Date) => request(app)
    .post('/api/create-booking')
    .set(env.X_ACCESS_TOKEN, adminToken)
    .send({ booking: bookingFields(from, to) })

  test('a conflicting checkout burns no number: successive references differ by exactly 1', async () => {
    const now = Date.now()
    // Seed: a pay-later checkout reserves the car (Pending + expireAt).
    const resA = await checkout(new Date(now + 1 * DAY), new Date(now + 3 * DAY))
    expect(resA.status).toBe(200)
    fixtureBookingIds.push(new mongoose.Types.ObjectId(resA.body.bookingId))
    const bookingA = await Booking.findById(resA.body.bookingId).lean()
    expect(bookingA?.reference).toMatch(/^GA-\d{6}-\d{4}$/)
    const suffixA = suffix(bookingA!.reference as string)

    // Conflicting checkout for the same car + overlapping dates -> 409.
    const resConflict = await checkout(new Date(now + 2 * DAY), new Date(now + 4 * DAY))
    expect(resConflict.status).toBe(409)

    // Next successful create -> exactly one higher, no gap.
    const resB = await adminCreate(new Date(now + 5 * DAY), new Date(now + 7 * DAY))
    expect(resB.status).toBe(200)
    expect(resB.body.reference).toMatch(/^GA-\d{6}-\d{4}$/)
    fixtureBookingIds.push(new mongoose.Types.ObjectId(resB.body._id))
    expect(suffix(resB.body.reference as string)).toBe(suffixA + 1)
  })

  test('a refused admin create burns no number either', async () => {
    const now = Date.now()
    const resA = await adminCreate(new Date(now + 10 * DAY), new Date(now + 12 * DAY))
    expect(resA.status).toBe(200)
    fixtureBookingIds.push(new mongoose.Types.ObjectId(resA.body._id))
    const suffixA = suffix(resA.body.reference as string)

    // Refusals after the old allocation point: inverted dates (400) and
    // a past pickup (GH-16, 400). Neither may burn a number.
    const resBadDates = await adminCreate(new Date(now + 13 * DAY), new Date(now + 12 * DAY))
    expect(resBadDates.status).toBe(400)
    const resPast = await adminCreate(new Date(now - 1 * DAY), new Date(now + 1 * DAY))
    expect(resPast.status).toBe(400)

    const resB = await adminCreate(new Date(now + 14 * DAY), new Date(now + 16 * DAY))
    expect(resB.status).toBe(200)
    fixtureBookingIds.push(new mongoose.Types.ObjectId(resB.body._id))
    expect(suffix(resB.body.reference as string)).toBe(suffixA + 1)
  })

  test('a successful checkout still carries a reference', async () => {
    const now = Date.now()
    const res = await checkout(new Date(now + 20 * DAY), new Date(now + 22 * DAY))
    expect(res.status).toBe(200)
    expect(res.body.bookingId).toBeTruthy()
    fixtureBookingIds.push(new mongoose.Types.ObjectId(res.body.bookingId))
    const booking = await Booking.findById(res.body.bookingId).lean()
    expect(booking?.reference).toMatch(/^GA-\d{6}-\d{4}$/)
  })
})
