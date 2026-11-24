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

// R-1 / R-2 (API robustness pass on live #14, 2026-11-24): the booking
// read and list endpoints must fail fast with a specific 400 instead
// of an opaque "Internal Error: " from the controller catch-all, and
// an unknown booking id must be a 404, not 204.

let adminToken: string
let adminId: string
let supplierId: string
let bookingId: string

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

const listPayload = () => ({
  suppliers: [supplierId],
  statuses: Object.values(bookcarsTypes.BookingStatus),
})

const list = (page: string, size: string, body: object) =>
  request(app).post(`/api/bookings/${page}/${size}/en`).set(env.X_ACCESS_TOKEN, adminToken).send(body)

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'r1r2-admin', email: `r1r2-admin-${rand()}@test.bookcars.ma`, language: 'en',
    type: bookcarsTypes.UserType.Admin, password: passwordHash,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  const supplier = await User.create({
    email: `r1r2-supplier-${rand()}@test.bookcars.ma`, fullName: 'R1R2 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  supplierId = supplier._id.toString()
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `r1r2-driver-${rand()}@test.bookcars.ma`, fullName: 'R1R2 Driver',
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: 'R1R2 Casablanca Airport' })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: 'R1R2 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  const now = Date.now()
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(now + 1 * 86400000),
    to: new Date(now + 3 * 86400000),
    status: bookcarsTypes.BookingStatus.Paid,
    lifecycle: bookcarsTypes.ContractLifecycle.Confirmed,
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

describe('R-1/R-2 booking read + list validation', () => {
  test('getBooking with a malformed id returns a specific 400, not "Internal Error: "', async () => {
    const res = await request(app).get('/api/booking/not-an-id/en').set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(400)
    expect(res.text).toBe('Invalid booking id')
  })

  test('getBooking with a valid but unknown id returns 404, not 204', async () => {
    const res = await request(app).get(`/api/booking/${oid().toString()}/en`).set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(404)
  })

  test('getBookings with page 0 returns a specific 400', async () => {
    const res = await list('0', '5', listPayload())
    expect(res.status).toBe(400)
    expect(res.text).toBe('Invalid page or size')
  })

  test('getBookings with bad page/size combinations returns a specific 400', async () => {
    for (const [page, size] of [['-1', '5'], ['1', '0'], ['abc', 'def'], ['1', '-1']] as const) {
      const res = await list(page, size, listPayload())
      expect(res.status).toBe(400)
      expect(res.text).toBe('Invalid page or size')
    }
  })

  test('getBookings with missing statuses returns a specific 400', async () => {
    const res = await list('1', '5', { suppliers: [supplierId] })
    expect(res.status).toBe(400)
    expect(res.text).toBe('Invalid booking statuses')
  })

  test('getBookings with valid params still returns 200 and the fixture booking', async () => {
    const res = await list('1', '5', listPayload())
    expect(res.status).toBe(200)
    // The list endpoint returns the $facet array: [{ resultData, pageInfo }].
    const rows = res.body[0].resultData as { _id: string }[]
    expect(rows.some((row) => row._id === bookingId)).toBe(true)
  })
})
