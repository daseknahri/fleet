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
import MaintenanceSchedule from '../src/models/MaintenanceSchedule'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import AgencyMembership from '../src/models/AgencyMembership'
import Reminder from '../src/models/Reminder'
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
  skipped: boolean, pickups: number, returns: number, holdExpiring: number, paymentDue: number,
  missedPickup: number, overdue: number, overdueEscalated: number, confirmedUnpaid: number,
  expiries: number, recaps: number, staleWorkOrders: number, pendingRefunds: number,
}>
let notifyReminderFired: (reminder: any, occurrenceAt: Date, offsetHours: number) => Promise<{
  inAppCount: number, emailCount: number, pushCount: number, recipientCount: number,
}>

const day = 86400000
const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const at = (days: number) => new Date(Date.now() + days * day)

// GH-22 — Casablanca wall-day key, mirroring the private `dateKey` in
// autoReminders.ts (Africa/Casablanca, not UTC). July 2026 is UTC+1;
// after the 2026-09-20 permanent return to GMT the zone equals UTC in
// November, so November dates cannot discriminate the two keys.
// ISO week key (YYYY-Www), mirroring the private `isoWeekKey` in
// autoReminders.ts (copied from dashboardF8's N2 tests) — wall-based
// since GH-22: the week is computed from the Casablanca wall date.
const CASABLANCA_TZ = 'Africa/Casablanca'
const dateKey = (date: Date | string): string => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CASABLANCA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
const isoWeekKey = (date: Date): string => {
  const wall = new Date(dateKey(date)) // Casablanca YYYY-MM-DD as a UTC-midnight instant; calendar maths only
  const d = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()))
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
const fixtureScheduleIds: mongoose.Types.ObjectId[] = []
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
  ;({ notifyReminderFired } = await import('../src/utils/reminderNotify'))
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
  await MaintenanceSchedule.deleteMany({ _id: { $in: fixtureScheduleIds } })
  fixtureScheduleIds.length = 0
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
    const key1 = `missed-pickup:${booking._id}:${dateKey(day1)}`
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
    const key2 = `missed-pickup:${booking._id}:${dateKey(day2)}`
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
    // Next week: it repeats, and the count is now #5 - R2-B19 counts
    // reminders SENT (one weekly pass sends 4 auto.overdue rows: 2
    // recipients x in-app + email), not weeks overdue.
    const week2 = new Date(week1.getTime() + 7 * day)
    await runAutoReminderPass(week2, { force: true })
    const key2 = `overdue:${booking._id}:${isoWeekKey(week2)}`
    const rows2 = await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: key2, channel: 'inApp', status: 'sent' })
    expect(rows2.length).toBeGreaterThanOrEqual(1)
    expect(rows2[0].body).toMatch(/reminder #5/)
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

describe('GH-22 — Casablanca wall days', () => {
  // July 2026: Casablanca is UTC+1 (before the 2026-09-20 permanent
  // return to GMT). In November 2026 the zone equals UTC, so November
  // dates cannot discriminate the UTC key from the wall key — these
  // cases use July dates on purpose.
  it('pickup at 00:30 Casablanca fires once on the Casablanca day, with the Casablanca date', async () => {
    const pickup = new Date('2026-07-05T23:30:00.000Z') // Mon 2026-07-06 00:30 Casablanca, Sun 23:30 UTC
    const booking = await makeBooking('gh22-pickup', {
      from: pickup, to: new Date('2026-07-07T23:30:00.000Z'), price: 300, deposit: 0,
    })
    const now1 = new Date('2026-07-05T23:00:00.000Z') // Sun 23:00 UTC = Mon 00:00 Casablanca
    await runAutoReminderPass(now1, { force: true })
    const key = `pickup:${booking._id}:2026-07-06`
    const rows = await deliveries({ templateKey: 'auto.pickup', subjectId: String(booking._id), dedupeKey: key, channel: 'inApp', status: 'sent' })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0].body).toContain('2026-07-06')
    expect(rows[0].body).not.toContain('2026-07-05')
    // Second pass the same Casablanca day (Mon 00:45 Casablanca): the
    // claim is taken, no re-send.
    await runAutoReminderPass(new Date('2026-07-05T23:45:00.000Z'), { force: true })
    expect((await deliveries({ templateKey: 'auto.pickup', subjectId: String(booking._id), dedupeKey: key, channel: 'inApp', status: 'sent' })).length)
      .toBe(rows.length)
  })

  it('overdue weekly repeat keys on the Casablanca week, not the UTC week', async () => {
    const booking = await makeBooking('gh22-overdue', {
      from: new Date('2026-06-30T10:00:00.000Z'), to: new Date('2026-07-03T10:00:00.000Z'), price: 200, deposit: 0,
    })
    // Sun 2026-07-05 23:30 UTC = Mon 2026-07-06 00:30 Casablanca:
    // UTC week 27, Casablanca week 28.
    await runAutoReminderPass(new Date('2026-07-05T23:30:00.000Z'), { force: true })
    const key1 = `overdue:${booking._id}:2026-W28`
    const rows1 = await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: key1, channel: 'inApp', status: 'sent' })
    expect(rows1.length).toBeGreaterThanOrEqual(1)
    expect(rows1[0].body).toMatch(/reminder #1/)
    // The UTC-week key must NOT exist: the old code would have claimed W27.
    expect((await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: `overdue:${booking._id}:2026-W27`, channel: 'inApp', status: 'sent' }))).toHaveLength(0)
    // Same Casablanca week (Mon 01:00 UTC = 02:00 Casablanca): no re-send.
    await runAutoReminderPass(new Date('2026-07-06T01:00:00.000Z'), { force: true })
    expect((await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: key1, channel: 'inApp', status: 'sent' })).length)
      .toBe(rows1.length)
    // Next Casablanca week: repeats, count #5 - R2-B19 counts
    // reminders SENT (4 per weekly pass), not weeks overdue.
    await runAutoReminderPass(new Date('2026-07-13T01:00:00.000Z'), { force: true })
    const key2 = `overdue:${booking._id}:2026-W29`
    const rows2 = await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: key2, channel: 'inApp', status: 'sent' })
    expect(rows2.length).toBeGreaterThanOrEqual(1)
    expect(rows2[0].body).toMatch(/reminder #5/)
  })

  it('R3-06 weekly recap counts the Casablanca week, not the previous UTC week', async () => {
    // W30 (Mon 2026-07-20 .. Sun 2026-07-26): no earlier test runs a
    // pass in this week, so its recap is unclaimed (W28's recap is
    // already claimed by the overdue test's pass at the same instant
    // the pack suggested, 2026-07-05T23:30Z). Two pickups inside the
    // week, one in the previous week — the old process-local window
    // (Mon 07-13 .. Sun 07-19) would count 1, the Casablanca window
    // (Mon 07-20 .. Sun 07-26) counts 2.
    await makeBooking('gh22-recap-in-1', {
      from: new Date('2026-07-20T09:00:00.000Z'), to: new Date('2026-07-22T09:00:00.000Z'), price: 300, deposit: 0,
    })
    await makeBooking('gh22-recap-in-2', {
      from: new Date('2026-07-21T09:00:00.000Z'), to: new Date('2026-07-23T09:00:00.000Z'), price: 300, deposit: 0,
    })
    await makeBooking('gh22-recap-prev', {
      from: new Date('2026-07-13T09:00:00.000Z'), to: new Date('2026-07-15T09:00:00.000Z'), price: 300, deposit: 0,
    })
    // Independent expectation: live bookings whose pickup falls in the
    // hardcoded Casablanca week Mon 2026-07-20 .. Sun 2026-07-26.
    const expected = await Booking.countDocuments({
      supplier: supplier._id,
      status: { $nin: [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled] },
      lifecycle: { $ne: bookcarsTypes.ContractLifecycle.Completed },
      deletedAt: null,
      from: { $gte: new Date('2026-07-20T00:00:00.000Z'), $lte: new Date('2026-07-26T23:59:59.999Z') },
    })
    expect(expected).toBe(2)
    // Sun 2026-07-19 23:30 UTC = Mon 2026-07-20 00:30 Casablanca:
    // the recap fires for the new Casablanca week (W30).
    const result = await runAutoReminderPass(new Date('2026-07-19T23:30:00.000Z'), { force: true })
    expect(result.recaps).toBeGreaterThanOrEqual(1)
    const rows = await deliveries({ templateKey: 'weekly.recap', subjectId: String(supplier._id), dedupeKey: 'weekly:2026-W30', channel: 'inApp', status: 'sent' })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const m = rows[0].body.match(/This week: (\d+) pickups/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(expected)
  })
})

describe('GH-19 — schedules of trashed cars do not notify', () => {
  it('notifies for a live car schedule, never for a trashed car schedule or its documents', async () => {
    const yesterday = at(-1)
    // Trashed car T: its insurance also expired yesterday, so the car
    // loop would fire for it as well if it did not filter deletedAt.
    const trashedCar = await Car.create({
      name: 'GH-19 trashed car', supplier: supplier._id, minimumAge: 21,
      locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
      type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
      aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
      mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
      collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
      range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
      insuranceExpiryDate: yesterday, deletedAt: new Date(),
    } as any)
    fixtureCarIds.push(trashedCar._id)
    const makeSchedule = async (carId: mongoose.Types.ObjectId, label: string) => {
      const schedule = await MaintenanceSchedule.create({
        supplier: supplier._id, car: carId,
        type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
        title: `GH-19 ${label}`,
        status: bookcarsTypes.MaintenanceScheduleStatus.Upcoming,
        nextDueDate: yesterday,
      } as any)
      fixtureScheduleIds.push(schedule._id)
      return schedule
    }
    const liveSchedule = await makeSchedule(car._id, 'live')
    const trashedSchedule = await makeSchedule(trashedCar._id, 'trashed')

    await runAutoReminderPass(new Date(), { force: true })

    const liveRows = await deliveries({ templateKey: 'auto.expiry', subjectType: 'maintenance-schedule', subjectId: String(liveSchedule._id) })
    expect(liveRows.length).toBeGreaterThanOrEqual(1)
    const trashedRows = await deliveries({ templateKey: 'auto.expiry', subjectType: 'maintenance-schedule', subjectId: String(trashedSchedule._id) })
    expect(trashedRows).toHaveLength(0)
    // Car-document expiry rows for the trashed car are absent too
    // (already true — the car loop filters deletedAt — this locks the
    // asymmetry closed on both loops).
    const trashedCarRows = await deliveries({ templateKey: 'auto.expiry', subjectType: 'car', subjectId: String(trashedCar._id) })
    expect(trashedCarRows).toHaveLength(0)
  })
})

describe('GH-35 — in-app rows carry their subject (deep links)', () => {
  it("a pickup event's in-app row carries booking + subjectType/subjectId = booking/id", async () => {
    const booking = await makeBooking('gh35-pickup', {
      from: new Date(Date.now() + 2 * 60 * 60 * 1000), to: at(3), price: 300, deposit: 0,
    })
    await runAutoReminderPass(new Date(), { force: true })
    const rows = await deliveries({ templateKey: 'auto.pickup', subjectId: String(booking._id), channel: 'inApp', status: 'sent' })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const notes = await Notification.find({ user: supplier._id, subjectId: String(booking._id) }).lean()
    expect(notes.length).toBeGreaterThanOrEqual(1)
    expect(notes[0].subjectType).toBe('booking')
    expect(String(notes[0].booking)).toBe(String(booking._id))
  })

  it("a schedule-due event's in-app row carries subjectType = maintenance-schedule (no booking/car field)", async () => {
    const schedule = await MaintenanceSchedule.create({
      supplier: supplier._id, car: car._id,
      type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
      title: 'GH-35 oil change',
      status: bookcarsTypes.MaintenanceScheduleStatus.Upcoming,
      nextDueDate: at(-1),
    } as any)
    fixtureScheduleIds.push(schedule._id)
    await runAutoReminderPass(new Date(), { force: true })
    const rows = await deliveries({ templateKey: 'auto.expiry', subjectType: 'maintenance-schedule', subjectId: String(schedule._id) })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const notes = await Notification.find({ user: supplier._id, subjectId: String(schedule._id) }).lean()
    expect(notes.length).toBeGreaterThanOrEqual(1)
    expect(notes[0].subjectType).toBe('maintenance-schedule')
    expect(notes[0].booking).toBeFalsy()
    expect(notes[0].car).toBeFalsy()
  })

  // R2-B01 - a failed AUTO delivery releases its claim (re-claimable
  // next pass); a failed MANUAL reminder keeps its failed row for the
  // retry endpoint.
  it('R2-B01 failed auto delivery is retried next pass; failed manual reminder keeps its failed row', async () => {
    const booking = await makeBooking('b01-hold', { from: at(1), to: at(3), price: 300, deposit: 0, expireAt: at(0.5), mode: bookcarsTypes.CheckoutPaymentMode.PayLater })
    mailSendMock.mockRejectedValue(new Error('smtp down'))
    try {
      await runAutoReminderPass(new Date(), { force: true })
      // No failed auto rows: the claim is released, not recorded failed.
      expect((await deliveries({ templateKey: 'auto.holdExpiring', subjectId: String(booking._id), channel: 'email', status: 'failed' })).length).toBe(0)
      // In-app still delivered; email delivered nothing yet.
      expect((await deliveries({ templateKey: 'auto.holdExpiring', subjectId: String(booking._id), channel: 'inApp', status: 'sent' })).length).toBeGreaterThanOrEqual(1)
      expect((await deliveries({ templateKey: 'auto.holdExpiring', subjectId: String(booking._id), channel: 'email', status: 'sent' })).length).toBe(0)
      // Mailer back: the next pass delivers the email legs.
      mailSendMock.mockResolvedValue({ messageId: 'w32-test-message-id' })
      await runAutoReminderPass(new Date(), { force: true })
      expect((await deliveries({ templateKey: 'auto.holdExpiring', subjectId: String(booking._id), channel: 'email', status: 'sent' })).length).toBeGreaterThanOrEqual(1)
      expect((await deliveries({ templateKey: 'auto.holdExpiring', subjectId: String(booking._id), channel: 'email', status: 'failed' })).length).toBe(0)
    } finally {
      mailSendMock.mockResolvedValue({ messageId: 'w32-test-message-id' })
    }
    // Manual reminder: mailer down again, the failed row STAYS.
    mailSendMock.mockRejectedValue(new Error('smtp down'))
    let reminder: any
    try {
      reminder = await Reminder.create({
        supplier: supplier._id, title: 'R2-B01 manual', category: bookcarsTypes.ReminderCategory.Custom,
        linkType: bookcarsTypes.ReminderLinkType.None, recurrence: { kind: bookcarsTypes.ReminderRecurrenceKind.Once },
        firstDueAt: new Date(), channels: { inApp: true, email: true, push: false }, active: true,
      })
      await notifyReminderFired(reminder, new Date(), 0)
      expect((await deliveries({ templateKey: 'reminder.manual', subjectId: String(reminder._id), channel: 'email', status: 'failed' })).length).toBeGreaterThanOrEqual(1)
    } finally {
      mailSendMock.mockResolvedValue({ messageId: 'w32-test-message-id' })
      if (reminder) {
        await Reminder.deleteOne({ _id: reminder._id })
      }
    }
  })

  // R2-B06 - the owner's master email toggle gates the customer leg too.
  it('R2-B06 owner email toggle off suppresses customer + staff emails, in-app still fires', async () => {
    const booking = await makeBooking('b06-hold', { from: at(1), to: at(3), price: 300, deposit: 0, expireAt: at(0.5), mode: bookcarsTypes.CheckoutPaymentMode.PayLater })
    await User.updateOne({ _id: supplier._id }, { enableEmailNotifications: false })
    try {
      await runAutoReminderPass(new Date(), { force: true })
      expect((await deliveries({ templateKey: 'auto.holdExpiring', subjectId: String(booking._id), channel: 'email' })).length).toBe(0)
      expect((await deliveries({ templateKey: 'auto.holdExpiring', subjectId: String(booking._id), channel: 'inApp', status: 'sent' })).length).toBeGreaterThanOrEqual(1)
    } finally {
      await User.updateOne({ _id: supplier._id }, { enableEmailNotifications: true })
    }
    // Toggle back on: a fresh booking's hold email now sends.
    const booking2 = await makeBooking('b06-hold-on', { from: at(1), to: at(3), price: 300, deposit: 0, expireAt: at(0.5), mode: bookcarsTypes.CheckoutPaymentMode.PayLater })
    await runAutoReminderPass(new Date(), { force: true })
    expect((await deliveries({ templateKey: 'auto.holdExpiring', subjectId: String(booking2._id), channel: 'email', status: 'sent' })).length).toBeGreaterThanOrEqual(1)
  })

  // R2-B07 - payment-due covers today AND tomorrow, once per day.
  it('R2-B07 payment-due fires for pickups today and tomorrow, not 3 days out, once per day', async () => {
    const today = await makeBooking('b07-today', { from: at(0), to: at(2), price: 300, deposit: 0 })
    const tomorrow = await makeBooking('b07-tomorrow', { from: at(1), to: at(3), price: 300, deposit: 0 })
    const later = await makeBooking('b07-later', { from: at(3), to: at(5), price: 300, deposit: 0 })
    await runAutoReminderPass(new Date(), { force: true })
    expect((await deliveries({ templateKey: 'auto.paymentDue', subjectId: String(today._id), status: 'sent' })).length).toBeGreaterThanOrEqual(1)
    expect((await deliveries({ templateKey: 'auto.paymentDue', subjectId: String(tomorrow._id), status: 'sent' })).length).toBeGreaterThanOrEqual(1)
    expect((await deliveries({ templateKey: 'auto.paymentDue', subjectId: String(later._id) })).length).toBe(0)
    const countBefore = (await deliveries({ templateKey: 'auto.paymentDue', subjectId: String(today._id), status: 'sent' })).length
    await runAutoReminderPass(new Date(), { force: true })
    expect((await deliveries({ templateKey: 'auto.paymentDue', subjectId: String(today._id), status: 'sent' })).length).toBe(countBefore)
  })

  // R2-B08 - missed-pickup chase stops after 7 days, and on no-show / handover.
  it('R2-B08 missed-pickup chase is bounded at 7 days and ends on no-show or handover', async () => {
    const recent = await makeBooking('b08-recent', { from: at(-3), to: at(-1), price: 300, deposit: 0 })
    const edge = await makeBooking('b08-edge', { from: at(-7), to: at(-5), price: 300, deposit: 0 })
    const old = await makeBooking('b08-old', { from: at(-8), to: at(-6), price: 300, deposit: 0 })
    const noShow = await makeBooking('b08-noshow', { from: at(-3), to: at(-1), price: 300, deposit: 0 })
    await Booking.updateOne({ _id: noShow._id }, { noShowAt: new Date() })
    const handed = await makeBooking('b08-handed', { from: at(-3), to: at(-1), price: 300, deposit: 0, lifecycle: bookcarsTypes.ContractLifecycle.Active })
    await runAutoReminderPass(new Date(), { force: true })
    expect((await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(recent._id), status: 'sent' })).length).toBeGreaterThanOrEqual(1)
    expect((await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(edge._id), status: 'sent' })).length).toBeGreaterThanOrEqual(1)
    expect((await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(old._id) })).length).toBe(0)
    expect((await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(noShow._id) })).length).toBe(0)
    expect((await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(handed._id) })).length).toBe(0)
  })

  // R2-B14 - pass counts are deliveries, not attempts.
  it('R2-B14 pass counts are deliveries, not attempts', async () => {
    const booking = await makeBooking('b14-pickup', { from: at(0), to: at(2), price: 300, deposit: 0 })
    const r1 = await runAutoReminderPass(new Date(), { force: true })
    // 2 recipients (supplier + staff) x in-app + email = 4; push has no
    // tokens, so it delivers 0 and counts 0.
    expect(r1.pickups).toBe(4)
    // Immediate second pass: every claim already taken, all counts 0.
    const r2 = await runAutoReminderPass(new Date(), { force: true })
    expect(r2.pickups).toBe(0)
    expect(r2.paymentDue).toBe(0)
    expect(r2.missedPickup).toBe(0)
    // Mailer down: email legs deliver 0, in-app still counts.
    mailSendMock.mockRejectedValue(new Error('smtp down'))
    try {
      const booking2 = await makeBooking('b14-mailer', { from: at(0), to: at(2), price: 300, deposit: 0 })
      const r3 = await runAutoReminderPass(new Date(), { force: true })
      expect(r3.pickups).toBe(2)
    } finally {
      mailSendMock.mockResolvedValue({ messageId: 'w32-test-message-id' })
    }
  })

  // R2-B19 - the repeat count counts reminders SENT, not weeks overdue.
  it('R2-B19 overdue repeat count counts reminders sent, not weeks overdue', async () => {
    const booking = await makeBooking('b19-missed-week', { from: at(-25), to: at(-22), price: 200, deposit: 0 })
    // One prior sent row, 22 days overdue (old formula would say #4).
    await NotificationDelivery.create({
      supplier: supplier._id, templateKey: 'auto.overdue', subjectType: 'booking',
      subjectId: String(booking._id), dedupeKey: `overdue:${booking._id}:2026-W01`,
      channel: 'inApp', recipient: supplier._id, subject: 'seed', body: 'reminder #1', status: 'sent',
    })
    const now = new Date()
    await runAutoReminderPass(now, { force: true })
    const key = `overdue:${booking._id}:${isoWeekKey(now)}`
    const rows = await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: key, channel: 'inApp', status: 'sent' })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0].body).toMatch(/reminder #2/)
    expect(rows[0].body).not.toMatch(/reminder #4/)
  })

  it('R2-B19 first overdue reminder is #1 with no prior rows', async () => {
    const booking = await makeBooking('b19-first', { from: at(-10), to: at(-8), price: 200, deposit: 0 })
    const now = new Date()
    await runAutoReminderPass(now, { force: true })
    const key = `overdue:${booking._id}:${isoWeekKey(now)}`
    const rows = await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: key, channel: 'inApp', status: 'sent' })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0].body).toMatch(/reminder #1/)
  })

  it('R6-29 the weekly recap in-app row carries subjectType supplier (lands on /payments)', async () => {
    // Fresh week W31: the pass at Sun 2026-07-26 23:30 UTC is Mon
    // 2026-07-27 00:30 Casablanca — no earlier test runs a pass in
    // this week (W30 is the R3-06 week), so its recap is unclaimed.
    const result = await runAutoReminderPass(new Date('2026-07-26T23:30:00.000Z'), { force: true })
    expect(result.recaps).toBeGreaterThanOrEqual(1)
    // The subjectType filter (not bare subjectId) is what makes the
    // test discriminate: earlier weeks' recap rows share the same
    // subjectId (the supplier).
    const notes = await Notification.find({ user: supplier._id, subjectType: 'supplier', subjectId: String(supplier._id) }).lean()
    expect(notes.length).toBeGreaterThanOrEqual(1)
  })
})

describe('R6-18 — autoReminders day windows on the Casablanca wall day', () => {
  // July 2026: Casablanca is UTC+1, so 00:30 local is 23:30Z the
  // previous UTC day. A 23:30Z pickup/return belongs to the NEXT
  // Casablanca wall day, not the UTC day of the timestamp.
  it('a 00:30-local pickup is not a missed pickup at 01:00 local that day, and is one the day after', async () => {
    const booking = await makeBooking('r618-missed', {
      from: new Date('2026-07-05T23:30:00.000Z'), // Mon 2026-07-06 00:30 Casablanca
      to: new Date('2026-07-07T23:30:00.000Z'), price: 300, deposit: 0,
    })
    // 01:00 local on the pickup day: the pickup has not been missed yet.
    await runAutoReminderPass(new Date('2026-07-06T00:00:00.000Z'), { force: true })
    expect((await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(booking._id), dedupeKey: `missed-pickup:${booking._id}:2026-07-06`, channel: 'inApp', status: 'sent' }))).toHaveLength(0)
    // 01:00 local the day after: the missed-pickup chase fires.
    await runAutoReminderPass(new Date('2026-07-07T00:00:00.000Z'), { force: true })
    const rows = await deliveries({ templateKey: 'auto.missedPickup', subjectId: String(booking._id), dedupeKey: `missed-pickup:${booking._id}:2026-07-07`, channel: 'inApp', status: 'sent' })
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  it('a 00:30-local return is not overdue at 01:00 local that day, and is overdue the day after', async () => {
    const booking = await makeBooking('r618-overdue', {
      from: new Date('2026-07-05T09:00:00.000Z'),
      to: new Date('2026-07-05T23:30:00.000Z'), // Mon 2026-07-06 00:30 Casablanca
      price: 200, deposit: 0,
    })
    // 01:00 local on the return day: the return is still today.
    await runAutoReminderPass(new Date('2026-07-06T00:00:00.000Z'), { force: true })
    expect((await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: `overdue:${booking._id}:2026-W28`, channel: 'inApp', status: 'sent' }))).toHaveLength(0)
    // 01:00 local the day after: the weekly overdue repeat fires.
    await runAutoReminderPass(new Date('2026-07-07T00:00:00.000Z'), { force: true })
    const rows = await deliveries({ templateKey: 'auto.overdue', subjectId: String(booking._id), dedupeKey: `overdue:${booking._id}:2026-W28`, channel: 'inApp', status: 'sent' })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0].body).toMatch(/reminder #1/)
  })

  it('daysOverdue counts Casablanca wall days: 29 at 01:00 local, 30 the day after (escalation renders the figure)', async () => {
    // The plain overdue template does not render `days`; the
    // escalation template does ("ESCALATION — N days overdue"), so
    // the 29/30 boundary is pinned through the escalation event.
    const booking = await makeBooking('r618-escalate', {
      from: new Date('2026-06-05T09:00:00.000Z'),
      to: new Date('2026-06-06T23:30:00.000Z'), // Sun 2026-06-07 00:30 Casablanca
      price: 200, deposit: 0,
    })
    // 01:00 local Mon 2026-07-06: 29 wall days overdue — no escalation.
    await runAutoReminderPass(new Date('2026-07-06T00:00:00.000Z'), { force: true })
    expect((await deliveries({ templateKey: 'auto.overdueEscalate', subjectId: String(booking._id), dedupeKey: `overdue-escalate:${booking._id}:2026-W28`, channel: 'inApp', status: 'sent' }))).toHaveLength(0)
    // 01:00 local Tue 2026-07-07: 30 wall days overdue — escalates.
    await runAutoReminderPass(new Date('2026-07-07T00:00:00.000Z'), { force: true })
    const rows = await deliveries({ templateKey: 'auto.overdueEscalate', subjectId: String(booking._id), dedupeKey: `overdue-escalate:${booking._id}:2026-W28`, channel: 'inApp', status: 'sent' })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0].body).toContain('30 days')
  })
})
