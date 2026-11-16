import 'dotenv/config'
import request from 'supertest'
import url from 'url'
import path from 'path'
import asyncFs from 'node:fs/promises'
import { nanoid } from 'nanoid'
import * as bookcarsTypes from ':bookcars-types'
import * as databaseHelper from '../src/utils/databaseHelper'
import app from '../src/app'
import * as env from '../src/config/env.config'
import * as testHelper from './testHelper'
import * as helper from '../src/utils/helper'
import User from '../src/models/User'
import Token from '../src/models/Token'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const IMAGE1 = 'bmw-x1.jpg'
const IMAGE1_PATH = path.join(__dirname, `./img/${IMAGE1}`)

let SUPPLIER1_ID: string
let SUPPLIER2_ID: string
let TOKEN: string

const createdClientIds: string[] = []
const createdDocFiles: string[] = []

const uniqueEmail = () => `f5b-client-${nanoid(8)}@test.bookcars.ma`
const uniqueCin = () => `CIN${nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`
const uniquePassport = () => `P${nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`

const buildCreatePayload = (
  supplierId: string | undefined,
  email: string,
  overrides: Partial<bookcarsTypes.CreateUserPayload> = {},
): bookcarsTypes.CreateUserPayload => ({
  email,
  fullName: 'F5B Test Client',
  language: testHelper.LANGUAGE,
  birthDate: new Date(1990, 4, 17),
  phone: '0600000000',
  location: 'Casablanca',
  bio: '',
  type: bookcarsTypes.UserType.User,
  supplier: supplierId,
  clientType: bookcarsTypes.ClientType.Individual,
  clientStatus: bookcarsTypes.ClientStatus.Active,
  ...overrides,
})

const createClient = async (payload: bookcarsTypes.CreateUserPayload) => {
  const res = await request(app)
    .post('/api/create-user')
    .set(env.X_ACCESS_TOKEN, TOKEN)
    .send(payload)
  if (res.statusCode === 200) {
    const stored = await User.findOne({ email: payload.email }).lean()
    if (stored?._id) {
      createdClientIds.push(stored._id.toString())
    }
  }
  return res
}

const getClientId = async (email: string) => {
  const stored = await User.findOne({ email }).lean()
  return stored?._id.toString() || ''
}

const buildUpdatePayload = (
  clientId: string,
  createPayload: bookcarsTypes.CreateUserPayload,
  overrides: Partial<bookcarsTypes.UpdateUserPayload> = {},
): bookcarsTypes.UpdateUserPayload => ({
  ...createPayload,
  _id: clientId,
  ...overrides,
})

const updateClient = async (payload: bookcarsTypes.UpdateUserPayload) => request(app)
  .post('/api/update-user')
  .set(env.X_ACCESS_TOKEN, TOKEN)
  .send(payload)

const getClient = async (clientId: string) => request(app)
  .get(`/api/user/${clientId}`)
  .set(env.X_ACCESS_TOKEN, TOKEN)

const uploadDocument = async (clientId: string, kind: string) => request(app)
  .post(`/api/client-documents/${clientId}`)
  .set(env.X_ACCESS_TOKEN, TOKEN)
  .attach('file', IMAGE1_PATH)
  .field('kind', kind)

const verifyDocument = async (clientId: string, file: string, status: string) => request(app)
  .post(`/api/verify-client-document/${clientId}/${encodeURIComponent(file)}`)
  .set(env.X_ACCESS_TOKEN, TOKEN)
  .send({ status })

//
// Connecting and initializing the database before running the test suite
//
beforeAll(async () => {
  testHelper.initializeLogger()

  await databaseHelper.connect(env.DB_URI, false, false)

  await testHelper.initialize()

  // create two suppliers (two agencies for the scoping tests)
  const supplierName1 = testHelper.getSupplierName()
  SUPPLIER1_ID = await testHelper.createSupplier(`${supplierName1}@test.bookcars.ma`, supplierName1)
  const supplierName2 = testHelper.getSupplierName()
  SUPPLIER2_ID = await testHelper.createSupplier(`${supplierName2}@test.bookcars.ma`, supplierName2)

  TOKEN = await testHelper.signinAsAdmin()
})

//
// Closing and cleaning the database connection after running the test suite
//
afterAll(async () => {
  await testHelper.signout(TOKEN)

  await Token.deleteMany({ user: { $in: createdClientIds } })
  await User.deleteMany({ _id: { $in: createdClientIds } })
  for (const file of createdDocFiles) {
    const filePath = path.join(env.CDN_CLIENT_DOCUMENTS, file)
    if (await helper.pathExists(filePath)) {
      await asyncFs.unlink(filePath)
    }
  }

  await testHelper.deleteSupplier(SUPPLIER1_ID)
  await testHelper.deleteSupplier(SUPPLIER2_ID)

  await testHelper.close()
  await databaseHelper.close()
})

//
// W2-05 — consent / retention fields
//
describe('W2-05 consent', () => {
  it('stores consentGiven, stamps consentAt server-side, and stores the scope on create', async () => {
    const email = uniqueEmail()
    const res = await createClient(buildCreatePayload(SUPPLIER1_ID, email, {
      consentGiven: true,
      consentScope: ['marketing'],
    }))
    expect(res.statusCode).toBe(200)
    const stored = await User.findOne({ email }).lean()
    expect(stored?.consentGiven).toBe(true)
    expect(stored?.consentAt).toBeTruthy()
    expect(stored?.consentAt!.getTime()).toBeGreaterThan(Date.now() - 60000)
    expect(stored?.consentScope).toEqual(['marketing'])
  })

  it('ignores a forged consentAt from the payload', async () => {
    const email = uniqueEmail()
    const payload = buildCreatePayload(SUPPLIER1_ID, email, { consentGiven: true })
    ;(payload as unknown as Record<string, unknown>).consentAt = '2020-01-01T00:00:00.000Z'
    const res = await createClient(payload)
    expect(res.statusCode).toBe(200)
    const stored = await User.findOne({ email }).lean()
    expect(stored?.consentAt).toBeTruthy()
    expect(stored?.consentAt!.getFullYear()).not.toBe(2020)
  })

  it('stamps consentAt on false→true and clears it on true→false', async () => {
    const email = uniqueEmail()
    const created = await createClient(buildCreatePayload(SUPPLIER1_ID, email, { consentGiven: false }))
    expect(created.statusCode).toBe(200)
    const clientId = await getClientId(email)
    const before = await User.findById(clientId).lean()
    expect(before?.consentAt).toBeFalsy()

    const granted = await updateClient(buildUpdatePayload(clientId, buildCreatePayload(SUPPLIER1_ID, email), { consentGiven: true }))
    expect(granted.statusCode).toBe(200)
    const storedGranted = await User.findById(clientId).lean()
    expect(storedGranted?.consentGiven).toBe(true)
    expect(storedGranted?.consentAt).toBeTruthy()
    expect(storedGranted?.consentAt!.getTime()).toBeGreaterThan(Date.now() - 60000)

    const withdrawn = await updateClient(buildUpdatePayload(clientId, buildCreatePayload(SUPPLIER1_ID, email), { consentGiven: false }))
    expect(withdrawn.statusCode).toBe(200)
    const storedWithdrawn = await User.findById(clientId).lean()
    expect(storedWithdrawn?.consentGiven).toBe(false)
    expect(storedWithdrawn?.consentAt).toBeFalsy()
  })

  it('leaves consentAt untouched when consentGiven is omitted from the update', async () => {
    const email = uniqueEmail()
    const created = await createClient(buildCreatePayload(SUPPLIER1_ID, email, { consentGiven: true }))
    expect(created.statusCode).toBe(200)
    const clientId = await getClientId(email)
    const before = await User.findById(clientId).lean()
    expect(before?.consentAt).toBeTruthy()
    const stamp = before?.consentAt!.getTime()

    const payload = buildUpdatePayload(clientId, buildCreatePayload(SUPPLIER1_ID, email))
    delete (payload as Partial<bookcarsTypes.UpdateUserPayload>).consentGiven
    const res = await updateClient(payload)
    expect(res.statusCode).toBe(200)
    const stored = await User.findById(clientId).lean()
    expect(stored?.consentAt!.getTime()).toBe(stamp)
  })

  it('rejects an unknown consent scope member and a non-boolean consentGiven', async () => {
    const res = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), {
      consentGiven: true,
      consentScope: ['selling-data'],
    }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('consentScope')

    const res2 = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), {
      consentGiven: 'maybe' as unknown as boolean,
    }))
    expect(res2.statusCode).toBe(400)
    expect(res2.text).toContain('consentGiven')
  })
})

//
// W2-06 — document verification states
//
describe('W2-06 document verification', () => {
  it('uploads start as pending', async () => {
    const email = uniqueEmail()
    const created = await createClient(buildCreatePayload(SUPPLIER1_ID, email))
    expect(created.statusCode).toBe(200)
    const clientId = await getClientId(email)

    const res = await uploadDocument(clientId, 'cin')
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe(bookcarsTypes.ClientDocumentStatus.Pending)
    createdDocFiles.push(res.body.file as string)
    const stored = await User.findById(clientId).lean()
    expect(stored?.clientDocuments?.[0]?.status).toBe(bookcarsTypes.ClientDocumentStatus.Pending)
  })

  it('verifies a document, recording who and when', async () => {
    const email = uniqueEmail()
    await createClient(buildCreatePayload(SUPPLIER1_ID, email))
    const clientId = await getClientId(email)
    const uploaded = await uploadDocument(clientId, 'passport')
    expect(uploaded.statusCode).toBe(200)
    createdDocFiles.push(uploaded.body.file as string)

    const res = await verifyDocument(clientId, uploaded.body.file as string, 'verified')
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe(bookcarsTypes.ClientDocumentStatus.Verified)
    expect(res.body.verifiedBy).toBe(testHelper.getAdminUserId())
    expect(res.body.verifiedAt).toBeTruthy()
    const stored = await User.findById(clientId).lean()
    expect(stored?.clientDocuments?.[0]?.status).toBe(bookcarsTypes.ClientDocumentStatus.Verified)
  })

  it('rejects a document', async () => {
    const email = uniqueEmail()
    await createClient(buildCreatePayload(SUPPLIER1_ID, email))
    const clientId = await getClientId(email)
    const uploaded = await uploadDocument(clientId, 'license')
    expect(uploaded.statusCode).toBe(200)
    createdDocFiles.push(uploaded.body.file as string)

    const res = await verifyDocument(clientId, uploaded.body.file as string, 'rejected')
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe(bookcarsTypes.ClientDocumentStatus.Rejected)
    expect(res.body.verifiedAt).toBeTruthy()
  })

  it('rejects an unknown verification status', async () => {
    const email = uniqueEmail()
    await createClient(buildCreatePayload(SUPPLIER1_ID, email))
    const clientId = await getClientId(email)
    const uploaded = await uploadDocument(clientId, 'cin')
    expect(uploaded.statusCode).toBe(200)
    createdDocFiles.push(uploaded.body.file as string)

    const res = await verifyDocument(clientId, uploaded.body.file as string, 'archived')
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('Invalid document status')
  })

  it('returns 404 for an unrecorded document file', async () => {
    const email = uniqueEmail()
    await createClient(buildCreatePayload(SUPPLIER1_ID, email))
    const clientId = await getClientId(email)

    const res = await verifyDocument(clientId, 'clientdoc_nope.jpg', 'verified')
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for a malformed client id', async () => {
    const res = await verifyDocument('not-an-id', 'clientdoc_nope.jpg', 'verified')
    expect(res.statusCode).toBe(400)
  })
})

//
// W2-07 — duplicate CIN / passport / phone on interactive create
//
describe('W2-07 duplicate identity numbers', () => {
  it('rejects a duplicate CIN within the same agency', async () => {
    const cin = uniqueCin()
    const first = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), { cinNumber: cin }))
    expect(first.statusCode).toBe(200)

    const second = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), { cinNumber: cin }))
    expect(second.statusCode).toBe(400)
    expect(second.text).toContain('cinNumber')
  })

  it('allows the same CIN under a different agency', async () => {
    const cin = uniqueCin()
    const first = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), { cinNumber: cin }))
    expect(first.statusCode).toBe(200)

    const second = await createClient(buildCreatePayload(SUPPLIER2_ID, uniqueEmail(), { cinNumber: cin }))
    expect(second.statusCode).toBe(200)
  })

  it('rejects a duplicate CIN that differs only by case', async () => {
    const cin = uniqueCin()
    const first = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), { cinNumber: cin }))
    expect(first.statusCode).toBe(200)

    const second = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), { cinNumber: cin.toLowerCase() }))
    expect(second.statusCode).toBe(400)
    expect(second.text).toContain('cinNumber')
  })

  it('rejects a duplicate passport within the same agency', async () => {
    const passport = uniquePassport()
    const first = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), { passportNumber: passport }))
    expect(first.statusCode).toBe(200)

    const second = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), { passportNumber: passport }))
    expect(second.statusCode).toBe(400)
    expect(second.text).toContain('passportNumber')
  })

  it('rejects taking another client\'s CIN on update, but allows keeping your own', async () => {
    const cinA = uniqueCin()
    const cinB = uniqueCin()
    const emailA = uniqueEmail()
    await createClient(buildCreatePayload(SUPPLIER1_ID, emailA, { cinNumber: cinA }))
    const emailB = uniqueEmail()
    await createClient(buildCreatePayload(SUPPLIER1_ID, emailB, { cinNumber: cinB }))
    const clientBId = await getClientId(emailB)

    const clash = await updateClient(buildUpdatePayload(clientBId, buildCreatePayload(SUPPLIER1_ID, emailB), { cinNumber: cinA }))
    expect(clash.statusCode).toBe(400)
    expect(clash.text).toContain('cinNumber')

    const own = await updateClient(buildUpdatePayload(clientBId, buildCreatePayload(SUPPLIER1_ID, emailB), { cinNumber: cinB }))
    expect(own.statusCode).toBe(200)
  })

  it('allows a duplicate phone (shared family phones are legitimate)', async () => {
    const phone = '0611111111'
    const first = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), { phone }))
    expect(first.statusCode).toBe(200)

    const second = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), { phone }))
    expect(second.statusCode).toBe(200)
  })

  it('rejects a duplicate CIN for supplier-less admin creates too', async () => {
    const cin = uniqueCin()
    const first = await createClient(buildCreatePayload(undefined, uniqueEmail(), { cinNumber: cin }))
    expect(first.statusCode).toBe(200)

    const second = await createClient(buildCreatePayload(undefined, uniqueEmail(), { cinNumber: cin }))
    expect(second.statusCode).toBe(400)
    expect(second.text).toContain('cinNumber')
  })
})

//
// W2-16 — duplicate email is a 409, not a generic 400
//
describe('W2-16 duplicate email', () => {
  it('returns 409 naming the email on a duplicate admin create', async () => {
    const email = uniqueEmail()
    const first = await createClient(buildCreatePayload(SUPPLIER1_ID, email))
    expect(first.statusCode).toBe(200)

    const second = await createClient(buildCreatePayload(SUPPLIER1_ID, email))
    expect(second.statusCode).toBe(409)
    expect(second.text).toContain('Email')
  })
})

//
// W2-17 — the two blocking mechanisms stay separate on write; the list
// carries both signals so the UI can render the effective state.
//
describe('W2-17 blocking precedence data', () => {
  it('carries both blacklisted and clientStatus on the list row', async () => {
    const emailBlocked = uniqueEmail()
    await createClient(buildCreatePayload(SUPPLIER1_ID, emailBlocked, {
      clientStatus: bookcarsTypes.ClientStatus.Blocked,
    }))
    const emailBlacklisted = uniqueEmail()
    await createClient(buildCreatePayload(SUPPLIER1_ID, emailBlacklisted))
    const blacklistedId = await getClientId(emailBlacklisted)
    await User.updateOne({ _id: blacklistedId }, { blacklisted: true })

    const res = await request(app)
      .post(`/api/users/${testHelper.PAGE}/${testHelper.SIZE}?s=${encodeURIComponent(emailBlacklisted)}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .send({ user: '', types: [bookcarsTypes.UserType.User] })
    expect(res.statusCode).toBe(200)
    const row = (res.body[0].resultData as bookcarsTypes.User[]).find((r) => r.email === emailBlacklisted)
    expect(row).toBeTruthy()
    expect(row?.blacklisted).toBe(true)
    expect(row?.clientStatus).toBe(bookcarsTypes.ClientStatus.Active)

    const res2 = await request(app)
      .post(`/api/users/${testHelper.PAGE}/${testHelper.SIZE}?s=${encodeURIComponent(emailBlocked)}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .send({ user: '', types: [bookcarsTypes.UserType.User] })
    expect(res2.statusCode).toBe(200)
    const row2 = (res2.body[0].resultData as bookcarsTypes.User[]).find((r) => r.email === emailBlocked)
    expect(row2).toBeTruthy()
    expect(row2?.clientStatus).toBe(bookcarsTypes.ClientStatus.Blocked)
    expect(row2?.blacklisted).toBe(false)
  })
})

//
// W2-18 — company-client fields
//
describe('W2-18 company clients', () => {
  it('rejects a company client without a company name', async () => {
    const res = await createClient(buildCreatePayload(SUPPLIER1_ID, uniqueEmail(), {
      clientType: bookcarsTypes.ClientType.Company,
    }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('companyName')
  })

  it('stores the company fields on a company client', async () => {
    const email = uniqueEmail()
    const res = await createClient(buildCreatePayload(SUPPLIER1_ID, email, {
      clientType: bookcarsTypes.ClientType.Company,
      companyName: '  SARL Atlas  ',
      companyRegistration: 'RC-123456',
      companyContactName: 'Karim Bennis',
    }))
    expect(res.statusCode).toBe(200)
    const stored = await User.findOne({ email }).lean()
    expect(stored?.companyName).toBe('SARL Atlas')
    expect(stored?.companyRegistration).toBe('RC-123456')
    expect(stored?.companyContactName).toBe('Karim Bennis')
    const fetched = await getClient(stored!._id.toString())
    expect(fetched.statusCode).toBe(200)
    expect(fetched.body.companyName).toBe('SARL Atlas')
  })

  it('rejects flipping an individual to company without a company name', async () => {
    const email = uniqueEmail()
    await createClient(buildCreatePayload(SUPPLIER1_ID, email))
    const clientId = await getClientId(email)

    const res = await updateClient(buildUpdatePayload(clientId, buildCreatePayload(SUPPLIER1_ID, email), {
      clientType: bookcarsTypes.ClientType.Company,
    }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('companyName')
  })

  it('keeps the stored company fields when a company flips back to individual', async () => {
    const email = uniqueEmail()
    await createClient(buildCreatePayload(SUPPLIER1_ID, email, {
      clientType: bookcarsTypes.ClientType.Company,
      companyName: 'SARL Atlas',
    }))
    const clientId = await getClientId(email)

    const res = await updateClient(buildUpdatePayload(clientId, buildCreatePayload(SUPPLIER1_ID, email), {
      clientType: bookcarsTypes.ClientType.Individual,
    }))
    expect(res.statusCode).toBe(200)
    const stored = await User.findById(clientId).lean()
    expect(stored?.clientType).toBe(bookcarsTypes.ClientType.Individual)
    expect(stored?.companyName).toBe('SARL Atlas')
  })

  it('stores company fields sent for an individual (unused, not stripped)', async () => {
    const email = uniqueEmail()
    const res = await createClient(buildCreatePayload(SUPPLIER1_ID, email, {
      companyName: 'SARL Atlas',
    }))
    expect(res.statusCode).toBe(200)
    const stored = await User.findOne({ email }).lean()
    expect(stored?.companyName).toBe('SARL Atlas')
  })
})
