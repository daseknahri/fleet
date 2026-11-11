import mongoose from 'mongoose'
import { Request, Response } from 'express'
import * as bookcarsTypes from ':bookcars-types'
import i18n from '../lang/i18n'
import Booking from '../models/Booking'
import User from '../models/User'
import Invoice from '../models/Invoice'
import * as helper from '../utils/helper'
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import { agencySupplierId } from '../utils/agencyAuthorization'
import { BookingConflictError, saveBookingWithAvailability } from '../utils/bookingReservationHelper'
import { currencyExponent, toMinorUnits } from '../utils/paymentAmount'
import { findActiveInvoice, refreshDraftInvoiceAfterAmendment } from '../utils/invoiceCreation'
import { resolveOverlapExceptionGate } from './bookingController'

/**
 * GA-PAR-11 — contract amendment / extension workflow.
 *
 * POST /api/bookings/:id/amend { from?, to?, reason, overlapException? }
 *
 * This is the ONLY door for changing the dates of a snapshot booking:
 * bookingController.update keeps its 409 "use a contract amendment
 * workflow" lock for direct term edits, unchanged.
 *
 * Rules (PLANNING-SLICES §2.4 + PAR11 builder brief):
 * - agency-scoped load; the caller must be agency staff of the booking's
 *   agency (or a platform Admin, mirroring bookingController.update);
 * - terminal contracts cannot be amended: lifecycle Completed/Cancelled,
 *   status Void/Cancelled, and unfinalised checkout placeholders
 *   (expireAt set) are refused 409;
 * - `reason` is required, 3–1000 chars (house pattern) → 400;
 * - re-pricing uses the ORIGINAL snapshot's rate basis. The financial
 *   snapshot stores NO daily rate (verified: version, currencies, mode,
 *   rentalTotal, depositAmount, amountDueNow(+payment-currency twin),
 *   quotedAt), so the basis daily rate is rentalTotal / original rental
 *   days (helper.days, the price logic's own day count) and is recorded
 *   on the amendment row. Today's car prices are never consulted. For a
 *   snapshot-less booking (admin-created) the booking `price` — the
 *   figure contractReceivable falls back to — is the basis total and a
 *   version-1 snapshot is created on success so later amendments bump
 *   from it;
 * - availability is re-checked through saveBookingWithAvailability
 *   (own id already excluded); a conflict is 409 unless the payload
 *   SEPARATELY carries a valid PAR-10 overlapException AND the caller
 *   is Owner/Manager (the PAR-10 gate is reused verbatim — a stored
 *   exception from an earlier flow never silently carries over, and
 *   maintenance conflicts are never bypassed). The exception record is
 *   stamped only when a conflict was actually bypassed;
 * - on success the financial snapshot is bumped (version + 1,
 *   rentalTotal = new total, quotedAt = now; deposit unchanged),
 *   booking.price mirrors the new rental total, and exactly one
 *   amendmentHistory row is appended. The booking reference (PAR-02)
 *   never changes and the apporteur snapshot is NOT re-rated;
 * - invoice interplay (N10): an Issued invoice refuses the amendment
 *   409 with a message naming its number; a Draft invoice has its
 *   subtotal/total refreshed from the new snapshot in the same request
 *   (tax recomputed by PAR-01's rule via invoiceCreation);
 * - the ledger is untouched: contractReceivable reads the new snapshot
 *   total and floors outstanding at 0, so shortening below posted
 *   payments surfaces as overpayment on the existing surfaces.
 */
export const amend = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      res.sendStatus(404)
      return
    }
    const booking = await Booking.findById(id)
    if (!booking) {
      res.sendStatus(404)
      return
    }

    // Agency scope (mirrors bookingController.update's security check).
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    const sessionAgencyId = agencySupplierId(req)
    const isAgencyUser = !!sessionUser && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
    if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User || (isAgencyUser && sessionAgencyId !== booking.supplier?.toString())) {
      logger.error(`[booking.amend] Unauthorized attempt to amend booking ${booking._id.toString()} by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot amend booking information')
      return
    }

    const body = (req.body || {}) as bookcarsTypes.AmendBookingPayload

    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 3 || reason.length > 1000) {
      res.status(400).send('AMENDMENT_REASON: A contract amendment requires a reason of 3 to 1000 characters.')
      return
    }

    // Terminal / placeholder contracts cannot be amended.
    const lifecycle = booking.lifecycle || bookcarsTypes.ContractLifecycle.Draft
    if (lifecycle === bookcarsTypes.ContractLifecycle.Completed
      || lifecycle === bookcarsTypes.ContractLifecycle.Cancelled
      || booking.status === bookcarsTypes.BookingStatus.Void
      || booking.status === bookcarsTypes.BookingStatus.Cancelled
      || !!booking.expireAt) {
      res.status(409).send('AMENDMENT_TERMINAL: A void, cancelled, completed or unfinalised booking cannot be amended.')
      return
    }

    const newFrom = body.from ? new Date(body.from) : new Date(booking.from)
    const newTo = body.to ? new Date(body.to) : new Date(booking.to)
    if (Number.isNaN(newFrom.getTime()) || Number.isNaN(newTo.getTime()) || newFrom >= newTo) {
      res.status(400).send('Invalid rental dates')
      return
    }
    if (newFrom.getTime() === new Date(booking.from).getTime() && newTo.getTime() === new Date(booking.to).getTime()) {
      res.status(400).send('AMENDMENT_NO_CHANGE: The amendment does not change the rental dates.')
      return
    }

    // PAR-10 composition: only a payload-carried exception, gated
    // exactly as on create/update, can bypass a booking conflict.
    const overlapGate = await resolveOverlapExceptionGate(
      req,
      { _id: sessionUser._id.toString(), type: sessionUser.type },
      booking.supplier.toString(),
      body.overlapException,
    )
    if (!overlapGate.ok) {
      res.status(overlapGate.status).send(overlapGate.message)
      return
    }

    // N10 invoice interplay, pre-flight: an issued invoice is a fiscal
    // document and never mutates — refuse before anything persists.
    const activeInvoice = await findActiveInvoice(booking._id, booking.supplier)
    if (activeInvoice && activeInvoice.status === bookcarsTypes.InvoiceStatus.Issued) {
      res.status(409).send(`AMENDMENT_ISSUED_INVOICE: Contract amendment refused because invoice ${activeInvoice.number} is already issued. Void the invoice to amend.`)
      return
    }

    // Re-price from the ORIGINAL snapshot's rate basis.
    const snapshot = booking.financialSnapshot
    const hasRealSnapshot = !!snapshot && typeof snapshot.rentalTotal === 'number'
    const basisTotal = hasRealSnapshot ? Number(snapshot.rentalTotal) : Number(booking.price || 0)
    const currency = String((hasRealSnapshot ? snapshot.baseCurrency : undefined) || env.BASE_CURRENCY).toUpperCase()
    const exponent = currencyExponent(currency)
    const originalDays = helper.days(booking.from, booking.to)
    const newDays = helper.days(newFrom, newTo)
    if (originalDays < 1 || newDays < 1 || !Number.isFinite(basisTotal) || basisTotal < 0) {
      res.status(400).send('AMENDMENT_PRICING: The booking has no price basis to amend from.')
      return
    }
    const basisDailyRate = basisTotal / originalDays
    const newTotal = toMinorUnits(basisDailyRate * newDays, currency) / (10 ** exponent)
    const priceDelta = toMinorUnits(newTotal - basisTotal, currency) / (10 ** exponent)

    const amendedAt = new Date()
    const historyRow = {
      at: amendedAt,
      by: new mongoose.Types.ObjectId(sessionUser._id),
      reason,
      fromBefore: new Date(booking.from),
      toBefore: new Date(booking.to),
      fromAfter: newFrom,
      toAfter: newTo,
      rentalTotalBefore: basisTotal,
      rentalTotalAfter: newTotal,
      priceDelta,
      basisDailyRate,
      basisDays: originalDays,
    }

    booking.from = newFrom
    booking.to = newTo
    booking.price = newTotal
    if (hasRealSnapshot) {
      booking.financialSnapshot = {
        ...snapshot,
        version: (typeof snapshot.version === 'number' ? snapshot.version : 1) + 1,
        rentalTotal: newTotal,
        quotedAt: amendedAt,
      }
    } else {
      booking.financialSnapshot = {
        version: 1,
        baseCurrency: currency,
        paymentCurrency: currency,
        mode: bookcarsTypes.CheckoutPaymentMode.PayLater,
        rentalTotal: newTotal,
        depositAmount: 0,
        amountDueNow: 0,
        amountDueNowInPaymentCurrency: 0,
        quotedAt: amendedAt,
      }
    }
    if (!booking.amendmentHistory) {
      booking.amendmentHistory = []
    }
    booking.amendmentHistory.push(historyRow as never)

    let overlapConflictingBookingId: string | undefined
    await saveBookingWithAvailability(booking, {
      allowOverlapException: !!overlapGate.reason,
      onBookingConflict: (conflictingBookingId) => { overlapConflictingBookingId = conflictingBookingId },
    })

    // PAR-10 record discipline: stamp only a bypass that really happened.
    if (overlapGate.reason && overlapConflictingBookingId) {
      booking.overlapException = {
        reason: overlapGate.reason,
        authorisedBy: new mongoose.Types.ObjectId(sessionUser._id),
        authorisedAt: amendedAt,
        conflictingBooking: new mongoose.Types.ObjectId(overlapConflictingBookingId),
      }
      await booking.save()
    }

    // N10: a Draft invoice follows the new snapshot in the same request.
    if (activeInvoice && activeInvoice.status === bookcarsTypes.InvoiceStatus.Draft) {
      const invoiceDoc = await Invoice.findById(activeInvoice._id)
      if (invoiceDoc) {
        await refreshDraftInvoiceAfterAmendment(
          invoiceDoc,
          newTotal,
          async ({ subtotal, taxAmount, total }) => {
            invoiceDoc.subtotal = subtotal
            invoiceDoc.taxAmount = taxAmount
            invoiceDoc.total = total
            await invoiceDoc.save()
          },
        )
      }
    }

    res.json(booking)
  } catch (err) {
    if (err instanceof BookingConflictError) {
      res.status(409).send(err.message)
      return
    }
    logger.error(`[booking.amend] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export default amend
