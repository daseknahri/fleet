import mongoose from 'mongoose'
import Stripe from 'stripe'
import * as bookcarsTypes from ':bookcars-types'
import Booking from '../models/Booking'
import * as bookingController from '../controllers/bookingController'
import { BookingConflictError } from './bookingReservationHelper'
import * as logger from './logger'
import { currencyExponent, formatProviderAmount, toMinorUnits } from './paymentAmount'

/**
 * F2 / W4 GAP-04 — provider reconciliation shared by the Stripe webhook
 * and the checkout sweeper (and the refund helpers reused by the browser
 * return paths in stripeController / paypalController).
 *
 * The browser return paths (checkCheckoutSession, checkPayPalOrder,
 * confirmPaymentIntent) are the only finalisation routes F1 verified.
 * They cannot run when the customer never returns, so this module holds
 * the same verify → finalise → refund sequence in a form the webhook
 * (event-driven) and the sweeper (timer-driven) can both call without a
 * browser. The F1 rules are preserved exactly:
 *
 * - provider refund first, before any manual-review answer, whenever the
 *   provider already took the money (F1 / W4 GAP-05 pattern);
 * - finalisation goes through bookingController.finalizePaidCheckoutBooking
 *   (same attribution rules, same ledger posting, same idempotency keys);
 * - a booking that already finalised (browser beat the webhook, or a
 *   redelivered event) is `already-finalized`, never finalised twice;
 * - a refunded payment is never refunded twice through a different key:
 *   every refund below reuses the key the browser path uses for the same
 *   situation (`orphan-session-`, `orphan-booking-`, `booking-unavailable-`,
 *   `refund-<id>-mismatch`), so a provider-side idempotency replay
 *   returns the original refund instead of a second one;
 * - reconciliation NEVER deletes a booking. The browser paths delete an
 *   unpaid temp booking; a background job must not race the customer's
 *   in-flight return. TTL expiry owns cleanup.
 *
 * Idempotency by PaymentIntent id: Stripe may redeliver an event and the
 * sweeper runs repeatedly by design. Both are safe because finalisation
 * requires `status: Void` (saveBookingWithAvailability's expected-status
 * guard) and every ledger posting / refund carries a stable idempotency
 * key. No processed-event-id table is kept: the booking state + the
 * provider idempotency keys already give exactly-once effects.
 */

/**
 * Outcome of one reconciliation attempt. `finalized` /
 * `already-finalized` / `refunded` are terminal successes; `not-paid`
 * means the provider shows no completed payment (nothing to do — the
 * booking is left for TTL cleanup); `no-booking` means no booking could
 * be found and no refundable provider payment exists; `refund-failed`
 * means money was taken but the refund could not be completed — staff
 * manual review is required.
 */
export type CheckoutReconcileOutcome =
  | 'finalized'
  | 'already-finalized'
  | 'refunded'
  | 'held'
  | 'not-paid'
  | 'no-booking'
  | 'refund-failed'

export interface CheckoutReconcileResult {
  outcome: CheckoutReconcileOutcome
  bookingId?: string
  detail?: string
}

/**
 * F1 / W4 GAP-05 — refund a succeeded PaymentIntent. Returns `'refunded'`
 * when the money was returned, `'not-paid'` when the intent never
 * succeeded (so there is nothing to refund), and `'failed'` when the
 * refund itself could not be completed (caller must return a
 * manual-review code). Moved here from stripeController so the webhook
 * and the sweeper use the same refund path as the browser return.
 * `idempotencyKey` defaults to the F1 mismatch key; callers that mirror
 * a browser-path refund pass that path's key so a repeat returns the
 * original refund instead of a second one.
 *
 * @param {Stripe} stripeAPI
 * @param {string} paymentIntentId
 * @param {string} [idempotencyKey]
 * @returns {Promise<'refunded' | 'not-paid' | 'failed'>}
 */
export const refundSucceededIntent = async (
  stripeAPI: Stripe,
  paymentIntentId: string,
  idempotencyKey?: string,
): Promise<'refunded' | 'not-paid' | 'failed'> => {
  try {
    const intent = await stripeAPI.paymentIntents.retrieve(paymentIntentId)
    if (!intent || intent.status !== 'succeeded') {
      return 'not-paid'
    }
    await stripeAPI.refunds.create(
      { payment_intent: intent.id },
      { idempotencyKey: idempotencyKey || `refund-${intent.id}-mismatch` },
    )
    return 'refunded'
  } catch (err) {
    logger.error(`[checkoutReconciliation] Mismatch refund failed for ${paymentIntentId}`, err)
    return 'failed'
  }
}

export type PayPalOrderLike = {
  purchase_units?: Array<{ payments?: { captures?: Array<{ id?: string, status?: string }> } }>
}

/**
 * F1 / W4 GAP-05 — refund a COMPLETED PayPal capture. Returns
 * `'refunded'` when the money was returned, `'no-capture'` when no
 * completed capture exists (so no money was taken), and `'failed'` when
 * the refund itself could not be completed. Moved here from
 * paypalController so the sweeper uses the same refund path as the
 * browser return. `idempotencyKey` defaults to the F1 mismatch key;
 * callers that mirror a browser-path refund pass that path's key.
 *
 * @param {object} paypal
 * @param {object} order
 * @param {string} [idempotencyKey]
 * @returns {Promise<'refunded' | 'no-capture' | 'failed'>}
 */
export const refundCompletedCapture = async (
  paypal: { refundCapture: (captureId: string, requestId: string) => Promise<unknown> },
  order: PayPalOrderLike,
  idempotencyKey?: string,
): Promise<'refunded' | 'no-capture' | 'failed'> => {
  const capture = order?.purchase_units?.[0]?.payments?.captures?.find((c) => c?.status === 'COMPLETED' && c?.id)
  if (!capture?.id) {
    return 'no-capture'
  }
  try {
    await paypal.refundCapture(capture.id, idempotencyKey || `refund-${capture.id}-mismatch`)
    return 'refunded'
  } catch (err) {
    logger.error(`[checkoutReconciliation] Mismatch refund failed for capture ${capture.id}`, err)
    return 'failed'
  }
}

/**
 * F1 fix-up round 2 — Mongoose hydrates a missing financialSnapshot as
 * `{}` (truthy), so `!financialSnapshot` is dead at runtime. Treat a
 * snapshot without a numeric rental total as missing (same guard as
 * bookingController.update()).
 */
const hasRealSnapshot = (booking: { financialSnapshot?: { rentalTotal?: unknown } }) =>
  !!booking.financialSnapshot && typeof booking.financialSnapshot.rentalTotal === 'number'


/**
 * R5-01 - defence in depth: a fully-refunded PaymentIntent still
 * reports `status: 'succeeded'`; refund state lives on the charge
 * (`refunded: true`), which the intent alone cannot show. Before
 * finalising a verified intent, check its charge: an already-refunded
 * payment must never finalise into a free confirmed booking. If the
 * intent carries no charge reference, or the charge cannot be
 * retrieved, fall through to the existing path (no new failure mode
 * is invented for a provider read error - the sweeper's
 * provider-error defuse covers a throwing retrieve).
 */
const isChargeRefunded = async (
  stripeAPI: Stripe,
  intent: Stripe.PaymentIntent,
): Promise<boolean> => {
  const chargeId = typeof intent.latest_charge === 'string'
    ? intent.latest_charge
    : intent.latest_charge?.id
  if (!chargeId) {
    return false
  }
  try {
    const charge = await stripeAPI.charges.retrieve(chargeId)
    return !!charge.refunded
  } catch {
    return false
  }
}

/**
 * R5-01 fix-forward - the mismatch branches below only hold the intent
 * id, not the intent object. Retrieve it and apply the same
 * already-refunded check: a re-swept refunded booking must return
 * `not-paid` instead of issuing a second refund (Stripe would replay
 * the original refund under the same idempotency key - no double
 * money - but the sweep summary would count `refunded` +1 every pass,
 * which is exactly the count the sweep watch must stop). A retrieve
 * failure, or no charge reference, falls through to the existing path
 * (no new failure mode for a provider read error).
 */
const isIntentIdRefunded = async (
  stripeAPI: Stripe,
  paymentIntentId: string,
): Promise<boolean> => {
  try {
    const intent = await stripeAPI.paymentIntents.retrieve(paymentIntentId)
    return intent ? await isChargeRefunded(stripeAPI, intent) : false
  } catch {
    return false
  }
}

const intentIdOf = (session: Stripe.Checkout.Session): string | undefined => {
  const intent = session.payment_intent
  return typeof intent === 'string' ? intent : intent?.id
}

/**
 * Finalise a verified booking, or refund the provider payment when the
 * booking cannot be finalised. `refund` is the caller-supplied refund
 * attempt (already bound to the right provider reference and idempotency
 * key). A `false` from finalisation re-checks for an already-paid
 * booking first (another path finalised it meanwhile) before refunding.
 */
type FinalizeBooking = Parameters<typeof bookingController.finalizePaidCheckoutBooking>[0]

const finalizeOrRefund = async (
  booking: FinalizeBooking,
  provider: 'stripe' | 'paypal',
  reference: string,
  refund: () => Promise<'refunded' | 'not-paid' | 'failed' | 'no-capture'>,
): Promise<CheckoutReconcileResult> => {
  const bookingId = booking._id.toString()
  let finalized = false
  try {
    // Reconciliation (webhook / sweeper) only ever sees expired Void
    // bookings: a late webhook delivery or a sweeper tick runs after
    // `expireAt` passed. Without allowExpired the live-booking guard
    // in finalizePaidCheckoutBooking refuses every one of them, so a
    // paid-and-verified booking is refunded instead of finalised.
    // Car-availability conflicts are still enforced inside the save.
    finalized = await bookingController.finalizePaidCheckoutBooking(
      booking,
      provider,
      reference,
      { allowExpired: true },
    )
  } catch (err) {
    // Finalisation can throw after the provider payment succeeded (e.g. a
    // ledger OVERPAYMENT on an inconsistent snapshot). Never keep the
    // money: fall through to the refund below.
    // GH-32 — a confirm conflict (car no longer available / maintenance
    // blocks the flip) is NOT a payment problem: refunding would throw
    // away a paid booking the manager can still confirm via the F-02
    // retry endpoint once the blocker clears. Hold it for manual review;
    // the next tick retries finalisation, it does not refund.
    if (err instanceof BookingConflictError) {
      logger.error(`[checkoutReconciliation] Finalisation blocked by availability conflict for booking ${bookingId}; holding for manual review, NOT refunding`, err)
      return { outcome: 'held', bookingId, detail: 'Booking could not be finalised: the car is no longer available for the dates. Resolve the conflict and retry the payment confirmation.' }
    }
    logger.error(`[checkoutReconciliation] Finalisation failed for booking ${bookingId}`, err)
  }
  if (finalized) {
    return { outcome: 'finalized', bookingId }
  }
  const paidBooking = await Booking.findOne({
    _id: booking._id,
    ...(provider === 'stripe' ? { paymentIntentId: reference } : { paypalOrderId: reference }),
    status: { $ne: bookcarsTypes.BookingStatus.Void },
  })
  if (paidBooking) {
    return { outcome: 'already-finalized', bookingId }
  }
  const refunded = await refund()
  if (refunded === 'refunded') {
    return { outcome: 'refunded', bookingId, detail: 'Booking could not be finalised; the payment was refunded' }
  }
  if (refunded === 'failed') {
    return { outcome: 'refund-failed', bookingId, detail: 'Booking could not be finalised and the payment refund requires support review' }
  }
  return { outcome: 'not-paid', bookingId, detail: 'Booking could not be finalised and no completed provider payment was found to refund' }
}

/**
 * Reconcile one Stripe Checkout Session (webhook
 * `checkout.session.completed` / `checkout.session.async_payment_succeeded`,
 * or the sweeper's session lookup). Mirrors checkCheckoutSession's
 * verification branches; the answers differ because there is no browser
 * to answer to — every terminal outcome is reported, never thrown, so the
 * caller can acknowledge the event and let Stripe stop retrying.
 *
 * @param {Stripe.Checkout.Session} session
 * @returns {Promise<CheckoutReconcileResult>}
 */
export const reconcileStripeSession = async (
  session: Stripe.Checkout.Session,
): Promise<CheckoutReconcileResult> => {
  const stripeAPI = (await import('../payment/stripe.js')).default
  const booking = await Booking.findOne({ sessionId: session.id })
  if (!booking) {
    // Orphan branch — mirrors checkCheckoutSession: a paid session whose
    // booking is gone (TTL-deleted) is refunded when the intent is
    // succeeded and its metadata names this booking.
    const bookingId = session.metadata?.bookingId
    const paymentIntent = intentIdOf(session)
    if (session.payment_status === 'paid' && mongoose.isValidObjectId(bookingId) && paymentIntent) {
      const intent = await stripeAPI.paymentIntents.retrieve(paymentIntent)
      if (intent.status === 'succeeded' && intent.metadata.bookingId === bookingId) {
        await stripeAPI.refunds.create(
          { payment_intent: intent.id },
          { idempotencyKey: `orphan-session-${intent.id}` },
        )
        logger.info(`[checkoutReconciliation] Orphan paid session ${session.id} refunded (booking ${bookingId} not found)`)
        return { outcome: 'refunded', bookingId, detail: 'Booking expired; the payment was refunded' }
      }
    }
    return { outcome: 'no-booking', detail: `No booking found for session ${session.id}` }
  }

  const bookingId = booking._id.toString()
  if (booking.status !== bookcarsTypes.BookingStatus.Void) {
    return { outcome: 'already-finalized', bookingId }
  }
  if (session.payment_status !== 'paid') {
    return { outcome: 'not-paid', bookingId, detail: `Session ${session.id} is ${session.payment_status}` }
  }

  const financialSnapshot = booking.financialSnapshot
  if (!hasRealSnapshot(booking) || session.metadata?.bookingId !== bookingId) {
    // F1 / W4 GAP-05: a paid session whose snapshot is missing or whose
    // metadata disagrees took the money — refund the succeeded intent
    // before answering, as the browser path does.
    const mismatchIntentId = intentIdOf(session)
    if (mismatchIntentId) {
      // R5-01 fix-forward - an already-refunded intent still verifies
      // as succeeded; its charge says otherwise. Never refund it twice:
      // the re-sweep surfaces the booking as not-paid instead.
      if (await isIntentIdRefunded(stripeAPI, mismatchIntentId)) {
        return { outcome: 'not-paid', bookingId, detail: 'Payment intent was already refunded; support review is required' }
      }
      const refunded = await refundSucceededIntent(stripeAPI, mismatchIntentId)
      if (refunded === 'refunded') {
        return { outcome: 'refunded', bookingId, detail: 'Payment requires manual review because the booking snapshot is missing or mismatched; the payment was refunded' }
      }
      if (refunded === 'failed') {
        return { outcome: 'refund-failed', bookingId, detail: 'Payment requires manual review because the booking snapshot is missing or mismatched; the payment refund requires support review' }
      }
      return { outcome: 'refund-failed', bookingId, detail: 'Paid session payment intent did not succeed although the session is paid; support review is required' }
    }
    return { outcome: 'refund-failed', bookingId, detail: 'Paid session has no payment intent to refund; support review is required' }
  }

  const expectedAmountCents = toMinorUnits(financialSnapshot!.amountDueNowInPaymentCurrency, financialSnapshot!.paymentCurrency)
  if (session.currency?.toLowerCase() !== financialSnapshot!.paymentCurrency.toLowerCase()
    || session.amount_total !== expectedAmountCents) {
    const mismatchIntentId = intentIdOf(session)
    if (mismatchIntentId) {
      // R5-01 fix-forward - an already-refunded intent still verifies
      // as succeeded; its charge says otherwise. Never refund it twice:
      // the re-sweep surfaces the booking as not-paid instead.
      if (await isIntentIdRefunded(stripeAPI, mismatchIntentId)) {
        return { outcome: 'not-paid', bookingId, detail: 'Payment intent was already refunded; support review is required' }
      }
      const refunded = await refundSucceededIntent(stripeAPI, mismatchIntentId)
      if (refunded === 'refunded') {
        return { outcome: 'refunded', bookingId, detail: 'Payment currency or amount mismatch; the payment was refunded' }
      }
      if (refunded === 'failed') {
        return { outcome: 'refund-failed', bookingId, detail: 'Payment currency or amount mismatch; the payment refund requires support review' }
      }
      return { outcome: 'refund-failed', bookingId, detail: 'Paid session payment intent did not succeed although the session is paid; support review is required' }
    }
    return { outcome: 'refund-failed', bookingId, detail: 'Paid session has no payment intent to refund; support review is required' }
  }

  const stripePaymentIntentId = intentIdOf(session)
  if (!stripePaymentIntentId) {
    return { outcome: 'refund-failed', bookingId, detail: 'Paid session has no payment intent; support review is required' }
  }
  const verifiedIntent = await stripeAPI.paymentIntents.retrieve(stripePaymentIntentId)
  if (verifiedIntent.status !== 'succeeded'
    || verifiedIntent.metadata.bookingId !== bookingId
    || verifiedIntent.currency.toUpperCase() !== financialSnapshot!.paymentCurrency.toUpperCase()
    || verifiedIntent.amount_received !== expectedAmountCents) {
    if (verifiedIntent.status === 'succeeded') {
      // R5-01 fix-forward - an already-refunded intent still verifies
      // as succeeded; its charge says otherwise. Never refund it twice:
      // the re-sweep surfaces the booking as not-paid instead.
      if (await isChargeRefunded(stripeAPI, verifiedIntent)) {
        return { outcome: 'not-paid', bookingId, detail: 'Payment intent was already refunded; support review is required' }
      }
      const refunded = await refundSucceededIntent(stripeAPI, stripePaymentIntentId)
      if (refunded === 'refunded') {
        return { outcome: 'refunded', bookingId, detail: 'Payment intent does not match the booking snapshot; the payment was refunded' }
      }
      if (refunded === 'failed') {
        return { outcome: 'refund-failed', bookingId, detail: 'Payment intent does not match the booking snapshot; the payment refund requires support review' }
      }
    }
    return { outcome: 'not-paid', bookingId, detail: 'Payment intent did not succeed' }
  }

  // R5-01 - an already-refunded intent still verifies as succeeded;
  // its charge says otherwise. Never finalise refunded money.
  if (await isChargeRefunded(stripeAPI, verifiedIntent)) {
    return { outcome: 'not-paid', bookingId, detail: 'Payment intent was already refunded; support review is required' }
  }

  return finalizeOrRefund(booking, 'stripe', stripePaymentIntentId, async () => {
    const refunded = await refundSucceededIntent(stripeAPI, stripePaymentIntentId, `booking-unavailable-${stripePaymentIntentId}`)
    return refunded
  })
}

/**
 * Reconcile one succeeded Stripe PaymentIntent (webhook
 * `payment_intent.succeeded`, or the sweeper's intent lookup). This is
 * the PaymentSheet path: the booking carries `paymentIntentId` and a
 * random (non-Stripe) `sessionId`, so there is no Checkout Session to
 * reconcile. An embedded-checkout intent also arrives here; its booking
 * has no `paymentIntentId` yet, so the link is the intent metadata
 * (an unset `paymentIntentId` is linkable, a set-but-different one is
 * not — the mobile not-linked branch in confirmPaymentIntent always has
 * a set id, so that rule is unchanged there).
 *
 * @param {Stripe.PaymentIntent} intent
 * @returns {Promise<CheckoutReconcileResult>}
 */
export const reconcileStripeIntent = async (
  intent: Stripe.PaymentIntent,
): Promise<CheckoutReconcileResult> => {
  const stripeAPI = (await import('../payment/stripe.js')).default
  const metadataBookingId = intent.metadata?.bookingId
  let booking = await Booking.findOne({ paymentIntentId: intent.id })
  if (!booking && mongoose.isValidObjectId(metadataBookingId)) {
    booking = await Booking.findById(metadataBookingId)
  }
  if (!booking) {
    if (intent.status === 'succeeded' && metadataBookingId) {
      await stripeAPI.refunds.create(
        { payment_intent: intent.id },
        { idempotencyKey: `orphan-booking-${intent.id}` },
      )
      logger.info(`[checkoutReconciliation] Orphan succeeded intent ${intent.id} refunded (booking ${metadataBookingId} not found)`)
      return { outcome: 'refunded', bookingId: metadataBookingId, detail: 'Booking expired; the payment was refunded' }
    }
    return { outcome: 'no-booking', detail: `No booking found for payment intent ${intent.id}` }
  }

  const bookingId = booking._id.toString()
  if (booking.status !== bookcarsTypes.BookingStatus.Void) {
    return { outcome: 'already-finalized', bookingId }
  }
  if (intent.status !== 'succeeded') {
    return { outcome: 'not-paid', bookingId, detail: `Payment intent ${intent.id} is ${intent.status}` }
  }

  const financialSnapshot = booking.financialSnapshot
  const intentLinked = !booking.paymentIntentId || booking.paymentIntentId === intent.id
  if (!hasRealSnapshot(booking) || intent.metadata?.bookingId !== bookingId || !intentLinked) {
    // R5-01 fix-forward - an already-refunded intent still verifies
    // as succeeded; its charge says otherwise. Never refund it twice:
    // the re-sweep surfaces the booking as not-paid instead.
    if (await isChargeRefunded(stripeAPI, intent)) {
      return { outcome: 'not-paid', bookingId, detail: 'Payment intent was already refunded; support review is required' }
    }
    const refunded = await refundSucceededIntent(stripeAPI, intent.id)
    if (refunded === 'refunded') {
      return { outcome: 'refunded', bookingId, detail: 'Payment intent is not linked to this booking; the payment was refunded' }
    }
    if (refunded === 'failed') {
      return { outcome: 'refund-failed', bookingId, detail: 'Payment intent is not linked to this booking; the payment refund requires support review' }
    }
    return { outcome: 'not-paid', bookingId, detail: 'Payment intent is not linked to this booking and did not succeed' }
  }

  const expectedAmountCents = toMinorUnits(financialSnapshot!.amountDueNowInPaymentCurrency, financialSnapshot!.paymentCurrency)
  if (intent.currency.toUpperCase() !== financialSnapshot!.paymentCurrency.toUpperCase()
    || intent.amount_received !== expectedAmountCents) {
    // R5-01 fix-forward - an already-refunded intent still verifies
    // as succeeded; its charge says otherwise. Never refund it twice:
    // the re-sweep surfaces the booking as not-paid instead.
    if (await isChargeRefunded(stripeAPI, intent)) {
      return { outcome: 'not-paid', bookingId, detail: 'Payment intent was already refunded; support review is required' }
    }
    const refunded = await refundSucceededIntent(stripeAPI, intent.id)
    if (refunded === 'refunded') {
      return { outcome: 'refunded', bookingId, detail: 'Payment intent does not match the booking snapshot; the payment was refunded' }
    }
    if (refunded === 'failed') {
      return { outcome: 'refund-failed', bookingId, detail: 'Payment intent does not match the booking snapshot; the payment refund requires support review' }
    }
    return { outcome: 'not-paid', bookingId, detail: 'Payment intent did not succeed' }
  }

  // R5-01 - an already-refunded intent still verifies as succeeded;
  // its charge says otherwise. Never finalise refunded money.
  if (await isChargeRefunded(stripeAPI, intent)) {
    return { outcome: 'not-paid', bookingId, detail: 'Payment intent was already refunded; support review is required' }
  }

  return finalizeOrRefund(booking, 'stripe', intent.id, async () => {
    const refunded = await refundSucceededIntent(stripeAPI, intent.id, `booking-unavailable-${intent.id}`)
    return refunded
  })
}

/**
 * Reconcile one PayPal order (the sweeper's order lookup; there is no
 * PayPal webhook — PayPal orders are reconciled by polling order status
 * through the existing server-side `getOrder`, which is the equivalent
 * check the browser path already performs). Mirrors
 * checkPayPalOrder's verification branches.
 *
 * @param {object} order PayPal order as returned by `getOrder`
 * @returns {Promise<CheckoutReconcileResult>}
 */
export const reconcilePayPalOrder = async (
  order: {
    id?: string
    status?: string
    purchase_units?: Array<{
      invoice_id?: string
      amount?: { currency_code?: string, value?: string }
      payments?: { captures?: Array<{ id?: string, status?: string, amount?: { currency_code?: string, value?: string } }> }
    }>
  },
): Promise<CheckoutReconcileResult> => {
  const paypal = await import('../payment/paypal.js')
  const purchaseUnit = order.purchase_units?.[0]
  const invoiceId = purchaseUnit?.invoice_id
  let booking = mongoose.isValidObjectId(invoiceId) ? await Booking.findById(invoiceId) : null
  if (!booking && order.id) {
    booking = await Booking.findOne({ paypalOrderId: order.id })
  }
  if (!booking) {
    // Orphan branch — mirrors checkPayPalOrder: a COMPLETED order whose
    // booking is gone is refunded when the invoice names a booking id
    // (that booking no longer exists — this branch only runs after the
    // lookup above found nothing).
    const orphanCapture = purchaseUnit?.payments?.captures?.[0]
    if (mongoose.isValidObjectId(invoiceId)
      && order?.id
      && order.status === 'COMPLETED'
      && orphanCapture?.status === 'COMPLETED'
      && orphanCapture.id) {
      await paypal.refundCapture(orphanCapture.id, `bc-orphan-${orphanCapture.id}`)
      logger.info(`[checkoutReconciliation] Orphan completed PayPal order ${order.id} refunded (booking ${invoiceId} not found)`)
      return { outcome: 'refunded', bookingId: invoiceId, detail: 'Booking expired; the payment was refunded' }
    }
    return { outcome: 'no-booking', detail: `No booking found for PayPal order ${order.id}` }
  }

  const bookingId = booking._id.toString()
  if (booking.status !== bookcarsTypes.BookingStatus.Void) {
    return { outcome: 'already-finalized', bookingId }
  }
  if (order.status !== 'COMPLETED') {
    return { outcome: 'not-paid', bookingId, detail: `PayPal order ${order.id} is ${order.status}` }
  }

  const snapshot = booking.financialSnapshot
  if (!hasRealSnapshot(booking) || booking.paypalOrderId !== order.id) {
    const refunded = await refundCompletedCapture(paypal, order)
    if (refunded === 'refunded') {
      return { outcome: 'refunded', bookingId, detail: 'Payment order is not linked to this booking; the payment was refunded' }
    }
    if (refunded === 'failed') {
      return { outcome: 'refund-failed', bookingId, detail: 'Payment order is not linked to this booking; the payment refund requires support review' }
    }
    return { outcome: 'not-paid', bookingId, detail: 'Payment order is not linked to this booking and has no completed capture' }
  }

  const paidAmount = Number(Number.parseFloat(purchaseUnit?.amount?.value || '0').toFixed(currencyExponent(snapshot!.paymentCurrency)))
  const paidCurrency = purchaseUnit?.amount?.currency_code
  const capture = purchaseUnit?.payments?.captures?.[0]
  const expectedPrice = Number.parseFloat(formatProviderAmount(snapshot!.amountDueNowInPaymentCurrency, snapshot!.paymentCurrency))
  if (invoiceId !== bookingId
    || !paidCurrency || paidCurrency.toUpperCase() !== snapshot!.paymentCurrency.toUpperCase()
    || paidAmount !== expectedPrice) {
    const refunded = await refundCompletedCapture(paypal, order)
    if (refunded === 'refunded') {
      return { outcome: 'refunded', bookingId, detail: 'PayPal invoice, currency or amount mismatch; the payment was refunded' }
    }
    if (refunded === 'failed') {
      return { outcome: 'refund-failed', bookingId, detail: 'PayPal invoice, currency or amount mismatch; the payment refund requires support review' }
    }
    return { outcome: 'not-paid', bookingId, detail: 'PayPal order has no completed capture to refund' }
  }

  if (!capture?.id) {
    return { outcome: 'refund-failed', bookingId, detail: 'Completed PayPal order has no verified capture; support review is required' }
  }
  // (The browser path also checks `order.id !== orderId` against the URL
  // param; reconcile has no separate param — the order object itself is
  // the authority — so only the capture status is checked here.)
  if (capture.status !== 'COMPLETED') {
    const refunded = await refundCompletedCapture(paypal, order)
    if (refunded === 'refunded') {
      return { outcome: 'refunded', bookingId, detail: 'PayPal capture verification failed; the payment was refunded' }
    }
    if (refunded === 'failed') {
      return { outcome: 'refund-failed', bookingId, detail: 'PayPal capture verification failed; the payment refund requires support review' }
    }
    return { outcome: 'not-paid', bookingId, detail: 'PayPal capture verification failed and no completed capture was found' }
  }
  const capturedAmount = Number(Number.parseFloat(capture.amount?.value || '0').toFixed(currencyExponent(snapshot!.paymentCurrency)))
  if (capture.amount?.currency_code?.toUpperCase() !== snapshot!.paymentCurrency.toUpperCase() || capturedAmount !== expectedPrice) {
    const refunded = await refundCompletedCapture(paypal, order)
    if (refunded === 'refunded') {
      return { outcome: 'refunded', bookingId, detail: 'PayPal capture amount or currency mismatch; the payment was refunded' }
    }
    if (refunded === 'failed') {
      return { outcome: 'refund-failed', bookingId, detail: 'PayPal capture amount or currency mismatch; the payment refund requires support review' }
    }
    return { outcome: 'not-paid', bookingId, detail: 'PayPal capture amount or currency mismatch and no completed capture was found' }
  }

  return finalizeOrRefund(booking, 'paypal', order.id!, async () => {
    const refunded = await refundCompletedCapture(paypal, order, `bc-unavailable-${bookingId}`)
    return refunded
  })
}
