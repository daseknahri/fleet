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
import Agent from '../src/models/Agent'
import { days, daysOrZero } from '../src/utils/helper'
import { resolveBookingAgentSnapshot } from '../src/utils/agentCommission'

// GH-39 — inverted date ranges: shared daysOrZero + entry guards.
// An inverted range (to before from) is 0 days, never negative, and the
// two public search endpoints refuse it with 400 'Invalid rental dates'.

const DAY = 86400000
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixtureAgentIds: mongoose.Types.ObjectId[] = []

let adminToken: string
let adminId: string
let supplierId: string
let locationId: string
let carId: string
let bookingId: string
let agentId: string

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh39-admin', email: `gh39-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  const supplier = await User.create({
    email: `gh39-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-39 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  supplierId = supplier._id.toString()
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `gh39-driver-${rand()}@test.bookcars.ma`, fullName: 'GH-39 Driver',
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: 'GH-39 Casablanca Airport' })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  locationId = location._id.toString()
  const car = await Car.create({
    name: 'GH-39 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  carId = car._id.toString()
  const now = Date.now()
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(now + 1 * DAY),
    to: new Date(now + 3 * DAY),
    status: bookcarsTypes.BookingStatus.Paid,
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
  const agent = await Agent.create({
    supplier: supplier._id, name: 'GH-39 Agent', type: bookcarsTypes.AgentType.Other,
    commissionMode: bookcarsTypes.CommissionMode.PerDay, commissionValue: 50, active: true,
  })
  fixtureAgentIds.push(agent._id)
  agentId = agent._id.toString()
})

afterAll(async () => {
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Agent.deleteMany({ _id: { $in: fixtureAgentIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-39 daysOrZero', () => {
  test('days() still returns a negative count for an inverted range (the bug)', () => {
    const from = new Date('2026-11-10T10:00:00Z')
    const to = new Date('2026-11-08T10:00:00Z')
    expect(days(from, to)).toBe(-2)
  })

  test('daysOrZero floors an inverted range at 0', () => {
    const from = new Date('2026-11-10T10:00:00Z')
    const to = new Date('2026-11-08T10:00:00Z')
    expect(daysOrZero(from, to)).toBe(0)
  })

  test('daysOrZero same-day range is 0', () => {
    const d = new Date('2026-11-10T10:00:00Z')
    expect(daysOrZero(d, d)).toBe(0)
  })

  test('daysOrZero preserves the ceil for a valid range (+1.5 days -> 2)', () => {
    const from = new Date('2026-11-10T10:00:00Z')
    const to = new Date('2026-11-11T22:00:00Z')
    expect(daysOrZero(from, to)).toBe(2)
  })

  test('daysOrZero missing input is 0', () => {
    expect(daysOrZero(undefined, new Date())).toBe(0)
    expect(daysOrZero(new Date(), undefined)).toBe(0)
  })

  test('resolveBookingAgentSnapshot with days = -3 (perDay) floors the amount at 0', async () => {
    const res = await resolveBookingAgentSnapshot(supplierId, { agent: agentId }, 1000, -3)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.snapshot.amount).toBe(0)
    }
  })

  test('resolveBookingAgentSnapshot with days = 3 (perDay) still computes value x days', async () => {
    const res = await resolveBookingAgentSnapshot(supplierId, { agent: agentId }, 1000, 3)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.snapshot.amount).toBe(150)
    }
  })
})

describe('GH-39 search entry guards', () => {
  const carsPayload = (from: Date, to: Date) => ({
    suppliers: [supplierId],
    pickupLocation: locationId,
    carType: [bookcarsTypes.CarType.Diesel, bookcarsTypes.CarType.Gasoline],
    gearbox: [bookcarsTypes.GearboxType.Manual, bookcarsTypes.GearboxType.Automatic],
    mileage: [bookcarsTypes.Mileage.Limited, bookcarsTypes.Mileage.Unlimited],
    deposit: -1,
    ranges: [bookcarsTypes.CarRange.Mini, bookcarsTypes.CarRange.Midi, bookcarsTypes.CarRange.Maxi, bookcarsTypes.CarRange.Scooter],
    multimedia: [bookcarsTypes.CarMultimedia.AndroidAuto],
    rating: 4,
    seats: 6,
    carSpecs: { aircon: true, moreThanFiveSeats: true, moreThanFourDoors: true },
    fuelPolicy: [bookcarsTypes.FuelPolicy.LikeForLike],
    from,
    to,
  })

  test('getFrontendCars with to before from returns 400 Invalid rental dates', async () => {
    const res = await request(app)
      .post('/api/frontend-cars/1/10')
      .send(carsPayload(new Date(Date.now() + 3 * DAY), new Date(Date.now() + 1 * DAY)))
    expect(res.status).toBe(400)
    expect(res.text).toBe('Invalid rental dates')
  })

  test('getFrontendCars with a valid range returns 200', async () => {
    const res = await request(app)
      .post('/api/frontend-cars/1/10')
      .send(carsPayload(new Date(Date.now() + 1 * DAY), new Date(Date.now() + 3 * DAY)))
    expect(res.status).toBe(200)
  })

  test('getFrontendSuppliers with to before from returns 400 Invalid rental dates', async () => {
    const res = await request(app)
      .post('/api/frontend-suppliers')
      .send(carsPayload(new Date(Date.now() + 3 * DAY), new Date(Date.now() + 1 * DAY)))
    expect(res.status).toBe(400)
    expect(res.text).toBe('Invalid rental dates')
  })

  test('getFrontendSuppliers with a valid range returns 200', async () => {
    const res = await request(app)
      .post('/api/frontend-suppliers')
      .send(carsPayload(new Date(Date.now() + 1 * DAY), new Date(Date.now() + 3 * DAY)))
    expect(res.status).toBe(200)
  })

  test('amend with inverted dates returns 400 (regression lock)', async () => {
    const res = await request(app)
      .post(`/api/bookings/${bookingId}/amend`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ reason: 'GH-39 regression test', from: new Date(Date.now() + 3 * DAY), to: new Date(Date.now() + 1 * DAY) })
    expect(res.status).toBe(400)
    expect(res.text).toBe('Invalid rental dates')
  })
})
