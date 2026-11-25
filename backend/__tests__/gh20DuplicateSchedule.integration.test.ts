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
import MaintenanceCategory from '../src/models/MaintenanceCategory'

// GH-20 - duplicate active schedules for the same car + type are
// refused with 409.

const rand = () => Math.random().toString(36).slice(2)
const DUE = '2027-06-01T00:00:00.000Z'
const DUPLICATE_MESSAGE = 'An active schedule already exists for this vehicle with the same type and category'

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureValueIds: mongoose.Types.ObjectId[] = []
const fixtureScheduleIds: mongoose.Types.ObjectId[] = []
const fixtureCategoryIds: mongoose.Types.ObjectId[] = []

let adminToken: string
let adminId: string
let carX: string
let carY: string
let categoryId: string

const makeCar = async (supplierId: string, locationId: mongoose.Types.ObjectId, label: string) => {
  const car = await Car.create({
    name: `GH-20 car ${label}`, supplier: supplierId, minimumAge: 21,
    locations: [locationId], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
    odometerKm: 10000,
  } as any)
  fixtureCarIds.push(car._id)
  return car._id.toString()
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh20-admin', email: `gh20-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  const supplier = await User.create({
    email: `gh20-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-20 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)

  const value = await LocationValue.create({ language: 'en', value: `GH-20 Airport ${rand()}` })
  fixtureValueIds.push(value._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [value._id] })
  fixtureLocationIds.push(location._id)

  carX = await makeCar(supplier._id.toString(), location._id, 'X')
  carY = await makeCar(supplier._id.toString(), location._id, 'Y')

  const category = await MaintenanceCategory.create({ supplier: supplier._id, name: 'GH-20 Category' } as any)
  fixtureCategoryIds.push(category._id)
  categoryId = category._id.toString()
})

afterAll(async () => {
  await MaintenanceSchedule.deleteMany({ _id: { $in: fixtureScheduleIds } })
  await MaintenanceCategory.deleteMany({ _id: { $in: fixtureCategoryIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-20 duplicate active schedule', () => {
  const createSchedule = (car: string, title: string, type: string, category?: string | null) => request(app)
    .post('/api/maintenance-schedules')
    .set(env.X_ACCESS_TOKEN, adminToken)
    .send({
      car, title, type, nextDueDate: DUE,
      ...(category === undefined ? {} : { category }),
    })

  const updateSchedule = (id: string, body: Record<string, unknown>) => request(app)
    .put(`/api/maintenance-schedules/${id}`)
    .set(env.X_ACCESS_TOKEN, adminToken)
    .send(body)

  it('refuses a second live schedule for the same car + type + category', async () => {
    // 1. Schedule A (car X, maintenance, no category) -> 201.
    const a = await createSchedule(carX, 'GH-20 A', bookcarsTypes.MaintenanceExpenseType.Maintenance)
    expect(a.status).toBe(201)
    const aId = (a.body as any)._id as string
    fixtureScheduleIds.push(new mongoose.Types.ObjectId(aId))

    // 2. Schedule B, same key -> 409 with the exact string.
    const b = await createSchedule(carX, 'GH-20 B', bookcarsTypes.MaintenanceExpenseType.Maintenance)
    expect(b.status).toBe(409)
    expect(b.text).toBe(DUPLICATE_MESSAGE)

    // 3. Schedule C, a different category -> 201 (category is part of the key).
    const c = await createSchedule(carX, 'GH-20 C', bookcarsTypes.MaintenanceExpenseType.Maintenance, categoryId)
    expect(c.status).toBe(201)
    const cId = (c.body as any)._id as string
    fixtureScheduleIds.push(new mongoose.Types.ObjectId(cId))

    // 4. Schedule D, a different type -> 201 (type is part of the key).
    const d = await createSchedule(carX, 'GH-20 D', bookcarsTypes.MaintenanceExpenseType.Repair)
    expect(d.status).toBe(201)
    fixtureScheduleIds.push(new mongoose.Types.ObjectId((d.body as any)._id))

    // 5. Complete A, then E with A's key -> 201 (Completed does not count).
    const completed = await updateSchedule(aId, {
      car: carX, title: 'GH-20 A', type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
      nextDueDate: DUE, status: bookcarsTypes.MaintenanceScheduleStatus.Completed,
    })
    expect(completed.status).toBe(200)
    const e = await createSchedule(carX, 'GH-20 E', bookcarsTypes.MaintenanceExpenseType.Maintenance)
    expect(e.status).toBe(201)
    fixtureScheduleIds.push(new mongoose.Types.ObjectId((e.body as any)._id))

    // 6. Update: F on another car, then move it onto X with C's key -> 409;
    // a title-only change -> 200 (self excluded).
    const f = await createSchedule(carY, 'GH-20 F', bookcarsTypes.MaintenanceExpenseType.Maintenance)
    expect(f.status).toBe(201)
    const fId = (f.body as any)._id as string
    fixtureScheduleIds.push(new mongoose.Types.ObjectId(fId))

    const moved = await updateSchedule(fId, {
      car: carX, title: 'GH-20 F', type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
      nextDueDate: DUE, category: categoryId,
    })
    expect(moved.status).toBe(409)
    expect(moved.text).toBe(DUPLICATE_MESSAGE)

    const renamed = await updateSchedule(fId, {
      car: carY, title: 'GH-20 F renamed', type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
      nextDueDate: DUE,
    })
    expect(renamed.status).toBe(200)
  })
})
