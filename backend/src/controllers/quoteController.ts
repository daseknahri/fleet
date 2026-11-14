import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import User from '../models/User'
import Car from '../models/Car'
import Quote from '../models/Quote'
import Invoice from '../models/Invoice'
import Counter from '../models/Counter'
import { DEFAULT_VAT_RATE } from '../utils/fiscal'
import { currencyExponent, toMinorUnits } from '../utils/paymentAmount'
import { createInvoiceForBooking, InvoiceCreationError } from '../utils/invoiceCreation'
import { renderInvoicePdf } from '../utils/invoicePdf'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'

/**
 * GA-PAR-05 — Quotes (devis) controller (Option B: separate Quote model).
 *
 * Agency-scoped exactly like invoices (ReadInvoices / ManageInvoices
 * gating in the routes; no new permission). Numbers are DV-YYYY-NNNNNN
 * from the Counter sequence named 'quote', assigned AT CREATE — quotes
 * are documents from birth, unlike invoice numbers which are assigned at
 * issue. Status flow: draft -> sent -> accepted; draft|sent -> expired;
 * accepted -> converted (via convert only). Conversion creates a DRAFT
 * invoice through the shared creation path and never issues.
 *
 * Booking-less conversion rule (documented): Invoice.booking is required
 * and is NOT weakened. A quote without a linked booking therefore cannot
 * convert — convert answers 400 with a clear message until a booking is
 * linked (PUT the booking on the draft quote first). A booking-linked
 * quote whose booking already has an active invoice surfaces the shared
 * one-active 409, never a 500 or a duplicate.
 */

const scope = (req: Request) => (req.user?.type === bookcarsTypes.UserType.Admin ? {} : { supplier: agencySupplierId(req) || '000000000000000000000000' })

const populate = [
  { path: 'booking', populate: [{ path: 'driver', select: 'fullName email phone' }, { path: 'car', select: 'name licensePlate' }] },
  { path: 'client', select: 'fullName email phone cinNumber' },
  { path: 'car', select: 'name licensePlate' },
  { path: 'convertedInvoice', select: 'number status subtotal taxAmount taxRate total currency' },
  { path: 'supplier', select: 'fullName' },
]

const nextQuoteNumber = async (supplierId: string | mongoose.Types.ObjectId): Promise<string> => {
  const year = new Date().getFullYear()
  const counter = await Counter.findOneAndUpdate(
    { supplier: supplierId, name: 'quote', year },
    { $inc: { value: 1 }, $setOnInsert: { supplier: supplierId, name: 'quote', year } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  if (!counter) {
    throw new Error('Unable to allocate quote number')
  }
  return `DV-${year}-${String(counter.value).padStart(6, '0')}`
}

interface TotalsResult { currency: string, subtotal: number, taxAmount: number, taxRate: number | null, total: number }

const computeTotals = async (
  supplierId: string,
  body: Record<string, unknown>,
  booking?: { financialSnapshot?: { rentalTotal?: number, baseCurrency?: string } | null, price?: number } | null,
  stored?: { subtotal?: number, days?: number, dailyRate?: number } | null,
): Promise<TotalsResult | { error: string }> => {
  const currency = (String(body.currency || booking?.financialSnapshot?.baseCurrency || env.BASE_CURRENCY)).toUpperCase()
  let exponent: number
  try {
    exponent = currencyExponent(currency)
  } catch {
    return { error: 'Invalid currency' }
  }

  let subtotal: number
  if (body.subtotal !== undefined && body.subtotal !== null && body.subtotal !== '') {
    subtotal = Number(Number(body.subtotal).toFixed(exponent))
  } else {
    const days = body.days !== undefined && body.days !== null && body.days !== '' ? Number(body.days) : stored?.days
    const dailyRate = body.dailyRate !== undefined && body.dailyRate !== null && body.dailyRate !== '' ? Number(body.dailyRate) : stored?.dailyRate
    if (days !== undefined && dailyRate !== undefined && Number.isFinite(days) && Number.isFinite(dailyRate)) {
      subtotal = Number((days * dailyRate).toFixed(exponent))
    } else if (booking) {
      subtotal = Number(Number(booking.financialSnapshot?.rentalTotal || booking.price || 0).toFixed(exponent))
    } else if (stored?.subtotal !== undefined) {
      subtotal = stored.subtotal
    } else {
      return { error: 'Quote subtotal is required (subtotal, or days x dailyRate, or a linked booking)' }
    }
  }
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return { error: 'Invalid subtotal' }
  }

  // PAR-01 rule, same as invoice create: an explicit taxAmount override is
  // respected verbatim (taxRate null); otherwise agency VAT computes it.
  const hasExplicitTax = Object.prototype.hasOwnProperty.call(body, 'taxAmount')
    && body.taxAmount !== undefined && body.taxAmount !== null && body.taxAmount !== ''
  let taxAmount: number
  let taxRate: number | null = null
  if (hasExplicitTax) {
    taxAmount = Number(Number(body.taxAmount).toFixed(exponent))
  } else {
    const supplier = await User.findById(supplierId).select('vatEnabled vatRate').lean()
    if (supplier?.vatEnabled) {
      taxRate = typeof supplier.vatRate === 'number' && Number.isFinite(supplier.vatRate) ? supplier.vatRate : DEFAULT_VAT_RATE
      taxAmount = Number((subtotal * (taxRate / 100)).toFixed(exponent))
    } else {
      taxAmount = 0
    }
  }
  if (!Number.isFinite(taxAmount) || taxAmount < 0) {
    return { error: 'Invalid tax amount' }
  }
  const total = (toMinorUnits(subtotal, currency) + toMinorUnits(taxAmount, currency)) / (10 ** exponent)
  return { currency, subtotal, taxAmount, taxRate, total }
}

type ResolveResult<T> = { ok: true, doc: T | null } | { ok: false, trashed?: 'booking' | 'client' | 'car' }

/** GA-PAR-22: a re-link to a trashed row refuses 409 TRASHED (the
 * resolver reports it); anything else unresolvable stays 400. Returns
 * true when the handler must stop. */
const linkRefused = <T,>(res: Response, result: ResolveResult<T>, kind: 'booking' | 'client' | 'car', notFound: string): result is Extract<ResolveResult<T>, { ok: false }> => {
  if (result.ok) return false
  if (result.trashed) {
    res.status(409).send(`TRASHED: The linked ${kind} is trashed. Restore it first.`)
  } else {
    res.status(400).send(notFound)
  }
  return true
}

const resolveBooking = async (supplierId: string, bookingId: unknown): Promise<ResolveResult<{ _id: mongoose.Types.ObjectId, supplier: mongoose.Types.ObjectId, price?: number, financialSnapshot?: { rentalTotal?: number, baseCurrency?: string } | null, status: string }>> => {
  if (bookingId === undefined || bookingId === null || bookingId === '') return { ok: true, doc: null }
  if (!mongoose.isValidObjectId(String(bookingId))) return { ok: false }
  const booking = await Booking.findOne({ _id: String(bookingId), supplier: supplierId }).select('_id supplier price financialSnapshot status deletedAt').lean()
  if (!booking) return { ok: false }
  // GA-PAR-22: a trashed booking cannot be (re-)linked to a quote.
  if (booking.deletedAt) return { ok: false, trashed: 'booking' }
  return { ok: true, doc: booking as never }
}

const resolveClient = async (supplierId: string, clientId: unknown): Promise<ResolveResult<{ _id: mongoose.Types.ObjectId }>> => {
  if (clientId === undefined || clientId === null || clientId === '') return { ok: true, doc: null }
  if (!mongoose.isValidObjectId(String(clientId))) return { ok: false }
  const client = await User.findOne({ _id: String(clientId), type: bookcarsTypes.UserType.User }).select('_id supplier deletedAt').lean()
  if (!client) return { ok: false }
  // GA-PAR-22: a trashed client cannot be (re-)linked to a quote.
  if (client.deletedAt) return { ok: false, trashed: 'client' }
  // Clients created by an agency carry its id; legacy/seeded clients carry
  // supplier null (the standing Clients-grid reality). A client owned by a
  // DIFFERENT agency is refused.
  if (client.supplier && client.supplier.toString() !== supplierId) return { ok: false }
  return { ok: true, doc: client as never }
}

const resolveCar = async (supplierId: string, carId: unknown): Promise<ResolveResult<{ _id: mongoose.Types.ObjectId }>> => {
  if (carId === undefined || carId === null || carId === '') return { ok: true, doc: null }
  if (!mongoose.isValidObjectId(String(carId))) return { ok: false }
  const car = await Car.findOne({ _id: String(carId), supplier: supplierId }).select('_id deletedAt').lean()
  if (!car) return { ok: false }
  // GA-PAR-22: a trashed car cannot be (re-)linked to a quote.
  if (car.deletedAt) return { ok: false, trashed: 'car' }
  return { ok: true, doc: car as never }
}

const cleanSnapshot = (body: Record<string, unknown>) => {
  const snap = (body.clientSnapshot || {}) as Record<string, unknown>
  const clean: Record<string, string> = {}
  for (const key of ['name', 'phone', 'cinNumber'] as const) {
    if (typeof snap[key] === 'string' && (snap[key] as string).trim()) {
      clean[key] = (snap[key] as string).trim()
    } else if (typeof body[`client${key[0].toUpperCase()}${key.slice(1)}`] === 'string') {
      // tolerate flat free-entry fields too
    }
  }
  if (typeof body.clientName === 'string' && body.clientName.trim()) clean.name = body.clientName.trim()
  if (typeof body.clientPhone === 'string' && body.clientPhone.trim()) clean.phone = body.clientPhone.trim()
  if (typeof body.clientCinNumber === 'string' && body.clientCinNumber.trim()) clean.cinNumber = body.clientCinNumber.trim()
  return Object.keys(clean).length ? clean : undefined
}

export const list = async (req: Request, res: Response) => {
  try {
    res.json(await Quote.find(scope(req)).sort({ createdAt: -1 }).populate(populate))
  } catch (err) {
    logger.error('[quote.list]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const getOne = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const quote = await Quote.findOne({ _id: req.params.id, ...scope(req) }).populate(populate)
    if (!quote) { res.sendStatus(404); return }
    res.json(quote)
  } catch (err) {
    logger.error('[quote.getOne]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const create = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const supplierId = user?.type === bookcarsTypes.UserType.Admin ? req.body?.supplier : agencySupplierId(req)
    if (!user || !mongoose.isValidObjectId(supplierId)) {
      res.status(400).send('Invalid quote'); return
    }
    const body = (req.body || {}) as Record<string, unknown>

    const bookingRes = await resolveBooking(String(supplierId), body.booking)
    if (linkRefused(res, bookingRes, 'booking', 'Linked booking not found for this agency')) return
    const clientRes = await resolveClient(String(supplierId), body.client)
    if (linkRefused(res, clientRes, 'client', 'Linked client not found for this agency')) return
    const carRes = await resolveCar(String(supplierId), body.car)
    if (linkRefused(res, carRes, 'car', 'Linked car not found for this agency')) return

    const totals = await computeTotals(String(supplierId), body, bookingRes.doc)
    if ('error' in totals) { res.status(400).send(totals.error); return }

    const number = await nextQuoteNumber(supplierId)
    const quote = await Quote.create({
      supplier: supplierId,
      number,
      status: bookcarsTypes.QuoteStatus.Draft,
      currency: totals.currency,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      taxRate: totals.taxRate,
      total: totals.total,
      booking: bookingRes.doc ? bookingRes.doc._id : undefined,
      client: clientRes.doc ? clientRes.doc._id : undefined,
      clientSnapshot: cleanSnapshot(body),
      car: carRes.doc ? carRes.doc._id : undefined,
      carLabel: typeof body.carLabel === 'string' && body.carLabel.trim() ? body.carLabel.trim() : undefined,
      days: body.days !== undefined && body.days !== null && body.days !== '' ? Number(body.days) : undefined,
      dailyRate: body.dailyRate !== undefined && body.dailyRate !== null && body.dailyRate !== '' ? Number(body.dailyRate) : undefined,
      createdBy: user._id ? new mongoose.Types.ObjectId(user._id) : undefined,
      issuedBy: user._id ? new mongoose.Types.ObjectId(user._id) : undefined,
    })
    await quote.populate(populate)
    res.status(201).json(quote)
  } catch (err) {
    logger.error('[quote.create]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const update = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const quote = await Quote.findOne({ _id: req.params.id, ...scope(req) })
    if (!quote) { res.sendStatus(404); return }
    if (quote.status !== bookcarsTypes.QuoteStatus.Draft) {
      res.status(409).send('Only draft quotes can be edited'); return
    }
    const supplierId = quote.supplier.toString()
    const body = (req.body || {}) as Record<string, unknown>

    const bookingRes = body.booking !== undefined ? await resolveBooking(supplierId, body.booking) : undefined
    if (bookingRes && linkRefused(res, bookingRes, 'booking', 'Linked booking not found for this agency')) return
    const clientRes = body.client !== undefined ? await resolveClient(supplierId, body.client) : undefined
    if (clientRes && linkRefused(res, clientRes, 'client', 'Linked client not found for this agency')) return
    const carRes = body.car !== undefined ? await resolveCar(supplierId, body.car) : undefined
    if (carRes && linkRefused(res, carRes, 'car', 'Linked car not found for this agency')) return

    const effectiveBooking = bookingRes !== undefined
      ? bookingRes.doc
      : (quote.booking ? await Booking.findById(quote.booking).select('_id supplier price financialSnapshot status deletedAt').lean() : null)
    const totals = await computeTotals(supplierId, body, effectiveBooking as never, { subtotal: quote.subtotal, days: quote.days, dailyRate: quote.dailyRate })
    if ('error' in totals) { res.status(400).send(totals.error); return }

    if (bookingRes !== undefined) quote.booking = bookingRes.doc ? bookingRes.doc._id : undefined
    if (clientRes !== undefined) quote.client = clientRes.doc ? clientRes.doc._id : undefined
    if (body.clientSnapshot !== undefined || body.clientName !== undefined) quote.clientSnapshot = cleanSnapshot(body) as never
    if (carRes !== undefined) quote.car = carRes.doc ? carRes.doc._id : undefined
    if (body.carLabel !== undefined) quote.carLabel = typeof body.carLabel === 'string' && body.carLabel.trim() ? body.carLabel.trim() : undefined
    if (body.days !== undefined) quote.days = body.days === null || body.days === '' ? undefined : Number(body.days)
    if (body.dailyRate !== undefined) quote.dailyRate = body.dailyRate === null || body.dailyRate === '' ? undefined : Number(body.dailyRate)
    quote.currency = totals.currency
    quote.subtotal = totals.subtotal
    quote.taxAmount = totals.taxAmount
    quote.taxRate = totals.taxRate
    quote.total = totals.total
    await quote.save()
    await quote.populate(populate)
    res.json(quote)
  } catch (err) {
    logger.error('[quote.update]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

const TRANSITIONS: Record<string, string[]> = {
  [bookcarsTypes.QuoteStatus.Draft]: [bookcarsTypes.QuoteStatus.Sent, bookcarsTypes.QuoteStatus.Expired],
  [bookcarsTypes.QuoteStatus.Sent]: [bookcarsTypes.QuoteStatus.Accepted, bookcarsTypes.QuoteStatus.Expired],
  [bookcarsTypes.QuoteStatus.Accepted]: [],
  [bookcarsTypes.QuoteStatus.Expired]: [],
  [bookcarsTypes.QuoteStatus.Converted]: [],
}

export const transition = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const quote = await Quote.findOne({ _id: req.params.id, ...scope(req) })
    if (!quote) { res.sendStatus(404); return }
    const target = String(req.body?.status || '')
    const allowed = TRANSITIONS[quote.status] || []
    if (!allowed.includes(target)) {
      res.status(409).send(`Illegal quote transition: ${quote.status} -> ${target || '(none)'}`); return
    }
    quote.status = target as bookcarsTypes.QuoteStatus
    await quote.save()
    await quote.populate(populate)
    res.json(quote)
  } catch (err) {
    logger.error('[quote.transition]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const convert = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const quote = await Quote.findOne({ _id: req.params.id, ...scope(req) })
    if (!quote) { res.sendStatus(404); return }

    // Idempotent: a converted quote returns its existing invoice.
    if (quote.status === bookcarsTypes.QuoteStatus.Converted && quote.convertedInvoice) {
      const invoice = await Invoice.findById(quote.convertedInvoice)
      await quote.populate(populate)
      res.json({ quote, invoice })
      return
    }
    if (quote.status !== bookcarsTypes.QuoteStatus.Accepted) {
      res.status(409).send('Only accepted quotes can be converted to an invoice'); return
    }
    if (!quote.booking) {
      res.status(400).send('Quote has no linked booking: an invoice requires a booking. Link a booking to the quote before converting.'); return
    }
    const booking = await Booking.findOne({ _id: quote.booking, supplier: quote.supplier }).select('_id supplier price financialSnapshot status deletedAt')
    if (!booking || [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled].includes(booking.status)) {
      res.status(404).send('Contract not found'); return
    }
    // GA-PAR-22: converting a quote whose booking is trashed would
    // create an invoice against a trashed contract — refuse 409.
    if (booking.deletedAt) {
      res.status(409).send('TRASHED: This booking is trashed and cannot be modified. Restore it first.'); return
    }
    let invoice
    try {
      invoice = await createInvoiceForBooking(
        { _id: booking._id, supplier: booking.supplier, price: booking.price, financialSnapshot: booking.financialSnapshot, status: booking.status },
        { subtotal: quote.subtotal, taxAmount: quote.taxAmount, taxRate: quote.taxRate, currency: quote.currency },
      )
    } catch (err) {
      if (err instanceof InvoiceCreationError && err.code === 'ACTIVE_INVOICE_EXISTS') {
        res.status(409).send('An active invoice already exists for this contract'); return
      }
      throw err
    }
    quote.status = bookcarsTypes.QuoteStatus.Converted
    quote.convertedInvoice = invoice._id
    await quote.save()
    await quote.populate(populate)
    res.status(201).json({ quote, invoice })
  } catch (err) {
    logger.error('[quote.convert]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const getQuotePdf = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const quote = await Quote.findOne({ _id: req.params.id, ...scope(req) })
    if (!quote) { res.sendStatus(404); return }
    const [supplier, booking, client, car] = await Promise.all([
      User.findById(quote.supplier)
        .select('fullName email phone ice registreCommerce identifiantFiscal patente rib fiscalAddress city')
        .lean(),
      quote.booking
        ? Booking.findById(quote.booking).populate([
          { path: 'driver', select: 'fullName email phone cinNumber' },
          { path: 'car', select: 'name licensePlate' },
        ]).lean()
        : Promise.resolve(null),
      quote.client ? User.findById(quote.client).select('fullName phone cinNumber').lean() : Promise.resolve(null),
      quote.car ? Car.findById(quote.car).select('name licensePlate').lean() : Promise.resolve(null),
    ])
    const bookingForPdf = booking || (car || client || quote.carLabel || quote.clientSnapshot
      ? {
        driver: client ? { fullName: client.fullName, phone: client.phone, cinNumber: client.cinNumber } : undefined,
        car: car ? { name: car.name, licensePlate: car.licensePlate } : undefined,
      }
      : null)
    const buffer = await renderInvoicePdf({
      kind: 'quote',
      invoice: {
        number: quote.number,
        status: quote.status,
        currency: quote.currency,
        subtotal: quote.subtotal,
        taxAmount: quote.taxAmount,
        taxRate: quote.taxRate,
        total: quote.total,
        paidAmount: 0,
        issuedAt: quote.createdAt,
      },
      supplier: supplier as never,
      booking: bookingForPdf as never,
      clientName: !booking && !client ? quote.clientSnapshot?.name : undefined,
      clientPhone: !booking && !client ? quote.clientSnapshot?.phone : undefined,
      clientCin: !booking && !client ? quote.clientSnapshot?.cinNumber : undefined,
      carLabel: !booking && !car ? quote.carLabel : undefined,
    })
    res.type('application/pdf')
      .set('Cache-Control', 'private, no-store')
      .set('Content-Disposition', `attachment; filename="quote-${quote.number || quote._id}.pdf"`)
      .send(buffer)
  } catch (err) {
    logger.error('[quote.getQuotePdf]', err); res.status(400).send(i18n.t('ERROR'))
  }
}
