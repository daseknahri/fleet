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
import PushToken from '../models/PushToken'
import User from '../models/User'
import * as logger from './logger'
import * as mailHelper from './mailHelper'

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

const createInAppNotification = async (userId: Types.ObjectId, message: string) => {
  const notification = new Notification({ user: userId, message })
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

const sendPush = async (user: env.User, message: string, reminderId: Types.ObjectId | undefined): Promise<boolean> => {
  const pushToken = await PushToken.findOne({ user: user._id })
  if (!pushToken) {
    return false
  }
  const { token } = pushToken
  const expo = new Expo({ accessToken: env.EXPO_ACCESS_TOKEN })
  if (!Expo.isExpoPushToken(token)) {
    logger.info(`[reminderNotify] Push token for user ${user._id} is not a valid Expo push token.`)
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
          logger.error(`[reminderNotify] Push ticket error: ${ticket.message}`)
        }
      }
    } catch (err) {
      logger.error('[reminderNotify] Error while sending push notification', err)
    }
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
    const emailAllowed = reminder.channels?.email && reminderEmailAllowed(owner, reminder.category)

    for (const recipient of recipients) {
      if (reminder.channels?.inApp) {
        try {
          await createInAppNotification(recipient._id, message)
          result.inAppCount += 1
        } catch (err) {
          logger.error('[reminderNotify] in-app notification failed', err)
        }
      }
      if (emailAllowed && recipient.enableEmailNotifications !== false && recipient.email) {
        try {
          const mailOptions: SendMailOptions = {
            from: env.SMTP_FROM,
            to: recipient.email,
            subject: message,
            html: `<p>Hello ${recipient.fullName},<br><br>${message}${reminder.note ? `<br><br>${reminder.note}` : ''}<br><br>Regards<br></p>`,
          }
          await mailHelper.sendMail(mailOptions)
          result.emailCount += 1
        } catch (err) {
          logger.error('[reminderNotify] email failed', err)
        }
      }
      if (reminder.channels?.push) {
        try {
          if (await sendPush(recipient, message, reminder._id)) {
            result.pushCount += 1
          }
        } catch (err) {
          logger.error('[reminderNotify] push failed', err)
        }
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
    const subject = `Client signed online: contract ${reference}`
    const body = `${driver?.fullName || 'A client'} signed contract ${reference} online.`
    const mailOptions: SendMailOptions = {
      from: env.SMTP_FROM,
      to: owner.email,
      subject,
      html: `<p>Hello ${owner.fullName},<br><br>${body}<br><br>Regards<br></p>`,
    }
    await mailHelper.sendMail(mailOptions)
    logger.info(`[reminderNotify] signed-contract email sent for booking ${booking._id}`)
  } catch (err) {
    logger.error('[reminderNotify] signed-contract email failed (signing unaffected)', err)
  }
}
