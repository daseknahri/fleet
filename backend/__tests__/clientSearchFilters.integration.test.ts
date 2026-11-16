import 'dotenv/config'
import request from 'supertest'
import { nanoid } from 'nanoid'
import * as bookcarsTypes from ':bookcars-types'
import * as databaseHelper from '../src/utils/databaseHelper'
import app from '../src/app'
import * as env from '../src/config/env.config'
import * as testHelper from './testHelper'
import User from '../src/models/User'
import Token from '../src/models/Token'

let SUPPLIER1_ID: string
let TOKEN: string

const createdClientIds: string[] = []

// The User schema stores emails lowercase: generated addresses must
// already be canonical, or stored-vs-generated comparisons fail.
const uniqueEmail = () => `f5b-search-${nanoid(8).toLowerCase()}@test.bookcars.ma`
const uniqueCin = () => `CIN${nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`
const uniquePassport = () => `P${nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`
const uniqueLicense = () => `L${nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`
const uniquePhone = () => `06${nanoid(8).replace(/[^0-9]/g, '0').slice(0, 8)}`
const uniqueSurname = () => `F5B${nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`

const buildCreatePayload = (
  supplierId: string | undefined,
  email: string,
  overrides: Partial<bookcarsTypes.CreateUserPayload> = {},
): bookcarsTypes.CreateUserPayload => ({
  email,
  fullName: 'F5B Search Client',
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

const listUsers = async (keyword: string, filters?: bookcarsTypes.ClientListFilters) => request(app)
  .post(`/api/users/1/30?s=${encodeURIComponent(keyword)}`)
  .set(env.X_ACCESS_TOKEN, TOKEN)
  .send({ user: '', types: [bookcarsTypes.UserType.User], filters } as bookcarsTypes.GetUsersBody)

const listedEmails = (body: unknown) => {
  const rows = (body as [{ resultData?: { email: string }[] }])[0]?.resultData || []
  return rows.map((r) => r.email)
}
const listedRows = (body: unknown) => (body as [{ resultData?: bookcarsTypes.User[] }])[0]?.resultData || []

// A documented client for the missing-docs tests: a real document row
// plus an expiry date, written directly (the upload flow is already
// covered by clientF5b.integration.test.ts; no file is staged here).
const setDocumentsAndExpiry = async (clientId: string, cinExpiry: Date | null) => {
  await User.updateOne(
    { _id: clientId },
    {
      $set: {
        clientDocuments: [{
          kind: bookcarsTypes.ClientDocumentKind.Cin,
          file: 'f5b-doc.jpg',
          originalName: 'f5b-doc.jpg',
          uploadedAt: new Date(),
        }],
        cinExpiry,
      },
    },
  )
}

//
// Connecting and initializing the database before running the test suite
//
beforeAll(async () => {
  testHelper.initializeLogger()

  await databaseHelper.connect(env.DB_URI, false, false)

  await testHelper.initialize()

  const supplierName = testHelper.getSupplierName()
  SUPPLIER1_ID = await testHelper.createSupplier(`${supplierName}@test.bookcars.ma`, supplierName)

  TOKEN = await testHelper.signinAsAdmin()
})

//
// Closing and cleaning the database connection after running the test suite
//
afterAll(async () => {
  await testHelper.signout(TOKEN)

  await Token.deleteMany({ user: { $in: createdClientIds } })
  await User.deleteMany({ _id: { $in: createdClientIds } })

  await testHelper.deleteSupplier(SUPPLIER1_ID)

  await testHelper.close()
  await databaseHelper.close()
})

//
// W2-04 — keyword search: phone + identity numbers, name/email regression
//
describe('W2-04 keyword search', () => {
  it('finds a client by phone', async () => {
    const email = uniqueEmail()
    const phone = uniquePhone()
    const created = await createClient(buildCreatePayload(SUPPLIER1_ID, email, { phone }))
    expect(created.statusCode).toBe(200)

    const res = await listUsers(phone)
    expect(res.statusCode).toBe(200)
    expect(listedEmails(res.body)).toEqual([email])
  })

  it('finds a client by CIN', async () => {
    const email = uniqueEmail()
    const cin = uniqueCin()
    const created = await createClient(buildCreatePayload(SUPPLIER1_ID, email, { cinNumber: cin }))
    expect(created.statusCode).toBe(200)

    const res = await listUsers(cin)
    expect(res.statusCode).toBe(200)
    expect(listedEmails(res.body)).toEqual([email])
  })

  it('finds a client by passport number', async () => {
    const email = uniqueEmail()
    const passport = uniquePassport()
    const created = await createClient(buildCreatePayload(SUPPLIER1_ID, email, { passportNumber: passport }))
    expect(created.statusCode).toBe(200)

    const res = await listUsers(passport)
    expect(res.statusCode).toBe(200)
    expect(listedEmails(res.body)).toEqual([email])
  })

  it('finds a client by license number', async () => {
    const email = uniqueEmail()
    const license = uniqueLicense()
    const created = await createClient(buildCreatePayload(SUPPLIER1_ID, email, { licenseNumber: license }))
    expect(created.statusCode).toBe(200)

    const res = await listUsers(license)
    expect(res.statusCode).toBe(200)
    expect(listedEmails(res.body)).toEqual([email])
  })

  it('still finds a client by name and by email', async () => {
    const surname = uniqueSurname()
    const email = uniqueEmail()
    const created = await createClient(buildCreatePayload(SUPPLIER1_ID, email, { fullName: `F5B Search ${surname}` }))
    expect(created.statusCode).toBe(200)

    const byName = await listUsers(surname)
    expect(byName.statusCode).toBe(200)
    expect(listedEmails(byName.body)).toContain(email)

    const byEmail = await listUsers(email)
    expect(byEmail.statusCode).toBe(200)
    expect(listedEmails(byEmail.body)).toEqual([email])
  })
})

//
// W2-04 — list filters
//
describe('W2-04 filters', () => {
  it('filters by clientStatus (Blocked only)', async () => {
    const surname = uniqueSurname()
    const blockedEmail = uniqueEmail()
    const activeEmail = uniqueEmail()
    const blocked = await createClient(buildCreatePayload(SUPPLIER1_ID, blockedEmail, {
      fullName: `F5B Filter ${surname}`,
      clientStatus: bookcarsTypes.ClientStatus.Blocked,
    }))
    expect(blocked.statusCode).toBe(200)
    const active = await createClient(buildCreatePayload(SUPPLIER1_ID, activeEmail, {
      fullName: `F5B Filter ${surname}`,
    }))
    expect(active.statusCode).toBe(200)

    const res = await listUsers(surname, { clientStatus: bookcarsTypes.ClientStatus.Blocked })
    expect(res.statusCode).toBe(200)
    expect(listedEmails(res.body)).toEqual([blockedEmail])
  })

  it('filters by clientType (Company only)', async () => {
    const surname = uniqueSurname()
    const companyEmail = uniqueEmail()
    const individualEmail = uniqueEmail()
    const company = await createClient(buildCreatePayload(SUPPLIER1_ID, companyEmail, {
      fullName: `F5B Filter ${surname}`,
      clientType: bookcarsTypes.ClientType.Company,
      companyName: `F5B SARL ${surname}`,
    }))
    expect(company.statusCode).toBe(200)
    const individual = await createClient(buildCreatePayload(SUPPLIER1_ID, individualEmail, {
      fullName: `F5B Filter ${surname}`,
    }))
    expect(individual.statusCode).toBe(200)

    const res = await listUsers(surname, { clientType: bookcarsTypes.ClientType.Company })
    expect(res.statusCode).toBe(200)
    expect(listedEmails(res.body)).toEqual([companyEmail])
  })

  it('filters by missingDocs (no documents, or an expired identity date)', async () => {
    const surname = uniqueSurname()
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000)
    const past = new Date(Date.now() - 24 * 3600 * 1000)

    // A: no documents at all -> missing
    const noDocsEmail = uniqueEmail()
    const noDocs = await createClient(buildCreatePayload(SUPPLIER1_ID, noDocsEmail, {
      fullName: `F5B Filter ${surname}`,
    }))
    expect(noDocs.statusCode).toBe(200)

    // B: documented, all expiries in the future -> NOT missing
    const documentedEmail = uniqueEmail()
    const documented = await createClient(buildCreatePayload(SUPPLIER1_ID, documentedEmail, {
      fullName: `F5B Filter ${surname}`,
    }))
    expect(documented.statusCode).toBe(200)
    await setDocumentsAndExpiry(await getClientId(documentedEmail), future)

    // C: documented, but the CIN expiry is in the past -> missing
    const expiredEmail = uniqueEmail()
    const expired = await createClient(buildCreatePayload(SUPPLIER1_ID, expiredEmail, {
      fullName: `F5B Filter ${surname}`,
    }))
    expect(expired.statusCode).toBe(200)
    await setDocumentsAndExpiry(await getClientId(expiredEmail), past)

    const res = await listUsers(surname, { missingDocs: true })
    expect(res.statusCode).toBe(200)
    expect(listedEmails(res.body).sort()).toEqual([expiredEmail, noDocsEmail].sort())
  })

  it('filters by hasContracts', async () => {
    const surname = uniqueSurname()
    const withContractsEmail = uniqueEmail()
    const withoutContractsEmail = uniqueEmail()
    const withContracts = await createClient(buildCreatePayload(SUPPLIER1_ID, withContractsEmail, {
      fullName: `F5B Filter ${surname}`,
    }))
    expect(withContracts.statusCode).toBe(200)
    await User.updateOne(
      { _id: await getClientId(withContractsEmail) },
      { $set: { contracts: [{ language: 'en', file: 'contract.pdf' }] } },
    )
    const withoutContracts = await createClient(buildCreatePayload(SUPPLIER1_ID, withoutContractsEmail, {
      fullName: `F5B Filter ${surname}`,
    }))
    expect(withoutContracts.statusCode).toBe(200)

    const res = await listUsers(surname, { hasContracts: true })
    expect(res.statusCode).toBe(200)
    expect(listedEmails(res.body)).toEqual([withContractsEmail])
  })

  it('combines filters with the keyword (Blocked + Company)', async () => {
    const surname = uniqueSurname()
    const blockedCompanyEmail = uniqueEmail()
    const blockedIndividualEmail = uniqueEmail()
    const blockedCompany = await createClient(buildCreatePayload(SUPPLIER1_ID, blockedCompanyEmail, {
      fullName: `F5B Filter ${surname}`,
      clientStatus: bookcarsTypes.ClientStatus.Blocked,
      clientType: bookcarsTypes.ClientType.Company,
      companyName: `F5B SARL ${surname}`,
    }))
    expect(blockedCompany.statusCode).toBe(200)
    const blockedIndividual = await createClient(buildCreatePayload(SUPPLIER1_ID, blockedIndividualEmail, {
      fullName: `F5B Filter ${surname}`,
      clientStatus: bookcarsTypes.ClientStatus.Blocked,
    }))
    expect(blockedIndividual.statusCode).toBe(200)

    const res = await listUsers(surname, {
      clientStatus: bookcarsTypes.ClientStatus.Blocked,
      clientType: bookcarsTypes.ClientType.Company,
    })
    expect(res.statusCode).toBe(200)
    expect(listedEmails(res.body)).toEqual([blockedCompanyEmail])
  })

  it('ignores an unknown enum filter value instead of failing', async () => {
    const res = await listUsers('', { clientStatus: 'NoSuchStatus' })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(listedRows(res.body))).toBe(true)
  })

  it('returns per-row documentsMissing / documentsExpired flags', async () => {
    const surname = uniqueSurname()
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000)
    const past = new Date(Date.now() - 24 * 3600 * 1000)

    const noDocsEmail = uniqueEmail()
    expect((await createClient(buildCreatePayload(SUPPLIER1_ID, noDocsEmail, {
      fullName: `F5B Filter ${surname}`,
    }))).statusCode).toBe(200)

    const documentedEmail = uniqueEmail()
    expect((await createClient(buildCreatePayload(SUPPLIER1_ID, documentedEmail, {
      fullName: `F5B Filter ${surname}`,
    }))).statusCode).toBe(200)
    await setDocumentsAndExpiry(await getClientId(documentedEmail), future)

    const expiredEmail = uniqueEmail()
    expect((await createClient(buildCreatePayload(SUPPLIER1_ID, expiredEmail, {
      fullName: `F5B Filter ${surname}`,
    }))).statusCode).toBe(200)
    await setDocumentsAndExpiry(await getClientId(expiredEmail), past)

    const res = await listUsers(surname)
    expect(res.statusCode).toBe(200)
    const rows = listedRows(res.body)
    const byEmail = new Map(rows.map((r) => [r.email, r]))
    expect(byEmail.get(noDocsEmail)?.documentsMissing).toBe(true)
    expect(byEmail.get(noDocsEmail)?.documentsExpired).toBe(false)
    expect(byEmail.get(documentedEmail)?.documentsMissing).toBe(false)
    expect(byEmail.get(documentedEmail)?.documentsExpired).toBe(false)
    expect(byEmail.get(expiredEmail)?.documentsMissing).toBe(true)
    expect(byEmail.get(expiredEmail)?.documentsExpired).toBe(true)
  })
})
