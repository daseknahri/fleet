import type { Request, Response, NextFunction } from 'express'
import * as bookcarsTypes from ':bookcars-types'
import { AgencyPermission, canManageMemberships, getAgencyContext, hasAgencyPermission, requireAgencyPermission } from '../utils/agencyAuthorization'
import RentalPayment from '../models/RentalPayment'
import Invoice from '../models/Invoice'

const requestedSupplierId = (req: Request) => (
  (typeof req.params.supplierId === 'string' && req.params.supplierId)
  || (typeof req.body?.supplier === 'string' && req.body.supplier)
  || undefined
)

export const requireAgencyOwner = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    res.status(401).send({ message: 'Unauthorized!' })
    return
  }

  if (req.user.type === bookcarsTypes.UserType.Admin) {
    const supplierId = requestedSupplierId(req)
    if (!supplierId) {
      res.status(400).send({ message: 'Agency is required' })
      return
    }
    req.agency = { supplierId, role: bookcarsTypes.AgencyRole.Owner }
    next()
    return
  }

  const context = await getAgencyContext(req.user, requestedSupplierId(req))
  if (!canManageMemberships(context)) {
    res.status(403).send({ message: 'Require agency owner role' })
    return
  }
  req.agency = context!
  next()
}

export const requireAgencyMemberRead = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    res.status(401).send({ message: 'Unauthorized!' })
    return
  }

  if (req.user.type === bookcarsTypes.UserType.Admin) {
    const supplierId = requestedSupplierId(req)
    if (!supplierId) {
      res.status(400).send({ message: 'Agency is required' })
      return
    }
    req.agency = { supplierId, role: bookcarsTypes.AgencyRole.Owner }
    next()
    return
  }

  const requestedAgency = requestedSupplierId(req)
  const context = requestedAgency || req.user.type !== bookcarsTypes.UserType.Staff
    ? await getAgencyContext(req.user, requestedAgency)
    : req.agency || null
  if (!context || ![
    bookcarsTypes.AgencyRole.Owner,
    bookcarsTypes.AgencyRole.Manager,
  ].includes(context.role)) {
    res.status(403).send({ message: 'Require agency membership access' })
    return
  }
  req.agency = context
  next()
}


export const requireInvoiceAgencyPermission = (permission: AgencyPermission) => async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    res.status(401).send({ message: 'Unauthorized!' })
    return
  }
  const invoice = await Invoice.findById(req.params.id).select('supplier').lean()
  if (!invoice) {
    res.sendStatus(404)
    return
  }
  const supplierId = invoice.supplier.toString()
  if (req.user.type === bookcarsTypes.UserType.Admin) {
    req.agency = { supplierId, role: bookcarsTypes.AgencyRole.Owner }
    next()
    return
  }
  const context = await getAgencyContext(req.user, supplierId)
  if (!context || !hasAgencyPermission(context, permission)) {
    res.status(403).send({ message: 'Insufficient agency permission' })
    return
  }
  req.agency = context
  next()
}

export const requirePaymentAgencyPermission = (permission: AgencyPermission) => async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    res.status(401).send({ message: 'Unauthorized!' })
    return
  }
  const payment = await RentalPayment.findById(req.params.id).select('supplier').lean()
  if (!payment) {
    res.sendStatus(404)
    return
  }
  const supplierId = payment.supplier.toString()
  if (req.user.type === bookcarsTypes.UserType.Admin) {
    req.agency = { supplierId, role: bookcarsTypes.AgencyRole.Owner }
    next()
    return
  }
  const context = await getAgencyContext(req.user, supplierId)
  if (!context || !hasAgencyPermission(context, permission)) {
    res.status(403).send({ message: 'Insufficient agency permission' })
    return
  }
  req.agency = context
  next()
}
export default { requireAgencyOwner, requireAgencyMemberRead, requireAgencyPermission, requirePaymentAgencyPermission, requireInvoiceAgencyPermission, AgencyPermission }
export { AgencyPermission, requireAgencyPermission }
