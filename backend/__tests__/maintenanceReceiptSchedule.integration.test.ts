import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import MaintenanceExpense from '../src/models/MaintenanceExpense'
import MaintenanceSchedule from '../src/models/MaintenanceSchedule'

const ids = { users: [] as mongoose.Types.ObjectId[], cars: [] as mongoose.Types.ObjectId[], locations: [] as mongoose.Types.ObjectId[], values: [] as mongoose.Types.ObjectId[], expenses: [] as mongoose.Types.ObjectId[], schedules: [] as mongoose.Types.ObjectId[] }
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let supplierA: any, supplierB: any, admin: any, carA: any, tokenA: string, tokenB: string, adminToken: string

const makeSupplier = async (label: string) => {
  const row = await new User({ email: `maint-${label}-${suffix}@test.bookcars.ma`, fullName: `Maintenance ${label}`, language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true }).save()
  ids.users.push(row._id); return row
}
const makeCar = async (supplier: any) => {
  const value = await new LocationValue({ language: 'en', value: `Maintenance location ${supplier._id}` }).save(); ids.values.push(value._id)
  const location = await new Location({ country: new mongoose.Types.ObjectId(), values: [value._id] }).save(); ids.locations.push(location._id)
  const car = await new Car({ name: `Maintenance car ${supplier._id}`, supplier: supplier._id, minimumAge: 21, locations: [location._id], dailyPrice: 100, deposit: 500, available: true, type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic, aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank, mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0, collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0, range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5 }).save()
  ids.cars.push(car._id); return car
}
beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplierA = await makeSupplier('a'); supplierB = await makeSupplier('b'); admin = await new User({ email: `maint-admin-${suffix}@test.bookcars.ma`, fullName: 'Maintenance Admin', language: 'en', type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false }).save(); ids.users.push(admin._id); carA = await makeCar(supplierA)
  tokenA = await authHelper.encryptJWT({ id: supplierA._id.toString() }); tokenB = await authHelper.encryptJWT({ id: supplierB._id.toString() }); adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })
})
afterAll(async () => {
  await MaintenanceSchedule.deleteMany({ _id: { $in: ids.schedules } }); await MaintenanceExpense.deleteMany({ _id: { $in: ids.expenses } })
  await Car.deleteMany({ _id: { $in: ids.cars } }); await Location.deleteMany({ _id: { $in: ids.locations } }); await LocationValue.deleteMany({ _id: { $in: ids.values } }); await User.deleteMany({ _id: { $in: ids.users } }); await databaseHelper.close()
})

describe('Mongo-backed maintenance receipts, schedules and category reports', () => {
  it('stores a private receipt, links it to an expense, reports the category and protects download', async () => {
    const upload = await request(app).post('/api/maintenance-expenses/receipts').set(env.X_ACCESS_TOKEN, tokenA)
      .attach('file', Buffer.from('%PDF-1.4 synthetic maintenance receipt'), { filename: 'receipt.pdf', contentType: 'application/pdf' })
    expect(upload.status).toBe(201); expect(upload.body.filename).toMatch(/\.pdf$/)
    const created = await request(app).post('/api/maintenance-expenses').set(env.X_ACCESS_TOKEN, tokenA).send({ car: carA._id.toString(), date: new Date().toISOString(), type: bookcarsTypes.MaintenanceExpenseType.Repair, amount: 275.5, vendor: 'P0 Garage', receipt: upload.body.filename })
    expect(created.status).toBe(201); expect(created.body.receipt).toBeTruthy(); ids.expenses.push(created.body._id)
    const report = await request(app).get('/api/maintenance-expenses/report').set(env.X_ACCESS_TOKEN, tokenA)
    expect(report.status).toBe(200); expect(report.body.currency).toBe('MAD'); expect(report.body.total).toBe(275.5); expect(report.body.categories).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'repair', total: 275.5, count: 1, receipts: 1 })]))
    const download = await request(app).get(`/api/maintenance-expense-receipt/${created.body._id}/${created.body.receipt}`).set(env.X_ACCESS_TOKEN, tokenA)
    expect(download.status).toBe(200); expect(download.headers['content-type']).toContain('application/pdf')
    const denied = await request(app).get(`/api/maintenance-expense-receipt/${created.body._id}/${created.body.receipt}`).set(env.X_ACCESS_TOKEN, tokenB)
    expect(denied.status).toBe(403)
    const removed = await request(app).delete(`/api/maintenance-expenses/${created.body._id}`).set(env.X_ACCESS_TOKEN, tokenA)
    expect(removed.status).toBe(200)
    const afterDelete = await request(app).get(`/api/maintenance-expense-receipt/${created.body._id}/${created.body.receipt}`).set(env.X_ACCESS_TOKEN, tokenA)
    expect(afterDelete.status).toBe(404)
  })
  it('allows a platform admin without agency membership to create an expense for an agency vehicle', async () => {
    const created = await request(app).post('/api/maintenance-expenses').set(env.X_ACCESS_TOKEN, adminToken).send({
      car: carA._id.toString(), date: new Date().toISOString(), type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
      amount: 1200, mileage: 130001, vendor: 'axa', note: 'admin operational regression'
    })
    expect(created.status).toBe(201)
    expect(created.body.supplier._id.toString()).toBe(supplierA._id.toString())
    ids.expenses.push(created.body._id)
  })
  it('allows a platform admin without agency membership to create a schedule for an agency vehicle', async () => {
    const created = await request(app).post('/api/maintenance-schedules').set(env.X_ACCESS_TOKEN, adminToken).send({
      car: carA._id.toString(), type: bookcarsTypes.MaintenanceExpenseType.Maintenance, title: 'Admin oil service',
      nextDueDate: new Date(Date.now() + 86400000).toISOString(), intervalDays: 90
    })
    expect(created.status).toBe(201)
    expect(created.body.supplier._id.toString()).toBe(supplierA._id.toString())
    ids.schedules.push(created.body._id)
  })
  it('creates due schedules and keeps schedule/report reads agency isolated', async () => {
    const schedule = await request(app).post('/api/maintenance-schedules').set(env.X_ACCESS_TOKEN, tokenA).send({ car: carA._id.toString(), type: bookcarsTypes.MaintenanceExpenseType.Maintenance, title: 'Oil service', nextDueDate: new Date(Date.now() - 86400000).toISOString(), intervalDays: 90 })
    expect(schedule.status).toBe(201); expect(schedule.body.status).toBe(bookcarsTypes.MaintenanceScheduleStatus.Overdue); ids.schedules.push(schedule.body._id)
    const listA = await request(app).get('/api/maintenance-schedules').set(env.X_ACCESS_TOKEN, tokenA)
    expect(listA.status).toBe(200); expect(listA.body.some((row: any) => row._id === schedule.body._id)).toBe(true)
    const listB = await request(app).get('/api/maintenance-schedules').set(env.X_ACCESS_TOKEN, tokenB)
    expect(listB.status).toBe(200); expect(listB.body.some((row: any) => row._id === schedule.body._id)).toBe(false)
    const reportB = await request(app).get('/api/maintenance-expenses/report').set(env.X_ACCESS_TOKEN, tokenB)
    expect(reportB.status).toBe(200); expect(reportB.body.total).toBe(0)
  })
  it('rejects receipt uploads whose content does not match the file extension (F-SEC-2)', async () => {
    const text = Buffer.from('GA-P2-SEC-FIX-01 plain text spoof payload')
    const spoofedPng = await request(app).post('/api/maintenance-expenses/receipts').set(env.X_ACCESS_TOKEN, tokenA)
      .attach('file', text, { filename: 'receipt.png', contentType: 'image/png' })
    expect(spoofedPng.status).toBe(400)
    const spoofedPdf = await request(app).post('/api/maintenance-expenses/receipts').set(env.X_ACCESS_TOKEN, tokenA)
      .attach('file', text, { filename: 'receipt.pdf', contentType: 'application/pdf' })
    expect(spoofedPdf.status).toBe(400)
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])
    const mismatched = await request(app).post('/api/maintenance-expenses/receipts').set(env.X_ACCESS_TOKEN, tokenA)
      .attach('file', pngBytes, { filename: 'receipt.jpg', contentType: 'image/jpeg' })
    expect(mismatched.status).toBe(400)
    const png = await request(app).post('/api/maintenance-expenses/receipts').set(env.X_ACCESS_TOKEN, tokenA)
      .attach('file', pngBytes, { filename: 'receipt.png', contentType: 'image/png' })
    expect(png.status).toBe(201); expect(png.body.filename).toMatch(/\.png$/)
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
    const jpeg = await request(app).post('/api/maintenance-expenses/receipts').set(env.X_ACCESS_TOKEN, tokenA)
      .attach('file', jpegBytes, { filename: 'receipt.jpg', contentType: 'image/jpeg' })
    expect(jpeg.status).toBe(201); expect(jpeg.body.filename).toMatch(/\.jpg$/)
    for (const filename of [png.body.filename, jpeg.body.filename]) {
      const removed = await request(app).post(`/api/maintenance-expenses/receipts/${filename}`).set(env.X_ACCESS_TOKEN, tokenA)
      expect(removed.status).toBe(200)
    }
  })
})



