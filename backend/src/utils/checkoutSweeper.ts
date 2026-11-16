import Stripe from 'stripe'
import * as bookcarsTypes from ':bookcars-types'
import Booking from '../models/Booking'
import * as logger from './logger'
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
    }).select('_id sessionId paymentIntentId paypalOrderId')
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
  if (summary.checked > 0 || summary.errors > 0) {
    logger.info(`[checkoutSweeper] sweep finished: ${JSON.stringify(summary)}`)
  }
  return summary
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
