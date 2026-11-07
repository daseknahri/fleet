import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import * as bookcarsTypes from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import AgencyMembership from '../src/models/AgencyMembership'

// GA-P2-SEC-DECISIONS-01 — one verification per security decision taken in
// GA-P10-DECISIONS-01 (2026-11-05):
//   F-SEC-4 (403 CORS denial) is verified by the amended P0 baseline
//     (securityBaseline.integration.test.ts, expectation 500 -> 403).
//   F-SEC-5: agency memberships cascade on user deletion (both the staff
//     rows of the deleted user and the agency rows of a deleted owner).
//   F-SEC-7: sign-in enforces the verified flag for self-signup accounts
//     only; admin-created and legacy (unmarked) accounts stay exempt.
// Fixtures are synthetic and removed by exact ID in afterAll.
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const userIds: mongoose.Types.ObjectId[] = []
const membershipIds: mongoose.Types.ObjectId[] = []
let adminToken = ''
const password = 'Ga-Q10-Test-Password-1'

const makeUser = async (label: string, type: bookcarsTypes.UserType, extra: Record<string, unknown> = {}) => {
  const row = await new User({
    email: `ga-q10-sec-${label}-${suffix}@test.bookcars.ma`,
    fullName: `GA Q10 Sec ${label}`,
    language: 'en',
    type,
    active: true,
    verified: true,
    blacklisted: false,
    payLater: true,
    password: await bcrypt.hash(password, 10),
    ...extra,
  }).save()
  userIds.push(row._id)
  return row
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const admin = await makeUser('admin', bookcarsTypes.UserType.Admin)
  adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })
})

afterAll(async () => {
  await AgencyMembership.deleteMany({ _id: { $in: membershipIds } })
  await User.deleteMany({ _id: { $in: userIds } })
  await databaseHelper.close()
})

describe('Security decisions (GA-P2-SEC-DECISIONS-01)', () => {
  it('F-SEC-5: deleting a user cascades their agency memberships', async () => {
    const owner = await makeUser('owner', bookcarsTypes.UserType.Supplier)
    const staff = await makeUser('staff', bookcarsTypes.UserType.Staff)
    const membership = await new AgencyMembership({
      supplier: owner._id,
      user: staff._id,
      role: bookcarsTypes.AgencyRole.Manager,
      status: bookcarsTypes.AgencyMembershipStatus.Active,
    }).save()
    membershipIds.push(membership._id)

    const deleted = await request(app).post('/api/delete-users').set(env.X_ACCESS_TOKEN, adminToken)
      .send([staff._id.toString()])
    expect(deleted.status).toBe(200)
    expect(await AgencyMembership.countDocuments({ _id: membership._id })).toBe(0)

    // Deleting the agency owner removes the agency's remaining rows too
    const staff2 = await makeUser('staff2', bookcarsTypes.UserType.Staff)
    const membership2 = await new AgencyMembership({
      supplier: owner._id,
      user: staff2._id,
      role: bookcarsTypes.AgencyRole.Accountant,
      status: bookcarsTypes.AgencyMembershipStatus.Active,
    }).save()
    membershipIds.push(membership2._id)
    const deletedOwner = await request(app).post('/api/delete-users').set(env.X_ACCESS_TOKEN, adminToken)
      .send([owner._id.toString()])
    expect(deletedOwner.status).toBe(200)
    expect(await AgencyMembership.countDocuments({ supplier: owner._id })).toBe(0)
  })

  it('F-SEC-7: unverified self-signup cannot sign in; admin-created and legacy accounts can', async () => {
    const selfUser = await makeUser('self', bookcarsTypes.UserType.User, { verified: false, signupOrigin: 'self' })
    const denied = await request(app).post('/api/sign-in/frontend')
      .send({ email: selfUser.email, password, mobile: true })
    expect(denied.status).toBe(204)

    const adminCreated = await makeUser('created', bookcarsTypes.UserType.Supplier, { verified: false, signupOrigin: 'admin' })
    const allowedAdmin = await request(app).post('/api/sign-in/admin')
      .send({ email: adminCreated.email, password, mobile: true })
    expect(allowedAdmin.status).toBe(200)
    expect(allowedAdmin.body.accessToken).toBeTruthy()

    const legacy = await makeUser('legacy', bookcarsTypes.UserType.Supplier, { verified: false })
    await User.updateOne({ _id: legacy._id }, { $unset: { signupOrigin: 1 } })
    const allowedLegacy = await request(app).post('/api/sign-in/admin')
      .send({ email: legacy.email, password, mobile: true })
    expect(allowedLegacy.status).toBe(200)

    const verifiedSelf = await makeUser('verified-self', bookcarsTypes.UserType.User, { verified: true, signupOrigin: 'self' })
    const allowedVerified = await request(app).post('/api/sign-in/frontend')
      .send({ email: verifiedSelf.email, password, mobile: true })
    expect(allowedVerified.status).toBe(200)
    expect(allowedVerified.body.accessToken).toBeTruthy()
  })

  it('F-SEC-7: the authenticated create flow marks accounts admin-created (exempt)', async () => {
    const email = `ga-q10-sec-flow-${suffix}@test.bookcars.ma`
    const created = await request(app).post('/api/create-user').set(env.X_ACCESS_TOKEN, adminToken)
      .send({
        fullName: 'GA Q10 Sec Flow', email, language: 'en', password,
        type: bookcarsTypes.UserType.Supplier,
      })
    expect(created.status).toBe(200)
    const stored = await User.findOne({ email })
    expect(stored).toBeTruthy()
    userIds.push(stored!._id)
    expect((stored as { signupOrigin?: string }).signupOrigin).toBe('admin')
    expect(stored!.verified).toBe(false)

    const signin = await request(app).post('/api/sign-in/admin')
      .send({ email, password, mobile: true })
    expect(signin.status).toBe(200)
  })
})
