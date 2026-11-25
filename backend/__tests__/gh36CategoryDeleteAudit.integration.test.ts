import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import app from '../src/app'
import User from '../src/models/User'
import MaintenanceCategory from '../src/models/MaintenanceCategory'
import MaintenanceCategoryAudit from '../src/models/MaintenanceCategoryAudit'
import MaintenanceExpense from '../src/models/MaintenanceExpense'

// GH-36 - category delete is unaudited (guarded, but silent): a hard
// delete now requires a reason and writes an audit row first.

const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCategoryIds: mongoose.Types.ObjectId[] = []
const fixtureExpenseIds: mongoose.Types.ObjectId[] = []
const fixtureAuditCategoryIds: mongoose.Types.ObjectId[] = []

let adminId: string
let supplierAId: string
let supplierAToken: string
let supplierBId: string
let supplierBToken: string

const makeSupplier = async (label: string) => {
  const supplier = await User.create({
    email: `gh36-supplier-${label}-${rand()}@test.bookcars.ma`, fullName: `GH-36 Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  return supplier
}

const makeCategory = async (supplierId: string, label: string) => {
  const category = await MaintenanceCategory.create({ supplier: supplierId, name: `GH-36 ${label} ${rand()}` } as any)
  fixtureCategoryIds.push(category._id)
  return category
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh36-admin', email: `gh36-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()

  const supplierA = await makeSupplier('A')
  supplierAId = supplierA._id.toString()
  supplierAToken = await authHelper.encryptJWT({ id: supplierAId })
  const supplierB = await makeSupplier('B')
  supplierBId = supplierB._id.toString()
  supplierBToken = await authHelper.encryptJWT({ id: supplierBId })
})

afterAll(async () => {
  await MaintenanceCategoryAudit.deleteMany({ category: { $in: fixtureAuditCategoryIds } })
  await MaintenanceExpense.deleteMany({ _id: { $in: fixtureExpenseIds } })
  await MaintenanceCategory.deleteMany({ _id: { $in: fixtureCategoryIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-36 category delete audit', () => {
  const del = (id: string, token: string, body?: Record<string, unknown>) => request(app)
    .delete(`/api/maintenance-categories/${id}`)
    .set(env.X_ACCESS_TOKEN, token)
    .send(body || {})

  it('refuses a delete without a reason, and audits a delete with one', async () => {
    const category = await makeCategory(supplierAId, 'no-reason')
    const catId = category._id.toString()
    fixtureAuditCategoryIds.push(category._id)

    const noReason = await del(catId, supplierAToken, {})
    expect(noReason.status).toBe(400)
    expect(noReason.text).toBe('A reason is required to delete a category')

    const short = await del(catId, supplierAToken, { reason: 'ab' })
    expect(short.status).toBe(400)

    const ok = await del(catId, supplierAToken, { reason: 'duplicate of Tyres' })
    expect(ok.status).toBe(200)

    const list = await request(app).get('/api/maintenance-categories').set(env.X_ACCESS_TOKEN, supplierAToken)
    expect(list.status).toBe(200)
    expect((list.body as any[]).some((c) => String(c._id) === catId)).toBe(false)

    const row = await MaintenanceCategoryAudit.findOne({ category: category._id }).lean()
    expect(row).toBeTruthy()
    expect(row?.action).toBe(bookcarsTypes.MaintenanceExpenseAuditAction.Deleted)
    expect(row?.reason).toBe('duplicate of Tyres')
    expect(String(row?.actor)).toBe(supplierAId)

    const audit = await request(app).get(`/api/maintenance-categories/${catId}/audit`).set(env.X_ACCESS_TOKEN, supplierAToken)
    expect(audit.status).toBe(200)
    expect((audit.body as any[]).length).toBe(1)
    expect((audit.body as any[])[0].reason).toBe('duplicate of Tyres')
  })

  it('in-use guard stays: 409 and no audit row', async () => {
    const category = await makeCategory(supplierAId, 'in-use')
    const expense = await MaintenanceExpense.create({
      supplier: supplierAId, date: new Date(),
      type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
      amount: 100, vendor: 'GH-36 Garage', category: category._id,
    } as any)
    fixtureExpenseIds.push(expense._id)

    const res = await del(category._id.toString(), supplierAToken, { reason: 'no longer needed' })
    expect(res.status).toBe(409)
    expect(res.text).toMatch(/in use/)

    const row = await MaintenanceCategoryAudit.findOne({ category: category._id }).lean()
    expect(row).toBeNull()
  })

  it('scope: another supplier cannot delete it (404, no audit row)', async () => {
    const category = await makeCategory(supplierAId, 'scoped')
    const res = await del(category._id.toString(), supplierBToken, { reason: 'no longer needed' })
    expect(res.status).toBe(404)

    const row = await MaintenanceCategoryAudit.findOne({ category: category._id }).lean()
    expect(row).toBeNull()
    // Still there for its owner.
    const stillThere = await MaintenanceCategory.findById(category._id).lean()
    expect(stillThere).toBeTruthy()
  })
})
