import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import RentalPayment from '../models/RentalPayment'
import CashSession from '../models/CashSession'
import CashMovement from '../models/CashMovement'
import Car from '../models/Car'
import { currencyExponent, toMinorUnits } from './paymentAmount'
import Invoice from '../models/Invoice'
import ContractCharge from '../models/ContractCharge'
import { linkPostedRentPaymentToInvoice, recomputeInvoicePayment } from './invoicePayment'
import { BookingConflictError, saveBookingWithAvailability } from './bookingReservationHelper'
import { getContractReceivable, getSupplierVatRatePercent, syncBookingPaidInFull } from './contractReceivable'
import { vatAmountMinor } from './fiscal'
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

// Wave 2.4 — exported for the deposit-settlement validation in
// complete(): held must equal the posted deposit total.
export const getRecordedPurposeTotal = async (bookingId: mongoose.Types.ObjectId, purpose: bookcarsTypes.RentalPaymentPurpose, session?: mongoose.ClientSession) => {
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

const snapshotAmounts = (booking: { financialSnapshot?: { rentalTotal?: number, depositAmount?: number } | null }) => {
  const snapshotRentalTotal = Number(booking.financialSnapshot?.rentalTotal || 0)
  const snapshotDepositAmount = Number(booking.financialSnapshot?.depositAmount || 0)
  // F1 — Mongoose hydrates a missing snapshot as `{}` (truthy), so the
  // guard is numeric, never a truthiness check on `financialSnapshot`.
  // Do not "simplify" this to `!!booking.financialSnapshot`.
  const hasFinancialSnapshot = snapshotRentalTotal > 0 || snapshotDepositAmount > 0
  return { snapshotRentalTotal, snapshotDepositAmount, hasFinancialSnapshot }
}

// F6 / W3 P-7 — the deposit cap for a snapshot-less (legacy) booking:
// the booking's own deposit, i.e. the deposit stored on its car — the
// same source checkout prices from (bookingController checkout). A
// legacy booking whose car is gone (or carries no deposit) still caps
// at 0, and the OVERPAYMENT message says so; the cap is never silently
// defaulted to 0 while a deposit exists.
const legacyDepositCap = async (
  booking: { car?: mongoose.Types.ObjectId | string | null },
  dbSession?: mongoose.ClientSession,
): Promise<number> => {
  if (!booking.car) {
    return 0
  }
  const carQuery = Car.findById(booking.car).select('deposit')
  if (dbSession) {
    carQuery.session(dbSession)
  }
  const car = await carQuery
  return Number((car as { deposit?: number } | null)?.deposit || 0)
}

// F6 / W3 P-7 — the per-purpose allowance a posting is validated
// against. One helper for postWithinSession, confirmRentalPayment and
// the pending-edit validation, so the cap cannot fork again.
export const purposeCap = async (
  booking: { _id?: mongoose.Types.ObjectId | string, price?: number, car?: mongoose.Types.ObjectId | string | null, supplier?: mongoose.Types.ObjectId | string | null, financialSnapshot?: { rentalTotal?: number, depositAmount?: number, baseCurrency?: string } | null },
  purpose: bookcarsTypes.RentalPaymentPurpose,
  dbSession?: mongoose.ClientSession,
): Promise<number> => {
  const { snapshotRentalTotal, snapshotDepositAmount, hasFinancialSnapshot } = snapshotAmounts(booking)
  if (purpose === bookcarsTypes.RentalPaymentPurpose.Deposit) {
    return hasFinancialSnapshot ? snapshotDepositAmount : legacyDepositCap(booking, dbSession)
  }
  // Wave 2.4 — a Charge credit settles an approved charge with money
  // already held (the kept deposit): the allowance is the sum of the
  // booking's APPROVED charges, never the rental total.
  if (purpose === bookcarsTypes.RentalPaymentPurpose.Charge) {
    if (!booking._id) {
      return 0
    }
    const agg = ContractCharge.aggregate([
      { $match: { booking: new mongoose.Types.ObjectId(booking._id), status: bookcarsTypes.ApprovalDecision.Approved } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    if (dbSession) {
      agg.session(dbSession)
    }
    const rows = await agg
    return Number(rows[0]?.total || 0)
  }
  // Wave 2 remainder — 2.7 (Q11 = HT): the rent allowance is the HT
  // rental total PLUS the supplier's VAT when VAT is on — otherwise a
  // VAT-on invoice can never read "paid" (M6). Deposit and Charge
  // caps are unchanged (a refundable liability and staff-decided
  // amounts carry no VAT). A booking without a supplier resolves to
  // 0% — the pre-2.7 number.
  const rentBase = hasFinancialSnapshot ? snapshotRentalTotal : Number(booking.price || 0)
  const currency = (booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
  const vatRate = await getSupplierVatRatePercent(booking.supplier)
  return rentBase + vatAmountMinor(rentBase, currency, vatRate) / (10 ** currencyExponent(currency))
}

export const getPurposeRemaining = async (
  bookingId: mongoose.Types.ObjectId | string,
  purpose: bookcarsTypes.RentalPaymentPurpose,
): Promise<{ remaining: number, recorded: number, cap: number, currency: string }> => {
  const booking = await Booking.findById(bookingId).select('_id price car supplier financialSnapshot')
  if (!booking) {
    throw new LedgerError('BOOKING_NOT_FOUND', 'Rental contract not found')
  }
  const currency = (booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
  const recorded = normalizeLedgerAmount(await getRecordedPurposeTotal(new mongoose.Types.ObjectId(bookingId), purpose), currency)
  const cap = normalizeLedgerAmount(await purposeCap(booking, purpose), currency)
  return { remaining: remainingLedgerBalance(cap, recorded, currency), recorded, cap, currency }
}

// ---------------------------------------------------------------------
// F6 / W3 C-7 — ledger ↔ cash-session linkage (reconciliation).
// A posted cash-method RentalPayment creates one linked CashMovement in
// the agency's open Cash-account session, so the drawer and the ledger
// agree by construction. The rules, deliberately narrow (bank
// reconciliation and the LEAD caisse items are GATED, §5 — this builds
// the ledger↔session linkage ONLY):
//   - Only method `cash`, only status Posted. Pending counter-agent
//     entries link when an accountant confirms them, never before.
//   - No open cash session (or a currency mismatch): the payment still
//     posts — the ledger is the source of truth for the contract — and
//     stays unlinked (`cashSession` unset) until an operator links it
//     (see rentalPaymentController.linkCashSession). The journal
//     reconciliation lists it, so the gap stays visible, never silent.
//   - Linking never throws into the posting: a linkage failure is
//     logged, the payment stands.
//   - Reversal of a cash payment creates a compensating Out movement
//     (linked to the reversal row) in the session that holds the
//     original In — or the current open session when that one closed —
//     so the drawer nets to zero exactly like the annulled ledger pair.
//     A reversal whose original never entered a drawer creates no
//     movement (there is no In to compensate).
// ---------------------------------------------------------------------

export const linkLedgerCashPayment = async (
  payment: env.RentalPayment,
  dbSession?: mongoose.ClientSession,
  targetSessionId?: mongoose.Types.ObjectId | string,
): Promise<env.CashMovement | null> => {
  // Wave 2.4 — a Charge credit reclassifies money already held (a kept
  // deposit settling a charge): it never enters or leaves the drawer.
  if (payment.purpose === bookcarsTypes.RentalPaymentPurpose.Charge) {
    return null
  }
  if (payment.method !== bookcarsTypes.RentalPaymentMethod.Cash
    || payment.status !== bookcarsTypes.RentalPaymentStatus.Posted) {
    return null
  }
  const existingQuery = CashMovement.findOne({ rentalPayment: payment._id })
  if (dbSession) {
    existingQuery.session(dbSession)
  }
  const existing = await existingQuery
  if (existing) {
    if (!payment.cashSession || !payment.cashSession.equals(existing.session)) {
      payment.cashSession = existing.session
      await payment.save(dbSession ? { session: dbSession } : undefined)
    }
    return existing
  }
  const cashSession = targetSessionId
    ? await CashSession.findOne({
      _id: new mongoose.Types.ObjectId(targetSessionId),
      supplier: payment.supplier,
      account: bookcarsTypes.CashAccountType.Cash,
      status: bookcarsTypes.CashSessionStatus.Open,
    })
    : await (async () => {
      const q = CashSession.findOne({
        supplier: payment.supplier,
        account: bookcarsTypes.CashAccountType.Cash,
        status: bookcarsTypes.CashSessionStatus.Open,
      }).sort({ openedAt: -1 })
      if (dbSession) {
        q.session(dbSession)
      }
      return q
    })()
  if (!cashSession) {
    logger.error(`[ledger.linkLedgerCashPayment] No open cash session for supplier ${payment.supplier.toString()}; cash payment ${payment._id.toString()} posted unlinked`)
    return null
  }
  if (cashSession.currency !== payment.currency) {
    logger.error(`[ledger.linkLedgerCashPayment] Cash session currency ${cashSession.currency} does not match payment currency ${payment.currency}; cash payment ${payment._id.toString()} posted unlinked`)
    return null
  }
  const movement = new CashMovement({
    supplier: payment.supplier,
    session: cashSession._id,
    account: cashSession.account,
    currency: cashSession.currency,
    date: payment.date,
    direction: payment.direction === bookcarsTypes.RentalPaymentDirection.Debit
      ? bookcarsTypes.CashMovementDirection.Out
      : bookcarsTypes.CashMovementDirection.In,
    amount: payment.amount,
    source: bookcarsTypes.CashMovementSource.RentalPayment,
    status: 'confirmed',
    // R3-12 — deterministic fallback key for key-less payments: the
    // sparse unique index ignores undefined keys, so without this a
    // concurrent double-link could create two movements.
    idempotencyKey: payment.idempotencyKey ? `cash-${payment.idempotencyKey}` : `cash-rental-${payment._id.toString()}`,
    rentalPayment: payment._id,
    purpose: payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent,
    reference: payment.reference,
    note: payment.note,
    actor: payment.actor,
  })
  await movement.save(dbSession ? { session: dbSession } : undefined)
  payment.cashSession = cashSession._id
  await payment.save(dbSession ? { session: dbSession } : undefined)
  return movement
}

// ---------------------------------------------------------------------
// Wave 2.6 — ledger ↔ BANK-session linkage. The exact mirror of the
// cash linkage above, for method `BankTransfer` into the agency's open
// Bank-account session: a posted wire payment creates one linked
// CashMovement (account Bank, source RentalPayment); a reversal of a
// wire payment creates a compensating Out in the session that holds
// the original In (or the current open Bank session). Same rules as
// cash: only method BankTransfer, only status Posted, Charge purpose
// never moves, no open session (or a currency mismatch) means the
// payment posts unlinked with an error log — the ledger stays the
// source of truth and the linkage never throws into the posting.
// ---------------------------------------------------------------------

export const linkLedgerBankPayment = async (
  payment: env.RentalPayment,
  dbSession?: mongoose.ClientSession,
  targetSessionId?: mongoose.Types.ObjectId | string,
): Promise<env.CashMovement | null> => {
  // Wave 2.4 — a Charge credit reclassifies money already held: it
  // never enters or leaves any session.
  if (payment.purpose === bookcarsTypes.RentalPaymentPurpose.Charge) {
    return null
  }
  if (payment.method !== bookcarsTypes.RentalPaymentMethod.BankTransfer
    || payment.status !== bookcarsTypes.RentalPaymentStatus.Posted) {
    return null
  }
  const existingQuery = CashMovement.findOne({ rentalPayment: payment._id })
  if (dbSession) {
    existingQuery.session(dbSession)
  }
  const existing = await existingQuery
  if (existing) {
    if (!payment.bankSession || !payment.bankSession.equals(existing.session)) {
      payment.bankSession = existing.session
      await payment.save(dbSession ? { session: dbSession } : undefined)
    }
    return existing
  }
  const bankSession = targetSessionId
    ? await CashSession.findOne({
      _id: new mongoose.Types.ObjectId(targetSessionId),
      supplier: payment.supplier,
      account: bookcarsTypes.CashAccountType.Bank,
      status: bookcarsTypes.CashSessionStatus.Open,
    })
    : await (async () => {
      const q = CashSession.findOne({
        supplier: payment.supplier,
        account: bookcarsTypes.CashAccountType.Bank,
        status: bookcarsTypes.CashSessionStatus.Open,
      }).sort({ openedAt: -1 })
      if (dbSession) {
        q.session(dbSession)
      }
      return q
    })()
  if (!bankSession) {
    logger.error(`[ledger.linkLedgerBankPayment] No open bank session for supplier ${payment.supplier.toString()}; bank payment ${payment._id.toString()} posted unlinked`)
    return null
  }
  if (bankSession.currency !== payment.currency) {
    logger.error(`[ledger.linkLedgerBankPayment] Bank session currency ${bankSession.currency} does not match payment currency ${payment.currency}; bank payment ${payment._id.toString()} posted unlinked`)
    return null
  }
  const movement = new CashMovement({
    supplier: payment.supplier,
    session: bankSession._id,
    account: bankSession.account,
    currency: bankSession.currency,
    date: payment.date,
    direction: payment.direction === bookcarsTypes.RentalPaymentDirection.Debit
      ? bookcarsTypes.CashMovementDirection.Out
      : bookcarsTypes.CashMovementDirection.In,
    amount: payment.amount,
    source: bookcarsTypes.CashMovementSource.RentalPayment,
    status: 'confirmed',
    // R3-12 — deterministic fallback key for key-less payments (see cash above).
    idempotencyKey: payment.idempotencyKey ? `bank-${payment.idempotencyKey}` : `bank-rental-${payment._id.toString()}`,
    rentalPayment: payment._id,
    purpose: payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent,
    reference: payment.reference,
    note: payment.note,
    actor: payment.actor,
  })
  await movement.save(dbSession ? { session: dbSession } : undefined)
  payment.bankSession = bankSession._id
  await payment.save(dbSession ? { session: dbSession } : undefined)
  return movement
}

const linkReversalCashMovement = async (
  original: env.RentalPayment,
  reversal: env.RentalPayment,
  dbSession?: mongoose.ClientSession,
): Promise<env.CashMovement | null> => {
  if (original.method !== bookcarsTypes.RentalPaymentMethod.Cash) {
    return null
  }
  const originalMovementQuery = CashMovement.findOne({ rentalPayment: original._id })
  if (dbSession) {
    originalMovementQuery.session(dbSession)
  }
  const originalMovement = await originalMovementQuery
  // F-01 / audit-fix 2026-11-24 — the original payment may have no
  // linked movement (it posted while no session was open and landed in
  // unlinkedCashPayments). The reversal must still post its compensating
  // movement: fall back to the latest open session for the account,
  // exactly as the closed-original-session case already does. Only when
  // no open session exists at all is the movement dropped (logged below).
  const openSessionQuery = originalMovement ? CashSession.findOne({
    _id: originalMovement.session,
    supplier: original.supplier,
    status: bookcarsTypes.CashSessionStatus.Open,
  }) : null
  if (dbSession && openSessionQuery) {
    openSessionQuery.session(dbSession)
  }
  const openSession = openSessionQuery ? await openSessionQuery : null
  const targetQuery = CashSession.findOne({
    supplier: original.supplier,
    account: bookcarsTypes.CashAccountType.Cash,
    status: bookcarsTypes.CashSessionStatus.Open,
  }).sort({ openedAt: -1 })
  if (dbSession) {
    targetQuery.session(dbSession)
  }
  const target = openSession || await targetQuery
  // GH-33 - the fallback is a heuristic, not a true link: the reversal's
  // compensating movement lands in the latest open session, which may not
  // be the session that took the money. Log it loudly so the attribution
  // is visible; the true fix is the relink pass, not this log.
  if (!openSession && target) {
    logger.warn(`[ledger.linkReversalCashMovement] Original cash payment ${original._id.toString()} has no linked movement; reversal ${reversal._id.toString()} compensating in latest open session ${target._id.toString()} (opened ${target.openedAt?.toISOString()})`)
  }
  if (!target) {
    logger.error(`[ledger.linkReversalCashMovement] No open cash session for supplier ${original.supplier.toString()}; cash reversal ${reversal._id.toString()} recorded without a drawer movement`)
    return null
  }
  if (target.currency !== reversal.currency) {
    logger.error(`[ledger.linkReversalCashMovement] Cash session currency ${target.currency} does not match reversal currency ${reversal.currency}; cash reversal ${reversal._id.toString()} recorded without a drawer movement`)
    return null
  }
  const movement = new CashMovement({
    supplier: reversal.supplier,
    session: target._id,
    account: target.account,
    currency: target.currency,
    date: reversal.date,
    direction: bookcarsTypes.CashMovementDirection.Out,
    amount: reversal.amount,
    source: bookcarsTypes.CashMovementSource.RentalPayment,
    status: 'confirmed',
    idempotencyKey: reversal.idempotencyKey ? `cash-${reversal.idempotencyKey}` : undefined,
    rentalPayment: reversal._id,
    purpose: reversal.purpose || bookcarsTypes.RentalPaymentPurpose.Rent,
    reference: reversal.reference,
    note: reversal.note,
    actor: reversal.actor,
  })
  await movement.save(dbSession ? { session: dbSession } : undefined)
  reversal.cashSession = target._id
  await reversal.save(dbSession ? { session: dbSession } : undefined)
  return movement
}

// Wave 2.6 — the bank mirror of linkReversalCashMovement: a reversed
// wire payment hands the money back, so the Bank session needs its
// compensating Out movement (linked to the reversal row). Best-effort:
// the reversal already posted.
const linkReversalBankMovement = async (
  original: env.RentalPayment,
  reversal: env.RentalPayment,
  dbSession?: mongoose.ClientSession,
): Promise<env.CashMovement | null> => {
  if (original.method !== bookcarsTypes.RentalPaymentMethod.BankTransfer) {
    return null
  }
  const originalMovementQuery = CashMovement.findOne({ rentalPayment: original._id })
  if (dbSession) {
    originalMovementQuery.session(dbSession)
  }
  const originalMovement = await originalMovementQuery
  // F-01 / audit-fix 2026-11-24 — the original payment may have no
  // linked movement (it posted while no session was open and landed in
  // unlinkedCashPayments). The reversal must still post its compensating
  // movement: fall back to the latest open session for the account,
  // exactly as the closed-original-session case already does. Only when
  // no open session exists at all is the movement dropped (logged below).
  const openSessionQuery = originalMovement ? CashSession.findOne({
    _id: originalMovement.session,
    supplier: original.supplier,
    status: bookcarsTypes.CashSessionStatus.Open,
  }) : null
  if (dbSession && openSessionQuery) {
    openSessionQuery.session(dbSession)
  }
  const openSession = openSessionQuery ? await openSessionQuery : null
  const targetQuery = CashSession.findOne({
    supplier: original.supplier,
    account: bookcarsTypes.CashAccountType.Bank,
    status: bookcarsTypes.CashSessionStatus.Open,
  }).sort({ openedAt: -1 })
  if (dbSession) {
    targetQuery.session(dbSession)
  }
  const target = openSession || await targetQuery
  // GH-33 - the fallback is a heuristic, not a true link: the reversal's
  // compensating movement lands in the latest open session, which may not
  // be the session that took the money. Log it loudly so the attribution
  // is visible; the true fix is the relink pass, not this log.
  if (!openSession && target) {
    logger.warn(`[ledger.linkReversalBankMovement] Original bank payment ${original._id.toString()} has no linked movement; reversal ${reversal._id.toString()} compensating in latest open session ${target._id.toString()} (opened ${target.openedAt?.toISOString()})`)
  }
  if (!target) {
    logger.error(`[ledger.linkReversalBankMovement] No open bank session for supplier ${original.supplier.toString()}; bank reversal ${reversal._id.toString()} recorded without a bank movement`)
    return null
  }
  if (target.currency !== reversal.currency) {
    logger.error(`[ledger.linkReversalBankMovement] Bank session currency ${target.currency} does not match reversal currency ${reversal.currency}; bank reversal ${reversal._id.toString()} recorded without a bank movement`)
    return null
  }
  const movement = new CashMovement({
    supplier: reversal.supplier,
    session: target._id,
    account: target.account,
    currency: target.currency,
    date: reversal.date,
    direction: bookcarsTypes.CashMovementDirection.Out,
    amount: reversal.amount,
    source: bookcarsTypes.CashMovementSource.RentalPayment,
    status: 'confirmed',
    idempotencyKey: reversal.idempotencyKey ? `bank-${reversal.idempotencyKey}` : undefined,
    rentalPayment: reversal._id,
    purpose: reversal.purpose || bookcarsTypes.RentalPaymentPurpose.Rent,
    reference: reversal.reference,
    note: reversal.note,
    actor: reversal.actor,
  })
  await movement.save(dbSession ? { session: dbSession } : undefined)
  reversal.bankSession = target._id
  await reversal.save(dbSession ? { session: dbSession } : undefined)
  return movement
}

const postWithinSession = async (input: PostRentalPaymentInput, session?: mongoose.ClientSession) => {
  const bookingId = new mongoose.Types.ObjectId(input.bookingId)
  const bookingQuery = Booking.findOne({ _id: bookingId, ...(input.supplierId ? { supplier: input.supplierId } : {}) })
    .select('_id supplier price car status expireAt financialSnapshot ledgerVersion deletedAt')
  if (session) {
bookingQuery.session(session)
}
  const booking = await bookingQuery
  // GA-PAR-22: no new money may move against a trashed contract —
  // restore the booking first (design §5.5 mutation wall).
  if (booking?.deletedAt) {
    throw new LedgerError('TRASHED', 'TRASHED: This booking is trashed and cannot be modified. Restore it first.')
  }
  // GAP-C1/M1 — a pay-later (Pending) booking carries `expireAt` as its
  // hold window, not as a temporary-checkout marker: money may be
  // posted against it. Only temporary (Void) and Cancelled bookings
  // refuse money here.
  if (!booking || [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled].includes(booking.status)) {
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
      // F6 / W3 C-7 — a replayed posting also repairs its drawer link:
      // a cash payment posted while no session was open links now that
      // one is. Best-effort, as above. (Wave 2.6: same repair for a
      // bank-transfer payment into the open Bank session.)
      try {
        await linkLedgerCashPayment(existing, session)
      } catch (err) {
        logger.error(`[ledger.postWithinSession] Cash payment ${existing._id.toString()} replayed but could not be linked to a cash session`, err)
      }
      try {
        await linkLedgerBankPayment(existing, session)
      } catch (err) {
        logger.error(`[ledger.postWithinSession] Bank payment ${existing._id.toString()} replayed but could not be linked to a bank session`, err)
      }
      // GA5 - a replayed posting also repairs its invoice link.
      try {
        await linkPostedRentPaymentToInvoice(existing)
      } catch (err) {
        logger.error(`[ledger.postWithinSession] Rent payment ${existing._id.toString()} replayed but could not be linked to the invoice`, err)
      }
      return existing
    }
  }
  const recorded = normalizeLedgerAmount(await getRecordedPurposeTotal(bookingId, purpose, session), currency)
  // F6 / W3 P-7 — the cap comes from purposeCap (snapshot, else the
  // booking's own car deposit for legacy bookings — never a silent 0).
  const purposeTotal = await purposeCap(booking, purpose, session)
  const remaining = remainingLedgerBalance(purposeTotal, recorded, currency)
  const direction = input.direction || bookcarsTypes.RentalPaymentDirection.Credit
  // F6 / W3 P-8 — a manual debit is validated against what was
  // RECORDED, not what remains: it must not drive the purpose total
  // below zero (a credit is validated against the remaining cap, as
  // before). `recorded` is the signed net (debits count negative), so
  // amount <= recorded is exactly "the total stays >= 0".
  if (direction === bookcarsTypes.RentalPaymentDirection.Debit) {
    if (amount <= 0 || toMinorUnits(amount, currency) > toMinorUnits(recorded, currency)) {
      throw new LedgerError('OVERPAYMENT', purpose === bookcarsTypes.RentalPaymentPurpose.Deposit
        ? 'Debit exceeds the recorded refundable deposit total'
        : purpose === bookcarsTypes.RentalPaymentPurpose.Charge
          ? 'Debit exceeds the recorded charge total'
          : 'Debit exceeds the recorded rental total')
    }
  } else if (amount <= 0 || toMinorUnits(amount, currency) > toMinorUnits(remaining, currency)) {
    throw new LedgerError('OVERPAYMENT', purpose === bookcarsTypes.RentalPaymentPurpose.Deposit
      ? (purposeTotal <= 0
        ? 'No refundable deposit is recorded for this booking (no snapshot and no car deposit)'
        : 'Payment exceeds the refundable deposit allowance')
      : purpose === bookcarsTypes.RentalPaymentPurpose.Charge
        ? 'Payment exceeds the approved charge total'
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
  // F6 / W3 C-7 — a posted cash payment enters the drawer as a linked
  // movement. Best-effort by design: the ledger posting already
  // succeeded, and a linkage failure (no open session, currency
  // mismatch) must never refuse posted money — the payment stays
  // unlinked and visible in the journal reconciliation instead.
  // (Wave 2.6: a posted bank-transfer payment links the same way into
  // the open Bank session.)
  try {
    await linkLedgerCashPayment(payment, session)
  } catch (err) {
    logger.error(`[ledger.postWithinSession] Cash payment ${payment._id.toString()} posted but could not be linked to a cash session`, err)
  }
  try {
    await linkLedgerBankPayment(payment, session)
  } catch (err) {
    logger.error(`[ledger.postWithinSession] Bank payment ${payment._id.toString()} posted but could not be linked to a bank session`, err)
  }
  // GA5 - a posted rent payment belongs on the booking
  // issued invoice (paidAmount only moved via the manual link
  // before, so ledger postings never reached the invoice).
  // Best-effort, as the drawer links above: the posting
  // already succeeded.
  try {
    await linkPostedRentPaymentToInvoice(payment)
  } catch (err) {
    logger.error(`[ledger.postWithinSession] Rent payment ${payment._id.toString()} posted but could not be linked to the invoice`, err)
  }
  return payment
}

export const postRentalPayment = async (input: PostRentalPaymentInput) => {
  const bookingId = input.bookingId.toString()
  const payment = await withBookingLock(bookingId, async () => {
    if (input.session) {
return postWithinSession(input, input.session)
}
    if (supportsTransactions()) {
return mongoose.connection.transaction((session) => postWithinSession(input, session))
}
    return postWithinSession(input)
  })
  // GH-17 — the stored isPayedInFull flag follows the ledger. Only when
  // this call owned the transaction: a caller-supplied session means the
  // posting is still inside the caller's transaction (checkout
  // finalisation, deposit settlement), and the sync must run after it
  // commits. Best-effort: the posting already succeeded.
  if (!input.session) {
    try {
      await syncBookingPaidInFull(bookingId)
    } catch (err) {
      logger.error(`[ledger.postRentalPayment] Payment ${payment._id.toString()} posted but isPayedInFull could not be synced`, err)
    }
  }
  return payment
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
    const booking = await Booking.findById(payment.booking).select('_id price car supplier financialSnapshot deletedAt')
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
    // F6 / W3 P-7 — same shared cap as posting (snapshot, else the
    // booking's own car deposit for legacy bookings).
    const purposeTotal = await purposeCap(booking, purpose)
    const remaining = remainingLedgerBalance(purposeTotal, recorded, currency)
    // F6 / W3 P-8 — a pending debit confirms against the recorded total
    // (must not drive the purpose total below zero); a pending credit
    // confirms against the remaining cap, as before. A debit can only
    // be pending when an accountant recorded it (counter agents cannot
    // record debits), but the check is the same either way.
    if (payment.direction === bookcarsTypes.RentalPaymentDirection.Debit) {
      if (toMinorUnits(normalizeLedgerAmount(payment.amount, currency), currency) > toMinorUnits(recorded, currency)) {
        throw new LedgerError('OVERPAYMENT', purpose === bookcarsTypes.RentalPaymentPurpose.Deposit
          ? 'Confirming this debit would exceed the recorded refundable deposit total'
          : purpose === bookcarsTypes.RentalPaymentPurpose.Charge
            ? 'Confirming this debit would exceed the recorded charge total'
            : 'Confirming this debit would exceed the recorded rental total')
      }
    } else if (toMinorUnits(normalizeLedgerAmount(payment.amount, currency), currency) > toMinorUnits(remaining, currency)) {
      throw new LedgerError('OVERPAYMENT', purpose === bookcarsTypes.RentalPaymentPurpose.Deposit && purposeTotal <= 0
        ? 'No refundable deposit is recorded for this booking (no snapshot and no car deposit)'
        : purpose === bookcarsTypes.RentalPaymentPurpose.Charge
          ? 'Confirming this entry would exceed the approved charge total'
          : 'Confirming this entry would exceed the remaining balance')
    }
    payment.status = bookcarsTypes.RentalPaymentStatus.Posted
    payment.settledAt = payment.date
    payment.confirmedBy = input.actorId ? new mongoose.Types.ObjectId(input.actorId) : undefined
    payment.confirmedAt = new Date()
    await payment.save()
    // F6 / W3 C-7 — a confirmed cash entry enters the drawer now (it
    // never counted while pending). Best-effort: the confirmation
    // already succeeded. (Wave 2.6: same for a confirmed bank entry
    // into the open Bank session.)
    try {
      await linkLedgerCashPayment(payment)
    } catch (err) {
      logger.error(`[ledger.confirmRentalPayment] Payment ${payment._id.toString()} confirmed but could not be linked to a cash session`, err)
    }
    try {
      await linkLedgerBankPayment(payment)
    } catch (err) {
      logger.error(`[ledger.confirmRentalPayment] Payment ${payment._id.toString()} confirmed but could not be linked to a bank session`, err)
    }
    // GA5 - a pending rent entry confirmed into posted money joins
    // the issued invoice the same way a fresh posting does.
    try {
      await linkPostedRentPaymentToInvoice(payment)
    } catch (err) {
      logger.error(`[ledger.confirmRentalPayment] Payment ${payment._id.toString()} confirmed but could not be linked to the invoice`, err)
    }
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
 * `Deposit` with nothing outstanding becomes `PaidInFull`. The reverse
 * also holds (Wave 1.6): a `Paid`/`PaidInFull` booking with an
 * outstanding balance again falls back to `Deposit`, so the label can
 * never claim 'paid' while money is owed. A booking
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
// Audit-fix 2026-11-24 (F-02) — the refresh outcome, including the
// blocking reason when a conflict refuses the flip (e.g. an overdue
// maintenance schedule). Callers surface `conflictReason` to the
// manager instead of silently leaving the booking unconfirmed.
export type BookingPaymentStatusRefresh = {
  status: bookcarsTypes.BookingStatus
  updated: boolean
  conflict: boolean
  conflictReason?: string
  outstandingBalance: number
  currency: string
  postedRent: number
  depositPaid: number
}

export const refreshBookingPaymentStatus = async (bookingId: mongoose.Types.ObjectId | string): Promise<BookingPaymentStatusRefresh> => {
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
  // R4-02 / R3-01 follow-on — a Void hold is provider-paid but
  // unconfirmed: the ledger has no legs (finalisation posts them only
  // after the availability save succeeds), so the upgrade leg below
  // can never confirm it — it returns updated:false, which the admin
  // UI reports as a successful retry. Re-run the single-booking
  // reconcile instead (same verify -> finalise -> refund sequence the
  // sweeper runs): the provider state is re-verified, so a booking
  // whose payment was refunded meanwhile is never finalised on stale
  // proof. A Void booking without a provider reference or snapshot
  // (e.g. a voided pay-later hold) is not a provider hold: it falls
  // through to the existing logic, which returns updated:false.
  // Dynamic import: checkoutSweeper reaches bookingController (via
  // checkoutReconciliation), so a static import would cycle.
  if (booking.status === bookcarsTypes.BookingStatus.Void
    && booking.financialSnapshot
    && (booking.sessionId?.startsWith('cs_') || booking.paymentIntentId || booking.paypalOrderId)) {
    const { reconcileOneVoidBooking } = await import('./checkoutSweeper.js')
    const { outcome, detail } = await reconcileOneVoidBooking(booking, new Date())
    if (outcome === 'finalized' || outcome === 'already-finalized' || outcome === 'refunded') {
      // The hold resolved: finalised (legs posted, status moved) or
      // refunded (money returned, hold extension cleared). Re-read
      // the booking and the ledger so the returned figures are
      // post-reconcile; the row leaves the paid-unconfirmed queue.
      const fresh = await Booking.findById(bookingId)
      const freshReceivable = fresh ? await getContractReceivable(fresh) : receivable
      return {
        status: fresh?.status ?? booking.status,
        updated: true,
        outstandingBalance: freshReceivable.outstandingBalance,
        currency: freshReceivable.currency,
        postedRent: freshReceivable.postedPayments,
        depositPaid: freshReceivable.depositPayments,
        conflict: false,
      }
    }
    const conflictReason = outcome === 'held'
      ? (detail || 'Paid but unfinalisable: the confirmation conflicts (e.g. the car is blocked or its dates are taken)')
      : outcome === 'refund-failed'
        ? (detail || 'Provider refund failed; needs manual review')
        : outcome === 'provider-error'
          ? (detail || 'Provider unreachable; the hold was preserved for review')
          : outcome === 'skipped'
            ? 'No provider reference to verify'
            : 'Provider reports no payment for this booking'
    return { status: booking.status, updated: false, ...base, conflict: true, conflictReason }
  }
  // Upgrade leg (unchanged): Pending/Reserved with nothing outstanding
  // becomes Paid; Deposit with nothing outstanding becomes PaidInFull.
  const upgradeTarget = booking.status === bookcarsTypes.BookingStatus.Deposit
    ? bookcarsTypes.BookingStatus.PaidInFull
    : [bookcarsTypes.BookingStatus.Pending, bookcarsTypes.BookingStatus.Reserved].includes(booking.status)
      ? bookcarsTypes.BookingStatus.Paid
      : null
  // Downgrade leg (Wave 1.6) — the status must move DOWN when money
  // becomes owed again: a Paid/PaidInFull booking that gains an approved
  // charge, or a price increase, falls back to Deposit (deposit paid,
  // rent due). It NEVER falls back to Pending: a Pending booking reserves
  // the car only while its hold window is open, and a confirmed booking
  // carries no expireAt — Pending would silently free the car.
  const downgrade = [bookcarsTypes.BookingStatus.Paid, bookcarsTypes.BookingStatus.PaidInFull].includes(booking.status)
    && receivable.outstandingBalance > 0
  const target = downgrade ? bookcarsTypes.BookingStatus.Deposit : upgradeTarget
  // Nothing outstanding, and either real money was posted or the contract
  // total is zero (a genuinely free booking confirms with no payment).
  // The outstanding check applies to the upgrade leg only: for the
  // downgrade leg, an outstanding balance is the trigger, not a refusal.
  const moneyPosted = receivable.postedPayments + receivable.depositPayments > 0
  const totalDue = receivable.rentalTotal + receivable.approvedCharges
  if (!target || (!downgrade && (receivable.outstandingBalance > 0 || (!moneyPosted && totalDue > 0)))) {
    // GH-17 — the stored flag follows the ledger even when the status
    // does not move: a booking that gains an outstanding balance must
    // read unpaid, and a fully-paid one must read paid.
    const paidInFull = receivable.outstandingBalance <= 0
    if (booking.isPayedInFull !== paidInFull) {
      booking.isPayedInFull = paidInFull
      await booking.save()
    }
    return { status: booking.status, updated: false, ...base, conflict: false }
  }
  // F4 / W1 #5 — the pay-later half of the lifecycle middle: a
  // manual/cash confirmation that derives Paid/PaidInFull from the
  // ledger also moves the lifecycle Draft -> Confirmed, mirroring
  // the provider-finalisation producer. A zero-total booking
  // confirms the same way (nothing outstanding, nothing posted).
  const previousStatus = booking.status
  const previousLifecycle = booking.lifecycle
  const previousExpireAt = booking.expireAt
  // GH-17 — the ledger-derived flag rides on the same document, so the
  // saveBookingWithAvailability below persists status + flag together.
  // A conflict there throws before saving, so a refused flip leaves the
  // stored flag untouched (the ledger did not change either).
  booking.isPayedInFull = receivable.outstandingBalance <= 0
  booking.status = target
  // GAP-C1/M1 — confirming a hold clears its hold window: a Paid /
  // PaidInFull booking must never carry `expireAt` (the TTL would
  // delete a paid booking, and trash refuses `expireAt`-set rows).
  booking.expireAt = undefined
  if (!booking.lifecycle || booking.lifecycle === bookcarsTypes.ContractLifecycle.Draft) {
    booking.lifecycle = bookcarsTypes.ContractLifecycle.Confirmed
  }
  try {
    // Paid/PaidInFull reserve the car (a Pending hold reserves only
    // while its window is open), so this re-checks availability: a
    // conflicting booking refuses the flip.
    await saveBookingWithAvailability(booking)
  } catch (err) {
    booking.status = previousStatus
    booking.lifecycle = previousLifecycle
    booking.expireAt = previousExpireAt
    if (err instanceof BookingConflictError) {
      logger.error(`[ledger.refreshBookingPaymentStatus] Booking ${booking._id.toString()} cannot be confirmed: the car is no longer available for the dates`, err)
      return { status: previousStatus, updated: false, ...base, conflict: true, conflictReason: err.message }
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
  // Wave 2.4 — run the reversal inside the caller's transaction
  // (deposit settlement in complete()); omitted means the reversal
  // runs in its own transaction, as before.
  session?: mongoose.ClientSession
}) => {
  const initial = await RentalPayment.findById(input.paymentId).select('booking')
  if (!initial) {
throw new LedgerError('INVALID_REVERSAL', 'Payment not found')
}
  const posted = await withBookingLock(initial.booking.toString(), async () => {
    const existingQuery = RentalPayment.findOne({ idempotencyKey: input.idempotencyKey })
    if (input.session) {
      existingQuery.session(input.session)
    }
    const existing = await existingQuery
    if (existing) {
      if (existing.reversedFrom?.toString() === input.paymentId.toString()
        && existing.direction === bookcarsTypes.RentalPaymentDirection.Debit) {
return existing
}
      throw new LedgerError('DUPLICATE_IDEMPOTENCY_KEY', 'Idempotency key is already used for another payment')
    }
    const originalQuery = RentalPayment.findById(input.paymentId)
    if (input.session) {
      originalQuery.session(input.session)
    }
    const original = await originalQuery
    if (!original || original.status !== bookcarsTypes.RentalPaymentStatus.Posted
      || original.direction === bookcarsTypes.RentalPaymentDirection.Debit) {
      throw new LedgerError('INVALID_REVERSAL', 'Only a posted credit can be reversed')
    }
    // GA-PAR-22: a posted payment on a trashed contract cannot be
    // reversed — reversal is ledger movement against the contract,
    // so restore the booking first (same rule as charge decisions).
    const reversalBookingQuery = Booking.findById(original.booking).select('_id deletedAt')
    if (input.session) {
      reversalBookingQuery.session(input.session)
    }
    const reversalBooking = await reversalBookingQuery
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
    await reversal.save(input.session ? { session: input.session } : undefined)
    original.status = bookcarsTypes.RentalPaymentStatus.Reversed
    await original.save(input.session ? { session: input.session } : undefined)
    const linkedInvoicesQuery = Invoice.find({ payments: original._id }).select('_id')
    if (input.session) {
      linkedInvoicesQuery.session(input.session)
    }
    const linkedInvoices = await linkedInvoicesQuery
    for (const invoice of linkedInvoices) {
await recomputeInvoicePayment(invoice._id, input.session)
}
    // F6 / W3 C-7 — a reversed cash payment hands the money back, so
    // the drawer needs its compensating Out movement (linked to the
    // reversal row). Best-effort: the reversal already posted.
    // (Wave 2.6: a reversed wire payment gets the same compensating
    // Out in the Bank session.)
    try {
      await linkReversalCashMovement(original, reversal, input.session)
    } catch (err) {
      logger.error(`[ledger.reverseRentalPayment] Reversal ${reversal._id.toString()} posted but its drawer movement could not be created`, err)
    }
    try {
      await linkReversalBankMovement(original, reversal, input.session)
    } catch (err) {
      logger.error(`[ledger.reverseRentalPayment] Reversal ${reversal._id.toString()} posted but its bank movement could not be created`, err)
    }
    return reversal
  })
  // GH-17 — the stored isPayedInFull flag follows the ledger (a reversal
  // can reopen an outstanding balance). Same own-transaction rule as
  // postRentalPayment above: a caller-supplied session means the caller
  // owns the commit. Best-effort: the reversal already posted.
  if (!input.session) {
    try {
      await syncBookingPaidInFull(initial.booking.toString())
    } catch (err) {
      logger.error(`[ledger.reverseRentalPayment] Reversal ${posted._id.toString()} posted but isPayedInFull could not be synced`, err)
    }
  }
  return posted
}
