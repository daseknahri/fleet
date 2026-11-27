import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import RentalPayment from '../models/RentalPayment'
import Booking from '../models/Booking'
import CashSession from '../models/CashSession'
import CashMovement from '../models/CashMovement'
import ContractCharge from '../models/ContractCharge'
import NotificationDelivery from '../models/NotificationDelivery'
import { LedgerError, confirmRentalPayment, getPurposeRemaining, linkLedgerBankPayment, linkLedgerCashPayment, postRentalPayment, refreshBookingPaymentStatus, reverseRentalPayment } from '../utils/ledger'
import { getContractReceivable } from '../utils/contractReceivable'
import { approvalRequiredFor, findLatestApproval, produceApprovalRequest } from '../utils/approvalProducer'
import { parsePagination, pagedResponse, paginationSkip } from '../utils/pagination'
import { currencyExponent, toMinorUnits } from '../utils/paymentAmount'
import { METRIC_DICTIONARY_VERSION } from './reportController'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId, logAdminCrossAgencyAccess } from '../utils/agencyAuthorization'

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
    // approved (see confirm()). Q15 (owner decision 2026-11-21): the
    // four-eyes rule is DROPPED â€” one person is good, so a counter
    // agent's entry posts immediately like every other recorder's.
    // Only an approval-gated refund stays pending.
    const approvalGatedRefund = direction === bookcarsTypes.RentalPaymentDirection.Debit && approvalRequiredFor(amount)
    const pendingEntry = approvalGatedRefund
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
    // — staff retry the confirmation from the booking (POST
    // /api/bookings/:id/refresh-payment-status, audit-fix F-02). Pending
    // entries (counter-agent) sync when an accountant confirms them
    // (see ledger.confirmRentalPayment), not here.
    // Audit-fix 2026-11-24 (F-02): the refresh outcome rides on the 201
    // so the manager sees a conflict (e.g. an overdue maintenance
    // schedule blocked the confirmation) instead of a silent no-op.
    let statusRefresh: { conflict: boolean, conflictReason?: string, updated: boolean } | undefined
    if (!pendingEntry) {
      try {
        const refresh = await refreshBookingPaymentStatus(payload.booking)
        statusRefresh = { conflict: refresh.conflict, conflictReason: refresh.conflictReason, updated: refresh.updated }
      } catch (err) {
        logger.error(`[rentalPayment.create] Payment ${payment._id.toString()} posted but booking payment status could not be refreshed`, err)
      }
    }
    await payment.populate(populatedPaths)
    // Wave 2.11 â€” a platform admin posts against a single resource
    // (the booking): audit with the payment's agency. Only when no
    // selector was sent â€” the middleware already logged selector calls.
    if (user.type === bookcarsTypes.UserType.Admin) {
      await logAdminCrossAgencyAccess(req, [payment.supplier.toString()], 'payment:create')
    }
    res.status(201).json(statusRefresh ? { ...payment.toJSON(), statusRefresh } : payment)
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

// GH-02 / Wave 3.1 (money-build-plan §3.1) — money-reminder
// template keys: a "reminder" for a receivable row is a SENT delivery
// of one of these for the booking. The overdue repeat / escalate keys
// (GH-03) count too; the pending-refund key does not (that is a
// cancelled booking, never a receivable row).
const MONEY_REMINDER_TEMPLATE_KEYS = [
  'auto.overdue',
  'auto.confirmedUnpaid',
  'auto.holdExpiring',
  'auto.paymentDue',
  'auto.missedPickup',
  'auto.overdueEscalate',
] as bookcarsTypes.NotificationTemplateKey[]

export type ReceivablesFilter = 'all' | 'overdue' | 'due-soon' | 'confirmed-unpaid' | 'paid-unconfirmed' | 'holds-expiring' | 'paid-in-full' | 'age-current' | 'age-1-7' | 'age-8-30' | 'age-30-plus'

const RECEIVABLES_FILTERS: ReceivablesFilter[] = ['all', 'overdue', 'due-soon', 'confirmed-unpaid', 'paid-unconfirmed', 'holds-expiring', 'paid-in-full', 'age-current', 'age-1-7', 'age-8-30', 'age-30-plus']

export type ReceivableAgeBucket = 'current' | '1-7' | '8-30' | '30+'

// GH-02 — the extended receivable row. The shared
// bookcarsTypes.OverdueReceivableRow gains these fields in the
// optional types script (edit-gh02-types-optional.py); until then this
// local extension keeps the backend compiling with no packages change.
export interface ReceivableRow extends bookcarsTypes.OverdueReceivableRow {
  daysOverdue: number
  paymentDueAt?: Date
  daysToPaymentDue: number | null
  depositHeld: number
  lastRemindedAt?: Date
  reminderCount: number
  paidInFull: boolean
  paidRent: number
  // R5-08 — overpaid rent (ledger definition), 0 when none.
  overpaidAmount: number
  contractTotal: number
  ageBucket: ReceivableAgeBucket
  lifecycle?: bookcarsTypes.ContractLifecycle
  status?: bookcarsTypes.BookingStatus
  pickupAt?: Date
  holdExpiresAt?: Date
  actions: { canTakePayment: boolean, canConfirm: boolean, canCancel: boolean, canMarkNoShow: boolean }
}

const receivableStartOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

const receivableAgeBucket = (daysOverdue: number): ReceivableAgeBucket => (
  daysOverdue <= 0 ? 'current' : daysOverdue <= 7 ? '1-7' : daysOverdue <= 30 ? '8-30' : '30+'
)

// R4-02 — split a checkout snapshot into the rent/deposit legs the
// provider took. Same three branches as bookingController's
// splitProviderCheckoutAmounts, but it must not 500 the receivables
// page on a bad snapshot — and it must not invent plausible legs
// either. R5-02: on an invariant violation (the cases the original
// throws on) return zero legs, so the Void-hold row falls back to
// the ledger figures: paidRent / depositHeld stay at the posted
// amounts and the outstanding stays full. A wrong-but-plausible
// figure is worse than an obviously-unpreviewed one.
const splitCheckoutLegs = (snapshot?: bookcarsTypes.BookingFinancialSnapshot | null): { rent: number, deposit: number } => {
  if (!snapshot) return { rent: 0, deposit: 0 }
  const amountDueNow = Number(snapshot.amountDueNow || 0)
  const rentalTotal = Number(snapshot.rentalTotal || 0)
  const depositAmount = Number(snapshot.depositAmount || 0)
  if (snapshot.mode === bookcarsTypes.CheckoutPaymentMode.Deposit) {
    // R5-02 — the original throws when amountDueNow exceeds the
    // deposit amount: a snapshot that violates it is inconsistent,
    // so fall back to the ledger figures (zero legs) instead of
    // clamping to a plausible-but-wrong deposit leg.
    if (amountDueNow > depositAmount) return { rent: 0, deposit: 0 }
    return { rent: 0, deposit: Math.max(0, Math.min(amountDueNow, depositAmount)) }
  }
  if (snapshot.mode === bookcarsTypes.CheckoutPaymentMode.Full) {
    // R5-02 — same: amountDueNow below the rental total (or the
    // remainder above the deposit) means the snapshot cannot be
    // split; zero legs, ledger figures stand.
    if (amountDueNow < rentalTotal || amountDueNow - rentalTotal > depositAmount) return { rent: 0, deposit: 0 }
    return { rent: rentalTotal, deposit: Math.max(0, Math.min(amountDueNow - rentalTotal, depositAmount)) }
  }
  return { rent: amountDueNow, deposit: 0 }
}

export const overdue = async (req: Request, res: Response) => {
  try {
    const now = new Date()
    const filter = typeof req.query.filter === 'string' && req.query.filter ? req.query.filter : 'all'
    if (!RECEIVABLES_FILTERS.includes(filter as ReceivablesFilter)) {
      res.status(400).send('Invalid receivables filter')
      return
    }
    const clientId = typeof req.query.clientId === 'string' && req.query.clientId ? req.query.clientId : undefined
    if (clientId && !mongoose.isValidObjectId(clientId)) {
      res.status(400).send('Invalid client filter')
      return
    }
    const bookings = await Booking.find({
      ...getScope(req),
      status: { $nin: [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled] },
      deletedAt: null,
    })
      .select('_id reference price financialSnapshot from to lifecycle status expireAt confirmedAt noShowAt car driver supplier')
      .populate([{ path: 'car', select: 'name licensePlate' }, { path: 'driver', select: 'fullName email phone' }])
      .sort({ to: 1 })
      .lean()
    // One delivery-log read for every row: last sent money reminder
    // + how many were sent (the chase history, no new stored fields).
    const bookingIds = bookings.map((booking) => String(booking._id))
    const reminderRows = bookingIds.length > 0 ? await NotificationDelivery.find({
      subjectType: 'booking',
      subjectId: { $in: bookingIds },
      templateKey: { $in: MONEY_REMINDER_TEMPLATE_KEYS },
      status: 'sent',
    }).select('subjectId sentAt').lean() : []
    const remindersByBooking = new Map<string, { lastRemindedAt?: Date, reminderCount: number }>()
    for (const delivery of reminderRows) {
      const key = String(delivery.subjectId)
      const entry = remindersByBooking.get(key) || { lastRemindedAt: undefined, reminderCount: 0 }
      entry.reminderCount += 1
      const sentAt = delivery.sentAt ? new Date(delivery.sentAt) : undefined
      if (sentAt && (!entry.lastRemindedAt || sentAt.getTime() > entry.lastRemindedAt.getTime())) {
        entry.lastRemindedAt = sentAt
      }
      remindersByBooking.set(key, entry)
    }
    const rows: ReceivableRow[] = []
    const paidInFullRows: ReceivableRow[] = []
    // One row builder shared by the live bookings and the Void holds
    // below, so the two lists cannot drift apart. The builder reports
    // the LEDGER figures; Void-hold rows override them afterwards
    // (provider legs added — see below).
    const buildReceivableRow = async (
      booking: (typeof bookings)[number],
      reminders: { lastRemindedAt?: Date, reminderCount: number },
    ): Promise<ReceivableRow> => {
      const receivable = await getContractReceivable(booking as unknown as Parameters<typeof getContractReceivable>[0])
      const depositDue = Math.max(0, round2(receivable.refundableDeposit - receivable.depositPayments))
      const depositHeld = round2(receivable.depositPayments)
      const dueAt = receivable.dueAt ? new Date(receivable.dueAt) : undefined
      const daysOverdue = receivable.overdue && dueAt
        ? Math.max(0, Math.floor((receivableStartOfDay(now).getTime() - receivableStartOfDay(dueAt).getTime()) / 86400000))
        : 0
      // §3.1 — TWO due dates, not one: the payment due date is the
      // hold deadline for a pay-later hold, the pickup day for an
      // unpaid booking whose pickup is still ahead, else the shared
      // dueAt (rental end / completion). Without it the most urgent
      // receivables (unpaid pickups today/tomorrow) never age.
      const expireAt = (booking as unknown as { expireAt?: Date | string | null }).expireAt
        ? new Date((booking as unknown as { expireAt: Date | string }).expireAt) : undefined
      const from = booking.from ? new Date(booking.from) : undefined
      const paymentDueAt = expireAt
        ? expireAt
        : (receivable.outstandingBalance > 0 && from && from.getTime() > now.getTime() ? from : dueAt)
      const daysToPaymentDue = paymentDueAt
        ? Math.floor((receivableStartOfDay(paymentDueAt).getTime() - receivableStartOfDay(now).getTime()) / 86400000)
        : null
      const lifecycle = (booking.lifecycle || bookcarsTypes.ContractLifecycle.Draft) as bookcarsTypes.ContractLifecycle
      const status = booking.status as bookcarsTypes.BookingStatus
      const noShowAt = (booking as unknown as { noShowAt?: Date | string | null }).noShowAt
      const row: ReceivableRow = {
        booking: booking as unknown as bookcarsTypes.Booking,
        outstandingBalance: receivable.outstandingBalance,
        depositDue,
        depositHeld,
        dueAt,
        overdue: receivable.overdue,
        currency: receivable.currency,
        daysOverdue,
        paymentDueAt,
        daysToPaymentDue,
        lastRemindedAt: reminders.lastRemindedAt,
        reminderCount: reminders.reminderCount,
        // Paid in full means nothing is owed at all (rent AND deposit
        // collected). A rent-paid / deposit-due row is still listed in
        // paidInFullRows (its rent is paid in full) with the deposit
        // due visible — it must not vanish from every list.
        paidInFull: receivable.outstandingBalance <= 0 && depositDue <= 0,
        paidRent: round2(receivable.postedPayments),
        // R5-08 — copy the ledger's overpaidAmount onto the row (was
        // computed by getContractReceivable but dropped here, so an
        // overpaid hold showed outstandingBalance 0 with paidRent above
        // the contract total and the manager had to subtract by hand).
        overpaidAmount: round2(receivable.overpaidAmount),
        contractTotal: round2(receivable.rentalTotalInclVat + receivable.approvedCharges),
        ageBucket: receivableAgeBucket(daysOverdue),
        lifecycle,
        status,
        pickupAt: from,
        holdExpiresAt: expireAt,
        // The actions already exist; the endpoint only exposes what
        // the UI needs to show them. canCancel mirrors the staff-cancel
        // guard (pre-handover only); canMarkNoShow mirrors markNoShow
        // (Draft/Confirmed, unpaid, pickup passed, not already marked).
        actions: {
          canTakePayment: receivable.outstandingBalance > 0,
          canConfirm: lifecycle === bookcarsTypes.ContractLifecycle.Draft && status === bookcarsTypes.BookingStatus.Pending,
          canCancel: lifecycle === bookcarsTypes.ContractLifecycle.Draft || lifecycle === bookcarsTypes.ContractLifecycle.Confirmed,
          canMarkNoShow: (lifecycle === bookcarsTypes.ContractLifecycle.Draft || lifecycle === bookcarsTypes.ContractLifecycle.Confirmed)
            && status === bookcarsTypes.BookingStatus.Pending && !!from && from.getTime() <= now.getTime() && !noShowAt,
        },
      }
      return row
    }
    for (const booking of bookings) {
      // ?clientId= filters by the booking's driver.
      const driver = booking.driver as unknown as { _id?: unknown } | string | null | undefined
      const driverId = typeof driver === 'object' && driver !== null ? String(driver._id || '') : String(driver || '')
      if (clientId && driverId !== clientId) {
        continue
      }
      const reminders = remindersByBooking.get(String(booking._id)) || { lastRemindedAt: undefined, reminderCount: 0 }
      const row = await buildReceivableRow(booking, reminders)
      if (row.outstandingBalance > 0) {
        rows.push(row)
      } else if (row.lifecycle !== bookcarsTypes.ContractLifecycle.Completed) {
        // Completed contracts are history, not receivables: a paid
        // Completed booking belongs to reports, not to this chase.
        paidInFullRows.push(row)
      }
    }
    // R4-02 / R3-01 follow-on — Void holds are the review queue's
    // other half: a checkout placeholder the provider took money for
    // but whose finalisation conflicted (or whose refund failed, or
    // whose provider was unreachable — R4-01/R4-03 defuse the same
    // way). The main query excludes Void, so they need their own
    // narrow query — and their own list, so no other filter ever
    // sees them: only the paid-unconfirmed case merges them in.
    // The gate is 'deadline extended beyond the normal checkout
    // fuse': a live checkout's expireAt is at most BOOKING_EXPIRE_AT
    // (~70 min) out and a never-swept placeholder's is already past,
    // while a sweeper-held booking's is ~7 days out
    // (HELD_BOOKING_REVIEW_EXPIRE_AT). Two known approximations,
    // both resolved by the retry (which re-verifies at the provider):
    // (1) the last ~70 min of a hold window read as 'not held' until
    // the sweeper re-holds it; (2) a provider-error hold's figures
    // assume the provider payment (unverified until the retry).
    // The figures preview the post-finalise ledger: the ledger has
    // no legs (finalisation posts them only after the availability
    // save succeeds), so the provider legs are added to the posted
    // figures and the outstanding is reduced by the provider rent
    // leg. Deposit mode: the provider took the deposit only, so the
    // rent stays outstanding and collectible (canTakePayment).
    const voidHoldRows: ReceivableRow[] = []
    const voidHoldBookings = await Booking.find({
      ...getScope(req),
      status: bookcarsTypes.BookingStatus.Void,
      lifecycle: bookcarsTypes.ContractLifecycle.Draft,
      expireAt: { $gt: new Date(now.getTime() + env.BOOKING_EXPIRE_AT * 1000) },
      financialSnapshot: { $exists: true },
      $or: [
        { sessionId: { $regex: '^cs_' } },
        { paymentIntentId: { $nin: [null, ''] } },
        { paypalOrderId: { $nin: [null, ''] } },
      ],
      deletedAt: null,
    })
      // R5-05 — the hold reason the sweeper stamped at defuse time.
      .select('_id reference price financialSnapshot from to lifecycle status expireAt confirmedAt noShowAt car driver supplier reconciliationStatus holdDetail')
      .populate([{ path: 'car', select: 'name licensePlate' }, { path: 'driver', select: 'fullName email phone' }])
      .sort({ to: 1 })
      .lean()
    for (const booking of voidHoldBookings) {
      // ?clientId= filters by the booking's driver.
      const driver = booking.driver as unknown as { _id?: unknown } | string | null | undefined
      const driverId = typeof driver === 'object' && driver !== null ? String(driver._id || '') : String(driver || '')
      if (clientId && driverId !== clientId) {
        continue
      }
      const row = await buildReceivableRow(booking, { lastRemindedAt: undefined, reminderCount: 0 })
      const snapshot = booking.financialSnapshot as unknown as bookcarsTypes.BookingFinancialSnapshot | undefined
      const legs = splitCheckoutLegs(snapshot)
      row.paidRent = round2(row.paidRent + legs.rent)
      row.depositHeld = round2(row.depositHeld + legs.deposit)
      row.depositDue = Math.max(0, round2(Number(snapshot?.depositAmount || 0) - row.depositHeld))
      row.outstandingBalance = Math.max(0, round2(row.outstandingBalance - legs.rent))
      row.paidInFull = row.outstandingBalance <= 0 && row.depositDue <= 0
      // R5-05 — surface the hold reason on the row, so the queue can
      // triage it. Older held rows (stamped before this release) carry
      // no reason and show none, which is the honest state.
      const hold = booking as unknown as { reconciliationStatus?: string, holdDetail?: string }
      if (hold.reconciliationStatus) {
        row.holdReason = hold.reconciliationStatus
        row.holdDetail = hold.holdDetail
      }
      // R5-08 — the row keeps the LEDGER overpaidAmount (0 here: no legs
      // are posted until finalisation). Do NOT recompute it from the
      // previewed figures: the ledger definition nets only rent legs +
      // charge credits against rental total + approved charges + VAT
      // (contractReceivable.ts), while deposits are never netted against
      // rent — max(0, paidRent + depositHeld - contractTotal - depositDue)
      // would misstate it.
      // R5-04 — the rent on a Void hold becomes collectible only after
      // the retry confirms the booking: postWithinSession refuses Void
      // bookings, so offering TAKE_PAYMENT here is a dead end (the save
      // fails with "Rental contract not found"). The retry button is the
      // action on this row; take payment appears once the booking is Paid.
      row.actions.canTakePayment = false
      row.actions.canConfirm = false
      voidHoldRows.push(row)
    }
    // Filters apply to the outstanding rows; a filtered view shows
    // only matching outstanding rows (paid-in-full rows are returned
    // only for filter=all and filter=paid-in-full).
    let filteredRows = rows
    let filteredPaidInFullRows = paidInFullRows
    switch (filter as ReceivablesFilter) {
      case 'overdue':
        filteredRows = rows.filter((row) => row.overdue)
        filteredPaidInFullRows = []
        break
      case 'due-soon':
        filteredRows = rows.filter((row) => row.daysToPaymentDue !== null && row.daysToPaymentDue >= 0 && row.daysToPaymentDue <= 1)
        filteredPaidInFullRows = []
        break
      case 'confirmed-unpaid':
        filteredRows = rows.filter((row) => row.lifecycle === bookcarsTypes.ContractLifecycle.Confirmed && row.outstandingBalance > 0)
        filteredPaidInFullRows = []
        break
      case 'paid-unconfirmed':
        // GH-32 — fully-paid Draft holds (refresh failed) live in the
        // paid-in-full rows, not the outstanding rows: serve them here
        // so the receivables tab can show + retry them.
        // R4-02 / R3-01 follow-on — Void holds (provider-paid,
        // finalisation conflicted) join them: the queue is the review
        // surface for held bookings, and the retry button on each row
        // re-runs the provider reconcile. Void holds live in their own
        // list so no other filter ever sees them.
        filteredRows = [
          ...paidInFullRows.filter((row) => row.lifecycle === bookcarsTypes.ContractLifecycle.Draft && row.status === bookcarsTypes.BookingStatus.Pending),
          ...voidHoldRows,
        ]
        filteredPaidInFullRows = []
        break
      case 'holds-expiring':
        // R5-10 — Void holds join the expiring list: their holdExpiresAt
        // is the sweeper's review deadline (carried by buildReceivableRow),
        // and a hold in its last 24 h belongs here as much as a pay-later
        // hold does. (The paid-unconfirmed queue still shows them too.)
        filteredRows = [...rows, ...voidHoldRows].filter((row) => !!row.holdExpiresAt
          && row.holdExpiresAt.getTime() > now.getTime()
          && row.holdExpiresAt.getTime() <= now.getTime() + 24 * 60 * 60 * 1000)
        filteredPaidInFullRows = []
        break
      case 'paid-in-full':
        filteredRows = []
        break
      case 'age-current':
        filteredRows = rows.filter((row) => row.ageBucket === 'current')
        filteredPaidInFullRows = []
        break
      case 'age-1-7':
        filteredRows = rows.filter((row) => row.ageBucket === '1-7')
        filteredPaidInFullRows = []
        break
      case 'age-8-30':
        filteredRows = rows.filter((row) => row.ageBucket === '8-30')
        filteredPaidInFullRows = []
        break
      case 'age-30-plus':
        filteredRows = rows.filter((row) => row.ageBucket === '30+')
        filteredPaidInFullRows = []
        break
      default:
        break
    }
    // Default sort: age-desc (oldest money first), outstanding as
    // tie-break. Paid-in-full rows sort by pickup ascending.
    filteredRows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstandingBalance - a.outstandingBalance)
    filteredPaidInFullRows.sort((a, b) => (a.pickupAt?.getTime() || 0) - (b.pickupAt?.getTime() || 0) || b.contractTotal - a.contractTotal)
    res.json({
      metricDictionaryVersion: METRIC_DICTIONARY_VERSION,
      rows: filteredRows,
      paidInFullRows: filteredPaidInFullRows,
      // R2-B04 - the summary totals are filter-independent: they are
      // the agency's outstanding / overdue money, not the current
      // view's. A filtered view (paid-in-full, due-soon, an age
      // bucket) must never zero the OVERDUE card. The rows stay
      // filtered; only the totals read the unfiltered collections.
      // (Still scoped by ?clientId=: the driver check runs before the
      // rows are built, so a client-filtered view totals that client.)
      outstandingTotal: round2(rows.reduce((sum, row) => sum + row.outstandingBalance, 0)),
      overdueTotal: round2(rows.filter((row) => row.overdue).reduce((sum, row) => sum + row.outstandingBalance, 0)),
      // R2-B16 - the count is the paid-in-full FLAG, not the list
      // length: a rent-paid / deposit-due row is listed (so it does
      // not vanish) but it still owes a deposit. rentPaidCount is the
      // list length, kept so the tab's row count still has a name.
      paidInFullCount: filteredPaidInFullRows.filter((row) => row.paidInFull).length,
      rentPaidCount: filteredPaidInFullRows.length,
    })
  } catch (err) {
    logger.error(`[rentalPayment.overdue] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

// GH-11 — pending refunds: money the agency owes back. One row per
// Cancelled booking whose cancellationRecord.refundStatus is
// 'pending' (a wire refund with no bank movement, or a `manual`
// refund decision). Amounts come from the cancellation record — the
// audit trail of the cancel — never recomputed from live payments.
// The reminder until resolved is the auto pass's pending-refund event
// (autoReminders.ts), owner-only. Q20 (a configurable/different
// owner) stays open; the owner here is the agency owner.
export interface PendingRefundRow {
  booking: bookcarsTypes.Booking
  amount: number
  currency: string
  method: bookcarsTypes.RentalPaymentMethod | null
  methods: Array<{ method: bookcarsTypes.RentalPaymentMethod, amount: number }>
  reason: string
  since?: Date
  refundDecision: bookcarsTypes.CancelRefundDecision
  wireRefundPending: boolean
  rentPaid: number
  depositPaid: number
  refundedRent: number
  refundedDeposit: number
}

export const pendingRefunds = async (req: Request, res: Response) => {
  try {
    const bookings = await Booking.find({
      ...getScope(req),
      status: bookcarsTypes.BookingStatus.Cancelled,
      'cancellationRecord.refundStatus': 'pending',
      deletedAt: null,
    })
      .select('_id reference price financialSnapshot to lifecycle status car driver supplier cancellationRecord')
      .populate([{ path: 'car', select: 'name licensePlate' }, { path: 'driver', select: 'fullName email phone' }])
      .sort({ 'cancellationRecord.cancelledAt': 1 })
      .lean()
    const rows: PendingRefundRow[] = []
    for (const booking of bookings) {
      const record = (booking as unknown as { cancellationRecord?: {
        reason?: string, cancelledAt?: Date, refundDecision?: bookcarsTypes.CancelRefundDecision,
        rentPaid?: number, depositPaid?: number, refundedRent?: number, refundedDeposit?: number,
      } }).cancellationRecord
      if (!record) {
        continue
      }
      const rentPaid = Number(record.rentPaid || 0)
      const depositPaid = Number(record.depositPaid || 0)
      const refundedRent = Number(record.refundedRent || 0)
      const refundedDeposit = Number(record.refundedDeposit || 0)
      const amount = round2(Math.max(0, rentPaid + depositPaid - refundedRent - refundedDeposit))
      if (amount <= 0) {
        continue
      }
      const receivable = await getContractReceivable(booking as unknown as Parameters<typeof getContractReceivable>[0])
      // The refund most likely follows the largest posted leg; the
      // full per-method split is returned alongside it.
      const posted = await RentalPayment.find({
        booking: booking._id,
        status: bookcarsTypes.RentalPaymentStatus.Posted,
        direction: { $ne: bookcarsTypes.RentalPaymentDirection.Debit },
      }).select('method amount').lean()
      const byMethod = new Map<bookcarsTypes.RentalPaymentMethod, number>()
      for (const payment of posted) {
        const method = payment.method as bookcarsTypes.RentalPaymentMethod
        byMethod.set(method, (byMethod.get(method) || 0) + Number(payment.amount || 0))
      }
      const methods = [...byMethod.entries()]
        .map(([method, total]) => ({ method, amount: round2(total) }))
        .sort((a, b) => b.amount - a.amount)
      // Wire-pending, exactly as executeStaffCancel flags it: a
      // `full`-decision wire reversal with no bank movement.
      let wireRefundPending = false
      if (record.refundDecision === 'full') {
        const reversals = await RentalPayment.find({
          booking: booking._id,
          status: bookcarsTypes.RentalPaymentStatus.Posted,
          direction: bookcarsTypes.RentalPaymentDirection.Debit,
          method: bookcarsTypes.RentalPaymentMethod.BankTransfer,
        }).select('_id').lean()
        for (const reversal of reversals) {
          if (!(await CashMovement.exists({ rentalPayment: reversal._id }))) {
            wireRefundPending = true
            break
          }
        }
      }
      rows.push({
        booking: booking as unknown as bookcarsTypes.Booking,
        amount,
        currency: receivable.currency,
        method: methods[0]?.method ?? null,
        methods,
        reason: record.reason || '',
        since: record.cancelledAt,
        refundDecision: record.refundDecision || 'manual',
        wireRefundPending,
        rentPaid,
        depositPaid,
        refundedRent,
        refundedDeposit,
      })
    }
    res.json({
      rows,
      count: rows.length,
      total: round2(rows.reduce((sum, row) => sum + row.amount, 0)),
      currency: rows[0]?.currency || env.BASE_CURRENCY.toUpperCase(),
    })
  } catch (err) {
    logger.error(`[rentalPayment.pendingRefunds] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

// R3-12 — true when err is a duplicate-key error from the idempotencyKey
// unique index (a concurrent double-link whose save collided after the
// winner's movement landed). Mirrors carController's isDuplicatePlateError.
const isDuplicateKeyError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return false
  }
  const { code, keyPattern } = err as { code?: number, keyPattern?: Record<string, unknown> }
  if (code !== 11000) {
    return false
  }
  return !keyPattern || 'idempotencyKey' in keyPattern
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
    // R3-12 — a concurrent double-link: the loser's save hit the unique
    // idempotencyKey index after the winner's movement landed. The link
    // exists — re-read it and return it (200), not a spurious 400.
    // `payment` is scoped inside the try, so re-fetch it here.
    if (isDuplicateKeyError(err)) {
      const racedPayment = await RentalPayment.findOne({ _id: req.params.id, ...getScope(req) })
      const movement = racedPayment ? await CashMovement.findOne({ rentalPayment: racedPayment._id }) : null
      if (movement && racedPayment) {
        logger.info('[rentalPayment.linkCashSession] duplicate link raced; returning existing movement')
        await racedPayment.populate(populatedPaths)
        res.json({ payment: racedPayment, movement })
        return
      }
    }
    logger.error(`[rentalPayment.linkCashSession] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

// Wave 2.6 — the bank mirror of linkCashSession: manually link a posted
// bank-transfer payment into a chosen open Bank session: the repair
// path for payments posted while no Bank session was open. A payment
// that already has a drawer movement is refused (409) — the link is
// single, never duplicated. Non-wire or non-posted payments cannot
// link (409).
export const linkBankSession = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const sessionId = typeof req.body?.bankSessionId === 'string' ? req.body.bankSessionId : ''
    if (!user || !mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(sessionId)) {
      res.status(400).send('Invalid bank session link')
      return
    }
    const payment = await RentalPayment.findOne({ _id: req.params.id, ...getScope(req) })
    if (!payment) {
      res.sendStatus(404)
      return
    }
    if (payment.method !== bookcarsTypes.RentalPaymentMethod.BankTransfer || payment.status !== bookcarsTypes.RentalPaymentStatus.Posted) {
      res.status(409).send('Only a posted bank-transfer payment can be linked to a bank session')
      return
    }
    const existing = await CashMovement.findOne({ rentalPayment: payment._id }).select('_id session')
    if (existing) {
      res.status(409).send('This payment is already linked to a bank session')
      return
    }
    const session = await CashSession.findOne({ _id: sessionId, supplier: payment.supplier, account: bookcarsTypes.CashAccountType.Bank, status: bookcarsTypes.CashSessionStatus.Open })
    if (!session) {
      res.status(404).send('Open bank session not found')
      return
    }
    if (session.currency !== payment.currency) {
      res.status(409).send('Bank session currency does not match the payment currency')
      return
    }
    const movement = await linkLedgerBankPayment(payment, undefined, session._id)
    if (!movement) {
      res.status(409).send('Bank payment could not be linked to the bank session')
      return
    }
    await payment.populate(populatedPaths)
    res.json({ payment, movement })
  } catch (err) {
    // R3-12 — a concurrent double-link: the loser's save hit the unique
    // idempotencyKey index after the winner's movement landed. The link
    // exists — re-read it and return it (200), not a spurious 400.
    // `payment` is scoped inside the try, so re-fetch it here.
    if (isDuplicateKeyError(err)) {
      const racedPayment = await RentalPayment.findOne({ _id: req.params.id, ...getScope(req) })
      const movement = racedPayment ? await CashMovement.findOne({ rentalPayment: racedPayment._id }) : null
      if (movement && racedPayment) {
        logger.info('[rentalPayment.linkBankSession] duplicate link raced; returning existing movement')
        await racedPayment.populate(populatedPaths)
        res.json({ payment: racedPayment, movement })
        return
      }
    }
    logger.error(`[rentalPayment.linkBankSession] ${i18n.t('ERROR')}`, err)
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
      // R2-B18 (option a) — dictionary v2026-11-11.1/11.2: unexpired
      // checkout placeholders (expireAt set) are excluded from the
      // dashboard/collections universe. A confirmed booking has
      // expireAt cleared (confirmReservation), so it stays included.
      expireAt: null,
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
    // Wave 2.4 — posted Charge credits per booking (kept deposit
    // settling approved charges); they reduce `remaining` exactly as
    // contractReceivable does (collected stays posted rent only).
    const chargeByBooking = new Map<string, number>()
    for (const row of paymentRows as Array<{ _id: { booking: mongoose.Types.ObjectId, purpose: string }, total: number }>) {
      if (row._id.purpose === bookcarsTypes.RentalPaymentPurpose.Rent) {
        rentByBooking.set(row._id.booking.toString(), Number(row.total || 0))
      } else if (row._id.purpose === bookcarsTypes.RentalPaymentPurpose.Charge) {
        chargeByBooking.set(row._id.booking.toString(), Number(row.total || 0))
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
      const chargeCredits = Number(chargeByBooking.get(booking._id.toString()) || 0)
      contractAmount += amount
      collected += paid
      // Per-booking minor-unit clamp, exactly as contractReceivable
      // (Wave 2.4: minus posted Charge credits — a charge settled from
      // the kept deposit is paid, not remaining).
      remaining += Math.max(0, toMinorUnits(amount, currency) - toMinorUnits(paid, currency) - toMinorUnits(chargeCredits, currency)) / (10 ** exponent)
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
