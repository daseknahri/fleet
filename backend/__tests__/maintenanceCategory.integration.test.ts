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
import MaintenanceCategory from '../src/models/MaintenanceCategory'
import MaintenanceExpense from '../src/models/MaintenanceExpense'
import MaintenanceSchedule from '../src/models/MaintenanceSchedule'

// Next pass - agency-created maintenance categories: CRUD, agency
// isolation, duplicate names, the expense/schedule wiring, the
// by-category report, and the in-use delete protection. Same harness
// as maintenanceReceiptSchedule (real Mongo-backed app, supplier
// tokens + platform admin token).
const ids = { users: [] as mongoose.Types.ObjectId[], cars: [] as mongoose.Types.ObjectId[], locations: [] as mongoose.Types.ObjectId[], values: [] as mongoose.Types.ObjectId[], categories: [] as mongoose.Types.ObjectId[], expenses: [] as mongoose.Types.ObjectId[], schedules: [] as mongoose.Types.ObjectId[] }
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let supplierA: any, supplierB: any, supplierC: any, admin: any, carA: any, carC: any, tokenA: string, tokenB: string, tokenC: string, adminToken: string

const makeSupplier = async (label: string) => {
  const row = await new User({ email: `maintcat-${label}-${suffix}@test.bookcars.ma`, fullName: `Maintenance Category ${label}`, language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true }).save()
  ids.users.push(row._id); return row
}
const makeCar = async (supplier: any) => {
  const value = await new LocationValue({ language: 'en', value: `Maintenance category location ${supplier._id}` }).save(); ids.values.push(value._id)
  const location = await new Location({ country: new mongoose.Types.ObjectId(), values: [value._id] }).save(); ids.locations.push(location._id)
  const car = await new Car({ name: `Maintenance category car ${supplier._id}`, supplier: supplier._id, minimumAge: 21, locations: [location._id], dailyPrice: 100, deposit: 500, available: true, type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic, aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank, mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0, collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0, range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5 }).save()
  ids.cars.push(car._id); return car
}
beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplierA = await makeSupplier('a'); supplierB = await makeSupplier('b'); supplierC = await makeSupplier('c')
  admin = await new User({ email: `maintcat-admin-${suffix}@test.bookcars.ma`, fullName: 'Maintenance Category Admin', language: 'en', type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false }).save(); ids.users.push(admin._id)
  carA = await makeCar(supplierA); carC = await makeCar(supplierC)
  tokenA = await authHelper.encryptJWT({ id: supplierA._id.toString() }); tokenB = await authHelper.encryptJWT({ id: supplierB._id.toString() }); tokenC = await authHelper.encryptJWT({ id: supplierC._id.toString() }); adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })
})
afterAll(async () => {
  await MaintenanceSchedule.deleteMany({ _id: { $in: ids.schedules } }); await MaintenanceExpense.deleteMany({ _id: { $in: ids.expenses } })
  await MaintenanceCategory.deleteMany({ _id: { $in: ids.categories } })
  await Car.deleteMany({ _id: { $in: ids.cars } }); await Location.deleteMany({ _id: { $in: ids.locations } }); await LocationValue.deleteMany({ _id: { $in: ids.values } }); await User.deleteMany({ _id: { $in: ids.users } }); await databaseHelper.close()
})

describe('Next pass - maintenance categories', () => {
  it('creates, lists, updates and deactivates categories, agency-isolated', async () => {
    const created = await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA).send({ name: 'Entretien courant', color: '#2e7d32' })
    expect(created.status).toBe(201); expect(created.body.name).toBe('Entretien courant'); expect(created.body.color).toBe('#2e7d32'); expect(created.body.active).toBe(true)
    ids.categories.push(created.body._id)
    const listA = await request(app).get('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA)
    expect(listA.status).toBe(200); expect(listA.body.some((row: any) => row._id === created.body._id)).toBe(true)
    const listB = await request(app).get('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenB)
    expect(listB.status).toBe(200); expect(listB.body.some((row: any) => row._id === created.body._id)).toBe(false)
    const adminList = await request(app).get('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, adminToken)
    expect(adminList.status).toBe(200); expect(adminList.body.some((row: any) => row._id === created.body._id)).toBe(true)
    const updated = await request(app).put(`/api/maintenance-categories/${created.body._id}`).set(env.X_ACCESS_TOKEN, tokenA).send({ name: 'Entretien courant', color: '#1b5e20', active: false })
    expect(updated.status).toBe(200); expect(updated.body.color).toBe('#1b5e20'); expect(updated.body.active).toBe(false)
    const activeOnly = await request(app).get('/api/maintenance-categories?active=true').set(env.X_ACCESS_TOKEN, tokenA)
    expect(activeOnly.status).toBe(200); expect(activeOnly.body.some((row: any) => row._id === created.body._id)).toBe(false)
    const all = await request(app).get('/api/maintenance-categories?active=false').set(env.X_ACCESS_TOKEN, tokenA)
    expect(all.body.some((row: any) => row._id === created.body._id)).toBe(true)
  })

  it('refuses duplicate names in the same agency (case-insensitive) but allows the same name in another agency', async () => {
    const first = await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA).send({ name: 'Pneus' })
    expect(first.status).toBe(201); ids.categories.push(first.body._id)
    const dup = await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA).send({ name: 'pneus' })
    expect(dup.status).toBe(409)
    const other = await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenB).send({ name: 'Pneus' })
    expect(other.status).toBe(201); ids.categories.push(other.body._id)
  })

  it('refuses an empty name and a bad colour', async () => {
    expect((await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA).send({ name: '   ' })).status).toBe(400)
    expect((await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA).send({ name: 'Freins', color: 'red' })).status).toBe(400)
    expect((await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA).send({ name: 'Freins', color: '#12' })).status).toBe(400)
  })

  it('wires a category onto expenses and schedules, and refuses another agency category', async () => {
    const cat = await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA).send({ name: 'Moteur' })
    expect(cat.status).toBe(201); ids.categories.push(cat.body._id)
    const otherCat = await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenB).send({ name: 'Moteur B' })
    expect(otherCat.status).toBe(201); ids.categories.push(otherCat.body._id)
    const expense = await request(app).post('/api/maintenance-expenses').set(env.X_ACCESS_TOKEN, tokenA).send({ car: carA._id.toString(), date: new Date().toISOString(), type: bookcarsTypes.MaintenanceExpenseType.Repair, amount: 450, category: cat.body._id })
    expect(expense.status).toBe(201); expect(expense.body.category?.name).toBe('Moteur'); ids.expenses.push(expense.body._id)
    const foreignExpense = await request(app).post('/api/maintenance-expenses').set(env.X_ACCESS_TOKEN, tokenA).send({ car: carA._id.toString(), date: new Date().toISOString(), type: bookcarsTypes.MaintenanceExpenseType.Repair, amount: 10, category: otherCat.body._id })
    expect(foreignExpense.status).toBe(400)
    const cleared = await request(app).put(`/api/maintenance-expenses/${expense.body._id}`).set(env.X_ACCESS_TOKEN, tokenA).send({ car: carA._id.toString(), date: new Date().toISOString(), type: bookcarsTypes.MaintenanceExpenseType.Repair, amount: 450, category: null })
    expect(cleared.status).toBe(200); expect(cleared.body.category).toBeNull()
    const schedule = await request(app).post('/api/maintenance-schedules').set(env.X_ACCESS_TOKEN, tokenA).send({ car: carA._id.toString(), type: bookcarsTypes.MaintenanceExpenseType.Maintenance, title: 'Vidange', nextDueDate: new Date(Date.now() + 86400000).toISOString(), intervalDays: 90, category: cat.body._id })
    expect(schedule.status).toBe(201); expect(schedule.body.category?.name).toBe('Moteur'); ids.schedules.push(schedule.body._id)
    const foreignSchedule = await request(app).post('/api/maintenance-schedules').set(env.X_ACCESS_TOKEN, tokenA).send({ car: carA._id.toString(), type: bookcarsTypes.MaintenanceExpenseType.Maintenance, title: 'Freins', nextDueDate: new Date(Date.now() + 86400000).toISOString(), intervalDays: 90, category: otherCat.body._id })
    expect(foreignSchedule.status).toBe(400)
  })

  it('reports expenses by category, with an uncategorised bucket', async () => {
    const cat = await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenC).send({ name: 'Carrosserie' })
    expect(cat.status).toBe(201); ids.categories.push(cat.body._id)
    const inCat = await request(app).post('/api/maintenance-expenses').set(env.X_ACCESS_TOKEN, tokenC).send({ car: carC._id.toString(), date: new Date().toISOString(), type: bookcarsTypes.MaintenanceExpenseType.Bodywork, amount: 111.11, category: cat.body._id })
    expect(inCat.status).toBe(201); ids.expenses.push(inCat.body._id)
    const noCat = await request(app).post('/api/maintenance-expenses').set(env.X_ACCESS_TOKEN, tokenC).send({ car: carC._id.toString(), date: new Date().toISOString(), type: bookcarsTypes.MaintenanceExpenseType.Fuel, amount: 222.22 })
    expect(noCat.status).toBe(201); ids.expenses.push(noCat.body._id)
    const report = await request(app).get('/api/maintenance-expenses/report').set(env.X_ACCESS_TOKEN, tokenC)
    expect(report.status).toBe(200)
    expect(report.body.byCategory).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: cat.body._id, name: 'Carrosserie', total: 111.11, count: 1 }),
      expect.objectContaining({ category: null, name: null, total: 222.22, count: 1 }),
    ]))
  })

  it('refuses to delete a category in use, and deletes an unused one', async () => {
    const used = await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA).send({ name: 'Utilisee' })
    expect(used.status).toBe(201); ids.categories.push(used.body._id)
    const expense = await request(app).post('/api/maintenance-expenses').set(env.X_ACCESS_TOKEN, tokenA).send({ car: carA._id.toString(), date: new Date().toISOString(), type: bookcarsTypes.MaintenanceExpenseType.Repair, amount: 50, category: used.body._id })
    expect(expense.status).toBe(201); ids.expenses.push(expense.body._id)
    const blocked = await request(app).delete(`/api/maintenance-categories/${used.body._id}`).set(env.X_ACCESS_TOKEN, tokenA)
    expect(blocked.status).toBe(409)
    const free = await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA).send({ name: 'Libre' })
    expect(free.status).toBe(201); ids.categories.push(free.body._id)
    const removed = await request(app).delete(`/api/maintenance-categories/${free.body._id}`).set(env.X_ACCESS_TOKEN, tokenA)
    expect(removed.status).toBe(200)
    const list = await request(app).get('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA)
    expect(list.body.some((row: any) => row._id === free.body._id)).toBe(false)
  })
})