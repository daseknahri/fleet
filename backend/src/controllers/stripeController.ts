import { Request, Response } from 'express'
import mongoose from 'mongoose'
import Stripe from 'stripe'
import i18n from '../lang/i18n'
import * as logger from '../utils/logger'
import * as bookcarsTypes from ':bookcars-types'
import Booking from '../models/Booking'
import * as bookingController from './bookingController'
import { BookingConflictError } from '../utils/bookingReservationHelper'
import { toMinorUnits } from '../utils/paymentAmount'

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
    if (!financialSnapshot || session.metadata?.bookingId !== booking._id.toString()) {
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
        res.status(400).send(message)
        return
      }

      if (session.amount_total !== expectedAmountCents) {
        const message = `Payment amount mismatch: expected ${expectedAmountCents}, got ${session.amount_total}`
        logger.error(`[stripe.checkCheckoutSession] ${message}`)
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
    res.status(400).send(i18n.t('ERROR') + err)
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
