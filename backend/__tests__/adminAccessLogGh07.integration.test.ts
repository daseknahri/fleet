import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import MaintenanceCategory from '../src/models/MaintenanceCategory'
import AdminAccessLog from '../src/models/AdminAccessLog'
import Country from '../src/models/Country'
import LocationValue from '../src/models/LocationValue'
import Booking from '../src/models/Booking'
import Car from '../src/models/Car'
import Location from '../src/models/Location'

// GH-07 — admin-access audit coverage + read endpoint. Same harness as
// maintenanceCategory.integration (real Mongo-backed app, supplier
// tokens + platform admin token). The list endpoint is exercised
// through the maintenance-categories routes because they cover both
// shapes: the allowPlatformAdminAll collection read (no selector,
// platform-wide row) and the :id write (resource-attributed row).
const ids = {
  users: [] as mongoose.Types.ObjectId[],
  categories: [] as mongoose.Types.ObjectId[],
  logRows: [] as mongoose.Types.ObjectId[],
}
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let supplierA: any, supplierB: any, admin: any, driver: any, location: any, car: any, booking: any
let tokenA: string, adminToken: string

// actor/agency arrive populated ({ _id, fullName, email }) from the
// read endpoint, or null on platform-wide rows.
const idOf = (value: any): string | null => {
  if (!value) {
    return null
  }
  return typeof value === 'string' ? value : (value._id?.toString() ?? null)
}

const readLog = async (token: string, query: string) => {
  const res = await request(app).get(`/api/admin-access-log${query}`).set(env.X_ACCESS_TOKEN, token)
  return res
}

const collectLogRows = (body: any) => {
  const rows = Array.isArray(body) ? body : (body.rows || [])
  for (const row of rows) {
    if (row._id) {
      ids.logRows.push(new mongoose.Types.ObjectId(row._id))
    }
  }
  return rows
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplierA = await new User({ email: `auditlog-supplier-${suffix}@test.bookcars.ma`, fullName: 'Audit Log Supplier', language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true }).save()
  ids.users.push(supplierA._id)
  admin = await new User({ email: `auditlog-admin-${suffix}@test.bookcars.ma`, fullName: 'Audit Log Admin', language: 'en', type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false }).save()
  ids.users.push(admin._id)
  tokenA = await authHelper.encryptJWT({ id: supplierA._id.toString() })
  adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })
  // R2-B15 fixtures: supplierB is the mismatched selector (X); the
  // booking belongs to supplierA (Y). Same shape as r2b09DoubleAudit.
  supplierB = await new User({ email: `auditlog-supplierB-${suffix}@test.bookcars.ma`, fullName: 'Audit Log Supplier B', language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true }).save()
  ids.users.push(supplierB._id)
  driver = await new User({ email: `auditlog-driver-${suffix}@test.bookcars.ma`, fullName: 'Audit Log Driver', language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false }).save()
  ids.users.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `R2-B15 Airport ${suffix}` })
  location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  car = await Car.create({
    name: 'R2-B15 car', supplier: supplierA._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  booking = await Booking.create({
    supplier: supplierA._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(Date.now() + 86400000), to: new Date(Date.now() + 3 * 86400000),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: 500,
  } as any)
})

afterAll(async () => {
  await AdminAccessLog.deleteMany({ _id: { $in: ids.logRows } })
  await MaintenanceCategory.deleteMany({ _id: { $in: ids.categories } })
  await Booking.deleteMany({ _id: booking._id })
  await Car.deleteMany({ _id: car._id })
  await Location.deleteMany({ _id: location._id })
  await LocationValue.deleteMany({ _id: { $in: location.values } })
  await User.deleteMany({ _id: { $in: ids.users } })
  await databaseHelper.close()
})

describe('GH-07 admin-access audit', () => {
  it('writes a platform-wide row for an allowPlatformAdminAll read with no selector', async () => {
    const list = await request(app).get('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, adminToken)
    expect(list.status).toBe(200)
    const log = await readLog(adminToken, '?action=agency%3AreadExpenses&page=1&size=50')
    expect(log.status).toBe(200)
    const rows = collectLogRows(log.body)
    const row = rows.find((r: any) => idOf(r.actor) === admin._id.toString() && r.agency === null)
    expect(row).toBeDefined()
    expect(row.action).toBe('agency:readExpenses')
    expect(row.method).toBe('GET')
    expect(row.path).toBe('/api/maintenance-categories')
  })

  it('writes an agency-attributed row when the admin names an agency', async () => {
    const list = await request(app).get(`/api/maintenance-categories?supplier=${supplierA._id.toString()}`).set(env.X_ACCESS_TOKEN, adminToken)
    expect(list.status).toBe(200)
    const log = await readLog(adminToken, `?agency=${supplierA._id.toString()}&page=1&size=50`)
    expect(log.status).toBe(200)
    const rows = collectLogRows(log.body)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r: any) => idOf(r.agency) === supplierA._id.toString())).toBe(true)
    expect(rows.some((r: any) => r.action === 'agency:readExpenses' && idOf(r.actor) === admin._id.toString())).toBe(true)
  })

  it('writes an agency-attributed row for a resource admin write with no selector', async () => {
    const created = await request(app).post('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA).send({ name: `Audit Log Cat ${suffix}` })
    expect(created.status).toBe(201)
    ids.categories.push(created.body._id)
    const updated = await request(app).put(`/api/maintenance-categories/${created.body._id}`).set(env.X_ACCESS_TOKEN, adminToken).send({ name: `Audit Log Cat ${suffix}`, color: '#1b5e20', active: false })
    expect(updated.status).toBe(200)
    const log = await readLog(adminToken, '?action=maintenance-category%3Aupdate&page=1&size=50')
    expect(log.status).toBe(200)
    const rows = collectLogRows(log.body)
    const row = rows.find((r: any) => idOf(r.actor) === admin._id.toString())
    expect(row).toBeDefined()
    expect(idOf(row.agency)).toBe(supplierA._id.toString())
    expect(row.action).toBe('maintenance-category:update')
    expect(row.method).toBe('PUT')
  })

  it('filters the read endpoint by actor/action/agency and paginates', async () => {
    const byAction = await readLog(adminToken, '?action=maintenance-category%3Aupdate&page=1&size=1')
    expect(byAction.status).toBe(200)
    expect(byAction.body.rows).toHaveLength(1)
    expect(byAction.body.page).toBe(1)
    expect(byAction.body.size).toBe(1)
    expect(byAction.body.total).toBeGreaterThanOrEqual(1)
    expect(byAction.body.rows.every((r: any) => r.action === 'maintenance-category:update')).toBe(true)

    const byActor = await readLog(adminToken, `?actor=${admin._id.toString()}&page=1&size=50`)
    expect(byActor.status).toBe(200)
    const actorRows = collectLogRows(byActor.body)
    expect(actorRows.length).toBeGreaterThan(0)
    expect(actorRows.every((r: any) => idOf(r.actor) === admin._id.toString())).toBe(true)

    const platformWide = await readLog(adminToken, '?agency=platform-wide&page=1&size=50')
    expect(platformWide.status).toBe(200)
    const wideRows = collectLogRows(platformWide.body)
    expect(wideRows.length).toBeGreaterThan(0)
    expect(wideRows.every((r: any) => r.agency === null)).toBe(true)

    expect((await readLog(adminToken, '?agency=not-an-id')).status).toBe(400)
    expect((await readLog(adminToken, '?actor=not-an-id')).status).toBe(400)
    expect((await readLog(adminToken, '?page=0&size=10')).status).toBe(400)
  })

  it('refuses the read endpoint to non-admins', async () => {
    const log = await readLog(tokenA, '?page=1&size=10')
    expect(log.status).toBe(403)
  })

  it('does not audit agency users acting in their own agency', async () => {
    const list = await request(app).get('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, tokenA)
    expect(list.status).toBe(200)
    const log = await readLog(adminToken, `?actor=${supplierA._id.toString()}&page=1&size=50`)
    expect(log.status).toBe(200)
    expect(log.body.total).toBe(0)
    expect(log.body.rows).toHaveLength(0)
  })
})

describe('R2-B10 - admin resource probes are audited before the load', () => {
  const probeRowsSince = async (before: Date, action: string) =>
    AdminAccessLog.find({ actor: admin._id, action, createdAt: { $gte: before } }).lean()

  it('admin GET unknown country logs one probe row (204)', async () => {
    const unknownId = new mongoose.Types.ObjectId().toString()
    const before = new Date()
    const res = await request(app).get(`/api/country/${unknownId}/en`).set(env.X_ACCESS_TOKEN, adminToken)
    // NOTE: the pack said 404; getCountry answers 204 for a missing row.
    expect(res.status).toBe(204)
    const rows = await probeRowsSince(before, 'country:get-country')
    expect(rows).toHaveLength(1)
    expect(rows[0].agency).toBeNull()
    expect(rows[0].path).toContain(unknownId)
    await AdminAccessLog.deleteMany({ _id: { $in: rows.map((r: any) => r._id) } })
  })

  it('admin GET unknown cash session movements logs one probe row (404)', async () => {
    const unknownId = new mongoose.Types.ObjectId().toString()
    const before = new Date()
    const res = await request(app).get(`/api/cash/sessions/${unknownId}/movements`).set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(404)
    const rows = await probeRowsSince(before, 'cash:list-movements')
    expect(rows).toHaveLength(1)
    expect(rows[0].agency).toBeNull()
    expect(rows[0].path).toContain(unknownId)
    await AdminAccessLog.deleteMany({ _id: { $in: rows.map((r: any) => r._id) } })
  })

  it('admin DELETE unknown car logs one probe row (204)', async () => {
    const unknownId = new mongoose.Types.ObjectId().toString()
    const before = new Date()
    const res = await request(app).delete(`/api/delete-car/${unknownId}`).set(env.X_ACCESS_TOKEN, adminToken).send({ reason: 'R2-B10 probe test' })
    // NOTE: the pack said 404/409; deleteCar answers 204 for a missing row.
    expect(res.status).toBe(204)
    const rows = await probeRowsSince(before, 'car:delete-car')
    expect(rows).toHaveLength(1)
    expect(rows[0].agency).toBeNull()
    expect(rows[0].path).toContain(unknownId)
    await AdminAccessLog.deleteMany({ _id: { $in: rows.map((r: any) => r._id) } })
  })

  it('admin GET known country logs exactly one row (no double-log)', async () => {
    const valueEn = await LocationValue.create({ language: 'en', value: `R2-B10 Country ${suffix}` })
    const country = await Country.create({ supplier: supplierA._id, values: [valueEn._id] })
    try {
      const before = new Date()
      const res = await request(app).get(`/api/country/${country._id.toString()}/en`).set(env.X_ACCESS_TOKEN, adminToken)
      expect(res.status).toBe(200)
      const rows = await probeRowsSince(before, 'country:get-country')
      expect(rows).toHaveLength(1)
      expect(String(rows[0].agency)).toBe(supplierA._id.toString())
      await AdminAccessLog.deleteMany({ _id: { $in: rows.map((r: any) => r._id) } })
    } finally {
      await Country.deleteMany({ _id: country._id })
      await LocationValue.deleteMany({ _id: valueEn._id })
    }
  })

  it('non-admin probe writes zero admin rows', async () => {
    const unknownId = new mongoose.Types.ObjectId().toString()
    const before = new Date()
    await request(app).get(`/api/country/${unknownId}/en`).set(env.X_ACCESS_TOKEN, tokenA)
    const rows = await AdminAccessLog.find({ createdAt: { $gte: before } }).lean()
    expect(rows).toHaveLength(0)
  })
})

describe('R2-B15 - selector vs resource attribution', () => {
  const rowsSince = async (before: Date) =>
    AdminAccessLog.find({ actor: admin._id, createdAt: { $gte: before } }).lean()

  const updateBody = () => ({
    booking: {
      _id: booking._id.toString(),
      supplier: supplierA._id.toString(),
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

  it('mismatched selector on update: one row, resource agency, booking:update-booking', async () => {
    const before = new Date()
    const res = await request(app).put(`/api/update-booking?supplier=${supplierB._id.toString()}`).set(env.X_ACCESS_TOKEN, adminToken).send(updateBody())
    expect(res.status).toBe(200)
    const rows = await rowsSince(before)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('booking:update-booking')
    expect(String(rows[0].agency)).toBe(supplierA._id.toString())
    await AdminAccessLog.deleteMany({ _id: { $in: rows.map((r: any) => r._id) } })
  })

  it('mismatched selector on resource read: one row, resource agency, country:get-country', async () => {
    const valueEn = await LocationValue.create({ language: 'en', value: `R2-B15 Country ${suffix}` })
    const country = await Country.create({ supplier: supplierA._id, values: [valueEn._id] })
    try {
      const before = new Date()
      const res = await request(app).get(`/api/country/${country._id.toString()}/en?supplier=${supplierB._id.toString()}`).set(env.X_ACCESS_TOKEN, adminToken)
      expect(res.status).toBe(200)
      const rows = await rowsSince(before)
      expect(rows).toHaveLength(1)
      expect(rows[0].action).toBe('country:get-country')
      expect(String(rows[0].agency)).toBe(supplierA._id.toString())
      await AdminAccessLog.deleteMany({ _id: { $in: rows.map((r: any) => r._id) } })
    } finally {
      await Country.deleteMany({ _id: country._id })
      await LocationValue.deleteMany({ _id: valueEn._id })
    }
  })

  it('collection call with selector: one row, selector agency, agency:<permission>', async () => {
    const before = new Date()
    const res = await request(app).get(`/api/maintenance-categories?supplier=${supplierA._id.toString()}`).set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(200)
    const rows = await rowsSince(before)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('agency:readExpenses')
    expect(String(rows[0].agency)).toBe(supplierA._id.toString())
    await AdminAccessLog.deleteMany({ _id: { $in: rows.map((r: any) => r._id) } })
  })

  it('platform-wide read with no selector: one platform-wide row, agency null', async () => {
    const before = new Date()
    const res = await request(app).get('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.status).toBe(200)
    const rows = await rowsSince(before)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('agency:readExpenses')
    expect(rows[0].agency).toBeNull()
    await AdminAccessLog.deleteMany({ _id: { $in: rows.map((r: any) => r._id) } })
  })
})
