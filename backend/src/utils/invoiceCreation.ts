import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import User from '../models/User'
import Invoice from '../models/Invoice'
import { DEFAULT_VAT_RATE } from './fiscal'
import { currencyExponent, toMinorUnits } from './paymentAmount'
import * as logger from './logger'

/**
 * GA-PAR-05 — shared invoice creation path (Option B).
 *
 * This util is the ONE creation path for invoices: the manual create
 * endpoint (invoiceController.create), the booking auto-draft hook
 * (ensureDraftInvoice) and quote conversion (quoteController.convert) all
 * funnel through createInvoiceForBooking, so the PAR-01 tax behaviour and
 * the one-active-invoice guard exist exactly once.
 *
 * PAR-01 tax behaviour, preserved verbatim from the original controller:
 * - an explicit taxAmount override is respected exactly as supplied and
 *   taxRate stays null;
 * - otherwise, when the supplier has VAT enabled, taxAmount is computed
 *   from the stored rate (falling back to the standard 20% when none was
 *   stored) and the applied rate is snapshotted on the invoice;
 * - otherwise taxAmount is 0 and taxRate is null.
 *
 * The one-active guard is the established query guard: a non-voided
 * invoice for (booking, supplier) blocks creation. Callers that need the
 * guard as an HTTP contract use InvoiceCreationError with code
 * 'ACTIVE_INVOICE_EXISTS' and map it to 409.
 */

export class InvoiceCreationError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface CreateInvoiceOptions {
  /** Explicit tax override (PAR-01 manual-override semantics). */
  taxAmount?: number | null
  /** Explicit totals (quote conversion: the invoice must carry the
   * quote's totals verbatim, not a recomputation from the booking). */
  subtotal?: number
  taxRate?: number | null
  currency?: string
}

type BookingLike = {
  _id: mongoose.Types.ObjectId | string
  supplier: mongoose.Types.ObjectId | string
  price?: number
  financialSnapshot?: { rentalTotal?: number, baseCurrency?: string } | null
  status?: string
}

export const findActiveInvoice = async (bookingId: string | mongoose.Types.ObjectId, supplierId: string | mongoose.Types.ObjectId) => Invoice.findOne({
  booking: bookingId,
  supplier: supplierId,
  status: { $ne: bookcarsTypes.InvoiceStatus.Voided },
})

export const createInvoiceForBooking = async (
  booking: BookingLike,
  options: CreateInvoiceOptions = {},
) => {
  const supplierId = booking.supplier
  const existing = await findActiveInvoice(booking._id, supplierId)
  if (existing) {
    throw new InvoiceCreationError('ACTIVE_INVOICE_EXISTS', 'An active invoice already exists for this contract')
  }

  const currency = (options.currency || booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
  const exponent = currencyExponent(currency)
  const subtotal = options.subtotal !== undefined && options.subtotal !== null
    ? Number(Number(options.subtotal).toFixed(exponent))
    : Number(Number(booking.financialSnapshot?.rentalTotal || booking.price || 0).toFixed(exponent))

  const hasExplicitTax = options.taxAmount !== undefined && options.taxAmount !== null
  let taxAmount: number
  let taxRate: number | null = null
  if (hasExplicitTax) {
    taxAmount = Number(Number(options.taxAmount).toFixed(exponent))
    taxRate = options.taxRate !== undefined ? options.taxRate : null
  } else if (options.subtotal !== undefined && options.subtotal !== null) {
    // Totals were supplied verbatim (quote conversion): no recomputation.
    taxAmount = 0
    taxRate = options.taxRate !== undefined ? options.taxRate : null
  } else {
    const supplier = await User.findById(supplierId).select('vatEnabled vatRate').lean()
    if (supplier?.vatEnabled) {
      taxRate = typeof supplier.vatRate === 'number' && Number.isFinite(supplier.vatRate) ? supplier.vatRate : DEFAULT_VAT_RATE
      taxAmount = Number((subtotal * (taxRate / 100)).toFixed(exponent))
    } else {
      taxAmount = 0
    }
  }
  if (!Number.isFinite(taxAmount) || taxAmount < 0 || !Number.isFinite(subtotal) || subtotal < 0) {
    throw new InvoiceCreationError('INVALID_TAX', 'Invalid tax amount')
  }

  const invoice = await Invoice.create({
    supplier: supplierId,
    booking: booking._id,
    status: bookcarsTypes.InvoiceStatus.Draft,
    currency,
    subtotal,
    taxAmount,
    taxRate,
    total: (toMinorUnits(subtotal, currency) + toMinorUnits(taxAmount, currency)) / (10 ** exponent),
  })
  return invoice
}

/**
 * GA-PAR-11 / N10 — refresh a DRAFT invoice after a contract amendment.
 * The subtotal follows the booking's new snapshot rental total and the
 * tax is recomputed by PAR-01's rule as recorded on the invoice: when
 * the invoice carries a snapshotted taxRate, the tax is recomputed from
 * that rate; when taxRate is null the recorded taxAmount was either an
 * explicit PAR-01 override (respected verbatim at creation) or a
 * VAT-off zero — both are preserved verbatim rather than re-derived.
 * Issued invoices never reach this helper (the amendment is refused
 * while one exists); voided invoices are not refreshed.
 */
export const refreshDraftInvoiceAfterAmendment = async (
  invoice: { _id: unknown, status: string, taxRate?: number | null, taxAmount: number, currency: string },
  newSubtotal: number,
  save: (doc: { subtotal: number, taxAmount: number, total: number }) => Promise<void>,
) => {
  if (invoice.status !== bookcarsTypes.InvoiceStatus.Draft) {
    return false
  }
  const currency = (invoice.currency || env.BASE_CURRENCY).toUpperCase()
  const exponent = currencyExponent(currency)
  const subtotal = Number(Number(newSubtotal).toFixed(exponent))
  const taxAmount = typeof invoice.taxRate === 'number' && Number.isFinite(invoice.taxRate)
    ? Number((subtotal * (invoice.taxRate / 100)).toFixed(exponent))
    : Number(Number(invoice.taxAmount).toFixed(exponent))
  const total = (toMinorUnits(subtotal, currency) + toMinorUnits(taxAmount, currency)) / (10 ** exponent)
  await save({ subtotal, taxAmount, total })
  return true
}

/**
 * Idempotent auto-draft used by the booking creation funnels (GA-PAR-05).
 * Mirrors the approvals producer's contract (utils/approvalProducer.ts):
 * it NEVER throws into the booking flow — an existing active invoice is
 * the expected outcome on replay, and any other failure is logged and
 * swallowed so the booking stands. Drafts only: this helper never issues,
 * so it can never fire the approvals producer.
 */
export const ensureDraftInvoice = async (booking: BookingLike | null | undefined): Promise<void> => {
  try {
    if (!booking || !booking._id || !booking.supplier) {
      return
    }
    if ([bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled].includes(booking.status as bookcarsTypes.BookingStatus)) {
      return
    }
    const existing = await findActiveInvoice(booking._id, booking.supplier)
    if (existing) {
      return
    }
    const full = await Booking.findOne({ _id: booking._id, supplier: booking.supplier })
      .select('_id supplier price financialSnapshot status deletedAt')
      .lean()
    // GA-PAR-22: a trashed booking gets no (new) draft invoice.
    if (!full || full.deletedAt || [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled].includes(full.status)) {
      return
    }
    await createInvoiceForBooking(full as unknown as BookingLike)
  } catch (err) {
    if (err instanceof InvoiceCreationError && err.code === 'ACTIVE_INVOICE_EXISTS') {
      return
    }
    logger.error('[invoiceCreation.ensureDraftInvoice]', err)
  }
}

export default createInvoiceForBooking
