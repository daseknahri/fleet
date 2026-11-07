import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as types from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import RentalPayment from '../models/RentalPayment'
import MaintenanceExpense from '../models/MaintenanceExpense'
import Invoice from '../models/Invoice'
import Car from '../models/Car'
import { agencySupplierId } from '../utils/agencyAuthorization'
import * as logger from '../utils/logger'
const round = (n: number) => Number(n.toFixed(2))
const date = (value: unknown, fallback: Date) => {
 if (value === undefined || value === '') {
return fallback
} const raw = String(value); const d = new Date(raw); return Number.isNaN(d.getTime()) ? null : d 
}
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const casablancaDayStart = (yyyyMmDd: string) => {
  // UTC instant of 00:00:00.000 Africa/Casablanca on the given local date,
  // resolved through Intl so UTC-offset changes are honored.
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
 const raw = req.user?.type === types.UserType.Admin ? req.query.supplier : agencySupplierId(req); return typeof raw === 'string' && mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(raw) : null 
}
const escapeCsv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const makeCsv = (rows: Array<Record<string, unknown>>) => {
 const keys = Object.keys(rows[0] || {}); return [keys.join(','), ...rows.map(row => keys.map(k => escapeCsv(row[k])).join(','))].join('\r\n') + '\r\n' 
}
const build = async (req: Request) => {
  const supplier = supplierFor(req); if (!supplier) {
return null
}
  const now = new Date()
  // Metric dictionary v2026-11-02.1: date ranges are inclusive and use
  // Africa/Casablanca. The Reports UI sends date-only values, so a
  // date-only bound covers that whole Casablanca local day (from =
  // 00:00:00.000 local, to = 23:59:59.999 local). Previously a date-only
  // value was parsed as end-of-day UTC and the end pushed one more day,
  // shifting the window about a day at both ends
  // (GA-P2-REPORT-DEFINITIONS-01, 2026-11-05).
  const fromRaw = typeof req.query.from === 'string' ? req.query.from : ''
  const toRaw = typeof req.query.to === 'string' ? req.query.to : ''
  const from = DATE_ONLY.test(fromRaw) ? casablancaDayStart(fromRaw) : date(req.query.from, new Date(now.getFullYear(), now.getMonth(), 1))
  const to = DATE_ONLY.test(toRaw) ? new Date(casablancaDayStart(toRaw).getTime() + 86400000 - 1) : date(req.query.to, now)
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
throw new Error('Invalid range')
}
  const [payments, expenses, bookings, fleet, invoices] = await Promise.all([
    RentalPayment.aggregate([{ $match: { supplier, date: { $gte: from, $lte: to }, status: types.RentalPaymentStatus.Posted } }, { $group: { _id: '$purpose', total: { $sum: { $cond: [{ $eq: ['$direction', types.RentalPaymentDirection.Debit] }, { $multiply: ['$amount', -1] }, '$amount'] } } } }]),
    MaintenanceExpense.aggregate([{ $match: { supplier, date: { $gte: from, $lte: to } } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Booking.find({ supplier, from: { $lt: to }, to: { $gt: from }, status: { $nin: [types.BookingStatus.Void, types.BookingStatus.Cancelled] } }).select('_id from to price financialSnapshot').lean(),
    Car.countDocuments({ supplier }),
    Invoice.aggregate([{ $match: { supplier, status: { $ne: types.InvoiceStatus.Voided }, createdAt: { $gte: from, $lte: to } } }, { $group: { _id: null, total: { $sum: '$total' }, paid: { $sum: '$paidAmount' }, count: { $sum: 1 } } }]),
  ])
  const rent = Number(payments.find(x => x._id === types.RentalPaymentPurpose.Rent)?.total || 0); const deposit = Number(payments.find(x => x._id === types.RentalPaymentPurpose.Deposit)?.total || 0); const expense = Number(expenses[0]?.total || 0)
  const rentalTotal = bookings.reduce((s, b) => s + Number(b.financialSnapshot?.rentalTotal || b.price || 0), 0); const receivable = Math.max(0, rentalTotal - rent)
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000)); const bookedDays = bookings.reduce((s, b) => s + Math.max(0, Math.ceil((Math.min(to.getTime(), new Date(b.to).getTime()) - Math.max(from.getTime(), new Date(b.from).getTime())) / 86400000)), 0); const capacity = Math.max(1, fleet * days)
  const metrics = { contracts: bookings.length, fleetVehicles: fleet, revenueCollected: round(rent), depositsCollected: round(deposit), expenses: round(expense), receivable: round(receivable), bookedVehicleDays: bookedDays, fleetCapacityDays: capacity, utilizationPercent: round(bookedDays / capacity * 100), invoiceCount: invoices[0]?.count || 0, invoicedTotal: round(invoices[0]?.total || 0), invoicedPaid: round(invoices[0]?.paid || 0), estimatedMargin: round(rent - expense) }
  return { metricDictionaryVersion: '2026-11-02.1', currency: env.BASE_CURRENCY.toUpperCase(), timezone: env.TIMEZONE, from, to, metrics }
}
export const summary = async (req: Request, res: Response) => {
 try {
 const result = await build(req); if (!result) {
 res.status(400).send('Agency filter required'); return 
}; res.json(result) 
} catch (err) {
 logger.error('[reports.summary]', err); res.status(400).send('Invalid report request') 
} 
}
export const exportCsv = async (req: Request, res: Response) => {
 try {
 const result = await build(req); if (!result) {
 res.status(400).send('Agency filter required'); return 
}; const rows = Object.entries(result.metrics).map(([metric, value]) => ({ metric, value, currency: result.currency, timezone: result.timezone, from: result.from.toISOString(), to: result.to.toISOString(), metricDictionaryVersion: result.metricDictionaryVersion })); res.type('text/csv').set('Content-Disposition', 'attachment; filename="gestion-auto-report.csv"').send(makeCsv(rows)) 
} catch (err) {
 logger.error('[reports.exportCsv]', err); res.status(400).send('Invalid report request') 
} 
}
