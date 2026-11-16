import { Request, Response } from 'express'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import BankDetails from '../models/BankDetails'
import { isValidIban, isValidSwiftBic } from '../utils/bankValidation'

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
    let bankDetails: env.BankDetails | null = null
    if (body._id) {
      bankDetails = await BankDetails.findById(body._id)
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
      await BankDetails.deleteMany()
      bankDetails = new BankDetails({
        accountHolder,
        bankName,
        iban,
        swiftBic,
        showBankDetailsPage,
      })
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
    const bankDetails = await BankDetails.findOne()
    res.json(bankDetails)
  } catch (err) {
    logger.error(`[bankDetails.get] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
