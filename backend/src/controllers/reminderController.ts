import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Car from '../models/Car'
import Reminder from '../models/Reminder'
import ReminderFiring from '../models/ReminderFiring'
import User from '../models/User'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'

/**
 * GA-PAR-13 — reminders controller (scorecard #30).
 *
 * Agency-scoped exactly like the agent/quote controllers: ReadReminders
 * gates list/get, ManageReminders gates create/update/delete and the
 * firing history (route middleware). Cross-agency records answer 404
 * (the established :id-route pattern). Linked car/client references are
 * validated against the caller's agency before they are stored:
 * a car must belong to the agency; a client must be a type=User record
 * attached to the agency (clients whose `supplier` is null — the open
 * data-model question preserved by GA-PAR-04 — are accepted only when
 * they carry no other agency).
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

interface ReminderInput {
  title?: string
  note?: string
  category?: bookcarsTypes.ReminderCategory
  linkType?: bookcarsTypes.ReminderLinkType
  car?: string | null
  client?: string | null
  recurrence?: { kind: bookcarsTypes.ReminderRecurrenceKind, intervalDays?: number }
  firstDueAt?: Date
  notifyAheadHours?: number[]
  channels?: { inApp: boolean, email: boolean, push: boolean }
  active?: boolean
}

const validateReminderInput = async (
  body: Record<string, unknown>,
  partial: boolean,
  supplierId: string,
  current?: ReminderInput,
): Promise<{ value: ReminderInput } | { error: string }> => {
  const value: ReminderInput = {}
  if (!partial || body.title !== undefined) {
    const title = cleanText(body.title, 200)
    if (!title) {
      return { error: 'Reminder title is required' }
    }
    value.title = title
  }
  if (body.note !== undefined) {
    value.note = cleanText(body.note, 1000)
  }
  if (body.category !== undefined) {
    if (!Object.values(bookcarsTypes.ReminderCategory).includes(body.category as bookcarsTypes.ReminderCategory)) {
      return { error: 'Invalid reminder category' }
    }
    value.category = body.category as bookcarsTypes.ReminderCategory
  }
  // Link validation runs against the EFFECTIVE link type/refs.
  const effectiveLinkType = (body.linkType !== undefined ? body.linkType : current?.linkType)
    || bookcarsTypes.ReminderLinkType.None
  if (body.linkType !== undefined) {
    if (!Object.values(bookcarsTypes.ReminderLinkType).includes(body.linkType as bookcarsTypes.ReminderLinkType)) {
      return { error: 'Invalid link type' }
    }
    value.linkType = body.linkType as bookcarsTypes.ReminderLinkType
  }
  if (body.linkType !== undefined || body.car !== undefined || body.client !== undefined || !partial) {
    if (effectiveLinkType === bookcarsTypes.ReminderLinkType.Car) {
      const carId = body.car !== undefined ? body.car : current?.car
      if (typeof carId !== 'string' || !mongoose.isValidObjectId(carId)) {
        return { error: 'A car link requires a valid car' }
      }
      const car = await Car.findOne({ _id: carId, supplier: supplierId }).select('_id').lean()
      if (!car) {
        return { error: 'Linked car does not belong to this agency' }
      }
      value.car = carId
      value.client = null
    } else if (effectiveLinkType === bookcarsTypes.ReminderLinkType.Client) {
      const clientId = body.client !== undefined ? body.client : current?.client
      if (typeof clientId !== 'string' || !mongoose.isValidObjectId(clientId)) {
        return { error: 'A client link requires a valid client' }
      }
      const client = await User.findOne({ _id: clientId, type: bookcarsTypes.UserType.User }).select('supplier').lean()
      if (!client || (client.supplier && String(client.supplier) !== supplierId)) {
        return { error: 'Linked client does not belong to this agency' }
      }
      value.client = clientId
      value.car = null
    } else {
      value.car = null
      value.client = null
    }
  }
  if (body.recurrence !== undefined || !partial) {
    const rec = (body.recurrence || {}) as Record<string, unknown>
    const kind = rec.kind !== undefined ? rec.kind : (partial ? current?.recurrence?.kind : bookcarsTypes.ReminderRecurrenceKind.Once)
    if (!Object.values(bookcarsTypes.ReminderRecurrenceKind).includes(kind as bookcarsTypes.ReminderRecurrenceKind)) {
      return { error: 'Invalid recurrence kind' }
    }
    const recurrence: ReminderInput['recurrence'] = { kind: kind as bookcarsTypes.ReminderRecurrenceKind }
    if (kind === bookcarsTypes.ReminderRecurrenceKind.Custom) {
      const interval = rec.intervalDays !== undefined ? Number(rec.intervalDays) : current?.recurrence?.intervalDays
      if (!Number.isInteger(interval) || (interval as number) < 1) {
        return { error: 'A custom recurrence requires intervalDays >= 1' }
      }
      recurrence.intervalDays = interval as number
    }
    value.recurrence = recurrence
  }
  if (body.firstDueAt !== undefined || !partial) {
    const firstDueAt = body.firstDueAt !== undefined ? new Date(body.firstDueAt as string) : (partial ? current?.firstDueAt : undefined)
    if (!firstDueAt || Number.isNaN(firstDueAt.getTime())) {
      return { error: 'A valid first due date is required' }
    }
    value.firstDueAt = firstDueAt
  }
  if (body.notifyAheadHours !== undefined) {
    if (!Array.isArray(body.notifyAheadHours) || body.notifyAheadHours.length === 0
      || !body.notifyAheadHours.every((h) => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 720)) {
      return { error: 'notifyAheadHours must be a non-empty list of integers between 0 and 720' }
    }
    value.notifyAheadHours = [...new Set(body.notifyAheadHours as number[])].sort((a, b) => b - a)
  }
  if (body.channels !== undefined) {
    const ch = body.channels as Record<string, unknown>
    if (typeof ch !== 'object' || ch === null
      || (ch.inApp !== undefined && typeof ch.inApp !== 'boolean')
      || (ch.email !== undefined && typeof ch.email !== 'boolean')
      || (ch.push !== undefined && typeof ch.push !== 'boolean')) {
      return { error: 'Invalid channels' }
    }
    const base = current?.channels || { inApp: true, email: false, push: false }
    value.channels = {
      inApp: typeof ch.inApp === 'boolean' ? ch.inApp : base.inApp,
      email: typeof ch.email === 'boolean' ? ch.email : base.email,
      push: typeof ch.push === 'boolean' ? ch.push : base.push,
    }
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return { error: 'Invalid active flag' }
    }
    value.active = body.active
  }
  return { value }
}

const populateReminder = (query: mongoose.Query<any, any>) => query
  .populate({ path: 'car', select: 'name licensePlate' })
  .populate({ path: 'client', select: 'fullName email' })
  .populate({ path: 'createdBy', select: 'fullName email' })

export const list = async (req: Request, res: Response) => {
  try {
    const reminders = await populateReminder(Reminder.find(scope(req)).sort({ nextDueAt: 1, createdAt: -1 })).lean()
    res.json(reminders)
  } catch (err) {
    logger.error('[reminder.list]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const getOne = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const reminder = await populateReminder(Reminder.findOne({ _id: req.params.id, ...scope(req) })).lean()
    if (!reminder) { res.sendStatus(404); return }
    res.json(reminder)
  } catch (err) {
    logger.error('[reminder.getOne]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const firings = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const reminder = await Reminder.findOne({ _id: req.params.id, ...scope(req) }).select('_id').lean()
    if (!reminder) { res.sendStatus(404); return }
    const rows = await ReminderFiring.find({ reminder: req.params.id }).sort({ firedAt: -1 }).lean()
    res.json(rows)
  } catch (err) {
    logger.error('[reminder.firings]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const create = async (req: Request, res: Response) => {
  try {
    const supplierId = supplierForWrite(req)
    if (!supplierId || !mongoose.isValidObjectId(supplierId)) {
      res.status(400).send('Invalid reminder'); return
    }
    const validated = await validateReminderInput((req.body || {}) as Record<string, unknown>, false, supplierId)
    if ('error' in validated) { res.status(400).send(validated.error); return }
    const v = validated.value
    const reminder = await Reminder.create({
      supplier: supplierId,
      title: v.title,
      note: v.note,
      category: v.category || bookcarsTypes.ReminderCategory.Custom,
      linkType: v.linkType || bookcarsTypes.ReminderLinkType.None,
      car: v.car || undefined,
      client: v.client || undefined,
      recurrence: v.recurrence || { kind: bookcarsTypes.ReminderRecurrenceKind.Once },
      firstDueAt: v.firstDueAt,
      notifyAheadHours: v.notifyAheadHours || [0],
      channels: v.channels || { inApp: true, email: false, push: false },
      active: v.active ?? true,
      nextDueAt: v.firstDueAt,
      createdBy: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : undefined,
    })
    const populated = await populateReminder(Reminder.findById(reminder._id)).lean()
    res.status(201).json(populated)
  } catch (err) {
    logger.error('[reminder.create]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const update = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const reminder = await Reminder.findOne({ _id: req.params.id, ...scope(req) })
    if (!reminder) { res.sendStatus(404); return }
    const supplierId = String(reminder.supplier)
    const current: ReminderInput = {
      linkType: reminder.linkType as bookcarsTypes.ReminderLinkType,
      car: reminder.car ? String(reminder.car) : null,
      client: reminder.client ? String(reminder.client) : null,
      recurrence: reminder.recurrence as ReminderInput['recurrence'],
      firstDueAt: reminder.firstDueAt,
      channels: reminder.channels as ReminderInput['channels'],
    }
    const validated = await validateReminderInput((req.body || {}) as Record<string, unknown>, true, supplierId, current)
    if ('error' in validated) { res.status(400).send(validated.error); return }
    const v = validated.value
    if (v.title !== undefined) reminder.title = v.title
    if (v.note !== undefined) reminder.note = v.note
    if (v.category !== undefined) reminder.category = v.category
    if (v.linkType !== undefined) reminder.linkType = v.linkType
    if (v.car !== undefined) reminder.car = (v.car || undefined) as never
    if (v.client !== undefined) reminder.client = (v.client || undefined) as never
    const scheduleChanged = v.recurrence !== undefined || v.firstDueAt !== undefined
    if (v.recurrence !== undefined) reminder.recurrence = v.recurrence as never
    if (v.firstDueAt !== undefined) reminder.firstDueAt = v.firstDueAt
    if (v.notifyAheadHours !== undefined) reminder.notifyAheadHours = v.notifyAheadHours
    if (v.channels !== undefined) reminder.channels = v.channels as never
    if (v.active !== undefined) reminder.active = v.active
    if (scheduleChanged) {
      // The anchor moved: the current occurrence restarts at the anchor.
      // Already-claimed firings for that instant stay claimed (unique
      // index), so a re-saved schedule can never double-fire.
      reminder.nextDueAt = reminder.firstDueAt
      if (reminder.recurrence?.kind === bookcarsTypes.ReminderRecurrenceKind.Once && v.active === undefined) {
        reminder.active = true
      }
    } else if (v.active === true && !reminder.nextDueAt) {
      reminder.nextDueAt = reminder.firstDueAt
    }
    await reminder.save()
    const populated = await populateReminder(Reminder.findById(reminder._id)).lean()
    res.json(populated)
  } catch (err) {
    logger.error('[reminder.update]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const remove = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.sendStatus(404); return }
    const deleted = await Reminder.deleteOne({ _id: req.params.id, ...scope(req) })
    if (!deleted.deletedCount) { res.sendStatus(404); return }
    await ReminderFiring.deleteMany({ reminder: req.params.id })
    res.sendStatus(200)
  } catch (err) {
    logger.error('[reminder.remove]', err); res.status(400).send(i18n.t('ERROR'))
  }
}
