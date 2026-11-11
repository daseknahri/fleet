import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Agent from '../models/Agent'
import AgentSettlement from '../models/AgentSettlement'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'
import {
  getAgentFigures, getAgentKpis, fifoBookingRefs, isValidCommission, roundMoney,
} from '../utils/agentCommission'

/**
 * GA-PAR-07 — Apporteurs (business referrers) controller.
 *
 * Agency-scoped exactly like quotes/invoices: ReadAgents gates reads (and
 * the booking-form agent picker), ManageAgents gates create/update/delete
 * and settle (route middleware). Cross-agency records answer 404, the
 * established :id-route pattern. All money figures come from the ONE
 * definition in utils/agentCommission (outstanding = Σ booking snapshot
 * amounts excluding Void/Cancelled − Σ settlements).
 *
 * Settle semantics: a settlement is a payment against the agent's
 * outstanding balance, allocated FIFO by booking creation date for the
 * bookingRefs record. Amount must be > 0 and ≤ outstanding — an
 * overpayment is refused 400 and nothing is recorded. confirmedBy /
 * confirmedAt are stamped server-side from the session.
 */

const scope = (req: Request) => {
  if (req.user?.type === bookcarsTypes.UserType.Admin) {
    const requested = typeof req.query.supplier === 'string' ? req.query.supplier : undefined
    return requested && mongoose.isValidObjectId(requested) ? { supplier: requested } : {}
  }
  return { supplier: agencySupplierId(req) || '000000000000000000000000' }
}

const supplierForWrite = (req: Request): string | undefined => {
  if (req.user?.type === bookcarsTypes.UserType.Admin) {
    const fromBody = typeof req.body?.supplier === 'string' ? req.body.supplier : undefined
    const fromQuery = typeof req.query.supplier === 'string' ? req.query.supplier : undefined
    const candidate = fromBody || fromQuery
    return candidate && mongoose.isValidObjectId(candidate) ? candidate : undefined
  }
  return agencySupplierId(req)
}

const cleanText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

interface AgentInputResult {
  name?: string
  phone?: string
  type?: bookcarsTypes.AgentType
  commissionMode?: bookcarsTypes.CommissionMode
  commissionValue?: number
  active?: boolean
  notes?: string
}

const validateAgentInput = (body: Record<string, unknown>, partial: boolean): { value: AgentInputResult } | { error: string } => {
  const value: AgentInputResult = {}
  if (!partial || body.name !== undefined) {
    const name = cleanText(body.name, 200)
    if (!name) {
      return { error: 'Agent name is required' }
    }
    value.name = name
  }
  if (body.phone !== undefined) {
    value.phone = cleanText(body.phone, 50)
  }
  if (body.type !== undefined) {
    if (!Object.values(bookcarsTypes.AgentType).includes(body.type as bookcarsTypes.AgentType)) {
      return { error: 'Invalid agent type' }
    }
    value.type = body.type as bookcarsTypes.AgentType
  }
  const modeProvided = body.commissionMode !== undefined
  const valueProvided = body.commissionValue !== undefined
  if (modeProvided || valueProvided || !partial) {
    const mode = modeProvided ? body.commissionMode : bookcarsTypes.CommissionMode.Percent
    const commissionValue = valueProvided ? Number(body.commissionValue) : 0
    if (modeProvided && !Object.values(bookcarsTypes.CommissionMode).includes(mode as bookcarsTypes.CommissionMode)) {
      return { error: 'Invalid commission mode' }
    }
    if (!isValidCommission(mode as bookcarsTypes.CommissionMode, commissionValue)) {
      return { error: 'Invalid commission value' }
    }
    if (modeProvided) {
      value.commissionMode = mode as bookcarsTypes.CommissionMode
    }
    if (valueProvided) {
      value.commissionValue = commissionValue
    }
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return { error: 'Invalid active flag' }
    }
    value.active = body.active
  }
  if (body.notes !== undefined) {
    value.notes = cleanText(body.notes, 1000)
  }
  return { value }
}

export const list = async (req: Request, res: Response) => {
  try {
    const agents = await Agent.find(scope(req)).sort({ name: 1 }).lean()
    const enriched = await Promise.all(agents.map(async (agent) => {
      const figures = await getAgentFigures(agent.supplier, agent._id)
      return { ...agent, due: figures.due, rentalBrought: figures.rentalBrought }
    }))
    res.json(enriched)
  } catch (err) {
    logger.error('[agent.list]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const kpis = async (req: Request, res: Response) => {
  try {
    const supplierId = req.user?.type === bookcarsTypes.UserType.Admin
      ? (typeof req.query.supplier === 'string' && mongoose.isValidObjectId(req.query.supplier) ? req.query.supplier : undefined)
      : agencySupplierId(req)
    res.json(await getAgentKpis(supplierId))
  } catch (err) {
    logger.error('[agent.kpis]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const getOne = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const agent = await Agent.findOne({ _id: req.params.id, ...scope(req) }).lean()
    if (!agent) { res.sendStatus(404); return }
    const figures = await getAgentFigures(agent.supplier, agent._id)
    const settlements = await AgentSettlement.find({ supplier: agent.supplier, agent: agent._id })
      .sort({ createdAt: -1 })
      .populate({ path: 'confirmedBy', select: 'fullName email' })
      .lean()
    res.json({ ...agent, due: figures.due, rentalBrought: figures.rentalBrought, settlements })
  } catch (err) {
    logger.error('[agent.getOne]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const create = async (req: Request, res: Response) => {
  try {
    const supplierId = supplierForWrite(req)
    if (!supplierId || !mongoose.isValidObjectId(supplierId)) {
      res.status(400).send('Invalid agent'); return
    }
    const validated = validateAgentInput((req.body || {}) as Record<string, unknown>, false)
    if ('error' in validated) { res.status(400).send(validated.error); return }
    const agent = await Agent.create({
      supplier: supplierId,
      name: validated.value.name,
      phone: validated.value.phone,
      type: validated.value.type || bookcarsTypes.AgentType.Other,
      commissionMode: validated.value.commissionMode || bookcarsTypes.CommissionMode.Percent,
      commissionValue: validated.value.commissionValue ?? 0,
      active: validated.value.active ?? true,
      notes: validated.value.notes,
    })
    const figures = await getAgentFigures(agent.supplier, agent._id)
    res.status(201).json({ ...agent.toObject(), due: figures.due, rentalBrought: figures.rentalBrought })
  } catch (err) {
    logger.error('[agent.create]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const update = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const agent = await Agent.findOne({ _id: req.params.id, ...scope(req) })
    if (!agent) { res.sendStatus(404); return }
    const validated = validateAgentInput((req.body || {}) as Record<string, unknown>, true)
    if ('error' in validated) { res.status(400).send(validated.error); return }
    // Cross-field rule on partial updates: a percent commission above 100
    // is refused against the EFFECTIVE mode/value pair, not just the delta.
    const effectiveMode = validated.value.commissionMode ?? agent.commissionMode
    const effectiveValue = validated.value.commissionValue ?? agent.commissionValue
    if (!isValidCommission(effectiveMode, effectiveValue)) {
      res.status(400).send('Invalid commission value'); return
    }
    Object.assign(agent, validated.value)
    await agent.save()
    const figures = await getAgentFigures(agent.supplier, agent._id)
    res.json({ ...agent.toObject(), due: figures.due, rentalBrought: figures.rentalBrought })
  } catch (err) {
    logger.error('[agent.update]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const remove = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const deleted = await Agent.deleteOne({ _id: req.params.id, ...scope(req) })
    if (!deleted.deletedCount) { res.sendStatus(404); return }
    res.sendStatus(200)
  } catch (err) {
    logger.error('[agent.remove]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const settle = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const agent = await Agent.findOne({ _id: req.params.id, ...scope(req) }).lean()
    if (!agent) { res.sendStatus(404); return }
    const body = (req.body || {}) as Record<string, unknown>
    const amount = roundMoney(Number(body.amount))
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).send('Settlement amount must be greater than zero'); return
    }
    if (!Object.values(bookcarsTypes.AgentSettlementMethod).includes(body.method as bookcarsTypes.AgentSettlementMethod)) {
      res.status(400).send('Invalid settlement method'); return
    }
    const figures = await getAgentFigures(agent.supplier, agent._id)
    if (amount > figures.due) {
      res.status(400).send('Settlement amount exceeds the outstanding balance for this agent'); return
    }
    const bookingRefs = await fifoBookingRefs(agent.supplier, agent._id, amount, figures.settled)
    const settlement = await AgentSettlement.create({
      supplier: agent.supplier,
      agent: agent._id,
      amount,
      method: body.method as bookcarsTypes.AgentSettlementMethod,
      confirmedBy: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : undefined,
      confirmedAt: new Date(),
      note: cleanText(body.note, 1000),
      bookingRefs,
    })
    await settlement.populate({ path: 'confirmedBy', select: 'fullName email' })
    res.status(201).json({ settlement, due: roundMoney(figures.due - amount) })
  } catch (err) {
    logger.error('[agent.settle]', err); res.status(400).send(i18n.t('ERROR'))
  }
}
