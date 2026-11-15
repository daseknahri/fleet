import { Request, Response } from 'express'
import mongoose from 'mongoose'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import * as bookcarsTypes from ':bookcars-types'
import Booking from '../models/Booking'
import ContractInspection from '../models/ContractInspection'
import ContractCharge from '../models/ContractCharge'
import ContractSnapshot from '../models/ContractSnapshot'
import User from '../models/User'
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
import { trashedMessage } from '../utils/trash'
import { contractSnapshotQrPayload, generateContractQrPng, renderContractSnapshotPdf } from '../utils/contractSnapshotPdf'
import { contractTermsSha256 } from '../utils/contractTerms'

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
  const query = Booking.findOne({ _id: bookingId, supplier }).select('_id reference supplier car driver status lifecycle from to expireAt price financialSnapshot depositSettlement amendmentHistory onlineSignature deletedAt')
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
      // GA-PAR-22: no inspection may advance on a trashed contract.
      if (booking!.deletedAt) {
 throw new Error('TRASHED') 
}
      // F3 / W1 #11 — handover payment gate: a Draft booking that is
      // still Pending (an unpaid pay-later booking) cannot be handed
      // over until the payment is confirmed (staff manual confirmation,
      // W1 #3 — cash collected at the counter → Paid) or nothing is
      // outstanding (a zero-total booking). The 409 names the
      // outstanding balance so the UI shows the reason instead of a
      // bare refusal. The same gate lives in inspectionTransition
      // (Pending removed from the Draft-handover statuses); this
      // pre-check is the branch that carries the amount.
      let paymentConfirmed = false
      if (type === bookcarsTypes.InspectionType.Handover && booking!.status === bookcarsTypes.BookingStatus.Pending) {
        const receivable = await getContractReceivable(booking!)
        paymentConfirmed = receivable.outstandingBalance <= 0
        // F4 / W1 #5 — the pre-check fires for Draft AND Confirmed:
        // the handover payment gate now applies to both lifecycles
        // (inspectionTransition), so a Confirmed booking that is still
        // Pending must 409 here with the amount, not slip through.
        if (!paymentConfirmed) {
          throw new Error(`PAYMENT_NOT_CONFIRMED: Payment must be confirmed before handover. Outstanding balance: ${receivable.outstandingBalance} ${receivable.currency}. Record the payment first.`)
        }
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
      const nextLifecycle = inspectionTransition(booking!.lifecycle, type, booking!.status, paymentConfirmed)
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
    if (code === 'TRASHED') {
 res.status(409).send(trashedMessage('booking')); return 
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
    // F3 / W1 #11 — handover refused until the payment is confirmed;
    // the message carries the outstanding balance for the UI.
    if (code.startsWith('PAYMENT_NOT_CONFIRMED')) {
 res.status(409).send(code); return 
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
    // GA-PAR-22: no file may be added to a trashed contract.
    if (booking.deletedAt) {
 res.status(409).send(trashedMessage('booking')); return 
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
    // GA-PAR-22: no file may be deleted from a trashed contract.
    if (booking.deletedAt) {
 res.status(409).send(trashedMessage('booking')); return 
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
    // GA-PAR-22: no charge may be created on a trashed contract.
    if (booking?.deletedAt) {
 res.status(409).send(trashedMessage('booking')); return 
}
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
    // GA-PAR-22: charges on a trashed booking are hidden from the
    // pending queue and their decide endpoint refuses (§2.5).
    if (booking.deletedAt) {
 res.status(409).send(trashedMessage('booking')); return 
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

/**
 * F4 / W1 #7 — raise / resolve a dispute on a contract charge or
 * inspection (roadmap §3: the dispute path must be explicit).
 *
 * A dispute is a metadata flag on the record under challenge — it never
 * edits the record's evidence fields (an inspection stays immutable in
 * substance; the flag only records that its content is challenged).
 * Raising needs a reason (3–1000, house pattern); resolving needs a
 * resolution of the same length. Raiser/resolver and times are stamped
 * server-side. An open dispute blocks `complete` until resolved
 * (mirroring the pending-charge gate). Re-disputing a resolved record
 * opens a fresh dispute (the previous resolution is replaced, not kept
 * as history — the flag is the current challenge state, not a ledger).
 * A dispute is allowed on a charge of any decision status: it challenges
 * the record's substance, not its decision.
 */
const raiseDispute = async (
  req: Request,
  res: Response,
  kind: 'charge' | 'inspection',
) => {
  try {
    const booking = await chargeScope(req)
    if (!booking) {
 res.sendStatus(404); return 
}
    if (booking.deletedAt) {
 res.status(409).send(trashedMessage('booking')); return 
}
    const reason = String(req.body?.reason || '').trim()
    if (reason.length < 3 || reason.length > 1000) {
 res.status(400).send('Invalid dispute: a reason of 3 to 1000 characters is required'); return 
}
    const actor = req.user?._id && mongoose.isValidObjectId(req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : undefined
    const now = new Date()
    if (kind === 'charge') {
      const charge = await ContractCharge.findOne({ _id: req.params.chargeId, booking: booking._id, supplier: booking.supplier })
      if (!charge) {
 res.sendStatus(404); return 
}
      if (charge.dispute && !charge.dispute.resolvedAt) {
 res.status(409).send('This charge already has an open dispute'); return 
}
      charge.dispute = { reason, raisedBy: actor, raisedAt: now }
      await charge.save()
      res.status(201).json(charge)
      return
    }
    const inspection = await ContractInspection.findOne({ _id: req.params.inspectionId, booking: booking._id, supplier: booking.supplier })
    if (!inspection) {
 res.sendStatus(404); return 
}
    if (inspection.dispute && !inspection.dispute.resolvedAt) {
 res.status(409).send('This inspection already has an open dispute'); return 
}
    inspection.dispute = { reason, raisedBy: actor, raisedAt: now }
    await inspection.save()
    res.status(201).json(inspection)
  } catch (err) {
 logger.error(`[contractOperations.dispute-${kind}]`, err); res.status(400).send(i18n.t('ERROR')) 
}
}

const resolveDispute = async (
  req: Request,
  res: Response,
  kind: 'charge' | 'inspection',
) => {
  try {
    const booking = await chargeScope(req)
    if (!booking) {
 res.sendStatus(404); return 
}
    if (booking.deletedAt) {
 res.status(409).send(trashedMessage('booking')); return 
}
    const resolution = String(req.body?.resolution || '').trim()
    if (resolution.length < 3 || resolution.length > 1000) {
 res.status(400).send('Invalid dispute resolution: a resolution of 3 to 1000 characters is required'); return 
}
    const actor = req.user?._id && mongoose.isValidObjectId(req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : undefined
    if (kind === 'charge') {
      const charge = await ContractCharge.findOne({ _id: req.params.chargeId, booking: booking._id, supplier: booking.supplier })
      if (!charge) {
 res.sendStatus(404); return 
}
      if (!charge.dispute || charge.dispute.resolvedAt) {
 res.status(409).send('This charge has no open dispute to resolve'); return 
}
      charge.dispute.resolvedAt = new Date()
      charge.dispute.resolvedBy = actor
      charge.dispute.resolution = resolution
      await charge.save()
      res.json(charge)
      return
    }
    const inspection = await ContractInspection.findOne({ _id: req.params.inspectionId, booking: booking._id, supplier: booking.supplier })
    if (!inspection) {
 res.sendStatus(404); return 
}
    if (!inspection.dispute || inspection.dispute.resolvedAt) {
 res.status(409).send('This inspection has no open dispute to resolve'); return 
}
    inspection.dispute.resolvedAt = new Date()
    inspection.dispute.resolvedBy = actor
    inspection.dispute.resolution = resolution
    await inspection.save()
    res.json(inspection)
  } catch (err) {
 logger.error(`[contractOperations.resolve-dispute-${kind}]`, err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const disputeCharge = (req: Request, res: Response) => raiseDispute(req, res, 'charge')
export const resolveChargeDispute = (req: Request, res: Response) => resolveDispute(req, res, 'charge')
export const disputeInspection = (req: Request, res: Response) => raiseDispute(req, res, 'inspection')
export const resolveInspectionDispute = (req: Request, res: Response) => resolveDispute(req, res, 'inspection')

export const createSnapshot = async (req: Request, res: Response) => {
  try {
    const booking = await chargeScope(req)
    if (!booking) {
 res.sendStatus(404); return 
}
    // GA-PAR-22: no snapshot may be created for a trashed contract.
    if (booking.deletedAt) {
 res.status(409).send(trashedMessage('booking')); return 
}
    // GA-PAR-14: withStamp is an explicit opt-in per generation; anything
    // but a boolean is a 400. Absent means without stamp.
    const rawWithStamp = (req.body as Record<string, unknown> | undefined)?.withStamp
    if (rawWithStamp !== undefined && typeof rawWithStamp !== 'boolean') {
 res.status(400).send('Invalid snapshot request'); return 
}
    const withStamp = rawWithStamp === true
    const inspections = await ContractInspection.find({ booking: booking._id, supplier: booking.supplier }).sort({ occurredAt: 1 }).lean()
    const charges = await ContractCharge.find({ booking: booking._id, supplier: booking.supplier }).lean()
    // F4 / W1 #12 — the snapshot needs one handover AND one return
    // inspection, not any two: two handovers and no return passed the
    // old count check (`inspections.length < 2`).
    const hasHandoverInspection = inspections.some((x) => x.type === bookcarsTypes.InspectionType.Handover)
    const hasReturnInspection = inspections.some((x) => x.type === bookcarsTypes.InspectionType.Return)
    if (!hasHandoverInspection || !hasReturnInspection || (charges.some((x) => x.status === bookcarsTypes.ApprovalDecision.Pending))) {
 res.status(409).send('A handover inspection, a return inspection and all charge decisions are required'); return 
}
    // GA-PAR-14: QR payload is the booking reference plus the agency
    // identifier only (see contractSnapshotPdf) — no URL, no token, no
    // signature material. A failed QR generation degrades to the text
    // line only (logged), never to a failed snapshot.
    const reference = booking.reference || String(booking._id)
    const qrPayload = contractSnapshotQrPayload(reference, String(booking.supplier))
    let qrPng: Buffer | null = null
    try {
      qrPng = await generateContractQrPng(qrPayload)
    } catch (qrErr) {
      logger.error('[contractOperations.createSnapshot] contract QR generation failed', qrErr)
    }
    // GA-PAR-14: the agency stamp is embedded only when requested AND
    // the agency has one on file. A missing stamp degrades to a
    // stamp-less PDF (logged), never to a failed snapshot — the same
    // discipline as the PAR-12 signature embed below. A corrupt stamp
    // file also degrades: it reads fine here, so no flag is set on read
    // success — the renderer attempts the embed and the PDF text line
    // reports the ACTUAL outcome (F1 fix, GA-PAR-14).
    // GA-Q4-1: the agency's CURRENT contract terms (FR + AR) are copied
    // into this snapshot at issue, versioned by their SHA-256 below.
    // A reprint renders these stored terms — never live-edited text.
    // A failed supplier read degrades to no terms (logged), never to a
    // failed snapshot — the same discipline as the stamp/signature
    // embeds around it.
    let termsFr = ''
    let termsAr = ''
    let stampImage: Buffer | null = null
    try {
      const supplier = await User.findById(booking.supplier).select('stampFile contractTermsFr contractTermsAr').lean()
      termsFr = supplier?.contractTermsFr || ''
      termsAr = supplier?.contractTermsAr || ''
      if (withStamp && supplier?.stampFile) {
        try {
          stampImage = await fs.readFile(path.resolve(env.CDN_CONTRACTS, supplier.stampFile))
        } catch (stampErr) {
          logger.error('[contractOperations.createSnapshot] agency stamp embed failed', stampErr)
        }
      }
    } catch (supplierErr) {
      logger.error('[contractOperations.createSnapshot] agency terms/stamp read failed', supplierErr)
    }
    const termsSha256 = contractTermsSha256(termsFr, termsAr)
    const hasTerms = termsFr.trim() !== '' || termsAr.trim() !== ''
    // GA-PAR-12: read the recorded online signature image when one exists
    // at snapshot-creation time. A missing/corrupt file degrades to the
    // timestamp/hash text lines (logged), never to a failed snapshot.
    let signatureImage: Buffer | null = null
    if (booking.onlineSignature?.file) {
      try {
        signatureImage = await fs.readFile(path.resolve(env.CDN_CONTRACTS, booking.onlineSignature.file))
      } catch (signatureErr) {
        logger.error('[contractOperations.createSnapshot] online signature embed failed', signatureErr)
      }
    }
    const generatedAt = new Date()
    const bytes = await renderContractSnapshotPdf({
      reference,
      rentalTotal: booking.financialSnapshot?.rentalTotal ?? booking.price,
      currency: String(booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase(),
      inspections: (inspections as env.ContractInspection[]).map((x) => ({
        type: x.type,
        occurredAt: x.occurredAt,
        odometer: x.odometer,
        fuelLevel: x.fuelLevel,
        condition: x.condition,
        damageNote: x.damageNote,
        checklist: x.checklist,
      })),
      charges: (charges as env.ContractCharge[]).map((x) => ({
        type: x.type, amount: x.amount, currency: x.currency, reason: x.reason, status: x.status,
      })),
      onlineSignature: booking.onlineSignature
        ? { signedAt: booking.onlineSignature.signedAt, contentHash: booking.onlineSignature.contentHash }
        : undefined,
      signatureImage,
      stampImage,
      stampRequested: withStamp,
      qrPng,
      qrPayload,
      generatedAt,
      terms: hasTerms ? { fr: termsFr, ar: termsAr } : undefined,
    })
    const hash = crypto.createHash('sha256').update(bytes).digest('hex')
    const version = (await ContractSnapshot.countDocuments({ booking: booking._id })) + 1
    const filename = `${crypto.randomUUID()}.pdf`; await fs.writeFile(path.resolve(env.CDN_CONTRACTS, `snapshot_${booking._id}_${filename}`), bytes, { flag: 'wx' })
    const snapshot = await ContractSnapshot.create({ supplier: booking.supplier, booking: booking._id, version, pdfFile: filename, contentHash: hash, generatedAt, withStamp, termsFr, termsAr, termsSha256 })
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
      // F4 / W1 #14 — a missing checklist (or a checklist that does
      // not answer the wash question) is a missing-checklist omission,
      // not evidence the car was washed: `washed` unknown must never
      // read as `washedAtReturn`.
      const washedAtReturn = returnInsp.checklist?.washed
      if (washedAtReturn === undefined) {
        omit('wash', 'missingChecklist')
      } else if (washedAtReturn !== false) {
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

    // F4 / W1 #7 — late return, informational only: the return
    // inspection's occurredAt vs the scheduled `to`. No amount and no
    // fee: a late fee is an ADR-001-gated charge decision, never an
    // invented number. Staff who need to charge for the delay create a
    // manual charge (type Fee) from this figure.
    const lateReturn = returnInsp && returnInsp.occurredAt && new Date(returnInsp.occurredAt).getTime() > new Date(booking!.to).getTime()
      ? {
        returnedAt: new Date(returnInsp.occurredAt),
        dueAt: new Date(booking!.to),
        lateHours: helper.hours(booking!.to, returnInsp.occurredAt),
      }
      : undefined
    const preview: bookcarsTypes.SettlementPreview = {
      booking: String(booking!._id),
      currency,
      rentalDays,
      rates,
      lines,
      unavailable,
      omissions: unavailable,
      ...(lateReturn ? { lateReturn } : {}),
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
    // GA-PAR-22: a trashed contract cannot be completed.
    if (booking!.deletedAt) {
 res.status(409).send(trashedMessage('booking')); return 
}
    if ((booking!.lifecycle || bookcarsTypes.ContractLifecycle.Draft) !== bookcarsTypes.ContractLifecycle.ReturnReview) {
 res.status(409).send('Contract must be in return review before completion'); return 
}
    const pendingCharges = await ContractCharge.exists({ booking: booking!._id, supplier: booking!.supplier, status: bookcarsTypes.ApprovalDecision.Pending })
    if (pendingCharges) {
 res.status(409).send('All contract charge decisions are required before completion'); return 
}
    // F4 / W1 #7 — an open dispute blocks completion exactly like a
    // pending charge decision: the record under dispute must be
    // resolved first. A dispute is open while it has no resolution
    // stamp; deciding the charge underneath does not resolve it.
    const openChargeDispute = await ContractCharge.exists({ booking: booking!._id, supplier: booking!.supplier, 'dispute.raisedAt': { $exists: true }, 'dispute.resolvedAt': { $exists: false } })
    const openInspectionDispute = await ContractInspection.exists({ booking: booking!._id, supplier: booking!.supplier, 'dispute.raisedAt': { $exists: true }, 'dispute.resolvedAt': { $exists: false } })
    if (openChargeDispute || openInspectionDispute) {
 res.status(409).send('Unresolved contract disputes must be resolved before completion'); return 
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


