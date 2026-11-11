import { Request, Response } from 'express'
import mongoose from 'mongoose'
import path from 'node:path'
import crypto from 'node:crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fs from 'node:fs/promises'
import * as bookcarsTypes from ':bookcars-types'
import Booking from '../models/Booking'
import ContractInspection from '../models/ContractInspection'
import ContractCharge from '../models/ContractCharge'
import ContractSnapshot from '../models/ContractSnapshot'
import Car from '../models/Car'
import AgencyReturnSettings from '../models/AgencyReturnSettings'
import { currencyExponent, toMinorUnits } from '../utils/paymentAmount'
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'
import { getContractReceivable } from '../utils/contractReceivable'
import * as helper from '../utils/helper'
import { inspectionTransition, validateInspectionFields } from '../utils/contractLifecycle'
import { contentMatchesExtension } from '../utils/fileContent'
import { approvalRequiredFor, mirrorApprovalDecision, produceApprovalRequest } from '../utils/approvalProducer'

const idFrom = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
return value
}
  if (value && typeof value === 'object' && '_id' in value) {
return String((value as { _id?: unknown })._id)
}
  return undefined
}

const supplierFor = (req: Request): string | undefined => req.user?.type === bookcarsTypes.UserType.Admin
  ? idFrom(req.query.supplier) || idFrom(req.body?.supplier)
  : agencySupplierId(req)

const bookingScope = async (req: Request, session?: mongoose.ClientSession) => {
  const supplier = supplierFor(req)
  const bookingId = req.params.bookingId
  if (!supplier || !mongoose.isValidObjectId(supplier) || !mongoose.isValidObjectId(bookingId)) {
return null
}
  const query = Booking.findOne({ _id: bookingId, supplier }).select('_id reference supplier car driver status lifecycle from to expireAt price financialSnapshot depositSettlement amendmentHistory onlineSignature')
  if (session) {
query.session(session)
}
  return query
}

const invalidBooking = (booking: env.Booking | null) => !booking
  || booking.status === bookcarsTypes.BookingStatus.Void
  || booking.status === bookcarsTypes.BookingStatus.Cancelled

const contractFile = (bookingId: string, filename: string) => path.resolve(env.CDN_CONTRACTS, `inspection_${bookingId}_${filename}`)
const safeContractFilename = (filename: string) => filename === path.basename(filename) && /^[A-Za-z0-9._-]+$/.test(filename)

export const list = async (req: Request, res: Response) => {
  try {
    const booking = await bookingScope(req)
    if (!booking) {
 res.sendStatus(404); return 
}
    const rows = await ContractInspection.find({ booking: booking._id, supplier: booking.supplier }).sort({ occurredAt: 1, createdAt: 1 })
      .populate('actor', 'fullName').populate('acknowledgedBy', 'fullName')
    res.json(rows)
  } catch (err) {
 logger.error('[contractOperations.list]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

const createInspection = async (req: Request, res: Response, type: bookcarsTypes.InspectionType) => {
  const session = await mongoose.startSession()
  try {
    let result: { booking: env.Booking; inspection: env.ContractInspection } | undefined
    await session.withTransaction(async () => {
      const booking = await bookingScope(req, session)
      if (invalidBooking(booking)) {
 throw new Error('CONTRACT_NOT_FOUND') 
}
      const payload = validateInspectionFields(req.body as bookcarsTypes.CreateContractInspectionPayload)
      if (!payload) {
 throw new Error('INVALID_INSPECTION') 
}
      // GA-PAR-06: a return odometer below the handover odometer is a
      // field-level invalid input — reject before anything persists.
      if (type === bookcarsTypes.InspectionType.Return && payload.odometer !== undefined) {
        const handover = await ContractInspection.findOne({ booking: booking!._id, supplier: booking!.supplier, type: bookcarsTypes.InspectionType.Handover }).sort({ occurredAt: -1, createdAt: -1 }).session(session)
        if (handover && handover.odometer !== undefined && handover.odometer !== null && payload.odometer < handover.odometer) {
          throw new Error('INVALID_INSPECTION')
        }
      }
      // Slotted photos are also appended to photoFiles so the snapshot /
      // completion logic that reads the legacy flat list is unchanged.
      const slottedFiles = (payload.photos || []).map((photo) => photo.file)
      const mergedPhotoFiles = [...new Set([...(payload.photoFiles || []), ...slottedFiles])]
      const referencedFiles = [...mergedPhotoFiles, ...(payload.signatureFile ? [payload.signatureFile] : [])]
      for (const filename of referencedFiles) {
        if (!safeContractFilename(filename) || !(await helper.pathExists(contractFile(String(booking!._id), filename)))) {
          throw new Error('MISSING_CONTRACT_FILE')
        }
      }
      const nextLifecycle = inspectionTransition(booking!.lifecycle, type, booking!.status)
      if (!nextLifecycle) {
throw new Error('INVALID_CONTRACT_TRANSITION')
}
      const actor = req.user?._id && mongoose.isValidObjectId(req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : undefined
      const [inspection] = await ContractInspection.create([{ supplier: booking!.supplier, booking: booking!._id, car: booking!.car, type, ...payload, photoFiles: mergedPhotoFiles, actor, acknowledgedBy: actor }], { session })
      booking!.lifecycle = nextLifecycle
      await booking!.save({ session })
      result = { booking: booking!, inspection }
    })
    if (!result) {
throw new Error('CONTRACT_OPERATION_FAILED')
}
    res.status(201).json(result)
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    if (code === 'CONTRACT_NOT_FOUND') {
 res.status(404).send('Contract not found'); return 
}
    if (code === 'INVALID_INSPECTION') {
 res.status(400).send('Invalid inspection'); return 
}
    if (code === 'MISSING_CONTRACT_FILE') {
 res.status(400).send('Referenced contract file is missing or invalid'); return 
}
    if (code === 'INVALID_CONTRACT_TRANSITION') {
 res.status(409).send('Invalid contract lifecycle transition'); return 
}
    logger.error(`[contractOperations.${type}]`, err); res.status(400).send(i18n.t('ERROR'))
  } finally {
 await session.endSession() 
}
}

export const uploadFile = async (req: Request, res: Response) => {
  try {
    const booking = await bookingScope(req)
    const file = req.file
    if (!booking || !file || !file.originalname) {
 res.status(404).send('Contract or file not found'); return 
}
    const ext = path.extname(file.originalname).toLowerCase()
    if (!['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext) || file.size <= 0 || file.size > 5 * 1024 * 1024 || !contentMatchesExtension(file.buffer, ext)) {
 res.status(400).send('Invalid contract file'); return 
}
    const filename = `${crypto.randomUUID()}${ext}`
    await fs.writeFile(contractFile(String(booking._id), filename), file.buffer, { flag: 'wx' })
    res.status(201).json({ filename, kind: req.body?.kind === 'signature' ? 'signature' : 'photo' })
  } catch (err) {
 logger.error('[contractOperations.uploadFile]', err); res.status(400).send('Unable to upload contract file') 
}
}

export const getFile = async (req: Request, res: Response) => {
  try {
    const booking = await bookingScope(req)
    const filename = String(req.params.filename || '')
    if (!booking || !safeContractFilename(filename)) {
 res.status(404).send('File not found'); return 
}
    const target = contractFile(String(booking._id), filename)
    if (!(await helper.pathExists(target))) {
 res.sendStatus(404); return 
}
    const ext = path.extname(filename).toLowerCase()
    res.type(ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg').set('Cache-Control', 'private, no-store').sendFile(target)
  } catch (err) {
 logger.error('[contractOperations.getFile]', err); if (!res.headersSent) {
res.status(400).send('Unable to download contract file')
} 
}
}

export const deleteFile = async (req: Request, res: Response) => {
  try {
    const booking = await bookingScope(req)
    const filename = String(req.params.filename || '')
    if (!booking || !safeContractFilename(filename)) {
 res.status(404).send('File not found'); return 
}
    if (await ContractInspection.exists({ booking: booking._id, $or: [{ photoFiles: filename }, { 'photos.file': filename }, { signatureFile: filename }] })) {
 res.status(409).send('Contract file is referenced by an inspection'); return 
}
    const target = contractFile(String(booking._id), filename)
    if (await helper.pathExists(target)) {
await fs.unlink(target)
}
    res.sendStatus(200)
  } catch (err) {
 logger.error('[contractOperations.deleteFile]', err); res.status(400).send('Unable to delete contract file') 
}
}

const chargeScope = async (req: Request) => {
  const booking = await bookingScope(req)
  return booking
}

export const listCharges = async (req: Request, res: Response) => {
  try {
    const booking = await chargeScope(req)
    if (!booking) {
 res.sendStatus(404); return 
}
    res.json(await ContractCharge.find({ booking: booking._id, supplier: booking.supplier }).sort({ createdAt: -1 }).populate('requestedBy decidedBy', 'fullName'))
  } catch (err) {
 logger.error('[contractOperations.listCharges]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const createCharge = async (req: Request, res: Response) => {
  try {
    const booking = await chargeScope(req)
    const type = String(req.body?.type || '')
    const reason = String(req.body?.reason || '').trim()
    const amount = Number(req.body?.amount)
    const currency = String(req.body?.currency || booking?.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
    const expectedCurrency = String(booking?.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
    if (!booking || !Object.values(bookcarsTypes.ContractChargeType).includes(type as bookcarsTypes.ContractChargeType)
      || reason.length < 3 || reason.length > 1000 || !Number.isFinite(amount) || amount <= 0 || currency !== expectedCurrency || !/^[A-Z]{3}$/.test(currency)) {
      res.status(400).send('Invalid contract charge'); return
    }
    const actor = req.user?._id && mongoose.isValidObjectId(req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : undefined
    const charge = await ContractCharge.create({ supplier: booking.supplier, booking: booking._id, inspection: req.body?.inspection, type: type as bookcarsTypes.ContractChargeType, reason, amount, currency, status: bookcarsTypes.ApprovalDecision.Pending, requestedBy: actor })
    // Approvals producer (decisions 1.1/1.2, GA-P10-DECISIONS-01): a charge
    // at or above the threshold also opens a queue request in /approbations.
    // The charge's own decision workflow stays the domain record; decisions
    // are mirrored both ways so the two never diverge.
    if (approvalRequiredFor(amount)) {
      try {
        await produceApprovalRequest({
          supplier: booking.supplier,
          subjectType: 'contract-charge',
          subject: charge._id.toString(),
          amount,
          currency,
          requestedBy: actor,
          reason: `Contract charge ${type} on booking ${booking._id}: ${reason}`,
        })
      } catch (producerErr) {
        logger.error('[contractOperations.createCharge] approval producer failed', producerErr)
      }
    }
    res.status(201).json(charge)
  } catch (err) {
 logger.error('[contractOperations.createCharge]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const decideCharge = async (req: Request, res: Response) => {
  try {
    const booking = await chargeScope(req)
    if (!booking) {
 res.sendStatus(404); return 
}
    const decision = String(req.body?.decision || '')
    const note = String(req.body?.note || '').trim()
    if (![bookcarsTypes.ApprovalDecision.Approved, bookcarsTypes.ApprovalDecision.Rejected].includes(decision as bookcarsTypes.ApprovalDecision) || note.length > 1000) {
 res.status(400).send('Invalid charge decision'); return 
}
    const actor = req.user?._id && mongoose.isValidObjectId(req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : undefined
    const charge = await ContractCharge.findOne({ _id: req.params.chargeId, booking: booking._id, supplier: booking.supplier, status: bookcarsTypes.ApprovalDecision.Pending })
    if (!charge) {
 res.sendStatus(404); return 
}
    charge.status = decision as bookcarsTypes.ApprovalDecision; charge.decidedBy = actor; charge.decidedAt = new Date(); charge.decisionNote = note || undefined
    await charge.save()
    // Mirror the decision onto the queue record (decision 1.6: the
    // Approval record is the single source of truth for the queue).
    try {
      await mirrorApprovalDecision({
        supplier: booking.supplier,
        subjectType: 'contract-charge',
        subject: charge._id.toString(),
        status: charge.status,
        decidedBy: actor,
        reason: note || undefined,
      })
    } catch (mirrorErr) {
      logger.error('[contractOperations.decideCharge] approval mirror failed', mirrorErr)
    }
    res.json(charge)
  } catch (err) {
 logger.error('[contractOperations.decideCharge]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

const snapshotText = (booking: env.Booking, inspections: env.ContractInspection[], charges: env.ContractCharge[]) => {
  const rows = [
    'Gestion Auto contract snapshot', `Contract: ${booking.reference || booking._id}`, `Generated: ${new Date().toISOString()}`,
    `Rental total: ${booking.financialSnapshot?.rentalTotal ?? booking.price} ${booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY}`,
    '', 'Inspections:', ...inspections.map((x) => `${x.type} | ${new Date(x.occurredAt).toISOString()} | odometer ${x.odometer ?? '-'} | fuel ${x.fuelLevel ?? '-'} | ${x.condition || ''} | damage ${x.damageNote || '-'}`),
    '', 'Approved charges:', ...charges.filter((x) => x.status === bookcarsTypes.ApprovalDecision.Approved).map((x) => `${x.type} | ${x.amount} ${x.currency} | ${x.reason}`),
    // GA-PAR-12: when the client signed online before this snapshot was
    // created, the snapshot records it (timestamp line here, signature
    // image embedded by createSnapshot). Existing snapshots are never
    // re-rendered — snapshots stay immutable once created.
    ...(booking.onlineSignature?.signedAt
      ? ['', `Client signed online: ${new Date(booking.onlineSignature.signedAt).toISOString()}`, `Signature SHA-256: ${booking.onlineSignature.contentHash || ''}`]
      : []),
  ]
  return rows.join('\n')
}

export const createSnapshot = async (req: Request, res: Response) => {
  try {
    const booking = await chargeScope(req)
    if (!booking) {
 res.sendStatus(404); return 
}
    const inspections = await ContractInspection.find({ booking: booking._id, supplier: booking.supplier }).sort({ occurredAt: 1 }).lean()
    const charges = await ContractCharge.find({ booking: booking._id, supplier: booking.supplier }).lean()
    if (inspections.length < 2 || (charges.some((x) => x.status === bookcarsTypes.ApprovalDecision.Pending))) {
 res.status(409).send('Both inspections and charge decisions are required'); return 
}
    const text = snapshotText(booking, inspections as env.ContractInspection[], charges as env.ContractCharge[])
    const pdf = await PDFDocument.create(); const page = pdf.addPage([612, 792]); const font = await pdf.embedFont(StandardFonts.Helvetica)
    page.drawText(text, { x: 36, y: 756, size: 9, font, color: rgb(0.1, 0.1, 0.1), maxWidth: 540, lineHeight: 13 })
    // GA-PAR-12: embed the recorded online signature image at the foot
    // of the snapshot when one exists at snapshot-creation time. The
    // PNG comes from the private contracts store; a missing/corrupt
    // file degrades to the timestamp/hash text lines above (logged),
    // never to a failed snapshot.
    if (booking.onlineSignature?.file) {
      try {
        const signatureBytes = await fs.readFile(path.resolve(env.CDN_CONTRACTS, booking.onlineSignature.file))
        const signatureImage = await pdf.embedPng(signatureBytes)
        const scale = Math.min(200 / signatureImage.width, 64 / signatureImage.height, 1)
        page.drawText('Client signature (signed online):', { x: 36, y: 108, size: 9, font, color: rgb(0.1, 0.1, 0.1) })
        page.drawImage(signatureImage, {
          x: 36,
          y: 36,
          width: signatureImage.width * scale,
          height: signatureImage.height * scale,
        })
      } catch (signatureErr) {
        logger.error('[contractOperations.createSnapshot] online signature embed failed', signatureErr)
      }
    }
    const bytes = await pdf.save(); const hash = crypto.createHash('sha256').update(bytes).digest('hex')
    const version = (await ContractSnapshot.countDocuments({ booking: booking._id })) + 1
    const filename = `${crypto.randomUUID()}.pdf`; await fs.writeFile(path.resolve(env.CDN_CONTRACTS, `snapshot_${booking._id}_${filename}`), bytes, { flag: 'wx' })
    const snapshot = await ContractSnapshot.create({ supplier: booking.supplier, booking: booking._id, version, pdfFile: filename, contentHash: hash, generatedAt: new Date() })
    res.status(201).json(snapshot)
  } catch (err) {
 logger.error('[contractOperations.createSnapshot]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const getSnapshotFile = async (req: Request, res: Response) => {
  try {
    const booking = await chargeScope(req); const filename = String(req.params.filename || '')
    if (!booking || !safeContractFilename(filename)) {
 res.sendStatus(404); return 
}
    const snapshot = await ContractSnapshot.findOne({ booking: booking._id, supplier: booking.supplier, pdfFile: filename })
    if (!snapshot) {
 res.sendStatus(404); return 
}
    res.type('application/pdf').set('Cache-Control', 'private, no-store').sendFile(path.resolve(env.CDN_CONTRACTS, `snapshot_${booking._id}_${filename}`))
  } catch (err) {
 logger.error('[contractOperations.getSnapshotFile]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

/**
 * GA-PAR-06 settlement preview: computes PROPOSED charge lines from the
 * handover + return inspections, the agency's AgencyReturnSettings rates
 * and the car's tank capacity. Persists nothing. Amounts are rounded to
 * the booking currency's minor unit (the house round2 convention used by
 * charges/invoices). rentalDays is the booking's priced day count:
 * helper.days(from, to) — the same ceil((to-from)/24h) count the price
 * logic uses. Every omitted line kind is reported in `unavailable` (and
 * its alias `omissions`) with a machine-readable reason — never a silent 0.
 */
export const settlementPreview = async (req: Request, res: Response) => {
  try {
    const booking = await bookingScope(req)
    if (invalidBooking(booking)) {
      res.status(404).send('Contract not found')
      return
    }
    const currency = String(booking!.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
    const exponent = currencyExponent(currency)
    const roundMoney = (value: number) => toMinorUnits(value, currency) / (10 ** exponent)
    const rentalDays = helper.days(booking!.from, booking!.to)
    const [handover, returnInsp, settings, car] = await Promise.all([
      ContractInspection.findOne({ booking: booking!._id, supplier: booking!.supplier, type: bookcarsTypes.InspectionType.Handover }).sort({ occurredAt: -1, createdAt: -1 }),
      ContractInspection.findOne({ booking: booking!._id, supplier: booking!.supplier, type: bookcarsTypes.InspectionType.Return }).sort({ occurredAt: -1, createdAt: -1 }),
      AgencyReturnSettings.findOne({ supplier: booking!.supplier }),
      Car.findById(booking!.car).select('tankCapacityLitres'),
    ])
    const tankCapacityLitres = typeof car?.tankCapacityLitres === 'number' ? car.tankCapacityLitres : null
    const rates = {
      includedKmPerDay: settings?.includedKmPerDay ?? null,
      extraKmPrice: settings?.extraKmPrice ?? null,
      fuelPricePerLitre: settings?.fuelPricePerLitre ?? null,
      washFee: settings?.washFee ?? null,
      defaultDeposit: settings?.defaultDeposit ?? null,
      tankCapacityLitres,
    }
    const lines: bookcarsTypes.SettlementPreviewLine[] = []
    const unavailable: bookcarsTypes.SettlementPreviewOmission[] = []
    const omit = (kind: string, reason: string) => unavailable.push({ kind, reason })

    // extra km
    if (!handover || !returnInsp) {
      omit('extraKm', !handover ? 'missingHandoverInspection' : 'missingReturnInspection')
      omit('fuel', !handover ? 'missingHandoverInspection' : 'missingReturnInspection')
      omit('wash', !returnInsp ? 'missingReturnInspection' : 'missingReturnInspection')
    } else {
      if (rates.includedKmPerDay === null) {
        omit('extraKm', 'unlimitedIncludedKm')
      } else if (rates.extraKmPrice === null) {
        omit('extraKm', 'missingExtraKmPrice')
      } else if (handover.odometer === undefined || handover.odometer === null || returnInsp.odometer === undefined || returnInsp.odometer === null) {
        omit('extraKm', 'missingOdometer')
      } else {
        const drivenKm = returnInsp.odometer - handover.odometer
        const allowanceKm = rates.includedKmPerDay * rentalDays
        const excessKm = drivenKm - allowanceKm
        if (drivenKm < 0) {
          omit('extraKm', 'invalidOdometer')
        } else if (excessKm <= 0) {
          omit('extraKm', 'withinAllowance')
        } else {
          lines.push({
            kind: bookcarsTypes.ContractChargeType.ExtraKm,
            amount: roundMoney(excessKm * rates.extraKmPrice),
            inputs: { handoverOdometer: handover.odometer, returnOdometer: returnInsp.odometer, drivenKm, includedKmPerDay: rates.includedKmPerDay, rentalDays, allowanceKm, excessKm, extraKmPrice: rates.extraKmPrice },
          })
        }
      }
      // fuel
      if (tankCapacityLitres === null) {
        omit('fuel', 'missingTankCapacity')
      } else if (rates.fuelPricePerLitre === null) {
        omit('fuel', 'missingFuelPricePerLitre')
      } else if (handover.fuelLevel === undefined || handover.fuelLevel === null || returnInsp.fuelLevel === undefined || returnInsp.fuelLevel === null) {
        omit('fuel', 'missingFuelLevel')
      } else {
        const shortfallPercent = handover.fuelLevel - returnInsp.fuelLevel
        if (shortfallPercent <= 0) {
          omit('fuel', 'noFuelShortfall')
        } else {
          const litres = (shortfallPercent / 100) * tankCapacityLitres
          lines.push({
            kind: bookcarsTypes.ContractChargeType.Fuel,
            amount: roundMoney(litres * rates.fuelPricePerLitre),
            inputs: { handoverFuelLevel: handover.fuelLevel, returnFuelLevel: returnInsp.fuelLevel, shortfallPercent, tankCapacityLitres, litres, fuelPricePerLitre: rates.fuelPricePerLitre },
          })
        }
      }
      // wash
      if (returnInsp.checklist?.washed !== false) {
        omit('wash', 'washedAtReturn')
      } else if (rates.washFee === null || rates.washFee <= 0) {
        omit('wash', 'missingWashFee')
      } else {
        lines.push({
          kind: bookcarsTypes.ContractChargeType.Wash,
          amount: roundMoney(rates.washFee),
          inputs: { washed: 0, washFee: rates.washFee },
        })
      }
    }

    const preview: bookcarsTypes.SettlementPreview = {
      booking: String(booking!._id),
      currency,
      rentalDays,
      rates,
      lines,
      unavailable,
      omissions: unavailable,
    }
    res.json(preview)
  } catch (err) {
    logger.error('[contractOperations.settlementPreview]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const complete = async (req: Request, res: Response) => {
  try {
    const booking = await bookingScope(req)
    if (invalidBooking(booking)) {
 res.status(404).send('Contract not found'); return 
}
    if ((booking!.lifecycle || bookcarsTypes.ContractLifecycle.Draft) !== bookcarsTypes.ContractLifecycle.ReturnReview) {
 res.status(409).send('Contract must be in return review before completion'); return 
}
    const pendingCharges = await ContractCharge.exists({ booking: booking!._id, supplier: booking!.supplier, status: bookcarsTypes.ApprovalDecision.Pending })
    if (pendingCharges) {
 res.status(409).send('All contract charge decisions are required before completion'); return 
}
    const snapshot = await ContractSnapshot.findOne({ booking: booking!._id, supplier: booking!.supplier }).sort({ version: -1 })
    if (!snapshot) {
 res.status(409).send('A contract PDF snapshot is required before completion'); return 
}
    // GA-PAR-11: an amendment re-prices the booking and bumps its
    // financial snapshot, so a contract PDF snapshot generated BEFORE
    // the latest amendment is stale (its text carries the old rental
    // total). Completion then demands a fresh snapshot — createSnapshot
    // versions by document count, so the fresh one is version n+1 and
    // is accepted here. Bookings without amendments are unaffected.
    const amendmentHistory = booking!.amendmentHistory || []
    if (amendmentHistory.length > 0) {
      const lastAmendmentAt = amendmentHistory.reduce<Date | null>((latest, row) => {
        const at = row.at ? new Date(row.at) : null
        return at && (!latest || at > latest) ? at : latest
      }, null)
      if (lastAmendmentAt && (!snapshot.generatedAt || new Date(snapshot.generatedAt) < lastAmendmentAt)) {
 res.status(409).send('A new contract PDF snapshot is required after the latest contract amendment'); return 
}
    }
    // GA-PAR-06 deposit settlement (coordinator decision 5 / N4): an
    // optional, explicit operator-confirmed record on the Booking only.
    // It creates NO RentalPayment, adds no ledger purpose, and does not
    // change getContractReceivable output (deposit stays reported
    // separately, never netted). held defaults to the booking's deposit
    // amount from its financial snapshot — the same figure
    // contractReceivable reports as refundableDeposit.
    const rawSettlement = (req.body as Record<string, unknown> | undefined)?.depositSettlement
    if (rawSettlement !== undefined && rawSettlement !== null) {
      if (typeof rawSettlement !== 'object' || Array.isArray(rawSettlement)) {
        res.status(400).send('Invalid deposit settlement')
        return
      }
      const ds = rawSettlement as Record<string, unknown>
      const currency = String(booking!.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
      const heldAmount = ds.heldAmount === undefined || ds.heldAmount === null
        ? Number(booking!.financialSnapshot?.depositAmount || 0)
        : Number(ds.heldAmount)
      const keptAmount = ds.keptAmount === undefined || ds.keptAmount === null ? Number.NaN : Number(ds.keptAmount)
      const returnedAmount = ds.returnedAmount === undefined || ds.returnedAmount === null ? Number.NaN : Number(ds.returnedAmount)
      const method = ds.method === undefined || ds.method === null ? undefined : String(ds.method).trim()
      const note = ds.note === undefined || ds.note === null ? undefined : String(ds.note).trim()
      if (!Number.isFinite(heldAmount) || !Number.isFinite(keptAmount) || !Number.isFinite(returnedAmount)
        || heldAmount < 0 || keptAmount < 0 || returnedAmount < 0
        || (method !== undefined && method.length > 100)
        || (note !== undefined && note.length > 1000)
        || toMinorUnits(keptAmount, currency) + toMinorUnits(returnedAmount, currency) !== toMinorUnits(heldAmount, currency)) {
        res.status(400).send('Invalid deposit settlement: keptAmount + returnedAmount must equal heldAmount')
        return
      }
      const actor = req.user?._id && mongoose.isValidObjectId(req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : undefined
      booking!.depositSettlement = {
        heldAmount,
        keptAmount,
        returnedAmount,
        method: method || undefined,
        note: note || undefined,
        recordedBy: actor,
        recordedAt: new Date(),
      }
    }
    const completedAt = new Date()
    booking!.lifecycle = bookcarsTypes.ContractLifecycle.Completed
    await booking!.save()
    const receivable = await getContractReceivable(booking!, completedAt)
    res.json({ booking, receivable })
  } catch (err) {
 logger.error('[contractOperations.complete]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const handover = (req: Request, res: Response) => createInspection(req, res, bookcarsTypes.InspectionType.Handover)
export const returnInspection = (req: Request, res: Response) => createInspection(req, res, bookcarsTypes.InspectionType.Return)


