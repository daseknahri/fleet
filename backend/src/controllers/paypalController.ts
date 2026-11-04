import { Request, Response } from 'express'
import i18n from '../lang/i18n'
import * as logger from '../utils/logger'
import * as bookcarsTypes from ':bookcars-types'
import Booking from '../models/Booking'
import * as bookingController from './bookingController'
import * as ipinfoHelper from '../utils/ipinfoHelper'
import { BookingConflictError } from '../utils/bookingReservationHelper'
import { currencyExponent, formatProviderAmount } from '../utils/paymentAmount'

/**
 * Create PayPal order.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const createPayPalOrder = async (req: Request, res: Response) => {
  try {
    const paypal = await import('../payment/paypal.js')
    const { bookingId, name, description }: bookcarsTypes.CreatePayPalOrderPayload = req.body

    // 1. Retrieve the authoritative booking from database
    const booking = await Booking.findOne({ _id: bookingId, status: bookcarsTypes.BookingStatus.Void, expireAt: { $gt: new Date() } })
    if (!booking) {
      const msg = `Booking with id ${bookingId} not found`
      logger.info(`[paypal.createPayPalOrder] ${msg}`)
      res.status(204).send(msg)
      return
    }

    const snapshot = booking.financialSnapshot
    if (!snapshot || snapshot.mode === bookcarsTypes.CheckoutPaymentMode.PayLater || snapshot.amountDueNow <= 0) {
      res.status(400).send('Booking has no payable checkout amount')
      return
    }

    if (booking.paypalOrderId) {
      res.json(booking.paypalOrderId)
      return
    }

    const clientIp = ipinfoHelper.getClientIp(req)
    const countryCode = await ipinfoHelper.getCountryCode(clientIp)

    // 2. Use booking.price derived server-side instead of client-supplied amount
    const orderId = await paypal.createOrder(
      bookingId,
      snapshot.amountDueNowInPaymentCurrency,
      snapshot.paymentCurrency,
      name,
      description,
      countryCode,
    )
    booking.paypalOrderId = orderId
    await booking.save()

    res.json(orderId)
  } catch (err) {
    logger.error(`[paypal.createPayPalOrder] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR') + err)
  }
}

/**
 * Check Paypal order and update booking if the payment succeeded.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const checkPayPalOrder = async (req: Request, res: Response) => {
  let captureId: string | undefined
  try {
    const paypal = await import('../payment/paypal.js')
    const { bookingId, orderId } = req.params

    //
    // 1. Retrieve Checkout Session and Booking
    //
    const booking = await Booking.findById(bookingId)
    if (!booking) {
      const orphanOrder = await paypal.getOrder(orderId).catch((err) => {
        logger.error(`[paypal.checkPayPalOrder] retrieve orphan order error: ${orderId}`, err)
        return undefined
      })
      const orphanPurchaseUnit = orphanOrder?.purchase_units?.[0]
      const orphanCapture = orphanPurchaseUnit?.payments?.captures?.[0]
      if (orphanPurchaseUnit?.invoice_id === bookingId
        && orphanOrder?.id === orderId
        && orphanOrder.status === 'COMPLETED'
        && orphanCapture?.status === 'COMPLETED'
        && orphanCapture.id) {
        await paypal.refundCapture(orphanCapture.id, `bc-orphan-${orphanCapture.id}`)
        res.status(410).send('Booking expired; the payment was refunded')
        return
      }
      const msg = `Booking with id ${bookingId} not found`
      logger.info(`[paypal.checkPayPalOrder] ${msg}`)
      res.status(204).send(msg)
      return
    }
    if (booking.paypalOrderId === orderId && booking.status !== bookcarsTypes.BookingStatus.Void) {
      res.sendStatus(200)
      return
    }

    let order
    try {
      order = await paypal.getOrder(orderId)
    } catch (err) {
      logger.error(`[paypal.checkPayPalOrder] retrieve paypal order error: ${orderId}`, err)
      res.status(503).send('Payment provider unavailable; support review is required')
      return
    }

    if (!order) {
      const msg = `Order ${orderId} not found`
      logger.info(`[paypal.checkPayPalOrder] ${msg}`)
      res.status(204).send(msg)
      return
    }

    //
    // 2. Reconcile PayPal purchase unit data against database booking
    //
    const purchaseUnit = order.purchase_units?.[0]
    const snapshot = booking.financialSnapshot
    if (!snapshot || booking.paypalOrderId !== orderId) {
      res.status(400).send('Payment order is not linked to this booking')
      return
    }
    const paidAmount = Number(Number.parseFloat(purchaseUnit?.amount?.value || '0').toFixed(currencyExponent(snapshot.paymentCurrency)))
    const paidCurrency = purchaseUnit?.amount?.currency_code
    const invoiceId = purchaseUnit?.invoice_id
    const capture = purchaseUnit?.payments?.captures?.[0]

    // Check for invoice / booking reference mismatch or amount discrepancy
    if (invoiceId !== bookingId) {
      logger.error(`[paypal.checkPayPalOrder] Booking ID mismatch. Expected ${bookingId}, got ${invoiceId || 'missing'}`)
      res.status(400).send('Booking ID mismatch')
      return
    }

    // Currency Reconciliation
    const expectedCurrency = snapshot.paymentCurrency
    if (!paidCurrency || paidCurrency.toUpperCase() !== expectedCurrency.toUpperCase()) {
      logger.error(`[paypal.checkPayPalOrder] Currency mismatch. Expected ${expectedCurrency}, got ${paidCurrency}`)
      res.status(400).send('Payment currency mismatch')
      return
    }

    // Round booking price to 2 decimal places for comparison
    const expectedPrice = Number.parseFloat(formatProviderAmount(snapshot.amountDueNowInPaymentCurrency, expectedCurrency))

    if (paidAmount !== expectedPrice) {
      logger.error(`[paypal.checkPayPalOrder] Price mismatch. Expected ${expectedPrice}, got ${paidAmount}`)
      res.status(400).send('Payment amount mismatch')
      return
    }

    if (order.status === 'COMPLETED' && !capture?.id) {
      res.status(409).send('Completed PayPal order has no verified capture; support review is required')
      return
    }
    if (order.id !== orderId || (order.status === 'COMPLETED' && capture.status !== 'COMPLETED')) {
      res.status(400).send('PayPal capture verification failed')
      return
    }
    if (order.status === 'COMPLETED') {
      const capturedAmount = Number(Number.parseFloat(capture.amount?.value || '0').toFixed(currencyExponent(expectedCurrency)))
      if (capture.amount?.currency_code?.toUpperCase() !== expectedCurrency.toUpperCase() || capturedAmount !== expectedPrice) {
        res.status(400).send('PayPal capture amount or currency mismatch')
        return
      }
    }

    //
    // 3. Update Booking if the payment succeeded
    // (Set BookingStatus to Paid and remove expireAt TTL index)
    //
    if (order.status === 'COMPLETED') {
      captureId = capture?.id
      if (!captureId) {
        res.status(409).send('Completed PayPal order has no verified capture')
        return
      }
      const finalized = await bookingController.finalizePaidCheckoutBooking(booking, 'paypal', orderId)
      if (!finalized) {
        const existingPaidBooking = await Booking.findOne({ _id: booking._id, paypalOrderId: orderId })
        if (existingPaidBooking && existingPaidBooking.status !== bookcarsTypes.BookingStatus.Void) {
          res.sendStatus(200)
          return
        }
        await paypal.refundCapture(captureId, `bc-unavailable-${booking._id}`)
        res.status(409).send('Booking unavailable; the payment was refunded')
        return
      }

      res.sendStatus(200)
      return
    }

    //
    // 4. Delete Booking if the payment didn't succeed
    //
    await booking.deleteOne()
    res.status(400).send(order.status)
  } catch (err) {
    if (err instanceof BookingConflictError) {
      if (!captureId) {
        logger.error('[paypal.checkPayPalOrder] Completed order has no capture id', req.params.orderId)
        res.status(500).send('Booking unavailable. Payment refund requires support review.')
        return
      }
      try {
        const paypal = await import('../payment/paypal.js')
        await paypal.refundCapture(captureId, `bc-refund-${req.params.bookingId}`)
        await Booking.deleteOne({ _id: req.params.bookingId, status: bookcarsTypes.BookingStatus.Void })
      } catch (refundError) {
        logger.error('[paypal.checkPayPalOrder] Failed to refund payment after booking conflict', refundError)
        res.status(500).send('Booking unavailable. Payment refund requires support review.')
        return
      }
      res.status(409).send(err.message)
      return
    }
    logger.error(`[paypal.checkPayPalOrder] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR') + err)
  }
}
