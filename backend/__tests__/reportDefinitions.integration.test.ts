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
import MaintenanceExpense from '../src/models/MaintenanceExpense'
import Invoice from '../src/models/Invoice'

/**
 * GA-P2-REPORT-DEFINITIONS-01 (queue #10, slice 4) — numeric verification of
 * every metric in docs/report-metric-dictionary.md v2026-11-02.1 against a
 * hand-computed synthetic fixture, through the real GET /api/reports/summary
 * endpoint using the exact date-only range format the admin Reports page
 * sends (YYYY-MM-DD).
 *
 * Dictionary range rule: "Date ranges are inclusive ... use
 * Africa/Casablanca". For from=2026-11-10, to=2026-11-19 the window is
 * therefore the two Casablanca local days' bounds as resolved through
 * the runtime tz database: [2026-11-10T00:00:00.000Z,
 * 2026-11-19T23:59:59.999Z]. (The current IANA database records Morocco
 * at UTC+1 until 2026-09-20 and UTC+0 afterwards, so November 2026
 * Casablanca days coincide with UTC days; the controller resolves the
 * offset through Intl rather than hardcoding it, so the proof pins the
 * local-day property, not a fixed offset.) Two payments discriminate
 * the boundary against the pre-fix behavior: one at 00:30 on the
 * from-day (must be IN; the old end-of-day-UTC parse excluded the whole
 * from-day) and one on the morning after the to-day (must be OUT; the
 * old parse included it).
 *
 * Hand computation:
 *   revenueCollected  = 300 (Nov 10, 00:30) + 150 (Nov 15) - 50 debit (Nov 16) = 400
 *                       (Nov 20 payment of 999 and the pending 500 excluded)
 *   depositsCollected = 100
 *   expenses          = 50 + 25.5 = 75.5 (October expense of 999 excluded)
 *   receivable        = (700 snapshot + 900 price) - 400 = 1200
 *   estimatedMargin   = 400 - 75.5 = 324.5   (dictionary 4.1.1, as approved)
 *   contracts         = 2 (cancelled and December bookings excluded)
 *   bookedVehicleDays = 2 (Nov 11->13) + 2 (Nov 18 -> window end, ceil) = 4
 *   fleetCapacityDays = 2 cars x 10 days = 20 (downtime NOT subtracted, 4.1.2a)
 *   utilizationPercent = 4 / 20 x 100 = 20
 *   invoices          = count 2, total 3000, paid 400 (voided + October out)
 */

let supplier: env.User
let token: string
const ids: { users: mongoose.Types.ObjectId[]; cars: mongoose.Types.ObjectId[]; bookings: mongoose.Types.ObjectId[]; invoices: mongoose.Types.ObjectId[] } = { users: [], cars: [], bookings: [], invoices: [] }
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const utc = (s: string) => new Date(`${s}Z`)

const carDoc = (name: string) => ({
  name, supplier: supplier._id, minimumAge: 21, locations: [new mongoose.Types.ObjectId()], dailyPrice: 100, deposit: 200, available: true,
  type: types.CarType.Diesel, gearbox: types.GearboxType.Automatic, aircon: true, seats: 5, doors: 4, fuelPolicy: types.FuelPolicy.FreeTank,
  mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0, collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
  range: types.CarRange.Midi, multimedia: [], rating: 5,
})
const bookingDoc = (car: mongoose.Types.ObjectId, from: Date, to: Date, status: types.BookingStatus, price: number, snapshot?: number) => ({
  supplier: supplier._id, car, driver: new mongoose.Types.ObjectId(), pickupLocation: new mongoose.Types.ObjectId(), dropOffLocation: new mongoose.Types.ObjectId(),
  from, to, status, price, lifecycle: types.ContractLifecycle.Confirmed, cancellation: false, amendments: false, theftProtection: false,
  collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false, ...(snapshot ? { financialSnapshot: { rentalTotal: snapshot } } : {}),
})
const paymentDoc = (booking: mongoose.Types.ObjectId, key: string, date: Date, amount: number, purpose: types.RentalPaymentPurpose, direction: types.RentalPaymentDirection, status: types.RentalPaymentStatus) => ({
  supplier: supplier._id, booking, date, amount, currency: env.BASE_CURRENCY, method: types.RentalPaymentMethod.Cash,
  purpose, direction, source: types.RentalPaymentSource.Manual, status, idempotencyKey: `q10rep-${key}-${suffix}`,
})

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplier = await new User({ email: `q10-reports-${suffix}@test.bookcars.ma`, fullName: 'Q10 Report Fixture', language: 'en', type: types.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true }).save()
  ids.users.push(supplier._id)
  token = await authHelper.encryptJWT({ id: supplier._id.toString() })

  const car1 = await new Car(carDoc('Q10 Report Car 1')).save(); ids.cars.push(car1._id)
  const car2 = await new Car(carDoc('Q10 Report Car 2')).save(); ids.cars.push(car2._id)

  const bk1 = await new Booking(bookingDoc(car1._id, utc('2026-11-11T10:00:00.000'), utc('2026-11-13T10:00:00.000'), types.BookingStatus.Reserved, 500, 700)).save(); ids.bookings.push(bk1._id)
  const bk2 = await new Booking(bookingDoc(car2._id, utc('2026-11-18T10:00:00.000'), utc('2026-11-25T10:00:00.000'), types.BookingStatus.Reserved, 900)).save(); ids.bookings.push(bk2._id)
  const bk3 = await new Booking(bookingDoc(car1._id, utc('2026-11-12T10:00:00.000'), utc('2026-11-14T10:00:00.000'), types.BookingStatus.Cancelled, 5000)).save(); ids.bookings.push(bk3._id)
  const bk4 = await new Booking(bookingDoc(car1._id, utc('2026-12-02T10:00:00.000'), utc('2026-12-04T10:00:00.000'), types.BookingStatus.Reserved, 8000)).save(); ids.bookings.push(bk4._id)

  await new RentalPayment(paymentDoc(bk1._id, 'a', utc('2026-11-10T00:30:00.000'), 300, types.RentalPaymentPurpose.Rent, types.RentalPaymentDirection.Credit, types.RentalPaymentStatus.Posted)).save()
  await new RentalPayment(paymentDoc(bk1._id, 'b', utc('2026-11-15T12:00:00.000'), 150, types.RentalPaymentPurpose.Rent, types.RentalPaymentDirection.Credit, types.RentalPaymentStatus.Posted)).save()
  await new RentalPayment(paymentDoc(bk1._id, 'c', utc('2026-11-16T12:00:00.000'), 50, types.RentalPaymentPurpose.Rent, types.RentalPaymentDirection.Debit, types.RentalPaymentStatus.Posted)).save()
  await new RentalPayment(paymentDoc(bk1._id, 'd', utc('2026-11-12T12:00:00.000'), 100, types.RentalPaymentPurpose.Deposit, types.RentalPaymentDirection.Credit, types.RentalPaymentStatus.Posted)).save()
  await new RentalPayment(paymentDoc(bk1._id, 'e', utc('2026-11-20T08:00:00.000'), 999, types.RentalPaymentPurpose.Rent, types.RentalPaymentDirection.Credit, types.RentalPaymentStatus.Posted)).save()
  await new RentalPayment(paymentDoc(bk1._id, 'f', utc('2026-11-15T12:00:00.000'), 500, types.RentalPaymentPurpose.Rent, types.RentalPaymentDirection.Credit, types.RentalPaymentStatus.Pending)).save()

  await new MaintenanceExpense({ supplier: supplier._id, car: car1._id, date: utc('2026-11-13T09:00:00.000'), type: types.MaintenanceExpenseType.Repair, amount: 50, vendor: 'Q10 Fixture' }).save()
  await new MaintenanceExpense({ supplier: supplier._id, car: car1._id, date: utc('2026-11-14T09:00:00.000'), type: types.MaintenanceExpenseType.Repair, amount: 25.5, vendor: 'Q10 Fixture' }).save()
  await new MaintenanceExpense({ supplier: supplier._id, car: car1._id, date: utc('2026-10-14T09:00:00.000'), type: types.MaintenanceExpenseType.Repair, amount: 999, vendor: 'Q10 Fixture' }).save()

  const mkInvoice = async (key: string, total: number, paidAmount: number, status: types.InvoiceStatus, createdAt: Date) => {
    // createdAt is set at construction: Mongoose protects it in updates,
    // but respects an explicit value on insert (verified by probe).
    const inv = await new Invoice({ supplier: supplier._id, booking: bk1._id, number: `Q10-${key}-${suffix}`, status, currency: env.BASE_CURRENCY, subtotal: total, taxAmount: 0, total, paidAmount, paymentStatus: paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid', createdAt }).save()
    ids.invoices.push(inv._id)
  }
  await mkInvoice('i1', 1000, 400, types.InvoiceStatus.Issued, utc('2026-11-12T10:00:00.000'))
  await mkInvoice('i2', 2000, 0, types.InvoiceStatus.Draft, utc('2026-11-13T10:00:00.000'))
  await mkInvoice('i3', 5000, 0, types.InvoiceStatus.Voided, utc('2026-11-12T10:00:00.000'))
  await mkInvoice('i4', 7000, 0, types.InvoiceStatus.Issued, utc('2026-10-12T10:00:00.000'))
})

afterAll(async () => {
  await RentalPayment.deleteMany({ idempotencyKey: { $regex: `^q10rep-.*-${suffix}$` } })
  await MaintenanceExpense.deleteMany({ supplier: supplier._id })
  await Invoice.deleteMany({ _id: { $in: ids.invoices } })
  await Booking.deleteMany({ _id: { $in: ids.bookings } })
  await Car.deleteMany({ _id: { $in: ids.cars } })
  await User.deleteMany({ _id: { $in: ids.users } })
  await databaseHelper.close()
})

describe('GA-P2-REPORT-DEFINITIONS-01 - metric dictionary v2026-11-02.1 verification', () => {
  it('matches every hand-computed metric for the date-only range the UI sends', async () => {
    const res = await request(app).get('/api/reports/summary?from=2026-11-10&to=2026-11-19').set(env.X_ACCESS_TOKEN, token)
    expect(res.status).toBe(200)
    expect(res.body.metricDictionaryVersion).toBe('2026-11-02.1')
    expect(res.body.currency).toBe(env.BASE_CURRENCY.toUpperCase())
    expect(res.body.timezone).toBe('Africa/Casablanca')
    // Casablanca day boundaries for the selected local days, then every
    // metric. Mismatches are collected so a failing run prints the whole
    // deviation table at once instead of stopping at the first value.
    const expected: Record<string, unknown> = {
      from: '2026-11-10T00:00:00.000Z',
      to: '2026-11-19T23:59:59.999Z',
      contracts: 2,
      fleetVehicles: 2,
      revenueCollected: 400,
      depositsCollected: 100,
      expenses: 75.5,
      receivable: 1200,
      estimatedMargin: 324.5,
      bookedVehicleDays: 4,
      fleetCapacityDays: 20,
      utilizationPercent: 20,
      invoiceCount: 2,
      invoicedTotal: 3000,
      invoicedPaid: 400,
    }
    const actual: Record<string, unknown> = { from: res.body.from, to: res.body.to, ...res.body.metrics }
    const mismatches = Object.entries(expected)
      .filter(([k, v]) => actual[k] !== v)
      .map(([k, v]) => `${k}: expected ${v}, got ${actual[k]}`)
    expect(mismatches).toEqual([])
  })

  it('keeps explicit datetime ranges exact (control window Nov 15-16 UTC)', async () => {
    const res = await request(app).get('/api/reports/summary?from=2026-11-15T00:00:00.000Z&to=2026-11-16T23:59:59.999Z').set(env.X_ACCESS_TOKEN, token)
    expect(res.status).toBe(200)
    const m = res.body.metrics
    expect(m.revenueCollected).toBe(100) // 150 credit - 50 debit; pending 500 excluded
    expect(m.expenses).toBe(0)
    expect(m.contracts).toBe(0)
    expect(m.bookedVehicleDays).toBe(0)
    expect(m.fleetCapacityDays).toBe(4) // 2 cars x 2 days
    expect(m.utilizationPercent).toBe(0)
    expect(m.invoiceCount).toBe(0)
    expect(m.estimatedMargin).toBe(100)
  })
})
