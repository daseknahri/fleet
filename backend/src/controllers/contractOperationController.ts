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
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'
import { getContractReceivable } from '../utils/contractReceivable'
import * as helper from '../utils/helper'
import { inspectionTransition, validateInspectionFields } from '../utils/contractLifecycle'

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
  const query = Booking.findOne({ _id: bookingId, supplier }).select('_id supplier car driver status lifecycle from to expireAt price financialSnapshot')
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
      const referencedFiles = [...(payload.photoFiles || []), ...(payload.signatureFile ? [payload.signatureFile] : [])]
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
      const [inspection] = await ContractInspection.create([{ supplier: booking!.supplier, booking: booking!._id, car: booking!.car, type, ...payload, actor, acknowledgedBy: actor }], { session })
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
    if (!['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
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
    if (await ContractInspection.exists({ booking: booking._id, $or: [{ photoFiles: filename }, { signatureFile: filename }] })) {
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
    await charge.save(); res.json(charge)
  } catch (err) {
 logger.error('[contractOperations.decideCharge]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

const snapshotText = (booking: env.Booking, inspections: env.ContractInspection[], charges: env.ContractCharge[]) => {
  const rows = [
    'Gestion Auto contract snapshot', `Contract: ${booking._id}`, `Generated: ${new Date().toISOString()}`,
    `Rental total: ${booking.financialSnapshot?.rentalTotal ?? booking.price} ${booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY}`,
    '', 'Inspections:', ...inspections.map((x) => `${x.type} | ${new Date(x.occurredAt).toISOString()} | odometer ${x.odometer ?? '-'} | fuel ${x.fuelLevel ?? '-'} | ${x.condition || ''} | damage ${x.damageNote || '-'}`),
    '', 'Approved charges:', ...charges.filter((x) => x.status === bookcarsTypes.ApprovalDecision.Approved).map((x) => `${x.type} | ${x.amount} ${x.currency} | ${x.reason}`),
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


