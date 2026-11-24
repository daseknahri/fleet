import 'dotenv/config'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import NotificationDelivery from '../src/models/NotificationDelivery'
import Notification from '../src/models/Notification'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import AgencyMembership from '../src/models/AgencyMembership'
import { renderNotificationTemplate } from '../src/utils/notificationTemplates'

// GH-03 + GH-14 + GH-11 / Wave 3.2 — the five new auto-reminder
// events: hold-expiring, payment-due-before-pickup, missed-pickup
// (daily re-fire), overdue weekly repeat (replacing the once-ever
// key, with repeat count), overdue escalation at 30+ days (owner
// only), pending-refund daily reminder (owner only). The pass runs
// through runAutoReminderPass({ force: true }) and the assertions
// read the delivery log, like dashboardF8's N2 tests.
//
// The mailer is mocked so the customer-email leg actually sends
// (status 'sent'); runAutoReminderPass is imported dynamically in
// beforeAll, AFTER the mocks are registered. No HTTP app is booted
// here (nothing in this file needs it, and booting it would start
// the background reminder tick).

const stripeRefundCreate: any = jest.fn()
const paypalGetOrder: any = jest.fn()
const paypalRefundCapture: any = jest.fn()
const mailSendMock: any = jest.fn(async () => ({ messageId: 'w32-test-message-id' }))

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

let runAutoReminderPass: (now?: Date, opts?: { force?: boolean }) => Promise<{
  skipped: boolean, holdExpiring: number, paymentDue: number, missedPickup: number,
  overdue: number, overdueEscalated: number, pendingRefunds: number,
}>

const day = 86400000
const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const at = (days: number) => new Date(Date.now() + days * day)

// ISO week key (YYYY-Www), mirroring the private `isoWeekKey` in
// autoReminders.ts (copied from dashboardF8's N2 tests).
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

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixtureMembershipIds: mongoose.Types.ObjectId[] = []

let supplier: any
let staff: any
let driver: any
let location: any
let car: any

const makeBooking = async (
  label: string,
  opts: {
    from: Date, to: Date, price: number, deposit?: number,
    lifecycle?: bookcarsTypes.ContractLifecycle, status?: bookcarsTypes.BookingStatus,
    expireAt?: Date, mode?: bookcarsTypes.CheckoutPaymentMode,
    cancellationRecord?: Record<string, unknown>,
  },
) => {
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: opts.from, to: opts.to,
    status: opts.status || bookcarsTypes.BookingStatus.Pending,
    lifecycle: opts.lifecycle || bookcarsTypes.ContractLifecycle.Draft,
    price: opts.price,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
      mode: opts.mode || bookcarsTypes.CheckoutPaymentMode.Deposit,
      rentalTotal: opts.price, depositAmount: opts.deposit || 0,
      amountDueNow: opts.price, amountDueNowInPaymentCurrency: opts.price, quotedAt: new Date(),
    },
    ...(opts.expireAt ? { expireAt: opts.expireAt } : {}),
    ...(opts.cancellationRecord ? { cancellationRecord: opts.cancellationRecord } : {}),
  } as any)
  fixtureBookingIds.push(booking._id)
  return booking
}

const deliveries = (filter: Record<string, unknown>) =>
  NotificationDelivery.find({ supplier: supplier._id, ...filter }).lean()

beforeAll(async () => {
  ;({ runAutoReminderPass } = await import('../src/utils/autoReminders'))
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'w32-admin', email: `w32-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(admin._id)
  stripeRefundCreate.mockResolvedValue({ id: 're_w32_test' })
  paypalRefundCapture.mockResolvedValue({})

  supplier = await User.create({
    email: `w32-supplier-${rand()}@test.bookcars.ma`, fullName: 'W3.2 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  staff = await User.create({
    email: `w32-staff-${rand()}@test.bookcars.ma`, fullName: 'W3.2 Staff',
    language: 'en', type: bookcarsTypes.UserType.Staff, active: true, verified: true, blacklisted: false,
    password: passwordHash,
  })
  fixtureUserIds.push(staff._id)
  const membership = await AgencyMembership.create({
    supplier: supplier._id, user: staff._id, role: bookcarsTypes.AgencyRole.Manager,
    status: bookcarsTypes.AgencyMembershipStatus.Active, activatedAt: new Date(),
  })
  fixtureMembershipIds.push(membership._id)
  driver = await User.create({
    email: `w32-driver-${rand()}@test.bookcars.ma`, fullName: 'W3.2 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `W3.2 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'W3.2 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
})

afterEach(async () => {
  await NotificationDelivery.deleteMany({ supplier: supplier._id })
  await Notification.deleteMany({ user: { $in: [supplier._id, staff._id, driver._id] } })
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  fixtureBookingIds.length = 0
  jest.resetAllMocks()
  mailSendMock.mockResolvedValue({ messageId: 'w32-test-message-id' })
})

afterAll(async () => {
  await NotificationDelivery.deleteMany({ supplier: supplier._id })
  await AgencyMembership.deleteMany({ _id: { $in: fixtureMembershipIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})

describe('GH-03 / GH-14 / GH-11 — Wave 3.2 reminder events', () => {
  it('hold-expiring fires to staff (in-app) and to the customer (email, amount + deadline)', async () => {
    const booking = await makeBooking('hold', {
      from: at(1), to: at(3), price: 300, deposit: 50,
      expireAt: new Date(Date.now() + 12 * 60 * 60 * 1000), mode: bookcarsTypes.CheckoutPaymentMode.PayLater,
    })
    const result = await runAutoReminderPass(new Date(), { force: true })
    expect(result.holdExpiring).toBeGreaterThanOrEqual(1)
    const staffRows = await deliveries({ templateKey: 'auto.holdExpiring', subjectId: String(booking._id), channel: 'inApp', status: 'sent' })
    expect(staffRows.length).toBeGreaterThanOrEqual(1)
    expect(staffRows[0].body).toMatch(/300/)
    const customerRows = await deliveries({ templateKey: 'auto.holdExpiring', subjectId: String(booking._id), channel: 'email', recipient: driver._id, status: 'sent' })
    expect(customerRows).toHaveLength(1)
    expect(customerRows[0].body).toMatch(/300/)
    // A second pass the same day does not re-send (one notice per
    // hold deadline).
    await runAutoReminderPass(new Date(), { force: true })
    expect((await deliveries({ templateKey: 'auto.holdExpiring', subjectId: String(booking._id), channel: 'inApp', status: 'sent' })).length)
      .toBe(staffRows.length)
  })

  it('payment-due-before-pickup fires for a pickup-tomorrow booking with a balance', async () => {
    const booking = await makeBooking('due', { from: at(1), to: at(3), price: 500, deposit: 0 })
    const result = await runAutoReminderPass(new Date(), { force: true })
    expect(result.paymentDue).toBeGreaterThanOrEqual(1)
    const staffRows = await deliveries({ templateKey: 'auto.paymentDue', subjectId: String(booking._id), channel: 'inApp', status: 'sent' })
    expect(staffRows.length).toBeGreaterThanOrEqual(1)
    expect(staffRows[0].body).toMatch(/500/)
    const customerRows = await deliveries({ templateKey: 'auto.paymentDue', subjectId: String(booking._id), channel: 'email', recipient: driver._id, status: 'sent' })
    expect(customerRows).toHaveLength(1)
  })

  it('missed-pickup fires daily and re-fires the next day until resolved', async () => {
    const booking = await makeBooking('missed', {
      from: at(-1), to: at(2), price: 400, deposit: 0,
      lifecycle: bookcarsTypes.ContractLifecycle.Confirmed, status: bookcarsTypes.BookingStatus.Pending,
    })
    const day1 = new Date()
    const result1 = await runAutoReminderPass(day1, { force: true })
    expect(result1.missedPickup).toBeGreaterThanOrEqual(1)
    const key1 = `missed-pickup:${booking._id}:${day1.toISOString().slice(0, 10)}`
    expect((await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(booking._id), dedupeKey: key1, channel: 'inApp', status: 'sent' })).length)
      .toBeGreaterThanOrEqual(1)
    // Same day, second pass: no re-send.
    await runAutoReminderPass(day1, { force: true })
    expect((await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(booking._id), channel: 'inApp', status: 'sent' })).length)
      .toBeGreaterThanOrEqual(1)
    const before = (await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(booking._id), channel: 'inApp', status: 'sent' })).length
    // Next day: it re-fires.
    const day2 = new Date(day1.getTime() + day)
    const result2 = await runAutoReminderPass(day2, { force: true })
    expect(result2.missedPickup).toBeGreaterThanOrEqual(1)
    const key2 = `missed-pickup:${booking._id}:${day2.toISOString().slice(0, 10)}`
    expect((await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(booking._id), dedupeKey: key2, channel: 'inApp', status: 'sent' })).length)
      .toBeGreaterThanOrEqual(1)
    expect((await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(booking._id), channel: 'inApp', status: 'sent' })).length)
      .toBeGreaterThan(before)
  })

  it('overdue repeats weekly (not once-ever) and the message carries the repeat count', async () => {
    const booking = await makeBooking('overdue', { from: at(-5), to: at(-2), price: 200, deposit: 0 })
    const week1 = new Date()
    await runAutoReminderPass(week1, { force: true })
    const key1 = `overdue:${booking._id}:${isoWeekKey(week1)}`
    const rows1 = await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: key1, channel: 'inApp', status: 'sent' })
    expect(rows1.length).toBeGreaterThanOrEqual(1)
    expect(rows1[0].body).toMatch(/reminder #1/)
    // Same week, second pass: no re-send.
    await runAutoReminderPass(week1, { force: true })
    expect((await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: key1, channel: 'inApp', status: 'sent' })).length)
      .toBe(rows1.length)
    // Next week: it repeats, and the count is now #2.
    const week2 = new Date(week1.getTime() + 7 * day)
    await runAutoReminderPass(week2, { force: true })
    const key2 = `overdue:${booking._id}:${isoWeekKey(week2)}`
    const rows2 = await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: key2, channel: 'inApp', status: 'sent' })
    expect(rows2.length).toBeGreaterThanOrEqual(1)
    expect(rows2[0].body).toMatch(/reminder #2/)
  })

  it('overdue at 30+ days escalates to the owner only', async () => {
    const booking = await makeBooking('escalate', { from: at(-40), to: at(-35), price: 200, deposit: 0 })
    const result = await runAutoReminderPass(new Date(), { force: true })
    expect(result.overdueEscalated).toBeGreaterThanOrEqual(1)
    const ownerRows = await deliveries({ templateKey: 'auto.overdueEscalate', subjectId: String(booking._id), recipient: supplier._id, channel: 'inApp', status: 'sent' })
    expect(ownerRows).toHaveLength(1)
    expect(ownerRows[0].body).toMatch(/35/)
    const staffRows = await deliveries({ templateKey: 'auto.overdueEscalate', subjectId: String(booking._id), recipient: staff._id })
    expect(staffRows).toHaveLength(0)
  })

  it('pending-refund reminds the owner daily until resolved', async () => {
    const booking = await makeBooking('refund', {
      from: at(-5), to: at(-2), price: 500, deposit: 250,
      status: bookcarsTypes.BookingStatus.Cancelled, lifecycle: bookcarsTypes.ContractLifecycle.Cancelled,
      cancellationRecord: {
        reason: 'Customer asked to cancel', cancelledBy: supplier._id,
        cancelledAt: new Date('2026-11-20T10:00:00.000Z'),
        refundDecision: 'manual', refundStatus: 'pending',
        rentPaid: 500, depositPaid: 250, refundedRent: 0, refundedDeposit: 0, refundProviderReferences: [],
      },
    })
    const day1 = new Date()
    const result1 = await runAutoReminderPass(day1, { force: true })
    expect(result1.pendingRefunds).toBeGreaterThanOrEqual(1)
    const ownerRows = await deliveries({ templateKey: 'auto.pendingRefund', subjectId: String(booking._id), recipient: supplier._id, channel: 'inApp', status: 'sent' })
    expect(ownerRows).toHaveLength(1)
    expect(ownerRows[0].body).toMatch(/750/)
    // Next day it re-fires; staff get nothing.
    const day2 = new Date(day1.getTime() + day)
    await runAutoReminderPass(day2, { force: true })
    expect((await deliveries({ templateKey: 'auto.pendingRefund', subjectId: String(booking._id), recipient: supplier._id, channel: 'inApp', status: 'sent' })).length).toBe(2)
    expect((await deliveries({ templateKey: 'auto.pendingRefund', subjectId: String(booking._id), recipient: staff._id }))).toHaveLength(0)
    // Resolved: no more reminders.
    await Booking.updateOne({ _id: booking._id }, { $set: { 'cancellationRecord.refundStatus': 'refunded' } })
    const day3 = new Date(day2.getTime() + day)
    await runAutoReminderPass(day3, { force: true })
    expect((await deliveries({ templateKey: 'auto.pendingRefund', subjectId: String(booking._id), recipient: supplier._id, channel: 'inApp', status: 'sent' })).length).toBe(2)
  })

  it('new templates render in the owner language with real values', () => {
    const rendered = renderNotificationTemplate('auto.holdExpiring' as bookcarsTypes.NotificationTemplateKey, 'fr', {
      date: '2026-11-25', car: 'Clio (AA-123-AA)', driver: 'Jane Doe', amount: 300, currency: 'MAD',
    })
    expect(rendered.body).toMatch(/300 MAD/)
    expect(rendered.body).toMatch(/2026-11-25/)
    const overdue = renderNotificationTemplate('auto.overdue', 'fr', {
      date: '2026-11-20', car: 'Clio (AA-123-AA)', driver: 'Jane Doe', amount: 200, currency: 'MAD', repeatCount: 3, days: 17,
    })
    expect(overdue.body).toMatch(/n°3/)
  })
})
