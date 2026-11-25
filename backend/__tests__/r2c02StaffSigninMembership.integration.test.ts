import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import app from '../src/app'
import User from '../src/models/User'
import AgencyMembership from '../src/models/AgencyMembership'

// R2-C02 \u2014 sign-in fails fast for a Staff user with 0 or 2+ active
// agency memberships (204, no token), instead of minting a token that
// verifyToken 403s on first use. Staff only: Suppliers and customers
// have no membership check in verifyToken either.
const rand = () => Math.random().toString(36).slice(2)
const password = 'Un1tTest5'

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureMembershipIds: mongoose.Types.ObjectId[] = []

let supplierA: any
let supplierB: any

const makeUser = async (label: string, type: bookcarsTypes.UserType) => {
  const passwordHash = await authHelper.hashPassword(password)
  const user = await User.create({
    fullName: `C02 ${label}`, email: `c02-${label}-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(user._id)
  return user
}

const addMembership = async (userId: any, supplierId: any, status: bookcarsTypes.AgencyMembershipStatus = bookcarsTypes.AgencyMembershipStatus.Active) => {
  const m = await AgencyMembership.create({
    supplier: supplierId, user: userId,
    role: bookcarsTypes.AgencyRole.Manager, status,
  })
  fixtureMembershipIds.push(m._id)
  return m
}

const signin = (email: string, appType: string, mobile = true) =>
  request(app).post(`/api/sign-in/${appType}`).send({ email, password, mobile })

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplierA = await makeUser('supplier-a', bookcarsTypes.UserType.Supplier)
  supplierB = await makeUser('supplier-b', bookcarsTypes.UserType.Supplier)
})

afterAll(async () => {
  await AgencyMembership.deleteMany({ _id: { $in: fixtureMembershipIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})

describe('R2-C02 \u2014 Staff sign-in membership check', () => {
  it('Staff with 0 active memberships gets 204, no token (mobile) and no cookie (web)', async () => {
    const staff = await makeUser('staff-none', bookcarsTypes.UserType.Staff)
    const mobileRes = await signin(staff.email, 'admin', true)
    expect(mobileRes.status).toBe(204)
    expect(mobileRes.body.accessToken).toBeUndefined()
    const webRes = await signin(staff.email, 'admin', false)
    expect(webRes.status).toBe(204)
    expect(webRes.headers['set-cookie']).toBeUndefined()
  })

  it('Staff with 2 active memberships gets 204, no token', async () => {
    const staff = await makeUser('staff-two', bookcarsTypes.UserType.Staff)
    await addMembership(staff._id, supplierA._id)
    await addMembership(staff._id, supplierB._id)
    const res = await signin(staff.email, 'admin', true)
    expect(res.status).toBe(204)
    expect(res.body.accessToken).toBeUndefined()
  })

  it('Staff with exactly 1 active membership signs in (regression lock)', async () => {
    const staff = await makeUser('staff-one', bookcarsTypes.UserType.Staff)
    await addMembership(staff._id, supplierA._id)
    const res = await signin(staff.email, 'admin', true)
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
  })

  it('Staff with 1 active + 1 suspended membership signs in (only Active counts)', async () => {
    const staff = await makeUser('staff-suspended', bookcarsTypes.UserType.Staff)
    await addMembership(staff._id, supplierA._id)
    await addMembership(staff._id, supplierB._id, bookcarsTypes.AgencyMembershipStatus.Suspended)
    const res = await signin(staff.email, 'admin', true)
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
  })

  it('Supplier with no memberships signs in (Staff-only check)', async () => {
    const supplier = await makeUser('supplier-none', bookcarsTypes.UserType.Supplier)
    const res = await signin(supplier.email, 'admin', true)
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
  })

  it('Customer sign-in is unaffected', async () => {
    const customer = await makeUser('customer', bookcarsTypes.UserType.User)
    const res = await signin(customer.email, 'frontend', true)
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
  })
})
