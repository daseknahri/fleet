import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import Booking from '../src/models/Booking'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import AdminAccessLog from '../src/models/AdminAccessLog'

// R2-B09/R2-B15 - admin booking update audit: R2-B15 removed the
// middleware log for resource-id calls, so the controller is the sole
// logger (booking:update-booking, resource agency) with or without a
// selector. Same harness as adminAccessLogGh07 (real Mongo-backed
// app, supplier + platform admin tokens).
const day = 86400000
const rand = () => Math.random().toString(36).slice(2)
const at = (days: number) => new Date(Date.now() + days * day)

let supplier: any, admin: any, driver: any, location: any, car: any, booking: any
let adminToken: string, supplierToken: string
let updateBooking: (req: any, res: any) => Promise<void>

const updateBody = (withSupplier: boolean) => ({
  booking: {
    _id: booking._id.toString(),
    ...(withSupplier ? { supplier: supplier._id.toString() } : {}),
    car: car._id.toString(),
    driver: driver._id.toString(),
    pickupLocation: location._id.toString(),
    dropOffLocation: location._id.toString(),
    from: booking.from.toISOString(),
    to: booking.to.toISOString(),
    status: bookcarsTypes.BookingStatus.Pending,
    price: 500,
    cancellation: false,
    amendments: 0,
    theftProtection: 0,
    collisionDamageWaiver: 0,
    fullInsurance: 0,
    additionalDriver: 0,
  },
})

const rowsSince = async (before: Date, actorId: mongoose.Types.ObjectId) =>
  AdminAccessLog.find({ actor: actorId, createdAt: { $gte: before } }).lean()

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  ;({ update: updateBooking } = await import('../src/controllers/bookingController'))
  supplier = await User.create({
    email: `r2b09-supplier-${rand()}@test.bookcars.ma`, fullName: 'R2-B09 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  admin = await User.create({
    email: `r2b09-admin-${rand()}@test.bookcars.ma`, fullName: 'R2-B09 Admin',
    language: 'en', type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  driver = await User.create({
    email: `r2b09-driver-${rand()}@test.bookcars.ma`, fullName: 'R2-B09 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  const valueEn = await LocationValue.create({ language: 'en', value: `R2-B09 Airport ${rand()}` })
  location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  car = await Car.create({
    name: 'R2-B09 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  // Snapshot-less, Draft/Pending: no checkout-terms lock, no price gate.
  booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: at(1), to: at(3),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: 500,
  } as any)
  adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })
  supplierToken = await authHelper.encryptJWT({ id: supplier._id.toString() })
})

afterEach(async () => {
  await AdminAccessLog.deleteMany({ actor: { $in: [admin._id, supplier._id] } })
})

afterAll(async () => {
  await AdminAccessLog.deleteMany({ actor: { $in: [admin._id, supplier._id] } })
  await Booking.deleteMany({ _id: booking._id })
  await Car.deleteMany({ _id: car._id })
  await Location.deleteMany({ _id: location._id })
  await LocationValue.deleteMany({ _id: { $in: location.values } })
  await User.deleteMany({ _id: { $in: [supplier._id, admin._id, driver._id] } })
  await databaseHelper.close()
})

describe('R2-B09 - admin booking update double-log', () => {
  it('admin update WITH body.booking.supplier logs exactly one booking:update-booking row (R2-B15)', async () => {
    // R2-B15 - the middleware no longer logs resource-id calls, so the
    // controller is the sole logger: one row, resource agency.
    const before = new Date()
    const res = await request(app).put('/api/update-booking').set(env.X_ACCESS_TOKEN, adminToken).send(updateBody(true))
    expect(res.status).toBe(200)
    const rows = await rowsSince(before, admin._id)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('booking:update-booking')
    expect(String(rows[0].agency)).toBe(supplier._id.toString())
  })

  it('admin update with NO selector logs exactly one booking:update-booking row (direct handler call)', async () => {
    // The HTTP route cannot carry this case: the middleware refuses a
    // selector-less admin call (400 Agency is required) because
    // hasResourceIdParam does not recognise body.booking._id (object
    // shape), so the controller's no-selector log is only reachable
    // by direct call. The guard itself is exercised here.
    const before = new Date()
    const req = {
      user: { _id: admin._id, type: bookcarsTypes.UserType.Admin },
      params: {}, query: {}, body: updateBody(false), method: 'PUT', path: '/api/update-booking',
    } as any
    let statusCode = 200
    const res = {
      status: (c: number) => { statusCode = c; return res },
      send: () => res, json: () => res,
      sendStatus: (c: number) => { statusCode = c; return res },
    } as any
    await updateBooking(req, res)
    // The audit fires before the agency validation, so the row exists
    // even though the update itself refuses 400 (no supplier submitted).
    expect(statusCode).toBe(400)
    const rows = await rowsSince(before, admin._id)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('booking:update-booking')
    expect(String(rows[0].agency)).toBe(supplier._id.toString())
  })

  it('admin update with NO selector via HTTP now reaches the controller (R2-B15 hasResourceIdParam)', async () => {
    // R2-B15 8b - hasResourceIdParam now recognises body.booking._id
    // (object shape), so the middleware defers instead of refusing
    // 400. The controller logs booking:update-booking, then the
    // update itself refuses 400 (no supplier submitted).
    const before = new Date()
    const res = await request(app).put('/api/update-booking').set(env.X_ACCESS_TOKEN, adminToken).send(updateBody(false))
    expect(res.status).toBe(400)
    expect(res.text).toBe('Booking agency, vehicle, or location is invalid')
    const rows = await rowsSince(before, admin._id)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('booking:update-booking')
    expect(String(rows[0].agency)).toBe(supplier._id.toString())
  })

  it('agency manager update logs zero admin rows', async () => {
    const before = new Date()
    const res = await request(app).put('/api/update-booking').set(env.X_ACCESS_TOKEN, supplierToken).send(updateBody(true))
    expect(res.status).toBe(200)
    const rows = await rowsSince(before, supplier._id)
    expect(rows).toHaveLength(0)
  })

  it('bulk status update logs exactly one booking:update-booking-status row', async () => {
    const before = new Date()
    const res = await request(app).post('/api/update-booking-status').set(env.X_ACCESS_TOKEN, adminToken).send({ ids: [booking._id.toString()], status: bookcarsTypes.BookingStatus.Pending })
    expect(res.status).toBe(200)
    const rows = await rowsSince(before, admin._id)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('booking:update-booking-status')
    expect(String(rows[0].agency)).toBe(supplier._id.toString())
  })
})