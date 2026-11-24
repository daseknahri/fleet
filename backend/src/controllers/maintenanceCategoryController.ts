import mongoose from 'mongoose'
import { Request, Response } from 'express'
import * as bookcarsTypes from ':bookcars-types'
import i18n from '../lang/i18n'
import MaintenanceCategory from '../models/MaintenanceCategory'
import MaintenanceExpense from '../models/MaintenanceExpense'
import MaintenanceSchedule from '../models/MaintenanceSchedule'
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import { agencySupplierId, logAdminResourceAccess } from '../utils/agencyAuthorization'

/**
 * Next pass - agency-created maintenance categories (the goal is the
 * expenses: the agency groups its maintenance costs its own way, beyond
 * the fixed MaintenanceExpenseType enum). Same scope rules as the
 * expense controller: a supplier sees only its own categories; a
 * platform admin reads all (allowPlatformAdminAll) but creates only
 * inside an agency context. Names are unique per agency
 * (case-insensitive check + unique index backstop). Deleting is refused
 * while any expense or schedule references the category - deactivate
 * it instead.
 */
const getScope = (req: Request): Record<string, unknown> => {
  if (req.user?.type === bookcarsTypes.UserType.Admin) {
    return {}
  }
  return { supplier: agencySupplierId(req) || '000000000000000000000000' }
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

const normalize = (payload: bookcarsTypes.UpsertMaintenanceCategoryPayload) => {
  const name = String(payload.name || '').trim()
  // null = leave the colour unchanged (only name + active are ever cleared).
  const color = payload.color === null || payload.color === undefined ? undefined : String(payload.color).trim()
  const active = payload.active === undefined ? undefined : !!payload.active
  if (!name || name.length > 100 || (color !== undefined && !COLOR_RE.test(color))) {
    return null
  }
  return { name, ...(color !== undefined ? { color } : {}), ...(active !== undefined ? { active } : {}) }
}

const present = (row: env.MaintenanceCategory) => (row.toObject ? row.toObject() : row)

const duplicateName = async (supplierId: string, name: string, excludeId?: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const existing = await MaintenanceCategory.findOne({
    supplier: new mongoose.Types.ObjectId(supplierId),
    name: { $regex: `^${escaped}$`, $options: 'i' },
    ...(excludeId ? { _id: { $ne: new mongoose.Types.ObjectId(excludeId) } } : {}),
  })
  return !!existing
}

export const list = async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = { ...getScope(req) }
    if (req.query.active === 'true') {
      filter.active = true
    }
    if (req.query.active === 'false') {
      filter.active = false
    }
    const rows = await MaintenanceCategory.find(filter).sort({ name: 1 })
    res.json(rows.map(present))
  } catch (err) {
    logger.error('[maintenanceCategory.list]', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const create = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const payload = normalize(req.body as bookcarsTypes.UpsertMaintenanceCategoryPayload)
    const supplierId = agencySupplierId(req)
    if (!user || !payload || !supplierId) {
      res.status(400).send('Invalid maintenance category')
      return
    }
    if (await duplicateName(supplierId, payload.name)) {
      res.status(409).send('A category with this name already exists')
      return
    }
    const row = await MaintenanceCategory.create({ ...payload, active: payload.active ?? true, supplier: supplierId })
    res.status(201).json(present(row))
  } catch (err) {
    logger.error('[maintenanceCategory.create]', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const update = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).send('Invalid maintenance category')
      return
    }
    const payload = normalize(req.body as bookcarsTypes.UpsertMaintenanceCategoryPayload)
    const row = await MaintenanceCategory.findOne({ _id: req.params.id, ...getScope(req) })
    if (!row || !payload) {
      res.status(row ? 400 : 404).send(row ? 'Invalid maintenance category' : 'Not found')
      return
    }
    // GH-07 — a platform admin updated this category without a
    // selector; audit with the category's agency.
    await logAdminResourceAccess(req, row.supplier?.toString(), 'maintenance-category:update')
    if (payload.name.toLowerCase() !== row.name.toLowerCase() && await duplicateName(row.supplier.toString(), payload.name, row._id.toString())) {
      res.status(409).send('A category with this name already exists')
      return
    }
    Object.assign(row, payload)
    await row.save()
    res.json(present(row))
  } catch (err) {
    logger.error('[maintenanceCategory.update]', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const remove = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).send('Invalid maintenance category')
      return
    }
    const row = await MaintenanceCategory.findOne({ _id: req.params.id, ...getScope(req) })
    if (!row) {
      res.status(404).send('Not found')
      return
    }
    // GH-07 — a platform admin deleted this category without a
    // selector; audit with the category's agency.
    await logAdminResourceAccess(req, row.supplier?.toString(), 'maintenance-category:delete')
    const [expenseCount, scheduleCount] = await Promise.all([
      MaintenanceExpense.countDocuments({ category: row._id }),
      MaintenanceSchedule.countDocuments({ category: row._id }),
    ])
    if (expenseCount + scheduleCount > 0) {
      res.status(409).send(`Category is in use by ${expenseCount} expense(s) and ${scheduleCount} schedule(s). Deactivate it instead.`)
      return
    }
    await MaintenanceCategory.deleteOne({ _id: row._id })
    res.sendStatus(200)
  } catch (err) {
    logger.error('[maintenanceCategory.remove]', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}