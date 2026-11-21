import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import RentalPayment from '../models/RentalPayment'
import Booking from '../models/Booking'
import CashSession from '../models/CashSession'
import CashMovement from '../models/CashMovement'
import ContractCharge from '../models/ContractCharge'
import { LedgerError, confirmRentalPayment, getPurposeRemaining, linkLedgerCashPayment, postRentalPayment, refreshBookingPaymentStatus, reverseRentalPayment } from '../utils/ledger'
import { getContractReceivable } from '../utils/contractReceivable'
import { approvalRequiredFor, findLatestApproval, produceApprovalRequest } from '../utils/approvalProducer'
import { parsePagination, pagedResponse, paginationSkip } from '../utils/pagination'
import { currencyExponent, toMinorUnits } from '../utils/paymentAmount'
import { METRIC_DICTIONARY_VERSION } from './reportController'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'

const getScope = (req: Request): Record<string, unknown> => {
  if (req.user?.type === bookcarsTypes.UserType.Admin) {
    return {}
  }
  return { supplier: agencySupplierId(req) || '000000000000000000000000' }
}
const populatedPaths = [
  { path: 'booking', populate: [{ path: 'car', select: 'name licensePlate' }, { path: 'driver', select: 'fullName email phone' }] },
  { path: 'supplier', select: 'fullName' },
]

export const list = async (req: Request, res: Response) => {
  try {
    // F6 / W3 X-1 — server-side pagination + filters (same filter
    // validation as the CSV export below). No page/size params keeps
    // the legacy full-array response.
    const parsed = parsePagination(req)
    if ('error' in parsed) {
      res.status(400).send(parsed.error)
      return
    }
    const filter: Record<string, unknown> = { ...getScope(req) }
    if (typeof req.query.status === 'string' && req.query.status) {
      if (!Object.values(bookcarsTypes.RentalPaymentStatus).includes(req.query.status as bookcarsTypes.RentalPaymentStatus)) {
        res.status(400).send('Invalid payment status filter')
        return
      }
      filter.status = req.query.status
    }
    if (typeof req.query.purpose === 'string' && req.query.purpose) {
      if (!Object.values(bookcarsTypes.RentalPaymentPurpose).includes(req.query.purpose as bookcarsTypes.RentalPaymentPurpose)) {
        res.status(400).send('Invalid payment purpose filter')
        return
      }
      filter.purpose = req.query.purpose
    }
    if (typeof req.query.booking === 'string' && req.query.booking) {
      if (!mongoose.isValidObjectId(req.query.booking)) {
        res.status(400).send('Invalid booking filter')
        return
      }
      filter.booking = req.query.booking
    }
    const from = typeof req.query.from === 'string' && req.query.from ? new Date(req.query.from) : null
    const to = typeof req.query.to === 'string' && req.query.to ? new Date(req.query.to) : null
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      res.status(400).send('Invalid payment date filter')
      return
    }
    if (from || to) {
      filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
    }
    if (!parsed.pagination) {
      res.json(await RentalPayment.find(filter).sort({ date: -1, createdAt: -1 }).populate(populatedPaths))
      return
    }
    const total = await RentalPayment.countDocuments(filter)
    const payments = await RentalPayment.find(filter).sort({ date: -1, createdAt: -1 }).skip(paginationSkip(parsed.pagination)).limit(parsed.pagination.size).populate(populatedPaths)
    res.json(pagedResponse(payments, total, parsed.pagination))
  } catch (err) {
    logger.error(`[rentalPayment.list] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const create = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const payload = req.body as bookcarsTypes.CreateRentalPaymentPayload
    const date = new Date(payload?.date)
    const amount = Number(payload?.amount)
    const reference = String(payload?.reference || '').trim()
    const note = String(payload?.note || '').trim()
    const reason = String(payload?.reason || '').trim()
    const direction = payload.direction === bookcarsTypes.RentalPaymentDirection.Debit
      ? bookcarsTypes.RentalPaymentDirection.Debit
      : bookcarsTypes.RentalPaymentDirection.Credit
    const idempotencyKey = typeof payload?.idempotencyKey === 'string' ? payload.idempotencyKey.trim() : undefined
    const providerReference = typeof payload?.providerReference === 'string' ? payload.providerReference.trim() : undefined
    if (!user || !mongoose.isValidObjectId(payload?.booking) || Number.isNaN(date.getTime())
      || !Number.isFinite(amount) || amount <= 0
      || !Object.values(bookcarsTypes.RentalPaymentMethod).includes(payload.method)
      || (payload.purpose !== undefined && !Object.values(bookcarsTypes.RentalPaymentPurpose).includes(payload.purpose))
      || (payload.direction !== undefined && !Object.values(bookcarsTypes.RentalPaymentDirection).includes(payload.direction))
      || reference.length > 160 || note.length > 1000 || reason.length > 1000
      || (idempotencyKey !== undefined && (idempotencyKey.length < 8 || idempotencyKey.length > 200))
      || (providerReference !== undefined && providerReference.length > 200)) {
      res.status(400).send('Invalid rental payment')
      return
    }
    // F6 / W3 P-8 — a manual debit / standalone refund entry is ledger
    // only (no provider refund — the money was never taken through a
    // provider here): accountant-or-above, a recorded reason, source
    // forced to Adjustment. Counter agents record credits pending only.
    if (direction === bookcarsTypes.RentalPaymentDirection.Debit) {
      if (req.agency?.role === bookcarsTypes.AgencyRole.CounterAgent) {
        res.status(403).send('Counter agents cannot record debit entries')
        return
      }
      if (reason.length < 3) {
        res.status(400).send('A reason is required for a debit entry')
        return
      }
    }

    const supplierId = agencySupplierId(req)
    // Approvals policy (owner-approved defaults 2026-11-17): a manual
    // refund (a debit) at or above 10,000 MAD needs approval first, so
    // it is recorded as a pending ledger entry and opens a queue
    // request (below); it can only be confirmed once that request is
    // approved (see confirm()). Owner decision 1.5
    // (GA-P10-DECISIONS-01): entries recorded by a counter agent stay
    // pending until an accountant or above confirms them; every other
    // recorder posts immediately, as before.
    const approvalGatedRefund = direction === bookcarsTypes.RentalPaymentDirection.Debit && approvalRequiredFor(amount)
    const pendingEntry = req.agency?.role === bookcarsTypes.AgencyRole.CounterAgent || approvalGatedRefund
    const payment = await postRentalPayment({
      bookingId: payload.booking,
      supplierId: user.type === bookcarsTypes.UserType.Admin ? undefined : supplierId,
      date,
      amount,
      currency: payload.currency,
      method: payload.method,
      status: pendingEntry ? bookcarsTypes.RentalPaymentStatus.Pending : undefined,
      purpose: payload.purpose || bookcarsTypes.RentalPaymentPurpose.Rent,
      direction,
      // A debit is an adjustment, never a manual collection: the source
      // is forced, not operator-chosen.
      source: direction === bookcarsTypes.RentalPaymentDirection.Debit ? bookcarsTypes.RentalPaymentSource.Adjustment : undefined,
      idempotencyKey,
      providerReference,
      actorId: user._id,
      reference,
      // The debit reason is the audit trail: it leads the note when both
      // are given, and is the note when no separate note is given.
      note: reason ? (note ? `${reason} — ${note}` : reason) : note,
    })
    // Approvals policy: the gated refund opens its queue request now,
    // so the refund waits in /approbations instead of posting silently.
    // A producer failure must not lose the ledger entry, so it is
    // logged, not thrown - the entry stays pending and a manual
    // approval request can be created for it instead.
    if (approvalGatedRefund) {
      try {
        await produceApprovalRequest({
          supplier: payment.supplier,
          subjectType: 'rental-payment',
          subject: payment._id.toString(),
          amount,
          currency: payment.currency,
          requestedBy: user._id,
          reason: `Manual refund ${amount} ${payment.currency} on booking ${payload.booking}: ${reason}`,
        })
      } catch (producerErr) {
        logger.error('[rentalPayment.create] approval producer failed', producerErr)
      }
    }
    // F3 / W1 #3: a posted manual payment is a collection — the booking's
    // payment status follows the ledger (Pending → Paid when nothing is
    // outstanding). Best-effort: the payment already posted, so a sync
    // failure (e.g. the car's dates are now taken) is logged, not thrown
    // — staff can retry the confirmation from the booking. Pending
    // entries (counter-agent) sync when an accountant confirms them
    // (see ledger.confirmRentalPayment), not here.
    if (!pendingEntry) {
      try {
        await refreshBookingPaymentStatus(payload.booking)
      } catch (err) {
        logger.error(`[rentalPayment.create] Payment ${payment._id.toString()} posted but booking payment status could not be refreshed`, err)
      }
    }
    await payment.populate(populatedPaths)
    res.status(201).json(payment)
  } catch (err) {
    if (err instanceof LedgerError) {
      // GA-PAR-22: a payment against a trashed booking refuses 409.
      const status = err.code === 'BOOKING_NOT_FOUND' ? 404
        : err.code === 'DUPLICATE_IDEMPOTENCY_KEY' ? 409
          : err.code === 'TRASHED' ? 409
            : 400
      res.status(status).send(err.message)
      return
    }
    logger.error(`[rentalPayment.create] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const confirm = async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).send('Invalid payment confirmation')
      return
    }
    // Counter agents record pending entries; they never confirm them
    // (owner decision 1.5: confirmation is accountant-or-above work).
    if (req.agency?.role === bookcarsTypes.AgencyRole.CounterAgent) {
      res.status(403).send('Counter agents cannot confirm payment entries')
      return
    }
    const payment = await RentalPayment.findOne({ _id: req.params.id, ...getScope(req) }).select('_id status direction amount currency supplier')
    if (!payment) {
      res.sendStatus(404)
      return
    }
    if (payment.status !== bookcarsTypes.RentalPaymentStatus.Pending) {
      res.status(409).send('Only a pending payment entry can be confirmed')
      return
    }
    // Approvals policy (owner-approved defaults 2026-11-17, effect
    // BLOCKING): a manual refund at or above 10,000 MAD cannot be
    // confirmed into posted money until its queue request is approved.
    // A request missing for an older entry is recovered by creating a
    // manual approval request for the payment in /approbations.
    if (payment.direction === bookcarsTypes.RentalPaymentDirection.Debit && approvalRequiredFor(payment.amount)) {
      const gate = await findLatestApproval(payment.supplier, 'rental-payment', payment._id.toString())
      if (!gate) {
        res.status(409).send('This refund needs an approval request first'); return
      }
      if (gate.status === bookcarsTypes.ApprovalDecision.Pending) {
        res.status(409).send('Refund approval is pending'); return
      }
      if (gate.status === bookcarsTypes.ApprovalDecision.Rejected) {
        res.status(409).send('Refund approval was rejected'); return
      }
    }
    const confirmed = await confirmRentalPayment({ paymentId: payment._id, actorId: user._id })
    await confirmed.populate(populatedPaths)
    res.json(confirmed)
  } catch (err) {
    if (err instanceof LedgerError) {
      res.status(err.code === 'BOOKING_NOT_FOUND' ? 404 : 409).send(err.message)
      return
    }
    logger.error(`[rentalPayment.confirm] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const reverse = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : ''
    const note = String(req.body?.note || '').trim()
    if (!user || !mongoose.isValidObjectId(req.params.id)
      || idempotencyKey.length < 8 || idempotencyKey.length > 200 || note.length > 1000) {
      res.status(400).send('Invalid rental payment reversal')
      return
    }

    const payment = await RentalPayment.findOne({ _id: req.params.id, ...getScope(req) }).select('_id')
    if (!payment) {
      res.sendStatus(404)
      return
    }

    const reversal = await reverseRentalPayment({
      paymentId: payment._id,
      actorId: user._id,
      idempotencyKey,
      note: note || undefined,
    })
    await reversal.populate(populatedPaths)
    res.status(201).json(reversal)
  } catch (err) {
    if (err instanceof LedgerError) {
      // F1 / W3 P-5: a provider refund that could not be completed refuses
      // the reversal — 502, nothing was written to the books.
      if (err.code === 'REFUND_FAILED') {
        res.status(502).send(err.message)
        return
      }
      res.status(err.code === 'INVALID_REVERSAL' ? 400 : 409).send(err.message)
      return
    }
    logger.error(`[rentalPayment.reverse] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

// ---------------------------------------------------------------------
// GA-PAR-17 — payments collections summary + payments CSV export.
// Both mirror the payments list's gating exactly (ReadPayments, the
// list route's permission) and its agency scoping (getScope above).
//
// collectionsSummary: the dictionary v2026-11-15.1 collections
// universe — ALL of the agency's bookings excluding Void/Cancelled
// and unexpired checkout placeholders (expireAt set), no period
// window. contractAmount / collected / remaining use the PAR-14
// dictionary definitions verbatim (snapshot rentalTotal fallback
// price + APPROVED charges; collected = posted rent only, all dates,
// signed by direction; remaining clamped per booking). Deposits are
// never revenue and never netted. collectionRatePct is null when
// contractAmount = 0.
// ---------------------------------------------------------------------

const round2 = (n: number) => Number(n.toFixed(2))

// ---------------------------------------------------------------------
// F6 / W3 P-3 — the shared outstanding/receivable table (CROSS-4 with
// F8). One row per live booking with an outstanding balance, computed
// with getContractReceivable — the SAME definition the collections
// summary and the client balances use: outstanding = max(0, rentalTotal
// + APPROVED charges − posted rent), overdue only once the due date
// (rental end / completion) has passed, deposits held never netted.
// This replaces the Payments page's client-side overdue table, which
// omitted approved charges and used its own overdue rule — the third
// of the three disagreeing figures. The dashboard (F8) applies this
// same definition; it does not compute its own.
// ---------------------------------------------------------------------

export const overdue = async (req: Request, res: Response) => {
  try {
    const bookings = await Booking.find({
      ...getScope(req),
      status: { $nin: [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled] },
      deletedAt: null,
    })
      .select('_id reference price financialSnapshot to lifecycle car driver')
      .populate([{ path: 'car', select: 'name licensePlate' }, { path: 'driver', select: 'fullName email phone' }])
      .sort({ to: 1 })
      .lean()
    const rows: bookcarsTypes.OverdueReceivableRow[] = []
    for (const booking of bookings) {
      const receivable = await getContractReceivable(booking as unknown as Parameters<typeof getContractReceivable>[0])
      if (receivable.outstandingBalance <= 0) {
        continue
      }
      rows.push({
        booking: booking as unknown as bookcarsTypes.Booking,
        outstandingBalance: receivable.outstandingBalance,
        depositDue: Math.max(0, round2(receivable.refundableDeposit - receivable.depositPayments)),
        dueAt: receivable.dueAt,
        overdue: receivable.overdue,
        currency: receivable.currency,
      })
    }
    rows.sort((a, b) => b.outstandingBalance - a.outstandingBalance)
    res.json({
      metricDictionaryVersion: METRIC_DICTIONARY_VERSION,
      rows,
      outstandingTotal: round2(rows.reduce((sum, row) => sum + row.outstandingBalance, 0)),
      overdueTotal: round2(rows.filter((row) => row.overdue).reduce((sum, row) => sum + row.outstandingBalance, 0)),
    })
  } catch (err) {
    logger.error(`[rentalPayment.overdue] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

// F6 / W3 C-7 — manually link a posted cash payment into a chosen open
// cash session: the repair path for payments posted while no session
// was open, or before the linkage existed. A payment that already has
// a drawer movement is refused (409) — the link is single, never
// duplicated. Non-cash or non-posted payments cannot link (409).
export const linkCashSession = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const sessionId = typeof req.body?.cashSessionId === 'string' ? req.body.cashSessionId : ''
    if (!user || !mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(sessionId)) {
      res.status(400).send('Invalid cash session link')
      return
    }
    const payment = await RentalPayment.findOne({ _id: req.params.id, ...getScope(req) })
    if (!payment) {
      res.sendStatus(404)
      return
    }
    if (payment.method !== bookcarsTypes.RentalPaymentMethod.Cash || payment.status !== bookcarsTypes.RentalPaymentStatus.Posted) {
      res.status(409).send('Only a posted cash payment can be linked to a cash session')
      return
    }
    const existing = await CashMovement.findOne({ rentalPayment: payment._id }).select('_id session')
    if (existing) {
      res.status(409).send('This payment is already linked to a cash session')
      return
    }
    const session = await CashSession.findOne({ _id: sessionId, supplier: payment.supplier, account: bookcarsTypes.CashAccountType.Cash, status: bookcarsTypes.CashSessionStatus.Open })
    if (!session) {
      res.status(404).send('Open cash session not found')
      return
    }
    if (session.currency !== payment.currency) {
      res.status(409).send('Cash session currency does not match the payment currency')
      return
    }
    const movement = await linkLedgerCashPayment(payment, undefined, session._id)
    if (!movement) {
      res.status(409).send('Cash payment could not be linked to the cash session')
      return
    }
    await payment.populate(populatedPaths)
    res.json({ payment, movement })
  } catch (err) {
    logger.error(`[rentalPayment.linkCashSession] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

// F6 / W3 P-8 — edit a stuck Pending ledger entry (never-posted
// money only). The fields an operator may correct before the entry
// can confirm: date, amount, method, purpose, reference, note. The
// direction is fixed — a credit never becomes a debit by editing.
// The amount is re-validated against the (possibly new) purpose's cap
// via getPurposeRemaining: a credit must fit the remaining cap, a
// debit must fit the recorded total. Posted/Reversed entries are
// append-only (409) — their correction path is reverse + re-record.
export const update = async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).send('Invalid payment entry')
      return
    }
    const payload = req.body as bookcarsTypes.UpdateRentalPaymentPayload
    const payment = await RentalPayment.findOne({ _id: req.params.id, ...getScope(req) })
    if (!payment) {
      res.sendStatus(404)
      return
    }
    if (payment.status !== bookcarsTypes.RentalPaymentStatus.Pending) {
      res.status(409).send('Only a pending payment entry can be edited')
      return
    }
    const date = payload.date !== undefined ? new Date(payload.date) : undefined
    const amount = payload.amount !== undefined ? Number(payload.amount) : undefined
    const reference = payload.reference !== undefined ? String(payload.reference).trim() : undefined
    const note = payload.note !== undefined ? String(payload.note).trim() : undefined
    if ((date !== undefined && Number.isNaN(date.getTime()))
      || (amount !== undefined && (!Number.isFinite(amount) || amount <= 0))
      || (payload.method !== undefined && !Object.values(bookcarsTypes.RentalPaymentMethod).includes(payload.method))
      || (payload.purpose !== undefined && !Object.values(bookcarsTypes.RentalPaymentPurpose).includes(payload.purpose))
      || (reference !== undefined && reference.length > 160)
      || (note !== undefined && note.length > 1000)) {
      res.status(400).send('Invalid payment entry')
      return
    }
    if (amount !== undefined) {
      const purpose = payload.purpose || payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent
      const { remaining, recorded, currency } = await getPurposeRemaining(payment.booking, purpose)
      const isDebit = payment.direction === bookcarsTypes.RentalPaymentDirection.Debit
      const cap = isDebit ? recorded : remaining
      if (toMinorUnits(amount, currency) > toMinorUnits(cap, currency)) {
        res.status(409).send(isDebit
          ? (purpose === bookcarsTypes.RentalPaymentPurpose.Deposit
            ? 'Edited debit exceeds the recorded refundable deposit total'
            : 'Edited debit exceeds the recorded rental total')
          : (purpose === bookcarsTypes.RentalPaymentPurpose.Deposit
            ? 'Edited amount exceeds the remaining refundable deposit allowance'
            : 'Edited amount exceeds the remaining rental balance'))
        return
      }
    }
    if (date !== undefined) {
      payment.date = date
    }
    if (amount !== undefined) {
      payment.amount = amount
    }
    if (payload.method !== undefined) {
      payment.method = payload.method
    }
    if (payload.purpose !== undefined) {
      payment.purpose = payload.purpose
    }
    if (reference !== undefined) {
      payment.reference = reference
    }
    if (note !== undefined) {
      payment.note = note
    }
    await payment.save()
    await payment.populate(populatedPaths)
    res.json(payment)
  } catch (err) {
    if (err instanceof LedgerError) {
      res.status(err.code === 'BOOKING_NOT_FOUND' ? 404 : 409).send(err.message)
      return
    }
    logger.error(`[rentalPayment.update] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

// F6 / W3 P-8 — delete a stuck Pending ledger entry: hard delete of
// never-posted money. A pending entry never counted toward any total,
// so nothing else changes. Posted/Reversed entries are append-only
// (409) — their correction path is reverse + re-record.
export const remove = async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).send('Invalid payment entry')
      return
    }
    const payment = await RentalPayment.findOne({ _id: req.params.id, ...getScope(req) }).select('_id status')
    if (!payment) {
      res.sendStatus(404)
      return
    }
    if (payment.status !== bookcarsTypes.RentalPaymentStatus.Pending) {
      res.status(409).send('Only a pending payment entry can be deleted')
      return
    }
    await RentalPayment.deleteOne({ _id: payment._id })
    res.sendStatus(204)
  } catch (err) {
    logger.error(`[rentalPayment.remove] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const collectionsSummary = async (req: Request, res: Response) => {
  try {
    const bookings = await Booking.find({
      ...getScope(req),
      status: { $nin: [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled] },
      // GA-PAR-22: trashed bookings leave contractAmount (§2.5);
      // their posted payments still count as collected, so `remaining`
      // can understate — accepted semantics.
      deletedAt: null,
    }).select('_id price financialSnapshot').lean()
    const bookingIds = bookings.map((b) => b._id)
    // GA-PAR-22 (§2.5): `collected` is payment-driven and KEEPS the
    // trashed booking's posted payments; `contractAmount` comes from
    // live bookings only. The payment match therefore covers live +
    // trashed bookings; the charge match stays live-only.
    const trashedBookingIds = (await Booking.find({
      ...getScope(req),
      status: { $nin: [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled] },
      deletedAt: { $ne: null },
    }).select('_id').lean()).map((b) => b._id)
    const paymentBookingIds = [...bookingIds, ...trashedBookingIds]
    const [paymentRows, chargeRows] = await Promise.all([
      paymentBookingIds.length > 0 ? RentalPayment.aggregate([
        { $match: { booking: { $in: paymentBookingIds }, status: bookcarsTypes.RentalPaymentStatus.Posted } },
        { $group: { _id: { booking: '$booking', purpose: { $ifNull: ['$purpose', bookcarsTypes.RentalPaymentPurpose.Rent] } }, total: { $sum: { $cond: [{ $eq: ['$direction', bookcarsTypes.RentalPaymentDirection.Debit] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
      ]) : [],
      bookingIds.length > 0 ? ContractCharge.aggregate([
        { $match: { booking: { $in: bookingIds }, status: bookcarsTypes.ApprovalDecision.Approved } },
        { $group: { _id: { booking: '$booking', currency: '$currency' }, total: { $sum: '$amount' } } },
      ]) : [],
    ])
    const rentByBooking = new Map<string, number>()
    for (const row of paymentRows as Array<{ _id: { booking: mongoose.Types.ObjectId, purpose: string }, total: number }>) {
      if (row._id.purpose === bookcarsTypes.RentalPaymentPurpose.Rent) {
        rentByBooking.set(row._id.booking.toString(), Number(row.total || 0))
      }
    }
    const chargesByBooking = new Map<string, Array<{ currency: string, total: number }>>()
    for (const row of chargeRows as Array<{ _id: { booking: mongoose.Types.ObjectId, currency: string }, total: number }>) {
      const key = row._id.booking.toString()
      const list = chargesByBooking.get(key) || []
      list.push({ currency: row._id.currency, total: Number(row.total || 0) })
      chargesByBooking.set(key, list)
    }
    let contractAmount = 0
    let collected = 0
    let remaining = 0
    for (const booking of bookings) {
      const currency = (booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
      const exponent = currencyExponent(currency)
      const rentalTotal = Number(booking.financialSnapshot?.rentalTotal || booking.price || 0)
      const approvedCharges = (chargesByBooking.get(booking._id.toString()) || [])
        .filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + row.total, 0)
      const amount = rentalTotal + approvedCharges
      const paid = Number(rentByBooking.get(booking._id.toString()) || 0)
      contractAmount += amount
      collected += paid
      // Per-booking minor-unit clamp, exactly as contractReceivable.
      remaining += Math.max(0, toMinorUnits(amount, currency) - toMinorUnits(paid, currency)) / (10 ** exponent)
    }
    // GA-PAR-22 (§2.5): the trashed bookings' posted rent stays in
    // `collected`. `remaining` is the live-only per-booking sum and
    // therefore understates by up to that amount — accepted semantics.
    collected += trashedBookingIds.reduce((s, id) => s + (rentByBooking.get(id.toString()) || 0), 0)
    contractAmount = round2(contractAmount)
    collected = round2(collected)
    remaining = round2(remaining)
    // F6 / W3 X-1 — net posted payments, agency-wide (the Payments
    // page's TOTAL card). Same posted rule the page used client-side:
    // Posted, or legacy status-less rows; debits count negative. Not
    // limited to the collections universe: a payment on a Void or
    // Cancelled booking is still recorded money.
    const netRows = await RentalPayment.aggregate([
      { $match: { ...getScope(req), $or: [{ status: bookcarsTypes.RentalPaymentStatus.Posted }, { status: { $exists: false } }, { status: null }] } },
      { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ['$direction', bookcarsTypes.RentalPaymentDirection.Debit] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
    ])
    const postedNetTotal = round2(Number((netRows[0] as { total?: number } | undefined)?.total || 0))
    res.json({
      metricDictionaryVersion: METRIC_DICTIONARY_VERSION,
      currency: env.BASE_CURRENCY.toUpperCase(),
      contractAmount,
      collected,
      remaining,
      collectionRatePct: contractAmount === 0 ? null : round2((collected / contractAmount) * 100),
      bookingsCount: bookings.length,
      postedNetTotal,
    })
  } catch (err) {
    logger.error(`[rentalPayment.collectionsSummary] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

// Payments CSV export: one row per RentalPayment in scope — the
// PAYMENTS rows themselves (not report metric rows). Default scope is
// the payments list's own scope (agency-wide, every status — a
// reversed payment appears with its real stored status/direction,
// nothing is silently filtered); optional status / purpose / from /
// to query filters narrow it.
const escapeCsv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

export const exportPaymentsCsv = async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = { ...getScope(req) }
    if (typeof req.query.status === 'string' && req.query.status) {
      if (!Object.values(bookcarsTypes.RentalPaymentStatus).includes(req.query.status as bookcarsTypes.RentalPaymentStatus)) {
        res.status(400).send('Invalid payment status filter')
        return
      }
      filter.status = req.query.status
    }
    if (typeof req.query.purpose === 'string' && req.query.purpose) {
      if (!Object.values(bookcarsTypes.RentalPaymentPurpose).includes(req.query.purpose as bookcarsTypes.RentalPaymentPurpose)) {
        res.status(400).send('Invalid payment purpose filter')
        return
      }
      filter.purpose = req.query.purpose
    }
    const from = typeof req.query.from === 'string' && req.query.from ? new Date(req.query.from) : null
    const to = typeof req.query.to === 'string' && req.query.to ? new Date(req.query.to) : null
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      res.status(400).send('Invalid payment date filter')
      return
    }
    if (from || to) {
      filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
    }
    const payments = await RentalPayment.find(filter).sort({ date: -1, createdAt: -1 }).populate(populatedPaths).lean()
    const header = 'date,bookingReference,clientName,car,purpose,status,direction,amount,currency'
    const lines = (payments as unknown as Array<Record<string, unknown>>).map((payment) => {
      const booking = (payment.booking && typeof payment.booking === 'object' ? payment.booking : {}) as { reference?: string, _id?: unknown, car?: { name?: string, licensePlate?: string }, driver?: { fullName?: string } }
      const carLabel = booking.car ? (booking.car.licensePlate ? `${booking.car.name || ''} (${booking.car.licensePlate})` : booking.car.name || '') : ''
      return [
        payment.date ? new Date(payment.date as string).toISOString() : '',
        booking.reference || (booking._id ? String(booking._id) : String(payment.booking || '')),
        booking.driver?.fullName || '',
        carLabel,
        payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent,
        payment.status || '',
        payment.direction || '',
        Number(payment.amount || 0).toFixed(2),
        payment.currency || '',
      ].map(escapeCsv).join(',')
    })
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="gestion-auto-payments.csv"').send([header, ...lines].join('\r\n') + '\r\n')
  } catch (err) {
    logger.error(`[rentalPayment.exportPaymentsCsv] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
