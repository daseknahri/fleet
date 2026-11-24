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
import ContractSnapshot from '../src/models/ContractSnapshot'

// GH-13 — GET /api/contract-operations/:bookingId/snapshots lists a
// booking's snapshots (gap-hunt 2026-11-24). Snapshots are inserted
// directly (creation itself is covered by f4ContractOps); the endpoint
// under test is the list, its field shape, its ordering, and its
// agency scoping.

const DAY = 86400000
const rand = () => Math.random().toString(36).slice(2)

const ids = {
  users: [] as mongoose.Types.ObjectId[],
  cars: [] as mongoose.Types.ObjectId[],
  locations: [] as mongoose.Types.ObjectId[],
  values: [] as mongoose.Types.ObjectId[],
  bookings: [] as mongoose.Types.ObjectId[],
  snapshots: [] as mongoose.Types.ObjectId[],
}

let supplierA: any
let supplierB: any
let tokenA: string
let tokenB: string

const makeFixture = async (label: string) => {
  const supplier = label === 'b' ? supplierB : supplierA
  const driver = await User.create({
    email: `gh13-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `GH-13 Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  ids.users.push(driver._id)
  const value = await LocationValue.create({ language: 'en', value: `GH-13 Airport ${label}` })
  ids.values.push(value._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [value._id] })
  ids.locations.push(location._id)
  const car = await Car.create({
    name: `GH-13 car ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  ids.cars.push(car._id)
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(Date.now() + 1 * DAY),
    to: new Date(Date.now() + 3 * DAY),
    status: bookcarsTypes.BookingStatus.Paid,
    lifecycle: bookcarsTypes.ContractLifecycle.Active,
    price: 1000,
    cancellation: false, amendments: false, theftProtection: false,
    collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
  } as any)
  ids.bookings.push(booking._id)
  return { supplier, driver, location, car, booking }
}

const makeSnapshot = async (fixture: any, version: number, withStamp: boolean, pdfFile: string) => {
  const row = await ContractSnapshot.create({
    supplier: fixture.supplier._id, booking: fixture.booking._id,
    version, pdfFile, contentHash: `hash-v${version}`,
    generatedAt: new Date(), withStamp, termsSha256: `sha-v${version}`,
  } as any)
  ids.snapshots.push(row._id)
  return row
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const mkSupplier = async (label: string) => {
    const row = await User.create({
      email: `gh13-supplier-${label}-${rand()}@test.bookcars.ma`,
      fullName: `GH-13 Supplier ${label}`,
      language: 'en', type: bookcarsTypes.UserType.Supplier,
      active: true, verified: true, blacklisted: false, payLater: true,
    })
    ids.users.push(row._id)
    return row
  }
  supplierA = await mkSupplier('a')
  supplierB = await mkSupplier('b')
  tokenA = await authHelper.encryptJWT({ id: supplierA._id.toString() })
  tokenB = await authHelper.encryptJWT({ id: supplierB._id.toString() })
})

afterAll(async () => {
  await ContractSnapshot.deleteMany({ _id: { $in: ids.snapshots } })
  await Booking.deleteMany({ _id: { $in: ids.bookings } })
  await Car.deleteMany({ _id: { $in: ids.cars } })
  await Location.deleteMany({ _id: { $in: ids.locations } })
  await LocationValue.deleteMany({ _id: { $in: ids.values } })
  await User.deleteMany({ _id: { $in: ids.users } })
  await databaseHelper.close()
})

describe('GH-13 — snapshot list endpoint', () => {
  it('lists a booking’s snapshots oldest-first with version, generatedAt, withStamp, termsSha256 and pdfFile', async () => {
    const fixture = await makeFixture('list')
    await makeSnapshot(fixture, 1, false, 'v1.pdf')
    await makeSnapshot(fixture, 2, true, 'v2.pdf')
    const res = await request(app)
      .get(`/api/contract-operations/${fixture.booking._id}/snapshots`)
      .set(env.X_ACCESS_TOKEN, tokenA)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBe(2)
    expect(res.body.map((row: any) => row.version)).toEqual([1, 2])
    expect(res.body[0]).toMatchObject({ pdfFile: 'v1.pdf', withStamp: false, termsSha256: 'sha-v1' })
    expect(res.body[0].generatedAt).toBeTruthy()
    expect(res.body[1]).toMatchObject({ pdfFile: 'v2.pdf', withStamp: true, termsSha256: 'sha-v2' })
    // The content hash and the stored terms text stay server-side.
    expect(res.body[0].contentHash).toBeUndefined()
    expect(res.body[0].termsFr).toBeUndefined()
  })

  it('returns an empty list for a booking with no snapshots', async () => {
    const fixture = await makeFixture('empty')
    const res = await request(app)
      .get(`/api/contract-operations/${fixture.booking._id}/snapshots`)
      .set(env.X_ACCESS_TOKEN, tokenA)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns 404 for an unknown booking and for another agency’s booking', async () => {
    const fixture = await makeFixture('scoped')
    await makeSnapshot(fixture, 1, false, 'v1.pdf')
    const unknown = await request(app)
      .get(`/api/contract-operations/${new mongoose.Types.ObjectId()}/snapshots`)
      .set(env.X_ACCESS_TOKEN, tokenA)
    expect(unknown.status).toBe(404)
    const otherAgency = await request(app)
      .get(`/api/contract-operations/${fixture.booking._id}/snapshots`)
      .set(env.X_ACCESS_TOKEN, tokenB)
    expect(otherAgency.status).toBe(404)
  })
})
