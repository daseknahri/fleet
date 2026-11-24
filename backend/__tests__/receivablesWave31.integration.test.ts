import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import NotificationDelivery from '../src/models/NotificationDelivery'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import { postRentalPayment } from '../src/utils/ledger'

// GH-02 / Wave 3.1 — the extended overdue endpoint: §3.1 fields
// (daysOverdue, paymentDueAt, daysToPaymentDue, depositDue +
// depositHeld, lastRemindedAt, reminderCount), paid-in-full rows in
// the same response, filters, age-desc sort. Same harness as
// receivablesDowngrade: mocked providers (no Stripe/PayPal
// credentials, no live money) against the real Mongo-backed app.
// The app is imported dynamically in beforeAll, AFTER the
// provider/mail mocks below are registered.

const stripeRefundCreate: any = jest.fn()
const paypalGetOrder: any = jest.fn()
const paypalRefundCapture: any = jest.fn()
const mailSendMock: any = jest.fn(async () => ({}))

jest.unstable_mockModule('../src/payment/stripe.js', () => ({
  default: {
    checkout: { sessions: { retrieve: jest.fn() } },
    paymentIntents: { retrieve: jest.fn() },
    refunds: { create: stripeRefundCreate },
  },
}))
jest.unstable_mockModule('../src/payment/paypal.js', () => ({
  getOrder: paypalGetOrder,
  refundCapture: paypalRefundCapture,
}))
jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: mailSendMock,
}))

let app: any
let adminToken: string
let adminId: string

const day = 86400000
const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const at = (days: number) => new Date(Date.now() + days * day)
const endOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59) }

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

let supplier: any
let driver: any
let location: any
let car: any

// Booking ids, keyed by fixture label.
const B: Record<string, mongoose.Types.ObjectId> = {}

const snapshot = (rentalTotal: number, depositAmount: number, mode: bookcarsTypes.CheckoutPaymentMode = bookcarsTypes.CheckoutPaymentMode.Deposit) => ({
  version: 1,
  baseCurrency: 'MAD',
  paymentCurrency: 'MAD',
  mode,
  rentalTotal,
  depositAmount,
  amountDueNow: rentalTotal,
  amountDueNowInPaymentCurrency: rentalTotal,
  quotedAt: new Date(),
})

const makeBooking = async (
  label: string,
  opts: {
    from: Date, to: Date, price: number, deposit: number,
    lifecycle?: bookcarsTypes.ContractLifecycle, status?: bookcarsTypes.BookingStatus,
    expireAt?: Date, mode?: bookcarsTypes.CheckoutPaymentMode,
  },
) => {
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: opts.from, to: opts.to,
    status: opts.status || bookcarsTypes.BookingStatus.Pending,
    lifecycle: opts.lifecycle || bookcarsTypes.ContractLifecycle.Draft,
    price: opts.price,
    financialSnapshot: snapshot(opts.price, opts.deposit, opts.mode),
    ...(opts.expireAt ? { expireAt: opts.expireAt } : {}),
  } as any)
  fixtureBookingIds.push(booking._id)
  B[label] = booking._id
  return booking
}

const postPayment = async (bookingId: mongoose.Types.ObjectId, amount: number, purpose: bookcarsTypes.RentalPaymentPurpose) =>
  postRentalPayment({
    bookingId: bookingId.toString(),
    date: new Date(),
    amount,
    currency: 'MAD',
    method: bookcarsTypes.RentalPaymentMethod.Card,
    purpose,
    source: bookcarsTypes.RentalPaymentSource.Stripe,
    providerReference: `pi_w31_${rand()}`,
    actorId: adminId,
  })

const getOverdue = (query = '') => request(app).get(`/api/rental-payments/overdue${query}`).set(env.X_ACCESS_TOKEN, adminToken)

type Row = {
  booking: { _id: string }
  outstandingBalance: number
  depositDue: number
  depositHeld: number
  dueAt?: string
  overdue: boolean
  currency: string
  daysOverdue: number
  paymentDueAt?: string
  daysToPaymentDue: number | null
  lastRemindedAt?: string
  reminderCount: number
  paidInFull: boolean
  paidRent: number
  contractTotal: number
  ageBucket: string
  lifecycle?: string
  status?: string
  pickupAt?: string
  holdExpiresAt?: string
  actions: { canTakePayment: boolean, canConfirm: boolean, canCancel: boolean, canMarkNoShow: boolean }
}

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'w31-admin', email: `w31-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })
  stripeRefundCreate.mockResolvedValue({ id: 're_w31_test' })
  paypalRefundCapture.mockResolvedValue({})

  supplier = await User.create({
    email: `w31-supplier-${rand()}@test.bookcars.ma`, fullName: 'W3.1 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `w31-driver-${rand()}@test.bookcars.ma`, fullName: 'W3.1 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `W3.1 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'W3.1 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)

  // Overdue 2 days: 400 owed, 100 deposit due, nothing held.
  await makeBooking('overdue2', { from: at(-5), to: at(-2), price: 400, deposit: 100 })
  // Overdue 10 days: 300 owed — the age-desc sort leader.
  await makeBooking('overdue10', { from: at(-12), to: at(-10), price: 300, deposit: 0 })
  // Pickup tomorrow, 300 of 500 rent paid: 200 owed, due at pickup.
  await makeBooking('dueTomorrow', { from: at(1), to: at(3), price: 500, deposit: 100 })
  await postPayment(B.dueTomorrow, 300, bookcarsTypes.RentalPaymentPurpose.Rent)
  // Pay-later hold expiring at the end of today: the payment due
  // date is the hold deadline, not the pickup day. End of today (not
  // now + 12h) so daysToPaymentDue is 0 no matter what time the suite
  // runs: now + 12h crosses midnight in the afternoon and the
  // calendar-day count would read 1.
  await makeBooking('hold', {
    from: at(1), to: at(3), price: 300, deposit: 50,
    expireAt: endOfToday(), mode: bookcarsTypes.CheckoutPaymentMode.PayLater,
  })
  // Confirmed, unpaid, pickup in 2 days.
  await makeBooking('confirmed', {
    from: at(2), to: at(4), price: 600, deposit: 0,
    lifecycle: bookcarsTypes.ContractLifecycle.Confirmed, status: bookcarsTypes.BookingStatus.Pending,
  })
  // Paid in full (rent + deposit): never in `rows`, always in
  // `paidInFullRows`.
  await makeBooking('paid', { from: at(1), to: at(3), price: 200, deposit: 100 })
  await postPayment(B.paid, 200, bookcarsTypes.RentalPaymentPurpose.Rent)
  await postPayment(B.paid, 100, bookcarsTypes.RentalPaymentPurpose.Deposit)
})

afterAll(async () => {
  await NotificationDelivery.deleteMany({ supplier: supplier._id })
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-02 / Wave 3.1 — extended receivables endpoint', () => {
  it('returns the §3.1 fields on an overdue row (two deposit columns, aging, actions)', async () => {
    const res = await getOverdue()
    expect(res.status).toBe(200)
    const rows = res.body.rows as Row[]
    const row = rows.find((r) => r.booking._id === B.overdue2.toString())
    expect(row).toBeDefined()
    expect(row!.outstandingBalance).toBe(400)
    expect(row!.overdue).toBe(true)
    expect(row!.daysOverdue).toBe(2)
    // paymentDueAt falls back to the shared dueAt (rental end) here.
    // (Day-granularity compare: the fixture date and the assertion
    // date are built from different Date.now() calls.)
    expect(row!.paymentDueAt!.slice(0, 10)).toBe(at(-2).toISOString().slice(0, 10))
    expect(row!.daysToPaymentDue).toBe(-2)
    // Two columns, never one ambiguous one.
    expect(row!.depositDue).toBe(100)
    expect(row!.depositHeld).toBe(0)
    expect(row!.reminderCount).toBe(0)
    expect(row!.lastRemindedAt).toBeUndefined()
    expect(row!.paidInFull).toBe(false)
    expect(row!.paidRent).toBe(0)
    expect(row!.contractTotal).toBe(400)
    expect(row!.ageBucket).toBe('1-7')
    expect(row!.actions.canTakePayment).toBe(true)
    expect(row!.actions.canConfirm).toBe(true)
    expect(row!.actions.canCancel).toBe(true)
    expect(row!.actions.canMarkNoShow).toBe(true)
  })

  it('a pickup-tomorrow booking is due at pickup, not at rental end', async () => {
    const res = await getOverdue()
    const rows = res.body.rows as Row[]
    const row = rows.find((r) => r.booking._id === B.dueTomorrow.toString())
    expect(row).toBeDefined()
    expect(row!.overdue).toBe(false)
    expect(row!.daysOverdue).toBe(0)
    expect(row!.paymentDueAt!.slice(0, 10)).toBe(at(1).toISOString().slice(0, 10))
    expect(row!.daysToPaymentDue).toBe(1)
    expect(row!.outstandingBalance).toBe(200)
    expect(row!.paidRent).toBe(300)
    expect(row!.depositDue).toBe(100)
    expect(row!.ageBucket).toBe('current')
    expect(row!.actions.canMarkNoShow).toBe(false)
  })

  it('a pay-later hold is due at the hold deadline', async () => {
    const res = await getOverdue()
    const rows = res.body.rows as Row[]
    const row = rows.find((r) => r.booking._id === B.hold.toString())
    expect(row).toBeDefined()
    expect(row!.holdExpiresAt).toBeDefined()
    expect(new Date(row!.paymentDueAt!).getTime()).toBe(new Date(row!.holdExpiresAt!).getTime())
    expect(row!.daysToPaymentDue).toBe(0)
    expect(row!.actions.canConfirm).toBe(true)
  })

  it('paid-in-full rows live in the same response, never inside rows', async () => {
    const res = await getOverdue()
    expect(res.status).toBe(200)
    const rows = res.body.rows as Row[]
    const paidRows = res.body.paidInFullRows as Row[]
    expect(rows.map((r) => r.booking._id)).not.toContain(B.paid.toString())
    expect(rows).toHaveLength(5)
    expect(res.body.paidInFullCount).toBe(1)
    const paid = paidRows.find((r) => r.booking._id === B.paid.toString())
    expect(paid).toBeDefined()
    expect(paid!.outstandingBalance).toBe(0)
    expect(paid!.paidInFull).toBe(true)
    expect(paid!.paidRent).toBe(200)
    expect(paid!.depositHeld).toBe(100)
    expect(paid!.depositDue).toBe(0)
    // Totals keep their old meaning: outstanding rows only.
    expect(res.body.outstandingTotal).toBe(1800)
    expect(res.body.overdueTotal).toBe(700)
  })

  it('sorts age-desc: the 10-day overdue row comes first', async () => {
    const res = await getOverdue()
    const rows = res.body.rows as Row[]
    expect(rows[0].booking._id).toBe(B.overdue10.toString())
    expect(rows[0].daysOverdue).toBe(10)
    expect(rows[1].booking._id).toBe(B.overdue2.toString())
  })

  it('filter=overdue returns only overdue rows', async () => {
    const res = await getOverdue('?filter=overdue')
    expect(res.status).toBe(200)
    const rows = res.body.rows as Row[]
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.overdue)).toBe(true)
    expect(res.body.paidInFullRows).toHaveLength(0)
  })

  it('filter=due-soon returns due today/tomorrow only', async () => {
    const res = await getOverdue('?filter=due-soon')
    const rows = res.body.rows as Row[]
    expect(rows.map((r) => r.booking._id).sort()).toEqual([B.dueTomorrow.toString(), B.hold.toString()].sort())
  })

  it('filter=confirmed-unpaid returns only Confirmed holds with a balance', async () => {
    const res = await getOverdue('?filter=confirmed-unpaid')
    const rows = res.body.rows as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0].booking._id).toBe(B.confirmed.toString())
  })

  it('filter=holds-expiring returns only holds expiring within 24h', async () => {
    const res = await getOverdue('?filter=holds-expiring')
    const rows = res.body.rows as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0].booking._id).toBe(B.hold.toString())
  })

  it('filter=paid-in-full returns only the paid-in-full rows', async () => {
    const res = await getOverdue('?filter=paid-in-full')
    expect(res.body.rows).toHaveLength(0)
    const paidRows = res.body.paidInFullRows as Row[]
    expect(paidRows).toHaveLength(1)
    expect(paidRows[0].booking._id).toBe(B.paid.toString())
  })

  it('age-bucket filters split current / 1-7d / 8-30d', async () => {
    const current = (await getOverdue('?filter=age-current')).body.rows as Row[]
    expect(current.map((r) => r.booking._id).sort()).toEqual(
      [B.dueTomorrow.toString(), B.hold.toString(), B.confirmed.toString()].sort(),
    )
    const week = (await getOverdue('?filter=age-1-7')).body.rows as Row[]
    expect(week).toHaveLength(1)
    expect(week[0].booking._id).toBe(B.overdue2.toString())
    const month = (await getOverdue('?filter=age-8-30')).body.rows as Row[]
    expect(month).toHaveLength(1)
    expect(month[0].booking._id).toBe(B.overdue10.toString())
    const old = (await getOverdue('?filter=age-30-plus')).body.rows as Row[]
    expect(old).toHaveLength(0)
  })

  it('clientId filters by driver; unknown filter / clientId are 400', async () => {
    const mine = (await getOverdue(`?clientId=${driver._id.toString()}`)).body.rows as Row[]
    expect(mine).toHaveLength(5)
    const nobody = (await getOverdue(`?clientId=${oid().toString()}`)).body.rows as Row[]
    expect(nobody).toHaveLength(0)
    expect((await getOverdue('?filter=nope')).status).toBe(400)
    expect((await getOverdue('?clientId=nope')).status).toBe(400)
  })

  it('lastRemindedAt / reminderCount come from the delivery log (sent money reminders only)', async () => {
    const sentAt1 = new Date('2026-11-20T10:00:00.000Z')
    const sentAt2 = new Date('2026-11-23T10:00:00.000Z')
    const seeded = await NotificationDelivery.create([
      {
        supplier: supplier._id, templateKey: 'auto.overdue', subjectType: 'booking', subjectId: B.overdue2.toString(),
        dedupeKey: `w31-overdue-${rand()}`, channel: 'inApp', recipient: adminId,
        subject: 'Overdue', body: 'Overdue rental', status: 'sent', sentAt: sentAt1,
      },
      {
        supplier: supplier._id, templateKey: 'auto.confirmedUnpaid', subjectType: 'booking', subjectId: B.overdue2.toString(),
        dedupeKey: `w31-confirmed-${rand()}`, channel: 'email', recipient: adminId,
        subject: 'Confirmed unpaid', body: 'Confirmed but unpaid', status: 'sent', sentAt: sentAt2,
      },
      {
        // Failed sends and non-money keys must not count.
        supplier: supplier._id, templateKey: 'auto.overdue', subjectType: 'booking', subjectId: B.overdue2.toString(),
        dedupeKey: `w31-failed-${rand()}`, channel: 'email', recipient: adminId,
        subject: 'Overdue', body: 'Overdue rental', status: 'failed', sentAt: sentAt2,
      },
      {
        supplier: supplier._id, templateKey: 'auto.pickup', subjectType: 'booking', subjectId: B.overdue2.toString(),
        dedupeKey: `w31-pickup-${rand()}`, channel: 'inApp', recipient: adminId,
        subject: 'Pickup', body: 'Pickup tomorrow', status: 'sent', sentAt: sentAt2,
      },
    ])
    try {
      const res = await getOverdue()
      const rows = res.body.rows as Row[]
      const row = rows.find((r) => r.booking._id === B.overdue2.toString())
      expect(row!.reminderCount).toBe(2)
      expect(new Date(row!.lastRemindedAt!).getTime()).toBe(sentAt2.getTime())
    } finally {
      await NotificationDelivery.deleteMany({ _id: { $in: seeded.map((r) => r._id) } })
    }
  })
})
