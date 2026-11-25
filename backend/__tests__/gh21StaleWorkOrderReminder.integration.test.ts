import 'dotenv/config'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import NotificationDelivery from '../src/models/NotificationDelivery'
import Notification from '../src/models/Notification'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import AgencyMembership from '../src/models/AgencyMembership'
import MaintenanceWorkOrder from '../src/models/MaintenanceWorkOrder'
import { renderNotificationTemplate } from '../src/utils/notificationTemplates'

// GH-21 - stale "Scheduled" work orders: reminder half. The list half
// lives in gh21StaleWorkOrder.integration.test.ts (split from the
// pack's single file: this half uses the Wave 3.2 harness and never
// boots the app, so the background reminder tick cannot claim the
// weekly dedupe first). N = 7 (STALE_WORK_ORDER_DAYS): the 8-day /
// 6-day seeds move with it.

const stripeRefundCreate: any = jest.fn()
const paypalGetOrder: any = jest.fn()
const paypalRefundCapture: any = jest.fn()
const mailSendMock: any = jest.fn(async () => ({ messageId: 'gh21-test-message-id' }))

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
  overdue: number, overdueEscalated: number, pendingRefunds: number, staleWorkOrders: number,
}>

const DAY = 86400000
const rand = () => Math.random().toString(36).slice(2)

// GH-22 wall-based ISO week key mirror (Casablanca wall calendar).
const CASABLANCA_TZ = 'Africa/Casablanca'
const dateKey = (date: Date | string): string => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CASABLANCA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
const isoWeekKey = (date: Date): string => {
  const wall = new Date(dateKey(date))
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
const fixtureMembershipIds: mongoose.Types.ObjectId[] = []
const fixtureWorkOrderIds: mongoose.Types.ObjectId[] = []

let supplier: any
let staff: any
let car: any

let wo8: any
let wo6: any
let woFuture: any
let woInProgress: any
let woTrashed: any

beforeAll(async () => {
  ;({ runAutoReminderPass } = await import('../src/utils/autoReminders'))
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')

  supplier = await User.create({
    email: `gh21-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-21 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  staff = await User.create({
    email: `gh21-staff-${rand()}@test.bookcars.ma`, fullName: 'GH-21 Staff',
    language: 'en', type: bookcarsTypes.UserType.Staff, active: true, verified: true, blacklisted: false,
    password: passwordHash,
  })
  fixtureUserIds.push(staff._id)
  const membership = await AgencyMembership.create({
    supplier: supplier._id, user: staff._id, role: bookcarsTypes.AgencyRole.Manager,
    status: bookcarsTypes.AgencyMembershipStatus.Active, activatedAt: new Date(),
  })
  fixtureMembershipIds.push(membership._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `GH-21 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'GH-21 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)

  const now = Date.now()
  const seed = async (label: string, start: Date, status: bookcarsTypes.WorkOrderStatus) => {
    const wo = await MaintenanceWorkOrder.create({
      supplier: supplier._id, car: car._id,
      type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
      title: `GH-21 ${label}`,
      status,
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + 2 * 3600000),
    } as any)
    fixtureWorkOrderIds.push(wo._id)
    return wo
  }
  wo8 = await seed('8 days', new Date(now - 8 * DAY), bookcarsTypes.WorkOrderStatus.Scheduled)
  wo6 = await seed('6 days', new Date(now - 6 * DAY), bookcarsTypes.WorkOrderStatus.Scheduled)
  woFuture = await seed('future', new Date(now + 7 * DAY), bookcarsTypes.WorkOrderStatus.Scheduled)
  woInProgress = await seed('in progress', new Date(now - 30 * DAY), bookcarsTypes.WorkOrderStatus.InProgress)
  // R3-02 — a trashed car with a stale Scheduled job on it.
  const trashedCar = await Car.create({
    name: 'GH-21 trashed car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(trashedCar._id)
  await Car.updateOne({ _id: trashedCar._id }, { $set: { deletedAt: new Date() } })
  woTrashed = await MaintenanceWorkOrder.create({
    supplier: supplier._id, car: trashedCar._id,
    type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
    title: 'GH-21 trashed 8 days',
    status: bookcarsTypes.WorkOrderStatus.Scheduled,
    scheduledStart: new Date(now - 8 * DAY),
    scheduledEnd: new Date(now - 8 * DAY + 2 * 3600000),
  } as any)
  fixtureWorkOrderIds.push(woTrashed._id)
})

afterEach(async () => {
  await NotificationDelivery.deleteMany({ supplier: supplier._id })
  await Notification.deleteMany({ user: { $in: [supplier._id, staff._id] } })
  jest.resetAllMocks()
  mailSendMock.mockResolvedValue({ messageId: 'gh21-test-message-id' })
})

afterAll(async () => {
  await NotificationDelivery.deleteMany({ supplier: supplier._id })
  await MaintenanceWorkOrder.deleteMany({ _id: { $in: fixtureWorkOrderIds } })
  await AgencyMembership.deleteMany({ _id: { $in: fixtureMembershipIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})

describe('GH-21 stale work order reminder', () => {
  const deliveries = (filter: Record<string, unknown>) =>
    NotificationDelivery.find({ supplier: supplier._id, ...filter }).lean()

  it('reminds weekly for the 8-day Scheduled job only, and renders in French', async () => {
    const now = new Date()
    await runAutoReminderPass(now, { force: true })

    const key = `stale-work-order:${wo8._id}:${isoWeekKey(now)}`
    const rows = await deliveries({ templateKey: 'auto.staleWorkOrder', subjectType: 'maintenance-work-order', subjectId: String(wo8._id), dedupeKey: key, channel: 'inApp', status: 'sent' })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0].body).toMatch(/8 days/)

    for (const other of [wo6, woFuture, woInProgress]) {
      expect((await deliveries({ templateKey: 'auto.staleWorkOrder', subjectType: 'maintenance-work-order', subjectId: String(other._id) }))).toHaveLength(0)
    }

    // Second pass the same week: weekly dedupe, no second delivery.
    await runAutoReminderPass(new Date(), { force: true })
    expect((await deliveries({ templateKey: 'auto.staleWorkOrder', subjectType: 'maintenance-work-order', subjectId: String(wo8._id), dedupeKey: key, channel: 'inApp', status: 'sent' })).length)
      .toBe(rows.length)
  })

  it('renders the French template with the title and the day count', () => {
    const rendered = renderNotificationTemplate('auto.staleWorkOrder' as bookcarsTypes.NotificationTemplateKey, 'fr', {
      title: 'GH-21 vidange', car: 'Clio (AA-123-AA)', days: 8, date: '2026-11-16',
    })
    expect(rendered.subject).toMatch(/GH-21 vidange/)
    expect(rendered.body).toMatch(/GH-21 vidange/)
    expect(rendered.body).toMatch(/8/)
  })

  it('R3-02: a trashed car\'s stale job never notifies', async () => {
    const result = await runAutoReminderPass(new Date(), { force: true })
    // No delivery row at all for the trashed job - not even a deduped
    // one. R2-B14: pass counts are DELIVERIES, not jobs. wo8
    // re-delivers in this pass (the file afterEach wipes the sent
    // rows, so the weekly dedupe from the earlier test is gone):
    // 2 recipients x inApp + email = 4; push fails. The trashed job
    // contributes 0.
    expect(result.staleWorkOrders).toBe(4)
  })
})
