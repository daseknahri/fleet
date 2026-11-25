import mongoose from 'mongoose'
import type { SendMailOptions } from 'nodemailer'
import Stripe from 'stripe'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import i18n from '../lang/i18n'
import Booking from '../models/Booking'
import Notification from '../models/Notification'
import NotificationCounter from '../models/NotificationCounter'
import User from '../models/User'
import * as logger from './logger'
import * as mailHelper from './mailHelper'
import { createInAppNotification, resolveReminderRecipients } from './reminderNotify'
import { getContractReceivable } from './contractReceivable'
import { reconcilePayPalOrder, reconcileStripeIntent, reconcileStripeSession } from './checkoutReconciliation'

/**
 * F2 / W4 GAP-04 — periodic checkout sweeper. The browser return paths
 * (and now the Stripe webhook) finalise a paid checkout when the
 * customer comes back or Stripe delivers the event. The sweeper is the
 * safety net underneath both: every tick it lists `Void` bookings whose
 * `expireAt` has passed with a provider reference and reconciles each
 * against the provider — finalise if paid and verified, refund if paid
 * but unverifiable (F1 pattern), leave alone if not paid (TTL expiry
 * owns cleanup; the sweeper never deletes a booking).
 *
 * Placement contract (same as the reminder scheduler): `startCheckoutSweeper`
 * is called ONLY from the server entrypoint (backend/src/index.ts) after
 * the database is connected — NEVER from app.ts, which the suites import,
 * so the tick cannot fire during tests. Kill-switch: environment variable
 * `BC_CHECKOUT_SWEEPER=off` disables the sweeper entirely. The timer is
 * unref'd so it never keeps the process alive on its own.
 *
 * Safety rules:
 * - Only bookings whose `expireAt` has PASSED are swept. Before expiry
 *   the customer may still return (or the webhook may still deliver);
 *   sweeping early could refund a payment that is about to finalise.
 * - One booking's failure never aborts the sweep: each booking is
 *   reconciled inside its own try/catch and counted, so a provider
 *   outage on one booking does not block the rest.
 * - Idempotent and safe to run repeatedly: finalisation requires
 *   `status: Void` and every ledger posting / refund carries a stable
 *   idempotency key (see checkoutReconciliation), so a second tick
 *   finds the booking already finalised, or re-issues a refund under
 *   the same key and the provider replays the original refund.
 * - PayPal has no webhook in this codebase; the sweeper covers it by
 *   polling order status through the existing server-side `getOrder` —
 *   the same check the browser path performs. No PayPal API flow was
 *   invented for this.
 */

export const CHECKOUT_SWEEPER_TICK_MS = 15 * 60 * 1000

export interface CheckoutSweepSummary {
  checked: number
  finalized: number
  alreadyFinalized: number
  refunded: number
  notPaid: number
  skipped: number
  errors: number
  /** GAP-C1/M1 — expired pay-later holds voided (and notified) this pass. */
  expiredHolds: number
  /** GH-32 — expired holds NOT voided because they are fully paid but unconfirmed (refresh failed); needs manual review. */
  held: number
}

export const runCheckoutSweep = async (now: Date = new Date()): Promise<CheckoutSweepSummary> => {
  const summary: CheckoutSweepSummary = {
    checked: 0,
    finalized: 0,
    alreadyFinalized: 0,
    refunded: 0,
    notPaid: 0,
    skipped: 0,
    errors: 0,
    expiredHolds: 0,
    held: 0,
  }
  try {
    const bookings = await Booking.find({
      status: bookcarsTypes.BookingStatus.Void,
      expireAt: { $lte: now },
      $or: [
        { sessionId: { $nin: [null, ''] } },
        { paymentIntentId: { $nin: [null, ''] } },
        { paypalOrderId: { $nin: [null, ''] } },
      ],
    }).select('_id sessionId paymentIntentId paypalOrderId supplier reference')
    for (const booking of bookings) {
      summary.checked += 1
      try {
        let outcome: string
        if (booking.paypalOrderId) {
          // PayPal bookings carry a random (non-Stripe) sessionId, so the
          // order id is the only provider reference that can be checked.
          const paypal = await import('../payment/paypal.js')
          const order = await paypal.getOrder(booking.paypalOrderId)
          outcome = (await reconcilePayPalOrder(order)).outcome
        } else if (booking.paymentIntentId) {
          // PaymentSheet bookings: the intent id is the reference; the
          // sessionId is a random UUID, not a Stripe session.
          const stripeAPI = (await import('../payment/stripe.js')).default
          const intent: Stripe.PaymentIntent = await stripeAPI.paymentIntents.retrieve(booking.paymentIntentId)
          outcome = (await reconcileStripeIntent(intent)).outcome
        } else if (booking.sessionId?.startsWith('cs_')) {
          // Embedded-checkout bookings: the session id is the reference.
          const stripeAPI = (await import('../payment/stripe.js')).default
          const session: Stripe.Checkout.Session = await stripeAPI.checkout.sessions.retrieve(booking.sessionId)
          outcome = (await reconcileStripeSession(session)).outcome
        } else {
          logger.info(`[checkoutSweeper] Booking ${booking._id} has no retrievable provider reference; skipping`)
          summary.skipped += 1
          continue
        }
        if (outcome === 'finalized') {
          summary.finalized += 1
        } else if (outcome === 'already-finalized') {
          summary.alreadyFinalized += 1
        } else if (outcome === 'refunded') {
          summary.refunded += 1
        } else if (outcome === 'held') {
          summary.held += 1
          logger.error(`[checkoutSweeper] Booking ${booking._id} held for manual review: paid but unfinalisable (confirm conflict)`)
          // R3-01 — defuse the TTL on the same pass: a held Void booking
          // keeps its past `expireAt`, so the TTL index would delete it
          // ~70 min after expiry (BOOKING_EXPIRE_AT) and orphan the
          // provider payment. Extending drops the booking out of both
          // sweep queries until the new deadline, so the 15-minute
          // finalisation retry becomes a per-review-window retry; a
          // still-blocked booking is re-held (and re-extended) then.
          // A successful retry clears `expireAt` (refresh path), so the
          // extension never blocks confirmation. The status guard means
          // a booking finalised concurrently does not get its `expireAt`
          // moved. A Void hold has no retry button and is not in the
          // paid-unconfirmed queue — the hold notification below is its
          // only review signal.
          const reviewUntil = new Date(now.getTime() + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000)
          const extended = await Booking.updateOne(
            { _id: booking._id, status: bookcarsTypes.BookingStatus.Void },
            { $set: { expireAt: reviewUntil } },
          )
          if (extended.modifiedCount > 0) {
            logger.info(`[checkoutSweeper] Booking ${booking._id} held for manual review until ${reviewUntil.toISOString()} (fully paid but unconfirmed)`)
            await notifyHeldForReview(booking, reviewUntil)
          }
        } else if (outcome === 'not-paid' || outcome === 'no-booking') {
          summary.notPaid += 1
        } else if (outcome === 'refund-failed') {
          // Money was taken but the refund could not be completed — the
          // reconcile call already logged the detail; count it so the
          // sweep summary shows manual review is outstanding.
          summary.errors += 1
          logger.error(`[checkoutSweeper] Booking ${booking._id} needs manual review: provider refund failed`)
        }
        if (outcome === 'finalized' || outcome === 'refunded' || outcome === 'already-finalized') {
          logger.info(`[checkoutSweeper] Booking ${booking._id} reconciled: ${outcome}`)
        }
      } catch (err) {
        // A provider lookup can fail transiently (404 on an expired
        // session, network error on getOrder). Log, count, and continue
        // with the next booking — the next tick retries this one, and
        // the booking is still inside its TTL window.
        const providerError = err as { code?: string, statusCode?: number }
        if (providerError?.code === 'resource_missing' || providerError?.statusCode === 404) {
          logger.info(`[checkoutSweeper] Provider reference for booking ${booking._id} no longer exists; skipping`)
          summary.skipped += 1
        } else {
          logger.error(`[checkoutSweeper] Sweep failed for booking ${booking._id}`, err)
          summary.errors += 1
        }
      }
    }
  } catch (err) {
    // A sweep failure must log and never crash the process.
    logger.error('[checkoutSweeper] sweep failed', err)
    summary.errors += 1
  }
  // GAP-C1/M1 — expired pay-later holds. The car is already released
  // the moment `expireAt` passes (`reservesCar` only counts an
  // unexpired hold); the void below is the status cleanup plus the
  // customer notice, not the release itself. The booking keeps its
  // `expireAt`, so the TTL deletes the abandoned record later —
  // exactly as for an expired Void checkout placeholder.
  try {
    const expiredHolds = await Booking.find({
      status: bookcarsTypes.BookingStatus.Pending,
      // Wave 2 remainder — 2.1 defect (deploy blocker): confirmReservation
      // clears expireAt to null, and MongoDB $lte matches null (null
      // sorts before every other BSON type) — so without these guards
      // the sweeper voided every manager-confirmed hold within 15
      // minutes of a backend start and emailed the customer "hold
      // expired". Only an unconfirmed (Draft) hold WITH a deadline
      // can expire.
      lifecycle: bookcarsTypes.ContractLifecycle.Draft,
      expireAt: { $ne: null, $lte: now },
    }).select('_id driver supplier reference price financialSnapshot to lifecycle').lean()
    for (const hold of expiredHolds) {
      try {
        // GH-32 — a hold whose payment refresh failed stays Pending/Draft
        // with its expireAt intact AND fully paid (a refresh conflict is
        // only returned when outstandingBalance is 0 — ledger.ts). Voiding
        // it would throw away a paid booking; hold it for manual review
        // instead (retry via /api/bookings/:id/refresh-payment-status).
        const receivable = await getContractReceivable(hold as Pick<env.Booking, '_id' | 'price' | 'financialSnapshot' | 'to' | 'lifecycle'>)
        if (receivable.outstandingBalance <= 0) {
          summary.held += 1
          logger.error(`[checkoutSweeper] Booking ${hold._id} is fully paid but unconfirmed (payment refresh failed); NOT voiding — needs manual review`)
          // R3-01 — defuse the TTL on the same pass (same reason as the
          // reconcile-loop hold above): the hold keeps its past
          // `expireAt`, so the TTL would delete the paid booking ~70 min
          // after expiry. Extending drops it out of this query until the
          // new deadline, so the per-pass error above fires at most once
          // per hold cycle (see R3-13). The status guard means a booking
          // confirmed concurrently does not get its `expireAt` moved.
          // The held row surfaces in the paid-unconfirmed filter; the
          // notification below is the alert that it is there.
          const reviewUntil = new Date(now.getTime() + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000)
          const extended = await Booking.updateOne(
            { _id: hold._id, status: bookcarsTypes.BookingStatus.Pending },
            { $set: { expireAt: reviewUntil } },
          )
          if (extended.modifiedCount > 0) {
            logger.info(`[checkoutSweeper] Booking ${hold._id} held for manual review until ${reviewUntil.toISOString()} (fully paid but unconfirmed)`)
            await notifyHeldForReview(hold, reviewUntil)
          }
          continue
        }
        const voided = await Booking.updateOne(
          { _id: hold._id, status: bookcarsTypes.BookingStatus.Pending },
          { $set: { status: bookcarsTypes.BookingStatus.Void } },
        )
        if (voided.modifiedCount === 0) {
          continue
        }
        summary.expiredHolds += 1
        logger.info(`[checkoutSweeper] Pay-later hold expired, booking ${hold._id} voided`)
        await notifyHoldExpired(hold)
      } catch (err) {
        logger.error(`[checkoutSweeper] Failed to void expired pay-later hold ${hold._id}`, err)
        summary.errors += 1
      }
    }
  } catch (err) {
    logger.error('[checkoutSweeper] expired-hold sweep failed', err)
    summary.errors += 1
  }
  if (summary.checked > 0 || summary.expiredHolds > 0 || summary.errors > 0) {
    logger.info(`[checkoutSweeper] sweep finished: ${JSON.stringify(summary)}`)
  }
  return summary
}

/**
 * R3-01 — tell the agency a fully-paid booking was held for manual
 * review. Best effort, log-and-continue: a failing notifier must never
 * break the sweep (same rule as the hold-expiry notice below).
 * In-app notification to the owner + active staff (with a View button
 * to the booking via subjectType 'booking'), email to the owner only
 * (weekly-recap pattern). The hold notification is the alert that the
 * booking is in the paid-unconfirmed review queue — for a Void hold it
 * is the only review signal, because the queue serves Draft+Pending
 * rows only. Fires once per hold cycle: the TTL-defusing extension
 * drops the booking out of the sweep queries until the new deadline.
 */
const notifyHeldForReview = async (
  hold: { _id: mongoose.Types.ObjectId, supplier?: mongoose.Types.ObjectId | string, reference?: string },
  reviewUntil: Date,
): Promise<void> => {
  try {
    if (!hold.supplier) {
      logger.error(`[checkoutSweeper] Cannot notify held-for-review for booking ${hold._id}: no supplier`)
      return
    }
    const recipients = await resolveReminderRecipients(String(hold.supplier))
    if (recipients.length === 0) {
      logger.error(`[checkoutSweeper] Cannot notify held-for-review for booking ${hold._id}: no agency recipients`)
      return
    }
    const reference = hold.reference || String(hold._id)
    const deadline = reviewUntil.toISOString().slice(0, 10)
    for (const recipient of recipients) {
      i18n.locale = recipient.language
      const message = `${i18n.t('BOOKING_HELD_FOR_REVIEW_SUBJECT_PART1')}${reference}${i18n.t('BOOKING_HELD_FOR_REVIEW_SUBJECT_PART2')}`
      await createInAppNotification(recipient._id, message, { subjectType: 'booking', subjectId: String(hold._id), booking: hold._id })
    }
    const owner = recipients[0]
    if (!owner?.email) {
      logger.error(`[checkoutSweeper] Held-for-review email skipped for booking ${hold._id}: owner has no email`)
      return
    }
    i18n.locale = owner.language
    const subject = `${i18n.t('BOOKING_HELD_FOR_REVIEW_SUBJECT_PART1')}${reference}${i18n.t('BOOKING_HELD_FOR_REVIEW_SUBJECT_PART2')}`
    const mailOptions: SendMailOptions = {
      from: env.SMTP_FROM,
      to: owner.email,
      subject,
      html: `<p>
    ${i18n.t('HELLO')}${owner.fullName},<br><br>
    ${i18n.t('BOOKING_HELD_FOR_REVIEW_EMAIL_PART1')}${reference}${i18n.t('BOOKING_HELD_FOR_REVIEW_EMAIL_PART2')}${deadline}${i18n.t('BOOKING_HELD_FOR_REVIEW_EMAIL_PART3')}<br><br>
    ${i18n.t('REGARDS')}<br>
    </p>`,
    }
    await mailHelper.sendMail(mailOptions)
  } catch (err) {
    logger.error(`[checkoutSweeper] Held-for-review notice failed for booking ${hold._id}`, err)
  }
}

/**
 * GAP-C1/M1 — tell the customer their pay-later hold expired. Best
 * effort, log-and-continue: a failing mailer must never break the
 * sweep (same rule as the pay-later confirmation email in checkout).
 * Writes the in-app notification row for the driver and sends the
 * email in the driver's language.
 */
const notifyHoldExpired = async (hold: { _id: mongoose.Types.ObjectId, driver: mongoose.Types.ObjectId, reference?: string }): Promise<void> => {
  try {
    const driver = await User.findById(hold.driver).select('fullName email language').lean()
    if (!driver || !driver.email) {
      logger.error(`[checkoutSweeper] Cannot notify hold expiry for booking ${hold._id}: driver not found`)
      return
    }
    i18n.locale = driver.language
    const message = `${i18n.t('BOOKING_HOLD_EXPIRED_SUBJECT_PART1')}${hold._id} ${i18n.t('BOOKING_HOLD_EXPIRED_SUBJECT_PART2')}`
    const notification = new Notification({
      user: driver._id,
      message,
      booking: hold._id,
    })
    await notification.save()
    let counter = await NotificationCounter.findOne({ user: driver._id })
    if (counter && typeof counter.count !== 'undefined') {
      counter.count += 1
      await counter.save()
    } else {
      counter = new NotificationCounter({ user: driver._id, count: 1 })
      await counter.save()
    }
    const mailOptions: SendMailOptions = {
      from: env.SMTP_FROM,
      to: driver.email,
      subject: message,
      html: `<p>
    ${i18n.t('HELLO')}${driver.fullName},<br><br>
    ${i18n.t('BOOKING_HOLD_EXPIRED_PART1')}${hold.reference || hold._id}${i18n.t('BOOKING_HOLD_EXPIRED_PART2')}${env.FRONTEND_HOST}<br><br>
    ${i18n.t('REGARDS')}<br>
    </p>`,
    }
    await mailHelper.sendMail(mailOptions)
  } catch (err) {
    logger.error(`[checkoutSweeper] Hold-expiry notice failed for booking ${hold._id}`, err)
  }
}

let timer: NodeJS.Timeout | null = null

export const startCheckoutSweeper = (): NodeJS.Timeout | null => {
  if (process.env.BC_CHECKOUT_SWEEPER === 'off') {
    logger.info('[checkoutSweeper] disabled via BC_CHECKOUT_SWEEPER=off')
    return null
  }
  if (timer) {
    return timer
  }
  // One immediate tick so paid-but-unfinalised bookings left behind by a
  // restart (or from before this release) reconcile without waiting a
  // full interval; then the steady 15-minute cadence.
  void runCheckoutSweep()
  timer = setInterval(() => { void runCheckoutSweep() }, CHECKOUT_SWEEPER_TICK_MS)
  timer.unref()
  logger.info('[checkoutSweeper] started (15m tick)')
  return timer
}

export const stopCheckoutSweeper = (): void => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
