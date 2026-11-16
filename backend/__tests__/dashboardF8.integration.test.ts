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
import Approval from '../src/models/Approval'
import AgencyMembership from '../src/models/AgencyMembership'
import NotificationDelivery from '../src/models/NotificationDelivery'
import Notification from '../src/models/Notification'
import Invoice from '../src/models/Invoice'
import MaintenanceSchedule from '../src/models/MaintenanceSchedule'
import Setting from '../src/models/Setting'
import BankDetails from '../src/models/BankDetails'
import { runAutoReminderPass } from '../src/utils/autoReminders'
import { renderNotificationTemplate } from '../src/utils/notificationTemplates'

// F8 — DASHBOARD / CALENDAR / SETTINGS / TEAM / NOTIFICATIONS
// (W5 D2, D3, C1–C3, S1–S5, A3, A5, A6, N2–N4, T4, I3, AU4, D4–D6,
// C5–C6). Mongo-backed. Two supplier agencies (A, B) + a platform
// Admin; the supplier users act as Owner (all agency permissions).
// Fixtures are synthetic, dated November 2026, and removed by exact
// ID in afterAll. Sections run in file order; the D2 fixtures live in
// the November summary window (Nov 10–19) and are shared by the
// later sections, so later sections must not move their amounts
// (they only read them, or create fixtures outside the window).
//
// NOTE on the Admin assertions: the all-agency dashboard aggregate
// sums EVERY Supplier user in the database, so the Admin expectations
// below are exact only on a clean test DB (single-suite run, the
// same assumption the F1 runner makes). Agency-scoped assertions
// are exact regardless.

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let keyCounter = 0
const key = (prefix: string) => `f8-${prefix}-${suffix}-${keyCounter++}`

let supplierA: env.User
let supplierB: env.User
let admin: env.User
let tokenA: string
let tokenB: string
let adminToken: string
let carA: env.Car
let carB: env.Car
let bookingA1: env.Booking
let bookingA2: env.Booking
let bookingB1: env.Booking
let bookingB2: env.Booking
const ids: mongoose.Types.ObjectId[] = []
const approvalIds: mongoose.Types.ObjectId[] = []
const membershipIds: mongoose.Types.ObjectId[] = []

const get = (token: string, url: string) => request(app).get(url).set(env.X_ACCESS_TOKEN, token)
const post = (token: string, url: string, body: unknown) => request(app).post(url).set(env.X_ACCESS_TOKEN, token).send(body)
const put = (token: string, url: string, body: unknown) => request(app).put(url).set(env.X_ACCESS_TOKEN, token).send(body)
const del = (token: string, url: string, body?: unknown) => request(app).delete(url).set(env.X_ACCESS_TOKEN, token).send(body)

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

const makeUser = async (label: string, type: types.UserType) => {
  const row = await new User({
    email: `f8-${label}-${suffix}@test.bookcars.ma`, fullName: `F8 Fixture ${label}`, language: 'en',
    type, active: true, verified: true, blacklisted: false, payLater: true,
  }).save()
  ids.push(row._id)
  return row
}

const makeStaff = async (label: string, role: types.AgencyRole, supplier: env.User) => {
  const staff = await new User({
    email: `f8-${label}-${suffix}@test.bookcars.ma`, fullName: `F8 Fixture ${label}`, language: 'en',
    type: types.UserType.Staff, active: true, verified: true, blacklisted: false,
    password: await authHelper.hashPassword('F8staff1'),
  }).save()
  ids.push(staff._id)
  const membership = await new AgencyMembership({
    supplier: supplier._id, user: staff._id, role,
    status: types.AgencyMembershipStatus.Active, activatedAt: new Date(),
  }).save()
  membershipIds.push(membership._id)
  const token = await authHelper.encryptJWT({ id: staff._id.toString() })
  return { staff, membership, token }
}

const makeCar = async (supplier: env.User, label: string, extra: Partial<env.Car> = {}) => {
  const row = await new Car({
    name: `F8 Fixture Car ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [new mongoose.Types.ObjectId()], dailyPrice: 100, deposit: 200,
    available: true, type: types.CarType.Diesel, gearbox: types.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: types.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: types.CarRange.Midi, multimedia: [], rating: 5,
    ...extra,
  }).save()
  ids.push(row._id)
  return row
}

const makeBooking = async (supplier: env.User, car: env.Car, from: Date, to: Date, price: number, snap: ReturnType<typeof snapshot> | null) => {
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

const makePostedRent = async (supplier: env.User, booking: env.Booking, amount: number, date: Date) => {
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
  supplierA = await makeUser('supplier-a', types.UserType.Supplier)
  supplierB = await makeUser('supplier-b', types.UserType.Supplier)
  admin = await makeUser('admin', types.UserType.Admin)
  tokenA = await authHelper.encryptJWT({ id: supplierA._id.toString() })
  tokenB = await authHelper.encryptJWT({ id: supplierB._id.toString() })
  adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })

  carA = await makeCar(supplierA, 'A')
  carB = await makeCar(supplierB, 'B')

  // Booking A1: rent 500 + approved charge 100, 200 posted rent.
  bookingA1 = await makeBooking(supplierA, carA, utc('2026-11-10T10:00:00.000'), utc('2026-11-12T10:00:00.000'), 500, snapshot(500, 0))
  await makePostedRent(supplierA, bookingA1, 200, utc('2026-11-10T12:00:00.000'))
  await new ContractCharge({
    supplier: supplierA._id, booking: bookingA1._id, type: types.ContractChargeType.Fee,
    reason: 'F8 test charge', amount: 100, currency: env.BASE_CURRENCY,
    status: types.ApprovalDecision.Approved,
  }).save()
  // Booking A2: rent 400, nothing paid — overdue (rental ended Nov 11).
  bookingA2 = await makeBooking(supplierA, carA, utc('2026-11-10T10:00:00.000'), utc('2026-11-11T10:00:00.000'), 400, snapshot(400, 0))
  // Booking B1: rent 300, paid in full — no outstanding, no overdue row.
  bookingB1 = await makeBooking(supplierB, carB, utc('2026-11-10T10:00:00.000'), utc('2026-11-12T10:00:00.000'), 300, snapshot(300, 0))
  await makePostedRent(supplierB, bookingB1, 300, utc('2026-11-10T12:00:00.000'))
  // Booking B2: rent 200, nothing paid — overdue (rental ended Nov 13).
  bookingB2 = await makeBooking(supplierB, carB, utc('2026-11-12T10:00:00.000'), utc('2026-11-13T10:00:00.000'), 200, snapshot(200, 0))
})

afterAll(async () => {
  await NotificationDelivery.deleteMany({ supplier: { $in: [supplierA._id, supplierB._id] } })
  // In-app rows go to owners AND their active staff, so the cleanup
  // covers every user id created by this file (staff included).
  await Notification.deleteMany({ user: { $in: ids } })
  await MaintenanceSchedule.deleteMany({ supplier: { $in: [supplierA._id, supplierB._id] } })
  await Approval.deleteMany({ _id: { $in: approvalIds } })
  await AgencyMembership.deleteMany({ _id: { $in: membershipIds } })
  await ContractCharge.deleteMany({ supplier: { $in: [supplierA._id, supplierB._id] } })
  await RentalPayment.deleteMany({ supplier: { $in: [supplierA._id, supplierB._id] } })
  await Invoice.deleteMany({ supplier: { $in: [supplierA._id, supplierB._id] } })
  await Booking.deleteMany({ _id: { $in: ids } })
  await Car.deleteMany({ _id: { $in: ids } })
  await User.deleteMany({ _id: { $in: ids } })
  await databaseHelper.close()
})

describe('F8 / W5 D2 — dashboard summary serves Admin and agency from the same definition', () => {
  const window = 'from=2026-11-10&to=2026-11-19'

  it('agency A sees its own exact figures, charges included', async () => {
    const res = await get(tokenA, `/api/dashboard/summary?${window}`)
    expect(res.status).toBe(200)
    expect(res.body.metricDictionaryVersion).toBe('2026-11-16.2')
    // A1: 500 + 100 charge, 200 collected → remaining 400. A2: 400, 0 → 400.
    expect(res.body.contractAmount).toBe(1000)
    expect(res.body.collected).toBe(200)
    expect(res.body.remaining).toBe(800)
    expect(res.body.contracts).toBe(2)
  })

  it('agency B sees only its own figures', async () => {
    const res = await get(tokenB, `/api/dashboard/summary?${window}`)
    expect(res.status).toBe(200)
    // B1: 300 paid in full. B2: 200 unpaid.
    expect(res.body.contractAmount).toBe(500)
    expect(res.body.collected).toBe(300)
    expect(res.body.remaining).toBe(200)
    expect(res.body.contracts).toBe(2)
  })

  it('Admin without a supplier gets the exact all-agency aggregate (sum of the agencies)', async () => {
    const res = await get(adminToken, `/api/dashboard/summary?${window}`)
    expect(res.status).toBe(200)
    expect(res.body.contractAmount).toBe(1500)
    expect(res.body.collected).toBe(500)
    expect(res.body.remaining).toBe(1000)
    expect(res.body.contracts).toBe(4)
  })

  it('Admin with ?supplier= gets that single agency', async () => {
    const res = await get(adminToken, `/api/dashboard/summary?${window}&supplier=${supplierA._id}`)
    expect(res.status).toBe(200)
    expect(res.body.contractAmount).toBe(1000)
    expect(res.body.collected).toBe(200)
    expect(res.body.remaining).toBe(800)
    expect(res.body.contracts).toBe(2)
  })

  it('overdue endpoint (shared definition) includes approved charges for the agency', async () => {
    const res = await get(tokenA, '/api/rental-payments/overdue')
    expect(res.status).toBe(200)
    // A1: max(0, 500 + 100 − 200) = 400 overdue; A2: 400 overdue.
    // The old rent-only table would have said 300 for A1.
    expect(res.body.outstandingTotal).toBe(800)
    expect(res.body.overdueTotal).toBe(800)
    const byBooking = new Map(res.body.rows.map((r: { booking: { _id: string }, outstandingBalance: number }) => [String(r.booking._id), r.outstandingBalance]))
    expect(byBooking.get(String(bookingA1._id))).toBe(400)
    expect(byBooking.get(String(bookingA2._id))).toBe(400)
    expect(res.body.rows.every((r: { overdue: boolean }) => r.overdue)).toBe(true)
  })

  it('overdue endpoint as Admin covers every agency', async () => {
    const res = await get(adminToken, '/api/rental-payments/overdue')
    expect(res.status).toBe(200)
    // A1 400 + A2 400 + B2 200; B1 paid in full is absent.
    expect(res.body.outstandingTotal).toBe(1000)
    expect(res.body.overdueTotal).toBe(1000)
    const idsInRows = res.body.rows.map((r: { booking: { _id: string } }) => String(r.booking._id))
    expect(idsInRows).toContain(String(bookingA1._id))
    expect(idsInRows).toContain(String(bookingA2._id))
    expect(idsInRows).toContain(String(bookingB2._id))
    expect(idsInRows).not.toContain(String(bookingB1._id))
  })
})

describe('F8 / W5 D3 — availability counts active bookings, not the flag', () => {
  const window = 'from=2026-11-10&to=2026-11-19'

  it('fleet block: an on-rent car is not available, a maintenance car is neither', async () => {
    // A live booking overlapping NOW (price 0, so the money figures in
    // the shared window do not move; only the fleet block is asserted).
    const now = Date.now()
    const carNow = await makeCar(supplierA, 'A-now')
    const bookingNow = await makeBooking(supplierA, carNow, new Date(now - 86400000), new Date(now + 86400000), 0, snapshot(0, 0))
    const carMaint = await makeCar(supplierA, 'A-maint', { operationalStatus: types.CarOperationalStatus.Maintenance })
    try {
      const res = await get(tokenA, `/api/dashboard/summary?${window}`)
      expect(res.status).toBe(200)
      // carA (available, its bookings ended Nov 12) + carNow (on rent)
      // + carMaint (maintenance): total 3, available 1, onRent 1.
      expect(res.body.fleet).toEqual({ total: 3, available: 1, onRent: 1 })

      const adminRes = await get(adminToken, `/api/dashboard/summary?${window}`)
      expect(adminRes.status).toBe(200)
      // + carB (available): total 4, available 2, onRent 1.
      expect(adminRes.body.fleet).toEqual({ total: 4, available: 2, onRent: 1 })
    } finally {
      await Booking.deleteOne({ _id: bookingNow._id })
      await Car.deleteMany({ _id: { $in: [carNow._id, carMaint._id] } })
    }
  })
})

describe('F8 / W5 A3 — requesters see their own approval requests, and only those', () => {
  let accountant: { staff: env.User, token: string }
  let counterAgent: { staff: env.User, token: string }

  beforeAll(async () => {
    accountant = await makeStaff('accountant', types.AgencyRole.Accountant, supplierA)
    counterAgent = await makeStaff('counter', types.AgencyRole.CounterAgent, supplierA)
    const own = await new Approval({
      supplier: supplierA._id, subject: String(bookingA1._id), subjectType: 'contract-charge',
      amount: 15000, currency: env.BASE_CURRENCY, status: types.ApprovalDecision.Pending,
      requestedBy: accountant.staff._id,
    }).save()
    approvalIds.push(own._id)
    const ownerRow = await new Approval({
      supplier: supplierA._id, subject: String(bookingA2._id), subjectType: 'contract-charge',
      amount: 5000, currency: env.BASE_CURRENCY, status: types.ApprovalDecision.Pending,
      requestedBy: supplierA._id,
    }).save()
    approvalIds.push(ownerRow._id)
  })

  it('an accountant sees only the request they filed', async () => {
    const res = await get(accountant.token, '/api/approvals')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(String(res.body[0].requestedBy)).toBe(String(accountant.staff._id))
  })

  it('a counter agent with no requests sees an empty queue (not a 403)', async () => {
    const res = await get(counterAgent.token, '/api/approvals')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(0)
  })

  it('the agency owner (decider) still sees the whole queue', async () => {
    const res = await get(tokenA, '/api/approvals')
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThanOrEqual(2)
  })

  it('seeing is not deciding: the requester cannot decide their own request', async () => {
    const list = await get(accountant.token, '/api/approvals')
    const own = list.body[0]
    const res = await post(accountant.token, `/api/approvals/${own._id}/decide`, { decision: 'approved' })
    expect(res.status).toBe(403)
  })
})

describe('F8 / W5 A5 — queue subjects navigate; manual create uses a typed subject', () => {
  let charge: env.ContractCharge
  let invoice: env.Invoice

  beforeAll(async () => {
    charge = await new ContractCharge({
      supplier: supplierA._id, booking: bookingA2._id, type: types.ContractChargeType.Fee,
      reason: 'F8 A5 charge', amount: 50, currency: env.BASE_CURRENCY,
      status: types.ApprovalDecision.Approved,
    }).save()
    invoice = await new Invoice({
      supplier: supplierA._id, booking: bookingA2._id, status: types.InvoiceStatus.Draft,
      currency: env.BASE_CURRENCY, subtotal: 400, taxAmount: 0, total: 400,
      paidAmount: 0, paymentStatus: 'unpaid',
    }).save()
  })

  it('creating an approval for an existing charge returns its booking URL', async () => {
    const res = await post(tokenA, '/api/approvals', {
      subject: String(charge._id), subjectType: 'contract-charge', amount: 5000, currency: env.BASE_CURRENCY,
    })
    expect(res.status).toBe(201)
    approvalIds.push(res.body._id)
    expect(res.body.subjectUrl).toBe(`/update-booking?b=${bookingA2._id}`)
  })

  it('creating an approval for an existing invoice returns its invoice URL', async () => {
    const res = await post(tokenA, '/api/approvals', {
      subject: String(invoice._id), subjectType: 'invoice', amount: 40000, currency: env.BASE_CURRENCY,
    })
    expect(res.status).toBe(201)
    approvalIds.push(res.body._id)
    expect(res.body.subjectUrl).toBe(`/invoices?id=${invoice._id}`)
  })

  it('the list carries the same subject URLs', async () => {
    const res = await get(tokenA, '/api/approvals')
    expect(res.status).toBe(200)
    const bySubject = new Map(res.body.map((r: { subject: string, subjectUrl?: string }) => [String(r.subject), r.subjectUrl]))
    expect(bySubject.get(String(charge._id))).toBe(`/update-booking?b=${bookingA2._id}`)
    expect(bySubject.get(String(invoice._id))).toBe(`/invoices?id=${invoice._id}`)
  })

  it('a free-text subject type is rejected', async () => {
    const res = await post(tokenA, '/api/approvals', {
      subject: String(charge._id), subjectType: 'something-else', amount: 1000,
    })
    expect(res.status).toBe(400)
  })

  it('a typed subject that does not exist is rejected', async () => {
    const res = await post(tokenA, '/api/approvals', {
      subject: String(new mongoose.Types.ObjectId()), subjectType: 'invoice', amount: 1000,
    })
    expect(res.status).toBe(400)
  })
})

describe('F8 / W5 S1 + AU4 — connections endpoint returns booleans only; settings routes require a token', () => {
  it('GET /api/settings/connections returns one boolean per channel, no secrets', async () => {
    const res = await get(adminToken, '/api/settings/connections')
    expect(res.status).toBe(200)
    expect(typeof res.body.stripe).toBe('boolean')
    expect(typeof res.body.paypal).toBe('boolean')
    expect(typeof res.body.smtp).toBe('boolean')
    expect(typeof res.body.push).toBe('boolean')
    expect(JSON.stringify(res.body)).not.toMatch(/sk_live|secret|token|password/i)
  })

  it('GET /api/settings/connections without a token is 401', async () => {
    const res = await request(app).get('/api/settings/connections')
    expect(res.status).toBe(401)
  })

  it('GET /api/settings without a token is 401 (AU4, fixed with S4)', async () => {
    const res = await request(app).get('/api/settings')
    expect(res.status).toBe(401)
  })
})

describe('F8 / W5 N2 — automatic pickup/return/overdue/expiry reminders', () => {
  const day = 86400000
  // ISO week key (YYYY-Www), mirroring the private `isoWeekKey` in
  // autoReminders.ts (not exported, so the test recomputes it the same
  // way). The weekly recap's dedupeKey is `weekly:<this key>`; scoping
  // the assertion to it keeps the test green on Mondays, when the two
  // earlier tests in this describe legitimately fire the recap for the
  // current week (QA D-QA-1).
  const isoWeekKey = (date: Date): string => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    const dow = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - dow + 3)
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
    const firstDay = (firstThursday.getUTCDay() + 6) % 7
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
    const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000))
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
  }
  let carN2: env.Car
  let carExp: env.Car
  let scheduleN2: env.MaintenanceSchedule
  let bookingPickup: env.Booking
  let bookingReturn: env.Booking
  let bookingOverdue: env.Booking

  beforeAll(async () => {
    const now = Date.now()
    carN2 = await makeCar(supplierA, 'N2')
    carExp = await makeCar(supplierA, 'N2-exp', { insuranceExpiryDate: new Date(now + 10 * day) })
    // Pickup tomorrow; return tomorrow (from 3 days ago, so no pickup
    // event for it); overdue since 2 days ago, 200 unpaid.
    bookingPickup = await makeBooking(supplierA, carN2, new Date(now + day), new Date(now + 3 * day), 100, snapshot(100, 0))
    bookingReturn = await makeBooking(supplierA, carN2, new Date(now - 3 * day), new Date(now + day), 100, snapshot(100, 0))
    bookingOverdue = await makeBooking(supplierA, carN2, new Date(now - 5 * day), new Date(now - 2 * day), 200, snapshot(200, 0))
    scheduleN2 = await new MaintenanceSchedule({
      supplier: supplierA._id, car: carN2._id, type: types.MaintenanceExpenseType.Maintenance,
      title: 'F8 N2 oil change', nextDueDate: new Date(now + 5 * day),
      status: types.MaintenanceScheduleStatus.Upcoming,
    }).save()
  })

  it('fires pickup, return, overdue and expiry reminders (in-app sent)', async () => {
    const result = await runAutoReminderPass(new Date(), { force: true })
    expect(result.skipped).toBe(false)
    expect(result.pickups).toBeGreaterThanOrEqual(1)
    expect(result.returns).toBeGreaterThanOrEqual(1)
    expect(result.overdue).toBeGreaterThanOrEqual(1)
    expect(result.expiries).toBeGreaterThanOrEqual(2)
    const rows = await NotificationDelivery.find({ supplier: supplierA._id, channel: 'inApp', status: 'sent' }).lean()
    const keys = new Set(rows.map((r) => `${r.templateKey}:${r.subjectId}`))
    expect(keys.has(`auto.pickup:${bookingPickup._id}`)).toBe(true)
    expect(keys.has(`auto.return:${bookingReturn._id}`)).toBe(true)
    expect(keys.has(`auto.overdue:${bookingOverdue._id}`)).toBe(true)
    expect(keys.has(`auto.expiry:${carExp._id}`)).toBe(true)
    expect(keys.has(`auto.expiry:${scheduleN2._id}`)).toBe(true)
  })

  it('a second pass for the same day does not re-send (delivery-log dedupe)', async () => {
    const filter = {
      supplier: supplierA._id, templateKey: 'auto.pickup', subjectId: String(bookingPickup._id), channel: 'inApp',
    }
    const before = await NotificationDelivery.countDocuments(filter)
    expect(before).toBeGreaterThanOrEqual(1)
    await runAutoReminderPass(new Date(), { force: true })
    expect(await NotificationDelivery.countDocuments(filter)).toBe(before)
  })

  it('fires the weekly recap once per ISO week, on Mondays', async () => {
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7))
    monday.setHours(9, 0, 0, 0)
    await runAutoReminderPass(monday, { force: true })
    await runAutoReminderPass(monday, { force: true })
    const rows = await NotificationDelivery.find({
      supplier: supplierA._id, templateKey: 'weekly.recap', channel: 'inApp', recipient: supplierA._id,
      dedupeKey: `weekly:${isoWeekKey(monday)}`,
    }).lean()
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('sent')
  })
})

describe('F8 / W5 N3 — templates, delivery log and retry', () => {
  it('templates render in the owner language with real record values', () => {
    const rendered = renderNotificationTemplate('auto.pickup', 'fr', {
      when: 'tomorrow', whenFr: 'demain', date: '2026-11-17', car: 'Clio (AA-123-AA)', driver: 'Jane Doe',
    })
    expect(rendered.subject).toContain('Clio (AA-123-AA)')
    expect(rendered.subject).toContain('Jane Doe')
    expect(rendered.body).toContain('2026-11-17')
  })

  it('the list endpoint returns the log, newest first, with filters', async () => {
    const res = await get(tokenA, '/api/notification-deliveries')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    expect(res.body[0]).toHaveProperty('templateKey')
    expect(res.body[0]).toHaveProperty('channel')
    expect(res.body[0]).toHaveProperty('status')
    const sent = await get(tokenA, '/api/notification-deliveries?status=sent')
    expect(sent.status).toBe(200)
    expect(sent.body.every((r: { status: string }) => r.status === 'sent')).toBe(true)
    const email = await get(tokenA, '/api/notification-deliveries?channel=email')
    expect(email.status).toBe(200)
    expect(email.body.every((r: { channel: string }) => r.channel === 'email')).toBe(true)
  })

  it('an agency sees only its own deliveries', async () => {
    const resB = await get(tokenB, '/api/notification-deliveries')
    expect(resB.status).toBe(200)
    expect(resB.body.every((r: { supplier: string }) => String(r.supplier) === String(supplierB._id))).toBe(true)
  })

  it('retry re-sends a failed in-app delivery and marks it sent', async () => {
    const row = await new NotificationDelivery({
      supplier: supplierA._id, templateKey: 'auto.pickup', subjectType: 'booking',
      subjectId: String(bookingA1._id), dedupeKey: 'n3-test-retry', channel: 'inApp',
      recipient: supplierA._id, subject: 'N3 retry test', body: 'N3 retry test body',
      status: 'failed', attempts: 1, lastError: 'simulated failure',
    }).save()
    const res = await post(tokenA, `/api/notification-deliveries/${row._id}/retry`, {})
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('sent')
    expect(res.body.attempts).toBe(2)
    expect(res.body.sentAt).toBeTruthy()
  })

  it('retrying an already-sent delivery is refused', async () => {
    const sent = await NotificationDelivery.findOne({ supplier: supplierA._id, status: 'sent' }).lean()
    expect(sent).toBeTruthy()
    const res = await post(tokenA, `/api/notification-deliveries/${sent!._id}/retry`, {})
    expect(res.status).toBe(400)
  })

  it('retry requires ManageReminders (a read-only requester gets 403)', async () => {
    const counter = await makeStaff('n3-counter', types.AgencyRole.CounterAgent, supplierA)
    const row = await new NotificationDelivery({
      supplier: supplierA._id, templateKey: 'auto.pickup', subjectType: 'booking',
      subjectId: String(bookingA1._id), dedupeKey: 'n3-test-retry-403', channel: 'inApp',
      recipient: supplierA._id, body: 'N3 retry 403 test',
      status: 'failed', attempts: 1,
    }).save()
    const res = await post(counter.token, `/api/notification-deliveries/${row._id}/retry`, {})
    expect(res.status).toBe(403)
  })

  it('retrying another agency delivery is 404', async () => {
    const row = await new NotificationDelivery({
      supplier: supplierB._id, templateKey: 'auto.pickup', subjectType: 'booking',
      subjectId: String(bookingB1._id), dedupeKey: 'n3-test-retry-cross', channel: 'inApp',
      recipient: supplierB._id, body: 'N3 cross-agency test',
      status: 'failed', attempts: 1,
    }).save()
    const res = await post(tokenA, `/api/notification-deliveries/${row._id}/retry`, {})
    expect(res.status).toBe(404)
  })
})

describe('F8 / W5 D4 — documentsExpiring count (doc fields win over schedules)', () => {
  const day = 86400000
  const window = 'from=2026-11-10&to=2026-11-19'

  it('counts field expiries, falls back to due schedules, and never double-counts a car', async () => {
    // Baselines are relative: the N2 section left an expiring car and a
    // due schedule behind for agency A, so the assertions are deltas.
    const beforeA = await get(tokenA, `/api/dashboard/summary?${window}`)
    expect(beforeA.status).toBe(200)
    const beforeAdmin = await get(adminToken, `/api/dashboard/summary?${window}`)
    expect(beforeAdmin.status).toBe(200)
    const baseA = beforeA.body.documentsExpiring as number
    const baseAdmin = beforeAdmin.body.documentsExpiring as number
    const now = Date.now()

    // +1 for A: insurance expiring in 10 days.
    await makeCar(supplierA, 'D4-field', { insuranceExpiryDate: new Date(now + 10 * day) })
    // +1 for A: no doc fields, only a due schedule.
    const carSched = await makeCar(supplierA, 'D4-sched')
    await new MaintenanceSchedule({
      supplier: supplierA._id, car: carSched._id, type: types.MaintenanceExpenseType.Maintenance,
      title: 'F8 D4 schedule', nextDueDate: new Date(now + 5 * day),
      status: types.MaintenanceScheduleStatus.Upcoming,
    }).save()
    // +1 for A (not +2): both a field (7d) and a schedule (3d) — the
    // field wins, the schedule is not double-counted.
    const carBoth = await makeCar(supplierA, 'D4-both', { insuranceExpiryDate: new Date(now + 7 * day) })
    await new MaintenanceSchedule({
      supplier: supplierA._id, car: carBoth._id, type: types.MaintenanceExpenseType.Maintenance,
      title: 'F8 D4 both', nextDueDate: new Date(now + 3 * day),
      status: types.MaintenanceScheduleStatus.Upcoming,
    }).save()
    // +0: expiry beyond the 30-day horizon.
    await makeCar(supplierA, 'D4-far', { insuranceExpiryDate: new Date(now + 40 * day) })
    // +0: completed schedule.
    const carDone = await makeCar(supplierA, 'D4-done')
    await new MaintenanceSchedule({
      supplier: supplierA._id, car: carDone._id, type: types.MaintenanceExpenseType.Maintenance,
      title: 'F8 D4 done', nextDueDate: new Date(now + 2 * day),
      status: types.MaintenanceScheduleStatus.Completed,
    }).save()
    // +1 for agency B only.
    await makeCar(supplierB, 'D4-b', { insuranceExpiryDate: new Date(now + 10 * day) })

    const resA = await get(tokenA, `/api/dashboard/summary?${window}`)
    expect(resA.status).toBe(200)
    expect(resA.body.documentsExpiring).toBe(baseA + 3)
    const resAdmin = await get(adminToken, `/api/dashboard/summary?${window}`)
    expect(resAdmin.status).toBe(200)
    expect(resAdmin.body.documentsExpiring).toBe(baseAdmin + 4)
  })
})

describe('F8 / W5 S4 — global-settings schema rejects empty/zero/invalid values', () => {
  let hadSetting = false
  let original: { minPickupHours: number, minRentalHours: number, minPickupDropoffHour: number, maxPickupDropoffHour: number } | null = null

  beforeAll(async () => {
    const existing = await Setting.findOne().lean()
    hadSetting = !!existing
    if (existing) {
      original = {
        minPickupHours: existing.minPickupHours,
        minRentalHours: existing.minRentalHours,
        minPickupDropoffHour: existing.minPickupDropoffHour,
        maxPickupDropoffHour: existing.maxPickupDropoffHour,
      }
    } else {
      await new Setting({
        minPickupHours: 1, minRentalHours: 1, minPickupDropoffHour: 0, maxPickupDropoffHour: 23,
      }).save()
    }
  })

  afterAll(async () => {
    if (hadSetting && original) {
      await Setting.updateOne({}, { $set: original })
    } else {
      await Setting.deleteMany({})
    }
  })

  it('rejects an empty string (the old Number("") = 0 escape)', async () => {
    const res = await put(adminToken, '/api/update-settings', { minPickupHours: '' })
    expect(res.status).toBe(400)
  })

  it('rejects zero counts', async () => {
    expect((await put(adminToken, '/api/update-settings', { minPickupHours: 0 })).status).toBe(400)
    expect((await put(adminToken, '/api/update-settings', { minRentalHours: 0 })).status).toBe(400)
  })

  it('rejects non-integers and hours outside 0-23', async () => {
    expect((await put(adminToken, '/api/update-settings', { minPickupHours: 1.5 })).status).toBe(400)
    expect((await put(adminToken, '/api/update-settings', { minPickupDropoffHour: 24 })).status).toBe(400)
    expect((await put(adminToken, '/api/update-settings', { maxPickupDropoffHour: -1 })).status).toBe(400)
  })

  it('rejects an inverted pickup/dropoff hour window', async () => {
    const res = await put(adminToken, '/api/update-settings', { minPickupDropoffHour: 10, maxPickupDropoffHour: 8 })
    expect(res.status).toBe(400)
  })

  it('accepts a valid update and persists it', async () => {
    const res = await put(adminToken, '/api/update-settings', {
      minPickupHours: 2, minRentalHours: 3, minPickupDropoffHour: 8, maxPickupDropoffHour: 20,
    })
    expect(res.status).toBe(200)
    expect(res.body.minPickupHours).toBe(2)
    expect(res.body.minRentalHours).toBe(3)
    expect(res.body.minPickupDropoffHour).toBe(8)
    expect(res.body.maxPickupDropoffHour).toBe(20)
  })
})

describe('F8 / W5 S5 — bank-details IBAN (mod-97) and SWIFT validation', () => {
  let preExisting: env.BankDetails | null = null

  beforeAll(async () => {
    preExisting = await BankDetails.findOne().lean()
  })

  afterAll(async () => {
    await BankDetails.deleteMany({})
    if (preExisting) {
      const { _id, ...rest } = preExisting
      await new BankDetails({ _id, ...rest }).save()
    }
  })

  const valid = {
    accountHolder: 'F8 Fixture', bankName: 'F8 Bank',
    iban: 'DE89370400440532013000', swiftBic: 'DEUTDEFF', showBankDetailsPage: true,
  }

  it('rejects an IBAN that fails mod-97', async () => {
    const res = await post(adminToken, '/api/upsert-bank-details', { ...valid, iban: 'DE89370400440532013001' })
    expect(res.status).toBe(400)
  })

  it('rejects a structurally invalid IBAN and SWIFT', async () => {
    expect((await post(adminToken, '/api/upsert-bank-details', { ...valid, iban: 'NOTANIBAN' })).status).toBe(400)
    expect((await post(adminToken, '/api/upsert-bank-details', { ...valid, swiftBic: 'ABC' })).status).toBe(400)
    expect((await post(adminToken, '/api/upsert-bank-details', { ...valid, swiftBic: 'DEUTDEFFXXX1' })).status).toBe(400)
  })

  it('accepts a valid IBAN + SWIFT (and a spaced, lowercase IBAN)', async () => {
    const res = await post(adminToken, '/api/upsert-bank-details', valid)
    expect(res.status).toBe(200)
    expect(res.body.iban).toBe('DE89370400440532013000')
    const res2 = await post(adminToken, '/api/upsert-bank-details', { ...valid, iban: 'de89 3704 0044 0532 0130 00', swiftBic: 'deutdeff' })
    expect(res2.status).toBe(200)
  })
})

describe('F8 / W5 T4 — membership removal and a reachable Pending status', () => {
  it('create accepts an explicit Pending status', async () => {
    const res = await post(tokenA, `/api/agency-memberships/${supplierA._id}`, {
      email: `f8-t4-create-${suffix}@test.bookcars.ma`, fullName: 'F8 T4 Create Pending',
      password: 't4-pass-1', role: types.AgencyRole.CounterAgent,
      status: types.AgencyMembershipStatus.Pending,
    })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe(types.AgencyMembershipStatus.Pending)
    membershipIds.push(res.body._id)
    ids.push(res.body.user._id)
  })

  it('update accepts Pending and can reactivate', async () => {
    const { membership } = await makeStaff('t4-flip', types.AgencyRole.Accountant, supplierA)
    const toPending = await put(tokenA, `/api/agency-memberships/${supplierA._id}/${membership._id}`, { status: types.AgencyMembershipStatus.Pending })
    expect(toPending.status).toBe(200)
    expect(toPending.body.status).toBe(types.AgencyMembershipStatus.Pending)
    const toActive = await put(tokenA, `/api/agency-memberships/${supplierA._id}/${membership._id}`, { status: types.AgencyMembershipStatus.Active })
    expect(toActive.status).toBe(200)
    expect(toActive.body.status).toBe(types.AgencyMembershipStatus.Active)
  })

  it('delete removes the membership row but keeps the staff User', async () => {
    const { staff, membership } = await makeStaff('t4-remove', types.AgencyRole.Mechanic, supplierA)
    const res = await del(tokenA, `/api/agency-memberships/${supplierA._id}/${membership._id}`)
    expect(res.status).toBe(204)
    expect(await AgencyMembership.findById(membership._id)).toBeNull()
    expect(await User.findById(staff._id)).not.toBeNull()
  })

  it('delete is blocked (409) while the member has a Pending approval', async () => {
    const { staff, membership } = await makeStaff('t4-blocked', types.AgencyRole.Accountant, supplierA)
    const approval = await new Approval({
      supplier: supplierA._id, requestedBy: staff._id,
      subject: String(new mongoose.Types.ObjectId()), subjectType: 'invoice',
      amount: 100, currency: env.BASE_CURRENCY, status: types.ApprovalDecision.Pending,
    }).save()
    approvalIds.push(approval._id)
    const res = await del(tokenA, `/api/agency-memberships/${supplierA._id}/${membership._id}`)
    expect(res.status).toBe(409)
    expect(await AgencyMembership.findById(membership._id)).not.toBeNull()
  })

  it('deleting an unknown membership is 404', async () => {
    const res = await del(tokenA, `/api/agency-memberships/${supplierA._id}/${new mongoose.Types.ObjectId()}`)
    expect(res.status).toBe(404)
  })
})
