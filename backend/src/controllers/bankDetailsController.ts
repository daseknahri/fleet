import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import BankDetails from '../models/BankDetails'
import { isValidIban, isValidSwiftBic } from '../utils/bankValidation'
import { agencySupplierId } from '../utils/agencyAuthorization'

/**
 * Wave 2.6 — one RIB per agency. The platform-global row (no supplier
 * field) stays for the platform itself; an agency reads and writes
 * ONLY its own row and never sees the platform's (admin P1-3: the old
 * `get` returned the platform IBAN to any agency owner). The old
 * upsert's `deleteMany()` wiped EVERY agency's RIB on any upsert —
 * it is gone; each scope upserts only its own row.
 *
 * Who may call: Admin (global row, or a selected agency's row via
 * `?supplier=` / `body.supplier`) and the agency Owner (own row).
 * Staff and customers are refused (same gate the old authSupplier
 * enforced for reads; the upsert route previously hid behind
 * authAdmin only — see bankDetailsRoutes).
 */

type BankScope = { kind: 'global' } | { kind: 'agency', supplier: mongoose.Types.ObjectId }

const scopeFor = (req: Request): BankScope | null => {
  const user = req.user
  if (!user || user.type === bookcarsTypes.UserType.User || user.type === bookcarsTypes.UserType.Staff) {
    return null
  }
  if (user.type === bookcarsTypes.UserType.Admin) {
    const raw = req.query.supplier ?? req.body?.supplier
    if (typeof raw === 'string' && mongoose.isValidObjectId(raw)) {
      return { kind: 'agency', supplier: new mongoose.Types.ObjectId(raw) }
    }
    return { kind: 'global' }
  }
  const agency = agencySupplierId(req)
  if (!agency || !mongoose.isValidObjectId(agency)) {
    return null
  }
  return { kind: 'agency', supplier: new mongoose.Types.ObjectId(agency) }
}

const scopeFilter = (scope: BankScope): Record<string, unknown> => (scope.kind === 'global'
  ? { $or: [{ supplier: { $exists: false } }, { supplier: null }] }
  : { supplier: scope.supplier })

/**
 * Upsert BankDetails.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const upsert = async (req: Request, res: Response) => {
  const { body }: { body: bookcarsTypes.UpsertBankDetailsPayload } = req
  try {
    const scope = scopeFor(req)
    if (!scope) {
      res.status(403).send('Only the agency owner or a platform admin can update bank details')
      return
    }
    let bankDetails: env.BankDetails | null = null
    if (body._id) {
      bankDetails = await BankDetails.findById(body._id)
      // An _id from another scope is not this caller's row: an agency
      // must never be able to overwrite the platform row (or another
      // agency's) by guessing its id, and the platform row is only
      // editable in the global scope.
      if (bankDetails) {
        const rowSupplier = bankDetails.supplier?.toString()
        if (scope.kind === 'agency' && rowSupplier !== scope.supplier.toString()) {
          res.status(403).send('Bank details do not belong to this agency')
          return
        }
        if (scope.kind === 'global' && rowSupplier) {
          res.status(403).send('Bank details belong to an agency; select that agency to edit them')
          return
        }
      }
    }

    const {
      accountHolder,
      bankName,
      iban,
      swiftBic,
      showBankDetailsPage,
    } = body

    // F8 / W5 S5 — same IBAN (mod-97) + SWIFT validation as the form:
    // a non-empty value must be valid (empty stays allowed — the form's
    // HTML `required` blocks an empty submit in the browser).
    if ((typeof iban === 'string' && iban.trim() && !isValidIban(iban))
      || (typeof swiftBic === 'string' && swiftBic.trim() && !isValidSwiftBic(swiftBic))) {
      res.status(400).send('Invalid bank details')
      return
    }

    if (bankDetails) {
      bankDetails.accountHolder = accountHolder
      bankDetails.bankName = bankName
      bankDetails.iban = iban
      bankDetails.swiftBic = swiftBic
      bankDetails.showBankDetailsPage = showBankDetailsPage
    } else {
      // No row yet in this scope: reuse the scope's row if one exists
      // (an upsert without _id), else create it. Never deleteMany().
      bankDetails = await BankDetails.findOne(scopeFilter(scope))
      if (bankDetails) {
        bankDetails.accountHolder = accountHolder
        bankDetails.bankName = bankName
        bankDetails.iban = iban
        bankDetails.swiftBic = swiftBic
        bankDetails.showBankDetailsPage = showBankDetailsPage
      } else {
        bankDetails = new BankDetails({
          accountHolder,
          bankName,
          iban,
          swiftBic,
          showBankDetailsPage,
          ...(scope.kind === 'agency' ? { supplier: scope.supplier } : {}),
        })
      }
    }
    await bankDetails.save()

    res.json(bankDetails)
  } catch (err) {
    logger.error(`[bankDetails.upsert] ${i18n.t('ERROR')} ${JSON.stringify(body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Get BankDetails.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const get = async (req: Request, res: Response) => {
  try {
    const scope = scopeFor(req)
    if (!scope) {
      res.status(403).send('Agency membership is required')
      return
    }
    const bankDetails = await BankDetails.findOne(scopeFilter(scope))
    res.json(bankDetails)
  } catch (err) {
    logger.error(`[bankDetails.get] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
