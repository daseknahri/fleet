import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as types from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import RentalPayment from '../models/RentalPayment'
import MaintenanceExpense from '../models/MaintenanceExpense'
import ContractCharge from '../models/ContractCharge'
import Invoice from '../models/Invoice'
import Car from '../models/Car'
import User from '../models/User'
import ReportView from '../models/ReportView'
import { renderCarPdf } from '../utils/carPdf'
import { agencySupplierId } from '../utils/agencyAuthorization'
import * as logger from '../utils/logger'

/*
 * METRIC DICTIONARY — v2026-11-11.2 (GA-PAR-17; previous v2026-11-11.1
 * GA-PAR-14; roadmap Phase 7 rule: dictionary first, then builders on
 * top of it).
 *
 * Established definitions (v2026-11-02.1, unchanged semantics — the
 * summary endpoint below keeps computing exactly these):
 * - Date ranges are inclusive and use Africa/Casablanca; a date-only
 *   bound covers that whole Casablanca local day.
 * - collected (summary scope) = posted RentalPayments only, signed by
 *   direction (debit negative), split by purpose; deposits are NEVER
 *   revenue and are never netted against rent.
 * - receivable (summary scope) = Σ financialSnapshot.rentalTotal
 *   (fallback `price`) over period-intersecting non-Void/non-Cancelled
 *   bookings − posted rent payments dated in the period.
 *
 * NEW definitions (v2026-11-11.1) for the reports builder, the builder
 * CSV, drill-down and the dashboard aggregate (GA-PAR-09 Phase B).
 * These do NOT fork the established semantics; they apply the
 * contractReceivable semantics per booking:
 * - contractAmount(booking) = financialSnapshot.rentalTotal (fallback
 *   `price`) + APPROVED ContractCharges for that booking in the
 *   booking's currency. PENDING (or rejected) charges NEVER count.
 * - collected(booking) = Σ posted RentalPayments of that booking with
 *   purpose rent (legacy purpose-less payments count as rent), signed
 *   by direction (debit negative), over ALL payment dates — a payment
 *   belongs to its contract, not to the day it was posted.
 * - remaining(booking) = max(0, contractAmount − collected), clamped
 *   per booking in the booking's currency exactly as
 *   contractReceivable does; period remaining = Σ per-booking
 *   remaining. Deposits are never revenue and never netted.
 * - Period attribution of MONEY and COUNTS is whole-contract: a
 *   booking counts in full in every period its [from,to] intersects
 *   (from < periodTo && to > periodFrom), excluding Void/Cancelled
 *   and unexpired checkout placeholders (expireAt set). No prorating.
 * - expenses = Σ MaintenanceExpense.amount for the agency (and the
 *   car, when car-scoped) with expense `date` inside the period.
 * - net = collected − expenses (NEW metric `netCollected` for builder
 *   rows/totals; the summary's estimatedMargin keeps its own
 *   established definition and is not this metric).
 * - per-car revenue = Σ contractAmount of the car's
 *   period-intersecting bookings; per-car collected / remaining are
 *   the same sums over the car's bookings; per-car expenses as above.
 * - per-car occupancy % is DAY-BASED by nature (unlike the
 *   whole-contract money attribution above — the two rules coexist
 *   deliberately and must not be mistaken for a fork): period days
 *   intersected by the car's non-cancelled bookings ÷ period days
 *   × 100, where intersected days use the established
 *   ceil((min(periodTo, booking.to) − max(periodFrom, booking.from))
 *   / 86400000) day count clamped at 0, and period days =
 *   ceil((periodTo − periodFrom) / 86400000), minimum 1.
 * - previous-period = the immediately preceding window of equal
 *   length: [from − (to − from), from). Deltas are absolute
 *   (current − previous) and percent ((current − previous) /
 *   previous × 100; null when previous is 0).
 * - Time grouping (day|week|month): a booking's money/counts are
 *   attributed to the bucket containing its FIRST intersected day
 *   (max(periodFrom, booking.from)); expenses to the bucket of their
 *   date. Buckets are Casablanca local days; week buckets start on
 *   Monday (key = the Monday's local date); month key = YYYY-MM.
 *   Occupancy inside a time bucket is day-based within that bucket,
 *   as defined above.
 *
 * NEW definitions (v2026-11-11.2, GA-PAR-17) — payments collections,
 * cash/bank channel scope and the per-car PDF. These reuse the
 * v2026-11-11.1 definitions above verbatim (contractAmount and
 * collected keep exactly their meanings); nothing established changes:
 * - Collections universe (Payments page summary): ALL of the agency's
 *   bookings excluding Void/Cancelled and unexpired checkout
 *   placeholders (expireAt set) — no period window; collections are a
 *   stock figure, not a period figure. (The Payments page's own
 *   receivables TABLE is a narrower overdue-only subset whose
 *   outstanding omits APPROVED charges; the collections summary is
 *   deliberately the full receivable universe under the dictionary
 *   definitions, matching contractReceivable / the builder.)
 * - collectionRate = collected ÷ contractAmount × 100 over the
 *   collections universe (contractAmount and collected as defined in
 *   v2026-11-11.1: contractAmount = snapshot rentalTotal, fallback
 *   price, + APPROVED charges; collected = posted rent only, all
 *   payment dates, signed by direction). The rate is null when
 *   contractAmount = 0 (never NaN). Collections `remaining` = Σ
 *   per-booking remaining (each clamped at 0 per booking, as above) —
 *   it can therefore differ from contractAmount − collected when a
 *   booking is overpaid.
 * - Channel scope (builder + dashboard summary): every RentalPayment
 *   carries a `method`. Scope mapping: method `cash` → cash scope;
 *   methods `bankTransfer` and `card` → bank scope (card settles
 *   through the banking system; provider payments are recorded with
 *   method `card` by the ledger); method `other` — and any legacy
 *   payment without a method — belongs to NEITHER scope (its channel
 *   cannot be determined honestly). Scope filters COLLECTED (and the
 *   payment-derived figures net and remaining, which follow from it)
 *   by channel; contractAmount and expenses are NOT
 *   channel-dimensioned and stay constant across scopes. Scope `all`
 *   (the default) = every payment, exactly the v2026-11-11.1 figures.
 *   cash collected + bank collected + neither-scope collected =
 *   all-scope collected.
 * - Per-car PDF (GET /api/reports/car/:carId/pdf): the car's figures
 *   for the period are the builder's car-scope figures for that car,
 *   computed by the same computePeriod core (contractAmount,
 *   collected, remaining, expenses, netCollected, bookingsCount,
 *   occupancyPct) — no second maths path; the document is rendered
 *   on demand and never stored.
 */

export const METRIC_DICTIONARY_VERSION = '2026-11-11.2'

const round = (n: number) => Number(n.toFixed(2))
const date = (value: unknown, fallback: Date) => {
  if (value === undefined || value === '') {
    return fallback
  }
  const raw = String(value)
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const casablancaDayStart = (yyyyMmDd: string) => {
  const utcGuess = new Date(`${yyyyMmDd}T00:00:00.000Z`).getTime()
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Casablanca', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t))
    const p: Record<string, number> = {}
    for (const part of parts) {
      if (part.type !== 'literal') {
        p[part.type] = Number(part.value)
      }
    }
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000
  }
  const firstPass = utcGuess - offsetAt(utcGuess)
  return new Date(utcGuess - offsetAt(firstPass))
}
const supplierFor = (req: Request) => {
  const raw = req.user?.type === types.UserType.Admin ? req.query.supplier : agencySupplierId(req)
  return typeof raw === 'string' && mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(raw) : null
}
const escapeCsv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const makeCsv = (rows: Array<Record<string, unknown>>) => {
  const keys = Object.keys(rows[0] || {})
  return [keys.join(','), ...rows.map((row) => keys.map((k) => escapeCsv(row[k])).join(','))].join('\r\n') + '\r\n'
}

const resolveRange = (query: Request['query']) => {
  const now = new Date()
  const fromRaw = typeof query.from === 'string' ? query.from : ''
  const toRaw = typeof query.to === 'string' ? query.to : ''
  const from = DATE_ONLY.test(fromRaw) ? casablancaDayStart(fromRaw) : date(query.from, new Date(now.getFullYear(), now.getMonth(), 1))
  const to = DATE_ONLY.test(toRaw) ? new Date(casablancaDayStart(toRaw).getTime() + 86400000 - 1) : date(query.to, now)
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new Error('Invalid range')
  }
  return { from, to }
}

const build = async (req: Request) => {
  const supplier = supplierFor(req)
  if (!supplier) {
    return null
  }
  const { from, to } = resolveRange(req.query)
  const [payments, expenses, bookings, fleet, invoices] = await Promise.all([
    RentalPayment.aggregate([{ $match: { supplier, date: { $gte: from, $lte: to }, status: types.RentalPaymentStatus.Posted } }, { $group: { _id: '$purpose', total: { $sum: { $cond: [{ $eq: ['$direction', types.RentalPaymentDirection.Debit] }, { $multiply: ['$amount', -1] }, '$amount'] } } } }]),
    MaintenanceExpense.aggregate([{ $match: { supplier, date: { $gte: from, $lte: to } } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Booking.find({ supplier, from: { $lt: to }, to: { $gt: from }, status: { $nin: [types.BookingStatus.Void, types.BookingStatus.Cancelled] } }).select('_id from to price financialSnapshot').lean(),
    Car.countDocuments({ supplier }),
    Invoice.aggregate([{ $match: { supplier, status: { $ne: types.InvoiceStatus.Voided }, createdAt: { $gte: from, $lte: to } } }, { $group: { _id: null, total: { $sum: '$total' }, paid: { $sum: '$paidAmount' }, count: { $sum: 1 } } }]),
  ])
  const rent = Number(payments.find((x) => x._id === types.RentalPaymentPurpose.Rent)?.total || 0)
  const deposit = Number(payments.find((x) => x._id === types.RentalPaymentPurpose.Deposit)?.total || 0)
  const expense = Number(expenses[0]?.total || 0)
  const rentalTotal = bookings.reduce((s, b) => s + Number(b.financialSnapshot?.rentalTotal || b.price || 0), 0)
  const receivable = Math.max(0, rentalTotal - rent)
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000))
  const bookedDays = bookings.reduce((s, b) => s + Math.max(0, Math.ceil((Math.min(to.getTime(), new Date(b.to).getTime()) - Math.max(from.getTime(), new Date(b.from).getTime())) / 86400000)), 0)
  const capacity = Math.max(1, fleet * days)
  const metrics = { contracts: bookings.length, fleetVehicles: fleet, revenueCollected: round(rent), depositsCollected: round(deposit), expenses: round(expense), receivable: round(receivable), bookedVehicleDays: bookedDays, fleetCapacityDays: capacity, utilizationPercent: round(bookedDays / capacity * 100), invoiceCount: invoices[0]?.count || 0, invoicedTotal: round(invoices[0]?.total || 0), invoicedPaid: round(invoices[0]?.paid || 0), estimatedMargin: round(rent - expense) }
  return { metricDictionaryVersion: METRIC_DICTIONARY_VERSION, currency: env.BASE_CURRENCY.toUpperCase(), timezone: env.TIMEZONE, from, to, metrics }
}

export const summary = async (req: Request, res: Response) => {
  try {
    const result = await build(req)
    if (!result) {
      res.status(400).send('Agency filter required')
      return
    }
    res.json(result)
  } catch (err) {
    logger.error('[reports.summary]', err)
    res.status(400).send('Invalid report request')
  }
}

export const exportCsv = async (req: Request, res: Response) => {
  try {
    const result = await build(req)
    if (!result) {
      res.status(400).send('Agency filter required')
      return
    }
    const rows = Object.entries(result.metrics).map(([metric, value]) => ({ metric, value, currency: result.currency, timezone: result.timezone, from: result.from.toISOString(), to: result.to.toISOString(), metricDictionaryVersion: result.metricDictionaryVersion }))
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="gestion-auto-report.csv"').send(makeCsv(rows))
  } catch (err) {
    logger.error('[reports.exportCsv]', err)
    res.status(400).send('Invalid report request')
  }
}

// ---------------------------------------------------------------------
// GA-PAR-14 — builder core (dictionary v2026-11-11.1 definitions above)
// ---------------------------------------------------------------------

type GroupBy = 'day' | 'week' | 'month' | 'car'
const GROUP_BYS: GroupBy[] = ['day', 'week', 'month', 'car']
const DRILLDOWN_LIMIT = 500

interface BookingFigure {
  id: string
  reference?: string
  carId: string
  from: Date
  to: Date
  contractAmount: number
  collected: number
  remaining: number
  intersectDays: number
}

interface ExpenseFigure {
  id: string
  // GA-PAR-16: null for a general (car-less) expense — it counts in
  // the period totals and in date buckets, but is never attributed
  // to a car bucket.
  carId: string | null
  date: Date
  amount: number
}

interface PeriodData {
  bookings: BookingFigure[]
  expenses: ExpenseFigure[]
  periodDays: number
  totals: { contractAmount: number, collected: number, remaining: number, expenses: number, net: number, bookingsCount: number }
}

const localDateParts = (d: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const p: Record<string, number> = {}
  for (const part of parts) {
    if (part.type !== 'literal') {
      p[part.type] = Number(part.value)
    }
  }
  return { year: p.year, month: p.month, day: p.day }
}
const pad2 = (n: number) => String(n).padStart(2, '0')
const localDateKey = (d: Date) => {
  const { year, month, day } = localDateParts(d)
  return `${year}-${pad2(month)}-${pad2(day)}`
}
const bucketKeyFor = (d: Date, groupBy: GroupBy): string => {
  if (groupBy === 'month') {
    const { year, month } = localDateParts(d)
    return `${year}-${pad2(month)}`
  }
  if (groupBy === 'week') {
    const { year, month, day } = localDateParts(d)
    const utc = Date.UTC(year, month - 1, day)
    const dow = new Date(utc).getUTCDay()
    const monday = new Date(utc - ((dow + 6) % 7) * 86400000)
    return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(monday.getUTCDate())}`
  }
  return localDateKey(d)
}
const bucketRange = (key: string, groupBy: GroupBy): { start: Date, end: Date } | null => {
  if (groupBy === 'day' && DATE_ONLY.test(key)) {
    const start = casablancaDayStart(key)
    return { start, end: new Date(start.getTime() + 86400000) }
  }
  if (groupBy === 'week' && DATE_ONLY.test(key)) {
    const start = casablancaDayStart(key)
    return { start, end: new Date(start.getTime() + 7 * 86400000) }
  }
  if (groupBy === 'month' && /^\d{4}-\d{2}$/.test(key)) {
    const start = casablancaDayStart(`${key}-01`)
    const [y, m] = key.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`
    return { start, end: casablancaDayStart(`${next}-01`) }
  }
  return null
}

// GA-PAR-17 — channel scope (dictionary v2026-11-11.2): the payment
// `method` values that belong to each scope. `other` (and a missing
// method) belong to NEITHER scope by design.
type ReportScope = 'all' | 'cash' | 'bank'
const SCOPES: ReportScope[] = ['all', 'cash', 'bank']
const SCOPE_METHODS: Record<Exclude<ReportScope, 'all'>, string[]> = {
  cash: [types.RentalPaymentMethod.Cash],
  bank: [types.RentalPaymentMethod.BankTransfer, types.RentalPaymentMethod.Card],
}

const computePeriod = async (supplier: mongoose.Types.ObjectId, from: Date, to: Date, carId?: string, scope: ReportScope = 'all'): Promise<PeriodData> => {
  const carObjectId = carId ? new mongoose.Types.ObjectId(carId) : undefined
  const bookings = await Booking.find({
    supplier,
    from: { $lt: to },
    to: { $gt: from },
    status: { $nin: [types.BookingStatus.Void, types.BookingStatus.Cancelled] },
    expireAt: null,
    ...(carObjectId ? { car: carObjectId } : {}),
  }).select('_id car from to price financialSnapshot reference').lean()

  const bookingIds = bookings.map((b) => b._id)
  const [paymentRows, chargeRows, expenseRows] = await Promise.all([
    bookingIds.length > 0 ? RentalPayment.aggregate([
      { $match: { booking: { $in: bookingIds }, status: types.RentalPaymentStatus.Posted, ...(scope !== 'all' ? { method: { $in: SCOPE_METHODS[scope] } } : {}) } },
      { $group: { _id: { booking: '$booking', purpose: { $ifNull: ['$purpose', types.RentalPaymentPurpose.Rent] } }, total: { $sum: { $cond: [{ $eq: ['$direction', types.RentalPaymentDirection.Debit] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
    ]) : [],
    bookingIds.length > 0 ? ContractCharge.aggregate([
      { $match: { booking: { $in: bookingIds }, status: types.ApprovalDecision.Approved } },
      { $group: { _id: { booking: '$booking', currency: '$currency' }, total: { $sum: '$amount' } } },
    ]) : [],
    MaintenanceExpense.find({
      supplier,
      date: { $gte: from, $lte: to },
      ...(carObjectId ? { car: carObjectId } : {}),
    }).select('_id car date amount').lean(),
  ])

  const rentByBooking = new Map<string, number>()
  for (const row of paymentRows as Array<{ _id: { booking: mongoose.Types.ObjectId, purpose: string }, total: number }>) {
    if (row._id.purpose === types.RentalPaymentPurpose.Rent) {
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

  const periodDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000))
  const figures: BookingFigure[] = bookings.map((b) => {
    const currency = (b.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
    const rentalTotal = Number(b.financialSnapshot?.rentalTotal || b.price || 0)
    const approvedCharges = (chargesByBooking.get(b._id.toString()) || [])
      .filter((row) => row.currency === currency)
      .reduce((sum, row) => sum + row.total, 0)
    const contractAmount = round(rentalTotal + approvedCharges)
    const collected = round(rentByBooking.get(b._id.toString()) || 0)
    const remaining = round(Math.max(0, contractAmount - collected))
    const intersectDays = Math.max(0, Math.ceil((Math.min(to.getTime(), new Date(b.to).getTime()) - Math.max(from.getTime(), new Date(b.from).getTime())) / 86400000))
    return {
      id: b._id.toString(),
      reference: b.reference,
      carId: b.car.toString(),
      from: new Date(b.from),
      to: new Date(b.to),
      contractAmount,
      collected,
      remaining,
      intersectDays,
    }
  })
  const expenses: ExpenseFigure[] = expenseRows.map((e) => ({
    id: e._id.toString(),
    // GA-PAR-16 minimal fix (flagged): e.car.toString() crashed the
    // builder on a general (car-less) expense (null car). A car-less
    // expense now maps to carId null instead of throwing.
    carId: e.car ? e.car.toString() : null,
    date: new Date(e.date),
    amount: round(Number(e.amount || 0)),
  }))
  const totals = {
    contractAmount: round(figures.reduce((s, b) => s + b.contractAmount, 0)),
    collected: round(figures.reduce((s, b) => s + b.collected, 0)),
    remaining: round(figures.reduce((s, b) => s + b.remaining, 0)),
    expenses: round(expenses.reduce((s, e) => s + e.amount, 0)),
    net: 0,
    bookingsCount: figures.length,
  }
  totals.net = round(totals.collected - totals.expenses)
  return { bookings: figures, expenses, periodDays, totals }
}

interface BuilderRow {
  key: string
  carId?: string
  contractAmount: number
  collected: number
  remaining: number
  expenses: number
  net: number
  bookingsCount: number
  occupancyPct?: number
}

const buildRows = (data: PeriodData, from: Date, to: Date, groupBy: GroupBy, carScoped: boolean): BuilderRow[] => {
  const rows = new Map<string, BuilderRow & { days: number, bucketDays: number }>()
  const bucketDaysFor = (key: string): number => {
    if (groupBy === 'car') {
      return data.periodDays
    }
    const range = bucketRange(key, groupBy)
    if (!range) {
      return data.periodDays
    }
    const start = Math.max(range.start.getTime(), from.getTime())
    const end = Math.min(range.end.getTime(), to.getTime() + 1)
    return Math.max(1, Math.ceil((end - start) / 86400000))
  }
  const ensure = (key: string, rowCarId?: string) => {
    let row = rows.get(key)
    if (!row) {
      row = {
        key,
        ...(rowCarId ? { carId: rowCarId } : {}),
        contractAmount: 0, collected: 0, remaining: 0, expenses: 0, net: 0, bookingsCount: 0, days: 0, bucketDays: bucketDaysFor(key),
      }
      rows.set(key, row)
    }
    return row
  }
  for (const b of data.bookings) {
    const key = groupBy === 'car' ? b.carId : bucketKeyFor(new Date(Math.max(from.getTime(), b.from.getTime())), groupBy)
    const row = ensure(key, groupBy === 'car' ? b.carId : (carScoped ? b.carId : undefined))
    row.contractAmount = round(row.contractAmount + b.contractAmount)
    row.collected = round(row.collected + b.collected)
    row.remaining = round(row.remaining + b.remaining)
    row.bookingsCount += 1
    if (groupBy === 'car') {
      row.days += b.intersectDays
    } else {
      const range = bucketRange(key, groupBy)
      if (range) {
        const start = Math.max(range.start.getTime(), from.getTime(), b.from.getTime())
        const end = Math.min(range.end.getTime(), to.getTime() + 1, b.to.getTime())
        row.days += Math.max(0, Math.ceil((end - start) / 86400000))
      }
    }
  }
  for (const e of data.expenses) {
    // GA-PAR-16 minimal fix (flagged): a general (car-less) expense is
    // NOT attributed to any car bucket under groupBy=car — it remains
    // in the period totals (computed separately in computePeriod) and
    // in its date bucket under day/week/month grouping.
    if (groupBy === 'car' && !e.carId) {
      continue
    }
    const key = groupBy === 'car' ? (e.carId as string) : bucketKeyFor(e.date, groupBy)
    const row = ensure(key, groupBy === 'car' ? (e.carId as string) : (carScoped && e.carId ? e.carId : undefined))
    row.expenses = round(row.expenses + e.amount)
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)).map((row) => {
    const { days, bucketDays, ...rest } = row
    return {
      ...rest,
      net: round(rest.collected - rest.expenses),
      ...((groupBy === 'car' || carScoped) ? { occupancyPct: round((days / bucketDays) * 100) } : {}),
    }
  })
}

const parseBuilderParams = (req: Request) => {
  const { from, to } = resolveRange(req.query)
  const groupByRaw = typeof req.query.groupBy === 'string' ? req.query.groupBy : 'car'
  if (!GROUP_BYS.includes(groupByRaw as GroupBy)) {
    throw new Error('Invalid groupBy')
  }
  const groupBy = groupByRaw as GroupBy
  let carId: string | undefined
  if (typeof req.query.carId === 'string' && req.query.carId) {
    if (!mongoose.isValidObjectId(req.query.carId)) {
      throw new Error('Invalid carId')
    }
    carId = req.query.carId
  }
  const compare = req.query.compare === 'true' || req.query.compare === '1'
  const scopeRaw = typeof req.query.scope === 'string' && req.query.scope ? req.query.scope : 'all'
  if (!SCOPES.includes(scopeRaw as ReportScope)) {
    throw new Error('Invalid scope')
  }
  return { from, to, groupBy, carId, compare, scope: scopeRaw as ReportScope }
}

const runBuilder = async (req: Request) => {
  const supplier = supplierFor(req)
  if (!supplier) {
    return null
  }
  const { from, to, groupBy, carId, compare, scope } = parseBuilderParams(req)
  if (carId) {
    const car = await Car.findOne({ _id: carId, supplier }).select('_id').lean()
    if (!car) {
      throw new Error('Car not in agency')
    }
  }
  const data = await computePeriod(supplier, from, to, carId, scope)
  const rows = buildRows(data, from, to, groupBy, !!carId)
  const totals: Record<string, number> = { ...data.totals }
  if (carId) {
    const days = data.bookings.reduce((s, b) => s + b.intersectDays, 0)
    totals.occupancyPct = round((days / data.periodDays) * 100)
  }
  let comparison: Record<string, unknown> | undefined
  if (compare) {
    const length = to.getTime() - from.getTime()
    const prevTo = from
    const prevFrom = new Date(from.getTime() - length)
    const prev = await computePeriod(supplier, prevFrom, prevTo, carId, scope)
    const metrics = ['contractAmount', 'collected', 'remaining', 'expenses', 'net', 'bookingsCount'] as const
    const deltas: Record<string, { current: number, previous: number, delta: number, deltaPct: number | null }> = {}
    for (const metric of metrics) {
      const current = Number(totals[metric] || 0)
      const previous = Number(prev.totals[metric] || 0)
      deltas[metric] = {
        current,
        previous,
        delta: round(current - previous),
        deltaPct: previous === 0 ? null : round(((current - previous) / previous) * 100),
      }
    }
    comparison = { previousFrom: prevFrom, previousTo: prevTo, previousTotals: prev.totals, deltas }
  }
  return {
    metricDictionaryVersion: METRIC_DICTIONARY_VERSION,
    currency: env.BASE_CURRENCY.toUpperCase(),
    timezone: env.TIMEZONE,
    from,
    to,
    groupBy,
    scope,
    ...(carId ? { carId } : {}),
    rows,
    totals,
    ...(comparison ? { comparison } : {}),
  }
}

export const builder = async (req: Request, res: Response) => {
  try {
    const result = await runBuilder(req)
    if (!result) {
      res.status(400).send('Agency filter required')
      return
    }
    res.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'Car not in agency') {
      res.status(404).send('Car not found')
      return
    }
    logger.error('[reports.builder]', err)
    res.status(400).send('Invalid report request')
  }
}

export const builderCsv = async (req: Request, res: Response) => {
  try {
    const result = await runBuilder(req)
    if (!result) {
      res.status(400).send('Agency filter required')
      return
    }
    const rows: Array<Record<string, unknown>> = result.rows.map((row) => ({
      key: row.key,
      carId: row.carId || '',
      contractAmount: row.contractAmount,
      collected: row.collected,
      remaining: row.remaining,
      expenses: row.expenses,
      net: row.net,
      bookingsCount: row.bookingsCount,
      occupancyPct: row.occupancyPct ?? '',
      scope: result.scope,
      currency: result.currency,
      timezone: result.timezone,
      from: result.from.toISOString(),
      to: result.to.toISOString(),
      metricDictionaryVersion: result.metricDictionaryVersion,
    }))
    rows.push({
      key: 'TOTAL',
      carId: result.carId || '',
      contractAmount: result.totals.contractAmount,
      collected: result.totals.collected,
      remaining: result.totals.remaining,
      expenses: result.totals.expenses,
      net: result.totals.net,
      bookingsCount: result.totals.bookingsCount,
      occupancyPct: result.totals.occupancyPct ?? '',
      scope: result.scope,
      currency: result.currency,
      timezone: result.timezone,
      from: result.from.toISOString(),
      to: result.to.toISOString(),
      metricDictionaryVersion: result.metricDictionaryVersion,
    })
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="gestion-auto-report-builder.csv"').send(makeCsv(rows))
  } catch (err) {
    if (err instanceof Error && err.message === 'Car not in agency') {
      res.status(404).send('Car not found')
      return
    }
    logger.error('[reports.builderCsv]', err)
    res.status(400).send('Invalid report request')
  }
}

export const drilldown = async (req: Request, res: Response) => {
  try {
    const supplier = supplierFor(req)
    if (!supplier) {
      res.status(400).send('Agency filter required')
      return
    }
    const { from, to, groupBy, carId } = parseBuilderParams(req)
    const bucket = typeof req.query.bucket === 'string' ? req.query.bucket : ''
    const data = await computePeriod(supplier, from, to, carId)
    let bookings = data.bookings
    let expenses = data.expenses
    if (bucket) {
      if (groupBy === 'car') {
        bookings = bookings.filter((b) => b.carId === bucket)
        expenses = expenses.filter((e) => e.carId === bucket)
      } else {
        bookings = bookings.filter((b) => bucketKeyFor(new Date(Math.max(from.getTime(), b.from.getTime())), groupBy) === bucket)
        expenses = expenses.filter((e) => bucketKeyFor(e.date, groupBy) === bucket)
      }
    }
    const bookingIds = bookings.map((b) => new mongoose.Types.ObjectId(b.id))
    const payments = bookingIds.length > 0 ? await RentalPayment.find({
      booking: { $in: bookingIds },
      status: types.RentalPaymentStatus.Posted,
    }).select('_id booking date amount direction purpose').sort({ date: 1 }).limit(DRILLDOWN_LIMIT + 1).lean() : []
    const rentPayments = payments.filter((p) => !p.purpose || p.purpose === types.RentalPaymentPurpose.Rent)
    res.json({
      metricDictionaryVersion: METRIC_DICTIONARY_VERSION,
      currency: env.BASE_CURRENCY.toUpperCase(),
      timezone: env.TIMEZONE,
      from,
      to,
      groupBy,
      ...(carId ? { carId } : {}),
      ...(bucket ? { bucket } : {}),
      limit: DRILLDOWN_LIMIT,
      bookings: bookings.slice(0, DRILLDOWN_LIMIT).map((b) => ({
        id: b.id, reference: b.reference || null, carId: b.carId, from: b.from, to: b.to, contractAmount: b.contractAmount, collected: b.collected, remaining: b.remaining,
      })),
      payments: rentPayments.slice(0, DRILLDOWN_LIMIT).map((p) => ({
        id: p._id.toString(),
        bookingId: p.booking.toString(),
        date: p.date,
        amount: round((p.direction === types.RentalPaymentDirection.Debit ? -1 : 1) * Number(p.amount || 0)),
      })),
      expenses: expenses.slice(0, DRILLDOWN_LIMIT).map((e) => ({
        id: e.id, carId: e.carId, date: e.date, amount: e.amount,
      })),
      truncated: {
        bookings: bookings.length > DRILLDOWN_LIMIT,
        payments: rentPayments.length > DRILLDOWN_LIMIT,
        expenses: expenses.length > DRILLDOWN_LIMIT,
      },
    })
  } catch (err) {
    logger.error('[reports.drilldown]', err)
    res.status(400).send('Invalid report request')
  }
}

// GA-PAR-09 Phase B — dashboard aggregate. Same dictionary definitions
// as the builder (computePeriod): contractAmount INCLUDES approved
// charges and the figures are exact at any scale (server-side
// aggregation over the period-intersecting bookings, no fetch cap).
export const dashboardSummary = async (req: Request, res: Response) => {
  try {
    const supplier = supplierFor(req)
    if (!supplier) {
      res.status(400).send('Agency filter required')
      return
    }
    const { from, to } = resolveRange(req.query)
    const scopeRaw = typeof req.query.scope === 'string' && req.query.scope ? req.query.scope : 'all'
    if (!SCOPES.includes(scopeRaw as ReportScope)) {
      throw new Error('Invalid scope')
    }
    const scope = scopeRaw as ReportScope
    const data = await computePeriod(supplier, from, to, undefined, scope)
    res.json({
      metricDictionaryVersion: METRIC_DICTIONARY_VERSION,
      currency: env.BASE_CURRENCY.toUpperCase(),
      timezone: env.TIMEZONE,
      from,
      to,
      scope,
      contractAmount: data.totals.contractAmount,
      collected: data.totals.collected,
      remaining: data.totals.remaining,
      contracts: data.totals.bookingsCount,
    })
  } catch (err) {
    logger.error('[dashboard.summary]', err)
    res.status(400).send('Invalid dashboard request')
  }
}

// ---------------------------------------------------------------------
// GA-PAR-17 — per-car PDF (scorecard #21 residual). On-demand pdf-lib
// renderer in the PAR-03 tradition: no storage, no new collection.
// Figures come from the SAME computePeriod core as the builder
// (car-scoped), so the PDF can never disagree with the builder JSON.
// Gated ReadPayments like every other /api/reports endpoint; a car of
// another agency answers 404.
// ---------------------------------------------------------------------

export const carPdf = async (req: Request, res: Response) => {
  try {
    const supplier = supplierFor(req)
    if (!supplier) {
      res.status(400).send('Agency filter required')
      return
    }
    const carId = req.params.carId
    if (!carId || !mongoose.isValidObjectId(carId)) {
      res.status(404).send('Car not found')
      return
    }
    const car = await Car.findOne({ _id: carId, supplier }).select('name licensePlate').lean()
    if (!car) {
      res.status(404).send('Car not found')
      return
    }
    const { from, to } = resolveRange(req.query)
    const data = await computePeriod(supplier, from, to, carId)
    const days = data.bookings.reduce((s, b) => s + b.intersectDays, 0)
    const occupancyPct = round((days / data.periodDays) * 100)
    const bookingIds = data.bookings.map((b) => new mongoose.Types.ObjectId(b.id))
    const [driverRows, expenseRows, supplierDoc] = await Promise.all([
      bookingIds.length > 0 ? Booking.find({ _id: { $in: bookingIds } }).populate({ path: 'driver', select: 'fullName' }).select('driver').lean() : [],
      MaintenanceExpense.find({ supplier, car: new mongoose.Types.ObjectId(carId), date: { $gte: from, $lte: to } }).select('date type amount').sort({ date: 1 }).lean(),
      User.findById(supplier).select('fullName email phone ice registreCommerce identifiantFiscal patente rib fiscalAddress city').lean(),
    ])
    const driverByBooking = new Map<string, string>()
    for (const row of driverRows as Array<{ _id: mongoose.Types.ObjectId, driver?: { fullName?: string } | mongoose.Types.ObjectId }>) {
      const driver = row.driver && typeof row.driver === 'object' && 'fullName' in row.driver ? row.driver.fullName : undefined
      driverByBooking.set(row._id.toString(), driver || '')
    }
    const pdf = await renderCarPdf({
      supplier: supplierDoc as never,
      car: { name: car.name, licensePlate: car.licensePlate },
      from,
      to,
      currency: env.BASE_CURRENCY.toUpperCase(),
      metricDictionaryVersion: METRIC_DICTIONARY_VERSION,
      figures: {
        contractAmount: data.totals.contractAmount,
        collected: data.totals.collected,
        remaining: data.totals.remaining,
        expenses: data.totals.expenses,
        netCollected: data.totals.net,
        bookingsCount: data.totals.bookingsCount,
        occupancyPct,
      },
      bookings: data.bookings.map((b) => ({
        reference: b.reference,
        client: driverByBooking.get(b.id) || '',
        from: b.from,
        to: b.to,
        contractAmount: b.contractAmount,
        collected: b.collected,
      })),
      expenses: expenseRows.map((e) => ({ date: new Date(e.date), category: String(e.type), amount: round(Number(e.amount || 0)) })),
    })
    res.type('application/pdf')
      .set('Content-Disposition', `attachment; filename="gestion-auto-car-report-${carId}.pdf"`)
      .send(pdf)
  } catch (err) {
    logger.error('[reports.carPdf]', err)
    res.status(400).send('Invalid report request')
  }
}

// ---------------------------------------------------------------------
// GA-PAR-14 — saved views (ReportView). A user sees and manages ONLY
// their own views: every query is scoped {supplier, user}; another
// user's view — same agency or cross-agency — answers 404 / is absent
// from lists.
// ---------------------------------------------------------------------

const supplierForWrite = (req: Request) => {
  if (req.user?.type === types.UserType.Admin) {
    const candidate = (typeof req.body?.supplier === 'string' && req.body.supplier)
      || (typeof req.query.supplier === 'string' && req.query.supplier)
      || ''
    return mongoose.isValidObjectId(candidate) ? new mongoose.Types.ObjectId(candidate) : null
  }
  const raw = agencySupplierId(req)
  return raw && mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(raw) : null
}

const PERIOD_PRESETS = ['all', 'today', 'month', '7', '14', '28', 'custom']

const validateViewConfig = async (raw: unknown, supplier: mongoose.Types.ObjectId): Promise<{ value: types.ReportViewConfig } | { error: string }> => {
  if (!raw || typeof raw !== 'object') {
    return { error: 'View config is required' }
  }
  const input = raw as Record<string, unknown>
  const groupBy = input.groupBy === undefined ? 'car' : input.groupBy
  if (typeof groupBy !== 'string' || !GROUP_BYS.includes(groupBy as GroupBy)) {
    return { error: 'Invalid groupBy' }
  }
  const value: types.ReportViewConfig = { groupBy: groupBy as types.ReportGroupBy, compare: input.compare === true }
  if (input.periodPreset !== undefined) {
    if (typeof input.periodPreset !== 'string' || !PERIOD_PRESETS.includes(input.periodPreset)) {
      return { error: 'Invalid periodPreset' }
    }
    value.periodPreset = input.periodPreset
  }
  for (const field of ['from', 'to'] as const) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== 'string' || Number.isNaN(new Date(input[field] as string).getTime())) {
        return { error: `Invalid ${field}` }
      }
      value[field] = input[field] as string
    }
  }
  if (input.carId !== undefined && input.carId !== null && input.carId !== '') {
    if (typeof input.carId !== 'string' || !mongoose.isValidObjectId(input.carId)) {
      return { error: 'Invalid carId' }
    }
    const car = await Car.findOne({ _id: input.carId, supplier }).select('_id').lean()
    if (!car) {
      return { error: 'Car not in agency' }
    }
    value.carId = input.carId
  }
  return { value }
}

interface ViewLike {
  _id: mongoose.Types.ObjectId
  supplier: mongoose.Types.ObjectId
  user: mongoose.Types.ObjectId
  name: string
  config: types.ReportViewConfig
  createdAt?: Date
  updatedAt?: Date
}

const viewToJson = (view: ViewLike) => ({
  _id: view._id.toString(),
  supplier: view.supplier.toString(),
  user: view.user.toString(),
  name: view.name,
  config: view.config,
  createdAt: view.createdAt,
  updatedAt: view.updatedAt,
})

export const listViews = async (req: Request, res: Response) => {
  try {
    const supplier = supplierFor(req)
    if (!supplier || !req.user?._id) {
      res.status(400).send('Agency filter required')
      return
    }
    const views = await ReportView.find({ supplier, user: req.user._id }).sort({ updatedAt: -1 }).lean()
    res.json(views.map((v) => viewToJson(v as unknown as ViewLike)))
  } catch (err) {
    logger.error('[reports.listViews]', err)
    res.status(400).send('Invalid report request')
  }
}

export const createView = async (req: Request, res: Response) => {
  try {
    const supplier = supplierForWrite(req)
    if (!supplier || !req.user?._id) {
      res.status(400).send('Agency filter required')
      return
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : ''
    if (!name) {
      res.status(400).send('View name is required')
      return
    }
    const validated = await validateViewConfig(req.body?.config, supplier)
    if ('error' in validated) {
      res.status(400).send(validated.error)
      return
    }
    const view = await ReportView.create({ supplier, user: req.user._id, name, config: validated.value })
    res.status(201).json(viewToJson(view as unknown as ViewLike))
  } catch (err) {
    logger.error('[reports.createView]', err)
    res.status(400).send('Invalid report request')
  }
}

export const updateView = async (req: Request, res: Response) => {
  try {
    const supplier = supplierForWrite(req)
    if (!supplier || !req.user?._id || !mongoose.isValidObjectId(req.params.id)) {
      res.status(404).send('View not found')
      return
    }
    const view = await ReportView.findOne({ _id: req.params.id, supplier, user: req.user._id })
    if (!view) {
      res.status(404).send('View not found')
      return
    }
    if (req.body?.name !== undefined) {
      const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 120) : ''
      if (!name) {
        res.status(400).send('View name is required')
        return
      }
      view.name = name
    }
    if (req.body?.config !== undefined) {
      const validated = await validateViewConfig(req.body.config, supplier)
      if ('error' in validated) {
        res.status(400).send(validated.error)
        return
      }
      view.config = validated.value as never
    }
    await view.save()
    res.json(viewToJson(view as unknown as ViewLike))
  } catch (err) {
    logger.error('[reports.updateView]', err)
    res.status(400).send('Invalid report request')
  }
}

export const deleteView = async (req: Request, res: Response) => {
  try {
    const supplier = supplierFor(req) || supplierForWrite(req)
    if (!supplier || !req.user?._id || !mongoose.isValidObjectId(req.params.id)) {
      res.status(404).send('View not found')
      return
    }
    const deleted = await ReportView.findOneAndDelete({ _id: req.params.id, supplier, user: req.user._id })
    if (!deleted) {
      res.status(404).send('View not found')
      return
    }
    res.status(204).send()
  } catch (err) {
    logger.error('[reports.deleteView]', err)
    res.status(400).send('Invalid report request')
  }
}
