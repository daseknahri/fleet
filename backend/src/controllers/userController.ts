import path from 'node:path'
import asyncFs from 'node:fs/promises'
import bcrypt from 'bcrypt'
import { nanoid } from 'nanoid'
import escapeStringRegexp from 'escape-string-regexp'
import mongoose from 'mongoose'
import { CookieOptions, Request, Response } from 'express'
import * as nodemailer from 'nodemailer'
import type { SendMailOptions } from 'nodemailer'
import axios from 'axios'
import * as bookcarsTypes from ':bookcars-types'
import i18n from '../lang/i18n'
import * as env from '../config/env.config'
import User from '../models/User'
import Booking from '../models/Booking'
import Token from '../models/Token'
import RevokedSession from '../models/RevokedSession'
import PushToken from '../models/PushToken'
import * as helper from '../utils/helper'
import * as authHelper from '../utils/authHelper'
import * as mailHelper from '../utils/mailHelper'
import Notification from '../models/Notification'
import AgencyMembership from '../models/AgencyMembership'
import NotificationCounter from '../models/NotificationCounter'
import Car from '../models/Car'
import AdditionalDriver from '../models/AdditionalDriver'
import * as logger from '../utils/logger'
import { canDeleteOwnedTempFile } from '../utils/authorization'
import { createLicenseCapabilityFilename, isValidLicenseCapabilityFilename } from '../utils/tempFileCapability'
import { contentMatchesExtension } from '../utils/fileContent'
import { agencySupplierId, AgencyPermission, hasAgencyPermission } from '../utils/agencyAuthorization'
import { normalizeFiscalFields, applyFiscalFields, FISCAL_STRING_KEYS } from '../utils/fiscal'
import { normalizeClientIdentityFields, applyClientIdentityFields, CLIENT_IDENTITY_KEYS } from '../utils/clientIdentity'
import { getClientBalances } from '../utils/contractReceivable'

/**
 * Get status message as HTML.
 *
 * @param {string} lang
 * @param {string} msg
 * @returns {string}
 */
const getStatusMessage = (lang: string, msg: string) => (
  `<!DOCTYPE html><html lang="'${lang}'"><head></head><body><p>${msg}</p></body></html>`
)

const isDuplicateEmailError = (err: unknown) =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === 11000

/**
 * Sign Up.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @param {bookcarsTypes.UserType} userType
 * @returns {unknown}
 */
const _signup = async (req: Request, res: Response, userType: bookcarsTypes.UserType) => {
  const { body }: { body: bookcarsTypes.SignUpPayload } = req

  //
  // Create user
  //
  let user: env.User
  try {
    body.email = helper.trim(body.email, ' ')
    body.active = true
    body.verified = false
    body.blacklisted = false
    body.type = userType
    ;(body as { signupOrigin?: string }).signupOrigin = 'self'

    const { password } = body
    const passwordHash = await authHelper.hashPassword(password)
    body.password = passwordHash

    user = new User(body)
    await user.save()

    // avatar
    if (body.avatar) {
      // -----------------------------
      // 1️. Sanitize filename
      // -----------------------------
      const safeAvatar = path.basename(body.avatar)

      // If basename changed it, it's a traversal attempt
      if (safeAvatar !== body.avatar) {
        logger.warn(`[user.signup] Directory traversal attempt (avatar): ${body.avatar}`)
        res.status(400).send('Invalid avatar filename')
        return
      }

      const tempDir = path.resolve(env.CDN_TEMP_USERS)
      const usersDir = path.resolve(env.CDN_USERS)

      const avatarPath = path.resolve(tempDir, safeAvatar)

      // -----------------------------
      // 2️. Ensure source is inside temp directory
      // -----------------------------
      if (!avatarPath.startsWith(tempDir + path.sep)) {
        logger.warn(`[user.signup] Avatar source path escape attempt: ${avatarPath}`)
        res.status(400).send('Invalid avatar path')
        return
      }

      if (await helper.pathExists(avatarPath)) {
        const ext = path.extname(safeAvatar)

        // security check: restrict allowed extensions
        if (!env.allowedImageExtensions.includes(ext.toLowerCase())) {
          res.status(400).send('Invalid avatar file type')
          return
        }

        const filename = `${user._id}_${Date.now()}${ext}`
        const newPath = path.resolve(usersDir, filename)

        // -----------------------------
        // 3. Ensure destination is inside users directory
        // -----------------------------
        if (!newPath.startsWith(usersDir + path.sep)) {
          logger.warn(`[user.signup] Avatar destination path escape attempt: ${newPath}`)
          res.status(400).send('Invalid avatar destination')
          return
        }

        await asyncFs.rename(avatarPath, newPath)

        user.avatar = filename
        await user.save()
      }
    }
  } catch (err) {
    if (isDuplicateEmailError(err)) {
      res.sendStatus(200)
      return
    }
    logger.error(`[user.signup] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
    return
  }

  //
  // Send confirmation email
  //
  try {
    // generate token and save
    const token = new Token({ user: user._id, token: helper.generateToken() })

    await token.save()

    // Send email
    i18n.locale = user.language

    // H-006: the emailed link is built from the configured API base URL
    // (BC_API_HOST) only — never from the request Host header, which is
    // attacker-controlled (Host-header injection). If BC_API_HOST is not
    // configured, fail safe: no link is generated and the signup follows
    // the existing mail-failure path below.
    if (!env.API_HOST) {
      throw new Error('BC_API_HOST is not configured')
    }

    const activationLink = `${helper.joinURL(env.API_HOST, 'api/confirm-email')}/${user.email}/${token.token}`

    const mailOptions: SendMailOptions = {
      from: env.SMTP_FROM,
      to: user.email,
      subject: i18n.t('ACCOUNT_ACTIVATION_SUBJECT'),
      html:
        `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
          <p style="font-size: 16px; color: #555;">
            ${i18n.t('HELLO')} ${user.fullName},<br><br>
            ${i18n.t('ACCOUNT_ACTIVATION_LINK')}<br><br>
            <a href="${activationLink}" target="_blank">${activationLink}</a><br><br>
            ${i18n.t('REGARDS')}<br>
          </p>
        </div>`,
    }
    await mailHelper.sendMail(mailOptions)
    res.sendStatus(200)
  } catch (err) {
    if (env.AUTO_VERIFY_ON_SIGNUP) {
      logger.warn('[user.signup] Email sending failed with AUTO_VERIFY_ON_SIGNUP enabled. Activating user account for local testing:', err)
      user.verified = true
      user.verifiedAt = new Date()
      await user.save()
      res.sendStatus(200)
      return
    }

    try {
      //
      // Delete user in case of smtp failure
      //
      await Token.deleteMany({ user: user._id.toString() })
      await user.deleteOne()
    } catch (deleteErr) {
      logger.error(`[user.signup] ${i18n.t('ERROR')}`, deleteErr)
    }
    logger.error(`[user.signup] ${i18n.t('SMTP_ERROR')}`, err)
    res.sendStatus(200)
  }
}

/**
 * Frontend Sign Up.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 */
export const signup = async (req: Request, res: Response) => {
  await _signup(req, res, bookcarsTypes.UserType.User)
}

/**
 * Admin Sign Up.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 */
export const adminSignup = async (req: Request, res: Response) => {
  await _signup(req, res, bookcarsTypes.UserType.Admin)
}

/**
 * Create a User.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const create = async (req: Request, res: Response) => {
  const { body }: { body: bookcarsTypes.CreateUserPayload } = req

  try {
    // begin of security check
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User) {
      logger.error(`[user.create] Unauthorized attempt to create user by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot create user')
      return
    }
    if (
      sessionUser.type !== bookcarsTypes.UserType.Admin
      && sessionUser.type !== bookcarsTypes.UserType.Supplier
      && sessionUser.type !== bookcarsTypes.UserType.Staff
    ) {
      logger.error(`[user.create] Unsupported caller role ${sessionUser.type}`)
      res.status(403).send('Forbidden: You cannot create user')
      return
    }

    const targetType = body.type ?? bookcarsTypes.UserType.User
    if (!Object.values(bookcarsTypes.UserType).includes(targetType as bookcarsTypes.UserType)) {
      res.status(400).send('Invalid user type')
      return
    }
    if (targetType === bookcarsTypes.UserType.Staff) {
      logger.error(`[user.create] Staff creation attempted through the generic user endpoint by ${sessionUserId}`)
      res.status(403).send('Staff accounts must be created through agency membership management')
      return
    }
    if ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)) {
      if (targetType !== bookcarsTypes.UserType.User) {
        logger.error(`[user.create] Supplier ${sessionUserId} attempted to create user type ${targetType}`)
        res.status(403).send('Forbidden: Suppliers can only create users')
        return
      }
      const agencyId = agencySupplierId(req)
      if (body.supplier && (!helper.isValidObjectId(body.supplier) || body.supplier !== agencyId)) {
        logger.error(`[user.create] Supplier ${sessionUserId} attempted to assign a user to another supplier`)
        res.status(403).send('Forbidden: You cannot assign users to another supplier')
        return
      }
      body.supplier = agencySupplierId(req)
    }
    body.type = targetType
    // end of security check

    // GA-PAR-01: fiscal identity + VAT fields belong to supplier records
    // only. On supplier creation they are validated (trimmed, length-capped,
    // vatRate 0-100) and normalised; on any other target type they are
    // stripped so they can never land on a customer record.
    if (targetType === bookcarsTypes.UserType.Supplier) {
      const fiscal = normalizeFiscalFields(body as unknown as Record<string, unknown>)
      if (!fiscal.ok) {
        res.status(400).send(fiscal.error)
        return
      }
      const fiscalTarget: Record<string, any> = {}
      applyFiscalFields(fiscalTarget, fiscal)
      for (const key of fiscal.present) {
        ;(body as unknown as Record<string, unknown>)[key] = fiscalTarget[key]
      }
      if (fiscal.present.has('vatEnabled') || fiscal.present.has('vatRate')) {
        body.vatEnabled = !!fiscalTarget.vatEnabled
        body.vatRate = fiscalTarget.vatRate
      }
    } else {
      for (const key of [...FISCAL_STRING_KEYS, 'vatEnabled', 'vatRate']) {
        delete (body as unknown as Record<string, unknown>)[key]
      }
    }

    // GA-PAR-04: client identity pack belongs to customer records
    // (type=User) only. For customers the fields are validated (malformed
    // expiry date -> 400 naming the field) and normalised; for every other
    // target type they are stripped, so staff/supplier creation cannot
    // regress or silently gain identity validation.
    if (targetType === bookcarsTypes.UserType.User) {
      const identity = normalizeClientIdentityFields(body as unknown as Record<string, unknown>)
      if (!identity.ok) {
        res.status(400).send(identity.error)
        return
      }
      const identityTarget: Record<string, any> = {}
      applyClientIdentityFields(identityTarget, identity)
      for (const key of identity.present) {
        ;(body as unknown as Record<string, unknown>)[key] = identityTarget[key]
      }
    } else {
      for (const key of CLIENT_IDENTITY_KEYS) {
        delete (body as unknown as Record<string, unknown>)[key]
      }
    }

    body.verified = false
    body.blacklisted = false
    ;(body as { signupOrigin?: string }).signupOrigin = 'admin'

    if (body.password) {
      const { password } = body
      const passwordHash = await authHelper.hashPassword(password)
      body.password = passwordHash
    }

    const { contracts } = body
    body.contracts = undefined

    const user = new User(body)
    await user.save()

    // contracts
    const finalContracts: bookcarsTypes.Contract[] = []
    if (contracts) {
      for (const contract of contracts) {
        if (!contract.language || !contract.file) {
          continue
        }

        // -----------------------------
        // 1. Validate language (ISO 639-1)
        // -----------------------------
        const language = contract.language.toLowerCase().trim()

        // Exactly 2 letters, a–z only
        if (!helper.validateLanguage(language)) {
          logger.warn(`[contract] Invalid ISO 639-1 language: ${contract.language}`)
          continue
        }

        // -----------------------------
        // 2. Sanitize filename (prevent traversal)
        // -----------------------------
        const safeFile = path.basename(contract.file)

        // If basename changed it, it's a traversal attempt
        if (safeFile !== contract.file) {
          logger.warn(`[contract] Directory traversal attempt (file): ${contract.file}`)
          continue
        }

        // security check: restrict allowed extensions
        const ext = path.extname(safeFile)
        if (!env.allowedContractExtensions.includes(ext.toLowerCase())) {
          res.status(400).send('Invalid contract file type')
          return
        }

        const tempDir = path.resolve(env.CDN_TEMP_CONTRACTS)
        const contractsDir = path.resolve(env.CDN_CONTRACTS)

        const tempFile = path.resolve(tempDir, safeFile)

        // Ensure source stays inside temp directory
        if (!tempFile.startsWith(tempDir + path.sep)) {
          logger.warn(`[contract] Source path escape attempt: ${tempFile}`)
          continue
        }

        if (await helper.pathExists(tempFile)) {
          const ext = path.extname(safeFile)

          const filename = `${user._id.toString()}_${language}${ext}`
          const newPath = path.resolve(contractsDir, filename)

          // Ensure destination stays inside contracts directory
          if (!newPath.startsWith(contractsDir + path.sep)) {
            logger.warn(`[contract] Destination path escape attempt: ${newPath}`)
            continue
          }

          await asyncFs.rename(tempFile, newPath)

          finalContracts.push({
            language,
            file: filename
          })
        }
      }

      user.contracts = finalContracts
      await user.save()
    }

    // avatar
    if (body.avatar) {
      // -----------------------------
      // 1️. Sanitize filename
      // -----------------------------
      const safeAvatar = path.basename(body.avatar)

      // If basename changed it, it's a traversal attempt
      if (safeAvatar !== body.avatar) {
        logger.warn(`[user.create] Directory traversal attempt (avatar): ${body.avatar}`)
        res.status(400).send('Invalid avatar filename')
        return
      }

      const tempDir = path.resolve(env.CDN_TEMP_USERS)
      const usersDir = path.resolve(env.CDN_USERS)

      const avatarPath = path.resolve(tempDir, safeAvatar)

      // -----------------------------
      // 2️. Ensure source is inside temp directory
      // -----------------------------
      if (!avatarPath.startsWith(tempDir + path.sep)) {
        logger.warn(`[user.create] Avatar source path escape attempt: ${avatarPath}`)
        res.status(400).send('Invalid avatar path')
        return
      }

      if (await helper.pathExists(avatarPath)) {
        const ext = path.extname(safeAvatar)

        // security check: restrict allowed extensions
        if (!env.allowedImageExtensions.includes(ext.toLowerCase())) {
          res.status(400).send('Invalid avatar file type')
          return
        }

        const filename = `${user._id}_${Date.now()}${ext}`
        const newPath = path.resolve(usersDir, filename)

        // -----------------------------
        // 3. Ensure destination is inside users directory
        // -----------------------------
        if (!newPath.startsWith(usersDir + path.sep)) {
          logger.warn(`[user.create] Avatar destination path escape attempt: ${newPath}`)
          res.status(400).send('Invalid avatar destination')
          return
        }

        await asyncFs.rename(avatarPath, newPath)

        user.avatar = filename
        await user.save()
      }
    }

    // license
    if (body.license && user.type === bookcarsTypes.UserType.User) {
      // -----------------------------
      // 1. Sanitize filename
      // -----------------------------
      const safeLicense = path.basename(body.license)

      // If basename changed it, it's a traversal attempt
      if (safeLicense !== body.license) {
        logger.warn(`[user.create] Directory traversal attempt (license): ${body.license}`)
        res.status(400).send('Invalid license filename')
        return
      }

      const tempDir = path.resolve(env.CDN_TEMP_LICENSES)
      const licensesDir = path.resolve(env.CDN_LICENSES)

      if (!isValidLicenseCapabilityFilename(safeLicense)) {
        res.status(400).send('Invalid or expired license capability')
        return
      }

      const licensePath = path.resolve(tempDir, safeLicense)

      // -----------------------------
      // 2. Ensure source stays inside temp directory
      // -----------------------------
      if (!licensePath.startsWith(tempDir + path.sep)) {
        logger.warn(`[user.create] License source path escape attempt: ${licensePath}`)
        res.status(400).send('Invalid license path')
        return
      }

      if (await helper.pathExists(licensePath)) {
        // security check: restrict allowed extensions
        const ext = path.extname(safeLicense)
        if (!env.allowedLicenseExtensions.includes(ext.toLowerCase())) {
          res.status(400).send('Invalid license file type')
          return
        }

        const filename = `${user._id}${ext}`
        const newPath = path.resolve(licensesDir, filename)

        // -----------------------------
        // 3. Ensure destination stays inside licenses directory
        // -----------------------------
        if (!newPath.startsWith(licensesDir + path.sep)) {
          logger.warn(`[user.create] License destination path escape attempt: ${newPath}`)
          res.status(400).send('Invalid license destination')
          return
        }

        await asyncFs.rename(licensePath, newPath)

        user.license = filename
        await user.save()
      }
    }

    if (body.password) {
      res.sendStatus(200)
      return
    }

    // generate token and save
    const token = new Token({ user: user._id, token: helper.generateToken() })
    await token.save()

    // Send email
    i18n.locale = user.language

    const mailOptions: SendMailOptions = {
      from: env.SMTP_FROM,
      to: user.email,
      subject: i18n.t('ACCOUNT_ACTIVATION_SUBJECT'),
      html:
        `<p>
        ${i18n.t('HELLO')}${user.fullName},<br><br>
        ${i18n.t('ACCOUNT_ACTIVATION_LINK')}<br><br>
        ${helper.joinURL(
          user.type === bookcarsTypes.UserType.User ? env.FRONTEND_HOST : env.ADMIN_HOST,
          'activate',
        )}/?u=${encodeURIComponent(user._id.toString())}&e=${encodeURIComponent(user.email)}&t=${encodeURIComponent(token.token)}<br><br>
        ${i18n.t('REGARDS')}<br>
        </p>`,
    }

    await mailHelper.sendMail(mailOptions)
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[user.create] ${i18n.t('ERROR')} ${JSON.stringify(body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Check a Validation Token.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const checkToken = async (req: Request, res: Response) => {
  const { userId, email } = req.params

  try {
    const user = await User.findOne({
      _id: new mongoose.Types.ObjectId(userId),
      email,
    })

    if (user) {
      const type = req.params.type.toLowerCase() as bookcarsTypes.AppType

      if (
        ![bookcarsTypes.AppType.Frontend, bookcarsTypes.AppType.Admin].includes(type)
        || (type === bookcarsTypes.AppType.Admin && user.type === bookcarsTypes.UserType.User)
        || (type === bookcarsTypes.AppType.Frontend && user.type !== bookcarsTypes.UserType.User)
        || user.active
      ) {
        res.sendStatus(204)
        return
      }

      const token = await Token.findOne({
        user: new mongoose.Types.ObjectId(userId),
        token: req.params.token,
      })

      if (token) {
        res.sendStatus(200)
        return
      }

      res.sendStatus(204)
      return
    }

    res.sendStatus(204)
  } catch (err) {
    logger.error(`[user.checkToken] ${i18n.t('ERROR')} ${JSON.stringify(req.params)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Delete Validation Tokens.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const deleteTokens = async (req: Request, res: Response) => {
  const { userId } = req.params
  const bodyToken: string | undefined = typeof req.body?.token === 'string' ? req.body.token : undefined

  try {
    if (!helper.isValidObjectId(userId)) {
      throw new Error('User id not valid')
    }

    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null

    // Self-service activation/reset page: prove token ownership via check-token parameters.
    // Do not allow arbitrary callers to enumerate or destroy another account's reset tokens.
    const tokenUser = await User.findById(userId).select('_id type active verified')
    if (!tokenUser || (!sessionUser || sessionUser._id.toString() !== userId)) {
      const token = await Token.findOne({ user: userId })
      if (!token || !bodyToken || token.token !== bodyToken) {
        res.status(403).send('Forbidden: You cannot delete these tokens')
        return
      }
    }

    const result = await Token.deleteMany({
      user: new mongoose.Types.ObjectId(userId),
    })

    if (result.deletedCount > 0) {
      res.sendStatus(200)
      return
    }

    res.sendStatus(400)
  } catch (err) {
    logger.error(`[user.deleteTokens] ${i18n.t('ERROR')} ${userId}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Resend Validation email.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const resend = async (req: Request, res: Response) => {
  const { email } = req.params

  if (!helper.isValidEmail(email)) {
    res.status(400).send(i18n.t('ERROR'))
    return
  }

  try {
    const user = await User.findOne({ email })

    if (user) {
      const type = req.params.type.toLowerCase() as bookcarsTypes.AppType

      if (
        [bookcarsTypes.AppType.Frontend, bookcarsTypes.AppType.Admin].includes(type)
        && !(type === bookcarsTypes.AppType.Admin && user.type === bookcarsTypes.UserType.User)
        && !(type === bookcarsTypes.AppType.Frontend && user.type !== bookcarsTypes.UserType.User)
      ) {
        user.active = false
        await user.save()

        const token = new Token({ user: user._id, token: helper.generateToken() })
        await token.save()

        i18n.locale = user.language

        const reset = req.params.reset === 'true'
        const activationOrResetLink = `${helper.joinURL(
          user.type === bookcarsTypes.UserType.User ? env.FRONTEND_HOST : env.ADMIN_HOST,
          reset ? 'reset-password' : 'activate',
        )}/?u=${encodeURIComponent(user._id.toString())}&e=${encodeURIComponent(user.email)}&t=${encodeURIComponent(token.token)}`

        const mailOptions: SendMailOptions = {
          from: env.SMTP_FROM,
          to: user.email,
          subject: reset ? i18n.t('PASSWORD_RESET_SUBJECT') : i18n.t('ACCOUNT_ACTIVATION_SUBJECT'),
          html:
            `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
              <p style="font-size: 16px; color: #555;">
                ${i18n.t('HELLO')} ${user.fullName},<br><br>
                ${reset ? i18n.t('PASSWORD_RESET_LINK') : i18n.t('ACCOUNT_ACTIVATION_LINK')}<br><br>
                <a href="${activationOrResetLink}" target="_blank">${activationOrResetLink}</a><br><br>
                ${i18n.t('REGARDS')}<br>
              </p>
            </div>`,
        }
        await mailHelper.sendMail(mailOptions)
      }
    }
  } catch (err) {
    logger.error('[user.resend] Failed to process account email request', err)
  }

  res.sendStatus(200)
}

/**
 * Activate a User and set his Password.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const activate = async (req: Request, res: Response) => {
  const { body }: { body: bookcarsTypes.ActivatePayload } = req
  const { userId } = body

  try {
    if (!helper.isValidObjectId(userId)) {
      throw new Error('body.userId is not valid')
    }

    const user = await User.findById(userId)

    if (user) {
      const token = await Token.findOne({ user: userId, token: body.token })

      if (token) {
        const { password } = body
        const passwordHash = await authHelper.hashPassword(password)
        user.password = passwordHash
        // H-007: setting a password (activation / email reset) revokes any
        // session issued before it.
        user.tokenVersion = (user.tokenVersion ?? 0) + 1

        user.active = true
        user.verified = true
        user.expireAt = undefined
        await user.save()

        res.sendStatus(200)
        return
      }
    }

    res.sendStatus(204)
  } catch (err) {
    logger.error(`[user.activate] ${i18n.t('ERROR')} ${userId}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Sign In.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const signin = async (req: Request, res: Response) => {
  const { body }: { body: bookcarsTypes.SignInPayload } = req
  const { email: emailFromBody, password, stayConnected, mobile } = body

  try {
    if (!emailFromBody) {
      throw new Error('body.email not found')
    }

    const email = helper.trim(emailFromBody, ' ')

    if (!helper.isValidEmail(email)) {
      throw new Error('body.email is not valid')
    }

    const user = await User.findOne({ email })
    const type = req.params.type.toLowerCase() as bookcarsTypes.AppType

    if (
      !password
      || !user
      || !user.password
      || ![bookcarsTypes.AppType.Frontend, bookcarsTypes.AppType.Admin].includes(type)
      || (type === bookcarsTypes.AppType.Admin && user.type === bookcarsTypes.UserType.User)
      || (type === bookcarsTypes.AppType.Frontend && user.type !== bookcarsTypes.UserType.User)
    ) {
      res.sendStatus(204)
      return
    }
    const passwordMatch = await bcrypt.compare(password, user.password)

    // Owner decision F-SEC-7 (GA-P10-DECISIONS-01): self-signup accounts
    // must verify their email before signing in; admin-created accounts
    // (and legacy rows without the 'self' marker) stay exempt, keeping
    // the admin-onboarding flow intact. The denial is the same 204 as
    // every other sign-in failure, so nothing about the account leaks.
    if (passwordMatch && user.verified === false && (user as { signupOrigin?: string }).signupOrigin === 'self') {
      res.sendStatus(204)
      return
    }

    if (passwordMatch) {
      //
      // On production, authentication cookies are httpOnly, signed, secure and strict sameSite.
      // These options prevent XSS, CSRF and MITM attacks.
      // Authentication cookies are protected against XST attacks as well via allowedMethods middleware.
      //
      const cookieOptions: CookieOptions = helper.clone(env.COOKIE_OPTIONS)

      if (stayConnected) {
        //
        // Cookies can no longer set an expiration date more than 400 days in the future.
        // The limit MUST NOT be greater than 400 days in duration.
        // The RECOMMENDED limit is 400 days in duration, but the user agent MAY adjust the
        // limit to be less.
        //
        cookieOptions.maxAge = 400 * 24 * 60 * 60 * 1000
      } else {
        //
        // Cookie maxAge option is set in milliseconds.
        //
        cookieOptions.maxAge = env.JWT_EXPIRE_AT * 1000
      }

      const payload: authHelper.SessionData = { id: user._id.toString(), sid: nanoid(), tv: user.tokenVersion ?? 0 }
      const token = await authHelper.encryptJWT(payload, stayConnected)

      const loggedUser: bookcarsTypes.User = {
        _id: user._id.toString(),
        email: user.email,
        fullName: user.fullName,
        language: user.language,
        enableEmailNotifications: user.enableEmailNotifications,
        emailNotificationCategories: user.emailNotificationCategories,
        blacklisted: user.blacklisted,
        avatar: user.avatar,
        type: user.type,
        supplier: user.supplier?.toString(),
      }

      //
      // On mobile, we return the token in the response body.
      //
      if (mobile) {
        loggedUser.accessToken = token

        res
          .status(200)
          .send(loggedUser)
        return
      }

      //
      // On web, we return the token in a httpOnly, signed, secure and strict sameSite cookie.
      //
      const cookieName = authHelper.getAuthCookieName(req)

      res
        .clearCookie(cookieName)
        .cookie(cookieName, token, cookieOptions)
        .status(200)
        .send(loggedUser)
      return
    }

    res.sendStatus(204)
  } catch (err) {
    logger.error(`[user.signin] ${i18n.t('ERROR')} ${emailFromBody}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Sign In.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const socialSignin = async (req: Request, res: Response) => {
  const { body }: { body: bookcarsTypes.SignInPayload } = req
  const { socialSignInType, accessToken, email: emailFromBody, fullName, avatar, stayConnected, mobile } = body

  try {
    if (!socialSignInType) {
      throw new Error('body.socialSignInType not found')
    }

    if (!emailFromBody) {
      throw new Error('body.email not found')
    }

    const email = helper.trim(emailFromBody, ' ')

    if (!helper.isValidEmail(email)) {
      throw new Error('body.email is not valid')
    }

    if (!accessToken) {
      throw new Error('body.accessToken not found')
    }

    if (!(await authHelper.validateAccessToken(socialSignInType, accessToken, email))) {
      throw new Error('body.accessToken is not valid')
    }

    let user = await User.findOne({ email })

    if (user && user.type !== bookcarsTypes.UserType.User) {
      res.sendStatus(204)
      return
    }

    if (!user) {
      user = new User({
        email,
        fullName,
        active: true,
        verified: true,
        language: 'en',
        enableEmailNotifications: true,
        type: bookcarsTypes.UserType.User,
        blacklisted: false,
        avatar,
        isSocial: true,
      })
      await user.save()
    }

    //
    // On production, authentication cookies are httpOnly, signed, secure and strict sameSite.
    // These options prevent XSS, CSRF and MITM attacks.
    // Authentication cookies are protected against XST attacks as well via allowedMethods middleware.
    //
    const cookieOptions: CookieOptions = helper.clone(env.COOKIE_OPTIONS)

    if (stayConnected) {
      //
      // Cookies can no longer set an expiration date more than 400 days in the future.
      // The limit MUST NOT be greater than 400 days in duration.
      // The RECOMMENDED limit is 400 days in duration, but the user agent MAY adjust the
      // limit to be less.
      //
      cookieOptions.maxAge = 400 * 24 * 60 * 60 * 1000
    } else {
      //
      // Cookie maxAge option is set in milliseconds.
      //
      cookieOptions.maxAge = env.JWT_EXPIRE_AT * 1000
    }

    const payload: authHelper.SessionData = { id: user._id.toString(), sid: nanoid(), tv: user.tokenVersion ?? 0 }
    const token = await authHelper.encryptJWT(payload, stayConnected)

    const loggedUser: bookcarsTypes.User = {
      _id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      language: user.language,
      enableEmailNotifications: user.enableEmailNotifications,
      blacklisted: user.blacklisted,
      avatar: user.avatar,
      type: user.type,
      supplier: user.supplier?.toString(),
    }

    //
    // On mobile, we return the token in the response body.
    //
    if (mobile) {
      loggedUser.accessToken = token

      res
        .status(200)
        .send(loggedUser)
      return
    }

    //
    // On web, we return the token in a httpOnly, signed, secure and strict sameSite cookie.
    //
    const cookieName = authHelper.getAuthCookieName(req)

    res
      .clearCookie(cookieName)
      .cookie(cookieName, token, cookieOptions)
      .status(200)
      .send(loggedUser)
  } catch (err) {
    logger.error(`[user.socialSignin] ${i18n.t('ERROR')} ${emailFromBody}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Sign out.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const signout = async (req: Request, res: Response) => {
  const cookieName = authHelper.getAuthCookieName(req)

  // H-007: revoke the presented session server-side — the current session
  // only; the user's other sessions stay valid. The token is resolved
  // exactly as in authJwt.verifyToken (signed admin/frontend cookie, or the
  // x-access-token header). An absent or invalid token keeps sign-out a
  // cookie-clearing no-op, as before.
  try {
    let sessionToken: string | undefined
    if (authHelper.isAdmin(req)) {
      sessionToken = req.signedCookies[env.ADMIN_AUTH_COOKIE_NAME]
    } else if (authHelper.isFrontend(req)) {
      sessionToken = req.signedCookies[env.FRONTEND_AUTH_COOKIE_NAME]
    } else {
      sessionToken = req.headers[env.X_ACCESS_TOKEN] as string | undefined
    }

    if (sessionToken) {
      const sessionData = await authHelper.decryptJWT(sessionToken)
      if (sessionData?.sid && helper.isValidObjectId(sessionData.id)) {
        const expireAt = sessionData.exp
          ? new Date(sessionData.exp * 1000)
          : new Date(Date.now() + 400 * 24 * 60 * 60 * 1000) // stay-connected tokens carry no exp; the cookie cap is 400 days
        await RevokedSession.updateOne(
          { sid: sessionData.sid },
          { $setOnInsert: { sid: sessionData.sid, user: sessionData.id, expireAt } },
          { upsert: true },
        )
      }
    }
  } catch (err) {
    logger.info('[user.signout] Session revocation skipped', err)
  }

  res
    .clearCookie(cookieName)
    .sendStatus(200)
}

/**
 * Get Push Notification Token.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getPushToken = async (req: Request, res: Response) => {
  const { userId } = req.params

  try {
    if (!helper.isValidObjectId(userId)) {
      throw new Error('userId is not valid')
    }

    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    if (!sessionUser || (sessionUser.type !== bookcarsTypes.UserType.Admin && sessionUser._id.toString() !== userId)) {
      res.status(403).send('Forbidden: You cannot read this push token')
      return
    }

    const pushToken = await PushToken.findOne({ user: userId })
    if (pushToken) {
      res.json(pushToken.token)
      return
    }

    res.sendStatus(204)
  } catch (err) {
    logger.error(`[user.pushToken] ${i18n.t('ERROR')} ${userId}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Create Push Notification Token.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const createPushToken = async (req: Request, res: Response) => {
  const { userId, token } = req.params

  try {
    if (!helper.isValidObjectId(userId)) {
      throw new Error('userId is not valid')
    }

    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    if (!sessionUser || (sessionUser.type !== bookcarsTypes.UserType.Admin && sessionUser._id.toString() !== userId)) {
      res.status(403).send('Forbidden: You cannot create this push token')
      return
    }

    const exist = await PushToken.exists({ user: userId })

    if (!exist) {
      const pushToken = new PushToken({
        user: userId,
        token,
      })
      await pushToken.save()
      res.sendStatus(200)
      return
    }

    res.status(400).send('Push Token already exists.')
  } catch (err) {
    logger.error(`[user.createPushToken] ${i18n.t('ERROR')} ${userId}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Delete Push Notification Token.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const deletePushToken = async (req: Request, res: Response) => {
  const { userId } = req.params

  try {
    if (!helper.isValidObjectId(userId)) {
      throw new Error('userId is not valid')
    }

    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    if (!sessionUser || (sessionUser.type !== bookcarsTypes.UserType.Admin && sessionUser._id.toString() !== userId)) {
      res.status(403).send('Forbidden: You cannot delete this push token')
      return
    }

    await PushToken.deleteMany({ user: userId })
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[user.deletePushToken] ${i18n.t('ERROR')} ${userId}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Validate email.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const validateEmail = async (req: Request, res: Response) => {
  const { email }: bookcarsTypes.ValidateEmailPayload = req.body

  try {
    if (!helper.isValidEmail(email)) {
      res.status(400).send(i18n.t('ERROR'))
      return
    }

    res.sendStatus(200)
  } catch (err) {
    logger.error('[user.validateEmail] Failed to validate email syntax', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Validate JWT token.
 *
 * @param {Request} req
 * @param {Response} res
 * @returns {*}
 */
export const validateAccessToken = async (req: Request, res: Response) => {
  res.sendStatus(200)
}

/**
 * Get Validation result as HTML.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const confirmEmail = async (req: Request, res: Response) => {
  try {
    const { token: _token, email: _email } = req.params

    if (!helper.isValidEmail(_email)) {
      throw new Error('email is not valid')
    }

    const user = await User.findOne({ email: _email })

    if (!user) {
      logger.error('[user.confirmEmail] User not found', req.params)
      res.status(204).send(i18n.t('ACCOUNT_ACTIVATION_LINK_ERROR'))
      return
    }

    i18n.locale = user.language
    const token = await Token.findOne({ user: user._id, token: _token })

    // token is not found into database i.e. token may have expired
    if (!token) {
      logger.error(i18n.t('ACCOUNT_ACTIVATION_LINK_EXPIRED'), req.params)
      res.status(400).send(getStatusMessage(user.language, i18n.t('ACCOUNT_ACTIVATION_LINK_EXPIRED')))
      return
    }

    // if token is found then check valid user
    // not valid user
    if (user.verified) {
      // user is already verified
      res.status(200).send(getStatusMessage(user.language, i18n.t('ACCOUNT_ACTIVATION_ACCOUNT_VERIFIED')))
      return
    }

    // verify user
    // change verified to true
    user.verified = true
    user.verifiedAt = new Date()
    await user.save()
    res.status(200).send(getStatusMessage(user.language, i18n.t('ACCOUNT_ACTIVATION_SUCCESS')))
  } catch (err) {
    logger.error(`[user.confirmEmail] ${i18n.t('ERROR')} ${JSON.stringify(req.params)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Resend Validation email.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const resendLink = async (req: Request, res: Response) => {
  const { body }: { body: bookcarsTypes.ResendLinkPayload } = req
  const { email } = body

  try {
    if (!email || !helper.isValidEmail(email)) {
      throw new Error('email is not valid')
    }

    const user = await User.findOne({ email })

    // user is not found into database
    if (!user) {
      logger.error('[user.resendLink] User not found:', email)
      res.status(400).send(getStatusMessage(env.DEFAULT_LANGUAGE, i18n.t('ACCOUNT_ACTIVATION_RESEND_ERROR')))
      return
    }

    if (user.verified) {
      // user has been already verified
      res.status(200).send(getStatusMessage(user.language, i18n.t('ACCOUNT_ACTIVATION_ACCOUNT_VERIFIED')))
    }

    // H-006: fail safe when no configured API base URL exists — no token is
    // created and no link is built from the untrusted request Host header.
    if (!env.API_HOST) {
      throw new Error('BC_API_HOST is not configured')
    }

    // send verification link
    // generate token and save
    const token = new Token({ user: user._id, token: helper.generateToken() })
    await token.save()

    // Send email
    i18n.locale = user.language

    const activateLink = `${helper.joinURL(env.API_HOST, 'api/confirm-email')}/${user.email}/${token.token}`

    const mailOptions: SendMailOptions = {
      from: env.SMTP_FROM,
      to: user.email,
      subject: i18n.t('ACCOUNT_ACTIVATION_SUBJECT'),
      html:
        `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
          <p style="font-size: 16px; color: #555;">
            ${i18n.t('HELLO')} ${user.fullName},<br><br>
            ${i18n.t('ACCOUNT_ACTIVATION_LINK')}<br><br>
            <a href="${activateLink}" target="_blank">${activateLink}</a><br><br>
            ${i18n.t('REGARDS')}<br>
          </p>
        </div>`,
    }

    await mailHelper.sendMail(mailOptions)
    res
      .status(200)
      .send(getStatusMessage(user.language, i18n.t('ACCOUNT_ACTIVATION_EMAIL_SENT_PART_1') + user.email + i18n.t('ACCOUNT_ACTIVATION_EMAIL_SENT_PART_2')))
  } catch (err) {
    logger.error(`[user.resendLink] ${i18n.t('ERROR')} ${email}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Update User.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const update = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.UpdateUserPayload } = req
    const { _id } = body

    if (!helper.isValidObjectId(_id)) {
      throw new Error('User id is not valid')
    }

    const user = await User.findById(_id)

    if (!user) {
      logger.error('[user.update] User not found:', body.email)
      res.sendStatus(204)
      return
    }

    // begin of security check
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    const isSelf = !!sessionUser && sessionUser._id.equals(user._id)
    const agencyId = agencySupplierId(req)
    const isAuthorizedSupplierUser = !!sessionUser
      && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
      && user.type === bookcarsTypes.UserType.User
      && !!agencyId
      && user.supplier?.toString() === agencyId
      && (sessionUser.type !== bookcarsTypes.UserType.Staff
        || hasAgencyPermission(req.agency, AgencyPermission.ManageClients))
    if (!sessionUser
      || (sessionUser.type === bookcarsTypes.UserType.User && !isSelf)
      || ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
        && !isSelf
        && !isAuthorizedSupplierUser)
      || (
        sessionUser.type !== bookcarsTypes.UserType.Admin
        && sessionUser.type !== bookcarsTypes.UserType.Supplier
        && sessionUser.type !== bookcarsTypes.UserType.Staff
        && sessionUser.type !== bookcarsTypes.UserType.User
      )
    ) {
      logger.error(`[user.update] Unauthorized attempt to update user ${_id} by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot update user information')
      return
    }
    // end of security check

    const {
      fullName,
      phone,
      bio,
      location,
      type,
      birthDate,
      enableEmailNotifications,
      payLater,
      licenseRequired,
      minimumRentalDays,
      priceChangeRate,
      supplierCarLimit,
      notifyAdminOnNewCar,
      blacklisted,
    } = body

    if (fullName) {
      user.fullName = fullName
    }
    user.phone = phone
    user.location = location
    user.bio = bio
    user.birthDate = birthDate ? new Date(birthDate) : undefined
    if (typeof enableEmailNotifications !== 'undefined') {
      user.enableEmailNotifications = enableEmailNotifications
    }
    // H-008 (hardening Wave 2): the supplier-commercial fields below only
    // have meaning on a supplier's own record - checkout and pricing read
    // them from the supplier, never from a customer (verified Wave 1).
    // They are applied only when the target account is a supplier and the
    // actor is the platform admin or that supplier themself; on any other
    // target they are ignored, so they can no longer be written onto (or
    // wiped from) customer records through this endpoint.
    const canEditSupplierCommercial = user.type === bookcarsTypes.UserType.Supplier
      && (sessionUser.type === bookcarsTypes.UserType.Admin || isSelf)
    if (canEditSupplierCommercial) {
      // GA-PAR-01: fiscal identity + VAT, same guard as the other
      // supplier-commercial fields (supplier target, admin or self only).
      const fiscal = normalizeFiscalFields(body as unknown as Record<string, unknown>)
      if (!fiscal.ok) {
        res.status(400).send(fiscal.error)
        return
      }
      applyFiscalFields(user as unknown as Record<string, any>, fiscal)
      user.minimumRentalDays = minimumRentalDays
      user.priceChangeRate = priceChangeRate
      user.supplierCarLimit = supplierCarLimit
      user.notifyAdminOnNewCar = notifyAdminOnNewCar
      if (typeof payLater !== 'undefined') {
        user.payLater = payLater
      }
      if (typeof licenseRequired !== 'undefined') {
        user.licenseRequired = licenseRequired
      }
    }
    if (sessionUser.type === bookcarsTypes.UserType.Admin || isAuthorizedSupplierUser) {
      if (typeof blacklisted !== 'undefined') {
        user.blacklisted = blacklisted
      }
    }
    // GA-PAR-04: client identity pack — customer records only, edited by
    // the platform admin or an agency caller already authorised for this
    // client (ManageClients was enforced for staff above). Partial-PUT
    // preservation (H-026): only keys present in the payload are applied.
    // `clientStatus` never touches `blacklisted` / `active` (decision N5).
    if (user.type === bookcarsTypes.UserType.User
      && (sessionUser.type === bookcarsTypes.UserType.Admin || isAuthorizedSupplierUser)) {
      const identity = normalizeClientIdentityFields(body as unknown as Record<string, unknown>)
      if (!identity.ok) {
        res.status(400).send(identity.error)
        return
      }
      applyClientIdentityFields(user as unknown as Record<string, any>, identity)
    }
    // only admins can update user type
    if (sessionUser.type === bookcarsTypes.UserType.Admin) {
      if (type === bookcarsTypes.UserType.Staff) {
        res.status(403).send('Staff accounts must be managed through agency membership management')
        return
      }
      if (type) {
        user.type = type as bookcarsTypes.UserType
      }
    }
    await user.save()
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[user.update] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Update email notifications setting.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const updateEmailNotifications = async (req: Request, res: Response) => {
  const { body }: { body: bookcarsTypes.UpdateEmailNotificationsPayload } = req

  try {
    const { _id } = body

    if (!helper.isValidObjectId(_id)) {
      throw new Error('User id is not valid')
    }

    const user = await User.findById(_id)

    if (!user) {
      logger.error('[user.updateEmailNotifications] User not found:', body)
      res.sendStatus(204)
      return
    }

    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    const agencyId = agencySupplierId(req)
    const canUpdate = !!sessionUser && (
      sessionUser.type === bookcarsTypes.UserType.Admin
      || sessionUser._id.equals(user._id)
      || ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
        && user.type === bookcarsTypes.UserType.User
        && !!agencyId
        && user.supplier?.toString() === agencyId
        && (sessionUser.type !== bookcarsTypes.UserType.Staff
          || hasAgencyPermission(req.agency, AgencyPermission.ManageClients)))
    )
    if (!canUpdate) {
      res.status(403).send('Forbidden: You cannot update this user notification setting')
      return
    }

    // GA-PAR-13 (#43): partial-PUT preservation (H-026 pattern) — an
    // omitted field keeps its stored value. The master boolean's
    // behaviour for callers that send it is exactly as before; the
    // per-category object merges key-by-key over the stored values
    // (defaults all true), accepting boolean values only.
    const { enableEmailNotifications, emailNotificationCategories } = body
    if (typeof enableEmailNotifications !== 'undefined') {
      user.enableEmailNotifications = enableEmailNotifications
    }
    if (typeof emailNotificationCategories !== 'undefined') {
      if (typeof emailNotificationCategories !== 'object' || emailNotificationCategories === null) {
        res.status(400).send('Invalid email notification categories')
        return
      }
      const keys: (keyof bookcarsTypes.EmailNotificationCategories)[] = [
        'returnsDue', 'carDueDates', 'signedContracts', 'weeklyRecap', 'tips', 'news',
      ]
      const merged: bookcarsTypes.EmailNotificationCategories = { ...(user.emailNotificationCategories || {}) }
      for (const key of keys) {
        const val = (emailNotificationCategories as Record<string, unknown>)[key]
        if (typeof val !== 'undefined') {
          if (typeof val !== 'boolean') {
            res.status(400).send('Invalid email notification categories')
            return
          }
          merged[key] = val
        }
      }
      user.emailNotificationCategories = merged
    }
    await user.save()

    res.sendStatus(200)
  } catch (err) {
    logger.error(`[user.updateEmailNotifications] ${i18n.t('ERROR')} ${JSON.stringify(body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Update language.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const updateLanguage = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.UpdateLanguagePayload } = req
    const { id, language } = body

    if (!helper.isValidObjectId(id)) {
      throw new Error('User id is not valid')
    }

    const user = await User.findById(id)
    if (!user) {
      logger.error('[user.updateLanguage] User not found:', id)
      res.sendStatus(204)
      return
    }

    // begin of security check
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    if (!sessionUser) {
      logger.error(`[user.updateLanguage] Invalid session user: ${sessionUserId}`)
      res.status(403).send('Forbidden: Invalid session')
      return
    }
    // users can only update their own language
    if (
      [
        bookcarsTypes.UserType.User,
        bookcarsTypes.UserType.Supplier,
        bookcarsTypes.UserType.Staff,
      ].includes(sessionUser.type as bookcarsTypes.UserType)
      && sessionUserId !== user._id.toString()
    ) {
      logger.error(`[user.updateLanguage] User ${sessionUserId} tried to update another user's language`)
      res.status(403).send('Forbidden: You cannot update another user')
      return
    }
    // end of security check

    if (!helper.validateLanguage(language)) {
      throw new Error('Invalid language code')
    }

    user.language = language
    await user.save()
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[user.updateLanguage] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Get User by ID.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getUser = async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    if (!helper.isValidObjectId(id)) {
      throw new Error('User id is not valid')
    }

    const user = await User.findById(id, {
      supplier: 1,
      email: 1,
      phone: 1,
      fullName: 1,
      verified: 1,
      language: 1,
      enableEmailNotifications: 1,
      emailNotificationCategories: 1,
      avatar: 1,
      bio: 1,
      location: 1,
      type: 1,
      blacklisted: 1,
      birthDate: 1,
      payLater: 1,
      customerId: 1,
      licenseRequired: 1,
      license: 1,
      cinNumber: 1,
      cinExpiry: 1,
      passportNumber: 1,
      passportExpiry: 1,
      licenseNumber: 1,
      licenseExpiry: 1,
      clientType: 1,
      clientStatus: 1,
      clientDocuments: 1,
      minimumRentalDays: 1,
      priceChangeRate: 1,
      supplierCarLimit: 1,
      notifyAdminOnNewCar: 1,
    }).lean()

    // begin of security check
    const sessionUserId = req.user?._id
    const sessionUserType = req.user?.type

    const isSelf = sessionUserId === id
    const isSupplierUser = sessionUserType === bookcarsTypes.UserType.Supplier
      && user?.type === bookcarsTypes.UserType.User
      && user?.supplier?.toString() === sessionUserId
    const isStaffSelf = sessionUserType === bookcarsTypes.UserType.Staff && isSelf
    const isStaffAgencyCustomer = sessionUserType === bookcarsTypes.UserType.Staff
      && user?.type === bookcarsTypes.UserType.User
      && !!user.supplier
      && agencySupplierId(req) === user.supplier.toString()
      && hasAgencyPermission(req.agency, AgencyPermission.ReadClients)

    // GA hardening Wave 5: an agency owner must be able to resolve staff who
    // hold an active membership in their agency (e.g. Approbations requester
    // names), and staff must be able to resolve their own agency owner. Both
    // stay inside the agency boundary; the projection above is unchanged.
    let isSupplierAgencyStaff = false
    if (sessionUserType === bookcarsTypes.UserType.Supplier && !isSelf && user?.type === bookcarsTypes.UserType.Staff) {
      isSupplierAgencyStaff = !!(await AgencyMembership.exists({
        supplier: sessionUserId,
        user: id,
        status: bookcarsTypes.AgencyMembershipStatus.Active,
      }))
    }
    const isStaffAgencyOwner = sessionUserType === bookcarsTypes.UserType.Staff
      && user?.type === bookcarsTypes.UserType.Supplier
      && agencySupplierId(req) === id

    if (user && isStaffAgencyCustomer && !hasAgencyPermission(req.agency, AgencyPermission.ReadPrivateDocuments)) {
      user.license = undefined
      // GA-PAR-04: identity numbers/documents get the same PII treatment
      // as the licence file for staff without ReadPrivateDocuments.
      user.cinNumber = undefined
      user.passportNumber = undefined
      user.licenseNumber = undefined
      user.clientDocuments = undefined
    }

    if (
      (sessionUserType === bookcarsTypes.UserType.User && !isSelf)
      || (sessionUserType === bookcarsTypes.UserType.Staff && !isStaffSelf && !isStaffAgencyCustomer && !isStaffAgencyOwner)
    ) {
      logger.error(`[user.getUser] Forbidden: user ${sessionUserId} tried to read user ${id}`)
      res.status(403).send('Forbidden')
      return
    }

    if (
      sessionUserType === bookcarsTypes.UserType.Supplier && !isSelf && !isSupplierUser && !isSupplierAgencyStaff
    ) {
      logger.error(`[user.getUser] Forbidden: supplier ${sessionUserId} tried to read user ${id}`)
      res.status(403).send('Forbidden')
      return
    }
    // end of security check

    if (!user) {
      logger.error('[user.getUser] User not found:', req.params)
      res.sendStatus(204)
      return
    }

    res.json(user)
  } catch (err) {
    logger.error(`[user.getUser] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Upload avatar to temp folder.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const createAvatar = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      throw new Error('[user.createAvatar] req.file not found')
    }

    const filename = `${req.user?._id}_${helper.getFilenameWithoutExtension(req.file.originalname)}_${nanoid()}_${Date.now()}${path.extname(req.file.originalname)}`
    const filepath = path.join(env.CDN_TEMP_USERS, filename)

    // security check: restrict allowed extensions
    const ext = path.extname(filename)
    if (!env.allowedImageExtensions.includes(ext.toLowerCase())) {
      res.status(400).send('Invalid avatar file type')
      return
    }

    if (!contentMatchesExtension(req.file.buffer, ext)) {
      res.status(400).send('Invalid avatar file type')
      return
    }

    await asyncFs.writeFile(filepath, req.file.buffer)
    res.json(filename)
  } catch (err) {
    logger.error(`[user.createAvatar] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Update avatar.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const updateAvatar = async (req: Request, res: Response) => {
  const { userId } = req.params

  try {
    if (!req.file) {
      const msg = 'req.file not found'
      logger.error(`[user.updateAvatar] ${msg}`)
      res.status(400).send(msg)
      return
    }

    const user = await User.findById(userId)

    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    const canManageAvatar = !!sessionUser && !!user && (
      sessionUser.type === bookcarsTypes.UserType.Admin
      || sessionUser._id.equals(user._id)
      || (sessionUser.type === bookcarsTypes.UserType.Supplier
        && user.type === bookcarsTypes.UserType.User
        && user.supplier?.equals(sessionUser._id))
    )
    if (!canManageAvatar) {
      res.status(403).send('Forbidden: You cannot delete this avatar')
      return
    }

    if (user) {
      if (user.avatar && !user.avatar.startsWith('http')) {
        const avatar = path.join(env.CDN_USERS, user.avatar)

        if (await helper.pathExists(avatar)) {
          await asyncFs.unlink(avatar)
        }
      }

      const filename = `${user._id}_${Date.now()}${path.extname(req.file.originalname)}`
      const filepath = path.join(env.CDN_USERS, filename)

      // security check: restrict allowed extensions
      const ext = path.extname(filename)
      if (!env.allowedImageExtensions.includes(ext.toLowerCase())) {
        res.status(400).send('Invalid avatar file type')
        return
      }

      if (!contentMatchesExtension(req.file.buffer, ext)) {
        res.status(400).send('Invalid avatar file type')
        return
      }

      await asyncFs.writeFile(filepath, req.file.buffer)
      user.avatar = filename
      await user.save()
      res.json(filename)
      return
    }

    logger.error('[user.updateAvatar] User not found:', userId)
    res.sendStatus(204)
  } catch (err) {
    logger.error(`[user.updateAvatar] ${i18n.t('ERROR')} ${userId}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Delete avatar.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const deleteAvatar = async (req: Request, res: Response) => {
  const { userId } = req.params

  try {
    const user = await User.findById(userId)

    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    const canManageAvatar = !!sessionUser && !!user && (
      sessionUser.type === bookcarsTypes.UserType.Admin
      || sessionUser._id.equals(user._id)
      || (sessionUser.type === bookcarsTypes.UserType.Supplier
        && user.type === bookcarsTypes.UserType.User
        && user.supplier?.equals(sessionUser._id))
    )
    if (!canManageAvatar) {
      res.status(403).send('Forbidden: You cannot update this avatar')
      return
    }

    if (user) {
      if (user.avatar && !user.avatar.startsWith('http')) {
        const avatar = path.join(env.CDN_USERS, user.avatar)
        if (await helper.pathExists(avatar)) {
          await asyncFs.unlink(avatar)
        }
      }
      user.avatar = undefined

      await user.save()
      res.sendStatus(200)
      return
    }

    logger.error('[user.deleteAvatar] User not found:', userId)
    res.sendStatus(204)
  } catch (err) {
    logger.error(`[user.deleteAvatar] ${i18n.t('ERROR')} ${userId}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Delete temp avatar.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const deleteTempAvatar = async (req: Request, res: Response) => {
  const { avatar } = req.params

  try {
    // prevent null bytes
    if (avatar.includes('\0')) {
      res.status(400).send('Invalid filename')
      return
    }

    const sessionUser = req.user
    if (!sessionUser || !canDeleteOwnedTempFile(sessionUser, avatar)) {
      res.status(403).send('Forbidden')
      return
    }

    const baseDir = path.resolve(env.CDN_TEMP_USERS)
    const targetPath = path.resolve(baseDir, avatar)

    // critical security check: prevent directory traversal
    if (!targetPath.startsWith(baseDir + path.sep)) {
      logger.warn(`Directory traversal attempt: ${avatar}`)
      res.status(403).send('Forbidden')
      return
    }

    if (await helper.pathExists(targetPath)) {
      await asyncFs.unlink(targetPath)
    } else {
      throw new Error(`[user.deleteTempAvatar] temp avatar ${avatar} not found`)
    }

    res.sendStatus(200)
  } catch (err) {
    logger.error(`[user.deleteTempAvatar] ${i18n.t('ERROR')} ${avatar}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Change password.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const changePassword = async (req: Request, res: Response) => {
  const { body }: { body: bookcarsTypes.ChangePasswordPayload } = req
  const {
    _id,
    password: currentPassword,
    newPassword,
    strict,
  } = body

  try {
    if (!helper.isValidObjectId(_id)) {
      throw new Error('User id is not valid')
    }

    const user = await User.findOne({ _id })
    if (!user) {
      logger.error('[user.changePassword] User not found:', _id)
      res.sendStatus(204)
      return
    }

    // begin of security check
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)

    const isSelf = !!sessionUser && sessionUser._id.equals(user._id)
    const isAdmin = !!sessionUser && sessionUser.type === bookcarsTypes.UserType.Admin
    const isAuthorizedSupplierUser = !!sessionUser
      && sessionUser.type === bookcarsTypes.UserType.Supplier
      && user.type === bookcarsTypes.UserType.User
      && user.supplier?.equals(sessionUser._id)

    const isAuthorized = isAdmin || isSelf || isAuthorizedSupplierUser

    if (!sessionUser || !isAuthorized) {
      logger.error(`[user.changePassword] Unauthorized attempt to change user password ${_id} by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot change user password')
      return
    }
    // end of security check

    // Social accounts do not require current password
    const isSocial = !!user.isSocial && !user.password
    const requireCurrentPassword = strict || (isSelf && !isSocial)
    if (requireCurrentPassword && !user.password) {
      logger.error('[user.changePassword] User.password not found:', _id)
      res.sendStatus(204)
      return
    }

    const _changePassword = async () => {
      const password = newPassword
      const passwordHash = await authHelper.hashPassword(password)
      user.password = passwordHash
      // H-007: a password change revokes every session issued so far.
      user.tokenVersion = (user.tokenVersion ?? 0) + 1
      await user.save()
      res.sendStatus(200)
    }

    if (requireCurrentPassword) {
      const passwordMatch = await bcrypt.compare(currentPassword, user.password!)
      if (passwordMatch) {
        await _changePassword()
        return
      }

      res.sendStatus(204)
      return
    }

    return await _changePassword()
  } catch (err) {
    logger.error(`[user.changePassword] ${i18n.t('ERROR')} ${_id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Check password.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const checkPassword = async (req: Request, res: Response) => {
  const { id } = req.params
  // H-005: on the POST variant the password travels in the JSON body, never
  // in the URL. The legacy GET variant (deprecated) still reads it from the
  // path, so both variants share identical authorization/status semantics.
  const password = (req.body as { password?: unknown } | undefined)?.password ?? req.params.password

  try {
    if (!helper.isValidObjectId(id)) {
      throw new Error('User id is not valid')
    }

    if (typeof password !== 'string' || !password) {
      throw new Error('Password is not valid')
    }

    const user = await User.findById(id)
    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    const canCheckPassword = !!sessionUser && !!user && (
      sessionUser.type === bookcarsTypes.UserType.Admin
      || sessionUser._id.equals(user._id)
      || (sessionUser.type === bookcarsTypes.UserType.Supplier
        && user.type === bookcarsTypes.UserType.User
        && user.supplier?.equals(sessionUser._id))
    )
    if (!canCheckPassword) {
      res.status(403).send('Forbidden: You cannot check this password')
      return
    }
    if (user) {
      if (!user.password) {
        logger.error('[user.changePassword] User.password not found')
        res.sendStatus(204)
        return
      }

      const passwordMatch = await bcrypt.compare(password, user.password)
      if (passwordMatch) {
        res.sendStatus(200)
        return
      }

      res.sendStatus(204)
      return
    }

    logger.error('[user.checkPassword] User not found:', id)
    res.sendStatus(204)
  } catch (err) {
    logger.error(`[user.checkPassword] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Get Users.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getUsers = async (req: Request, res: Response) => {
  try {
    // begin of security check
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User) {
      throw new Error('Forbidden: You cannot fetch users')
    }
    // end of security check

    const keyword = escapeStringRegexp(String(req.query.s || ''))
    const options = 'i'
    const page = Number.parseInt(req.params.page, 10)
    const size = Number.parseInt(req.params.size, 10)
    const { body }: { body: bookcarsTypes.GetUsersBody } = req
    const { types, user: userId } = body

    const $match: mongoose.QueryFilter<env.User> = {
      $and: [
        {
          type: { $in: types },
        },
        {
          $or: [
            { fullName: { $regex: keyword, $options: options } },
            { email: { $regex: keyword, $options: options } },
          ],
        },
        {
          expireAt: null,
        },
      ],
    }

    if ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)) {
      const agencyId = agencySupplierId(req)
      if (!agencyId) {
        res.status(403).send('Agency membership is required')
        return
      }
      // Aggregations do not cast string ids: without the ObjectId cast this
      // filter never matches and agency users see an empty client list.
      $match.$and!.push({ supplier: new mongoose.Types.ObjectId(agencyId), type: bookcarsTypes.UserType.User })
    }

    if (userId) {
      $match.$and!.push({ _id: { $ne: new mongoose.Types.ObjectId(userId) } })
    }

    const users = await User.aggregate(
      [
        {
          $match,
        },
        {
          $project: {
            supplier: 1,
            email: 1,
            phone: 1,
            fullName: 1,
            verified: 1,
            language: 1,
            enableEmailNotifications: 1,
            emailNotificationCategories: 1,
            avatar: 1,
            bio: 1,
            location: 1,
            type: 1,
            blacklisted: 1,
            birthDate: 1,
            customerId: 1,
            clientType: 1,
            clientStatus: 1,
            clientDocuments: 1,
          },
        },
        {
          $facet: {
            resultData: [{ $sort: { fullName: 1, _id: 1 } }, { $skip: (page - 1) * size }, { $limit: size }],
            pageInfo: [
              {
                $count: 'totalRecords',
              },
            ],
          },
        },
      ],
      { collation: { locale: env.DEFAULT_LANGUAGE, strength: 2 } },
    )

    // GA-PAR-04: per-client balance due on customer rows, computed with
    // the exact contractReceivable semantics (deposit never netted).
    // GA-PAR-04-FIX (QA assertion 04-13): the list must not leak
    // client-document metadata to callers without ReadPrivateDocuments
    // (getUser already strips it for the same callers). Every row carries
    // a server-computed clientDocumentsCount so the Clients-list documents
    // column keeps working for everyone; the array itself is removed for
    // callers without the permission.
    const canReadPrivateDocuments = hasAgencyPermission(req.agency, AgencyPermission.ReadPrivateDocuments)
    const resultData = users?.[0]?.resultData as env.User[] | undefined
    if (Array.isArray(resultData) && resultData.length > 0) {
      const rows = resultData as unknown as Record<string, unknown>[]
      for (const row of rows) {
        const documents = row.clientDocuments
        row.clientDocumentsCount = Array.isArray(documents) ? documents.length : 0
        if (!canReadPrivateDocuments) {
          delete row.clientDocuments
        }
      }
      const clientIds = resultData
        .filter((row) => row.type === bookcarsTypes.UserType.User && row._id)
        .map((row) => row._id!.toString())
      if (clientIds.length > 0) {
        const balances = await getClientBalances(clientIds)
        for (const row of rows) {
          if (row.type === bookcarsTypes.UserType.User && row._id) {
            row.balanceDue = balances.get(String(row._id))?.outstanding ?? 0
          }
        }
      }
    }

    res.json(users)
  } catch (err) {
    logger.error(`[user.getUsers] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Delete Users.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const deleteUsers = async (req: Request, res: Response) => {
  try {
    const { body }: { body: string[] } = req
    const ids: mongoose.Types.ObjectId[] = body.map((id: string) => new mongoose.Types.ObjectId(id))

    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)

    // H-025 (hardening Wave 4): validate every target BEFORE deleting any.
    // The previous single pass deleted each authorized user as it went and
    // only reported 403 at the end, so a mixed [own, foreign] request removed
    // the caller's own users while telling the caller the request had failed.
    // The per-user check below stays as defence in depth.
    for (const id of ids) {
      const target = await User.findById(id)
      if (target
        && (!sessionUser
          || sessionUser.type === bookcarsTypes.UserType.User
          || ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType) && agencySupplierId(req) !== target.supplier?.toString()))) {
        logger.error(`[user.delete] Unauthorized attempt to delete user ${id} by user ${sessionUserId}`)
        res.status(403).send('Forbidden: You cannot delete some of the users')
        return
      }
    }
    let unauthorizedAttemptLogged = false
    for (const id of ids) {
      const user = await User.findById(id)

      if (user) {
        // begin of security check
        if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User || ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType) && agencySupplierId(req) !== user.supplier?.toString())) {
          logger.error(`[user.delete] Unauthorized attempt to delete user ${id} by user ${sessionUserId}`)
          unauthorizedAttemptLogged = true
          continue
        }
        // end of security check


        await User.deleteOne({ _id: id })

        // Owner decision F-SEC-5 (GA-P10-DECISIONS-01): agency memberships
        // cascade with the user - both the rows where they are a staff
        // member and, for an agency owner, the rows of their agency.
        await AgencyMembership.deleteMany({ $or: [{ user: id }, { supplier: id }] })

        if (user.avatar) {
          const avatar = path.join(env.CDN_USERS, user.avatar)
          if (await helper.pathExists(avatar)) {
            await asyncFs.unlink(avatar)
          }
        }

        if (user.contracts && user.contracts.length > 0) {
          for (const contract of user.contracts) {
            if (contract.file) {
              const file = path.join(env.CDN_CONTRACTS, contract.file)
              if (await helper.pathExists(file)) {
                await asyncFs.unlink(file)
              }
            }
          }
        }

        if (user.license) {
          const file = path.join(env.CDN_LICENSES, user.license)
          if (await helper.pathExists(file)) {
            await asyncFs.unlink(file)
          }
        }

        if (user.type === bookcarsTypes.UserType.Supplier) {
          const additionalDrivers = (
            await Booking
              .find(
                { supplier: id, _additionalDriver: { $ne: null } },
              )
              .select('_additionalDriver -_id')
              .lean()
          ).map((b) => b._additionalDriver)
          await AdditionalDriver.deleteMany({ _id: { $in: additionalDrivers } })
          await Booking.deleteMany({ supplier: id })
          const cars = await Car.find({ supplier: id })
          await Car.deleteMany({ supplier: id })
          for (const car of cars) {
            if (car.image) {
              const image = path.join(env.CDN_CARS, car.image)
              if (await helper.pathExists(image)) {
                await asyncFs.unlink(image)
              }
            }
          }
        } else if (user.type === bookcarsTypes.UserType.User) {
          await Booking.deleteMany({ driver: id })
        }
        await NotificationCounter.deleteMany({ user: id })
        await Notification.deleteMany({ user: id })
      } else {
        logger.error('User not found:', id)
      }
    }

    if (unauthorizedAttemptLogged) {
      res.status(403).send('Forbidden: You cannot delete some of the users')
      return
    }

    res.sendStatus(200)
  } catch (err) {
    logger.error(`[user.delete] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Validate Google reCAPTCHA v3 token.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const verifyRecaptcha = async (req: Request, res: Response) => {
  try {
    const { token, ip } = req.params
    const result = await axios.get(`https://www.google.com/recaptcha/api/siteverify?secret=${encodeURIComponent(env.RECAPTCHA_SECRET)}&response=${encodeURIComponent(token)}&remoteip=${ip}`)
    const { success } = result.data

    if (success) {
      res.sendStatus(200)
      return
    }
    res.sendStatus(204)
  } catch (err) {
    logger.error(`[user.delete] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Send an email. reCAPTCHA is mandatory.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const sendEmail = async (req: Request, res: Response) => {
  try {
    const whitelist = [
      helper.trimEnd(env.ADMIN_HOST, '/'),
      helper.trimEnd(env.FRONTEND_HOST, '/'),
    ]
    const { origin } = req.headers
    if (!origin || whitelist.indexOf(helper.trimEnd(origin, '/')) === -1) {
      throw new Error('Unauthorized!')
    }

    const { body }: { body: bookcarsTypes.SendEmailPayload } = req
    const { from, to, subject, message, isContactForm } = body

    const mailOptions: SendMailOptions = {
      from: env.SMTP_FROM,
      to,
      subject: isContactForm ? i18n.t('CONTACT_SUBJECT') : subject,
      html:
        `<p>
              ${i18n.t('FROM')}: ${from}<br>
              ${(isContactForm && `${i18n.t('SUBJECT')}: ${subject}<br>`) || ''}
              ${(message && `${i18n.t('MESSAGE')}:<br>${message.replace(/(?:\r\n|\r|\n)/g, '<br>')}<br>`) || ''}
         </p>`,
    }
    await mailHelper.sendMail(mailOptions)

    res.sendStatus(200)
  } catch (err) {
    logger.error(`[user.sendEmail] ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Check if password exists.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const hasPassword = async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    if (!helper.isValidObjectId(id)) {
      throw new Error('User id not valid')
    }
    const targetUser = await User.findById(id).select('_id type supplier')
    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    const canReadPasswordState = !!sessionUser && !!targetUser && (
      sessionUser.type === bookcarsTypes.UserType.Admin
      || sessionUser._id.equals(targetUser._id)
      || (sessionUser.type === bookcarsTypes.UserType.Supplier
        && targetUser.type === bookcarsTypes.UserType.User
        && targetUser.supplier?.equals(sessionUser._id))
    )
    if (!canReadPasswordState) {
      res.status(403).send('Forbidden: You cannot read this password state')
      return
    }
    const passwordExists = await User.exists({ _id: id, password: { $ne: null } })

    if (passwordExists) {
      res.sendStatus(200)
      return
    }

    res.sendStatus(204)
  } catch (err) {
    logger.error(`[user.hasPassword] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Upload a license to temp folder.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const createLicense = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      throw new Error('req.file not found')
    }
    if (!req.file.originalname.includes('.')) {
      throw new Error('File extension not found')
    }

    const ext = path.extname(req.file.originalname).toLowerCase()
    // security check: restrict allowed extensions
    if (!env.allowedLicenseExtensions.includes(ext)) {
      res.status(400).send('Invalid license file type')
      return
    }

    if (!contentMatchesExtension(req.file.buffer, ext)) {
      res.status(400).send('Invalid license file type')
      return
    }

    const filename = createLicenseCapabilityFilename(ext)
    const filepath = path.join(env.CDN_TEMP_LICENSES, filename)
    await asyncFs.writeFile(filepath, req.file.buffer)
    res.json(filename)
  } catch (err) {
    logger.error(`[user.createLicense] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
* Update a license.
*
* @export
* @async
* @param {Request} req
* @param {Response} res
* @returns {unknown}
*/
export const updateLicense = async (req: Request, res: Response) => {
  const { id } = req.params
  const { file } = req

  try {
    if (!file) {
      throw new Error('req.file not found')
    }
    if (!file.originalname.includes('.')) {
      throw new Error('File extension not found')
    }
    if (!helper.isValidObjectId(id)) {
      throw new Error('User Id not valid')
    }

    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    const user = await User.findOne({ _id: id, type: bookcarsTypes.UserType.User })
    const canManageLicense = !!sessionUser && !!user && (
      sessionUser.type === bookcarsTypes.UserType.Admin
      || (sessionUser.type === bookcarsTypes.UserType.User && sessionUser._id.toString() === id)
      || (sessionUser.type === bookcarsTypes.UserType.Supplier
        && user.supplier?.toString() === sessionUser._id.toString())
      || (sessionUser.type === bookcarsTypes.UserType.Staff
        && user.supplier?.toString() === agencySupplierId(req)
        && hasAgencyPermission(req.agency, AgencyPermission.ManagePrivateDocuments))
    )
    if (!canManageLicense) {
      res.status(403).send('Forbidden: You cannot update this license')
      return
    }

    if (user) {
      if (user.license) {
        const licenseFile = path.join(env.CDN_LICENSES, user.license)
        if (await helper.pathExists(licenseFile)) {
          await asyncFs.unlink(licenseFile)
        }
      }

      const filename = `${user._id.toString()}${path.extname(file.originalname)}`
      const filepath = path.join(env.CDN_LICENSES, filename)

      // security check: restrict allowed extensions
      const ext = path.extname(filename)
      if (!env.allowedLicenseExtensions.includes(ext.toLowerCase())) {
        res.status(400).send('Invalid license file type')
        return
      }

      if (!contentMatchesExtension(file.buffer, ext)) {
        res.status(400).send('Invalid license file type')
        return
      }

      await asyncFs.writeFile(filepath, file.buffer)

      user.license = filename
      await user.save()
      res.json(filename)
      return
    }

    res.sendStatus(204)
  } catch (err) {
    logger.error(`[user.updateLicense] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
* Delete a license.
*
* @export
* @async
* @param {Request} req
* @param {Response} res
* @returns {unknown}
*/
export const deleteLicense = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    if (!helper.isValidObjectId(id)) {
      throw new Error('User Id not valid')
    }

    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    const user = await User.findOne({ _id: id, type: bookcarsTypes.UserType.User })
    const canManageLicense = !!sessionUser && !!user && (
      sessionUser.type === bookcarsTypes.UserType.Admin
      || (sessionUser.type === bookcarsTypes.UserType.User && sessionUser._id.toString() === id)
      || (sessionUser.type === bookcarsTypes.UserType.Supplier && user.supplier?.toString() === sessionUser._id.toString())
      || (sessionUser.type === bookcarsTypes.UserType.Staff
        && user.supplier?.toString() === agencySupplierId(req)
        && hasAgencyPermission(req.agency, AgencyPermission.ManagePrivateDocuments))
    )
    if (!canManageLicense) {
      res.status(403).send('Forbidden: You cannot delete this license')
      return
    }

    if (user) {
      if (user.license) {
        const licenseFile = path.join(env.CDN_LICENSES, user.license)
        if (await helper.pathExists(licenseFile)) {
          await asyncFs.unlink(licenseFile)
        }
        user.license = null
      }

      await user.save()
      res.sendStatus(200)
      return
    }
    res.sendStatus(204)
  } catch (err) {
    logger.error(`[user.deleteLicense] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
* Delete a temp license.
*
* @export
* @async
* @param {Request} req
* @param {Response} res
* @returns {*}
*/
export const deleteTempLicense = async (req: Request, res: Response) => {
  const { file } = req.params

  try {
    // prevent null bytes
    if (file.includes('\0')) {
      res.status(400).send('Invalid filename')
      return
    }

    if (!isValidLicenseCapabilityFilename(file)) {
      res.status(403).send('Invalid or expired file capability')
      return
    }

    const baseDir = path.resolve(env.CDN_TEMP_LICENSES)
    const targetPath = path.resolve(baseDir, file)

    // critical security check: prevent directory traversal
    if (!targetPath.startsWith(baseDir + path.sep)) {
      logger.warn(`Directory traversal attempt: ${file}`)
      res.status(403).send('Forbidden')
      return
    }

    if (await helper.pathExists(targetPath)) {
      await asyncFs.unlink(targetPath)
    }

    res.sendStatus(200)
  } catch (err) {
    logger.error(`[user.deleteTempLicense] ${i18n.t('ERROR')} ${file}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}



/**
 * GA-PAR-04: shared agency-scope check for client-document writes.
 * Mirrors the licence handlers: platform admin, the owning supplier, or
 * agency staff of the client's agency with ManageClients.
 */
const canManageClientDocuments = async (req: Request, clientId: string) => {
  const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
  const client = await User.findOne({ _id: clientId, type: bookcarsTypes.UserType.User })
  const allowed = !!sessionUser && !!client && (
    sessionUser.type === bookcarsTypes.UserType.Admin
    || (sessionUser.type === bookcarsTypes.UserType.Supplier
      && client.supplier?.toString() === sessionUser._id.toString())
    || (sessionUser.type === bookcarsTypes.UserType.Staff
      && client.supplier?.toString() === agencySupplierId(req)
      && hasAgencyPermission(req.agency, AgencyPermission.ManageClients))
  )
  return { sessionUser, client, allowed }
}

/**
 * GA-PAR-04: upload one client document into the private client-document
 * store. Validation mirrors the licence/inspection uploads: extension
 * allowlist (same list as licences) + content sniffing; anything else is
 * a 400 and nothing is stored.
 */
export const uploadClientDocument = async (req: Request, res: Response) => {
  const { id } = req.params
  const { file } = req

  try {
    if (!helper.isValidObjectId(id)) {
      res.status(400).send('User Id not valid')
      return
    }

    const { client, allowed } = await canManageClientDocuments(req, id)
    if (!client) {
      res.sendStatus(404)
      return
    }
    if (!allowed) {
      res.status(403).send('Forbidden: You cannot manage this client\'s documents')
      return
    }

    if (!file) {
      res.status(400).send('No file provided')
      return
    }
    if (!file.originalname.includes('.')) {
      res.status(400).send('Invalid client document file type')
      return
    }

    const ext = path.extname(file.originalname).toLowerCase()
    if (!env.allowedLicenseExtensions.includes(ext)) {
      res.status(400).send('Invalid client document file type')
      return
    }
    if (!contentMatchesExtension(file.buffer, ext)) {
      res.status(400).send('Invalid client document file type')
      return
    }

    const rawKind = typeof req.body?.kind === 'string' ? req.body.kind.trim().toLowerCase() : ''
    const kind = Object.values(bookcarsTypes.ClientDocumentKind).includes(rawKind as bookcarsTypes.ClientDocumentKind)
      ? rawKind
      : bookcarsTypes.ClientDocumentKind.Other

    await asyncFs.mkdir(env.CDN_CLIENT_DOCUMENTS, { recursive: true })
    const filename = `clientdoc_${client._id.toString()}_${nanoid(12)}${ext}`
    const filepath = path.join(env.CDN_CLIENT_DOCUMENTS, filename)
    await asyncFs.writeFile(filepath, file.buffer)

    const document: bookcarsTypes.ClientDocument = {
      kind,
      file: filename,
      originalName: path.basename(file.originalname).slice(0, 255),
      uploadedAt: new Date(),
    }
    client.clientDocuments = [...(client.clientDocuments || []), document]
    await client.save()
    res.json(document)
  } catch (err) {
    logger.error(`[user.uploadClientDocument] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * GA-PAR-04: delete exactly one client document (record + stored file);
 * the client's other documents are untouched.
 */
export const deleteClientDocument = async (req: Request, res: Response) => {
  const { id, file } = req.params

  try {
    if (!helper.isValidObjectId(id) || file !== path.basename(file)) {
      res.status(400).send('Invalid document reference')
      return
    }

    const { client, allowed } = await canManageClientDocuments(req, id)
    if (!client) {
      res.sendStatus(404)
      return
    }
    if (!allowed) {
      res.status(403).send('Forbidden: You cannot manage this client\'s documents')
      return
    }

    const documents = client.clientDocuments || []
    const target = documents.find((doc) => doc.file === file)
    if (!target) {
      res.sendStatus(404)
      return
    }

    client.clientDocuments = documents.filter((doc) => doc.file !== file)
    await client.save()

    const filepath = path.join(env.CDN_CLIENT_DOCUMENTS, target.file)
    if (await helper.pathExists(filepath)) {
      await asyncFs.unlink(filepath)
    }
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[user.deleteClientDocument] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * GA-PAR-04: per-client balance. Agency-scoped exactly like getUser:
 * admin, the owning supplier, agency staff with ReadClients, or the
 * client themself. Amounts come from getClientBalances, which applies
 * the contractReceivable formula per booking (deposit never netted).
 */
export const getClientBalance = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    if (!helper.isValidObjectId(id)) {
      res.status(400).send('User id is not valid')
      return
    }

    const client = await User.findOne({ _id: id, type: bookcarsTypes.UserType.User }).select('_id supplier').lean()
    if (!client) {
      res.sendStatus(404)
      return
    }

    const sessionUserId = req.user?._id
    const sessionUserType = req.user?.type
    const isSelf = sessionUserId === id
    const isSupplierUser = sessionUserType === bookcarsTypes.UserType.Supplier
      && client.supplier?.toString() === sessionUserId
    const isStaffAgencyCustomer = sessionUserType === bookcarsTypes.UserType.Staff
      && !!client.supplier
      && agencySupplierId(req) === client.supplier.toString()
      && hasAgencyPermission(req.agency, AgencyPermission.ReadClients)

    if (sessionUserType !== bookcarsTypes.UserType.Admin && !isSelf && !isSupplierUser && !isStaffAgencyCustomer) {
      res.status(403).send('Forbidden')
      return
    }

    const balances = await getClientBalances([id])
    const balance = balances.get(id) || {
      currency: env.BASE_CURRENCY.toUpperCase(),
      outstanding: 0,
      overdue: 0,
      depositHeld: 0,
      bookings: 0,
    }
    res.json({
      currency: balance.currency,
      outstanding: balance.outstanding,
      overdue: balance.overdue,
      depositHeld: balance.depositHeld,
      bookings: balance.bookings,
    })
  } catch (err) {
    logger.error(`[user.getClientBalance] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
