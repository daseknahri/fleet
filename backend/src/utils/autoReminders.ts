import type { SendMailOptions } from 'nodemailer'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import Car from '../models/Car'
import MaintenanceSchedule from '../models/MaintenanceSchedule'
import MaintenanceWorkOrder from '../models/MaintenanceWorkOrder'
import NotificationDelivery from '../models/NotificationDelivery'
import User from '../models/User'
import { getContractReceivable, isOverdue } from './contractReceivable'
import * as logger from './logger'
import * as mailHelper from './mailHelper'
import { resolveScheduleDue } from './maintenanceSchedule'
import { staleWorkOrderCutoff, workOrderStaleDays } from './workOrderStale'
import { casablancaDayBounds, casablancaDayBoundsShifted, casablancaWeekBounds, wallDay } from './casablancaDate'
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

// R2-B08 - missed-pickup chase window, in days after the pickup day.
// A missed pickup alerts staff daily for this long, then stops: the
// chase is bounded, and handover / cancel / mark-no-show still end it
// earlier. 7 is the gap hunt's suggestion (section 9, Q21 family), not a user
// decision - if the user answers Q21 with another cadence, change this
// one constant (and the test seeds).
const MISSED_PICKUP_CHASE_DAYS = 7

// R6-18 — the pass is anchored on the Casablanca WALL day, not the
// process-local (UTC) day: in summer, local 00:00-00:59 is the
// previous UTC day 23:00-23:59, so the old windows fired missed-pickup
// on the pickup day itself and read daysOverdue +1 on the return day.
// (startOfDay / endOfDay / addDays are gone: every window below now
// comes from casablancaDayBounds-style bounds.)
// GH-22 - the one date key. Africa/Casablanca WALL day, explicit (not the
// process-local clock: the container runs on UTC, so `getFullYear()` /
// `toISOString()` both answer the UTC day). Mirrors the wall-parts
// approach in `utils/reminderSchedule.ts`. Same `YYYY-MM-DD` format as
// before, so existing dedupe keys keep their shape.
const CASABLANCA_TZ = 'Africa/Casablanca'
const dateKey = (date: Date | string): string => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CASABLANCA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// GH-22 - ISO week key on the Casablanca WALL calendar (was UTC: the
// week flipped an hour before the Casablanca week did, so the overdue
// weekly repeat and the Monday recap could claim the next week's key
// while the windows still ran the old week).
const isoWeekKey = (date: Date): string => {
  const wall = new Date(dateKey(date)) // Casablanca YYYY-MM-DD as a UTC-midnight instant; calendar maths only
  const d = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()))
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
  kind: 'pickup' | 'return' | 'overdue' | 'expiry' | 'confirmedUnpaid' | 'holdExpiring' | 'paymentDue' | 'missedPickup' | 'overdueEscalate' | 'pendingRefund' | 'staleWorkOrder'
  subjectType: string
  subjectId: string
  dedupeKey: string
  vars: Record<string, string | number | undefined>
}

export interface AutoReminderPassResult {
  // R2-B14 - these counts are DELIVERIES (one per recipient per channel
  // that actually sent), not events attempted: a dedupe-suppressed or
  // failed send counts 0. The weekly recap's overdueCount inherits this
  // definition (it counts delivered overdue notices).
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
  // GH-03 / GH-14 / GH-11 (Wave 3.2) — the new events.
  holdExpiring: number
  paymentDue: number
  missedPickup: number
  overdueEscalated: number
  pendingRefunds: number
  // GH-21 - stale work orders (weekly repeat).
  staleWorkOrders: number
}

const LIVE_BOOKING_FILTER = {
  status: { $nin: [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled] },
  lifecycle: { $ne: bookcarsTypes.ContractLifecycle.Completed },
  // GAP-C1/M1: no `expireAt: null` here — a pay-later hold carries
  // `expireAt` and is a live booking; Void/Cancelled are already
  // excluded by status above.
  deletedAt: null,
}

// R2-B14 - fanoutEvent returns the number of deliveries that actually
// went out (one per recipient per channel that deliverNotification
// reports true for). A dedupe-suppressed or failed send counts 0: the
// pass-result counts below are deliveries, not attempts (see 6c).
const fanoutEvent = async (
  supplierId: string,
  recipients: env.User[],
  owner: env.User | undefined,
  event: AutoEvent,
): Promise<number> => {
  const rendered = renderNotificationTemplate(event.templateKey, owner?.language, event.vars)
  const base = {
    templateKey: event.templateKey,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    dedupeKey: event.dedupeKey,
    subject: rendered.subject,
    body: rendered.body,
  }
  let delivered = 0
  for (const recipient of recipients) {
    if (await deliverNotification(supplierId, { ...base, channel: 'inApp', recipient: recipient._id }, async () => {
      await createInAppNotification(recipient._id, rendered.body, {
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        ...(event.subjectType === 'booking' ? { booking: event.subjectId } : {}),
        ...(event.subjectType === 'car' ? { car: event.subjectId } : {}),
      })
    })) {
      delivered += 1
    }
  }
  if (autoReminderEmailAllowed(owner, event.kind)) {
    for (const recipient of recipients) {
      if (recipient.enableEmailNotifications === false || !recipient.email) {
        continue
      }
      if (await deliverNotification(supplierId, { ...base, channel: 'email', recipient: recipient._id }, async () => {
        const mailOptions: SendMailOptions = {
          from: env.SMTP_FROM,
          to: recipient.email,
          subject: rendered.subject,
          html: `<p>Hello ${recipient.fullName},<br><br>${rendered.body}<br><br>Regards<br></p>`,
        }
        const info = await mailHelper.sendMail(mailOptions)
        return info?.messageId as string | undefined
      })) {
        delivered += 1
      }
    }
  }
  for (const recipient of recipients) {
    if (await deliverNotification(supplierId, { ...base, channel: 'push', recipient: recipient._id }, async () => {
      if (!(await sendPush(recipient, rendered.body, undefined))) {
        throw new Error('Push not delivered')
      }
    })) {
      delivered += 1
    }
  }
  return delivered
}

// GH-03 — the customer leg of a money reminder: one email to the
// driver, rendered in the driver's language, claimed in the delivery
// log under its own dedupe key (staff and customer legs dedupe
// independently). Email only — the customer gets no in-app/push copy
// (they are not agency staff). Never throws; skipped when the driver
// has no email or opted out of email notifications.
const emailCustomer = async (
  supplierId: string,
  owner: env.User | undefined,
  driver: unknown,
  event: AutoEvent,
  dedupeKey: string,
): Promise<boolean> => {
  try {
    // R2-B06 - the customer leg gates on the owner's master email
    // toggle, like the staff leg (fanoutEvent): if the owner turned
    // email notifications off, the customer gets no money email either.
    // In-app and push are unaffected (toggles gate email only).
    if (!autoReminderEmailAllowed(owner, event.kind)) {
      return false
    }
    const d = (driver && typeof driver === 'object'
      ? driver as { _id?: unknown, email?: string, fullName?: string, language?: string, enableEmailNotifications?: boolean }
      : null)
    if (!d || !d._id || !d.email || d.enableEmailNotifications === false) {
      return false
    }
    const rendered = renderNotificationTemplate(event.templateKey, d.language, event.vars)
    return await deliverNotification(supplierId, {
      templateKey: event.templateKey,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      dedupeKey,
      channel: 'email',
      recipient: String(d._id),
      subject: rendered.subject,
      body: rendered.body,
    }, async () => {
      const mailOptions: SendMailOptions = {
        from: env.SMTP_FROM,
        to: d.email as string,
        subject: rendered.subject,
        html: `<p>Hello ${d.fullName},<br><br>${rendered.body}<br><br>Regards<br></p>`,
      }
      const info = await mailHelper.sendMail(mailOptions)
      return info?.messageId as string | undefined
    })
  } catch (err) {
    logger.error('[autoReminders] customer reminder email failed', err)
    return false
  }
}

const runPassForSupplier = async (supplierId: string, now: Date): Promise<Omit<AutoReminderPassResult, 'skipped' | 'agencies'>> => {
  const counts = { pickups: 0, returns: 0, overdue: 0, expiries: 0, recaps: 0, confirmedUnpaid: 0, holdExpiring: 0, paymentDue: 0, missedPickup: 0, overdueEscalated: 0, pendingRefunds: 0, staleWorkOrders: 0 }
  const recipients = await resolveReminderRecipients(supplierId)
  if (recipients.length === 0) {
    return counts
  }
  const owner = recipients.find((r) => String(r._id) === supplierId)

  // R6-18 — todayStart = true local midnight; tomorrowStart /
  // dayAfterStart are the next wall-day starts (half-open bounds, so
  // the `when` test and the $lt windows need no -1ms fudge);
  // tomorrowEnd / horizon30 are the last millisecond of their wall
  // days (inclusive $lte bounds); the chase floor is the start of
  // the wall day MISSED_PICKUP_CHASE_DAYS ago (wall-calendar shift).
  const [todayStart, tomorrowStart] = casablancaDayBounds(now)
  const [, dayAfterStart] = casablancaDayBounds(tomorrowStart)
  const tomorrowEnd = new Date(dayAfterStart.getTime() - 1)
  const [, horizon30End] = casablancaDayBoundsShifted(now, 30)
  const horizon30 = new Date(horizon30End.getTime() - 1)
  const [chaseStart] = casablancaDayBoundsShifted(now, -MISSED_PICKUP_CHASE_DAYS)

  // -- Pickups: live bookings starting today or tomorrow. --------------
  const pickups = await Booking.find({
    ...LIVE_BOOKING_FILTER,
    supplier: supplierId,
    from: { $gte: todayStart, $lte: tomorrowEnd },
  }).populate('car', 'name licensePlate').populate('driver', 'fullName').lean()
  for (const booking of pickups) {
    const from = new Date(booking.from)
    const when = from.getTime() < tomorrowStart.getTime() ? 'today' : 'tomorrow'
    counts.pickups += await fanoutEvent(supplierId, recipients, owner, {
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
  }

  // -- Returns: live bookings ending today or tomorrow. ----------------
  const returns = await Booking.find({
    ...LIVE_BOOKING_FILTER,
    supplier: supplierId,
    to: { $gte: todayStart, $lte: tomorrowEnd },
  }).populate('car', 'name licensePlate').populate('driver', 'fullName').lean()
  for (const booking of returns) {
    const to = new Date(booking.to)
    const when = to.getTime() < tomorrowStart.getTime() ? 'today' : 'tomorrow'
    counts.returns += await fanoutEvent(supplierId, recipients, owner, {
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
  }

  // -- Overdue: live bookings whose rental ended, with an outstanding
  // balance under the ONE shared definition (contractReceivable). ------
  // GH-03 / GH-14 — the repeat is WEEKLY, not once-ever: the dedupe
  // key is `overdue:<id>:<iso-week>` (the same ISO-week key the
  // weekly recap uses), so the chase re-fires every week until the
  // money is in, and the message carries the repeat count (week 1, 2,
  // 3, ... of the overdue). A second pass in the same week still finds
  // the claim taken and stays silent.
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
    const dueAt = receivable.dueAt ? new Date(receivable.dueAt) : new Date(booking.to)
    // R6-18 — whole wall days between the due wall date and today
    // (the workOrderStaleDays pattern): a 00:30-local return reads 0
    // on its return day, 1 the day after.
    const daysOverdue = Math.max(0, Math.floor((new Date(`${wallDay(now)}T00:00:00Z`).getTime() - new Date(`${wallDay(dueAt)}T00:00:00Z`).getTime()) / 86400000))
    // R2-B19 - the repeat count is reminders SENT, not weeks overdue:
    // count prior `sent` auto.overdue rows for this booking in the
    // delivery log (same pattern as lastRemindedAt/reminderCount in
    // rentalPaymentController.ts:418-433) and add 1 for this week's
    // send. A missed week (backend down, pass skipped) no longer skips
    // a number: the message says #2 when two were sent, even if three
    // weeks have passed. Failed rows never count (R2-B01 deletes failed
    // auto rows on failure, so only sent rows exist to count).
    const priorOverdueSends = await NotificationDelivery.countDocuments({
      supplier: supplierId,
      subjectType: 'booking',
      subjectId: String(booking._id),
      templateKey: 'auto.overdue',
      status: 'sent',
    })
    const repeatCount = priorOverdueSends + 1
    overdueAmount += receivable.outstandingBalance
    counts.overdue += await fanoutEvent(supplierId, recipients, owner, {
      templateKey: 'auto.overdue',
      kind: 'overdue',
      subjectType: 'booking',
      subjectId: String(booking._id),
      dedupeKey: `overdue:${booking._id}:${isoWeekKey(now)}`,
      vars: {
        date: dateKey(dueAt),
        car: carLabel(booking.car as { name?: string, licensePlate?: string } | undefined),
        driver: driverName(booking as { driver?: { fullName?: string } | string | null }),
        amount: receivable.outstandingBalance,
        currency: receivable.currency,
        repeatCount,
        days: daysOverdue,
      },
    })
    // GH-03 — 30+ days overdue escalates to the OWNER ONLY (staff get
    // the weekly repeat above; the owner gets this on top of it, once
    // per week, until resolved).
    if (daysOverdue >= 30 && owner) {
      counts.overdueEscalated += await fanoutEvent(supplierId, [owner], owner, {
        templateKey: 'auto.overdueEscalate' as bookcarsTypes.NotificationTemplateKey,
        kind: 'overdueEscalate',
        subjectType: 'booking',
        subjectId: String(booking._id),
        dedupeKey: `overdue-escalate:${booking._id}:${isoWeekKey(now)}`,
        vars: {
          date: dateKey(dueAt),
          days: daysOverdue,
          car: carLabel(booking.car as { name?: string, licensePlate?: string } | undefined),
          driver: driverName(booking as { driver?: { fullName?: string } | string | null }),
          amount: receivable.outstandingBalance,
          currency: receivable.currency,
        },
      })
    }
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
    counts.confirmedUnpaid += await fanoutEvent(supplierId, recipients, owner, {
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
  }

  // -- Hold-expiring (GH-03 / Wave 3.2): pay-later holds whose
  // deadline falls within 24h. Staff fan-out + one email to the
  // customer with the amount and the deadline. One notice per hold
  // deadline (the dedupe key carries the deadline date). Temp
  // checkout bookings are Void and never reach this filter; the
  // financialSnapshot.mode guard keeps it to real pay-later holds.
  const holdsExpiring = await Booking.find({
    ...LIVE_BOOKING_FILTER,
    supplier: supplierId,
    status: bookcarsTypes.BookingStatus.Pending,
    'financialSnapshot.mode': bookcarsTypes.CheckoutPaymentMode.PayLater,
    expireAt: { $gt: now, $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
  }).populate('car', 'name licensePlate').populate('driver', 'fullName email language enableEmailNotifications').lean()
  for (const booking of holdsExpiring) {
    const receivable = await getContractReceivable(booking as Pick<env.Booking, '_id' | 'price' | 'financialSnapshot' | 'to' | 'lifecycle'>)
    if (receivable.outstandingBalance <= 0) {
      continue
    }
    const event: AutoEvent = {
      templateKey: 'auto.holdExpiring' as bookcarsTypes.NotificationTemplateKey,
      kind: 'holdExpiring',
      subjectType: 'booking',
      subjectId: String(booking._id),
      dedupeKey: `hold-expiring:${booking._id}:${dateKey(booking.expireAt as Date)}`,
      vars: {
        date: dateKey(booking.expireAt as Date),
        car: carLabel(booking.car as { name?: string, licensePlate?: string } | undefined),
        driver: driverName(booking as { driver?: { fullName?: string } | string | null }),
        amount: receivable.outstandingBalance,
        currency: receivable.currency,
      },
    }
    counts.holdExpiring += await fanoutEvent(supplierId, recipients, owner, event) + (await emailCustomer(supplierId, owner, booking.driver, event, `hold-expiring-customer:${booking._id}:${dateKey(booking.expireAt as Date)}`) ? 1 : 0)
  }

  // -- Payment-due-before-pickup (GH-03 / Wave 3.2; R2-B07): pickup
  // TODAY or tomorrow, balance > 0. Staff fan-out + one email to the
  // customer with the amount and the pickup date. One notice per pickup
  // date (the dedupe key carries the pickup date, so the wider window
  // cannot double-fire: a booking is claimed once for its pickup date
  // whichever pass day claims it first).
  const dueTodayOrTomorrow = await Booking.find({
    ...LIVE_BOOKING_FILTER,
    supplier: supplierId,
    from: { $gte: todayStart, $lt: dayAfterStart },
  }).populate('car', 'name licensePlate').populate('driver', 'fullName email language enableEmailNotifications').lean()
  for (const booking of dueTodayOrTomorrow) {
    const receivable = await getContractReceivable(booking as Pick<env.Booking, '_id' | 'price' | 'financialSnapshot' | 'to' | 'lifecycle'>)
    if (receivable.outstandingBalance <= 0) {
      continue
    }
    const event: AutoEvent = {
      templateKey: 'auto.paymentDue' as bookcarsTypes.NotificationTemplateKey,
      kind: 'paymentDue',
      subjectType: 'booking',
      subjectId: String(booking._id),
      dedupeKey: `payment-due:${booking._id}:${dateKey(booking.from)}`,
      vars: {
        date: dateKey(booking.from),
        car: carLabel(booking.car as { name?: string, licensePlate?: string } | undefined),
        driver: driverName(booking as { driver?: { fullName?: string } | string | null }),
        amount: receivable.outstandingBalance,
        currency: receivable.currency,
      },
    }
    counts.paymentDue += await fanoutEvent(supplierId, recipients, owner, event) + (await emailCustomer(supplierId, owner, booking.driver, event, `payment-due-customer:${booking._id}:${dateKey(booking.from)}`) ? 1 : 0)
  }

  // -- Missed pickup (GH-03 / GH-14 / Wave 3.2): the pickup day
  // passed with no handover (lifecycle still Draft/Confirmed) and no
  // no-show marked. Staff only, DAILY key - re-fires every day for
  // MISSED_PICKUP_CHASE_DAYS days after the pickup day, then stops,
  // until resolved earlier (handover, cancel, or mark-no-show).
  const missedPickups = await Booking.find({
    ...LIVE_BOOKING_FILTER,
    supplier: supplierId,
    lifecycle: { $in: [bookcarsTypes.ContractLifecycle.Draft, bookcarsTypes.ContractLifecycle.Confirmed] },
    // R2-B08 - bounded chase: pickup day within the last
    // MISSED_PICKUP_CHASE_DAYS days. Older than that, the alert stops
    // (mark-no-show is the staff escape hatch for the stragglers).
    from: { $gte: chaseStart, $lt: todayStart },
  }).populate('car', 'name licensePlate').populate('driver', 'fullName').lean()
  for (const booking of missedPickups) {
    if ((booking as unknown as { noShowAt?: Date | null }).noShowAt) {
      continue
    }
    const receivable = await getContractReceivable(booking as Pick<env.Booking, '_id' | 'price' | 'financialSnapshot' | 'to' | 'lifecycle'>)
    counts.missedPickup += await fanoutEvent(supplierId, recipients, owner, {
      templateKey: 'auto.missedPickup' as bookcarsTypes.NotificationTemplateKey,
      kind: 'missedPickup',
      subjectType: 'booking',
      subjectId: String(booking._id),
      dedupeKey: `missed-pickup:${booking._id}:${dateKey(now)}`,
      vars: {
        date: dateKey(booking.from),
        car: carLabel(booking.car as { name?: string, licensePlate?: string } | undefined),
        driver: driverName(booking as { driver?: { fullName?: string } | string | null }),
        amount: receivable.outstandingBalance,
        currency: receivable.currency,
      },
    })
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
      counts.expiries += await fanoutEvent(supplierId, recipients, owner, {
        templateKey: 'auto.expiry',
        kind: 'expiry',
        subjectType: 'car',
        subjectId: String(car._id),
        dedupeKey: `expiry:${car._id}:${label}:${dateKey(date)}`,
        vars: { doc: label, date: dateKey(date), car: carLabel(car) },
      })
    }
    for (const doc of car.documents || []) {
      if (!doc?.expiryDate) continue
      const date = new Date(doc.expiryDate)
      if (date.getTime() > horizon30.getTime()) continue
      const label = doc.kind ? `${doc.kind} document` : 'Document'
      counts.expiries += await fanoutEvent(supplierId, recipients, owner, {
        templateKey: 'auto.expiry',
        kind: 'expiry',
        subjectType: 'car',
        subjectId: String(car._id),
        dedupeKey: `expiry:${car._id}:${label}:${dateKey(date)}`,
        vars: { doc: label, date: dateKey(date), car: carLabel(car) },
      })
    }
  }
  // GH-19 - schedules of trashed cars must not notify: restrict to the
  // live cars already fetched above (the car loop filters deletedAt;
  // the schedule loop did not, so a trashed car's Due/Overdue
  // schedules kept notifying every pass).
  const schedules = await MaintenanceSchedule.find({ supplier: supplierId, car: { $in: cars.map((car) => car._id) } })
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
    counts.expiries += await fanoutEvent(supplierId, recipients, owner, {
      templateKey: 'auto.expiry',
      kind: 'expiry',
      subjectType: 'maintenance-schedule',
      subjectId: String(schedule._id),
      dedupeKey: `expiry-schedule:${schedule._id}:${due.status}:${triggerKey}`,
      vars: { doc: `Maintenance: ${schedule.title}`, date: triggerLabel, car: carName },
    })
  }

  // -- Stale work orders (GH-21): still Scheduled N days after the
  // planned start. Weekly repeat (same isoWeekKey dedupe as the
  // overdue repeat) until the job leaves Scheduled. Staff fan-out +
  // owner, like the expiry events. The stale predicate lives in
  // utils/workOrderStale.ts - the same function the list endpoint
  // uses, so the reminder and the aging view can never disagree.
  const staleWorkOrders = await MaintenanceWorkOrder.find({
    supplier: supplierId,
    // R3-02 — same trashed-car filter as the GH-19 schedule loop above:
    // a trashed car's job stays Scheduled forever, so without this it
    // would notify weekly forever.
    car: { $in: cars.map((car) => car._id) },
    status: bookcarsTypes.WorkOrderStatus.Scheduled,
    scheduledStart: { $lt: staleWorkOrderCutoff(now) },
  }).populate('car', 'name licensePlate').lean()
  for (const workOrder of staleWorkOrders) {
    const days = workOrderStaleDays(workOrder.scheduledStart, now)
    counts.staleWorkOrders += await fanoutEvent(supplierId, recipients, owner, {
      templateKey: 'auto.staleWorkOrder' as bookcarsTypes.NotificationTemplateKey,
      kind: 'staleWorkOrder',
      subjectType: 'maintenance-work-order',
      subjectId: String(workOrder._id),
      dedupeKey: `stale-work-order:${workOrder._id}:${isoWeekKey(now)}`,
      vars: {
        title: workOrder.title,
        car: carLabel(workOrder.car as { name?: string, licensePlate?: string } | string | undefined),
        days,
        date: dateKey(workOrder.scheduledStart),
      },
    })
  }

  // -- Weekly recap: once per ISO week, on Mondays. The dedupe claim
  // (one row per recipient per channel for the week key) makes it
  // exactly-once even if the pass runs several times that Monday.
  // Email goes to the owner only; the in-app copy goes to everyone.
  // GH-22 - Monday on the Casablanca WALL calendar (was process-local
  // getDay(): in the container that is UTC, so on Sunday 23:00-23:59 UTC
  // - already Monday in Casablanca - the recap did not fire, and it
  // fired an hour into the Casablanca Monday instead).
  if (new Date(`${dateKey(now)}T12:00:00Z`).getUTCDay() === 1) {
    const weekKey = isoWeekKey(now)
    // R3-06 — the week range follows the Casablanca WALL calendar like
    // the gate above (was process-local getDay(): in the Sunday
    // 23:00-23:59 UTC window the gate fired for the new Casablanca
    // week while weekStart still pointed at the previous Monday).
    // R5-07 — the week range is the Casablanca WALL week. casablancaTodayStart
    // now returns true local midnight (23:00Z the previous day in summer),
    // so wallToday.getUTCDay() would read the previous UTC day and the old
    // arithmetic would point weekStart at the previous Monday (and endOfDay
    // would cut the Sunday wall day 23 h short). casablancaWeekBounds
    // returns [Monday 00:00 local, next Monday 00:00 local), so the count
    // covers exactly the wall week.
    const [weekStart, weekEnd] = casablancaWeekBounds(now)
    const [weekPickups, weekReturns] = await Promise.all([
      Booking.countDocuments({ ...LIVE_BOOKING_FILTER, supplier: supplierId, from: { $gte: weekStart, $lt: weekEnd } }),
      Booking.countDocuments({ ...LIVE_BOOKING_FILTER, supplier: supplierId, to: { $gte: weekStart, $lt: weekEnd } }),
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
        // R6-29 — the in-app row carries its destination: a recap
        // is about the supplier's money, so it lands on /payments
        // (the delivery claim already carried it).
        await createInAppNotification(recipient._id, rendered.body, { subjectType: 'supplier', subjectId: supplierId })
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

  // -- Pending refunds (GH-11): Cancelled bookings whose
  // cancellationRecord still says 'pending' — money the agency owes
  // back. Owner only, once per day per booking, until resolved (the
  // record flips to 'refunded'/'none' and the row drops out of this
  // query). The list itself is GET /api/rental-payments/
  // pending-refunds; this is the chase for it.
  const pendingRefundBookings = await Booking.find({
    supplier: supplierId,
    status: bookcarsTypes.BookingStatus.Cancelled,
    'cancellationRecord.refundStatus': 'pending',
    deletedAt: null,
  }).populate('car', 'name licensePlate').populate('driver', 'fullName').lean()
  for (const booking of pendingRefundBookings) {
    const record = booking.cancellationRecord
    if (!record || !owner) {
      continue
    }
    const amount = Math.max(0, Number(record.rentPaid || 0) + Number(record.depositPaid || 0)
      - Number(record.refundedRent || 0) - Number(record.refundedDeposit || 0))
    if (amount <= 0) {
      continue
    }
    counts.pendingRefunds += await fanoutEvent(supplierId, [owner], owner, {
      templateKey: 'auto.pendingRefund' as bookcarsTypes.NotificationTemplateKey,
      kind: 'pendingRefund',
      subjectType: 'booking',
      subjectId: String(booking._id),
      dedupeKey: `pending-refund:${booking._id}:${dateKey(now)}`,
      vars: {
        date: record.cancelledAt ? dateKey(record.cancelledAt) : dateKey(now),
        reason: record.reason || (record.refundDecision === 'manual' ? 'manual refund' : 'wire refund'),
        car: carLabel(booking.car as { name?: string, licensePlate?: string } | undefined),
        driver: driverName(booking as { driver?: { fullName?: string } | string | null }),
        amount,
        currency: env.BASE_CURRENCY.toUpperCase(),
      },
    })
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
    holdExpiring: 0, paymentDue: 0, missedPickup: 0, overdueEscalated: 0, pendingRefunds: 0, staleWorkOrders: 0,
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
        result.holdExpiring += counts.holdExpiring
        result.paymentDue += counts.paymentDue
        result.missedPickup += counts.missedPickup
        result.overdueEscalated += counts.overdueEscalated
        result.pendingRefunds += counts.pendingRefunds
        result.staleWorkOrders += counts.staleWorkOrders
      } catch (err) {
        logger.error(`[autoReminders] pass failed for supplier ${supplier._id}`, err)
      }
    }
  } catch (err) {
    logger.error('[autoReminders] pass failed', err)
  }
  return result
}
