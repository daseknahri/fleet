import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Approval from '../models/Approval'
import User from '../models/User'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'
import ContractCharge from '../models/ContractCharge'

const scope = (req: Request) => req.user?.type === bookcarsTypes.UserType.Admin ? {} : { supplier: agencySupplierId(req) || '000000000000000000000000' }

// Display-only enrichment: resolve requester/decider display names into
// the payload. Approval rows store user ids, and not every viewer may open
// every user record (a staff viewer cannot open a platform admin), so the
// names are resolved here, once, for all viewers. No behaviour changes:
// scoping, creation and the decide path are untouched.
const namesById = async (ids: unknown[]): Promise<Map<string, string>> => {
  const unique = [...new Set(ids.filter(Boolean).map((id) => String(id)))]
  const names = new Map<string, string>()
  if (unique.length) {
    const users = await User.find({ _id: { $in: unique } }).select('fullName').lean()
    for (const user of users) {
      names.set(String(user._id), user.fullName)
    }
  }
  return names
}

const withNames = async <T extends { requestedBy?: unknown, decidedBy?: unknown }>(rows: T[]): Promise<(T & { requestedByName?: string, decidedByName?: string })[]> => {
  const names = await namesById(rows.flatMap((row) => [row.requestedBy, row.decidedBy]))
  return rows.map((row) => ({
    ...row,
    requestedByName: row.requestedBy ? names.get(String(row.requestedBy)) : undefined,
    decidedByName: row.decidedBy ? names.get(String(row.decidedBy)) : undefined,
  }))
}
export const list = async (req: Request, res: Response) => {
  try {
 const rows = await Approval.find(scope(req)).sort({ createdAt: -1 }).lean()
 res.json(await withNames(rows)) 
} catch (err) {
 logger.error('[approval.list]', err); res.status(400).send(i18n.t('ERROR')) 
}
}
export const create = async (req: Request, res: Response) => {
  try {
    const user = req.user; const supplierId = user?.type === bookcarsTypes.UserType.Admin ? req.body?.supplier : agencySupplierId(req)
    const subject = String(req.body?.subject || '').trim(); const subjectType = String(req.body?.subjectType || '').trim()
    const amount = Number(req.body?.amount); const reason = String(req.body?.reason || '').trim()
    if (!user || !mongoose.isValidObjectId(supplierId) || !subject || !subjectType || subject.length > 200 || subjectType.length > 100 || !Number.isFinite(amount) || reason.length > 1000) {
 res.status(400).send('Invalid approval request'); return 
}
    const existing = await Approval.findOne({ supplier: supplierId, subject, subjectType, status: bookcarsTypes.ApprovalDecision.Pending })
    if (existing) {
 res.status(409).send('A pending approval already exists for this subject'); return 
}
    const approval = await Approval.create({ supplier: supplierId, subject, subjectType, amount, currency: req.body?.currency || undefined, status: bookcarsTypes.ApprovalDecision.Pending, requestedBy: user._id, reason })
    res.status(201).json((await withNames([approval.toObject()]))[0])
  } catch (err) {
 logger.error('[approval.create]', err); res.status(400).send(i18n.t('ERROR')) 
}
}
export const decide = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const { decision, reason } = req.body as { decision?: string; reason?: string }
    if (!user || typeof decision !== 'string' || !['approved','rejected'].includes(decision) || String(reason||'').trim().length > 1000) {
 res.status(400).send('Invalid decision'); return 
}
    const approval = await Approval.findOne({ _id: req.params.id, ...scope(req), status: bookcarsTypes.ApprovalDecision.Pending })
    if (!approval) {
 res.sendStatus(404); return 
}
    // Owner decision 1.4 (GA-P10-DECISIONS-01): a single decider, and the
    // requester can never decide their own request.
    if (approval.requestedBy && approval.requestedBy.toString() === user._id.toString()) {
 res.status(403).send('The requester cannot decide their own approval request'); return 
}
    approval.status = decision === 'approved' ? bookcarsTypes.ApprovalDecision.Approved : bookcarsTypes.ApprovalDecision.Rejected
    approval.decidedBy = new mongoose.Types.ObjectId(user._id); approval.decidedAt = new Date(); approval.reason = String(reason || '').trim()
    await approval.save()
    // Contract charges decided here also settle their domain record, so
    // the queue decision and the charge workflow never diverge.
    if (approval.subjectType === 'contract-charge' && mongoose.isValidObjectId(approval.subject)) {
      const charge = await ContractCharge.findOne({ _id: approval.subject, supplier: approval.supplier, status: bookcarsTypes.ApprovalDecision.Pending })
      if (charge) {
        charge.status = approval.status; charge.decidedBy = approval.decidedBy; charge.decidedAt = approval.decidedAt; charge.decisionNote = approval.reason || undefined
        await charge.save()
      }
    }
    res.json((await withNames([approval.toObject()]))[0])
  } catch (err) {
 logger.error('[approval.decide]', err); res.status(400).send(i18n.t('ERROR')) 
}
}
