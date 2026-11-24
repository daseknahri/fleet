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
import MaintenanceWorkOrder from '../src/models/MaintenanceWorkOrder'

// O-02 (audit 2026-11-24) — the PAR-10 overlap exception: an admin
// create with a reason must STORE the exception (reason + authoriser +
// conflicting booking) and confirm must honour it. Without an exception
// the overlap 409s at confirm; an exception that excepts nothing is not
// recorded; a maintenance conflict is never excepted.

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
let adminToken: string
let adminId: string

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const DAY = 86400000

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixtureWorkOrderIds: mongoose.Types.ObjectId[] = []

const makeFixture = async (label: string) => {
  const supplier = await User.create({
    email: `o02-supplier-${label}-${rand()}@test.bookcars.ma`,
    fullName: `O02 Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `o02-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `O02 Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `O02 Casablanca Airport ${label}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: `O02 car ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  const supplierToken = await authHelper.encryptJWT({ id: supplier._id.toString() })
  return { supplier, driver, location, car, supplierToken }
}

// A booking that reserves the car (Paid status), created directly.
const makeReservingBooking = async (fixture: any, fromOffset: number, toOffset: number) => {
  const now = Date.now()
  const booking = await Booking.create({
    supplier: fixture.supplier._id, car: fixture.car._id, driver: fixture.driver._id,
    pickupLocation: fixture.location._id, dropOffLocation: fixture.location._id,
    from: new Date(now + fromOffset * DAY),
    to: new Date(now + toOffset * DAY),
    status: bookcarsTypes.BookingStatus.Paid,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: 1000,
    cancellation: false, amendments: false, theftProtection: false,
    collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
  } as any)
  fixtureBookingIds.push(booking._id)
  return booking
}

const createViaApi = (fixture: any, fromOffset: number, toOffset: number, extra: Record<string, unknown> = {}) => {
  const now = Date.now()
  return request(app).post('/api/create-booking').set(env.X_ACCESS_TOKEN, adminToken).send({
    booking: {
      supplier: fixture.supplier._id.toString(), car: fixture.car._id.toString(), driver: fixture.driver._id.toString(),
      pickupLocation: fixture.location._id.toString(), dropOffLocation: fixture.location._id.toString(),
      from: new Date(now + fromOffset * DAY), to: new Date(now + toOffset * DAY),
      status: bookcarsTypes.BookingStatus.Pending, price: 1000,
      cancellation: false, amendments: false, theftProtection: false,
      collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
      ...extra,
    },
  })
}

const readBooking = (id: string) =>
  request(app).get(`/api/booking/${id}/en`).set(env.X_ACCESS_TOKEN, adminToken)

const confirmBooking = (id: string) =>
  request(app).post(`/api/bookings/${id}/confirm-reservation`).set(env.X_ACCESS_TOKEN, adminToken).send({})

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'o02-admin', email: `o02-admin-${rand()}@test.bookcars.ma`, language: 'en',
    type: bookcarsTypes.UserType.Admin, password: passwordHash,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })
})

afterAll(async () => {
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

afterEach(async () => {
  await MaintenanceWorkOrder.deleteMany({ _id: { $in: fixtureWorkOrderIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  fixtureWorkOrderIds.length = 0
  fixtureBookingIds.length = 0
  fixtureCarIds.length = 0
  fixtureLocationIds.length = 0
  fixtureLocationValueIds.length = 0
  fixtureUserIds.length = 0
})

describe('O-02 — PAR-10 overlap exception', () => {
  it('stores the exception on create and confirm honours it', async () => {
    const fixture = await makeFixture('store')
    const existing = await makeReservingBooking(fixture, 10, 13)
    const reason = 'O-02 test: regular customer, car swapped from pool'
    const created = await createViaApi(fixture, 12, 15, { overlapException: { reason } })
    expect(created.status).toBe(200)
    const createdId = created.body._id.toString()
    fixtureBookingIds.push(new mongoose.Types.ObjectId(createdId))
    // Stored record (DB ground truth): reason + authoriser + conflicting booking.
    const stored = await Booking.findById(createdId).lean() as any
    expect(stored.overlapException).toBeDefined()
    expect(stored.overlapException.reason).toBe(reason)
    expect(stored.overlapException.authorisedBy).toBeDefined()
    expect(stored.overlapException.authorisedAt).toBeDefined()
    expect(stored.overlapException.conflictingBooking.toString()).toBe(existing._id.toString())
    // And the API readback carries the key (the audit's readback lacked it).
    const read = await readBooking(createdId)
    expect(read.status).toBe(200)
    expect(read.body.overlapException?.reason).toBe(reason)
    const confirmed = await confirmBooking(createdId)
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Confirmed)
  })

  it('a plain overlapping draft stores no exception and confirm 409s', async () => {
    const fixture = await makeFixture('plain')
    await makeReservingBooking(fixture, 10, 13)
    const created = await createViaApi(fixture, 12, 15)
    expect(created.status).toBe(200)
    const createdId = created.body._id.toString()
    fixtureBookingIds.push(new mongoose.Types.ObjectId(createdId))
    const read = await readBooking(createdId)
    expect(read.status).toBe(200)
    expect(read.body.overlapException?.reason).toBeUndefined()
    const confirmed = await confirmBooking(createdId)
    expect(confirmed.status).toBe(409)
  })

  it('an exception that excepts nothing is not recorded', async () => {
    const fixture = await makeFixture('nothing')
    const reason = 'O-02 test: no overlap exists'
    const created = await createViaApi(fixture, 12, 15, { overlapException: { reason } })
    expect(created.status).toBe(200)
    const createdId = created.body._id.toString()
    fixtureBookingIds.push(new mongoose.Types.ObjectId(createdId))
    const read = await readBooking(createdId)
    expect(read.status).toBe(200)
    expect(read.body.overlapException?.reason).toBeUndefined()
    const confirmed = await confirmBooking(createdId)
    expect(confirmed.status).toBe(200)
  })

  it('a maintenance conflict is never excepted, even with a reason', async () => {
    const fixture = await makeFixture('maintenance')
    const now = Date.now()
    const wo = await request(app).post('/api/maintenance-work-orders').set(env.X_ACCESS_TOKEN, fixture.supplierToken).send({
      car: fixture.car._id.toString(),
      title: 'O-02 maintenance fixture',
      type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
      status: bookcarsTypes.WorkOrderStatus.Scheduled,
      scheduledStart: new Date(now + 11 * DAY),
      scheduledEnd: new Date(now + 14 * DAY),
    })
    expect(wo.status).toBe(201)
    fixtureWorkOrderIds.push(new mongoose.Types.ObjectId(wo.body._id.toString()))
    const created = await createViaApi(fixture, 12, 15, { overlapException: { reason: 'O-02 test: maintenance must still block' } })
    expect(created.status).toBe(409)
  })
})
