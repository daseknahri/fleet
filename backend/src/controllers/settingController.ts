import { Request, Response } from 'express'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import Setting from '../models/Setting'

/**
 * Initialize settings.
 *
 * @async
 * @returns {Promise<boolean>}
 */
export const init = async () => {
  try {
    const count = await Setting.findOne({}).countDocuments()

    if (count === 0) {
      await new Setting().save()
    }

    return true
  } catch (err) {
    logger.error(`[setting.init] ${i18n.t('ERROR')}`, err)
    return false
  }
}

/**
 * Get settings.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getSettings = async (req: Request, res: Response) => {
  try {
    const settings = await Setting.findOne({})

    res.json(settings)
  } catch (err) {
    logger.error(`[setting.getSettings] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * F8 / W5 S1 — connections status for the /settings Connections card.
 * Booleans only: whether each external channel is configured (the
 * credential is present in the environment). No secret is ever
 * returned; a `true` only means "configured".
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getConnections = async (req: Request, res: Response) => {
  try {
    res.json({
      stripe: Boolean(env.STRIPE_SECRET_KEY),
      paypal: Boolean(env.PAYPAL_CLIENT_ID),
      smtp: Boolean(env.SMTP_HOST),
      push: Boolean(env.EXPO_ACCESS_TOKEN),
    } satisfies bookcarsTypes.SettingsConnections)
  } catch (err) {
    logger.error(`[setting.getConnections] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Update settings.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const updateSettings = async (req: Request, res: Response) => {
  try {
    const {
      minPickupHours,
      minRentalHours,
      minPickupDropoffHour,
      maxPickupDropoffHour,
    }: bookcarsTypes.UpdateSettingsPayload = req.body
    // F8 / W5 S4 — explicit validation, never trusting the Mongoose
    // model validators alone: counts must be integers >= 1, hours
    // integers 0-23. Empty strings, non-numbers, NaN, fractions and
    // zero are all 400 (an empty string used to arrive as 0).
    const isValidCount = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 1
    const isValidHour = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23
    if ((typeof minPickupHours !== 'undefined' && !isValidCount(minPickupHours))
      || (typeof minRentalHours !== 'undefined' && !isValidCount(minRentalHours))
      || (typeof minPickupDropoffHour !== 'undefined' && !isValidHour(minPickupDropoffHour))
      || (typeof maxPickupDropoffHour !== 'undefined' && !isValidHour(maxPickupDropoffHour))) {
      res.status(400).send('Invalid settings')
      return
    }
    const settings = await Setting.findOne({})

    if (settings) {
      // H-026 (hardening Wave 4): assign only the fields the caller actually
      // sent. The previous unconditional assignments turned a partial payload
      // into a silent reset of every omitted setting to its model default,
      // and nothing stopped an inverted pickup/dropoff hour window from
      // being persisted.
      if (typeof minPickupHours !== 'undefined') {
        settings.minPickupHours = minPickupHours
      }
      if (typeof minRentalHours !== 'undefined') {
        settings.minRentalHours = minRentalHours
      }
      if (typeof minPickupDropoffHour !== 'undefined') {
        settings.minPickupDropoffHour = minPickupDropoffHour
      }
      if (typeof maxPickupDropoffHour !== 'undefined') {
        settings.maxPickupDropoffHour = maxPickupDropoffHour
      }

      if (settings.minPickupDropoffHour > settings.maxPickupDropoffHour) {
        res.status(400).send(i18n.t('ERROR'))
        return
      }

      await settings.save()

      res.json(settings)
      return
    }

    res.sendStatus(204)
  } catch (err) {
    logger.error(`[setting.updateSettings] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
