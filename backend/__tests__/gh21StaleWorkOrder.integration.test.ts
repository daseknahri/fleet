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
import MaintenanceWorkOrder from '../src/models/MaintenanceWorkOrder'
import { workOrderStaleDays } from '../src/utils/workOrderStale'

// GH-21 - stale "Scheduled" work orders: list half. The reminder half
// lives in gh21StaleWorkOrderReminder.integration.test.ts (split from
// the pack's single file: booting the app starts the background
// reminder tick, which would claim the weekly dedupe before the
// reminder half's forced pass — the Wave 3.2 file's own rule).
// N = 7 (STALE_WORK_ORDER_DAYS): the 8-day / 6-day seeds move with it.

const DAY = 86400000
const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureValueIds: mongoose.Types.ObjectId[] = []
const fixtureWorkOrderIds: mongoose.Types.ObjectId[] = []

let adminToken: string
let adminId: string

let wo8: string
let wo6: string
let woFuture: string
let woDone: string
let woTrashed: string

const seedWorkOrder = async (supplierId: string, carId: string, label: string, start: Date, status: bookcarsTypes.WorkOrderStatus) => {
  const wo = await MaintenanceWorkOrder.create({
    supplier: supplierId, car: carId,
    type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
    title: `GH-21 ${label}`,
    status,
    scheduledStart: start,
    scheduledEnd: new Date(start.getTime() + 2 * 3600000),
  } as any)
  fixtureWorkOrderIds.push(wo._id)
  return wo._id.toString()
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh21-admin', email: `gh21-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  const supplier = await User.create({
    email: `gh21-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-21 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)

  const value = await LocationValue.create({ language: 'en', value: `GH-21 Airport ${rand()}` })
  fixtureValueIds.push(value._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [value._id] })
  fixtureLocationIds.push(location._id)

  const car = await Car.create({
    name: 'GH-21 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
    odometerKm: 10000,
  } as any)
  fixtureCarIds.push(car._id)

  // R3-02 — a trashed car with a stale Scheduled job on it: the job must
  // not appear in the aging view (but stays in the plain list: history).
  const trashedCar = await Car.create({
    name: 'GH-21 trashed car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
    odometerKm: 20000,
  } as any)
  fixtureCarIds.push(trashedCar._id)
  await Car.updateOne({ _id: trashedCar._id }, { $set: { deletedAt: new Date() } })

  const now = Date.now()
  wo8 = await seedWorkOrder(supplier._id.toString(), car._id.toString(), '8 days', new Date(now - 8 * DAY), bookcarsTypes.WorkOrderStatus.Scheduled)
  wo6 = await seedWorkOrder(supplier._id.toString(), car._id.toString(), '6 days', new Date(now - 6 * DAY), bookcarsTypes.WorkOrderStatus.Scheduled)
  woFuture = await seedWorkOrder(supplier._id.toString(), car._id.toString(), 'future', new Date(now + 7 * DAY), bookcarsTypes.WorkOrderStatus.Scheduled)
  woDone = await seedWorkOrder(supplier._id.toString(), car._id.toString(), 'done', new Date(now - 30 * DAY), bookcarsTypes.WorkOrderStatus.Completed)
  woTrashed = await seedWorkOrder(supplier._id.toString(), trashedCar._id.toString(), 'trashed 8 days', new Date(now - 8 * DAY), bookcarsTypes.WorkOrderStatus.Scheduled)
})

afterAll(async () => {
  await MaintenanceWorkOrder.deleteMany({ _id: { $in: fixtureWorkOrderIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-21 stale work order list', () => {
  const list = (qs = '') => request(app)
    .get(`/api/maintenance-work-orders${qs}`)
    .set(env.X_ACCESS_TOKEN, adminToken)

  const rowById = (body: any[], id: string) => (body as any[]).find((r) => String(r._id) === id)

  it('flags only the 8-day Scheduled row stale, with its whole days', async () => {
    const res = await list()
    expect(res.status).toBe(200)
    expect((res.body as any[]).length).toBe(5)
    const r8 = rowById(res.body, wo8)
    expect(r8.stale).toBe(true)
    expect(r8.daysStale).toBe(8)
    expect(rowById(res.body, wo6).stale).toBe(false)
    expect(rowById(res.body, wo6).daysStale).toBe(0)
    expect(rowById(res.body, woFuture).stale).toBe(false)
    expect(rowById(res.body, woFuture).daysStale).toBe(0)
    expect(rowById(res.body, woDone).stale).toBe(false)
    expect(rowById(res.body, woDone).daysStale).toBe(0)
  })

  it('?stale=true returns only the stale row', async () => {
    const res = await list('?stale=true')
    expect(res.status).toBe(200)
    expect((res.body as any[]).map((r) => String(r._id))).toEqual([wo8])
  })

  it('R3-02: the plain list still shows the trashed car\'s job (history), the aging view does not', async () => {
    const all = await list()
    expect(all.status).toBe(200)
    const trashedRow = rowById(all.body, woTrashed)
    expect(trashedRow).toBeDefined()
    expect(trashedRow.stale).toBe(true)
    expect(trashedRow.daysStale).toBe(8)
    const stale = await list('?stale=true')
    expect(stale.status).toBe(200)
    expect((stale.body as any[]).map((r) => String(r._id))).toEqual([wo8])
  })

  it('?status=completed returns only Completed rows', async () => {
    const res = await list('?status=completed')
    expect(res.status).toBe(200)
    expect((res.body as any[]).map((r) => String(r._id))).toEqual([woDone])
  })

  it('?status=bogus returns everything', async () => {
    const res = await list('?status=bogus')
    expect(res.status).toBe(200)
    expect((res.body as any[]).length).toBe(5)
  })
})

describe('R3-06 workOrderStaleDays — Casablanca wall days', () => {
  it('counts whole wall days: 2026-07-01 12:00 to 2026-07-08 23:30 is 8 days, not 7', () => {
    // 2026-07-08T23:30:00Z is 2026-07-09 00:30 in Casablanca (UTC+1):
    // the old process-local midnight difference was 7 whole days.
    expect(workOrderStaleDays('2026-07-01T12:00:00Z', '2026-07-08T23:30:00Z')).toBe(8)
  })

  it('same wall day is 0 days even across midnight UTC', () => {
    // 2026-07-05T23:30:00Z and 2026-07-06T00:30:00Z are both Monday
    // 2026-07-06 in Casablanca (00:30 and 01:30).
    expect(workOrderStaleDays('2026-07-05T23:30:00Z', '2026-07-06T00:30:00Z')).toBe(0)
  })

  it('a future start is 0 days', () => {
    expect(workOrderStaleDays('2026-07-10T09:00:00Z', '2026-07-08T23:30:00Z')).toBe(0)
  })
})
