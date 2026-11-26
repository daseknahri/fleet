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
import type { CheckoutReconcileOutcome } from './checkoutReconciliation'

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

// R3-13 — de-noise the held-for-review error log. A held booking is
// re-held (and re-extended) once per review window, so a single stuck
// booking emitted one `logger.error` every 15 minutes indefinitely.
// First sight of a hold per process logs error; repeats log warn.
// The set is pruned at the end of each sweep to the holds seen in
// that pass, so a stale entry cannot survive a restart or a booking
// that stops being held, and a re-held booking after a gap logs
// error again only if the prune dropped it (i.e. it was not held on
// the previous pass — exactly the re-hold signal that matters).
const heldAlreadyLogged = new Set<string>()

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
  /** R4-03 - reconcile-loop provider errors: the booking was preserved (TTL defused) because its payment state could not be established. */
  providerErrors: number
}

/**
 * R4-02 / R3-01 follow-on — reconcile ONE expired Void booking
 * against its provider: the per-booking unit of runCheckoutSweep,
 * shared with the manual retry (POST /api/bookings/:id/refresh-
 * payment-status). Fetches the provider object, reconciles it, and
 * performs the outcome side effects (TTL defuse + notify on held /
 * refund-failed / provider-error; clear the hold extension on
 * refunded). Returns the outcome + detail; the caller counts it
 * (sweep summary) or maps it (refresh result). `heldThisPass` is the
 * sweep's de-noise set (R3-13); a manual retry passes a fresh set —
 * the module-level set keeps the key, so a still-held booking stays
 * at warn. A provider lookup failure is NOT 'still inside its TTL
 * window' (R4-03): the booking is preserved (defused + notified)
 * and reported as 'provider-error', unless the defuse could not
 * apply (booking finalised concurrently) — then 'skipped'.
 */
export type VoidReconcileOutcome = CheckoutReconcileOutcome | 'skipped' | 'provider-error'

export const reconcileOneVoidBooking = async (
  booking: {
    _id: mongoose.Types.ObjectId
    sessionId?: string | null
    paymentIntentId?: string | null
    paypalOrderId?: string | null
    supplier?: mongoose.Types.ObjectId | string
    reference?: string
    financialSnapshot?: { amountDueNowInPaymentCurrency?: number, paymentCurrency?: string }
  },
  now: Date = new Date(),
  heldThisPass: Set<string> = new Set<string>(),
): Promise<{ outcome: VoidReconcileOutcome, detail?: string }> => {
  try {
    let outcome: CheckoutReconcileOutcome
    let outcomeDetail: string | undefined
    if (booking.paypalOrderId) {
      // PayPal bookings carry a random (non-Stripe) sessionId, so the
      // order id is the only provider reference that can be checked.
      const paypal = await import('../payment/paypal.js')
      const order = await paypal.getOrder(booking.paypalOrderId)
      const reconciled = await reconcilePayPalOrder(order)
      outcome = reconciled.outcome
      outcomeDetail = reconciled.detail
    } else if (booking.paymentIntentId) {
      // PaymentSheet bookings: the intent id is the reference; the
      // sessionId is a random UUID, not a Stripe session.
      const stripeAPI = (await import('../payment/stripe.js')).default
      const intent: Stripe.PaymentIntent = await stripeAPI.paymentIntents.retrieve(booking.paymentIntentId)
      const reconciled = await reconcileStripeIntent(intent)
      outcome = reconciled.outcome
      outcomeDetail = reconciled.detail
    } else if (booking.sessionId?.startsWith('cs_')) {
      // Embedded-checkout bookings: the session id is the reference.
      const stripeAPI = (await import('../payment/stripe.js')).default
      const session: Stripe.Checkout.Session = await stripeAPI.checkout.sessions.retrieve(booking.sessionId)
      const reconciled = await reconcileStripeSession(session)
      outcome = reconciled.outcome
      outcomeDetail = reconciled.detail
    } else {
      logger.info(`[checkoutSweeper] Booking ${booking._id} has no retrievable provider reference; skipping`)
      return { outcome: 'skipped' }
    }
    if (outcome === 'finalized' || outcome === 'already-finalized' || outcome === 'refunded') {
      if (outcome === 'refunded') {
        // R4-01 companion - a refunded booking must not keep reserving
        // the car for the remainder of a review window it no longer
        // needs: clear the hold extension so the booking stops
        // reserving the car. No time filter on the update: the sweep
        // only selects bookings whose expireAt already passed, so a
        // $gt: now filter could never match and the clear would never
        // fire. The status guard is the concurrency protection (a
        // booking finalised concurrently is not touched).
        await Booking.updateOne(
          { _id: booking._id, status: bookcarsTypes.BookingStatus.Void },
          { $set: { expireAt: null } },
        )
      }
      logger.info(`[checkoutSweeper] Booking ${booking._id} reconciled: ${outcome}`)
    } else if (outcome === 'held') {
      // R3-13 — first sight per process is an error; repeats are
      // a warn (the hold re-fires once per review window).
      const holdKey = `reconcile:${booking._id.toString()}`
      heldThisPass.add(holdKey)
      if (heldAlreadyLogged.has(holdKey)) {
        logger.warn(`[checkoutSweeper] Booking ${booking._id} still held for manual review: paid but unfinalisable (confirm conflict)`)
      } else {
        heldAlreadyLogged.add(holdKey)
        logger.error(`[checkoutSweeper] Booking ${booking._id} held for manual review: paid but unfinalisable (confirm conflict)`)
      }
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
      // moved. A Void hold is served in the paid-unconfirmed queue
      // with a retry button (R4-02 / R3-01 follow-on); the hold
      // notification below is the alert that it is there.
      const reviewUntil = new Date(now.getTime() + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000)
      const extended = await Booking.updateOne(
        { _id: booking._id, status: bookcarsTypes.BookingStatus.Void },
        { $set: { expireAt: reviewUntil } },
      )
      if (extended.modifiedCount > 0) {
        logger.info(`[checkoutSweeper] Booking ${booking._id} held for manual review until ${reviewUntil.toISOString()} (fully paid but unconfirmed)`)
        await notifyHeldForReview(booking, reviewUntil)
      }
    } else if (outcome === 'refund-failed') {
      // R4-01 - same TTL defuse as held: a Void booking with a failed
      // refund keeps its past `expireAt`, so the TTL index would delete it
      // ~70 min after expiry and orphan the provider payment with no record
      // and no refund trigger. Extend to the review window and notify, so a
      // still-failed refund is re-held (and re-notified) each window like held.
      logger.error(`[checkoutSweeper] Booking ${booking._id} needs manual review: provider refund failed`)
      const reviewUntil = new Date(now.getTime() + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000)
      const extended = await Booking.updateOne(
        { _id: booking._id, status: bookcarsTypes.BookingStatus.Void },
        { $set: { expireAt: reviewUntil } },
      )
      if (extended.modifiedCount > 0) {
        logger.info(`[checkoutSweeper] Booking ${booking._id} held for manual review until ${reviewUntil.toISOString()} (provider refund failed)`)
        await notifyRefundFailed(booking, reviewUntil, outcomeDetail)
      }
    }
    // 'not-paid' / 'no-booking': no side effect; the TTL owns cleanup.
    return { outcome, detail: outcomeDetail }
  } catch (err) {
    // R4-03 - a provider lookup failure is NOT "still inside its TTL
    // window": the booking entered this loop because its expireAt
    // already passed, so the TTL deletes it ~70 min after expiry
    // whether or not the provider ever answers. A sustained outage
    // would delete bookings whose payment state was never established.
    // Defuse like held (status-guarded), count separately, and notify
    // once per defuse: the extension drops the booking out of the
    // sweep query until the new deadline, so a down provider notifies
    // at most once per review window per booking.
    const providerError = err as { code?: string, statusCode?: number }
    const detail = err instanceof Error ? err.message : 'Provider lookup failed'
    if (providerError?.code === 'resource_missing' || providerError?.statusCode === 404) {
      logger.info(`[checkoutSweeper] Provider reference for booking ${booking._id} no longer exists; preserving for manual review`)
    } else {
      logger.error(`[checkoutSweeper] Sweep failed for booking ${booking._id}`, err)
    }
    const reviewUntil = new Date(now.getTime() + env.HELD_BOOKING_REVIEW_EXPIRE_AT * 1000)
    const preserved = await Booking.updateOne(
      { _id: booking._id, status: bookcarsTypes.BookingStatus.Void },
      { $set: { expireAt: reviewUntil } },
    )
    if (preserved.modifiedCount > 0) {
      logger.info(`[checkoutSweeper] Booking ${booking._id} held for manual review until ${reviewUntil.toISOString()} (provider unreachable)`)
      await notifyProviderUnreachable(booking, reviewUntil, detail)
      return { outcome: 'provider-error', detail }
    }
    return { outcome: 'skipped', detail }
  }
}

export const runCheckoutSweep = async (now: Date = new Date()): Promise<CheckoutSweepSummary> => {
  // R3-13 — the holds seen on THIS pass; the module-level set is
  // pruned to it at the end of the sweep.
  const heldThisPass = new Set<string>()
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
    providerErrors: 0,
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
    }).select('_id sessionId paymentIntentId paypalOrderId supplier reference financialSnapshot')
    for (const booking of bookings) {
      summary.checked += 1
      const { outcome } = await reconcileOneVoidBooking(booking, now, heldThisPass)
      if (outcome === 'finalized') {
        summary.finalized += 1
      } else if (outcome === 'already-finalized') {
        summary.alreadyFinalized += 1
      } else if (outcome === 'refunded') {
        summary.refunded += 1
      } else if (outcome === 'held') {
        summary.held += 1
      } else if (outcome === 'not-paid' || outcome === 'no-booking') {
        summary.notPaid += 1
      } else if (outcome === 'refund-failed') {
        summary.errors += 1
      } else if (outcome === 'skipped') {
        summary.skipped += 1
      } else if (outcome === 'provider-error') {
        summary.providerErrors += 1
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
          // R3-13 — first sight per process is an error; repeats are
          // a warn (the hold re-fires once per review window).
          const holdKey = `expired:${hold._id.toString()}`
          heldThisPass.add(holdKey)
          if (heldAlreadyLogged.has(holdKey)) {
            logger.warn(`[checkoutSweeper] Booking ${hold._id} still fully paid but unconfirmed (payment refresh failed); NOT voiding — needs manual review`)
          } else {
            heldAlreadyLogged.add(holdKey)
            logger.error(`[checkoutSweeper] Booking ${hold._id} is fully paid but unconfirmed (payment refresh failed); NOT voiding — needs manual review`)
          }
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
  // R3-13 — prune the de-noise set to this pass's holds, so a booking
  // that stops being held drops out and a later re-hold logs error
  // again (fresh signal), while a continuously-held booking stays
  // at warn.
  for (const key of [...heldAlreadyLogged]) {
    if (!heldThisPass.has(key)) {
      heldAlreadyLogged.delete(key)
    }
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
 * booking is in the paid-unconfirmed review queue (R4-02 / R3-01
 * follow-on: Void holds are served there with a retry button).
 * Fires once per hold cycle: the TTL-defusing extension
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
 * R4-01 - tell the agency a paid booking's refund failed. Best effort,
 * log-and-continue (same rule as notifyHeldForReview). In-app notification
 * to the owner + active staff (View button to the booking), email to the
 * owner only. Carries the booking reference, the amount taken
 * (financialSnapshot.amountDueNowInPaymentCurrency), the reconcile detail,
 * and the review deadline. Fires once per hold cycle: the TTL-defusing
 * extension drops the booking out of the sweep queries until the new deadline.
 */
const notifyRefundFailed = async (
  booking: { _id: mongoose.Types.ObjectId, supplier?: mongoose.Types.ObjectId | string, reference?: string, financialSnapshot?: { amountDueNowInPaymentCurrency?: number, paymentCurrency?: string } },
  reviewUntil: Date,
  detail?: string,
): Promise<void> => {
  try {
    if (!booking.supplier) {
      logger.error(`[checkoutSweeper] Cannot notify refund-failed for booking ${booking._id}: no supplier`)
      return
    }
    const recipients = await resolveReminderRecipients(String(booking.supplier))
    if (recipients.length === 0) {
      logger.error(`[checkoutSweeper] Cannot notify refund-failed for booking ${booking._id}: no agency recipients`)
      return
    }
    const reference = booking.reference || String(booking._id)
    const deadline = reviewUntil.toISOString().slice(0, 10)
    const amount = booking.financialSnapshot?.amountDueNowInPaymentCurrency
    const currency = booking.financialSnapshot?.paymentCurrency
    const amountText = typeof amount === 'number' && currency ? `${amount} ${currency}` : 'unknown amount'
    const reason = detail || 'The payment refund requires support review'
    for (const recipient of recipients) {
      i18n.locale = recipient.language
      const message = `${i18n.t('BOOKING_REFUND_FAILED_SUBJECT_PART1')}${reference}${i18n.t('BOOKING_REFUND_FAILED_SUBJECT_PART2')}`
      await createInAppNotification(recipient._id, message, { subjectType: 'booking', subjectId: String(booking._id), booking: booking._id })
    }
    const owner = recipients[0]
    if (!owner?.email) {
      logger.error(`[checkoutSweeper] Refund-failed email skipped for booking ${booking._id}: owner has no email`)
      return
    }
    i18n.locale = owner.language
    const subject = `${i18n.t('BOOKING_REFUND_FAILED_SUBJECT_PART1')}${reference}${i18n.t('BOOKING_REFUND_FAILED_SUBJECT_PART2')}`
    const mailOptions: SendMailOptions = {
      from: env.SMTP_FROM,
      to: owner.email,
      subject,
      html: `<p>
    ${i18n.t('HELLO')}${owner.fullName},<br><br>
    ${i18n.t('BOOKING_REFUND_FAILED_EMAIL_PART1')}${reference}${i18n.t('BOOKING_REFUND_FAILED_EMAIL_PART2')}${amountText}${i18n.t('BOOKING_REFUND_FAILED_EMAIL_PART3')}${reason}${i18n.t('BOOKING_REFUND_FAILED_EMAIL_PART4')}${deadline}${i18n.t('BOOKING_REFUND_FAILED_EMAIL_PART5')}<br><br>
    ${i18n.t('REGARDS')}<br>
    </p>`,
    }
    await mailHelper.sendMail(mailOptions)
  } catch (err) {
    logger.error(`[checkoutSweeper] Refund-failed notice failed for booking ${booking._id}`, err)
  }
}

/**
 * R4-03 - tell the agency a booking was preserved because the payment
 * provider could not be reached. Best effort, log-and-continue. Same
 * recipients and shape as notifyHeldForReview (in-app to owner + active
 * staff, email to the owner only). Fires at most once per review window:
 * the defusing extension drops the booking out of the sweep query until
 * the new deadline.
 */
const notifyProviderUnreachable = async (
  booking: { _id: mongoose.Types.ObjectId, supplier?: mongoose.Types.ObjectId | string, reference?: string },
  reviewUntil: Date,
  detail: string,
): Promise<void> => {
  try {
    if (!booking.supplier) {
      logger.error(`[checkoutSweeper] Cannot notify provider-unreachable for booking ${booking._id}: no supplier`)
      return
    }
    const recipients = await resolveReminderRecipients(String(booking.supplier))
    if (recipients.length === 0) {
      logger.error(`[checkoutSweeper] Cannot notify provider-unreachable for booking ${booking._id}: no agency recipients`)
      return
    }
    const reference = booking.reference || String(booking._id)
    const deadline = reviewUntil.toISOString().slice(0, 10)
    for (const recipient of recipients) {
      i18n.locale = recipient.language
      const message = `${i18n.t('BOOKING_PROVIDER_UNREACHABLE_SUBJECT_PART1')}${reference}${i18n.t('BOOKING_PROVIDER_UNREACHABLE_SUBJECT_PART2')}`
      await createInAppNotification(recipient._id, message, { subjectType: 'booking', subjectId: String(booking._id), booking: booking._id })
    }
    const owner = recipients[0]
    if (!owner?.email) {
      logger.error(`[checkoutSweeper] Provider-unreachable email skipped for booking ${booking._id}: owner has no email`)
      return
    }
    i18n.locale = owner.language
    const subject = `${i18n.t('BOOKING_PROVIDER_UNREACHABLE_SUBJECT_PART1')}${reference}${i18n.t('BOOKING_PROVIDER_UNREACHABLE_SUBJECT_PART2')}`
    const mailOptions: SendMailOptions = {
      from: env.SMTP_FROM,
      to: owner.email,
      subject,
      html: `<p>
    ${i18n.t('HELLO')}${owner.fullName},<br><br>
    ${i18n.t('BOOKING_PROVIDER_UNREACHABLE_EMAIL_PART1')}${reference}${i18n.t('BOOKING_PROVIDER_UNREACHABLE_EMAIL_PART2')}${detail}${i18n.t('BOOKING_PROVIDER_UNREACHABLE_EMAIL_PART3')}${deadline}${i18n.t('BOOKING_PROVIDER_UNREACHABLE_EMAIL_PART4')}<br><br>
    ${i18n.t('REGARDS')}<br>
    </p>`,
    }
    await mailHelper.sendMail(mailOptions)
  } catch (err) {
    logger.error(`[checkoutSweeper] Provider-unreachable notice failed for booking ${booking._id}`, err)
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
