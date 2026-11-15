import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as types from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import ContractCharge from '../src/models/ContractCharge'
import MaintenanceExpense from '../src/models/MaintenanceExpense'
import Invoice from '../src/models/Invoice'
import Quote from '../src/models/Quote'

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
const post = (token: string, url: string, body: unknown) => request(app).post(url).set(env.X_ACCESS_TOKEN, token).send(body)

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

const makePostedRent = async (booking: env.Booking, amount: number, date: Date) => {
  const payment = await new RentalPayment({
    supplier: supplier._id, booking: booking._id, date, amount,
    currency: env.BASE_CURRENCY, method: types.RentalPaymentMethod.Cash,
    purpose: types.RentalPaymentPurpose.Rent, direction: types.RentalPaymentDirection.Credit,
    source: types.RentalPaymentSource.Manual, status: types.RentalPaymentStatus.Posted,
    idempotencyKey: key('pay'),
  }).save()
  ids.push(payment._id)
  return payment
}

beforeAll(async () => {
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
    expect(res.body.metricDictionaryVersion).toBe('2026-11-16.1')
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
