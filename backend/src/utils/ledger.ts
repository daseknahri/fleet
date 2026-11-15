import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import RentalPayment from '../models/RentalPayment'
import { currencyExponent, toMinorUnits } from './paymentAmount'
import Invoice from '../models/Invoice'
import { recomputeInvoicePayment } from './invoicePayment'
import { BookingConflictError, saveBookingWithAvailability } from './bookingReservationHelper'
import { getContractReceivable } from './contractReceivable'
import * as logger from './logger'

export class LedgerError extends Error {
  constructor(public code: 'BOOKING_NOT_FOUND' | 'INVALID_CURRENCY' | 'DUPLICATE_IDEMPOTENCY_KEY' | 'OVERPAYMENT' | 'INVALID_REVERSAL' | 'INVALID_PURPOSE' | 'INVALID_CONFIRMATION' | 'REFUND_FAILED' | 'TRASHED', message: string) {
    super(message)
    this.name = 'LedgerError'
  }
}

export const normalizeLedgerAmount = (amount: number, currency: string) => {
  const exponent = currencyExponent(currency)
  return toMinorUnits(amount, currency) / (10 ** exponent)
}

export const remainingLedgerBalance = (contractTotal: number, recordedTotal: number, currency: string) => {
  const exponent = currencyExponent(currency)
  return (toMinorUnits(contractTotal, currency) - toMinorUnits(recordedTotal, currency)) / (10 ** exponent)
}

export interface PostRentalPaymentInput {
  bookingId: mongoose.Types.ObjectId | string
  supplierId?: mongoose.Types.ObjectId | string
  date: Date
  amount: number
  currency?: string
  method: bookcarsTypes.RentalPaymentMethod
  purpose?: bookcarsTypes.RentalPaymentPurpose
  direction?: bookcarsTypes.RentalPaymentDirection
  source?: bookcarsTypes.RentalPaymentSource
  status?: bookcarsTypes.RentalPaymentStatus
  idempotencyKey?: string
  providerReference?: string
  actorId?: mongoose.Types.ObjectId | string
  reference?: string
  note?: string
  // F2 / W4 GAP-10 — provider-settled leg (payment currency) of a
  // provider checkout posting. Informational only: the base-currency
  // `amount`/`currency` above still post under the purpose caps, and the
  // recorded totals sum `amount`, never these fields.
  settledAmount?: number
  settledCurrency?: string
  fxRate?: number
  fxSource?: string
  fxAt?: Date
  session?: mongoose.ClientSession
}

const bookingLocks = new Map<string, Promise<void>>()

const withBookingLock = async <T>(bookingId: string, fn: () => Promise<T>): Promise<T> => {
  const previous = bookingLocks.get(bookingId) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
 release = resolve 
})
  const queued = previous.then(() => current)
  bookingLocks.set(bookingId, queued)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (bookingLocks.get(bookingId) === queued) {
bookingLocks.delete(bookingId)
}
  }
}

export const supportsTransactions = () => {
  const client = mongoose.connection.getClient() as any
  const topologyType = client?.topology?.description?.type
  return !!topologyType && topologyType !== 'Single' && topologyType !== 'Unknown'
}

const postedMatch = (bookingId: mongoose.Types.ObjectId) => ({
  booking: bookingId,
  $or: [
    { status: bookcarsTypes.RentalPaymentStatus.Posted },
    { status: { $exists: false } },
  ],
})

const getRecordedPurposeTotal = async (bookingId: mongoose.Types.ObjectId, purpose: bookcarsTypes.RentalPaymentPurpose, session?: mongoose.ClientSession) => {
  const aggregate = RentalPayment.aggregate([
    { $match: { $and: [
      postedMatch(bookingId),
      purpose === bookcarsTypes.RentalPaymentPurpose.Rent
        ? { $or: [{ purpose: bookcarsTypes.RentalPaymentPurpose.Rent }, { purpose: { $exists: false } }] }
        : { purpose },
    ] } },
    { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ['$direction', bookcarsTypes.RentalPaymentDirection.Debit] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
  ])
  if (session) {
aggregate.session(session)
}
  const rows = await aggregate
  return Number(rows[0]?.total || 0)
}

const postWithinSession = async (input: PostRentalPaymentInput, session?: mongoose.ClientSession) => {
  const bookingId = new mongoose.Types.ObjectId(input.bookingId)
  const bookingQuery = Booking.findOne({ _id: bookingId, ...(input.supplierId ? { supplier: input.supplierId } : {}) })
    .select('_id supplier price status expireAt financialSnapshot ledgerVersion deletedAt')
  if (session) {
bookingQuery.session(session)
}
  const booking = await bookingQuery
  // GA-PAR-22: no new money may move against a trashed contract —
  // restore the booking first (design §5.5 mutation wall).
  if (booking?.deletedAt) {
    throw new LedgerError('TRASHED', 'TRASHED: This booking is trashed and cannot be modified. Restore it first.')
  }
  if (!booking || booking.expireAt || [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled].includes(booking.status)) {
    throw new LedgerError('BOOKING_NOT_FOUND', 'Rental contract not found')
  }

  const purpose = input.purpose || bookcarsTypes.RentalPaymentPurpose.Rent
  if (!Object.values(bookcarsTypes.RentalPaymentPurpose).includes(purpose)) {
    throw new LedgerError('INVALID_PURPOSE', 'Invalid payment purpose')
  }
  const currency = (input.currency || booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
  const expectedCurrency = (booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
  if (currency !== expectedCurrency) {
    throw new LedgerError('INVALID_CURRENCY', `Payment currency must be ${expectedCurrency}`)
  }
  const amount = normalizeLedgerAmount(input.amount, currency)
  if (input.idempotencyKey) {
    const existingQuery = RentalPayment.findOne({ idempotencyKey: input.idempotencyKey })
    if (session) {
existingQuery.session(session)
}
    const existing = await existingQuery
    if (existing) {
      const existingPurpose = existing.purpose || bookcarsTypes.RentalPaymentPurpose.Rent
      const existingAmount = normalizeLedgerAmount(existing.amount, existing.currency || currency)
      if (existing.booking.toString() !== bookingId.toString()
        || existing.currency !== currency
        || existingAmount !== amount
        || existingPurpose !== purpose) {
        throw new LedgerError('DUPLICATE_IDEMPOTENCY_KEY', 'Idempotency key is already used for another payment')
      }
      return existing
    }
  }
  const recorded = normalizeLedgerAmount(await getRecordedPurposeTotal(bookingId, purpose, session), currency)
  const snapshotRentalTotal = Number(booking.financialSnapshot?.rentalTotal || 0)
  const snapshotDepositAmount = Number(booking.financialSnapshot?.depositAmount || 0)
  const hasFinancialSnapshot = snapshotRentalTotal > 0 || snapshotDepositAmount > 0
  const purposeTotal = purpose === bookcarsTypes.RentalPaymentPurpose.Deposit
    ? (hasFinancialSnapshot ? snapshotDepositAmount : 0)
    : (hasFinancialSnapshot ? snapshotRentalTotal : Number(booking.price))
  const remaining = remainingLedgerBalance(purposeTotal, recorded, currency)
  if (amount <= 0 || toMinorUnits(amount, currency) > toMinorUnits(remaining, currency)) {
    throw new LedgerError('OVERPAYMENT', purpose === bookcarsTypes.RentalPaymentPurpose.Deposit
      ? 'Payment exceeds the refundable deposit allowance'
      : 'Payment exceeds the remaining rental balance')
  }

  const payment = new RentalPayment({
    supplier: booking.supplier,
    booking: bookingId,
    date: input.date,
    amount,
    currency,
    method: input.method,
    purpose,
    direction: input.direction || bookcarsTypes.RentalPaymentDirection.Credit,
    source: input.source || bookcarsTypes.RentalPaymentSource.Manual,
    status: input.status || bookcarsTypes.RentalPaymentStatus.Posted,
    idempotencyKey: input.idempotencyKey,
    providerReference: input.providerReference,
    actor: input.actorId,
    settledAt: (input.status || bookcarsTypes.RentalPaymentStatus.Posted) === bookcarsTypes.RentalPaymentStatus.Posted ? input.date : undefined,
    // F2 / W4 GAP-10 — provider-settled leg, stored alongside the
    // base-currency posting so provider settlement reconciles exactly.
    settledAmount: input.settledAmount,
    settledCurrency: input.settledCurrency,
    fxRate: input.fxRate,
    fxSource: input.fxSource,
    fxAt: input.fxAt,
    reference: input.reference,
    note: input.note,
  })
  await payment.save(session ? { session } : undefined)
  return payment
}

export const postRentalPayment = async (input: PostRentalPaymentInput) => {
  const bookingId = input.bookingId.toString()
  return withBookingLock(bookingId, async () => {
    if (input.session) {
return postWithinSession(input, input.session)
}
    if (supportsTransactions()) {
return mongoose.connection.transaction((session) => postWithinSession(input, session))
}
    return postWithinSession(input)
  })
}

/**
 * Confirm a pending payment entry (owner decision 1.5, GA-P10-DECISIONS-01:
 * counter-agent payment entries stay pending until an accountant or above
 * confirms them). Pending entries never counted toward recorded totals, so
 * confirmation re-validates the purpose allowance before posting.
 */
export const confirmRentalPayment = async (input: {
  paymentId: mongoose.Types.ObjectId | string
  actorId?: mongoose.Types.ObjectId | string
}) => {
  const initial = await RentalPayment.findById(input.paymentId).select('booking')
  if (!initial) {
    throw new LedgerError('INVALID_CONFIRMATION', 'Payment not found')
  }
  return withBookingLock(initial.booking.toString(), async () => {
    const payment = await RentalPayment.findById(input.paymentId)
    if (!payment || payment.status !== bookcarsTypes.RentalPaymentStatus.Pending) {
      throw new LedgerError('INVALID_CONFIRMATION', 'Only a pending payment entry can be confirmed')
    }
    const booking = await Booking.findById(payment.booking).select('_id price financialSnapshot deletedAt')
    if (!booking) {
      throw new LedgerError('BOOKING_NOT_FOUND', 'Rental contract not found')
    }
    // GA-PAR-22: a pending payment on a trashed contract cannot be
    // confirmed into posted money — restore the booking first.
    if (booking.deletedAt) {
      throw new LedgerError('TRASHED', 'TRASHED: This booking is trashed and cannot be modified. Restore it first.')
    }
    const purpose = payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent
    const currency = (payment.currency || env.BASE_CURRENCY).toUpperCase()
    const recorded = normalizeLedgerAmount(await getRecordedPurposeTotal(payment.booking, purpose), currency)
    const snapshotRentalTotal = Number(booking.financialSnapshot?.rentalTotal || 0)
    const snapshotDepositAmount = Number(booking.financialSnapshot?.depositAmount || 0)
    const hasFinancialSnapshot = snapshotRentalTotal > 0 || snapshotDepositAmount > 0
    const purposeTotal = purpose === bookcarsTypes.RentalPaymentPurpose.Deposit
      ? (hasFinancialSnapshot ? snapshotDepositAmount : 0)
      : (hasFinancialSnapshot ? snapshotRentalTotal : Number(booking.price))
    const remaining = remainingLedgerBalance(purposeTotal, recorded, currency)
    if (toMinorUnits(normalizeLedgerAmount(payment.amount, currency), currency) > toMinorUnits(remaining, currency)) {
      throw new LedgerError('OVERPAYMENT', 'Confirming this entry would exceed the remaining balance')
    }
    payment.status = bookcarsTypes.RentalPaymentStatus.Posted
    payment.settledAt = payment.date
    payment.confirmedBy = input.actorId ? new mongoose.Types.ObjectId(input.actorId) : undefined
    payment.confirmedAt = new Date()
    await payment.save()
    // Keep linked invoices in step with the ledger (GAQ12B2-D2): the
    // reversal path already recomputes them; confirmation must too, or
    // an invoice linked while the payment was pending keeps a stale
    // paidAmount after the payment posts.
    const linkedInvoices = await Invoice.find({ payments: payment._id }).select('_id')
    for (const invoice of linkedInvoices) {
      await recomputeInvoicePayment(invoice._id)
    }
    // F3 / W1 #3: confirming a pending entry is a manual/cash collection
    // becoming posted money — the booking's payment status follows the
    // ledger (Pending → Paid, Deposit → PaidInFull). Best-effort: the
    // confirmation itself already succeeded, so a sync failure (e.g. the
    // car's dates are now taken) is logged, not thrown — staff can retry
    // the confirmation from the booking once the conflict is resolved.
    try {
      await refreshBookingPaymentStatus(payment.booking)
    } catch (err) {
      logger.error(`[ledger.confirmRentalPayment] Payment ${payment._id.toString()} confirmed but booking payment status could not be refreshed`, err)
    }
    return payment
  })
}

export const postProviderPayment = (input: Omit<PostRentalPaymentInput, 'method' | 'source'> & { provider: 'stripe' | 'paypal' }) =>
  postRentalPayment({
    ...input,
    method: bookcarsTypes.RentalPaymentMethod.Card,
    source: input.provider === 'stripe' ? bookcarsTypes.RentalPaymentSource.Stripe : bookcarsTypes.RentalPaymentSource.PayPal,
  })

/**
 * F3 / W1 #3 — derive the booking's payment status from the ledger.
 *
 * A pay-later / walk-in cash booking can never reach `Paid` through the
 * payment-status lock (update/updateStatus refuse it, create refuses it),
 * and posting a RentalPayment never touched `booking.status`. This is the
 * ADR-001-compliant shape of the missing step: the status is DERIVED from
 * posted collections, never trusted from an operator-supplied value.
 * `Pending`/`Reserved` with nothing outstanding becomes `Paid`;
 * `Deposit` with nothing outstanding becomes `PaidInFull`. A booking
 * whose dates are now taken by another (reserving) booking cannot be
 * confirmed into a reserving status: the conflict is reported
 * (`conflict: true`) and the status is left untouched — the payment stays
 * posted and staff can retry the confirmation after resolving the
 * conflict. Provider finalisation never calls this (it sets the status
 * itself inside its transaction); only the manual/cash paths do.
 *
 * @param {mongoose.Types.ObjectId | string} bookingId
 * @returns {Promise<{ status: bookcarsTypes.BookingStatus, updated: boolean, outstandingBalance: number, currency: string, postedRent: number, depositPaid: number, conflict: boolean }>}
 */
export const refreshBookingPaymentStatus = async (bookingId: mongoose.Types.ObjectId | string) => {
  const booking = await Booking.findById(bookingId)
  if (!booking) {
    throw new LedgerError('BOOKING_NOT_FOUND', 'Rental contract not found')
  }
  if (booking.deletedAt) {
    throw new LedgerError('TRASHED', 'TRASHED: This booking is trashed and cannot be modified. Restore it first.')
  }
  const receivable = await getContractReceivable(booking)
  const base = {
    outstandingBalance: receivable.outstandingBalance,
    currency: receivable.currency,
    postedRent: receivable.postedPayments,
    depositPaid: receivable.depositPayments,
  }
  const target = booking.status === bookcarsTypes.BookingStatus.Deposit
    ? bookcarsTypes.BookingStatus.PaidInFull
    : [bookcarsTypes.BookingStatus.Pending, bookcarsTypes.BookingStatus.Reserved].includes(booking.status)
      ? bookcarsTypes.BookingStatus.Paid
      : null
  // Nothing outstanding, and either real money was posted or the contract
  // total is zero (a genuinely free booking confirms with no payment).
  const moneyPosted = receivable.postedPayments + receivable.depositPayments > 0
  const totalDue = receivable.rentalTotal + receivable.approvedCharges
  if (!target || receivable.outstandingBalance > 0 || (!moneyPosted && totalDue > 0)) {
    return { status: booking.status, updated: false, ...base, conflict: false }
  }
  // F4 / W1 #5 — the pay-later half of the lifecycle middle: a
  // manual/cash confirmation that derives Paid/PaidInFull from the
  // ledger also moves the lifecycle Draft -> Confirmed, mirroring
  // the provider-finalisation producer. A zero-total booking
  // confirms the same way (nothing outstanding, nothing posted).
  const previousStatus = booking.status
  const previousLifecycle = booking.lifecycle
  booking.status = target
  if (!booking.lifecycle || booking.lifecycle === bookcarsTypes.ContractLifecycle.Draft) {
    booking.lifecycle = bookcarsTypes.ContractLifecycle.Confirmed
  }
  try {
    // Paid/PaidInFull reserve the car (Pending does not), so this
    // re-checks availability: a conflicting booking refuses the flip.
    await saveBookingWithAvailability(booking)
  } catch (err) {
    booking.status = previousStatus
    booking.lifecycle = previousLifecycle
    if (err instanceof BookingConflictError) {
      logger.error(`[ledger.refreshBookingPaymentStatus] Booking ${booking._id.toString()} cannot be confirmed: the car is no longer available for the dates`, err)
      return { status: previousStatus, updated: false, ...base, conflict: true }
    }
    throw err
  }
  return { status: target, updated: true, ...base, conflict: false }
}


/**
 * F1 / W3 P-5 — refund a provider payment at its provider before the books
 * are reversed, so the ledger and the provider agree. Stripe: the provider
 * reference is the PaymentIntent id. PayPal: the provider reference is the
 * order id, so the completed capture is resolved from the order first.
 * The idempotency key is stable per payment, so a retry after a crash
 * replays the same refund instead of refunding twice.
 *
 * @param {env.RentalPayment} original
 * @returns {Promise<string>} provider refund reference (refund id / capture id)
 */
const refundProviderPayment = async (original: env.RentalPayment): Promise<string> => {
  if (!original.providerReference) {
    throw new LedgerError('INVALID_REVERSAL', 'Provider payment has no provider reference; refund it in the provider dashboard first')
  }
  const refundKey = `refund-reversal-${original._id.toString()}`
  try {
    if (original.source === bookcarsTypes.RentalPaymentSource.Stripe) {
      const stripeAPI = (await import('../payment/stripe.js')).default
      const refund = await stripeAPI.refunds.create(
        { payment_intent: original.providerReference },
        { idempotencyKey: refundKey },
      )
      return refund.id
    }
    const paypal = await import('../payment/paypal.js')
    const order = await paypal.getOrder(original.providerReference)
    const capture = order?.purchase_units?.[0]?.payments?.captures?.find((c: { status?: string, id?: string }) => c?.status === 'COMPLETED' && c?.id)
    if (!capture) {
      throw new LedgerError('REFUND_FAILED', 'No completed PayPal capture found for this payment; refund it in the PayPal dashboard first')
    }
    await paypal.refundCapture(capture.id, refundKey)
    return capture.id
  } catch (err) {
    if (err instanceof LedgerError) {
      throw err
    }
    throw new LedgerError('REFUND_FAILED', `Provider refund failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }
}

export const reverseRentalPayment = async (input: {
  paymentId: mongoose.Types.ObjectId | string
  actorId?: mongoose.Types.ObjectId | string
  idempotencyKey: string
  date?: Date
  note?: string
}) => {
  const initial = await RentalPayment.findById(input.paymentId).select('booking')
  if (!initial) {
throw new LedgerError('INVALID_REVERSAL', 'Payment not found')
}
  return withBookingLock(initial.booking.toString(), async () => {
    const existing = await RentalPayment.findOne({ idempotencyKey: input.idempotencyKey })
    if (existing) {
      if (existing.reversedFrom?.toString() === input.paymentId.toString()
        && existing.direction === bookcarsTypes.RentalPaymentDirection.Debit) {
return existing
}
      throw new LedgerError('DUPLICATE_IDEMPOTENCY_KEY', 'Idempotency key is already used for another payment')
    }
    const original = await RentalPayment.findById(input.paymentId)
    if (!original || original.status !== bookcarsTypes.RentalPaymentStatus.Posted
      || original.direction === bookcarsTypes.RentalPaymentDirection.Debit) {
      throw new LedgerError('INVALID_REVERSAL', 'Only a posted credit can be reversed')
    }
    // GA-PAR-22: a posted payment on a trashed contract cannot be
    // reversed — reversal is ledger movement against the contract,
    // so restore the booking first (same rule as charge decisions).
    const reversalBooking = await Booking.findById(original.booking).select('_id deletedAt')
    if (reversalBooking?.deletedAt) {
      throw new LedgerError('TRASHED', 'TRASHED: This booking is trashed and cannot be modified. Restore it first.')
    }
    const reversalDate = input.date || new Date()
    // F1 / W3 P-5: reversing a Stripe/PayPal payment refunds the money at
    // the provider first. Without this the books net to zero while the
    // provider still holds the customer's money. A failed provider refund
    // refuses the reversal (REFUND_FAILED) — nothing is written.
    let refundProviderReference: string | undefined
    let refundedAt: Date | undefined
    if (original.source === bookcarsTypes.RentalPaymentSource.Stripe
      || original.source === bookcarsTypes.RentalPaymentSource.PayPal) {
      refundProviderReference = await refundProviderPayment(original)
      refundedAt = reversalDate
    }
    const reversal = new RentalPayment({
      supplier: original.supplier,
      booking: original.booking,
      date: reversalDate,
      amount: original.amount,
      currency: original.currency,
      method: original.method,
      purpose: original.purpose || bookcarsTypes.RentalPaymentPurpose.Rent,
      direction: bookcarsTypes.RentalPaymentDirection.Debit,
      source: bookcarsTypes.RentalPaymentSource.Adjustment,
      // Annulment semantics (GAQ12B2-D1): the original is flipped to
      // Reversed below, which already removes its credit from every
      // Posted-only signed sum (reports, contract receivable, recorded
      // totals). The compensating debit must therefore not itself be
      // Posted, or the pair would net to -amount instead of zero. Both
      // records of the annulled pair carry Reversed; the debit stays
      // fully visible in payment lists with its direction and
      // reversedFrom audit fields.
      status: bookcarsTypes.RentalPaymentStatus.Reversed,
      idempotencyKey: input.idempotencyKey,
      actor: input.actorId,
      reversedFrom: original._id,
      refundProviderReference,
      refundedAt,
      // F2 / W4 GAP-10 — the reversal annuls the same provider-settled
      // leg, so the pair stays reconcilable to provider settlement.
      settledAmount: original.settledAmount,
      settledCurrency: original.settledCurrency,
      fxRate: original.fxRate,
      fxSource: original.fxSource,
      fxAt: original.fxAt,
      settledAt: reversalDate,
      note: input.note || `Reversal of ${original._id.toString()}`,
    })
    await reversal.save()
    original.status = bookcarsTypes.RentalPaymentStatus.Reversed
    await original.save()
    const linkedInvoices = await Invoice.find({ payments: original._id }).select('_id')
    for (const invoice of linkedInvoices) {
await recomputeInvoicePayment(invoice._id)
}
    return reversal
  })
}
