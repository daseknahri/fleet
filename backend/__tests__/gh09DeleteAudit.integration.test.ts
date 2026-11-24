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
import MaintenanceScheduleAudit from '../src/models/MaintenanceScheduleAudit'
import MaintenanceWorkOrder from '../src/models/MaintenanceWorkOrder'
import MaintenanceWorkOrderAudit from '../src/models/MaintenanceWorkOrderAudit'
import MaintenanceExpense from '../src/models/MaintenanceExpense'

// GH-09 — schedule and work-order deletes are audited like expense
// deletes (gap-hunt 2026-11-24): reason >= 3 chars, audit row written
// BEFORE the delete, trail survives it; a work order with linked
// expenses is refused 409. Same harness shape as the expense-delete
// test in maintenanceReceiptSchedule (supplier token, DELETE with a
// JSON reason body).

const DAY = 86400000
const rand = () => Math.random().toString(36).slice(2)
const suffix = `${Date.now()}-${rand()}`

const ids = {
  users: [] as mongoose.Types.ObjectId[],
  cars: [] as mongoose.Types.ObjectId[],
  locations: [] as mongoose.Types.ObjectId[],
  values: [] as mongoose.Types.ObjectId[],
  schedules: [] as mongoose.Types.ObjectId[],
  workOrders: [] as mongoose.Types.ObjectId[],
  expenses: [] as mongoose.Types.ObjectId[],
  scheduleAudits: [] as mongoose.Types.ObjectId[],
  workOrderAudits: [] as mongoose.Types.ObjectId[],
}

let supplierA: any
let supplierB: any
let carA: any
let tokenA: string
let tokenB: string

const makeSupplier = async (label: string) => {
  const row = await new User({
    email: `gh09-${label}-${suffix}@test.bookcars.ma`, fullName: `GH-09 ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  }).save()
  ids.users.push(row._id)
  return row
}

const makeCar = async (supplier: any) => {
  const value = await new LocationValue({ language: 'en', value: `GH-09 location ${supplier._id}` }).save()
  ids.values.push(value._id)
  const location = await new Location({ country: new mongoose.Types.ObjectId(), values: [value._id] }).save()
  ids.locations.push(location._id)
  const car = await new Car({
    name: `GH-09 car ${supplier._id}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 500, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5,
  }).save()
  ids.cars.push(car._id)
  return car
}

const makeSchedule = async (supplier: any, car: any, label: string) => {
  const row = await MaintenanceSchedule.create({
    supplier: supplier._id, car: car._id,
    type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
    title: `GH-09 schedule ${label}`,
    status: bookcarsTypes.MaintenanceScheduleStatus.Upcoming,
    nextDueDate: new Date(Date.now() + 30 * DAY), intervalDays: 90,
  } as any)
  ids.schedules.push(row._id)
  return row
}

const makeWorkOrder = async (supplier: any, car: any, label: string) => {
  const row = await MaintenanceWorkOrder.create({
    supplier: supplier._id, car: car._id,
    title: `GH-09 work order ${label}`,
    type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
    status: bookcarsTypes.WorkOrderStatus.Scheduled,
    scheduledStart: new Date(Date.now() + 1 * DAY),
    scheduledEnd: new Date(Date.now() + 2 * DAY),
  } as any)
  ids.workOrders.push(row._id)
  return row
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplierA = await makeSupplier('a')
  supplierB = await makeSupplier('b')
  carA = await makeCar(supplierA)
  tokenA = await authHelper.encryptJWT({ id: supplierA._id.toString() })
  tokenB = await authHelper.encryptJWT({ id: supplierB._id.toString() })
})

afterAll(async () => {
  await MaintenanceScheduleAudit.deleteMany({ _id: { $in: ids.scheduleAudits } })
  await MaintenanceWorkOrderAudit.deleteMany({ _id: { $in: ids.workOrderAudits } })
  await MaintenanceExpense.deleteMany({ _id: { $in: ids.expenses } })
  await MaintenanceWorkOrder.deleteMany({ _id: { $in: ids.workOrders } })
  await MaintenanceSchedule.deleteMany({ _id: { $in: ids.schedules } })
  await Car.deleteMany({ _id: { $in: ids.cars } })
  await Location.deleteMany({ _id: { $in: ids.locations } })
  await LocationValue.deleteMany({ _id: { $in: ids.values } })
  await User.deleteMany({ _id: { $in: ids.users } })
  await databaseHelper.close()
})

describe('GH-09 — audited maintenance deletes', () => {
  it('requires a reason to delete a schedule, then audits the delete before removing it', async () => {
    const schedule = await makeSchedule(supplierA, carA, 'reason')
    const bare = await request(app).delete(`/api/maintenance-schedules/${schedule._id}`).set(env.X_ACCESS_TOKEN, tokenA).send({})
    expect(bare.status).toBe(400)
    const short = await request(app).delete(`/api/maintenance-schedules/${schedule._id}`).set(env.X_ACCESS_TOKEN, tokenA).send({ reason: 'ab' })
    expect(short.status).toBe(400)
    const removed = await request(app).delete(`/api/maintenance-schedules/${schedule._id}`).set(env.X_ACCESS_TOKEN, tokenA).send({ reason: 'No longer needed' })
    expect(removed.status).toBe(200)
    expect(await MaintenanceSchedule.findById(schedule._id)).toBeNull()
    const audit = await MaintenanceScheduleAudit.findOne({ schedule: schedule._id })
    expect(audit).not.toBeNull()
    ids.scheduleAudits.push(audit!._id)
    expect(audit!.action).toBe(bookcarsTypes.MaintenanceExpenseAuditAction.Deleted)
    expect(audit!.reason).toBe('No longer needed')
    expect(audit!.actor?.toString()).toBe(supplierA._id.toString())
    expect(audit!.supplier.toString()).toBe(supplierA._id.toString())
  })

  it('requires a reason to delete a work order, then audits the delete before removing it', async () => {
    const workOrder = await makeWorkOrder(supplierA, carA, 'reason')
    const bare = await request(app).delete(`/api/maintenance-work-orders/${workOrder._id}`).set(env.X_ACCESS_TOKEN, tokenA).send({})
    expect(bare.status).toBe(400)
    const removed = await request(app).delete(`/api/maintenance-work-orders/${workOrder._id}`).set(env.X_ACCESS_TOKEN, tokenA).send({ reason: 'Job cancelled by vendor' })
    expect(removed.status).toBe(200)
    expect(await MaintenanceWorkOrder.findById(workOrder._id)).toBeNull()
    const audit = await MaintenanceWorkOrderAudit.findOne({ workOrder: workOrder._id })
    expect(audit).not.toBeNull()
    ids.workOrderAudits.push(audit!._id)
    expect(audit!.action).toBe(bookcarsTypes.MaintenanceExpenseAuditAction.Deleted)
    expect(audit!.reason).toBe('Job cancelled by vendor')
  })

  it('refuses a work-order delete while linked expenses exist and writes no audit row', async () => {
    const workOrder = await makeWorkOrder(supplierA, carA, 'linked')
    const expense = await MaintenanceExpense.create({
      supplier: supplierA._id, car: carA._id, workOrder: workOrder._id,
      date: new Date(), type: bookcarsTypes.MaintenanceExpenseType.Repair,
      amount: 100, vendor: 'GH-09 Garage',
    } as any)
    ids.expenses.push(expense._id)
    const refused = await request(app).delete(`/api/maintenance-work-orders/${workOrder._id}`).set(env.X_ACCESS_TOKEN, tokenA).send({ reason: 'Try to delete anyway' })
    expect(refused.status).toBe(409)
    expect(await MaintenanceWorkOrder.findById(workOrder._id)).not.toBeNull()
    expect(await MaintenanceWorkOrderAudit.countDocuments({ workOrder: workOrder._id })).toBe(0)
  })

  it('keeps schedule deletes agency-scoped: another agency gets 404 and no audit row', async () => {
    const schedule = await makeSchedule(supplierB, carA, 'scoped')
    const denied = await request(app).delete(`/api/maintenance-schedules/${schedule._id}`).set(env.X_ACCESS_TOKEN, tokenA).send({ reason: 'Not my schedule' })
    expect(denied.status).toBe(404)
    expect(await MaintenanceSchedule.findById(schedule._id)).not.toBeNull()
    expect(await MaintenanceScheduleAudit.countDocuments({ schedule: schedule._id })).toBe(0)
  })
})
