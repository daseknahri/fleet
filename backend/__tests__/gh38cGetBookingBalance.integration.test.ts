import 'dotenv/config'
import mongoose from 'mongoose'
import request from 'supertest'
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
import { getContractReceivable } from '../src/utils/contractReceivable'

// GH-38c(ii) — getBooking attaches the ledger-derived balance fields
// (outstandingBalance / depositHeld / balanceDueAt / balanceOverdue)
// AFTER the ownership check, reusing the GH-17 receivable. The driver
// sees them; another user keeps the existing 403 (no balance leak).

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const day = 86400000

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

let supplier: any
let driver: any
let otherUser: any
let booking: any

const tokenFor = async (user: any) => authHelper.encryptJWT({ id: user._id.toString() })

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplier = await User.create({
    email: `gh38c-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-38c Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `gh38c-driver-${rand()}@test.bookcars.ma`, fullName: 'GH-38c Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
    supplier: supplier._id,
  })
  fixtureUserIds.push(driver._id)
  otherUser = await User.create({
    email: `gh38c-other-${rand()}@test.bookcars.ma`, fullName: 'GH-38c Other',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
    supplier: supplier._id,
  })
  fixtureUserIds.push(otherUser._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `GH-38c Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: 'GH-38c car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(Date.now() + day), to: new Date(Date.now() + 3 * day),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: 300,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
      mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
      rentalTotal: 300, depositAmount: 50,
      amountDueNow: 300, amountDueNowInPaymentCurrency: 300, quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
})

afterAll(async () => {
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})

describe('GH-38c(ii) — getBooking balance fields', () => {
  it('driver reads their own booking with ledger-correct balance fields', async () => {
    const expected = await getContractReceivable(await Booking.findById(booking._id) as any)
    const res = await request(app)
      .get(`/api/booking/${booking._id}/en`)
      .set(env.X_ACCESS_TOKEN, await tokenFor(driver))
    expect(res.status).toBe(200)
    expect(res.body.outstandingBalance).toBe(expected.outstandingBalance)
    expect(res.body.outstandingBalance).toBe(300)
    // R6-31 — depositHeld is what is actually held (net posted
    // deposit), not the refundable figure: no payments are posted
    // on this fixture, so it holds 0 (refundableDeposit is 50).
    expect(res.body.depositHeld).toBe(expected.depositPayments)
    expect(res.body.depositHeld).toBe(0)
    expect(res.body.balanceOverdue).toBe(expected.overdue)
    expect(res.body.balanceOverdue).toBe(false)
    expect(res.body.balanceDueAt).toBeDefined()
  })

  it('another user is still refused (403) — no balance leak', async () => {
    const res = await request(app)
      .get(`/api/booking/${booking._id}/en`)
      .set(env.X_ACCESS_TOKEN, await tokenFor(otherUser))
    expect(res.status).toBe(403)
    expect(res.body.outstandingBalance).toBeUndefined()
  })
})
