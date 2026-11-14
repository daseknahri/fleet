import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * GA-PAR-24 — per-session cash closing (Z) report renderer (generate-on-demand).
 *
 * Pure renderer in the PAR-03 invoicePdf / PAR-17 carPdf tradition: the
 * caller (cashController.zReport) reads the stored session + movement rows
 * and passes every figure in; the renderer NEVER computes money, it only
 * formats the figures it is given. No file is stored and no collection is
 * written; the route streams the buffer.
 *
 * Money discipline: expected / counted / discrepancy are printed exactly as
 * stored on the CashSession record. Movement in/out totals are the sums of
 * the stored CashMovement rows, split by the established confirmed-only
 * rule (the same rule close() uses: pending CounterAgent entries do NOT
 * count toward the expected balance). Pending movements are listed
 * separately with their own totals so the queue state at close is visible.
 *
 * Deposits: no deposit balance is stored on a cash session (deposit
 * payments are RentalPayment rows, purpose deposit, and are never posted
 * into a session), so the report states that explicitly instead of
 * inventing a date-window attribution. A deposit received as a manual
 * movement appears in the movement detail with its reference.
 */

export interface CashSessionPdfSupplier {
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

export interface CashSessionPdfMovementLine {
  date: Date | string
  direction: string
  source: string
  status: string
  reference?: string
  note?: string
  amount: number
}

export interface CashSessionPdfInput {
  supplier?: CashSessionPdfSupplier | null
  /** Last 8 chars of the session ObjectId — no session number exists. */
  sessionShortId: string
  account: string
  currency: string
  openedAt: Date | string
  openedByName?: string
  openingBalance: number
  status: string
  closedAt?: Date | string
  closedByName?: string
  /** Stored reconciliation fields, printed verbatim. */
  expectedClosingBalance: number
  countedClosingBalance: number
  discrepancy: number
  closingNote?: string
  /** Confirmed-movement sums (same rule as close()). */
  confirmedIn: number
  confirmedInCount: number
  confirmedOut: number
  confirmedOutCount: number
  /** Pending-movement sums (excluded from the expected balance). */
  pendingIn: number
  pendingOut: number
  pendingCount: number
  /** Every movement of the session, date order. */
  movements: CashSessionPdfMovementLine[]
  generatedAt: Date | string
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

const signedMoney = (amount: number, currency: string): string => {
  const value = Number(amount || 0)
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(2)} ${currency}`
}

const dayTime = (d: Date | string): string => new Date(d).toISOString().replace('T', ' ').slice(0, 19)

const movementsLabel = (count: number): string => `${count} movement${count === 1 ? '' : 's'}`

export const renderCashSessionPdf = async (input: CashSessionPdfInput): Promise<Buffer> => {
  const currency = (input.currency || 'MAD').toUpperCase()
  const supplier = input.supplier
  const confirmedNet = Number((input.confirmedIn - input.confirmedOut).toFixed(2))
  const pendingMovements = input.movements.filter((m) => m.status === 'pending')

  const lines: string[] = [
    'Gestion Auto - Cash session closing report (Z-report)',
    `Session: ${input.account} - opened ${new Date(input.openedAt).toISOString().slice(0, 10)} - id ${input.sessionShortId}`,
    `Status: ${input.status}`,
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

  lines.push(
    '',
    'Session:',
    `Account: ${input.account}`,
    `Opened: ${dayTime(input.openedAt)} by ${input.openedByName || '-'}`,
    `Closed: ${input.closedAt ? dayTime(input.closedAt) : '-'} by ${input.closedByName || '-'}`,
    `Opening balance: ${money(input.openingBalance, currency)}`,
  )
  if (input.closingNote) lines.push(`Closing note: ${input.closingNote}`)

  lines.push(
    '',
    'Reconciliation (stored session fields):',
    `Expected closing balance: ${money(input.expectedClosingBalance, currency)}`,
    `Counted closing balance: ${money(input.countedClosingBalance, currency)}`,
    `Discrepancy: ${signedMoney(input.discrepancy, currency)}`,
    '',
    'Movements (confirmed only count toward the expected balance):',
    `Confirmed in: ${money(input.confirmedIn, currency)} (${movementsLabel(input.confirmedInCount)})`,
    `Confirmed out: ${money(input.confirmedOut, currency)} (${movementsLabel(input.confirmedOutCount)})`,
    `Confirmed net: ${signedMoney(confirmedNet, currency)}`,
    `Opening + confirmed net: ${money(Number((input.openingBalance + confirmedNet).toFixed(2)), currency)}`,
    '',
    'Pending confirmation (not counted in the expected balance):',
    `Pending in: ${money(input.pendingIn, currency)}`,
    `Pending out: ${money(input.pendingOut, currency)}`,
    `Pending movements: ${input.pendingCount}`,
  )
  if (pendingMovements.length === 0) {
    lines.push('(none)')
  }
  for (const m of pendingMovements) {
    lines.push(`${dayTime(m.date)} | ${m.direction} | ${m.source} | pending | ${m.reference || '-'}${m.note ? ` | ${m.note}` : ''} | ${money(m.amount, currency)}`)
  }

  lines.push(
    '',
    'Deposits:',
    'No separate deposit balance is stored on the cash session. Deposit payments are recorded on contracts and are never posted into a cash session, so no deposit figure can be printed here. A deposit received as a manual movement appears in the movement detail below with its reference.',
    '',
    'Movements (all, in date order):',
  )
  if (input.movements.length === 0) {
    lines.push('(none)')
  }
  for (const m of input.movements) {
    lines.push(`${dayTime(m.date)} | ${m.direction} | ${m.source} | ${m.status} | ${m.reference || '-'}${m.note ? ` | ${m.note}` : ''} | ${money(m.amount, currency)}`)
  }

  lines.push(
    '',
    `Generated: ${dayTime(input.generatedAt)}`,
  )

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

export default renderCashSessionPdf
