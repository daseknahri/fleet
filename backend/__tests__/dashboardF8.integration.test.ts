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
  await Notification.deleteMany({ user: { $in: [supplierA._id, supplierB._id] } })
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
