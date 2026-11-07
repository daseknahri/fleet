import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'

// GA-P1-APPROVALS-PRODUCER-01 regression proof for the manual approval
// path: creation through POST /api/approvals, listing in the agency scope
// consumed by the /approbations queue, and approve/reject decisions.
// Updated by GA-P1-APPROVALS-PRODUCER-02 (2026-11-05): the owner decided
// the producer policy in GA-P10-DECISIONS-01 — domain-flow producers are
// now wired (covered by approvalsProducer.integration.test.ts), and
// decision 1.4 forbids deciding your own request, so the admin who
// creates these records no longer decides them; the agency owner does.
// The approvals API has no delete route, so the decided records created
// here remain as labeled synthetic residue, following the
// GA-P1-APPROVALS-UI-01/02 precedent.
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const userIds: mongoose.Types.ObjectId[] = []
let supplierA: any, tokenA = '', tokenB = '', adminToken = ''

const makeUser = async (label: string, type: bookcarsTypes.UserType) => {
  const row = await new User({ email: `ga-q5-appr-${label}-${suffix}@test.bookcars.ma`, fullName: `GA Q5 Approvals ${label}`, language: 'en', type, active: true, verified: true, blacklisted: false, payLater: true }).save()
  userIds.push(row._id)
  return row
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplierA = await makeUser('a', bookcarsTypes.UserType.Supplier)
  const supplierB = await makeUser('b', bookcarsTypes.UserType.Supplier)
  const admin = await makeUser('admin', bookcarsTypes.UserType.Admin)
  tokenA = await authHelper.encryptJWT({ id: supplierA._id.toString() })
  tokenB = await authHelper.encryptJWT({ id: supplierB._id.toString() })
  adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })
})

afterAll(async () => {
  await User.deleteMany({ _id: { $in: userIds } })
  await databaseHelper.close()
})

describe('Approvals end-to-end (manual producer, agency scoped)', () => {
  it('create -> scoped list -> foreign decide 404 -> approve and reject complete', async () => {
    const subject1 = `GA-P1-APPROVALS-PRODUCER-01 e2e approve ${suffix}`
    const created = await request(app).post('/api/approvals').set(env.X_ACCESS_TOKEN, adminToken)
      .send({ supplier: supplierA._id.toString(), subject: subject1, subjectType: 'invoice', amount: 1250, currency: 'MAD', reason: 'producer-01 e2e proof' })
    expect(created.status).toBe(201)
    expect(created.body.status).toBe(bookcarsTypes.ApprovalDecision.Pending)
    const id1 = created.body._id

    const duplicate = await request(app).post('/api/approvals').set(env.X_ACCESS_TOKEN, adminToken)
      .send({ supplier: supplierA._id.toString(), subject: subject1, subjectType: 'invoice', amount: 1250, currency: 'MAD' })
    expect(duplicate.status).toBe(409)

    const listA = await request(app).get('/api/approvals').set(env.X_ACCESS_TOKEN, tokenA)
    expect(listA.status).toBe(200)
    expect(listA.body.some((row: any) => row._id === id1)).toBe(true)
    const listB = await request(app).get('/api/approvals').set(env.X_ACCESS_TOKEN, tokenB)
    expect(listB.status).toBe(200)
    expect(listB.body.some((row: any) => row._id === id1)).toBe(false)

    const foreignDecide = await request(app).post(`/api/approvals/${id1}/decide`).set(env.X_ACCESS_TOKEN, tokenB)
      .send({ decision: 'approved', reason: 'foreign attempt' })
    expect(foreignDecide.status).toBe(404)

    // Decision 1.4 (GA-P10-DECISIONS-01): the requester (admin) cannot
    // decide their own request.
    const selfDecide = await request(app).post(`/api/approvals/${id1}/decide`).set(env.X_ACCESS_TOKEN, adminToken)
      .send({ decision: 'approved', reason: 'self attempt' })
    expect(selfDecide.status).toBe(403)

    const approved = await request(app).post(`/api/approvals/${id1}/decide`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ decision: 'approved', reason: 'producer-01 e2e approve' })
    expect(approved.status).toBe(200)
    expect(approved.body.status).toBe(bookcarsTypes.ApprovalDecision.Approved)
    expect(approved.body.decidedBy).toBeTruthy()
    expect(approved.body.decidedAt).toBeTruthy()

    const subject2 = `GA-P1-APPROVALS-PRODUCER-01 e2e reject ${suffix}`
    const created2 = await request(app).post('/api/approvals').set(env.X_ACCESS_TOKEN, adminToken)
      .send({ supplier: supplierA._id.toString(), subject: subject2, subjectType: 'contract', amount: 300, currency: 'MAD', reason: 'producer-01 e2e proof' })
    expect(created2.status).toBe(201)
    const rejected = await request(app).post(`/api/approvals/${created2.body._id}/decide`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ decision: 'rejected', reason: 'producer-01 e2e reject' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.status).toBe(bookcarsTypes.ApprovalDecision.Rejected)

    const finalList = await request(app).get('/api/approvals').set(env.X_ACCESS_TOKEN, tokenA)
    const row1 = finalList.body.find((row: any) => row._id === id1)
    const row2 = finalList.body.find((row: any) => row._id === created2.body._id)
    expect(row1?.status).toBe(bookcarsTypes.ApprovalDecision.Approved)
    expect(row2?.status).toBe(bookcarsTypes.ApprovalDecision.Rejected)
  })
})
