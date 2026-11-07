import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import RentalPayment from '../models/RentalPayment'
import { currencyExponent, toMinorUnits } from './paymentAmount'
import Invoice from '../models/Invoice'
import { recomputeInvoicePayment } from './invoicePayment'

export class LedgerError extends Error {
  constructor(public code: 'BOOKING_NOT_FOUND' | 'INVALID_CURRENCY' | 'DUPLICATE_IDEMPOTENCY_KEY' | 'OVERPAYMENT' | 'INVALID_REVERSAL' | 'INVALID_PURPOSE' | 'INVALID_CONFIRMATION', message: string) {
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

const supportsTransactions = () => {
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
    .select('_id supplier price status expireAt financialSnapshot ledgerVersion')
  if (session) {
bookingQuery.session(session)
}
  const booking = await bookingQuery
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
    const booking = await Booking.findById(payment.booking).select('_id price financialSnapshot')
    if (!booking) {
      throw new LedgerError('BOOKING_NOT_FOUND', 'Rental contract not found')
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
    return payment
  })
}

export const postProviderPayment = (input: Omit<PostRentalPaymentInput, 'method' | 'source'> & { provider: 'stripe' | 'paypal' }) =>
  postRentalPayment({
    ...input,
    method: bookcarsTypes.RentalPaymentMethod.Card,
    source: input.provider === 'stripe' ? bookcarsTypes.RentalPaymentSource.Stripe : bookcarsTypes.RentalPaymentSource.PayPal,
  })


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
    const reversalDate = input.date || new Date()
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
