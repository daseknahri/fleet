import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * GA-PAR-03 — invoice PDF renderer (generate-on-demand).
 *
 * Pure renderer: invoice record (+ populated supplier / booking) -> PDF
 * Buffer. No file is stored and no collection is written; the route streams
 * the buffer. Mirrors the contract-snapshot PDF discipline in
 * contractOperationController (pdf-lib, Helvetica, single text block).
 *
 * Money discipline: HT / TVA / TTC and the amount received are displayed
 * exactly as stored on the invoice record (PAR-01 computed them at create
 * time). The renderer NEVER recomputes VAT.
 *
 * Stamp (N7): the renderer accepts an optional stamp image buffer
 * (PNG/JPG). No stamp field or upload exists in the product today, so no
 * caller passes one in this item; when none is given the document is
 * generated cleanly with no placeholder artefact.
 */

export interface InvoicePdfSupplier {
  fullName?: string
  email?: string
  phone?: string
  ice?: string
  registreCommerce?: string
  identifiantFiscal?: string
  patente?: string
  rib?: string
  fiscalAddress?: string
  city?: string
}

export interface InvoicePdfDriver {
  fullName?: string
  email?: string
  phone?: string
  cinNumber?: string
}

export interface InvoicePdfCar {
  name?: string
  licensePlate?: string
}

export interface InvoicePdfBooking {
  _id?: unknown
  reference?: string
  driver?: InvoicePdfDriver | string
  car?: InvoicePdfCar | string
}

export interface InvoicePdfInvoice {
  _id?: unknown
  number?: string
  status?: string
  currency: string
  subtotal: number
  taxAmount: number
  taxRate?: number | null
  total: number
  paidAmount?: number
  paymentStatus?: string
  issuedAt?: Date | string
}

export interface InvoicePdfInput {
  invoice: InvoicePdfInvoice
  supplier?: InvoicePdfSupplier | null
  booking?: InvoicePdfBooking | null
  stampImage?: Buffer | Uint8Array | null
  /**
   * GA-PAR-05: document kind. 'invoice' (default) renders exactly the
   * PAR-03 invoice document. 'quote' renders a DEVIS: the quote's own
   * DV- number, no fiscal-number claim, and the TVA line mirrors the
   * quote record's stored taxAmount (never recomputed).
   */
  kind?: 'invoice' | 'quote'
  /** Free-entry client (quotes without a registered client/booking). */
  clientName?: string
  clientPhone?: string
  clientCin?: string
  /** Free-entry vehicle label (quotes without a registered car). */
  carLabel?: string
}

// pdf-lib's standard Helvetica encodes WinAnsi only: fold common typographic
// characters and drop anything outside Latin-1 so agency/client names with
// accents survive while exotic glyphs degrade instead of throwing.
const sanitize = (value: unknown): string => String(value ?? '')
  .replace(/—/g, '-')
  .replace(/–/g, '-')
  .replace(/’/g, "'")
  .replace(/‘/g, "'")
  .replace(/“/g, '"')
  .replace(/”/g, '"')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')

const money = (amount: number, currency: string): string => `${Number(amount || 0).toFixed(2)} ${currency}`

const asObject = <T,>(value: T | string | undefined | null): T | undefined => (
  value && typeof value === 'object' ? value as T : undefined
)

export const renderInvoicePdf = async ({ invoice, supplier, booking, stampImage, kind, clientName, clientPhone, clientCin, carLabel }: InvoicePdfInput): Promise<Buffer> => {
  const isQuote = kind === 'quote'
  const currency = (invoice.currency || 'MAD').toUpperCase()
  const driver = asObject<InvoicePdfDriver>(booking?.driver)
  const car = asObject<InvoicePdfCar>(booking?.car)
  const paidAmount = Number(invoice.paidAmount || 0)
  const remaining = Number((invoice.total - paidAmount).toFixed(2))

  const lines: string[] = isQuote
    ? [
      'Gestion Auto - DEVIS',
      `Quote number: ${invoice.number || '-'}`,
      `Date: ${invoice.issuedAt ? new Date(invoice.issuedAt).toISOString() : '-'}`,
      `Status: ${invoice.status || ''}`,
      '',
      'Agency:',
      supplier?.fullName || '-',
    ]
    : [
      'Gestion Auto - Invoice',
      `Invoice number: ${invoice.number || '-'}`,
      `Issued: ${invoice.issuedAt ? new Date(invoice.issuedAt).toISOString() : '-'}`,
      `Status: ${invoice.status || ''}`,
      '',
      'Agency:',
      supplier?.fullName || '-',
    ]
  if (supplier?.fiscalAddress) lines.push(`Address: ${supplier.fiscalAddress}`)
  if (supplier?.city) lines.push(`City: ${supplier.city}`)
  if (supplier?.phone) lines.push(`Phone: ${supplier.phone}`)
  if (supplier?.email) lines.push(`Email: ${supplier.email}`)
  // Fiscal identity (PAR-01) — values printed byte-identical to the record.
  if (supplier?.ice) lines.push(`ICE: ${supplier.ice}`)
  if (supplier?.registreCommerce) lines.push(`RC: ${supplier.registreCommerce}`)
  if (supplier?.identifiantFiscal) lines.push(`IF: ${supplier.identifiantFiscal}`)
  if (supplier?.patente) lines.push(`Patente: ${supplier.patente}`)
  if (supplier?.rib) lines.push(`RIB: ${supplier.rib}`)

  lines.push('', 'Client:')
  lines.push(driver?.fullName || clientName || '-')
  if (driver?.email) lines.push(`Email: ${driver.email}`)
  if (driver?.phone || clientPhone) lines.push(`Phone: ${driver?.phone || clientPhone}`)
  if (driver?.cinNumber || clientCin) lines.push(`CIN: ${driver?.cinNumber || clientCin}`)

  lines.push('', 'Vehicle:')
  lines.push(car?.name || carLabel || '-')
  if (car?.licensePlate) lines.push(`Plate: ${car.licensePlate}`)
  if (booking) lines.push(`Contract: ${booking.reference || booking._id || '-'}`)

  if (isQuote) {
    lines.push(
      '',
      'Lines:',
      `Rental: ${money(invoice.subtotal, currency)}`,
      '',
      `Subtotal (HT): ${money(invoice.subtotal, currency)}`,
      `VAT (TVA)${typeof invoice.taxRate === 'number' ? ` ${invoice.taxRate}%` : ''}: ${money(invoice.taxAmount, currency)}`,
      `Total (TTC): ${money(invoice.total, currency)}`,
    )
  } else {
    lines.push(
      '',
      'Lines:',
      `Rental: ${money(invoice.subtotal, currency)}`,
      '',
      `Subtotal (HT): ${money(invoice.subtotal, currency)}`,
      `VAT (TVA)${typeof invoice.taxRate === 'number' ? ` ${invoice.taxRate}%` : ''}: ${money(invoice.taxAmount, currency)}`,
      `Total (TTC): ${money(invoice.total, currency)}`,
      `Amount received: ${money(paidAmount, currency)}`,
      `Remaining: ${money(remaining, currency)}`,
    )
  }

  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText(sanitize(lines.join('\n')), {
    x: 36, y: 756, size: 10, font, color: rgb(0.1, 0.1, 0.1), maxWidth: 540, lineHeight: 14,
  })

  if (stampImage && stampImage.length > 0) {
    try {
      let image
      try {
        image = await pdf.embedPng(stampImage)
      } catch {
        image = await pdf.embedJpg(stampImage)
      }
      const width = 120
      const height = (image.height / image.width) * width
      page.drawImage(image, { x: 612 - 36 - width, y: 36, width, height })
    } catch {
      // A corrupt stamp buffer must never break invoice generation.
    }
  }

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}

export default renderInvoicePdf
