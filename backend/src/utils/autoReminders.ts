import type { SendMailOptions } from 'nodemailer'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import Car from '../models/Car'
import MaintenanceSchedule from '../models/MaintenanceSchedule'
import User from '../models/User'
import { getContractReceivable, isOverdue } from './contractReceivable'
import * as logger from './logger'
import * as mailHelper from './mailHelper'
import { resolveScheduleDue } from './maintenanceSchedule'
import { renderNotificationTemplate } from './notificationTemplates'
import {
  autoReminderEmailAllowed,
  createInAppNotification,
  deliverNotification,
  resolveReminderRecipients,
  sendPush,
  weeklyRecapEmailAllowed,
} from './reminderNotify'

/**
 * F8 / W5 N2 — automatic pickup / return / overdue / expiry reminders
 * + the weekly recap, on the EXISTING notification channels (in-app,
 * email via the shared mailer, push via Expo). No SMS/WhatsApp adapter
 * is built here (N4, provider-gated).
 *
 * Runs from the existing 60 s reminder tick (reminderScheduler), but
 * the pass itself is throttled to at most once an hour — the tick
 * cadence is for manual reminders; a daily reminder must not re-fire
 * every minute. Re-runs are safe anyway: every event is claimed in
 * the delivery log (unique dedupe index) before it is sent, so a
 * second pass for the same day finds every claim already taken.
 *
 * Email gating (S2's consumers — toggles gate EMAIL ONLY):
 * - pickup / overdue: the owner's master boolean only;
 * - return: master + `returnsDue`;
 * - expiry: master + `carDueDates`;
 * - weekly recap: master + `weeklyRecap` (email to the owner only;
 *   the recap's in-app copy goes to all recipients).
 * In-app and push are unaffected by the toggles.
 */

// Throttle: at most one pass per hour (the tick calls every 60 s).
let lastPassAt = 0
const PASS_INTERVAL_MS = 60 * 60 * 1000

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
const addDays = (date: Date, days: number) => {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}
const dateKey = (date: Date | string) => new Date(date).toISOString().slice(0, 10)

// ISO week key (YYYY-Www) for the weekly-recap dedupe.
const isoWeekKey = (date: Date): string => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000))
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

const carLabel = (car: { name?: string, licensePlate?: string } | string | undefined): string => {
  if (!car) return '?'
  if (typeof car === 'string') return car
  return car.licensePlate ? `${car.name} (${car.licensePlate})` : car.name || '?'
}

const driverName = (booking: { driver?: { fullName?: string } | string | null }): string => {
  if (!booking.driver) return '?'
  return typeof booking.driver === 'string' ? booking.driver : booking.driver.fullName || '?'
}

interface AutoEvent {
  templateKey: bookcarsTypes.NotificationTemplateKey
  kind: 'pickup' | 'return' | 'overdue' | 'expiry' | 'confirmedUnpaid'
  subjectType: string
  subjectId: string
  dedupeKey: string
  vars: Record<string, string | number | undefined>
}

export interface AutoReminderPassResult {
  skipped: boolean
  agencies: number
  pickups: number
  returns: number
  overdue: number
  expiries: number
  recaps: number
  // Wave 2.1 — confirmed holds with an outstanding balance, reminded
  // once per day.
  confirmedUnpaid: number
}

const LIVE_BOOKING_FILTER = {
  status: { $nin: [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled] },
  lifecycle: { $ne: bookcarsTypes.ContractLifecycle.Completed },
  // GAP-C1/M1: no `expireAt: null` here — a pay-later hold carries
  // `expireAt` and is a live booking; Void/Cancelled are already
  // excluded by status above.
  deletedAt: null,
}

const fanoutEvent = async (
  supplierId: string,
  recipients: env.User[],
  owner: env.User | undefined,
  event: AutoEvent,
): Promise<void> => {
  const rendered = renderNotificationTemplate(event.templateKey, owner?.language, event.vars)
  const base = {
    templateKey: event.templateKey,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    dedupeKey: event.dedupeKey,
    subject: rendered.subject,
    body: rendered.body,
  }
  for (const recipient of recipients) {
    await deliverNotification(supplierId, { ...base, channel: 'inApp', recipient: recipient._id }, async () => {
      await createInAppNotification(recipient._id, rendered.body)
    })
  }
  if (autoReminderEmailAllowed(owner, event.kind)) {
    for (const recipient of recipients) {
      if (recipient.enableEmailNotifications === false || !recipient.email) {
        continue
      }
      await deliverNotification(supplierId, { ...base, channel: 'email', recipient: recipient._id }, async () => {
        const mailOptions: SendMailOptions = {
          from: env.SMTP_FROM,
          to: recipient.email,
          subject: rendered.subject,
          html: `<p>Hello ${recipient.fullName},<br><br>${rendered.body}<br><br>Regards<br></p>`,
        }
        const info = await mailHelper.sendMail(mailOptions)
        return info?.messageId as string | undefined
      })
    }
  }
  for (const recipient of recipients) {
    await deliverNotification(supplierId, { ...base, channel: 'push', recipient: recipient._id }, async () => {
      if (!(await sendPush(recipient, rendered.body, undefined))) {
        throw new Error('Push not delivered')
      }
    })
  }
}

const runPassForSupplier = async (supplierId: string, now: Date): Promise<Omit<AutoReminderPassResult, 'skipped' | 'agencies'>> => {
  const counts = { pickups: 0, returns: 0, overdue: 0, expiries: 0, recaps: 0, confirmedUnpaid: 0 }
  const recipients = await resolveReminderRecipients(supplierId)
  if (recipients.length === 0) {
    return counts
  }
  const owner = recipients.find((r) => String(r._id) === supplierId)

  const todayStart = startOfDay(now)
  const tomorrowEnd = endOfDay(addDays(now, 1))
  const horizon30 = endOfDay(addDays(now, 30))

  // -- Pickups: live bookings starting today or tomorrow. --------------
  const pickups = await Booking.find({
    ...LIVE_BOOKING_FILTER,
    supplier: supplierId,
    from: { $gte: todayStart, $lte: tomorrowEnd },
  }).populate('car', 'name licensePlate').populate('driver', 'fullName').lean()
  for (const booking of pickups) {
    const from = new Date(booking.from)
    const when = from.getTime() < startOfDay(addDays(now, 1)).getTime() ? 'today' : 'tomorrow'
    await fanoutEvent(supplierId, recipients, owner, {
      templateKey: 'auto.pickup',
      kind: 'pickup',
      subjectType: 'booking',
      subjectId: String(booking._id),
      dedupeKey: `pickup:${booking._id}:${dateKey(booking.from)}`,
      vars: {
        when,
        whenFr: when === 'today' ? "aujourd'hui" : 'demain',
        whenAr: when === 'today' ? 'اليوم' : 'غدًا',
        whenEs: when === 'today' ? 'hoy' : 'mañana',
        date: dateKey(booking.from),
        car: carLabel(booking.car as { name?: string, licensePlate?: string } | undefined),
        driver: driverName(booking as { driver?: { fullName?: string } | string | null }),
      },
    })
    counts.pickups += 1
  }

  // -- Returns: live bookings ending today or tomorrow. ----------------
  const returns = await Booking.find({
    ...LIVE_BOOKING_FILTER,
    supplier: supplierId,
    to: { $gte: todayStart, $lte: tomorrowEnd },
  }).populate('car', 'name licensePlate').populate('driver', 'fullName').lean()
  for (const booking of returns) {
    const to = new Date(booking.to)
    const when = to.getTime() < startOfDay(addDays(now, 1)).getTime() ? 'today' : 'tomorrow'
    await fanoutEvent(supplierId, recipients, owner, {
      templateKey: 'auto.return',
      kind: 'return',
      subjectType: 'booking',
      subjectId: String(booking._id),
      dedupeKey: `return:${booking._id}:${dateKey(booking.to)}`,
      vars: {
        when,
        whenFr: when === 'today' ? "aujourd'hui" : 'demain',
        whenAr: when === 'today' ? 'اليوم' : 'غدًا',
        whenEs: when === 'today' ? 'hoy' : 'mañana',
        date: dateKey(booking.to),
        car: carLabel(booking.car as { name?: string, licensePlate?: string } | undefined),
        driver: driverName(booking as { driver?: { fullName?: string } | string | null }),
      },
    })
    counts.returns += 1
  }

  // -- Overdue: live bookings whose rental ended, with an outstanding
  // balance under the ONE shared definition (contractReceivable). ------
  const ended = await Booking.find({
    ...LIVE_BOOKING_FILTER,
    supplier: supplierId,
    to: { $lt: todayStart },
  }).populate('car', 'name licensePlate').populate('driver', 'fullName').lean()
  let overdueAmount = 0
  for (const booking of ended) {
    const receivable = await getContractReceivable(booking as Pick<env.Booking, '_id' | 'price' | 'financialSnapshot' | 'to' | 'lifecycle'>)
    if (!isOverdue(receivable.outstandingBalance, receivable.dueAt, now)) {
      continue
    }
    overdueAmount += receivable.outstandingBalance
    await fanoutEvent(supplierId, recipients, owner, {
      templateKey: 'auto.overdue',
      kind: 'overdue',
      subjectType: 'booking',
      subjectId: String(booking._id),
      dedupeKey: `overdue:${booking._id}:${dateKey(booking.to)}`,
      vars: {
        date: dateKey(booking.to),
        car: carLabel(booking.car as { name?: string, licensePlate?: string } | undefined),
        driver: driverName(booking as { driver?: { fullName?: string } | string | null }),
        amount: receivable.outstandingBalance,
        currency: receivable.currency,
      },
    })
    counts.overdue += 1
  }

  // -- Confirmed, unpaid (Wave 2.1): Confirmed holds with an
  // outstanding balance — the daily nudge to chase the money before
  // pickup. One notice per booking per day (the dedupe key carries the
  // date). Legacy Reserved rows are NOT reminded here: they surface on
  // the watchlist with their confirm-or-cancel deadline instead.
  const confirmed = await Booking.find({
    ...LIVE_BOOKING_FILTER,
    supplier: supplierId,
    lifecycle: bookcarsTypes.ContractLifecycle.Confirmed,
    status: bookcarsTypes.BookingStatus.Pending,
  }).populate('car', 'name licensePlate').populate('driver', 'fullName').lean()
  for (const booking of confirmed) {
    const receivable = await getContractReceivable(booking as Pick<env.Booking, '_id' | 'price' | 'financialSnapshot' | 'to' | 'lifecycle'>)
    if (receivable.outstandingBalance <= 0) {
      continue
    }
    const confirmedAt = booking.confirmedAt ? new Date(booking.confirmedAt) : now
    const days = Math.max(0, Math.floor((now.getTime() - confirmedAt.getTime()) / 86400000))
    await fanoutEvent(supplierId, recipients, owner, {
      templateKey: 'auto.confirmedUnpaid',
      kind: 'confirmedUnpaid',
      subjectType: 'booking',
      subjectId: String(booking._id),
      dedupeKey: `confirmed-unpaid:${booking._id}:${dateKey(now)}`,
      vars: {
        car: carLabel(booking.car as { name?: string, licensePlate?: string } | undefined),
        driver: driverName(booking as { driver?: { fullName?: string } | string | null }),
        amount: receivable.outstandingBalance,
        currency: receivable.currency,
        days,
        date: dateKey(booking.from),
      },
    })
    counts.confirmedUnpaid += 1
  }

  // -- Expiry: car document dates within 30 days + open maintenance
  // schedules due (F7 merged date+mileage status). ---------------------
  const cars = await Car.find({ supplier: supplierId, deletedAt: null })
    .select('name licensePlate insuranceExpiryDate technicalInspectionExpiryDate vignetteExpiryDate documents').lean()
  for (const car of cars) {
    const fields: [string, Date | string | undefined][] = [
      ['Insurance', car.insuranceExpiryDate],
      ['Technical inspection', car.technicalInspectionExpiryDate],
      ['Vignette', car.vignetteExpiryDate],
    ]
    for (const [label, value] of fields) {
      if (!value) continue
      const date = new Date(value)
      if (date.getTime() > horizon30.getTime()) continue
      await fanoutEvent(supplierId, recipients, owner, {
        templateKey: 'auto.expiry',
        kind: 'expiry',
        subjectType: 'car',
        subjectId: String(car._id),
        dedupeKey: `expiry:${car._id}:${label}:${dateKey(date)}`,
        vars: { doc: label, date: dateKey(date), car: carLabel(car) },
      })
      counts.expiries += 1
    }
    for (const doc of car.documents || []) {
      if (!doc?.expiryDate) continue
      const date = new Date(doc.expiryDate)
      if (date.getTime() > horizon30.getTime()) continue
      const label = doc.kind ? `${doc.kind} document` : 'Document'
      await fanoutEvent(supplierId, recipients, owner, {
        templateKey: 'auto.expiry',
        kind: 'expiry',
        subjectType: 'car',
        subjectId: String(car._id),
        dedupeKey: `expiry:${car._id}:${label}:${dateKey(date)}`,
        vars: { doc: label, date: dateKey(date), car: carLabel(car) },
      })
      counts.expiries += 1
    }
  }
  const schedules = await MaintenanceSchedule.find({ supplier: supplierId })
    .populate('car', 'name licensePlate odometerKm').lean()
  for (const schedule of schedules) {
    if (schedule.status === bookcarsTypes.MaintenanceScheduleStatus.Completed) continue
    const due = resolveScheduleDue({
      nextDueDate: schedule.nextDueDate,
      nextDueMileage: schedule.nextDueMileage,
      intervalKm: schedule.intervalKm,
      lastServiceMileage: schedule.lastServiceMileage,
      status: schedule.status,
      car: typeof schedule.car === 'object' && schedule.car
        ? { odometerKm: (schedule.car as { odometerKm?: number | null }).odometerKm }
        : null,
    }, now)
    if (due.status !== bookcarsTypes.MaintenanceScheduleStatus.Due
      && due.status !== bookcarsTypes.MaintenanceScheduleStatus.Overdue) {
      continue
    }
    const carName = carLabel(schedule.car as { name?: string, licensePlate?: string } | string | undefined)
    // GAP-MAINT-P0-1 — the old dedupe key was
    // `expiry-schedule:<id>:<nextDueDate>`, and a km-only schedule's
    // due date defaulted to its creation day: the notice fired once
    // at creation (nothing due) and never when the odometer crossed.
    // The key now names the trigger (date or mileage) and the status,
    // so Due and Overdue are distinct events and a mileage crossing
    // fires its own notice. Mileage notices carry the km reading as
    // the template's date value ("expires on 50,000 km").
    const triggerKey = due.dueByMileage
      ? `mileage:${due.effectiveNextDueMileage}`
      : `date:${schedule.nextDueDate ? dateKey(schedule.nextDueDate) : 'none'}`
    const triggerLabel = due.dueByMileage
      ? `${due.effectiveNextDueMileage} km`
      : schedule.nextDueDate ? dateKey(schedule.nextDueDate) : ''
    await fanoutEvent(supplierId, recipients, owner, {
      templateKey: 'auto.expiry',
      kind: 'expiry',
      subjectType: 'maintenance-schedule',
      subjectId: String(schedule._id),
      dedupeKey: `expiry-schedule:${schedule._id}:${due.status}:${triggerKey}`,
      vars: { doc: `Maintenance: ${schedule.title}`, date: triggerLabel, car: carName },
    })
    counts.expiries += 1
  }

  // -- Weekly recap: once per ISO week, on Mondays. The dedupe claim
  // (one row per recipient per channel for the week key) makes it
  // exactly-once even if the pass runs several times that Monday.
  // Email goes to the owner only; the in-app copy goes to everyone.
  if (now.getDay() === 1) {
    const weekKey = isoWeekKey(now)
    const weekStart = startOfDay(addDays(now, -((now.getDay() + 6) % 7)))
    const weekEnd = endOfDay(addDays(weekStart, 6))
    const [weekPickups, weekReturns] = await Promise.all([
      Booking.countDocuments({ ...LIVE_BOOKING_FILTER, supplier: supplierId, from: { $gte: weekStart, $lte: weekEnd } }),
      Booking.countDocuments({ ...LIVE_BOOKING_FILTER, supplier: supplierId, to: { $gte: weekStart, $lte: weekEnd } }),
    ])
    const rendered = renderNotificationTemplate('weekly.recap', owner?.language, {
      pickups: weekPickups,
      returns: weekReturns,
      overdueCount: counts.overdue,
      overdueAmount,
      currency: env.BASE_CURRENCY.toUpperCase(),
      expiring: counts.expiries,
    })
    const base = {
      templateKey: 'weekly.recap' as bookcarsTypes.NotificationTemplateKey,
      subjectType: 'supplier',
      subjectId: supplierId,
      dedupeKey: `weekly:${weekKey}`,
      subject: rendered.subject,
      body: rendered.body,
    }
    for (const recipient of recipients) {
      const delivered = await deliverNotification(supplierId, { ...base, channel: 'inApp', recipient: recipient._id }, async () => {
        await createInAppNotification(recipient._id, rendered.body)
      })
      if (delivered) {
        counts.recaps += 1
      }
    }
    if (owner && weeklyRecapEmailAllowed(owner) && owner.email) {
      await deliverNotification(supplierId, { ...base, channel: 'email', recipient: owner._id }, async () => {
        const mailOptions: SendMailOptions = {
          from: env.SMTP_FROM,
          to: owner.email,
          subject: rendered.subject,
          html: `<p>Hello ${owner.fullName},<br><br>${rendered.body}<br><br>Regards<br></p>`,
        }
        const info = await mailHelper.sendMail(mailOptions)
        return info?.messageId as string | undefined
      })
    }
  }

  return counts
}

/**
 * One automatic-reminder pass over every agency. Throttled to at most
 * once an hour; pass `{ force: true }` to run regardless (tests).
 * Never throws: a per-agency failure is logged and the other agencies
 * still run.
 */
export const runAutoReminderPass = async (
  now: Date = new Date(),
  opts?: { force?: boolean },
): Promise<AutoReminderPassResult> => {
  const result: AutoReminderPassResult = {
    skipped: false, agencies: 0, pickups: 0, returns: 0, overdue: 0, expiries: 0, recaps: 0, confirmedUnpaid: 0,
  }
  if (!opts?.force && now.getTime() - lastPassAt < PASS_INTERVAL_MS) {
    result.skipped = true
    return result
  }
  lastPassAt = now.getTime()
  try {
    const suppliers = await User.find({ type: bookcarsTypes.UserType.Supplier }).select('_id').lean()
    result.agencies = suppliers.length
    for (const supplier of suppliers) {
      try {
        const counts = await runPassForSupplier(String(supplier._id), now)
        result.pickups += counts.pickups
        result.returns += counts.returns
        result.overdue += counts.overdue
        result.expiries += counts.expiries
        result.recaps += counts.recaps
        result.confirmedUnpaid += counts.confirmedUnpaid
      } catch (err) {
        logger.error(`[autoReminders] pass failed for supplier ${supplier._id}`, err)
      }
    }
  } catch (err) {
    logger.error('[autoReminders] pass failed', err)
  }
  return result
}
