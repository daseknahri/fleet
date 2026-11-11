import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import RentalPayment from '../models/RentalPayment'
import Booking from '../models/Booking'
import ContractCharge from '../models/ContractCharge'
import { LedgerError, confirmRentalPayment, postRentalPayment, reverseRentalPayment } from '../utils/ledger'
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
    const payments = await RentalPayment.find(getScope(req)).sort({ date: -1, createdAt: -1 }).populate(populatedPaths)
    res.json(payments)
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
    const idempotencyKey = typeof payload?.idempotencyKey === 'string' ? payload.idempotencyKey.trim() : undefined
    const providerReference = typeof payload?.providerReference === 'string' ? payload.providerReference.trim() : undefined
    if (!user || !mongoose.isValidObjectId(payload?.booking) || Number.isNaN(date.getTime())
      || !Number.isFinite(amount) || amount <= 0
      || !Object.values(bookcarsTypes.RentalPaymentMethod).includes(payload.method)
      || (payload.purpose !== undefined && !Object.values(bookcarsTypes.RentalPaymentPurpose).includes(payload.purpose))
      || reference.length > 160 || note.length > 1000
      || (idempotencyKey !== undefined && (idempotencyKey.length < 8 || idempotencyKey.length > 200))
      || (providerReference !== undefined && providerReference.length > 200)) {
      res.status(400).send('Invalid rental payment')
      return
    }

    const supplierId = agencySupplierId(req)
    // Owner decision 1.5 (GA-P10-DECISIONS-01): entries recorded by a
    // counter agent stay pending until an accountant or above confirms
    // them; every other recorder posts immediately, as before.
    const pendingEntry = req.agency?.role === bookcarsTypes.AgencyRole.CounterAgent
    const payment = await postRentalPayment({
      bookingId: payload.booking,
      supplierId: user.type === bookcarsTypes.UserType.Admin ? undefined : supplierId,
      date,
      amount,
      currency: payload.currency,
      method: payload.method,
      status: pendingEntry ? bookcarsTypes.RentalPaymentStatus.Pending : undefined,
      purpose: payload.purpose || bookcarsTypes.RentalPaymentPurpose.Rent,
      idempotencyKey,
      providerReference,
      actorId: user._id,
      reference,
      note,
    })
    await payment.populate(populatedPaths)
    res.status(201).json(payment)
  } catch (err) {
    if (err instanceof LedgerError) {
      const status = err.code === 'BOOKING_NOT_FOUND' ? 404
        : err.code === 'DUPLICATE_IDEMPOTENCY_KEY' ? 409
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
    const payment = await RentalPayment.findOne({ _id: req.params.id, ...getScope(req) }).select('_id status')
    if (!payment) {
      res.sendStatus(404)
      return
    }
    if (payment.status !== bookcarsTypes.RentalPaymentStatus.Pending) {
      res.status(409).send('Only a pending payment entry can be confirmed')
      return
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
// collectionsSummary: the dictionary v2026-11-11.2 collections
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

export const collectionsSummary = async (req: Request, res: Response) => {
  try {
    const bookings = await Booking.find({
      ...getScope(req),
      status: { $nin: [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled] },
      expireAt: null,
    }).select('_id price financialSnapshot').lean()
    const bookingIds = bookings.map((b) => b._id)
    const [paymentRows, chargeRows] = await Promise.all([
      bookingIds.length > 0 ? RentalPayment.aggregate([
        { $match: { booking: { $in: bookingIds }, status: bookcarsTypes.RentalPaymentStatus.Posted } },
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
    contractAmount = round2(contractAmount)
    collected = round2(collected)
    remaining = round2(remaining)
    res.json({
      metricDictionaryVersion: METRIC_DICTIONARY_VERSION,
      currency: env.BASE_CURRENCY.toUpperCase(),
      contractAmount,
      collected,
      remaining,
      collectionRatePct: contractAmount === 0 ? null : round2((collected / contractAmount) * 100),
      bookingsCount: bookings.length,
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
