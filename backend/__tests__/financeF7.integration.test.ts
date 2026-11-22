import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import * as types from ':bookcars-types'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import ContractCharge from '../src/models/ContractCharge'
import MaintenanceExpense from '../src/models/MaintenanceExpense'
import MaintenanceExpensePayment from '../src/models/MaintenanceExpensePayment'
import MaintenanceExpenseAudit from '../src/models/MaintenanceExpenseAudit'
import MaintenanceWorkOrder from '../src/models/MaintenanceWorkOrder'
import MaintenanceSchedule from '../src/models/MaintenanceSchedule'
import ReportView from '../src/models/ReportView'
import CashMovement from '../src/models/CashMovement'
import CashSession from '../src/models/CashSession'
import Invoice from '../src/models/Invoice'
import Quote from '../src/models/Quote'

jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: jest.fn(async () => ({})),
}))

let app: any

// F7 — INVOICES / REPORTS / MAINTENANCE (W3 B-2, B-3, B-4, B-5, R-2,
// R-5, R-7, M-2, M-4, M-5, M-7). Mongo-backed, one supplier agency; the
// supplier user acts as Owner (all agency permissions). Fixtures are
// synthetic and removed by exact ID in afterAll. Tests run in file
// order; the R-2/R-7 sections run first because the B-3 section creates
// invoices (which would move the summary's invoiceCount, not asserted
// there, but kept out of the way anyway). The B-3 bookings live in
// December 2026, outside the November summary/builder window, so they
// cannot move the R-2/R-7 figures.

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let keyCounter = 0
const key = (prefix: string) => `f7-${prefix}-${suffix}-${keyCounter++}`

let supplier: env.User
let ownerToken: string
let car: env.Car
let bookingA: env.Booking
let bookingB: env.Booking
let bookingC: env.Booking
let bookingD: env.Booking
let bookingE: env.Booking
let bookingF: env.Booking
let bookingG: env.Booking
const ids: mongoose.Types.ObjectId[] = []
const invoiceIds: mongoose.Types.ObjectId[] = []
const quoteIds: mongoose.Types.ObjectId[] = []

const get = (token: string, url: string) => request(app).get(url).set(env.X_ACCESS_TOKEN, token)
const post = (token: string, url: string, body: unknown) => request(app).post(url).set(env.X_ACCESS_TOKEN, token).send(body as object)
const put = (token: string, url: string, body: unknown) => request(app).put(url).set(env.X_ACCESS_TOKEN, token).send(body as object)
const del = (token: string, url: string, body?: unknown) => request(app).delete(url).set(env.X_ACCESS_TOKEN, token).send(body as object)

const utc = (s: string) => new Date(`${s}Z`)

const snapshot = (rentalTotal: number, depositAmount: number) => ({
  version: 1,
  baseCurrency: env.BASE_CURRENCY,
  paymentCurrency: env.BASE_CURRENCY,
  mode: types.CheckoutPaymentMode.Deposit,
  rentalTotal,
  depositAmount,
  amountDueNow: rentalTotal,
  amountDueNowInPaymentCurrency: rentalTotal,
  quotedAt: new Date(),
})

const makeCar = async () => {
  const row = await new Car({
    name: 'F7 Fixture Car', supplier: supplier._id, minimumAge: 21,
    locations: [new mongoose.Types.ObjectId()], dailyPrice: 100, deposit: 200,
    available: true, type: types.CarType.Diesel, gearbox: types.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: types.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: types.CarRange.Midi, multimedia: [], rating: 5,
  }).save()
  ids.push(row._id)
  return row
}

const makeBooking = async (from: Date, to: Date, price: number, snap: ReturnType<typeof snapshot> | null) => {
  const booking = await new Booking({
    supplier: supplier._id, car: car._id, driver: new mongoose.Types.ObjectId(),
    pickupLocation: new mongoose.Types.ObjectId(), dropOffLocation: new mongoose.Types.ObjectId(),
    from, to, status: types.BookingStatus.Reserved,
    price, lifecycle: types.ContractLifecycle.Confirmed,
    cancellation: false, amendments: false, theftProtection: false,
    collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
    ...(snap ? { financialSnapshot: snap } : {}),
  }).save()
  ids.push(booking._id)
  return booking
}

const makePostedRent = async (booking: env.Booking, amount: number, date: Date, status: types.RentalPaymentStatus = types.RentalPaymentStatus.Posted) => {
  const payment = await new RentalPayment({
    supplier: supplier._id, booking: booking._id, date, amount,
    currency: env.BASE_CURRENCY, method: types.RentalPaymentMethod.Cash,
    purpose: types.RentalPaymentPurpose.Rent, direction: types.RentalPaymentDirection.Credit,
    source: types.RentalPaymentSource.Manual, status,
    idempotencyKey: key('pay'),
  }).save()
  ids.push(payment._id)
  return payment
}

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  supplier = await new User({
    email: `f7-${suffix}@test.bookcars.ma`, fullName: 'F7 Fixture', language: 'en',
    type: types.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
    // B-3: VAT enabled at the Moroccan standard rate, so a create
    // without an explicit tax computes 20%.
    vatEnabled: true, vatRate: 20,
  }).save()
  ids.push(supplier._id)
  ownerToken = await authHelper.encryptJWT({ id: supplier._id.toString() })
  car = await makeCar()

  // Booking A: rent 700, one approved charge of 50, 300 posted rent
  // inside the window (Nov 10) and 999 posted rent OUTSIDE it (Nov 20).
  bookingA = await makeBooking(utc('2026-11-11T10:00:00.000'), utc('2026-11-13T10:00:00.000'), 700, snapshot(700, 0))
  await makePostedRent(bookingA, 300, utc('2026-11-10T12:00:00.000'))
  await makePostedRent(bookingA, 999, utc('2026-11-20T08:00:00.000'))
  await new ContractCharge({
    supplier: supplier._id, booking: bookingA._id, type: types.ContractChargeType.Fee,
    reason: 'F7 test charge', amount: 50, currency: env.BASE_CURRENCY,
    status: types.ApprovalDecision.Approved,
  }).save()
  // Booking B: rent 400, nothing paid, nothing charged.
  bookingB = await makeBooking(utc('2026-11-18T10:00:00.000'), utc('2026-11-25T10:00:00.000'), 400, snapshot(400, 0))

  // Expenses in the window: 50 with 30 paid, 25.5 untracked.
  await new MaintenanceExpense({ supplier: supplier._id, car: car._id, date: utc('2026-11-13T09:00:00.000'), type: types.MaintenanceExpenseType.Repair, amount: 50, paidAmount: 30, vendor: 'F7 Fixture' }).save()
  await new MaintenanceExpense({ supplier: supplier._id, car: car._id, date: utc('2026-11-14T09:00:00.000'), type: types.MaintenanceExpenseType.Repair, amount: 25.5, vendor: 'F7 Fixture' }).save()

  // B-3 bookings: December, outside the November window.
  bookingC = await makeBooking(utc('2026-12-02T10:00:00.000'), utc('2026-12-04T10:00:00.000'), 500, snapshot(500, 0))
  bookingD = await makeBooking(utc('2026-12-05T10:00:00.000'), utc('2026-12-07T10:00:00.000'), 500, snapshot(500, 0))
  bookingE = await makeBooking(utc('2026-12-08T10:00:00.000'), utc('2026-12-10T10:00:00.000'), 500, snapshot(500, 0))
  bookingF = await makeBooking(utc('2026-12-11T10:00:00.000'), utc('2026-12-13T10:00:00.000'), 500, snapshot(500, 0))
  bookingG = await makeBooking(utc('2026-12-14T10:00:00.000'), utc('2026-12-16T10:00:00.000'), 500, snapshot(500, 0))
})

afterAll(async () => {
  await RentalPayment.deleteMany({ idempotencyKey: { $regex: `^f7-.*-${suffix}$` } })
  await ContractCharge.deleteMany({ supplier: supplier._id })
  await MaintenanceExpensePayment.deleteMany({ supplier: supplier._id })
  await MaintenanceExpenseAudit.deleteMany({ supplier: supplier._id })
  await MaintenanceWorkOrder.deleteMany({ supplier: supplier._id })
  await MaintenanceSchedule.deleteMany({ supplier: supplier._id })
  await ReportView.deleteMany({ supplier: supplier._id })
  await CashMovement.deleteMany({ supplier: supplier._id })
  await CashSession.deleteMany({ supplier: supplier._id })
  await MaintenanceExpense.deleteMany({ supplier: supplier._id })
  await Invoice.deleteMany({ _id: { $in: invoiceIds } })
  await Quote.deleteMany({ _id: { $in: quoteIds } })
  await Booking.deleteMany({ _id: { $in: ids } })
  await Car.deleteMany({ _id: { $in: ids } })
  await User.deleteMany({ _id: { $in: ids } })
  await databaseHelper.close()
})

describe('F7 / W3 R-2 — summary receivable is the shared definition', () => {
  it('counts out-of-period payments and approved charges; keeps the old figure as periodReceivable', async () => {
    const res = await get(ownerToken, '/api/reports/summary?from=2026-11-10&to=2026-11-19')
    expect(res.status).toBe(200)
    expect(res.body.metricDictionaryVersion).toBe('2026-11-16.2')
    const m = res.body.metrics
    // Booking A: max(0, 700 + 50 - (300 + 999)) = 0 — the Nov 20
    // payment counts even though it falls outside the window, and the
    // approved 50 charge counts. Booking B: 400 - 0 = 400.
    expect(m.receivable).toBe(400)
    // Legacy period-dated figure: (700 + 400) - 300 in-period rent.
    expect(m.periodReceivable).toBe(800)
    expect(m.revenueCollected).toBe(300)
  })
})

describe('F7 / W3 R-7 — net/margin on one cash basis', () => {
  it('summary: estimatedMargin is collected minus paidExpenses; accruedMargin keeps the old figure', async () => {
    const res = await get(ownerToken, '/api/reports/summary?from=2026-11-10&to=2026-11-19')
    expect(res.status).toBe(200)
    const m = res.body.metrics
    expect(m.expenses).toBe(75.5)
    expect(m.paidExpenses).toBe(30)
    expect(m.untrackedExpenses).toBe(1)
    expect(m.untrackedExpenseAmount).toBe(25.5)
    // Cash basis: 300 collected - 30 paid = 270. Accrual: 300 - 75.5.
    expect(m.estimatedMargin).toBe(270)
    expect(m.accruedMargin).toBe(224.5)
  })

  it('builder: net is cash-basis, netAccrued keeps the old figure, remaining matches the summary receivable', async () => {
    const res = await get(ownerToken, '/api/reports/builder?from=2026-11-10&to=2026-11-19&groupBy=car')
    expect(res.status).toBe(200)
    const t = res.body.totals
    expect(t.contractAmount).toBe(1150)
    // All-dates posted rent: 300 + 999 on booking A.
    expect(t.collected).toBe(1299)
    expect(t.remaining).toBe(400)
    expect(t.expenses).toBe(75.5)
    expect(t.paidExpenses).toBe(30)
    expect(t.net).toBe(1269)
    expect(t.netAccrued).toBe(1223.5)
    expect(t.untrackedExpenses).toBe(1)
    expect(t.untrackedExpenseAmount).toBe(25.5)
  })

  it('builder CSV carries the paidExpenses / netAccrued columns', async () => {
    const res = await get(ownerToken, '/api/reports/builder.csv?from=2026-11-10&to=2026-11-19&groupBy=car')
    expect(res.status).toBe(200)
    expect(res.text).toContain('paidExpenses')
    expect(res.text).toContain('netAccrued')
  })

  it('expense category report splits paid from accrued per category', async () => {
    const res = await get(ownerToken, '/api/maintenance-expenses/report?from=2026-11-01&to=2026-11-30')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(75.5)
    expect(res.body.paidTotal).toBe(30)
    expect(res.body.untrackedCount).toBe(1)
    const repair = (res.body.categories as Array<{ category: string, total: number, paidTotal: number, untracked: number }>)
      .find((c) => c.category === types.MaintenanceExpenseType.Repair)
    expect(repair?.total).toBe(75.5)
    expect(repair?.paidTotal).toBe(30)
    expect(repair?.untracked).toBe(1)
  })
})

describe('F7 / W3 B-3 — explicit tax override validation (validation only)', () => {
  it('refuses a boolean, negative, over-subtotal and non-numeric override', async () => {
    for (const taxAmount of [true, -5, 600, 'abc']) {
      const res = await post(ownerToken, '/api/invoices', { booking: bookingC._id.toString(), taxAmount })
      expect(res.status).toBe(400)
    }
    // No invoice was created by any refused override.
    const rows = await Invoice.find({ booking: bookingC._id })
    expect(rows).toHaveLength(0)
  })

  it('accepts a zero override and records it as an override', async () => {
    const res = await post(ownerToken, '/api/invoices', { booking: bookingC._id.toString(), taxAmount: 0 })
    expect(res.status).toBe(201)
    expect(res.body.taxAmount).toBe(0)
    expect(res.body.total).toBe(500)
    expect(res.body.taxOverride).toBe(true)
    invoiceIds.push(res.body._id)
  })

  it('treats a blank override as absent and computes the agency VAT rate', async () => {
    const res = await post(ownerToken, '/api/invoices', { booking: bookingD._id.toString(), taxAmount: '' })
    expect(res.status).toBe(201)
    expect(res.body.taxAmount).toBe(100)
    expect(res.body.taxRate).toBe(20)
    expect(res.body.taxOverride).toBe(false)
    invoiceIds.push(res.body._id)
  })

  it('accepts a valid manual override and records it as an override', async () => {
    const res = await post(ownerToken, '/api/invoices', { booking: bookingE._id.toString(), taxAmount: 50 })
    expect(res.status).toBe(201)
    expect(res.body.taxAmount).toBe(50)
    expect(res.body.total).toBe(550)
    expect(res.body.taxOverride).toBe(true)
    invoiceIds.push(res.body._id)
  })

  it('refuses a quote conversion whose tax does not match its tax rate', async () => {
    const quote = await new Quote({
      supplier: supplier._id, booking: bookingF._id, status: types.QuoteStatus.Accepted,
      currency: env.BASE_CURRENCY, subtotal: 500, taxAmount: 50, taxRate: 20, total: 550,
    }).save()
    quoteIds.push(quote._id)
    const res = await post(ownerToken, `/api/quotes/${quote._id.toString()}/convert`, {})
    expect(res.status).toBe(400)
    expect(await Invoice.findOne({ booking: bookingF._id })).toBeNull()
  })

  it('converts a quote whose tax matches its tax rate, verbatim', async () => {
    const quote = await new Quote({
      supplier: supplier._id, booking: bookingG._id, status: types.QuoteStatus.Accepted,
      currency: env.BASE_CURRENCY, subtotal: 500, taxAmount: 100, taxRate: 20, total: 600,
    }).save()
    quoteIds.push(quote._id)
    const res = await post(ownerToken, `/api/quotes/${quote._id.toString()}/convert`, {})
    expect(res.status).toBe(201)
    expect(res.body.invoice.taxAmount).toBe(100)
    expect(res.body.invoice.taxRate).toBe(20)
    expect(res.body.invoice.taxOverride).toBe(true)
    invoiceIds.push(res.body.invoice._id)
  })
})

// The M-2/M-5/M-7 sections run last and use December fixtures, so they
// cannot move the November R-2/R-7 figures above.
describe('F7 / W3 M-2 — paidAmount is backed by payment records', () => {
  let expenseId: string
  let sessionId: string

  it('refuses a typed-in paidAmount on create', async () => {
    const res = await post(ownerToken, '/api/maintenance-expenses', {
      car: car._id.toString(), date: '2026-12-10T09:00:00.000Z', type: types.MaintenanceExpenseType.Repair,
      amount: 100, paidAmount: 30, vendor: 'F7 M2',
    })
    expect(res.status).toBe(400)
    expect(res.text).toContain('payment endpoint')
  })

  it('creates the expense untracked, then records a cash payment linked to the open session', async () => {
    const created = await post(ownerToken, '/api/maintenance-expenses', {
      car: car._id.toString(), date: '2026-12-10T09:00:00.000Z', type: types.MaintenanceExpenseType.Repair,
      amount: 100, vendor: 'F7 M2',
    })
    expect(created.status).toBe(201)
    expect(created.body.paidAmount).toBeNull()
    expenseId = created.body._id

    const session = await post(ownerToken, '/api/cash/sessions', { account: types.CashAccountType.Cash, openingBalance: 100, openingDifferenceReason: 'F7 fixture' })
    expect(session.status).toBe(201)
    sessionId = session.body._id

    const paid = await post(ownerToken, `/api/maintenance-expenses/${expenseId}/payments`, {
      date: '2026-12-11T09:00:00.000Z', amount: 30, method: types.RentalPaymentMethod.Cash, reference: 'F7-M2-CASH',
    })
    expect(paid.status).toBe(201)
    expect(paid.body.payment.amount).toBe(30)
    expect(paid.body.payment.currency).toBe(env.BASE_CURRENCY.toUpperCase())
    expect(paid.body.payment.cashMovement).toBeTruthy()
    expect(paid.body.expense.paidAmount).toBe(30)
    expect(paid.body.expense.paymentStatus).toBe(types.MaintenanceExpensePaymentStatus.Partial)

    const movement = await CashMovement.findOne({ expensePayment: paid.body.payment._id })
    expect(movement).not.toBeNull()
    expect(movement?.direction).toBe(types.CashMovementDirection.Out)
    expect(movement?.amount).toBe(30)
    expect(movement?.status).toBe('confirmed')
    expect(movement?.source).toBe(types.CashMovementSource.ExpensePayment)
    expect(movement?.session.toString()).toBe(sessionId)
  })

  it('records a bank payment unlinked, recomputes paidAmount, and lists both payments', async () => {
    const paid = await post(ownerToken, `/api/maintenance-expenses/${expenseId}/payments`, {
      date: '2026-12-12T09:00:00.000Z', amount: 25.5, method: types.RentalPaymentMethod.BankTransfer,
    })
    expect(paid.status).toBe(201)
    expect(paid.body.payment.cashMovement).toBeUndefined()
    expect(paid.body.expense.paidAmount).toBe(55.5)
    expect(await CashMovement.countDocuments({ supplier: supplier._id, source: types.CashMovementSource.ExpensePayment })).toBe(1)

    const list = await get(ownerToken, `/api/maintenance-expenses/${expenseId}/payments`)
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(2)
  })

  it('refuses a typed-in paidAmount on update, and never lets an update wipe a backed paidAmount', async () => {
    const bad = await put(ownerToken, `/api/maintenance-expenses/${expenseId}`, {
      car: car._id.toString(), date: '2026-12-10T09:00:00.000Z', type: types.MaintenanceExpenseType.Repair,
      amount: 100, paidAmount: 99, vendor: 'F7 M2',
    })
    expect(bad.status).toBe(400)

    const nulled = await put(ownerToken, `/api/maintenance-expenses/${expenseId}`, {
      car: car._id.toString(), date: '2026-12-10T09:00:00.000Z', type: types.MaintenanceExpenseType.Repair,
      amount: 100, paidAmount: null, vendor: 'F7 M2',
    })
    expect(nulled.status).toBe(200)
    expect(nulled.body.paidAmount).toBe(55.5)
  })

  it('refuses an invalid payment (zero amount, bad method)', async () => {
    for (const body of [
      { date: '2026-12-13T09:00:00.000Z', amount: 0, method: types.RentalPaymentMethod.Cash },
      { date: '2026-12-13T09:00:00.000Z', amount: 10, method: 'cheque' },
    ]) {
      const res = await post(ownerToken, `/api/maintenance-expenses/${expenseId}/payments`, body)
      expect(res.status).toBe(400)
    }
  })
})

describe('F7 / W3 M-5 — work orders have an admin surface and link expenses', () => {
  let workOrderId: string
  let otherCarId: string
  let expenseId: string

  it('creates a work order; the list carries zero linked-expense totals', async () => {
    const otherCar = await makeCar()
    otherCarId = otherCar._id.toString()
    const created = await post(ownerToken, '/api/maintenance-work-orders', {
      car: car._id.toString(), title: 'F7 M5 brake job', type: types.MaintenanceExpenseType.Repair,
      status: types.WorkOrderStatus.Scheduled,
      scheduledStart: '2026-12-15T08:00:00.000Z', scheduledEnd: '2026-12-15T12:00:00.000Z',
    })
    expect(created.status).toBe(201)
    workOrderId = created.body._id

    const list = await get(ownerToken, '/api/maintenance-work-orders')
    expect(list.status).toBe(200)
    const row = (list.body as Array<{ _id: string, expenseTotal: number, expenseCount: number }>)
      .find((r) => r._id === workOrderId)
    expect(row?.expenseTotal).toBe(0)
    expect(row?.expenseCount).toBe(0)
  })

  it('links an expense to the work order and the list totals follow', async () => {
    const created = await post(ownerToken, '/api/maintenance-expenses', {
      car: car._id.toString(), workOrder: workOrderId, date: '2026-12-16T09:00:00.000Z',
      type: types.MaintenanceExpenseType.Repair, amount: 80, vendor: 'F7 M5',
    })
    expect(created.status).toBe(201)
    expect(created.body.workOrder?.title).toBe('F7 M5 brake job')
    expenseId = created.body._id

    const list = await get(ownerToken, '/api/maintenance-work-orders')
    const row = (list.body as Array<{ _id: string, expenseTotal: number, expenseCount: number }>)
      .find((r) => r._id === workOrderId)
    expect(row?.expenseTotal).toBe(80)
    expect(row?.expenseCount).toBe(1)
  })

  it('refuses a work order from another car, and a work order that does not exist', async () => {
    const wrongCar = await post(ownerToken, '/api/maintenance-expenses', {
      car: otherCarId, workOrder: workOrderId, date: '2026-12-16T09:00:00.000Z',
      type: types.MaintenanceExpenseType.Repair, amount: 10, vendor: 'F7 M5',
    })
    expect(wrongCar.status).toBe(400)
    const missing = await post(ownerToken, '/api/maintenance-expenses', {
      car: car._id.toString(), workOrder: new mongoose.Types.ObjectId().toString(), date: '2026-12-16T09:00:00.000Z',
      type: types.MaintenanceExpenseType.Repair, amount: 10, vendor: 'F7 M5',
    })
    expect(missing.status).toBe(400)
  })

  it('unlinks the expense; the work-order totals drop back to zero', async () => {
    const updated = await put(ownerToken, `/api/maintenance-expenses/${expenseId}`, {
      car: car._id.toString(), workOrder: null, date: '2026-12-16T09:00:00.000Z',
      type: types.MaintenanceExpenseType.Repair, amount: 80, vendor: 'F7 M5',
    })
    expect(updated.status).toBe(200)
    expect(updated.body.workOrder).toBeNull()

    const list = await get(ownerToken, '/api/maintenance-work-orders')
    const row = (list.body as Array<{ _id: string, expenseTotal: number, expenseCount: number }>)
      .find((r) => r._id === workOrderId)
    expect(row?.expenseTotal).toBe(0)
    expect(row?.expenseCount).toBe(0)
  })
})

describe('F7 / W3 M-7 — expense changes leave an append-only audit trail', () => {
  let expenseId: string

  it('audits creation, then an update with its field changes and reason', async () => {
    const created = await post(ownerToken, '/api/maintenance-expenses', {
      car: car._id.toString(), date: '2026-12-17T09:00:00.000Z', type: types.MaintenanceExpenseType.Repair,
      amount: 40, vendor: 'F7 M7 Vendor',
    })
    expect(created.status).toBe(201)
    expenseId = created.body._id

    const updated = await put(ownerToken, `/api/maintenance-expenses/${expenseId}`, {
      car: car._id.toString(), date: '2026-12-17T09:00:00.000Z', type: types.MaintenanceExpenseType.Repair,
      amount: 40, vendor: 'F7 M7 Vendor Fixed', reason: 'correct vendor name',
    })
    expect(updated.status).toBe(200)

    const audit = await get(ownerToken, `/api/maintenance-expenses/${expenseId}/audit`)
    expect(audit.status).toBe(200)
    expect(audit.body).toHaveLength(2)
    const updatedRow = (audit.body as Array<{ action: string, reason?: string, changes?: Array<{ field: string, before?: unknown, after?: unknown }> }>)
      .find((r) => r.action === types.MaintenanceExpenseAuditAction.Updated)
    expect(updatedRow?.reason).toBe('correct vendor name')
    expect(updatedRow?.changes).toContainEqual({ field: 'vendor', before: 'F7 M7 Vendor', after: 'F7 M7 Vendor Fixed' })
  })

  it('refuses a delete without a reason, and with a reason shorter than 3 characters', async () => {
    expect((await del(ownerToken, `/api/maintenance-expenses/${expenseId}`)).status).toBe(400)
    expect((await del(ownerToken, `/api/maintenance-expenses/${expenseId}`, { reason: 'du' })).status).toBe(400)
    expect(await MaintenanceExpense.findById(expenseId)).not.toBeNull()
  })

  it('deletes with a recorded reason, and the trail survives the delete', async () => {
    const res = await del(ownerToken, `/api/maintenance-expenses/${expenseId}`, { reason: 'duplicate entry' })
    expect(res.status).toBe(200)
    expect(await MaintenanceExpense.findById(expenseId)).toBeNull()

    const audit = await get(ownerToken, `/api/maintenance-expenses/${expenseId}/audit`)
    expect(audit.status).toBe(200)
    expect(audit.body).toHaveLength(3)
    const deletedRow = (audit.body as Array<{ action: string, reason?: string }>)
      .find((r) => r.action === types.MaintenanceExpenseAuditAction.Deleted)
    expect(deletedRow?.reason).toBe('duplicate entry')
  })
})

// The B-2/B-4/B-5, R-5 and M-4 sections run last; their fixtures are
// December (or their own cars), so they cannot move the November
// R-2/R-7 figures above.
describe('F7 / W3 B-5 + B-4 + B-2 — link only Posted, record deliveries, void clears paid state', () => {
  let bookingH: env.Booking
  let invoiceId: string
  let postedPaymentId: string
  let pendingPaymentId: string

  it('issues an invoice and refuses to link a Pending payment', async () => {
    bookingH = await makeBooking(utc('2026-12-18T10:00:00.000'), utc('2026-12-20T10:00:00.000'), 500, snapshot(500, 0))
    const created = await post(ownerToken, '/api/invoices', { booking: bookingH._id.toString() })
    expect(created.status).toBe(201)
    invoiceId = created.body._id
    const issued = await post(ownerToken, `/api/invoices/${invoiceId}/issue`, {})
    expect(issued.status).toBe(200)
    expect(issued.body.status).toBe(types.InvoiceStatus.Issued)

    const posted = await makePostedRent(bookingH, 200, utc('2026-12-10T12:00:00.000'))
    postedPaymentId = posted._id.toString()
    const pending = await makePostedRent(bookingH, 100, utc('2026-12-11T12:00:00.000'), types.RentalPaymentStatus.Pending)
    pendingPaymentId = pending._id.toString()

    const refused = await post(ownerToken, `/api/invoices/${invoiceId}/payments`, { payment: pendingPaymentId })
    expect(refused.status).toBe(409)
    expect(refused.text).toContain('posted')
  })

  it('links the Posted payment, records deliveries, and refuses a bad channel', async () => {
    const linked = await post(ownerToken, `/api/invoices/${invoiceId}/payments`, { payment: postedPaymentId })
    expect(linked.status).toBe(200)
    expect(linked.body.paidAmount).toBe(200)
    expect(linked.body.paymentStatus).toBe('partial')

    const printed = await post(ownerToken, `/api/invoices/${invoiceId}/deliveries`, { channel: types.InvoiceDeliveryChannel.Print })
    expect(printed.status).toBe(200)
    expect(printed.body.deliveries).toHaveLength(1)
    expect(printed.body.deliveries[0].channel).toBe('print')
    const shared = await post(ownerToken, `/api/invoices/${invoiceId}/deliveries`, { channel: types.InvoiceDeliveryChannel.Whatsapp })
    expect(shared.status).toBe(200)
    expect(shared.body.deliveries).toHaveLength(2)
    expect(shared.body.deliveries[1].channel).toBe('whatsapp')

    expect((await post(ownerToken, `/api/invoices/${invoiceId}/deliveries`, { channel: 'pigeon' })).status).toBe(400)
  })

  it('refuses an unlink without a reason, then unlinks with a logged reason', async () => {
    expect((await post(ownerToken, `/api/invoices/${invoiceId}/payments/unlink`, { payment: postedPaymentId })).status).toBe(400)
    expect((await post(ownerToken, `/api/invoices/${invoiceId}/payments/unlink`, { payment: postedPaymentId, reason: 'no' })).status).toBe(400)

    const unlinked = await post(ownerToken, `/api/invoices/${invoiceId}/payments/unlink`, { payment: postedPaymentId, reason: 'wrong payment linked' })
    expect(unlinked.status).toBe(200)
    expect(unlinked.body.paidAmount).toBe(0)
    expect(unlinked.body.paymentStatus).toBe('unpaid')
    expect(unlinked.body.payments).toHaveLength(0)
    expect(unlinked.body.unlinkLog).toHaveLength(1)
    expect(unlinked.body.unlinkLog[0].reason).toBe('wrong payment linked')

    // The same payment is no longer linked, so a second unlink 409s.
    expect((await post(ownerToken, `/api/invoices/${invoiceId}/payments/unlink`, { payment: postedPaymentId, reason: 'again' })).status).toBe(409)
  })

  it('voiding snapshots the paid state, then clears it', async () => {
    const relinked = await post(ownerToken, `/api/invoices/${invoiceId}/payments`, { payment: postedPaymentId })
    expect(relinked.status).toBe(200)
    expect(relinked.body.paidAmount).toBe(200)

    const voided = await post(ownerToken, `/api/invoices/${invoiceId}/void`, { reason: 'client cancelled' })
    expect(voided.status).toBe(200)
    expect(voided.body.status).toBe(types.InvoiceStatus.Voided)
    expect(voided.body.paidAmount).toBe(0)
    expect(voided.body.paymentStatus).toBe('unpaid')
    expect(voided.body.payments).toHaveLength(0)
    expect(voided.body.voidedPaidAmount).toBe(200)
    expect(voided.body.voidedPaymentStatus).toBe('partial')
  })
})

describe('F7 / W3 R-5 — drilldown and saved views keep the cash/bank scope', () => {
  it('drilldown filters its payment list by scope and reports the scope', async () => {
    // A bank payment on booking B, inside the November window: it must
    // appear under scope all/bank and never under scope cash.
    await new RentalPayment({
      supplier: supplier._id, booking: bookingB._id, date: utc('2026-11-12T12:00:00.000'), amount: 100,
      currency: env.BASE_CURRENCY, method: types.RentalPaymentMethod.BankTransfer,
      purpose: types.RentalPaymentPurpose.Rent, direction: types.RentalPaymentDirection.Credit,
      source: types.RentalPaymentSource.Manual, status: types.RentalPaymentStatus.Posted,
      idempotencyKey: key('pay'),
    }).save()

    const all = await get(ownerToken, '/api/reports/drilldown?from=2026-11-10&to=2026-11-19&groupBy=car')
    expect(all.status).toBe(200)
    expect(all.body.scope).toBe('all')
    // Booking A: 300 + 999 cash; booking B: 100 bank.
    expect(all.body.payments).toHaveLength(3)

    const cash = await get(ownerToken, '/api/reports/drilldown?from=2026-11-10&to=2026-11-19&groupBy=car&scope=cash')
    expect(cash.status).toBe(200)
    expect(cash.body.scope).toBe('cash')
    expect(cash.body.payments).toHaveLength(2)

    const bank = await get(ownerToken, '/api/reports/drilldown?from=2026-11-10&to=2026-11-19&groupBy=car&scope=bank')
    expect(bank.status).toBe(200)
    expect(bank.body.scope).toBe('bank')
    expect(bank.body.payments).toHaveLength(1)
    expect(bank.body.payments[0].amount).toBe(100)
  })

  it('saved views store the scope; a view without one defaults to all', async () => {
    const saved = await post(ownerToken, '/api/reports/views', {
      name: 'F7 cash view', config: { groupBy: 'car', compare: false, scope: 'cash' },
    })
    expect(saved.status).toBe(201)
    expect(saved.body.config.scope).toBe('cash')

    const bad = await post(ownerToken, '/api/reports/views', {
      name: 'F7 bad view', config: { groupBy: 'car', compare: false, scope: 'bogus' },
    })
    expect(bad.status).toBe(400)

    const plain = await post(ownerToken, '/api/reports/views', {
      name: 'F7 plain view', config: { groupBy: 'car', compare: false },
    })
    expect(plain.status).toBe(201)
    expect(plain.body.config.scope).toBe('all')

    const listed = await get(ownerToken, '/api/reports/views')
    expect(listed.status).toBe(200)
    const cashView = (listed.body as Array<{ name: string, config: { scope?: string } }>)
      .find((v) => v.name === 'F7 cash view')
    expect(cashView?.config.scope).toBe('cash')
  })
})

describe('F7 / W3 M-4 — mileage-aware due status blocks booking', () => {
  let m4car: env.Car
  let m4driver: env.User
  let m4location: mongoose.Types.ObjectId
  let scheduleId: string
  let bookingId: string

  // Wave 2.5 — a reserving booking via staff create() is gone
  // (Reserved closed); the overdue-schedule guard is exercised through
  // the public checkout pay-later hold (Pending + 48h expireAt reserves
  // the car).
  const bookingPayload = (from: string, to: string) => ({
    booking: {
      supplier: supplier._id.toString(), car: m4car._id.toString(), driver: m4driver._id.toString(),
      pickupLocation: m4location.toString(), dropOffLocation: m4location.toString(),
      from, to, price: 300, status: types.BookingStatus.Pending,
      cancellation: false, amendments: false, theftProtection: false,
      collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
    },
    paymentMode: types.CheckoutPaymentMode.PayLater,
    currency: 'MAD',
    paymentGateway: types.PaymentGateway.Stripe,
    payLater: true,
  })

  it('flags a schedule overdue by mileage even though its due date is far away', async () => {
    m4car = await makeCar()
    m4location = (m4car.locations as mongoose.Types.ObjectId[])[0]
    m4driver = await new User({
      email: `f7-m4-${suffix}@test.bookcars.ma`, fullName: 'F7 M4 Driver', language: 'en',
      type: types.UserType.User, active: true, verified: true, blacklisted: false,
    }).save()
    ids.push(m4driver._id)
    // Odometer 51,000 km; the schedule below falls due at 50,000 km.
    await Car.findByIdAndUpdate(m4car._id, { odometerKm: 51000 })

    const created = await post(ownerToken, '/api/maintenance-schedules', {
      car: m4car._id.toString(), title: 'F7 M4 oil service', type: types.MaintenanceExpenseType.Oil,
      nextDueDate: '2027-06-01', intervalKm: 10000, lastServiceMileage: 40000,
    })
    expect(created.status).toBe(201)
    scheduleId = created.body._id
    expect(created.body.status).toBe(types.MaintenanceScheduleStatus.Overdue)
    expect(created.body.dueByMileage).toBe(true)
    expect(created.body.effectiveNextDueMileage).toBe(50000)

    const listed = await get(ownerToken, '/api/maintenance-schedules')
    const row = (listed.body as Array<{ _id: string, status: string, dueByMileage?: boolean, effectiveNextDueMileage?: number }>)
      .find((r) => r._id === scheduleId)
    expect(row?.status).toBe(types.MaintenanceScheduleStatus.Overdue)
    expect(row?.dueByMileage).toBe(true)
  })

  it('blocks a fresh booking on the car, naming the overdue schedule', async () => {
    const first = await post(ownerToken, '/api/checkout', bookingPayload('2026-12-21T10:00:00.000Z', '2026-12-23T10:00:00.000Z'))
    // No booking exists yet on this car — the first create is refused
    // by the overdue schedule, not by any overlap.
    expect(first.status).toBe(409)
    expect(first.text).toContain('F7 M4 oil service')
    expect(first.text).toContain('51000')
  })

  it('blocks a restore while the schedule is overdue, and allows it once the schedule is completed', async () => {
    // A booking created before the schedule went overdue: create it
    // with the schedule temporarily completed, then trash + restore.
    await put(ownerToken, `/api/maintenance-schedules/${scheduleId}`, {
      car: m4car._id.toString(), title: 'F7 M4 oil service', type: types.MaintenanceExpenseType.Oil,
      nextDueDate: '2027-06-01', intervalKm: 10000, lastServiceMileage: 40000,
      status: types.MaintenanceScheduleStatus.Completed,
    })
    const created = await post(ownerToken, '/api/checkout', bookingPayload('2026-12-21T10:00:00.000Z', '2026-12-23T10:00:00.000Z'))
    // Checkout answers 200 on success with { bookingId, ... }.
    expect(created.status).toBe(200)
    bookingId = created.body.bookingId
    // W3 leak fix: the M-4 checkout bookings were never registered for
    // cleanup, so they survived afterAll as overdue rows (200 each)
    // and broke the Admin overdue total of any suite running after
    // this file (dashboardF8). Register them in ids like every other
    // fixture in this file.
    ids.push(new mongoose.Types.ObjectId(bookingId))
    // Confirm the hold first: a pay-later checkout carries expireAt and
    // trash refuses temporary checkout bookings, so the booking must be
    // a real (confirmed) booking before it can be trashed.
    const confirmed = await post(ownerToken, `/api/bookings/${bookingId}/confirm-reservation`, {})
    expect(confirmed.status).toBe(200)

    // Reopen the schedule (status back to a derived one) so it is
    // overdue by mileage again.
    await put(ownerToken, `/api/maintenance-schedules/${scheduleId}`, {
      car: m4car._id.toString(), title: 'F7 M4 oil service', type: types.MaintenanceExpenseType.Oil,
      nextDueDate: '2027-06-01', intervalKm: 10000, lastServiceMileage: 40000,
      status: types.MaintenanceScheduleStatus.Upcoming,
    })
    const listed = await get(ownerToken, '/api/maintenance-schedules')
    const row = (listed.body as Array<{ _id: string, status: string }>)
      .find((r) => r._id === scheduleId)
    expect(row?.status).toBe(types.MaintenanceScheduleStatus.Overdue)

    const trashed = await post(ownerToken, '/api/trash-bookings', { ids: [bookingId], reason: 'F7 test trash' })
    expect(trashed.status).toBe(200)
    const blocked = await post(ownerToken, '/api/restore-bookings', { ids: [bookingId] })
    expect(blocked.status).toBe(409)
    expect(blocked.text).toContain('OVERDUE_MAINTENANCE')
    expect(blocked.text).toContain('F7 M4 oil service')

    await put(ownerToken, `/api/maintenance-schedules/${scheduleId}`, {
      car: m4car._id.toString(), title: 'F7 M4 oil service', type: types.MaintenanceExpenseType.Oil,
      nextDueDate: '2027-06-01', intervalKm: 10000, lastServiceMileage: 40000,
      status: types.MaintenanceScheduleStatus.Completed,
    })
    const restored = await post(ownerToken, '/api/restore-bookings', { ids: [bookingId] })
    expect(restored.status).toBe(200)

    const fresh = await post(ownerToken, '/api/checkout', bookingPayload('2026-12-28T10:00:00.000Z', '2026-12-30T10:00:00.000Z'))
    expect(fresh.status).toBe(200)
    ids.push(new mongoose.Types.ObjectId(fresh.body.bookingId))
  })
})
