import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import app from '../src/app'
import MaintenanceExpense from '../src/models/MaintenanceExpense'
import MaintenanceCategory from '../src/models/MaintenanceCategory'
import MaintenanceExpensePayment from '../src/models/MaintenanceExpensePayment'
import CashMovement from '../src/models/CashMovement'
import CashSession from '../src/models/CashSession'
import User from '../src/models/User'

// GH-24 — wire expense payments post unlinked with no way back: the
// link endpoints + the unlinked list are the repair path.

const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCategoryIds: mongoose.Types.ObjectId[] = []
const fixtureExpenseIds: mongoose.Types.ObjectId[] = []
const fixturePaymentIds: mongoose.Types.ObjectId[] = []
const fixtureSessionIds: mongoose.Types.ObjectId[] = []

let adminToken: string
let adminId: string
let supplierId: string
let expenseId: string

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh24-admin', email: `gh24-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  const supplier = await User.create({
    email: `gh24-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-24 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  supplierId = supplier._id.toString()
  fixtureUserIds.push(supplier._id)

  const expense = await MaintenanceExpense.create({
    supplier: supplier._id, date: new Date(),
    type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
    amount: 500, vendor: 'GH-24 Garage',
  })
  fixtureExpenseIds.push(expense._id)
  expenseId = expense._id.toString()
})

afterAll(async () => {
  await CashMovement.deleteMany({ supplier: supplierId })
  await MaintenanceExpensePayment.deleteMany({ _id: { $in: fixturePaymentIds } })
  await CashSession.deleteMany({ _id: { $in: fixtureSessionIds } })
  await MaintenanceExpense.deleteMany({ _id: { $in: fixtureExpenseIds } })
  await MaintenanceCategory.deleteMany({ _id: { $in: fixtureCategoryIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-24 expense payment link', () => {
  const recordPayment = (method: bookcarsTypes.RentalPaymentMethod, amount: number) => request(app)
    .post(`/api/maintenance-expenses/${expenseId}/payments`)
    .set(env.X_ACCESS_TOKEN, adminToken)
    .send({ date: new Date().toISOString(), amount, method })

  // One open session per (supplier, account): reuse the one already open.
  const openSessions: Partial<Record<bookcarsTypes.CashAccountType, string>> = {}
  const openSession = async (account: bookcarsTypes.CashAccountType) => {
    if (openSessions[account]) {
      return openSessions[account] as string
    }
    const res = await request(app)
      .post('/api/cash/sessions')
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ account, supplier: supplierId })
    expect(res.status).toBe(201)
    fixtureSessionIds.push(new mongoose.Types.ObjectId(res.body._id))
    openSessions[account] = res.body._id as string
    return res.body._id as string
  }

  // NOTE: this test runs first on purpose — a wire payment recorded
  // after any Bank session opens is auto-linked at record time, so an
  // unlinked wire payment only exists while no Bank session is open.
  test('linking with an unknown session id 404s', async () => {
    const res = await recordPayment(bookcarsTypes.RentalPaymentMethod.BankTransfer, 100)
    expect(res.status).toBe(201)
    const paymentId = res.body.payment._id as string
    fixturePaymentIds.push(new mongoose.Types.ObjectId(paymentId))

    const link = await request(app)
      .post(`/api/maintenance-expenses/${expenseId}/payments/${paymentId}/link-bank-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ bankSessionId: new mongoose.Types.ObjectId().toString() })
    expect(link.status).toBe(404)
    expect(link.text).toBe('Open bank session not found')
  })

  test('a wire payment posts unlinked with no Bank session open, and the unlinked list shows it', async () => {
    const res = await recordPayment(bookcarsTypes.RentalPaymentMethod.BankTransfer, 200)
    expect(res.status).toBe(201)
    const paymentId = res.body.payment._id as string
    fixturePaymentIds.push(new mongoose.Types.ObjectId(paymentId))
    expect(res.body.payment.bankMovement).toBeFalsy()

    const list = await request(app)
      .get('/api/maintenance-expenses/unlinked-payments')
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(list.status).toBe(200)
    const row = (list.body as Array<{ _id: string }>).find((r) => r._id === paymentId)
    expect(row).toBeDefined()
  })

  test('link-bank-session links it into the named session; a second link 409s', async () => {
    const list = await request(app)
      .get('/api/maintenance-expenses/unlinked-payments')
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(list.status).toBe(200)
    const row = (list.body as Array<{ _id: string, expense: string }>).find((r) => typeof r.expense === 'object')
    expect(row).toBeDefined()
    const paymentId = row!._id

    const bankSessionId = await openSession(bookcarsTypes.CashAccountType.Bank)
    const link = await request(app)
      .post(`/api/maintenance-expenses/${expenseId}/payments/${paymentId}/link-bank-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ bankSessionId })
    expect(link.status).toBe(200)
    expect(link.body.movement).toBeDefined()
    expect(link.body.movement.session).toBe(bankSessionId)
    expect(link.body.movement.direction).toBe(bookcarsTypes.CashMovementDirection.Out)
    expect(link.body.movement.status).toBe('confirmed')
    expect(link.body.payment.bankMovement).toBe(link.body.movement._id)

    const movement = await CashMovement.findById(link.body.movement._id).lean()
    expect(movement?.expensePayment?.toString()).toBe(paymentId)
    expect(movement?.session?.toString()).toBe(bankSessionId)

    const stored = await MaintenanceExpensePayment.findById(paymentId).lean()
    expect(stored?.bankMovement?.toString()).toBe(link.body.movement._id)

    // The payment no longer appears in the unlinked list.
    const listAfter = await request(app)
      .get('/api/maintenance-expenses/unlinked-payments')
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect((listAfter.body as Array<{ _id: string }>).some((r) => r._id === paymentId)).toBe(false)

    // A second link is refused explicitly.
    const again = await request(app)
      .post(`/api/maintenance-expenses/${expenseId}/payments/${paymentId}/link-bank-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ bankSessionId })
    expect(again.status).toBe(409)
    expect(again.text).toBe('This payment is already linked to a bank session')
  })

  test('linking a cash-method payment to the bank endpoint 409s', async () => {
    await openSession(bookcarsTypes.CashAccountType.Cash)
    const res = await recordPayment(bookcarsTypes.RentalPaymentMethod.Cash, 150)
    expect(res.status).toBe(201)
    const paymentId = res.body.payment._id as string
    fixturePaymentIds.push(new mongoose.Types.ObjectId(paymentId))
    // A cash payment links at record time (a Cash session is open).
    expect(res.body.payment.cashMovement).toBeTruthy()

    const bankSessionId = await openSession(bookcarsTypes.CashAccountType.Bank)
    const link = await request(app)
      .post(`/api/maintenance-expenses/${expenseId}/payments/${paymentId}/link-bank-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ bankSessionId })
    expect(link.status).toBe(409)
    expect(link.text).toBe('Only a bank-transfer expense payment can be linked to a bank session')
  })

  // GH-34 — recordPayment must return the expense with its category
  // populated (name + color). Maintenance.tsx replaces the row from
  // this response directly (no re-fetch), so a bare ObjectId blanked
  // the row's category until the next refresh.
  test('recordPayment returns the expense category populated, on first record and on idempotency replay', async () => {
    const category = await MaintenanceCategory.create({
      supplier: supplierId, name: 'GH-34 Brakes', color: '#123456',
    })
    fixtureCategoryIds.push(category._id)

    const catExpense = await MaintenanceExpense.create({
      supplier: supplierId, date: new Date(),
      type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
      amount: 300, vendor: 'GH-34 Garage', category: category._id,
    })
    fixtureExpenseIds.push(catExpense._id)

    const idempotencyKey = `gh34-key-${rand()}`
    const payload = {
      date: new Date().toISOString(), amount: 100,
      method: bookcarsTypes.RentalPaymentMethod.Cash, idempotencyKey,
    }
    const res = await request(app)
      .post(`/api/maintenance-expenses/${catExpense._id.toString()}/payments`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send(payload)
    expect(res.status).toBe(201)
    const paymentId = res.body.payment._id as string
    fixturePaymentIds.push(new mongoose.Types.ObjectId(paymentId))

    expect(typeof res.body.expense.category).toBe('object')
    expect(res.body.expense.category._id).toBe(category._id.toString())
    expect(res.body.expense.category.name).toBe('GH-34 Brakes')
    expect(res.body.expense.category.color).toBe('#123456')

    const replay = await request(app)
      .post(`/api/maintenance-expenses/${catExpense._id.toString()}/payments`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send(payload)
    expect(replay.status).toBe(200)
    expect(replay.body.payment._id).toBe(paymentId)
    expect(typeof replay.body.expense.category).toBe('object')
    expect(replay.body.expense.category._id).toBe(category._id.toString())
    expect(replay.body.expense.category.name).toBe('GH-34 Brakes')
    expect(replay.body.expense.category.color).toBe('#123456')
  })

  // R3-12 — concurrent double-link: both requests must 200 with the
  // SAME movement, and exactly one movement exists. The payments are
  // created by direct model insert: recordPayment auto-links once a
  // session is open, so it cannot produce an unlinked payment here.
  const seedUnlinkedExpensePayment = async (method: bookcarsTypes.RentalPaymentMethod, amount: number) => {
    const payment = await MaintenanceExpensePayment.create({
      supplier: new mongoose.Types.ObjectId(supplierId), expense: new mongoose.Types.ObjectId(expenseId),
      date: new Date(), amount, currency: 'MAD', method,
    } as any)
    fixturePaymentIds.push(payment._id)
    return payment._id.toString()
  }

  test('R3-12 concurrent double-link (bank) both 200, same movement, one movement', async () => {
    const paymentId = await seedUnlinkedExpensePayment(bookcarsTypes.RentalPaymentMethod.BankTransfer, 250)
    const bankSessionId = await openSession(bookcarsTypes.CashAccountType.Bank)
    const link = () => request(app)
      .post(`/api/maintenance-expenses/${expenseId}/payments/${paymentId}/link-bank-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ bankSessionId })
    const [first, second] = await Promise.all([link(), link()])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.movement).toBeDefined()
    expect(second.body.movement).toBeDefined()
    expect(second.body.movement._id).toBe(first.body.movement._id)
    expect(await CashMovement.countDocuments({ expensePayment: new mongoose.Types.ObjectId(paymentId) })).toBe(1)
  })

  test('R3-12 concurrent double-link (cash) both 200, same movement, one movement', async () => {
    const paymentId = await seedUnlinkedExpensePayment(bookcarsTypes.RentalPaymentMethod.Cash, 175)
    const cashSessionId = await openSession(bookcarsTypes.CashAccountType.Cash)
    const link = () => request(app)
      .post(`/api/maintenance-expenses/${expenseId}/payments/${paymentId}/link-cash-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ cashSessionId })
    const [first, second] = await Promise.all([link(), link()])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.movement).toBeDefined()
    expect(second.body.movement).toBeDefined()
    expect(second.body.movement._id).toBe(first.body.movement._id)
    expect(await CashMovement.countDocuments({ expensePayment: new mongoose.Types.ObjectId(paymentId) })).toBe(1)
  })
})
