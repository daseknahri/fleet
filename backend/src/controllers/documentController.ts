import path from 'node:path'
import { Request, Response } from 'express'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import MaintenanceExpense from '../models/MaintenanceExpense'
import User from '../models/User'
import * as helper from '../utils/helper'
import * as logger from '../utils/logger'
import { canReadSupplierContract, canReadUserLicense } from '../utils/authorization'
import { agencySupplierId, AgencyPermission, hasAgencyPermission, getAgencyContext } from '../utils/agencyAuthorization'

const isSafeFilename = (filename: string) => (
  !!filename
  && filename === path.basename(filename)
  && !filename.includes('\0')
)

const sendPrivateFile = async (res: Response, filepath: string, contentType: string) => {
  if (!(await helper.pathExists(filepath))) {
    res.sendStatus(404)
    return
  }

  res
    .type(contentType)
    .set('Cache-Control', 'private, no-store')
    .sendFile(filepath, (err) => {
      if (err && !res.headersSent) {
        const statusCode = typeof err === 'object' && err !== null && 'statusCode' in err
          ? Number((err as { statusCode?: number }).statusCode) || 404
          : 404
        res.status(statusCode).send('Document not found')
      }
    })
}

/**
 * Download a supplier contract after checking the caller and the stored contract record.
 * Platform administrators, the owning supplier, and customers with a booking at the
 * supplier may read the contract. The public CDN never serves this directory.
 */
export const downloadContract = async (req: Request, res: Response) => {
  const { supplierId, filename } = req.params

  try {
    if (!helper.isValidObjectId(supplierId) || !isSafeFilename(filename)) {
      res.status(400).send('Invalid document reference')
      return
    }

    const callerId = req.user?._id
    if (!callerId) {
      res.status(403).send('Authentication required')
      return
    }

    const [caller, supplier] = await Promise.all([
      User.findById(callerId).select('_id type'),
      User.findOne({ _id: supplierId, type: bookcarsTypes.UserType.Supplier }).select('_id contracts'),
    ])

    if (!caller || !supplier) {
      res.sendStatus(404)
      return
    }

    const hasBookingAtSupplier = caller.type === bookcarsTypes.UserType.User
      && !!(await Booking.exists({ supplier: supplier._id, driver: caller._id }))

    const canReadStaffContract = caller.type === bookcarsTypes.UserType.Staff
      && agencySupplierId(req) === supplier._id.toString()
      && hasAgencyPermission(req.agency, AgencyPermission.ReadPrivateDocuments)

    if (!canReadSupplierContract(caller, supplier._id, hasBookingAtSupplier) && !canReadStaffContract) {
      res.status(403).send('Forbidden')
      return
    }

    const contract = supplier.contracts?.find((entry) => entry.file === filename)
    if (!contract?.file) {
      res.sendStatus(404)
      return
    }

    const contractsDir = path.resolve(env.CDN_CONTRACTS)
    const filepath = path.resolve(contractsDir, contract.file)
    if (!filepath.startsWith(`${contractsDir}${path.sep}`)) {
      logger.warn(`[document.downloadContract] path escape attempt: ${filename}`)
      res.status(403).send('Forbidden')
      return
    }

    await sendPrivateFile(res, filepath, 'application/pdf')
  } catch (err) {
    logger.error(`[document.downloadContract] ${i18nSafeError(err)}`, err)
    if (!res.headersSent) {
      res.status(500).send('Unable to download document')
    }
  }
}

/**
 * Download a customer's driving license after checking the caller's relationship to it.
 * The customer may access their own file, the owning supplier may access its customers'
 * files, and platform administrators may access all files.
 */
export const downloadLicense = async (req: Request, res: Response) => {
  const { userId, filename } = req.params

  try {
    if (!helper.isValidObjectId(userId) || !isSafeFilename(filename)) {
      res.status(400).send('Invalid document reference')
      return
    }

    const callerId = req.user?._id
    if (!callerId) {
      res.status(403).send('Authentication required')
      return
    }

    const [caller, user] = await Promise.all([
      User.findById(callerId).select('_id type'),
      User.findOne({ _id: userId, type: bookcarsTypes.UserType.User }).select('_id supplier license'),
    ])

    if (!caller || !user || user.license !== filename) {
      res.sendStatus(404)
      return
    }

    const canReadStaffLicense = caller.type === bookcarsTypes.UserType.Staff
      && !!user.supplier
      && agencySupplierId(req) === user.supplier.toString()
      && hasAgencyPermission(req.agency, AgencyPermission.ReadPrivateDocuments)

    if (!canReadUserLicense(caller, user._id, user.supplier) && !canReadStaffLicense) {
      res.status(403).send('Forbidden')
      return
    }

    const licensesDir = path.resolve(env.CDN_LICENSES)
    const filepath = path.resolve(licensesDir, user.license)
    if (!filepath.startsWith(`${licensesDir}${path.sep}`)) {
      logger.warn(`[document.downloadLicense] path escape attempt: ${filename}`)
      res.status(403).send('Forbidden')
      return
    }

    const extension = path.extname(filename).toLowerCase()
    const contentType = extension === '.pdf'
      ? 'application/pdf'
      : extension === '.png'
        ? 'image/png'
        : extension === '.webp'
          ? 'image/webp'
          : 'image/jpeg'
    await sendPrivateFile(res, filepath, contentType)
  } catch (err) {
    logger.error(`[document.downloadLicense] ${i18nSafeError(err)}`, err)
    if (!res.headersSent) {
      res.status(500).send('Unable to download document')
    }
  }
}

const i18nSafeError = (err: unknown) => err instanceof Error ? err.message : String(err)


/** Download a maintenance receipt only through an agency-scoped expense lookup. */
export const downloadMaintenanceReceipt = async (req: Request, res: Response) => {
  try {
    const { expenseId, filename } = req.params
    if (!helper.isValidObjectId(expenseId) || !isSafeFilename(filename)) {
 res.status(400).send('Invalid document reference'); return 
}
    const caller = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    if (!caller) {
 res.status(403).send('Authentication required'); return 
}
    const expense = await MaintenanceExpense.findById(expenseId).select('supplier receipt')
    if (!expense || expense.receipt !== filename) {
 res.sendStatus(404); return 
}
    const context = caller.type === bookcarsTypes.UserType.Admin
      ? { supplierId: expense.supplier.toString(), role: bookcarsTypes.AgencyRole.Owner }
      : await getAgencyContext(req.user!, expense.supplier.toString())
    const canRead = caller.type === bookcarsTypes.UserType.Admin
      || (!!context && agencySupplierId(req) === expense.supplier.toString() && hasAgencyPermission(context, AgencyPermission.ReadPrivateDocuments))
    if (!canRead) {
 res.status(403).send('Forbidden'); return 
}
    const baseDir = path.resolve(env.CDN_MAINTENANCE)
    const filepath = path.resolve(baseDir, filename)
    if (!filepath.startsWith(`${baseDir}${path.sep}`)) {
 res.status(403).send('Forbidden'); return 
}
    const ext = path.extname(filename).toLowerCase()
    const contentType = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    await sendPrivateFile(res, filepath, contentType)
  } catch (err) {
    logger.error(`[document.downloadMaintenanceReceipt] ${i18nSafeError(err)}`, err)
    if (!res.headersSent) {
res.status(500).send('Unable to download document')
}
  }
}
