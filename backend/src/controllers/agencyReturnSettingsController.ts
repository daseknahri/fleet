import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import AgencyReturnSettings from '../models/AgencyReturnSettings'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'

/**
 * GA-PAR-06: per-agency return & settlement rates.
 * Storage is the NEW AgencyReturnSettings collection (coordinator decision
 * 2); the global Setting singleton is not read or written here.
 * Gating mirrors the supplier profile routes (PAR-01): reads require
 * ReadAgencyProfile, writes require ManageAgencyProfile — no new permission.
 * Agency scoping mirrors contractOperations: a platform admin may select an
 * agency via ?supplier=, everyone else is resolved from their own agency
 * context, so one agency can never read or write another agency's rates.
 */

const supplierFor = (req: Request): string | undefined => (req.user?.type === bookcarsTypes.UserType.Admin
  ? (typeof req.query.supplier === 'string' && req.query.supplier) || (typeof req.body?.supplier === 'string' && req.body.supplier) || undefined
  : agencySupplierId(req))

const RATE_FIELDS = ['includedKmPerDay', 'extraKmPrice', 'fuelPricePerLitre', 'washFee', 'defaultDeposit'] as const

export const getAgencyReturnSettings = async (req: Request, res: Response) => {
  try {
    const supplier = supplierFor(req)
    if (!supplier || !mongoose.isValidObjectId(supplier)) {
      res.sendStatus(404)
      return
    }
    const settings = await AgencyReturnSettings.findOne({ supplier })
    res.json(settings || null)
  } catch (err) {
    logger.error('[agencyReturnSettings.get]', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const updateAgencyReturnSettings = async (req: Request, res: Response) => {
  try {
    const supplier = supplierFor(req)
    if (!supplier || !mongoose.isValidObjectId(supplier)) {
      res.sendStatus(404)
      return
    }
    const body = (req.body || {}) as Record<string, unknown>
    const update: Record<string, unknown> = {}
    const unset: Record<string, string> = {}
    for (const field of RATE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(body, field) || body[field] === undefined) {
        continue
      }
      const value = body[field]
      if (value === null || value === '') {
        unset[field] = ''
        continue
      }
      const num = Number(value)
      if (!Number.isFinite(num) || num < 0) {
        res.status(400).send(`Invalid ${field}`)
        return
      }
      update[field] = num
    }
    const doc = await AgencyReturnSettings.findOneAndUpdate(
      { supplier },
      { $set: { supplier, ...update }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    )
    res.json(doc)
  } catch (err) {
    logger.error('[agencyReturnSettings.update]', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
