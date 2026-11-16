import { Request, Response } from 'express'
import mongoose from 'mongoose'
import Stripe from 'stripe'
import i18n from '../lang/i18n'
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import * as bookcarsTypes from ':bookcars-types'
import Booking from '../models/Booking'
import * as bookingController from './bookingController'
import { BookingConflictError } from '../utils/bookingReservationHelper'
import { toMinorUnits } from '../utils/paymentAmount'
import { reconcileStripeIntent, reconcileStripeSession, refundSucceededIntent } from '../utils/checkoutReconciliation'

/**
 * F1 / W4 GAP-05 — map a mismatch-refund outcome to the response. A
 * refunded payment is a 409 manual-review case, never a bare 400: the
 * customer must know the money was returned and staff must review why the
 * verification disagreed with the provider.
 *
 * @param {Response} res
 * @param {'refunded' | 'not-paid' | 'failed'} outcome
 * @param {string} detail
 * @returns {boolean} true when a response was sent
 */
const respondMismatch = (res: Response, outcome: 'refunded' | 'not-paid' | 'failed', detail: string) => {
  if (outcome === 'refunded') {
    res.status(409).send(`${detail}; the payment was refunded. Support review is required.`)
    return true
  }
  if (outcome === 'failed') {
    res.status(500).send(`${detail}. Payment refund requires support review.`)
    return true
  }
  return false
}

/**
 * Create Checkout Session.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const createCheckoutSession = async (_req: Request, res: Response) => {
  res.status(410).send('Payment sessions are created from a server-priced booking checkout')
}

/**
 * Check Checkout Session and update booking if the payment succeeded.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const checkCheckoutSession = async (req: Request, res: Response) => {
  let stripePaymentIntentId: string | undefined
  try {
    const stripeAPI = (await import('../payment/stripe.js')).default
    const { sessionId } = req.params

    //
    // 1. Retrieve Checkout Sesssion and Booking
    //
    let session: Stripe.Checkout.Session | undefined
    try {
      session = await stripeAPI.checkout.sessions.retrieve(sessionId)
    } catch (err) {
      const stripeError = err as { code?: string, statusCode?: number }
      if (stripeError?.code === 'resource_missing' || stripeError?.statusCode === 404) {
        const msg = `Session ${sessionId} not found`
        logger.info(`[stripe.checkCheckoutSession] ${msg}`)
        res.status(404).send(msg)
        return
      }
      logger.error(`[stripe.checkCheckoutSession] retrieve session error: ${sessionId}`, err)
      res.status(503).send('Payment provider unavailable; support review is required')
      return
    }

    if (!session) {
      const msg = `Session ${sessionId} not found`
      logger.info(`[stripe.checkCheckoutSession] ${msg}`)
      res.status(204).send(msg)
      return
    }

    const booking = await Booking.findOne({ sessionId })
    if (!booking) {
      const bookingId = session.metadata?.bookingId
      const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
      if (session.payment_status === 'paid' && mongoose.isValidObjectId(bookingId) && paymentIntent) {
        const intent = await stripeAPI.paymentIntents.retrieve(paymentIntent)
        if (intent.status === 'succeeded' && intent.metadata.bookingId === bookingId) {
          await stripeAPI.refunds.create(
            { payment_intent: intent.id },
            { idempotencyKey: `orphan-session-${intent.id}` },
          )
          res.status(410).send('Booking expired; the payment was refunded')
          return
        }
      }
      const msg = `Booking with sessionId ${sessionId} not found`
      logger.info(`[stripe.checkCheckoutSession] ${msg}`)
      res.status(204).send(msg)
      return
    }

    const financialSnapshot = booking.financialSnapshot
    // F1 fix-up round 2: Mongoose hydrates a missing financialSnapshot as
    // {} (truthy), so !financialSnapshot is dead at runtime — a paid
    // snapshot-less booking skipped this branch, threw in toMinorUnits
    // (Unsupported currency undefined) and returned a bare 400 with the
    // money kept. Treat a snapshot without a numeric rental total as
    // missing (same guard as bookingController.update()).
    const hasRealSnapshot = !!financialSnapshot && typeof financialSnapshot.rentalTotal === 'number'
    if (!hasRealSnapshot || session.metadata?.bookingId !== booking._id.toString()) {
      // F1 fix-up / W4 GAP-05: a paid session whose snapshot is missing or
      // whose metadata disagrees with the booking took the money — refund
      // the succeeded intent before answering, as the adjacent
      // currency/amount branches do. Refunding returns the money to this
      // session's payer; bookings are found by their own sessionId, so no
      // other booking's flow can refund the same intent. An unpaid session
      // took nothing and keeps the plain 409.
      if (session.payment_status === 'paid') {
        const mismatchIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
        if (mismatchIntentId) {
          if (respondMismatch(res, await refundSucceededIntent(stripeAPI, mismatchIntentId), 'Payment requires manual review because the booking snapshot is missing or mismatched')) {
            return
          }
        }
      }
      res.status(409).send('Payment requires manual review because the booking snapshot is missing or mismatched')
      return
    }

    //
    // 2. Update Booking if the payment succeeded
    // (Set BookingStatus to Paid and remove expireAt TTL index)
    //
    if (session.payment_status === 'paid') {
      const expectedAmountCents = toMinorUnits(financialSnapshot.amountDueNowInPaymentCurrency, financialSnapshot.paymentCurrency)

      if (session.currency?.toLowerCase() !== financialSnapshot.paymentCurrency.toLowerCase()) {
        const message = `Payment currency mismatch: expected ${financialSnapshot.paymentCurrency}, got ${session.currency}`
        logger.error(`[stripe.checkCheckoutSession] ${message}`)
        // F1 / W4 GAP-05: the session is paid — refund the succeeded intent
        // before returning, instead of keeping the money on a 400.
        const mismatchIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
        if (mismatchIntentId) {
          stripePaymentIntentId = mismatchIntentId
          if (respondMismatch(res, await refundSucceededIntent(stripeAPI, mismatchIntentId), message)) {
            return
          }
        }
        res.status(400).send(message)
        return
      }

      if (session.amount_total !== expectedAmountCents) {
        const message = `Payment amount mismatch: expected ${expectedAmountCents}, got ${session.amount_total}`
        logger.error(`[stripe.checkCheckoutSession] ${message}`)
        // F1 / W4 GAP-05: the session is paid — refund the succeeded intent
        // before returning, instead of keeping the money on a 400.
        const mismatchIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
        if (mismatchIntentId) {
          stripePaymentIntentId = mismatchIntentId
          if (respondMismatch(res, await refundSucceededIntent(stripeAPI, mismatchIntentId), message)) {
            return
          }
        }
        res.status(400).send(message)
        return
      }

      const paymentIntent = session.payment_intent
      stripePaymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id
      if (!stripePaymentIntentId) {
        res.status(409).send('Paid session has no payment intent; support review is required')
        return
      }
      const verifiedIntent = await stripeAPI.paymentIntents.retrieve(stripePaymentIntentId)
      if (verifiedIntent.status !== 'succeeded'
        || verifiedIntent.metadata.bookingId !== booking._id.toString()
        || verifiedIntent.currency.toUpperCase() !== financialSnapshot.paymentCurrency.toUpperCase()
        || verifiedIntent.amount_received !== expectedAmountCents) {
        // F1 / W4 GAP-05: a succeeded intent that disagrees with the
        // snapshot is refunded, not kept on a 400. An intent that never
        // succeeded took no money, so the plain 400 stands.
        if (verifiedIntent.status === 'succeeded') {
          const message = 'Payment intent does not match the booking snapshot'
          logger.error(`[stripe.checkCheckoutSession] ${message}: intent ${verifiedIntent.id}, expected ${expectedAmountCents} ${financialSnapshot.paymentCurrency}, got ${verifiedIntent.amount_received} ${verifiedIntent.currency}`)
          if (respondMismatch(res, await refundSucceededIntent(stripeAPI, stripePaymentIntentId), message)) {
            return
          }
        }
        res.status(400).send('Payment intent does not match the booking snapshot')
        return
      }

      const finalized = await bookingController.finalizePaidCheckoutBooking(booking, 'stripe', stripePaymentIntentId)
      if (!finalized) {
        const existingPaidBooking = await Booking.findOne({ _id: booking._id, paymentIntentId: stripePaymentIntentId })
        if (existingPaidBooking && existingPaidBooking.status !== bookcarsTypes.BookingStatus.Void) {
          res.sendStatus(200)
          return
        }
        await stripeAPI.refunds.create(
          { payment_intent: stripePaymentIntentId },
          { idempotencyKey: `booking-unavailable-${stripePaymentIntentId}` },
        )
        res.status(409).send('Booking unavailable; the payment was refunded')
        return
      }

      res.sendStatus(200)
      return
    }

    //
    // 3. Delete Booking if the payment didn't succeed
    //
    await booking.deleteOne()
    res.status(400).send(session.payment_status)
  } catch (err) {
    if (err instanceof BookingConflictError) {
      if (!stripePaymentIntentId) {
        logger.error('[stripe.checkCheckoutSession] Paid session has no payment intent', req.params.sessionId)
        res.status(500).send('Booking unavailable. Payment refund requires support review.')
        return
      }
      try {
        const stripeAPI = (await import('../payment/stripe.js')).default
        await stripeAPI.refunds.create(
          { payment_intent: stripePaymentIntentId },
          { idempotencyKey: `booking-conflict-${req.params.sessionId}` },
        )
        await Booking.deleteOne({ sessionId: req.params.sessionId, status: bookcarsTypes.BookingStatus.Void })
      } catch (refundError) {
        logger.error('[stripe.checkCheckoutSession] Failed to refund payment after booking conflict', refundError)
        res.status(500).send('Booking unavailable. Payment refund requires support review.')
        return
      }
      res.status(409).send(err.message)
      return
    }
    logger.error(`[stripe.checkCheckoutSession] ${i18n.t('ERROR')}`, err)
    // F1 / W3 P-2a + W4 GAP-05: finalisation can throw after the provider
    // payment succeeded (e.g. a ledger OVERPAYMENT). Never return a bare
    // 400 with the money taken: if the booking did finalise despite the
    // throw, report success; otherwise refund the succeeded intent first.
    if (stripePaymentIntentId) {
      try {
        const paidBooking = await Booking.findOne({ sessionId: req.params.sessionId, paymentIntentId: stripePaymentIntentId, status: { $ne: bookcarsTypes.BookingStatus.Void } })
        if (paidBooking) {
          res.sendStatus(200)
          return
        }
        const stripeAPI = (await import('../payment/stripe.js')).default
        if (respondMismatch(res, await refundSucceededIntent(stripeAPI, stripePaymentIntentId), 'Booking finalisation failed')) {
          return
        }
      } catch (refundError) {
        logger.error('[stripe.checkCheckoutSession] Failed to refund payment after finalisation failure', refundError)
        res.status(500).send('Booking finalisation failed. Payment refund requires support review.')
        return
      }
    }
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Create Payment Intent.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const createPaymentIntent = async (_req: Request, res: Response) => {
  res.status(410).send('Payment intents are created from a server-priced booking checkout')
}

/**
 * F2 / W4 GAP-04 — Stripe webhook: finalise (or refund) a paid checkout
 * without the customer's browser. Before this endpoint existed, a
 * customer who closed the tab after paying left money taken, booking
 * `Void`, TTL-deleted, never refunded — finalisation depended entirely
 * on the browser hitting `/checkout-session/:sessionId`.
 *
 * Security: the event is accepted ONLY with a valid Stripe signature
 * (`stripe-signature` header, verified against
 * `BC_STRIPE_WEBHOOK_SECRET` over the RAW request body — app.ts mounts
 * this route with `express.raw` before the global JSON parser, so the
 * handler must see a Buffer in `req.body`). The secret is read
 * per-request via `env.__env__` (live `process.env` read, falling back
 * to the boot-time value) so it is fail-closed when unconfigured and
 * test-injectable without a module re-import. An unconfigured secret
 * answers 503, a bad signature 400 — no event is ever processed
 * unverified. The secret value is never logged.
 *
 * Semantics: a verified event is acknowledged with 200 once its money
 * outcome is settled. `refund-failed` (money taken, refund not
 * completed) answers 500 so Stripe redelivers — reconciliation is
 * idempotent (finalisation requires `status: Void`, refunds reuse
 * stable idempotency keys), so a redelivery cannot finalise or refund
 * twice. Unknown event types are acknowledged and ignored.
 * `payment_intent.succeeded` covers the mobile PaymentSheet flow, which
 * has no Checkout Session; `checkout.session.async_payment_succeeded`
 * is handled like `checkout.session.completed` for redirect/async
 * methods, even though today's checkout is card-only.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const handleStripeWebhook = async (req: Request, res: Response) => {
  const webhookSecret = env.__env__('BC_STRIPE_WEBHOOK_SECRET', false, env.STRIPE_WEBHOOK_SECRET)
  if (!webhookSecret) {
    logger.error('[stripe.webhook] STRIPE_WEBHOOK_SECRET is not configured; rejecting webhook event')
    res.status(503).send('Stripe webhook is not configured')
    return
  }
  const signature = req.headers['stripe-signature']
  if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) {
    res.status(400).send('Invalid webhook request')
    return
  }
  let event: Stripe.Event
  try {
    const stripeAPI = (await import('../payment/stripe.js')).default
    event = stripeAPI.webhooks.constructEvent(req.body, signature, webhookSecret)
  } catch (err) {
    logger.error('[stripe.webhook] Signature verification failed', err)
    res.status(400).send('Invalid webhook signature')
    return
  }
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as Stripe.Checkout.Session
      const result = await reconcileStripeSession(session)
      logger.info(`[stripe.webhook] ${event.type} ${session.id} -> ${result.outcome}${result.bookingId ? ` (booking ${result.bookingId})` : ''}${result.detail ? `: ${result.detail}` : ''}`)
      if (result.outcome === 'refund-failed') {
        res.status(500).send('Payment refund requires support review; Stripe will retry')
        return
      }
    } else if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent
      const result = await reconcileStripeIntent(intent)
      logger.info(`[stripe.webhook] payment_intent.succeeded ${intent.id} -> ${result.outcome}${result.bookingId ? ` (booking ${result.bookingId})` : ''}${result.detail ? `: ${result.detail}` : ''}`)
      if (result.outcome === 'refund-failed') {
        res.status(500).send('Payment refund requires support review; Stripe will retry')
        return
      }
    } else {
      logger.info(`[stripe.webhook] Ignoring event ${event.type}`)
    }
  } catch (err) {
    // Reconciliation itself failed (database / provider unavailable).
    // Answer 500 so Stripe redelivers; the reconcile is idempotent, so
    // a redelivery cannot finalise or refund twice.
    logger.error(`[stripe.webhook] Failed to reconcile event ${event.type} ${event.id}`, err)
    res.status(500).send('Webhook reconciliation failed; Stripe will retry')
    return
  }
  res.sendStatus(200)
}
