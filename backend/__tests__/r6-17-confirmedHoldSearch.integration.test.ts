import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// R6-17 — a Confirmed pay-later hold (Pending + lifecycle Confirmed,
// expireAt cleared) must hide its car in BOTH customer search paths
// (car search + supplier search), exactly as the enforcement helper
// (checkBookingAvailability) already blocks checkout for it. The two
// aggregations share reservationStatusOrExpr from the helper now.
const stripeRefundCreate: any = jest.fn()
const paypalGetOrder: any = jest.fn()
const paypalRefundCapture: any = jest.fn()
const mailSendMock: any = jest.fn(async () => ({}))

jest.unstable_mockModule('../src/payment/stripe.js', () => ({
  default: {
    checkout: { sessions: { retrieve: jest.fn() } },
    paymentIntents: { retrieve: jest.fn() },
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

const day = 86400000
const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const at = (days: number) => new Date(Date.now() + days * day)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

let supplier: any
let driver: any
let location: any
let carA: any
let carB: any
let carC: any

const snapshot = (rentalTotal: number) => ({
  version: 1,
  baseCurrency: 'MAD',
  paymentCurrency: 'MAD',
  mode: bookcarsTypes.CheckoutPaymentMode.PayLater,
  rentalTotal,
  depositAmount: 0,
  amountDueNow: rentalTotal,
  amountDueNowInPaymentCurrency: rentalTotal,
  quotedAt: new Date(),
})

const makeCar = async (label: string) => {
  const car = await Car.create({
    name: `R6-17 ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  return car
}

const makeBooking = async (
  car: any,
  opts: {
    lifecycle?: bookcarsTypes.ContractLifecycle,
    expireAt?: Date | null,
  },
) => {
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: at(1), to: at(3),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: opts.lifecycle || bookcarsTypes.ContractLifecycle.Draft,
    price: 1000,
    financialSnapshot: snapshot(1000),
    ...(opts.expireAt !== undefined ? { expireAt: opts.expireAt } : {}),
  } as any)
  fixtureBookingIds.push(booking._id)
  return booking
}

// Same window as the holds above; the minimal filter shape from
// car.test.ts (full type/gearbox/fuelPolicy arrays, no seat/rating/
// range/multimedia/carSpecs filters, deposit -1).
const searchBody = () => ({
  suppliers: [supplier._id.toString()],
  pickupLocation: location._id.toString(),
  carType: [bookcarsTypes.CarType.Diesel, bookcarsTypes.CarType.Gasoline],
  gearbox: [bookcarsTypes.GearboxType.Manual, bookcarsTypes.GearboxType.Automatic],
  mileage: [bookcarsTypes.Mileage.Limited, bookcarsTypes.Mileage.Unlimited],
  fuelPolicy: [bookcarsTypes.FuelPolicy.FreeTank, bookcarsTypes.FuelPolicy.LikeForLike],
  deposit: -1,
  from: at(1).toISOString(),
  to: at(3).toISOString(),
})

const searchCars = async () => {
  const res = await request(app).post('/api/frontend-cars/1/10').send(searchBody())
  expect(res.status).toBe(200)
  const rows = res.body[0].resultData as Array<{ _id: string }>
  return rows.map((row) => row._id.toString())
}

const searchSuppliers = async () => {
  const res = await request(app).post('/api/frontend-suppliers').send(searchBody())
  expect(res.status).toBe(200)
  const rows = res.body as Array<{ _id: string, carCount: number }>
  return rows.find((row) => row._id.toString() === supplier._id.toString())
}

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'r617-admin', email: `r617-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(admin._id)

  supplier = await User.create({
    email: `r617-supplier-${rand()}@test.bookcars.ma`, fullName: 'R6-17 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `r617-driver-${rand()}@test.bookcars.ma`, fullName: 'R6-17 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `R6-17 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  carA = await makeCar('confirmed-hold car')
  carB = await makeCar('expiring-hold car')
  carC = await makeCar('free car')

  // Car A: CONFIRMED pay-later hold — Pending + Confirmed, expireAt
  // cleared by the confirm action (no expireAt stored at all).
  await makeBooking(carA, { lifecycle: bookcarsTypes.ContractLifecycle.Confirmed, expireAt: null })
  // Car B: unconfirmed pay-later hold, still inside its window.
  await makeBooking(carB, { expireAt: new Date(Date.now() + 12 * 60 * 60 * 1000) })
  // Car C: no booking.
})

afterAll(async () => {
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})

describe('R6-17 — Confirmed-hold leg in customer search', () => {
  it('a Confirmed pay-later hold hides its car in both search paths', async () => {
    // A is hidden by the new Confirmed leg (Pending + Confirmed, no
    // expireAt). B is hidden too — by the PRE-EXISTING Draft leg
    // (Pending + future expireAt), which already reserved the car
    // before R6-17. Only the free car shows.
    const cars = await searchCars()
    expect(cars).not.toContain(carA._id.toString())
    expect(cars).not.toContain(carB._id.toString())
    expect(cars).toContain(carC._id.toString())
    const row = await searchSuppliers()
    expect(row).toBeDefined()
    expect(row!.carCount).toBe(1)
  })

  it('an unconfirmed hold hides the car while unexpired and shows it after expiry', async () => {
    // B is still inside its window here (see the first test): hidden.
    expect(await searchCars()).not.toContain(carB._id.toString())
    expect((await searchSuppliers())!.carCount).toBe(1)
    // Expire B's hold: the car comes back in both paths; A stays hidden.
    await Booking.updateMany(
      { car: carB._id },
      { $set: { expireAt: new Date(Date.now() - 60 * 60 * 1000) } },
    )
    const cars = await searchCars()
    expect(cars).toContain(carB._id.toString())
    expect(cars).not.toContain(carA._id.toString())
    expect((await searchSuppliers())!.carCount).toBe(2)
    // Cancelling A's hold frees it too.
    await Booking.updateMany(
      { car: carA._id },
      { $set: { lifecycle: bookcarsTypes.ContractLifecycle.Cancelled, status: bookcarsTypes.BookingStatus.Cancelled } },
    )
    expect(await searchCars()).toEqual(expect.arrayContaining([
      carA._id.toString(), carB._id.toString(), carC._id.toString(),
    ]))
    expect((await searchSuppliers())!.carCount).toBe(3)
  })
})
