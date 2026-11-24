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

// GH-01 — date amendments refused on ReturnReview (gap-hunt 2026-11-24).
// Same harness shape as f4ContractOps: the booking is created directly
// (the amend endpoint only reads lifecycle/status/dates), the amend
// call goes through the real HTTP route with the platform-admin token.

const DAY = 86400000
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

let adminToken: string
let adminId: string

const makeFixture = async (label: string, lifecycle: bookcarsTypes.ContractLifecycle) => {
  const supplier = await User.create({
    email: `gh01-supplier-${label}-${rand()}@test.bookcars.ma`,
    fullName: `GH-01 Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `gh01-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `GH-01 Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const value = await LocationValue.create({ language: 'en', value: `GH-01 Airport ${label}` })
  fixtureLocationValueIds.push(value._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [value._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: `GH-01 car ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  // One clock read for both ends so the window is exactly 4 days.
  const now = Date.now()
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(now - 2 * DAY),
    to: new Date(now + 2 * DAY),
    status: bookcarsTypes.BookingStatus.Paid,
    lifecycle,
    price: 1000,
    cancellation: false, amendments: false, theftProtection: false,
    collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
      mode: bookcarsTypes.CheckoutPaymentMode.Full,
      rentalTotal: 1000, depositAmount: 250,
      amountDueNow: 1000, amountDueNowInPaymentCurrency: 1000,
      quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
  return { supplier, driver, location, car, booking, now }
}

const amendAsAdmin = (bookingId: string, body: object) =>
  request(app).post(`/api/bookings/${bookingId}/amend`).set(env.X_ACCESS_TOKEN, adminToken).send(body)

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh01-admin', email: `gh01-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })
})

afterAll(async () => {
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

afterEach(async () => {
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
})

describe('GH-01 — date amendments on ReturnReview', () => {
  it('refuses a `to` change on ReturnReview with AMENDMENT_DATE_AFTER_RETURN and leaves the dates untouched', async () => {
    const fixture = await makeFixture('return-review', bookcarsTypes.ContractLifecycle.ReturnReview)
    const originalTo = new Date(fixture.booking.to)
    const response = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'Extend the rental by one day',
      to: new Date(fixture.now + 3 * DAY).toISOString(),
    })
    expect(response.status).toBe(409)
    expect(response.text).toContain('AMENDMENT_DATE_AFTER_RETURN')
    const reloaded = await Booking.findById(fixture.booking._id)
    expect(new Date(reloaded!.to).getTime()).toBe(originalTo.getTime())
    expect(reloaded!.amendmentHistory?.length || 0).toBe(0)
  })

  it('still allows a date-only amendment on Active (the previous rule)', async () => {
    const fixture = await makeFixture('active', bookcarsTypes.ContractLifecycle.Active)
    const response = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'Extend the rental by one day',
      to: new Date(fixture.now + 3 * DAY).toISOString(),
    })
    expect(response.status).toBe(200)
    // 4 days at 1000 -> 5 days at 250/day: re-priced from the snapshot basis.
    expect(response.body.price).toBe(1250)
    expect(response.body.financialSnapshot.version).toBe(2)
    expect(new Date(response.body.to).getTime()).toBe(new Date(fixture.now + 3 * DAY).getTime())
  })
})
