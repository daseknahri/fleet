import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * GA-PAR-17 — per-car report PDF renderer (generate-on-demand).
 *
 * Pure renderer in the PAR-03 invoicePdf tradition: the caller
 * (reportController.carPdf) computes every figure through the SAME
 * computePeriod core as the reports builder, so the document can
 * never disagree with the builder JSON. No file is stored and no
 * collection is written; the route streams the buffer.
 */

export interface CarPdfSupplier {
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

export interface CarPdfFigures {
  contractAmount: number
  collected: number
  remaining: number
  expenses: number
  netCollected: number
  bookingsCount: number
  occupancyPct: number
}

export interface CarPdfBookingLine {
  reference?: string
  client?: string
  from: Date
  to: Date
  contractAmount: number
  collected: number
}

export interface CarPdfExpenseLine {
  date: Date
  category: string
  amount: number
}

export interface CarPdfInput {
  supplier?: CarPdfSupplier | null
  car: { name?: string, licensePlate?: string }
  from: Date
  to: Date
  currency: string
  metricDictionaryVersion: string
  figures: CarPdfFigures
  bookings: CarPdfBookingLine[]
  expenses: CarPdfExpenseLine[]
}

// Same WinAnsi discipline as invoicePdf.ts: fold typographic characters
// and drop anything outside Latin-1 so names survive pdf-lib Helvetica.
const sanitize = (value: unknown): string => String(value ?? '')
  .replace(/—/g, '-')
  .replace(/–/g, '-')
  .replace(/’/g, "'")
  .replace(/‘/g, "'")
  .replace(/“/g, '"')
  .replace(/”/g, '"')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')

const money = (amount: number, currency: string): string => `${Number(amount || 0).toFixed(2)} ${currency}`
const day = (d: Date): string => new Date(d).toISOString().slice(0, 10)

export const renderCarPdf = async (input: CarPdfInput): Promise<Buffer> => {
  const { supplier, car, figures } = input
  const currency = (input.currency || 'MAD').toUpperCase()
  const lines: string[] = [
    'Gestion Auto - Per-car report',
    `Period: ${day(input.from)} to ${day(input.to)}`,
    `Metric dictionary: v${input.metricDictionaryVersion}`,
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

  lines.push('', 'Vehicle:')
  lines.push(car.name || '-')
  if (car.licensePlate) lines.push(`Plate: ${car.licensePlate}`)

  lines.push(
    '',
    'Figures (metric dictionary definitions):',
    `Contract amount: ${money(figures.contractAmount, currency)}`,
    `Collected: ${money(figures.collected, currency)}`,
    `Remaining: ${money(figures.remaining, currency)}`,
    `Expenses: ${money(figures.expenses, currency)}`,
    `Net collected: ${money(figures.netCollected, currency)}`,
    `Bookings: ${figures.bookingsCount}`,
    `Occupancy: ${Number(figures.occupancyPct || 0).toFixed(2)}%`,
    '',
    'Bookings:',
  )
  if (input.bookings.length === 0) {
    lines.push('(none)')
  }
  for (const b of input.bookings) {
    lines.push(`${b.reference || '-'} | ${b.client || '-'} | ${day(b.from)} to ${day(b.to)} | Amount: ${money(b.contractAmount, currency)} | Collected: ${money(b.collected, currency)}`)
  }
  lines.push('', 'Expenses:')
  if (input.expenses.length === 0) {
    lines.push('(none)')
  }
  for (const e of input.expenses) {
    lines.push(`${day(e.date)} | ${e.category} | ${money(e.amount, currency)}`)
  }

  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontSize = 10
  const lineHeight = 14
  const perPage = 52
  for (let i = 0; i < lines.length; i += perPage) {
    const page = pdf.addPage([612, 792])
    page.drawText(sanitize(lines.slice(i, i + perPage).join('\n')), {
      x: 36, y: 756, size: fontSize, font, color: rgb(0.1, 0.1, 0.1), maxWidth: 540, lineHeight,
    })
  }
  const bytes = await pdf.save()
  return Buffer.from(bytes)
}

export default renderCarPdf
