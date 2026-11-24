import { Request, Response } from 'express'
import mongoose from 'mongoose'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import Booking from '../models/Booking'
import CashSession from '../models/CashSession'
import ContractInspection from '../models/ContractInspection'
import ContractCharge from '../models/ContractCharge'
import ContractSnapshot from '../models/ContractSnapshot'
import RentalPayment from '../models/RentalPayment'
import User from '../models/User'
import Car from '../models/Car'
import AgencyReturnSettings from '../models/AgencyReturnSettings'
import { currencyExponent, toMinorUnits } from '../utils/paymentAmount'
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { adminSelectorSupplierIds, agencySupplierId, logAdminCrossAgencyAccess } from '../utils/agencyAuthorization'
import { getContractReceivable } from '../utils/contractReceivable'
import { LedgerError, getRecordedPurposeTotal, postRentalPayment, refreshBookingPaymentStatus, reverseRentalPayment, supportsTransactions } from '../utils/ledger'
import * as helper from '../utils/helper'
import { inspectionTransition, validateInspectionFields } from '../utils/contractLifecycle'
import { findBlockingScheduleForHandover } from '../utils/maintenanceSchedule'
import { contentMatchesExtension } from '../utils/fileContent'
import { approvalRequiredFor, mirrorApprovalDecision, produceApprovalRequest } from '../utils/approvalProducer'
import { isSelfApproval } from '../utils/approvalPolicy'
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
  if (!mongoose.isValidObjectId(bookingId)) {
    return null
  }
  const isAdmin = req.user?.type === bookcarsTypes.UserType.Admin
  // A platform admin acting on a single resource with no selector
  // (2.11 resource-attributed access) loads the booking by id â€” the
  // agency is the booking's own. Anyone else needs a resolvable agency.
  if ((!supplier || !mongoose.isValidObjectId(supplier)) && !isAdmin) {
    return null
  }
  const query = (supplier && mongoose.isValidObjectId(supplier)
    ? Booking.findOne({ _id: bookingId, supplier })
    : Booking.findOne({ _id: bookingId })
  ).select('_id reference supplier car driver status lifecycle from to expireAt price financialSnapshot depositSettlement amendmentHistory onlineSignature deletedAt')
  if (session) {
    query.session(session)
  }
  const booking = await query
  // Wave 2.11 â€” audit an admin acting on a single resource with the
  // booking's agency. Selector calls are already logged by the
  // middleware, so only log when no selector was sent.
  if (booking && isAdmin && adminSelectorSupplierIds(req).length === 0) {
    await logAdminCrossAgencyAccess(req, [booking.supplier.toString()], 'contract-operations:booking')
  }
  return booking
}

const invalidBooking = (booking: env.Booking | null) => !booking
  || booking.status === bookcarsTypes.BookingStatus.Void
  || booking.status === bookcarsTypes.BookingStatus.Cancelled

// Wave 2.8 (C6) — the same wall as a type guard: after
// `if (!isLiveBooking(booking)) return`, `booking` is a live contract
// (TypeScript narrows it), so the write endpoints below use this in
// place of their bare `!booking` checks.
const isLiveBooking = (booking: env.Booking | null): booking is env.Booking => !invalidBooking(booking)

const contractFile = (bookingId: string, filename: string) => path.resolve(env.CDN_CONTRACTS, `inspection_${bookingId}_${filename}`)
const safeContractFilename = (filename: string) => filename === path.basename(filename) && /^[A-Za-z0-9._-]+$/.test(filename)

/**
 * Next pass - early return: when the car comes back before its scheduled
 * return, the rent is re-priced from the ORIGINAL snapshot's rate basis
 * (same rule as an amendment: basis daily rate = snapshot rentalTotal /
 * original rental days, minor-rounded x the days actually used). The
 * snapshot is bumped with the adjusted total, booking.price follows it,
 * and booking.to moves to the return date so the car is free for every
 * consumer from that day (availability, search, receivable due date,
 * settlement-preview allowance). On-time and late returns do nothing
 * (a late fee stays a decided charge). The deposit settlement is
 * untouched. No refund is implied: the overpayment surfaces in the
 * receivable (overpaidAmount). Mutates the booking in place; the caller
 * saves it inside the same transaction.
 */
const applyEarlyReturnAdjustment = (
  booking: env.Booking,
  occurredAt: Date,
  actor?: mongoose.Types.ObjectId,
): void => {
  const scheduledTo = new Date(booking.to)
  if (Number.isNaN(scheduledTo.getTime()) || occurredAt.getTime() >= scheduledTo.getTime()) {
    return
  }
  const snapshot = booking.financialSnapshot
  const hasRealSnapshot = !!snapshot && typeof snapshot.rentalTotal === 'number'
  const basisTotal = hasRealSnapshot ? Number(snapshot.rentalTotal) : Number(booking.price || 0)
  const currency = String((hasRealSnapshot ? snapshot.baseCurrency : undefined) || env.BASE_CURRENCY).toUpperCase()
  const exponent = currencyExponent(currency)
  const scheduledDays = helper.days(booking.from, booking.to)
  const actualDays = Math.max(1, helper.days(booking.from, occurredAt))
  if (scheduledDays < 1 || actualDays < 1 || actualDays >= scheduledDays || !Number.isFinite(basisTotal) || basisTotal < 0) {
    return
  }
  const basisDailyRate = basisTotal / scheduledDays
  const adjustedRentalTotal = toMinorUnits(basisDailyRate * actualDays, currency) / (10 ** exponent)
  const now = new Date()
  booking.earlyReturn = {
    scheduledTo,
    returnedAt: occurredAt,
    scheduledDays,
    actualDays,
    basisDailyRate,
    adjustedRentalTotal,
    originalRentalTotal: basisTotal,
    recordedBy: actor,
    recordedAt: now,
  }
  if (hasRealSnapshot) {
    booking.financialSnapshot = {
      ...snapshot,
      version: (typeof snapshot.version === 'number' ? snapshot.version : 1) + 1,
      rentalTotal: adjustedRentalTotal,
      quotedAt: now,
    }
  }
  booking.price = adjustedRentalTotal
  booking.to = occurredAt
}

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
      // Wave 2 remainder — 2.2 (M5/C2): the balance-based handover
      // gate, for EVERY status — not only Pending. The old gate fired
      // only for Pending, and inspectionTransition let Deposit/Paid/
      // PaidInFull through with no balance check at all, so a
      // deposit-paid booking with rent unpaid still took the car.
      // Now: handover requires the receivable settled (nothing
      // outstanding) AND the refundable deposit collected, except for
      // the Q14 rent-at-return exception — rent-only balance, deposit
      // collected, and no future confirmed booking for the car (the
      // car is not already reserved). The 409 names the balance or
      // the missing deposit so the UI shows the reason instead of a
      // bare refusal. Error precedence: an outstanding balance is
      // reported first (PAYMENT_NOT_CONFIRMED); the deposit gap
      // (DEPOSIT_NOT_COLLECTED) is reported only once the rent is
      // settled. The deposit is recorded at the counter before
      // handover (postRentalPayment / confirmRentalPayment); a
      // zero-deposit booking (refundableDeposit 0) passes trivially.
      let paymentConfirmed = false
      if (type === bookcarsTypes.InspectionType.Handover) {
        const receivable = await getContractReceivable(booking!)
        const currency = receivable.currency
        const depositCollected = toMinorUnits(receivable.depositPayments, currency) >= toMinorUnits(receivable.refundableDeposit, currency)
        if (receivable.outstandingBalance <= 0 && depositCollected) {
          paymentConfirmed = true
        } else if (receivable.outstandingBalance > 0) {
          // Q14 exception: rent-only balance, deposit collected, car
          // not already reserved (no future Confirmed booking).
          const rentOnly = toMinorUnits(receivable.approvedCharges, currency) - toMinorUnits(receivable.chargeCredits, currency) <= 0
          let hasFutureConfirmedBooking = false
          if (rentOnly && depositCollected) {
            hasFutureConfirmedBooking = !!(await Booking.exists({
              _id: { $ne: booking!._id },
              supplier: booking!.supplier,
              car: booking!.car,
              lifecycle: bookcarsTypes.ContractLifecycle.Confirmed,
              status: { $nin: [bookcarsTypes.BookingStatus.Cancelled, bookcarsTypes.BookingStatus.Void] },
              deletedAt: null,
              to: { $gt: new Date() },
            }).session(session))
          }
          if (rentOnly && depositCollected && !hasFutureConfirmedBooking) {
            paymentConfirmed = true
          } else {
            // The balance is the blocker named first (the Wave 1
            // precedence): a rent balance outstanding is reported as
            // PAYMENT_NOT_CONFIRMED even when the deposit is also
            // missing — the deposit gap surfaces on the next attempt
            // once the rent is paid. The Q14 exception above is the
            // only way an outstanding balance hands over.
            throw new Error(`PAYMENT_NOT_CONFIRMED: Payment must be confirmed before handover. Outstanding balance: ${receivable.outstandingBalance} ${currency}. Record the payment first.`)
          }
        } else if (!depositCollected) {
          throw new Error(`DEPOSIT_NOT_COLLECTED: Deposit must be collected before handover. Deposit due: ${receivable.refundableDeposit} ${currency}; collected: ${receivable.depositPayments} ${currency}. Record the deposit payment first.`)
        }
        // Maintenance re-check at handover: the car must not leave
        // the lot with maintenance overdue, nor with a service falling
        // due inside the rental window.
        if (paymentConfirmed) {
          const blocking = await findBlockingScheduleForHandover(booking!.supplier, booking!.car, new Date(booking!.from), new Date(booking!.to), session)
          if (blocking) {
            throw new Error(`MAINTENANCE_BLOCKS_HANDOVER: Maintenance "${blocking.title}" blocks handover (${blocking.trigger}). Complete the service first.`)
          }
        }
      }
      const validated = validateInspectionFields(req.body as bookcarsTypes.CreateContractInspectionPayload, type)
      if (!validated.ok) {
        throw new Error(validated.reason === 'PHOTO_REQUIRED' ? 'PHOTO_REQUIRED' : 'INVALID_INSPECTION')
      }
      const payload = validated.value
      // GA-PAR-06: a return odometer below the handover odometer is a
      // field-level invalid input — reject before anything persists.
      if (type === bookcarsTypes.InspectionType.Return && payload.odometer !== undefined) {
        const handover = await ContractInspection.findOne({ booking: booking!._id, supplier: booking!.supplier, type: bookcarsTypes.InspectionType.Handover }).sort({ occurredAt: -1, createdAt: -1 }).session(session)
        if (handover && handover.odometer !== undefined && handover.odometer !== null && payload.odometer < handover.odometer) {
          throw new Error('INVALID_INSPECTION')
        }
      }
      // Wave 2.8 (C15) — `occurredAt` is a fact, not a free date: an
      // inspection cannot happen in the future (5-minute clock-skew
      // tolerance), and a return cannot predate its handover. The gap
      // text also wanted handover `occurredAt >= from`; that bound is
      // NOT enforced — early handovers before `from` are established
      // behavior (the f4 fixtures hand over before `from`).
      if (payload.occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
        throw new Error('INVALID_INSPECTION')
      }
      if (type === bookcarsTypes.InspectionType.Return) {
        const handover = await ContractInspection.findOne({ booking: booking!._id, supplier: booking!.supplier, type: bookcarsTypes.InspectionType.Handover }).sort({ occurredAt: -1, createdAt: -1 }).session(session)
        if (handover && payload.occurredAt.getTime() < new Date(handover.occurredAt).getTime()) {
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
      // Next pass - an early return re-prices the rent from the original
      // snapshot basis and frees the car from the return day (see
      // applyEarlyReturnAdjustment). On-time/late returns do nothing.
      if (type === bookcarsTypes.InspectionType.Return) {
        applyEarlyReturnAdjustment(booking!, payload.occurredAt, actor)
      }
      await booking!.save({ session })
      // Wave 2 remainder — 2.2 / GPS option A: the inspection odometer
      // is the freshest km the system has — save it onto the car (max
      // rule: an inspection never lowers a stored reading; a wrong
      // stored value is corrected on the car form). Both handover and
      // return inspections carry an odometer, so the car's km advances
      // on every rental — the oil-change schedules see fresh km.
      if (payload.odometer !== undefined) {
        const car = await Car.findById(booking!.car).session(session)
        if (car && (car.odometerKm === undefined || car.odometerKm === null || car.odometerKm < payload.odometer)) {
          car.odometerKm = payload.odometer
          await car.save({ session })
        }
      }
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
    if (code === 'PHOTO_REQUIRED') {
 res.status(400).send(`A photo is required for the ${type === bookcarsTypes.InspectionType.Handover ? 'handover' : 'return'} inspection`); return 
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
    // Wave 2 remainder — 2.2: deposit not collected, or maintenance
    // blocking the handover; the message names the blocker for the UI.
    if (code.startsWith('DEPOSIT_NOT_COLLECTED')) {
 res.status(409).send(code); return 
}
    if (code.startsWith('MAINTENANCE_BLOCKS_HANDOVER')) {
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
    // Wave 2.8 (C6) — no file may be added to a Cancelled/Void contract.
    if (!isLiveBooking(booking) || !file || !file.originalname) {
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
    // Wave 2.8 (C6) — no file may be deleted from a Cancelled/Void contract.
    if (!isLiveBooking(booking) || !safeContractFilename(filename)) {
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
    // Wave 2.8 (C6) — no charge may be created on a Cancelled/Void
    // contract (same wall as createInspection).
    if (!isLiveBooking(booking)) {
 res.status(404).send('Contract not found'); return 
}
    // GA-PAR-22: no charge may be created on a trashed contract.
    if (booking.deletedAt) {
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
    // Wave 2.8 (C6) — no charge may be decided on a Cancelled/Void contract.
    if (!isLiveBooking(booking)) {
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
    // Approvals policy, decision 1.4 (owner-approved defaults
    // 2026-11-17): the requester can never decide their own charge -
    // the same rule as the approvals queue decide endpoint, which
    // this path bypasses (it settles the charge record directly).
    if (isSelfApproval(charge.requestedBy, actor)) {
      res.status(403).send('The requester cannot decide their own contract charge'); return
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
    // Wave 1.6 — an approved charge grows the amount owed: a booking
    // that was Paid/PaidInFull must have its status downgraded, or the
    // "Paid" label would keep claiming the money is in. Best-effort:
    // the decision itself already succeeded.
    if (charge.status === bookcarsTypes.ApprovalDecision.Approved) {
      try {
        await refreshBookingPaymentStatus(booking._id)
      } catch (refreshErr) {
        logger.error('[contractOperations.decideCharge] booking payment status could not be refreshed', refreshErr)
      }
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
    // Wave 2.8 (C6) — no dispute may be raised on a Cancelled/Void contract.
    if (!isLiveBooking(booking)) {
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
      // A dispute is open only once raised: Mongoose materialises the
      // single-nested `dispute` subdocument as {} on every load, so
      // testing the subdocument itself is always truthy and the first
      // raise 409s. `raisedAt` is the signal — the same definition
      // `complete` already uses (raisedAt exists, resolvedAt does not).
      if (charge.dispute?.raisedAt && !charge.dispute.resolvedAt) {
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
    // Same Mongoose-materialised-subdocument note as the charge raise
    // above: `raisedAt`, not the subdocument, marks an open dispute.
    if (inspection.dispute?.raisedAt && !inspection.dispute.resolvedAt) {
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
    // Wave 2.8 (C6) — no dispute may be resolved on a Cancelled/Void contract.
    if (!isLiveBooking(booking)) {
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
      // A never-raised dispute is also an empty materialised subdocument,
      // so `!charge.dispute` is never true and resolving one would stamp
      // a resolution onto a dispute that was never raised. `raisedAt` is
      // the open-dispute signal here too.
      if (!charge.dispute?.raisedAt || charge.dispute.resolvedAt) {
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
    // Same as the charge resolve above: no `raisedAt` means no open
    // dispute to resolve.
    if (!inspection.dispute?.raisedAt || inspection.dispute.resolvedAt) {
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
    // Wave 2.8 (C6) — no snapshot may be created for a Cancelled/Void contract.
    if (!isLiveBooking(booking)) {
 res.sendStatus(404); return 
}
    // GA-PAR-22: no snapshot may be created for a trashed contract.
    if (booking.deletedAt) {
 res.status(409).send(trashedMessage('booking')); return 
}
    // Wave 2.8 (C18) — a snapshot must not freeze a contract while a
    // dispute is open: the PDF would present challenged content as
    // settled.
    const openChargeDispute = await ContractCharge.exists({ booking: booking._id, supplier: booking.supplier, 'dispute.raisedAt': { $exists: true }, 'dispute.resolvedAt': { $exists: false } })
    const openInspectionDispute = await ContractInspection.exists({ booking: booking._id, supplier: booking.supplier, 'dispute.raisedAt': { $exists: true }, 'dispute.resolvedAt': { $exists: false } })
    if (openChargeDispute || openInspectionDispute) {
 res.status(409).send('An open contract dispute must be resolved before a snapshot can be generated'); return 
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
    // Wave 2.8 (C12) — the version is count+1, so two concurrent
    // generations can collide on the unique (booking, version) index:
    // on a duplicate-key error, delete the just-written orphan PDF
    // (best-effort) and retry once with a recomputed version.
    let snapshot: env.ContractSnapshot | undefined
    for (let attempt = 0; attempt < 2 && !snapshot; attempt += 1) {
      const version = (await ContractSnapshot.countDocuments({ booking: booking._id })) + 1
      const filename = `${crypto.randomUUID()}.pdf`
      const pdfPath = path.resolve(env.CDN_CONTRACTS, `snapshot_${booking._id}_${filename}`)
      await fs.writeFile(pdfPath, bytes, { flag: 'wx' })
      try {
        snapshot = await ContractSnapshot.create({ supplier: booking.supplier, booking: booking._id, version, pdfFile: filename, contentHash: hash, generatedAt, withStamp, termsFr, termsAr, termsSha256 })
      } catch (createErr) {
        if ((createErr as { code?: number }).code === 11000 && attempt === 0) {
          await fs.unlink(pdfPath).catch((unlinkErr) => logger.error('[contractOperations.createSnapshot] orphan snapshot PDF could not be removed', unlinkErr))
          continue
        }
        throw createErr
      }
    }
    if (!snapshot) {
 res.status(409).send('The contract snapshot could not be created; please retry'); return 
}
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
 * logic uses. An early return floors it at the recorded actualDays
 * (never negative: a return-before-from booking would otherwise price
 * negative days); any other return-before-from range floors at 1 day.
 * Every omitted line kind is reported in `unavailable` (and
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
    const rentalDays = booking!.earlyReturn ? Math.max(1, booking!.earlyReturn.actualDays) : Math.max(1, helper.days(booking!.from, booking!.to))
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
        lateHours: bookcarsHelper.hours(booking!.to, returnInsp.occurredAt),
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

/**
 * Wave 2.4 — post the deposit settlement as ledger movements when a
 * booking completes. Validation is against what is actually posted,
 * never against policy bounds (Q13 governs what the deposit SHOULD be
 * at booking time, not settlement arithmetic):
 * - held must equal the posted deposit total (minor units);
 * - kept must equal the sum of approved, unsettled charges (or zero);
 * - kept + returned must equal held (checked by the caller).
 * The returned leg reverses whole deposit payments (provider refund
 * included for card) and posts a Posted Debit for a partial remainder
 * — except a partial remainder on a provider-sourced (Stripe/PayPal)
 * deposit, which this release cannot refund partially (409). The kept
 * leg posts one Charge credit per approved unsettled charge: a
 * reclassification of money already in the drawer, so it never creates
 * a session movement. Cash returns need an open Cash session, wire
 * returns an open Bank session (409 otherwise). Idempotency keys make
 * a retried completion safe. Throws Errors whose message starts with
 * `DEPOSIT_SETTLEMENT_` (mapped to 409 by complete()) or LedgerError.
 */
const postDepositSettlement = async (
  booking: env.Booking,
  heldAmount: number,
  keptAmount: number,
  returnedAmount: number,
  currency: string,
  actor: mongoose.Types.ObjectId | undefined,
  session?: mongoose.ClientSession,
): Promise<{ returnedPaymentIds: string[], keptPaymentIds: string[] }> => {
  const exponent = currencyExponent(currency)
  const toMinor = (value: number) => toMinorUnits(value, currency)
  const heldPosted = await getRecordedPurposeTotal(booking._id, bookcarsTypes.RentalPaymentPurpose.Deposit, session)
  if (toMinor(heldAmount) !== toMinor(heldPosted)) {
    throw new Error(`DEPOSIT_SETTLEMENT_HELD_MISMATCH: The settlement held amount (${heldAmount} ${currency}) does not match the posted deposit total (${heldPosted} ${currency}). Reconcile the deposit payments first.`)
  }
  const depositCreditsQuery = RentalPayment.find({
    booking: booking._id,
    purpose: bookcarsTypes.RentalPaymentPurpose.Deposit,
    status: bookcarsTypes.RentalPaymentStatus.Posted,
    direction: { $ne: bookcarsTypes.RentalPaymentDirection.Debit },
  }).sort({ date: 1, _id: 1 })
  if (session) {
    depositCreditsQuery.session(session)
  }
  const depositCredits = await depositCreditsQuery
  const walkSum = depositCredits.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  if (toMinor(walkSum) !== toMinor(heldPosted)) {
    throw new Error(`DEPOSIT_SETTLEMENT_UNRECONCILED: The posted deposit total (${heldPosted} ${currency}) cannot be walked back to individual payments (${walkSum} ${currency}); the deposit ledger has unreconciled entries. Reconcile the deposit payments first.`)
  }
  const unsettledChargesQuery = ContractCharge.find({
    booking: booking._id,
    supplier: booking.supplier,
    status: bookcarsTypes.ApprovalDecision.Approved,
    $or: [{ settledAt: { $exists: false } }, { settledAt: null }],
  }).sort({ createdAt: 1, _id: 1 })
  if (session) {
    unsettledChargesQuery.session(session)
  }
  const unsettledCharges = await unsettledChargesQuery
  const approvedTotal = unsettledCharges.reduce((sum, charge) => sum + Number(charge.amount || 0), 0)
  if (toMinor(keptAmount) !== toMinor(approvedTotal)) {
    throw new Error(`DEPOSIT_SETTLEMENT_KEPT_MISMATCH: The settlement kept amount (${keptAmount} ${currency}) does not match the approved unsettled charges (${approvedTotal} ${currency}). Decide or settle the charges first.`)
  }

  // Plan the return leg before posting anything: which payments are
  // reversed whole, which one carries a partial remainder, and which
  // sessions the return needs. Amounts are walked in minor units so
  // the split is exact.
  type ReturnLeg = { payment: env.RentalPayment, whole: boolean, amount: number }
  const legs: ReturnLeg[] = []
  let remainingMinor = toMinor(returnedAmount)
  for (const payment of depositCredits) {
    if (remainingMinor <= 0) {
      break
    }
    const amountMinor = toMinor(Number(payment.amount || 0))
    if (amountMinor <= 0) {
      continue
    }
    if (remainingMinor >= amountMinor) {
      legs.push({ payment, whole: true, amount: Number(payment.amount || 0) })
      remainingMinor -= amountMinor
    } else {
      legs.push({ payment, whole: false, amount: remainingMinor / (10 ** exponent) })
      remainingMinor = 0
    }
  }
  if (remainingMinor !== 0) {
    throw new Error(`DEPOSIT_SETTLEMENT_RETURN_SHORTFALL: The returned amount (${returnedAmount} ${currency}) exceeds the posted deposits that can be returned.`)
  }
  const partialLeg = legs.find((leg) => !leg.whole)
  if (partialLeg && (partialLeg.payment.source === bookcarsTypes.RentalPaymentSource.Stripe || partialLeg.payment.source === bookcarsTypes.RentalPaymentSource.PayPal)) {
    throw new Error('DEPOSIT_SETTLEMENT_PARTIAL_CARD: Part of a card deposit cannot be returned here — a provider refund covers the whole payment. Return the full payment or settle the remainder another way.')
  }
  // A cash return needs an open Cash session to hand the money back
  // through, a wire return an open Bank session (design §5.3 refusal
  // case — the same rule as the cancel refund).
  const touchedMethods = [...new Set(legs.map((leg) => leg.payment.method))]
  for (const method of touchedMethods) {
    if (method !== bookcarsTypes.RentalPaymentMethod.Cash && method !== bookcarsTypes.RentalPaymentMethod.BankTransfer) {
      continue
    }
    const account = method === bookcarsTypes.RentalPaymentMethod.Cash ? bookcarsTypes.CashAccountType.Cash : bookcarsTypes.CashAccountType.Bank
    const openSessionQuery = CashSession.findOne({ supplier: booking.supplier, account, status: bookcarsTypes.CashSessionStatus.Open }).select('_id').lean()
    if (session) {
      openSessionQuery.session(session)
    }
    if (!(await openSessionQuery)) {
      throw new Error(method === bookcarsTypes.RentalPaymentMethod.Cash
        ? 'DEPOSIT_SETTLEMENT_NO_CASH_SESSION: The settlement returns cash, but no cash session is open. Open a cash session first, then complete.'
        : 'DEPOSIT_SETTLEMENT_NO_BANK_SESSION: The settlement returns a wire transfer, but no bank session is open. Open a bank session first, then complete.')
    }
  }

  const returnedPaymentIds: string[] = []
  const keptPaymentIds: string[] = []
  const now = new Date()
  const bookingId = booking._id.toString()
  // Whole reversals first (the provider refund, where one applies, is
  // part of the reversal), then the partial remainder debit: the debit
  // validates against the recorded deposit total, which the reversals
  // have just lowered — posting in this order always fits.
  for (const leg of legs) {
    if (leg.whole) {
      const reversal = await reverseRentalPayment({
        paymentId: leg.payment._id,
        actorId: actor,
        idempotencyKey: `deposit-settlement-return-${bookingId}-${leg.payment._id.toString()}`,
        date: now,
        note: `deposit-return:${leg.payment._id.toString()}`,
        session,
      })
      returnedPaymentIds.push(reversal._id.toString())
    }
  }
  if (partialLeg) {
    const debit = await postRentalPayment({
      bookingId: booking._id,
      supplierId: booking.supplier,
      date: now,
      amount: partialLeg.amount,
      currency,
      method: partialLeg.payment.method,
      purpose: bookcarsTypes.RentalPaymentPurpose.Deposit,
      direction: bookcarsTypes.RentalPaymentDirection.Debit,
      source: bookcarsTypes.RentalPaymentSource.Manual,
      status: bookcarsTypes.RentalPaymentStatus.Posted,
      idempotencyKey: `deposit-settlement-return-partial-${bookingId}-${partialLeg.payment._id.toString()}`,
      actorId: actor,
      note: `deposit-return-partial:${partialLeg.payment._id.toString()}`,
      session,
    })
    returnedPaymentIds.push(debit._id.toString())
  }
  // Kept leg: one Charge credit per approved unsettled charge, in the
  // method of the first posted deposit (the drawer the money sits in).
  // Charge credits never create a session movement (the ledger link
  // functions return early for purpose Charge).
  const keptMethod = depositCredits[0]?.method || bookcarsTypes.RentalPaymentMethod.Cash
  for (const charge of unsettledCharges) {
    const credit = await postRentalPayment({
      bookingId: booking._id,
      supplierId: booking.supplier,
      date: now,
      amount: Number(charge.amount || 0),
      currency,
      method: keptMethod,
      purpose: bookcarsTypes.RentalPaymentPurpose.Charge,
      direction: bookcarsTypes.RentalPaymentDirection.Credit,
      source: bookcarsTypes.RentalPaymentSource.Manual,
      status: bookcarsTypes.RentalPaymentStatus.Posted,
      idempotencyKey: `deposit-settlement-charge-${bookingId}-${charge._id.toString()}`,
      actorId: actor,
      note: `deposit-kept:${charge._id.toString()}`,
      session,
    })
    keptPaymentIds.push(credit._id.toString())
    charge.settledAt = now
    if (session) {
      await charge.save({ session })
    } else {
      await charge.save()
    }
  }
  return { returnedPaymentIds, keptPaymentIds }
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
    // Wave 2.8 (C5) — a snapshot is stale vs charge decisions too: a
    // charge created or decided after the snapshot was generated is not
    // in the PDF. Completion demands a fresh snapshot.
    const chargesForFreshness = await ContractCharge.find({ booking: booking!._id, supplier: booking!.supplier }).select('createdAt decidedAt').lean() as unknown as Array<{ createdAt?: Date, decidedAt?: Date }>
    let latestChargeAt: Date | null = null
    for (const charge of chargesForFreshness) {
      for (const at of [charge.createdAt, charge.decidedAt]) {
        if (at && (!latestChargeAt || new Date(at) > latestChargeAt)) {
          latestChargeAt = new Date(at)
        }
      }
    }
    if (latestChargeAt && (!snapshot.generatedAt || new Date(snapshot.generatedAt) < latestChargeAt)) {
 res.status(409).send('A new contract PDF snapshot is required after the latest contract charge decision'); return 
}
    // Wave 2.8 (C9) — completion does not require a return odometer:
    // when the agency prices extra km (extraKmPrice + includedKmPerDay
    // set), fuel (fuelPricePerLitre set + tank capacity known) or wash
    // (washFee > 0), the return inspection must carry the reading the
    // charge needs — otherwise the settlement cannot be priced and the
    // deposit cannot be settled honestly. Conditions mirror the
    // settlement preview exactly.
    const [handoverInsp, returnInsp, returnSettings, carForComplete] = await Promise.all([
      ContractInspection.findOne({ booking: booking!._id, supplier: booking!.supplier, type: bookcarsTypes.InspectionType.Handover }).sort({ occurredAt: -1, createdAt: -1 }),
      ContractInspection.findOne({ booking: booking!._id, supplier: booking!.supplier, type: bookcarsTypes.InspectionType.Return }).sort({ occurredAt: -1, createdAt: -1 }),
      AgencyReturnSettings.findOne({ supplier: booking!.supplier }),
      Car.findById(booking!.car).select('tankCapacityLitres'),
    ])
    // Next pass - the return odometer is required to complete, always:
    // the reading is the arrival record (it keeps the maintenance chain
    // true and is the basis of the extra-km settlement). The C9 gates
    // below stay for fuel and wash. A return inspection recorded after
    // this change always carries an odometer (validateInspectionFields);
    // a legacy ReturnReview booking without one needs its return
    // inspection re-recorded before completion.
    if (returnInsp?.odometer === undefined || returnInsp?.odometer === null) {
      res.status(409).send('The return inspection is missing the odometer reading'); return
    }
    if (returnSettings?.extraKmPrice !== null && returnSettings?.extraKmPrice !== undefined
      && returnSettings?.includedKmPerDay !== null && returnSettings?.includedKmPerDay !== undefined
      && (returnInsp?.odometer === undefined || returnInsp?.odometer === null)) {
 res.status(409).send('The return inspection is missing the odometer reading required to price extra kilometres'); return 
}
    if (returnSettings?.fuelPricePerLitre !== null && returnSettings?.fuelPricePerLitre !== undefined
      && typeof carForComplete?.tankCapacityLitres === 'number'
      && (returnInsp?.fuelLevel === undefined || returnInsp?.fuelLevel === null)) {
 res.status(409).send('The return inspection is missing the fuel level required to price the fuel shortfall'); return 
}
    if (returnSettings?.washFee !== null && returnSettings?.washFee !== undefined && returnSettings.washFee > 0
      && returnInsp?.checklist?.washed === undefined) {
 res.status(409).send('The return inspection is missing the wash answer required to price the wash fee'); return 
}
    // GA-PAR-06 deposit settlement (coordinator decision 5 / N4): an
    // optional, explicit operator-confirmed record on the Booking only.
    // It creates NO RentalPayment, adds no ledger purpose, and does not
    // change getContractReceivable output (deposit stays reported
    // separately, never netted). held defaults to the booking's deposit
    // amount from its financial snapshot — the same figure
    // contractReceivable reports as refundableDeposit.
    const rawSettlement = (req.body as Record<string, unknown> | undefined)?.depositSettlement
    let settlementInput: { heldAmount: number, keptAmount: number, returnedAmount: number, method?: string, note?: string } | undefined
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
      // Wave 2.4 — the record is kept in a local until the postings
      // below succeed; it is stamped onto the booking (with the posted
      // payment ids) only as part of the completion save.
      settlementInput = {
        heldAmount,
        keptAmount,
        returnedAmount,
        method: method || undefined,
        note: note || undefined,
      }
    }
    // Wave 2 remainder — 2.2 (C3): the balance gate at completion.
    // No Q14 exception here — rent is due at return. The kept leg of
    // a deposit settlement settles approved unsettled charges, so it
    // comes off the outstanding balance (postDepositSettlement
    // enforces kept == approved unsettled charges). A deposit that
    // was never collected with no settlement to return/keep it also
    // blocks. When a balance remains, the operator may still close
    // the contract — but only with an explicit reason (1–1000 chars)
    // recorded on the booking as closeWithBalance; the balance stays
    // owed (the receivable does not change).
    const receivableBefore = await getContractReceivable(booking!)
    const currency = String(booking!.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
    const depositCollected = toMinorUnits(receivableBefore.depositPayments, currency) >= toMinorUnits(receivableBefore.refundableDeposit, currency)
    if (!depositCollected && !settlementInput) {
      res.status(409).send(`DEPOSIT_NOT_COLLECTED: Deposit was never collected and no deposit settlement was supplied. Deposit due: ${receivableBefore.refundableDeposit} ${currency}; collected: ${receivableBefore.depositPayments} ${currency}.`)
      return
    }
    const keptMinor = settlementInput ? toMinorUnits(settlementInput.keptAmount, currency) : 0
    const effectiveOutstandingMinor = Math.max(0, toMinorUnits(receivableBefore.outstandingBalance, currency) - keptMinor)
    if (effectiveOutstandingMinor > 0) {
      const reason = typeof (req.body as Record<string, unknown> | undefined)?.closeWithBalanceReason === 'string'
        ? String((req.body as Record<string, unknown>).closeWithBalanceReason).trim()
        : ''
      if (reason.length < 1 || reason.length > 1000) {
        res.status(409).send(`BALANCE_OUTSTANDING: Outstanding balance: ${effectiveOutstandingMinor / (10 ** currencyExponent(currency))} ${currency}. Record the payment first, or close with a reason (closeWithBalanceReason, 1–1000 chars).`)
        return
      }
      booking!.closeWithBalance = {
        reason,
        recordedBy: req.user?._id && mongoose.isValidObjectId(req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : undefined,
        recordedAt: new Date(),
      }
    }
    const completedAt = new Date()
    booking!.lifecycle = bookcarsTypes.ContractLifecycle.Completed
    const actor = req.user?._id && mongoose.isValidObjectId(req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : undefined
    if (settlementInput) {
      booking!.depositSettlement = {
        ...settlementInput,
        recordedBy: actor,
        recordedAt: new Date(),
      }
    }
    // Wave 2.4 — the settlement posts inside the same transaction as
    // the completion when the deployment supports transactions (the
    // ledger's supportsTransactions guard, same as the checkout
    // finalization); otherwise the steps run sequentially, with the
    // idempotency keys making a retried completion safe.
    if (settlementInput) {
      const currency = String(booking!.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
      const postSettlement = async (session?: mongoose.ClientSession) => {
        const { returnedPaymentIds, keptPaymentIds } = await postDepositSettlement(
          booking!, settlementInput!.heldAmount, settlementInput!.keptAmount, settlementInput!.returnedAmount, currency, actor, session,
        )
        booking!.depositSettlement = {
          ...booking!.depositSettlement!,
          returnedPaymentIds: returnedPaymentIds.map((id) => new mongoose.Types.ObjectId(id)),
          keptPaymentIds: keptPaymentIds.map((id) => new mongoose.Types.ObjectId(id)),
        }
      }
      const settleSession = await mongoose.startSession()
      try {
        if (supportsTransactions()) {
          await settleSession.withTransaction(async () => {
            await postSettlement(settleSession)
            await booking!.save({ session: settleSession })
          })
        } else {
          await postSettlement()
          await booking!.save()
        }
      } finally {
        await settleSession.endSession()
      }
    } else {
      await booking!.save()
    }
    const receivable = await getContractReceivable(booking!, completedAt)
    res.json({ booking, receivable })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    // Wave 2.4 — settlement refusals are business refusals (409 with
    // the reason), never a bare 400.
    if (message.startsWith('DEPOSIT_SETTLEMENT_')) {
      logger.error('[contractOperations.complete] deposit settlement refused', err)
      res.status(409).send(message)
      return
    }
    if (err instanceof LedgerError) {
      logger.error('[contractOperations.complete] ledger refused the deposit settlement', err)
      res.status(409).send(err.message)
      return
    }
 logger.error('[contractOperations.complete]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const handover = (req: Request, res: Response) => createInspection(req, res, bookcarsTypes.InspectionType.Handover)
export const returnInspection = (req: Request, res: Response) => createInspection(req, res, bookcarsTypes.InspectionType.Return)


