import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import app from '../src/app'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import MaintenanceSchedule from '../src/models/MaintenanceSchedule'

// GH-18 - the schedule list shows the live-merged status but filtered
// on the stored one, so a schedule the list shows as Due was invisible
// to ?status=due.

const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureValueIds: mongoose.Types.ObjectId[] = []
const fixtureScheduleIds: mongoose.Types.ObjectId[] = []

let adminToken: string
let adminId: string
let supplierId: string
let scheduleId: string

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh18-admin', email: `gh18-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  const supplier = await User.create({
    email: `gh18-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-18 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  supplierId = supplier._id.toString()
  fixtureUserIds.push(supplier._id)

  const value = await LocationValue.create({ language: 'en', value: `GH-18 Airport ${rand()}` })
  fixtureValueIds.push(value._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [value._id] })
  fixtureLocationIds.push(location._id)

  // Odometer (12,000) is past the schedule's next-due mileage (10,000);
  // the far-future due date keeps the STORED status Upcoming.
  const car = await Car.create({
    name: 'GH-18 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
    odometerKm: 12000,
  } as any)
  fixtureCarIds.push(car._id)

  const schedule = await MaintenanceSchedule.create({
    supplier: supplier._id, car: car._id,
    type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
    title: 'GH-18 oil change',
    status: bookcarsTypes.MaintenanceScheduleStatus.Upcoming,
    nextDueDate: new Date('2027-06-01T00:00:00.000Z'),
    nextDueMileage: 10000,
  } as any)
  fixtureScheduleIds.push(schedule._id)
  scheduleId = schedule._id.toString()
})

afterAll(async () => {
  await MaintenanceSchedule.deleteMany({ _id: { $in: fixtureScheduleIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-18 schedule status filter', () => {
  const list = (qs = '') => request(app)
    .get(`/api/maintenance-schedules${qs}`)
    .set(env.X_ACCESS_TOKEN, adminToken)

  it('shows the live-merged status (overdue, mileage trigger) on the unfiltered list', async () => {
    const res = await list()
    expect(res.status).toBe(200)
    const row = (res.body as any[]).find((r) => String(r._id) === scheduleId)
    expect(row).toBeDefined()
    expect(row.status).toBe('overdue')
    expect(row.dueByMileage).toBe(true)
    // The stored status is still Upcoming — the disagreement is real.
    const stored = await MaintenanceSchedule.findById(scheduleId).lean()
    expect(stored?.status).toBe('upcoming')
  })

  it('?status=overdue finds the row the stored status would have hidden', async () => {
    const res = await list('?status=overdue')
    expect(res.status).toBe(200)
    expect((res.body as any[]).some((r) => String(r._id) === scheduleId)).toBe(true)
  })

  it('?status=upcoming excludes the row the stored status would have included', async () => {
    const res = await list('?status=upcoming')
    expect(res.status).toBe(200)
    expect((res.body as any[]).some((r) => String(r._id) === scheduleId)).toBe(false)
  })

  it('?status=bogus returns everything (invalid value ignored)', async () => {
    const res = await list('?status=bogus')
    expect(res.status).toBe(200)
    expect((res.body as any[]).some((r) => String(r._id) === scheduleId)).toBe(true)
  })
})
