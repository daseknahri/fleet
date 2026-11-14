import { PDFDocument, PDFImage, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'

/**
 * GA-PAR-14 — contract snapshot PDF renderer (generate-on-demand).
 *
 * Pure renderer in the PAR-03 invoicePdf / PAR-17 carPdf / PAR-24
 * cashSessionPdf tradition: the caller (contractOperationController.
 * createSnapshot) reads the stored booking + inspections + charges and
 * passes every figure in; the renderer NEVER recomputes money, it only
 * formats the figures it is given. No file is stored and no collection
 * is written by this module; the controller stores the bytes and the
 * ContractSnapshot record (SHA-256 versioned, as before).
 *
 * What PAR-14 adds to the snapshot (scorecard row #14):
 *  - STAMP: the agency's stamp image, bottom-right (same placement as
 *    the PAR-03 invoice renderer), only when the caller passes one.
 *    A stamp-less agency renders cleanly with no placeholder artefact
 *    (the N7 discipline from invoicePdf).
 *  - QR: a QR code, bottom-centre, encoding the booking reference plus
 *    the agency identifier (see contractSnapshotQrPayload). No URL, no
 *    token, no signature material — the payload is display data only
 *    and no new public verification endpoint is invented.
 *  - ÉTAT GRID: the out (handover) + in (return) inspection checklists
 *    (spare wheel & tools, radio, washed) as one grid. A missing
 *    inspection or a missing checklist key prints 'not recorded' —
 *    never a fabricated state. A booking with no inspections at all
 *    prints the explicit 'No inspection recorded.' empty state.
 *
 * Text discipline (same as invoicePdf / cashSessionPdf): pdf-lib's
 * standard Helvetica encodes WinAnsi only, so typographic characters
 * are folded and anything outside Latin-1 is dropped. French labels
 * are Latin-1 and survive; Arabic script cannot be rendered by this
 * path, so the new sections carry EN + FR labels (the same limitation
 * as every other PDF in the product — the admin UI itself stays fully
 * FR/AR). The grid uses the established `|`-column rows the invoice,
 * Z-report and snapshot already use.
 */

// QR payload (recorded decision, GA-PAR-14): `GA-CONTRACT:<reference>:
// <supplierId>`. The `GA-CONTRACT:` prefix makes the code self-describing
// so a bare reference can never be mistaken for it; the two fields are
// exactly the brief's "booking reference plus the agency identifier".
// Nothing secret is encoded: the reference is already printed on the
// document and the supplier ObjectId is a non-secret record identifier.
export const contractSnapshotQrPayload = (reference: string, supplierId: string): string =>
  `GA-CONTRACT:${reference}:${supplierId}`

export const generateContractQrPng = async (payload: string): Promise<Buffer> =>
  QRCode.toBuffer(payload, { errorCorrectionLevel: 'M', margin: 1, width: 240 })

export interface ContractSnapshotPdfChecklist {
  spareWheelAndTools?: boolean
  radio?: boolean
  washed?: boolean
}

export interface ContractSnapshotPdfInspection {
  type: string
  occurredAt: Date | string
  odometer?: number | null
  fuelLevel?: number | null
  condition?: string
  damageNote?: string
  checklist?: ContractSnapshotPdfChecklist | null
}

export interface ContractSnapshotPdfCharge {
  type: string
  amount: number
  currency: string
  reason: string
  status: string
}

export interface ContractSnapshotPdfInput {
  reference: string
  rentalTotal?: number
  currency: string
  inspections: ContractSnapshotPdfInspection[]
  charges: ContractSnapshotPdfCharge[]
  onlineSignature?: { signedAt: Date | string, contentHash?: string } | null
  /** Stored online-signature PNG bytes (PAR-12); corrupt bytes degrade to text-only. */
  signatureImage?: Buffer | Uint8Array | null
  /** Agency stamp image bytes (PAR-14); only embedded when present and decodable. */
  stampImage?: Buffer | Uint8Array | null
  /** True when the caller asked for a stamp (withStamp). The text line
   *  reports the ACTUAL embed outcome (see renderContractSnapshotPdf),
   *  never this flag alone. */
  stampRequested: boolean
  /** Rendered QR PNG for qrPayload; a failed generation degrades to the text line only. */
  qrPng?: Buffer | Uint8Array | null
  qrPayload: string
  generatedAt: Date | string
}

// Same WinAnsi discipline as invoicePdf.ts: fold typographic characters
// and drop anything outside Latin-1 so agency/client names with accents
// survive while exotic glyphs degrade instead of throwing.
const sanitize = (value: unknown): string => String(value ?? '')
  .replace(/—/g, '-')
  .replace(/–/g, '-')
  .replace(/’/g, "'")
  .replace(/‘/g, "'")
  .replace(/“/g, '"')
  .replace(/”/g, '"')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')

const CHECKLIST_ROWS: { key: keyof ContractSnapshotPdfChecklist, label: string }[] = [
  { key: 'spareWheelAndTools', label: 'Spare wheel & tools' },
  { key: 'radio', label: 'Radio' },
  { key: 'washed', label: 'Washed' },
]

const checklistState = (value: boolean | undefined): string =>
  value === true ? 'Yes' : value === false ? 'No' : 'not recorded'

const etatGridLines = (inspections: ContractSnapshotPdfInspection[]): string[] => {
  const lines = ['', 'Vehicle condition / État des lieux (handover -> return):']
  if (inspections.length === 0) {
    // Explicit empty state — never a crash, never a fabricated checklist.
    lines.push('No inspection recorded.')
    return lines
  }
  const latestOf = (type: string) => {
    const rows = inspections.filter((x) => x.type === type)
    return rows.length > 0 ? rows[rows.length - 1] : undefined
  }
  const handover = latestOf('handover')
  const returnInsp = latestOf('return')
  lines.push('Item | Out (handover) | In (return)')
  for (const row of CHECKLIST_ROWS) {
    const out = handover ? checklistState(handover.checklist?.[row.key]) : 'no inspection recorded'
    const inn = returnInsp ? checklistState(returnInsp.checklist?.[row.key]) : 'no inspection recorded'
    lines.push(`${row.label} | ${out} | ${inn}`)
  }
  return lines
}

export const renderContractSnapshotPdf = async (input: ContractSnapshotPdfInput): Promise<Buffer> => {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  // GA-PAR-14 FIX (F1): the stamp text line must reflect ACTUAL embed
  // success, not merely that bytes were read. A corrupt stamp file reads
  // fine but fails both embedPng/embedJpg, so the embed is attempted
  // here — before the text lines are composed — and the line below is
  // computed from the outcome. A missing/corrupt stamp degrades to a
  // stamp-less PDF (the caller logs the read failure), never to a failed
  // snapshot. The embedded image object is kept and drawn below.
  let stampImageObj: PDFImage | null = null
  let stampEmbedded = false
  if (input.stampImage && input.stampImage.length > 0) {
    try {
      try {
        stampImageObj = await pdf.embedPng(input.stampImage)
      } catch {
        stampImageObj = await pdf.embedJpg(input.stampImage)
      }
      stampEmbedded = true
    } catch {
      // Corrupt stamp bytes: no image embedded, and the text line says so.
      stampImageObj = null
    }
  }

  // The pre-PAR-14 text block is reproduced verbatim (PAR-02 reference,
  // PAR-12 signature lines); PAR-14 appends the état grid, the stamp line
  // and the QR payload line after it.
  const lines: string[] = [
    'Gestion Auto contract snapshot',
    `Contract: ${input.reference}`,
    `Generated: ${new Date(input.generatedAt).toISOString()}`,
    `Rental total: ${input.rentalTotal ?? '-'} ${input.currency}`,
    '',
    'Inspections:',
    ...input.inspections.map((x) => `${x.type} | ${new Date(x.occurredAt).toISOString()} | odometer ${x.odometer ?? '-'} | fuel ${x.fuelLevel ?? '-'} | ${x.condition || ''} | damage ${x.damageNote || '-'}`),
  ]
  lines.push(...etatGridLines(input.inspections))
  lines.push(
    '',
    'Approved charges:',
    ...input.charges.filter((x) => x.status === 'approved').map((x) => `${x.type} | ${x.amount} ${x.currency} | ${x.reason}`),
    // GA-PAR-12: when the client signed online before this snapshot was
    // created, the snapshot records it (timestamp line here, signature
    // image embedded below). Existing snapshots are never re-rendered —
    // snapshots stay immutable once created.
    ...(input.onlineSignature?.signedAt
      ? ['', `Client signed online: ${new Date(input.onlineSignature.signedAt).toISOString()}`, `Signature SHA-256: ${input.onlineSignature.contentHash || ''}`]
      : []),
    '',
    input.stampRequested
      ? (stampEmbedded ? 'Stamp: included' : 'Stamp: not included (no stamp on file)')
      : 'Stamp: not included',
    `Contract QR: ${input.qrPayload}`,
  )

  page.drawText(sanitize(lines.join('\n')), {
    x: 36, y: 756, size: 9, font, color: rgb(0.1, 0.1, 0.1), maxWidth: 540, lineHeight: 13,
  })

  // GA-PAR-12: embed the recorded online signature image at the foot of
  // the snapshot when one exists at snapshot-creation time. A missing /
  // corrupt file degrades to the timestamp/hash text lines above (the
  // caller logs the read failure), never to a failed snapshot.
  if (input.signatureImage && input.signatureImage.length > 0) {
    try {
      const signatureImage = await pdf.embedPng(input.signatureImage)
      const scale = Math.min(200 / signatureImage.width, 64 / signatureImage.height, 1)
      page.drawText('Client signature (signed online):', { x: 36, y: 108, size: 9, font, color: rgb(0.1, 0.1, 0.1) })
      page.drawImage(signatureImage, {
        x: 36,
        y: 36,
        width: signatureImage.width * scale,
        height: signatureImage.height * scale,
      })
    } catch {
      // A corrupt signature buffer must never break snapshot generation.
    }
  }

  // GA-PAR-14: QR code, bottom-centre between the signature (x 36-236)
  // and the stamp (x 456-576). The payload is also printed as a text
  // line above, so the document stays verifiable without image decoding.
  if (input.qrPng && input.qrPng.length > 0) {
    try {
      const qrImage = await pdf.embedPng(input.qrPng)
      page.drawText('Scan to verify contract:', { x: 258, y: 140, size: 9, font, color: rgb(0.1, 0.1, 0.1) })
      page.drawImage(qrImage, { x: 258, y: 36, width: 96, height: 96 })
    } catch {
      // A corrupt QR buffer must never break snapshot generation.
    }
  }

  // GA-PAR-14: agency stamp, bottom-right (same placement as the PAR-03
  // invoice renderer). Only drawn when the embed above succeeded; a
  // stamp-less agency renders cleanly with no placeholder artefact.
  // The embed was already attempted before the text lines were composed
  // (F1 fix), so this block only draws the stored image object.
  if (stampImageObj) {
    const width = Math.min(120, (stampImageObj.width / stampImageObj.height) * 110)
    const height = (stampImageObj.height / stampImageObj.width) * width
    page.drawImage(stampImageObj, { x: 612 - 36 - width, y: 36, width, height })
  }

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}

export default renderContractSnapshotPdf
