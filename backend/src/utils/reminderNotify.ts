import { Expo, ExpoPushMessage } from 'expo-server-sdk'
import type { Types } from 'mongoose'
import type { SendMailOptions } from 'nodemailer'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import AgencyMembership from '../models/AgencyMembership'
import Booking from '../models/Booking'
import Car from '../models/Car'
import Notification from '../models/Notification'
import NotificationCounter from '../models/NotificationCounter'
import NotificationDelivery from '../models/NotificationDelivery'
import PushToken from '../models/PushToken'
import User from '../models/User'
import * as logger from './logger'
import * as mailHelper from './mailHelper'
import { renderNotificationTemplate } from './notificationTemplates'

/**
 * GA-PAR-13 — reminder notification fan-out. This module MIRRORS the
 * existing booking-notification plumbing (bookingController.notify /
 * notifyDriver) instead of building parallel senders:
 * - in-app: a `Notification` row + `NotificationCounter` increment;
 * - email: `mailHelper.sendMail` (the shared Nodemailer transporter);
 * - push: `PushToken` lookup + Expo (`expo-server-sdk`) chunked send.
 *
 * Recipients: the supplier (agency owner) user + the agency's ACTIVE
 * staff users (AgencyMembership status=active, user type=Staff and
 * user.active=true).
 *
 * Email gating (scorecard #43 consumption mapping, exactly as shipped):
 * - the agency owner's master `enableEmailNotifications` off ⇒ no
 *   reminder email at all, and no signed-contract email;
 * - reminder categories oilChange / insurance / visite are additionally
 *   gated by the owner's `emailNotificationCategories.carDueDates`;
 * - reminder categories rent / callClient / custom are gated by the
 *   master only;
 * - the signed-contract email is additionally gated by the owner's
 *   `emailNotificationCategories.signedContracts`;
 * - a recipient whose own master boolean is off never receives email.
 * Email toggles gate EMAIL ONLY — in-app and push are unaffected.
 */

export const REMINDER_CATEGORY_LABELS: Record<string, string> = {
  [bookcarsTypes.ReminderCategory.Rent]: 'Rent',
  [bookcarsTypes.ReminderCategory.OilChange]: 'Oil change',
  [bookcarsTypes.ReminderCategory.Insurance]: 'Insurance',
  [bookcarsTypes.ReminderCategory.Visite]: 'Visite technique',
  [bookcarsTypes.ReminderCategory.CallClient]: 'Call client',
  [bookcarsTypes.ReminderCategory.Custom]: 'Reminder',
}

const CAR_DUE_CATEGORIES: ReadonlySet<string> = new Set([
  bookcarsTypes.ReminderCategory.OilChange,
  bookcarsTypes.ReminderCategory.Insurance,
  bookcarsTypes.ReminderCategory.Visite,
])

/** Agency-level email gate for reminder emails (owner's toggles). */
export const reminderEmailAllowed = (
  owner: { enableEmailNotifications?: boolean, emailNotificationCategories?: bookcarsTypes.EmailNotificationCategories } | null | undefined,
  category: string,
): boolean => {
  if (!owner || owner.enableEmailNotifications === false) {
    return false
  }
  if (CAR_DUE_CATEGORIES.has(category)) {
    return owner.emailNotificationCategories?.carDueDates !== false
  }
  return true
}

/** Agency-level email gate for the signed-contract email. */
export const signedContractEmailAllowed = (
  owner: { enableEmailNotifications?: boolean, emailNotificationCategories?: bookcarsTypes.EmailNotificationCategories } | null | undefined,
): boolean => !!owner
  && owner.enableEmailNotifications !== false
  && owner.emailNotificationCategories?.signedContracts !== false

/**
 * F8 / W5 S2 + N2 — agency-level email gates for the automatic
 * reminders. Toggles gate EMAIL ONLY — in-app and push are unaffected.
 * - pickup / overdue: the master boolean only;
 * - return: master + the `returnsDue` category (S2's consumer);
 * - expiry (car documents + maintenance due): master + `carDueDates`.
 */
export type AutoReminderKind = 'pickup' | 'return' | 'overdue' | 'expiry' | 'confirmedUnpaid'
// GH-03 / GH-14 / GH-11 (Wave 3.2) — the new kinds gate on the master
// boolean only, like pickup / overdue (no per-category toggle).
  | 'holdExpiring' | 'paymentDue' | 'missedPickup' | 'overdueEscalate' | 'pendingRefund'
// GH-21 (P2) - stale work orders gate on the master boolean only.
  | 'staleWorkOrder'
// Wave 2.1 — 'confirmedUnpaid' gates on the master boolean only, like
// pickup / overdue (no per-category toggle).

export const autoReminderEmailAllowed = (
  owner: { enableEmailNotifications?: boolean, emailNotificationCategories?: bookcarsTypes.EmailNotificationCategories } | null | undefined,
  kind: AutoReminderKind,
): boolean => {
  if (!owner || owner.enableEmailNotifications === false) {
    return false
  }
  if (kind === 'return') {
    return owner.emailNotificationCategories?.returnsDue !== false
  }
  if (kind === 'expiry') {
    return owner.emailNotificationCategories?.carDueDates !== false
  }
  return true
}

/** F8 / W5 S2 + N2 — weekly recap email: master + `weeklyRecap`. */
export const weeklyRecapEmailAllowed = (
  owner: { enableEmailNotifications?: boolean, emailNotificationCategories?: bookcarsTypes.EmailNotificationCategories } | null | undefined,
): boolean => !!owner
  && owner.enableEmailNotifications !== false
  && owner.emailNotificationCategories?.weeklyRecap !== false

// ---------------------------------------------------------------------------
// F8 / W5 N3 — delivery log: claim before send, mark after.
//
// `claimNotificationDelivery` INSERTS the row as `queued` and returns
// it; the unique dedupe index makes a second claim for the same
// (template, subject, dedupeKey, channel, recipient) fail with E11000,
// which returns 'duplicate' — the caller skips silently (exactly-once
// across ticks and restarts). A row left `queued` by a crashed process
// is re-sendable from the log's retry endpoint. Any other insert
// failure returns null: the caller still sends (a notification matters
// more than its log row) and records the outcome best-effort.
// ---------------------------------------------------------------------------

export interface DeliveryClaim {
  templateKey: bookcarsTypes.NotificationTemplateKey
  subjectType?: string
  subjectId?: string
  dedupeKey: string
  channel: bookcarsTypes.NotificationDeliveryChannel
  recipient: Types.ObjectId | string
  subject?: string
  body: string
}

export const claimNotificationDelivery = async (
  supplier: string,
  claim: DeliveryClaim,
): Promise<env.NotificationDelivery | 'duplicate' | null> => {
  try {
    const row = await NotificationDelivery.create({
      supplier,
      templateKey: claim.templateKey,
      subjectType: claim.subjectType,
      subjectId: claim.subjectId,
      dedupeKey: claim.dedupeKey,
      channel: claim.channel,
      recipient: claim.recipient,
      subject: claim.subject,
      body: claim.body,
      status: 'queued',
      attempts: 0,
    })
    return row
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) {
      return 'duplicate'
    }
    logger.error('[reminderNotify] delivery claim failed', err)
    return null
  }
}

export const markDeliverySent = async (id: Types.ObjectId | string, providerId?: string): Promise<void> => {
  try {
    await NotificationDelivery.updateOne(
      { _id: id },
      { $inc: { attempts: 1 }, $set: { status: 'sent', sentAt: new Date(), ...(providerId ? { providerId } : {}), lastError: undefined } },
    )
  } catch (err) {
    logger.error('[reminderNotify] markDeliverySent failed', err)
  }
}

export const markDeliveryFailed = async (id: Types.ObjectId | string, error: unknown): Promise<void> => {
  try {
    const message = error instanceof Error ? error.message : String(error || 'Delivery failed')
    await NotificationDelivery.updateOne(
      { _id: id },
      { $inc: { attempts: 1 }, $set: { status: 'failed', lastError: message.slice(0, 1000) } },
    )
  } catch (err) {
    logger.error('[reminderNotify] markDeliveryFailed failed', err)
  }
}

// Best-effort record for sends that ran without a claim (the claim
// insert itself failed): the row carries its final status at once.
export const recordNotificationDelivery = async (
  supplier: string,
  claim: DeliveryClaim,
  status: bookcarsTypes.NotificationDeliveryStatus,
  lastError?: string,
): Promise<void> => {
  try {
    await NotificationDelivery.create({
      supplier,
      templateKey: claim.templateKey,
      subjectType: claim.subjectType,
      subjectId: claim.subjectId,
      dedupeKey: claim.dedupeKey,
      channel: claim.channel,
      recipient: claim.recipient,
      subject: claim.subject,
      body: claim.body,
      status,
      attempts: 1,
      ...(status === 'sent' ? { sentAt: new Date() } : {}),
      ...(lastError ? { lastError: lastError.slice(0, 1000) } : {}),
    })
  } catch (err) {
    if ((err as { code?: number })?.code !== 11000) {
      logger.error('[reminderNotify] recordNotificationDelivery failed', err)
    }
  }
}

export const resolveReminderRecipients = async (supplierId: string): Promise<env.User[]> => {
  const recipients: env.User[] = []
  const owner = await User.findById(supplierId)
  if (owner) {
    recipients.push(owner)
  }
  const memberships = await AgencyMembership.find({
    supplier: supplierId,
    status: bookcarsTypes.AgencyMembershipStatus.Active,
  }).select('user').lean()
  const staffIds = memberships.map((m) => m.user).filter((id) => String(id) !== String(supplierId))
  if (staffIds.length > 0) {
    const staff = await User.find({
      _id: { $in: staffIds },
      type: bookcarsTypes.UserType.Staff,
      active: true,
    })
    recipients.push(...staff)
  }
  return recipients
}

export const createInAppNotification = async (userId: Types.ObjectId, message: string, subject?: { subjectType?: string, subjectId?: string, booking?: Types.ObjectId | string, car?: Types.ObjectId | string }) => {
  const notification = new Notification({ user: userId, message, ...(subject || {}) })
  await notification.save()
  let counter = await NotificationCounter.findOne({ user: userId })
  if (counter && typeof counter.count !== 'undefined') {
    counter.count += 1
    await counter.save()
  } else {
    counter = new NotificationCounter({ user: userId, count: 1 })
    await counter.save()
  }
}

// GH-23 - dead-token pruning. N = 3 consecutive failures (same count as
// the Wave 3.5 auto-retry cap); `DeviceNotRegistered` prunes at once -
// Expo guarantees that token will never deliver again. A pruned token is
// re-creatable: the next app open re-registers via createPushToken (3d).
const PUSH_PRUNE_AFTER_FAILURES = 3

const recordPushFailure = async (userId: Types.ObjectId, reason: string, immediate: boolean): Promise<void> => {
  try {
    const row = await PushToken.findOne({ user: userId })
    if (!row) return
    if (immediate) {
      await PushToken.deleteOne({ _id: row._id })
      logger.info(`[reminderNotify] Pruned dead push token for user ${userId} (DeviceNotRegistered).`)
      return
    }
    const failures = (row.consecutiveFailures || 0) + 1
    if (failures >= PUSH_PRUNE_AFTER_FAILURES) {
      await PushToken.deleteOne({ _id: row._id })
      logger.info(`[reminderNotify] Pruned push token for user ${userId} after ${failures} consecutive failures (last: ${reason}).`)
      return
    }
    await PushToken.updateOne({ _id: row._id }, { $set: { consecutiveFailures: failures, lastFailureAt: new Date(), lastFailureReason: reason.slice(0, 1000) } })
  } catch (err) {
    logger.error('[reminderNotify] recordPushFailure failed', err)
  }
}

const recordPushSuccess = async (userId: Types.ObjectId): Promise<void> => {
  try {
    await PushToken.updateOne({ user: userId }, { $set: { consecutiveFailures: 0, lastFailureAt: undefined, lastFailureReason: undefined } })
  } catch (err) {
    logger.error('[reminderNotify] recordPushSuccess failed', err)
  }
}

export const sendPush = async (user: env.User, message: string, reminderId: Types.ObjectId | undefined): Promise<boolean> => {
  const pushToken = await PushToken.findOne({ user: user._id })
  if (!pushToken) {
    return false
  }
  const { token } = pushToken
  const expo = new Expo({ accessToken: env.EXPO_ACCESS_TOKEN })
  if (!Expo.isExpoPushToken(token)) {
    await recordPushFailure(user._id, 'Not a valid Expo push token.', false)
    return false
  }
  const messages: ExpoPushMessage[] = [{
    to: token,
    sound: 'default',
    body: message,
    data: { user: user._id, reminder: reminderId },
  }]
  let sent = false
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk)
      for (const ticket of tickets) {
        if (ticket.status === 'ok') {
          logger.info(`[reminderNotify] Push notification sent: ${ticket.id}`)
          sent = true
        } else {
          const details = (ticket as { details?: { error?: string } }).details
          const reason = details?.error ? `${ticket.message} (${details.error})` : (ticket.message || 'Push ticket error')
          logger.error(`[reminderNotify] Push ticket error: ${reason}`)
          await recordPushFailure(user._id, reason, details?.error === 'DeviceNotRegistered')
        }
      }
    } catch (err) {
      await recordPushFailure(user._id, err instanceof Error ? err.message : 'Push send threw', false)
      logger.error('[reminderNotify] Error while sending push notification', err)
    }
  }
  if (sent) {
    await recordPushSuccess(user._id)
  }
  return sent
}

export interface ReminderFanoutResult {
  inAppCount: number
  emailCount: number
  pushCount: number
  recipientCount: number
}

/**
 * F8 / W5 N3 — send one notification over one channel with delivery
 * logging: claim the (template, subject, dedupeKey, channel,
 * recipient) row first (a duplicate claim means "already sent — skip"),
 * send, then mark the row sent/failed. Returns true when the send
 * succeeded. `send` resolves with an optional provider id (the email
 * message id); it must throw (or, for push, resolve false via the
 * wrapper below) when the channel did not deliver.
 */
export const deliverNotification = async (
  supplier: string,
  claim: DeliveryClaim,
  send: () => Promise<string | void>,
): Promise<boolean> => {
  const row = await claimNotificationDelivery(supplier, claim)
  if (row === 'duplicate') {
    return false
  }
  try {
    const providerId = await send()
    if (row) {
      await markDeliverySent(row._id, typeof providerId === 'string' ? providerId : undefined)
    } else {
      await recordNotificationDelivery(supplier, claim, 'sent')
    }
    return true
  } catch (err) {
    if (row) {
      await markDeliveryFailed(row._id, err)
    } else {
      await recordNotificationDelivery(supplier, claim, 'failed', err instanceof Error ? err.message : String(err || 'Delivery failed'))
    }
    logger.error('[reminderNotify] delivery failed', err)
    return false
  }
}

/**
 * Fan one fired reminder occurrence out to the agency recipients over
 * the reminder's configured channels. Never throws: every channel is
 * isolated per recipient so one bad address/token cannot starve the
 * others (the firing claim is already recorded by the caller).
 */
export const notifyReminderFired = async (
  reminder: env.Reminder,
  occurrenceAt: Date,
  offsetHours: number,
): Promise<ReminderFanoutResult> => {
  const result: ReminderFanoutResult = { inAppCount: 0, emailCount: 0, pushCount: 0, recipientCount: 0 }
  try {
    const supplierId = String(reminder.supplier)
    const recipients = await resolveReminderRecipients(supplierId)
    result.recipientCount = recipients.length
    const owner = recipients.find((r) => String(r._id) === supplierId)

    let linkedName = ''
    if (reminder.linkType === bookcarsTypes.ReminderLinkType.Car && reminder.car) {
      const car = await Car.findById(reminder.car).select('name licensePlate').lean()
      if (car) {
        linkedName = car.licensePlate ? `${car.name} (${car.licensePlate})` : car.name
      }
    } else if (reminder.linkType === bookcarsTypes.ReminderLinkType.Client && reminder.client) {
      const client = await User.findById(reminder.client).select('fullName').lean()
      if (client) {
        linkedName = client.fullName
      }
    }

    const label = REMINDER_CATEGORY_LABELS[reminder.category] || 'Reminder'
    const dueText = occurrenceAt.toISOString()
    const message = linkedName
      ? `${reminder.title} — ${label} — ${linkedName} (due ${dueText})`
      : `${reminder.title} — ${label} (due ${dueText})`
    // F8 / W5 N3 — the manual-reminder message keeps its exact text
    // shape; the template only gives the delivery log a key for it.
    const rendered = renderNotificationTemplate('reminder.manual', owner?.language, { message })
    const dedupeKey = `manual:${reminder._id}:${occurrenceAt.toISOString()}:${offsetHours}`
    const emailAllowed = reminder.channels?.email && reminderEmailAllowed(owner, reminder.category)

    for (const recipient of recipients) {
      if (reminder.channels?.inApp) {
        const delivered = await deliverNotification(supplierId, {
          templateKey: 'reminder.manual',
          subjectType: 'reminder',
          subjectId: String(reminder._id),
          dedupeKey,
          channel: 'inApp',
          recipient: recipient._id,
          subject: rendered.subject,
          body: rendered.body,
        }, async () => { await createInAppNotification(recipient._id, rendered.body, { subjectType: 'reminder', subjectId: String(reminder._id) }) })
        if (delivered) result.inAppCount += 1
      }
      if (emailAllowed && recipient.enableEmailNotifications !== false && recipient.email) {
        const delivered = await deliverNotification(supplierId, {
          templateKey: 'reminder.manual',
          subjectType: 'reminder',
          subjectId: String(reminder._id),
          dedupeKey,
          channel: 'email',
          recipient: recipient._id,
          subject: rendered.subject,
          body: rendered.body,
        }, async () => {
          const mailOptions: SendMailOptions = {
            from: env.SMTP_FROM,
            to: recipient.email,
            subject: rendered.subject,
            html: `<p>Hello ${recipient.fullName},<br><br>${rendered.body}${reminder.note ? `<br><br>${reminder.note}` : ''}<br><br>Regards<br></p>`,
          }
          const info = await mailHelper.sendMail(mailOptions)
          return info?.messageId as string | undefined
        })
        if (delivered) result.emailCount += 1
      }
      if (reminder.channels?.push) {
        const delivered = await deliverNotification(supplierId, {
          templateKey: 'reminder.manual',
          subjectType: 'reminder',
          subjectId: String(reminder._id),
          dedupeKey,
          channel: 'push',
          recipient: recipient._id,
          subject: rendered.subject,
          body: rendered.body,
        }, async () => {
          // A false return (no token / ticket error) is a failed
          // delivery, not a silent skip.
          if (!(await sendPush(recipient, rendered.body, reminder._id))) {
            throw new Error('Push not delivered')
          }
        })
        if (delivered) result.pushCount += 1
      }
    }
    logger.info(`[reminderNotify] reminder ${reminder._id} occurrence ${dueText} offset ${offsetHours}h -> inApp=${result.inAppCount} email=${result.emailCount} push=${result.pushCount} recipients=${result.recipientCount}`)
  } catch (err) {
    logger.error('[reminderNotify] fan-out failed', err)
  }
  return result
}

/**
 * GA-PAR-13 (#43) — "client signed online" email to the agency when a
 * booking is signed online (GA-PAR-12). Never-throwing side-effect in
 * the signing completion path (approvalProducer discipline): any
 * failure is logged and the signing result is unaffected. Gated by the
 * owner's master boolean + `signedContracts` category. Email only.
 */
export const notifyClientSignedOnline = async (bookingId: string): Promise<void> => {
  try {
    const booking = await Booking.findById(bookingId).select('supplier driver reference').lean()
    if (!booking?.supplier) {
      return
    }
    const owner = await User.findById(booking.supplier)
    if (!owner || !signedContractEmailAllowed(owner) || !owner.email) {
      return
    }
    const driver = booking.driver ? await User.findById(booking.driver).select('fullName').lean() : null
    const reference = booking.reference || String(booking._id)
    // F8 / W5 N3 — the signed-contract notice is a template now, and
    // its send is claimed in the delivery log (dedupe: one email per
    // booking signing) so a retried signing completion cannot double it.
    const rendered = renderNotificationTemplate('contract.signed', owner.language, {
      reference,
      driver: driver?.fullName || 'A client',
    })
    const supplierId = String(booking.supplier)
    const delivered = await deliverNotification(supplierId, {
      templateKey: 'contract.signed',
      subjectType: 'booking',
      subjectId: String(booking._id),
      dedupeKey: `signed:${booking._id}`,
      channel: 'email',
      recipient: owner._id,
      subject: rendered.subject,
      body: rendered.body,
    }, async () => {
      const mailOptions: SendMailOptions = {
        from: env.SMTP_FROM,
        to: owner.email,
        subject: rendered.subject,
        html: `<p>Hello ${owner.fullName},<br><br>${rendered.body}<br><br>Regards<br></p>`,
      }
      const info = await mailHelper.sendMail(mailOptions)
      return info?.messageId as string | undefined
    })
    if (delivered) {
      logger.info(`[reminderNotify] signed-contract email sent for booking ${booking._id}`)
    }
  } catch (err) {
    logger.error('[reminderNotify] signed-contract email failed (signing unaffected)', err)
  }
}
