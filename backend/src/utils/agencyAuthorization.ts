import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import AgencyMembership from '../models/AgencyMembership'
import User from '../models/User'
import type { Request, Response, NextFunction } from 'express'

export type AgencyContext = {
  supplierId: string
  role: bookcarsTypes.AgencyRole
  membershipId?: string
}

export const STAFF_ROLES = [
  bookcarsTypes.AgencyRole.Manager,
  bookcarsTypes.AgencyRole.CounterAgent,
  bookcarsTypes.AgencyRole.Accountant,
  bookcarsTypes.AgencyRole.Mechanic,
  bookcarsTypes.AgencyRole.ReadOnly,
] as const

export const isStaffRole = (role: unknown): role is bookcarsTypes.AgencyRole => (
  STAFF_ROLES.includes(role as typeof STAFF_ROLES[number])
)

export const isActiveMembership = (membership: { status?: unknown } | null | undefined) => (
  membership?.status === bookcarsTypes.AgencyMembershipStatus.Active
)

export const hasUniqueActiveMembershipCount = (count: number) => count === 1

export const getAgencyContext = async (
  actor: { _id: string, type?: bookcarsTypes.UserType },
  supplierId?: string,
): Promise<AgencyContext | null> => {
  if (actor.type === bookcarsTypes.UserType.Supplier) {
    if (supplierId && actor._id !== supplierId) {
      return null
    }
    return { supplierId: actor._id, role: bookcarsTypes.AgencyRole.Owner }
  }

  if (actor.type !== bookcarsTypes.UserType.Staff || !supplierId || !mongoose.isValidObjectId(supplierId)) {
    return null
  }

  const memberships = await AgencyMembership.find({
    supplier: supplierId,
    user: actor._id,
    status: bookcarsTypes.AgencyMembershipStatus.Active,
  }).select('_id supplier role').limit(2).lean()

  if (!hasUniqueActiveMembershipCount(memberships.length)) {
    return null
  }
  const [membership] = memberships

  return {
    supplierId: membership.supplier.toString(),
    role: membership.role,
    membershipId: membership._id.toString(),
  }
}

export const canManageMemberships = (context: AgencyContext | null) => (
  !!context && context.role === bookcarsTypes.AgencyRole.Owner
)

export const canReadMemberships = (context: AgencyContext | null) => (
  !!context && [bookcarsTypes.AgencyRole.Owner, bookcarsTypes.AgencyRole.Manager].includes(context.role)
)

export const validateAgencyOwner = async (supplierId: string) => (
  mongoose.isValidObjectId(supplierId)
  && !!(await User.exists({ _id: supplierId, type: bookcarsTypes.UserType.Supplier }))
)


/**
 * Backend capabilities used by agency routes. These are intentionally coarse
 * until the contract, ledger and approval workflows have their own state
 * machines. Every capability is still constrained by the active agency.
 */
export enum AgencyPermission {
  ReadAgencyProfile = 'readAgencyProfile',
  ManageAgencyProfile = 'manageAgencyProfile',
  ReadBookings = 'readBookings',
  ManageBookings = 'manageBookings',
  ReadFleet = 'readFleet',
  ManageFleet = 'manageFleet',
  ReadLocations = 'readLocations',
  ManageLocations = 'manageLocations',
  ReadClients = 'readClients',
  ManageClients = 'manageClients',
  ReadPrivateDocuments = 'readPrivateDocuments',
  ManagePrivateDocuments = 'managePrivateDocuments',
  ReadExpenses = 'readExpenses',
  ManageExpenses = 'manageExpenses',
  ReadPayments = 'readPayments',
  RecordPayments = 'recordPayments',
  ReadCash = 'readCash',
  ManageCash = 'manageCash',
  RecordCash = 'recordCash',
  ReadInvoices = 'readInvoices',
  ManageInvoices = 'manageInvoices',
  DecideInvoices = 'decideInvoices',
}

export const rolePermissions: Record<bookcarsTypes.AgencyRole, readonly AgencyPermission[]> = {
  [bookcarsTypes.AgencyRole.Owner]: Object.values(AgencyPermission),
  [bookcarsTypes.AgencyRole.Manager]: [
    AgencyPermission.ReadAgencyProfile,
    AgencyPermission.ReadBookings,
    AgencyPermission.ManageBookings,
    AgencyPermission.ReadFleet,
    AgencyPermission.ManageFleet,
    AgencyPermission.ReadLocations,
    AgencyPermission.ManageLocations,
    AgencyPermission.ReadClients,
    AgencyPermission.ManageClients,
    AgencyPermission.ReadPrivateDocuments,
    AgencyPermission.ManagePrivateDocuments,
    AgencyPermission.ReadExpenses,
    AgencyPermission.ManageExpenses,
    AgencyPermission.ReadPayments,
    AgencyPermission.ReadCash,
    AgencyPermission.ManageCash,
    AgencyPermission.RecordCash,
    AgencyPermission.ReadInvoices,
    AgencyPermission.ManageInvoices,
    AgencyPermission.DecideInvoices,
  ],
  [bookcarsTypes.AgencyRole.CounterAgent]: [
    AgencyPermission.ReadBookings,
    AgencyPermission.ManageBookings,
    AgencyPermission.ReadFleet,
    AgencyPermission.ReadLocations,
    AgencyPermission.ReadClients,
    AgencyPermission.ManageClients,
    AgencyPermission.ReadPrivateDocuments,
    // Authorization matrix ("Record pending" for payment entry and the
    // cash drawer), confirmed by owner decision 1.5 (GA-P10-DECISIONS-01):
    // counter agents may record payment and cash entries, which stay
    // pending until an accountant or above confirms them.
    AgencyPermission.RecordPayments,
    AgencyPermission.ReadCash,
    AgencyPermission.RecordCash,
  ],
  [bookcarsTypes.AgencyRole.Accountant]: [
    AgencyPermission.ReadAgencyProfile,
    AgencyPermission.ReadBookings,
    AgencyPermission.ReadFleet,
    AgencyPermission.ReadLocations,
    AgencyPermission.ReadClients,
    AgencyPermission.ReadExpenses,
    AgencyPermission.ManageExpenses,
    AgencyPermission.ReadPayments,
    AgencyPermission.RecordPayments,
    AgencyPermission.ReadCash,
    AgencyPermission.ManageCash,
    AgencyPermission.RecordCash,
    AgencyPermission.ReadInvoices,
    AgencyPermission.ManageInvoices,
  ],
  [bookcarsTypes.AgencyRole.Mechanic]: [
    AgencyPermission.ReadBookings,
    AgencyPermission.ReadFleet,
    AgencyPermission.ReadLocations,
    AgencyPermission.ReadExpenses,
    AgencyPermission.ManageExpenses,
  ],
  [bookcarsTypes.AgencyRole.ReadOnly]: [
    AgencyPermission.ReadBookings,
    AgencyPermission.ReadFleet,
    AgencyPermission.ReadClients,
    AgencyPermission.ReadLocations,
    AgencyPermission.ReadPayments,
    AgencyPermission.ReadCash,
    AgencyPermission.ReadInvoices,
  ],
}

export const hasAgencyPermission = (
  context: AgencyContext | null | undefined,
  permission: AgencyPermission,
) => !!context && rolePermissions[context.role]?.includes(permission) === true

export const agencySupplierId = (req: Pick<Request, 'user' | 'agency'>) => (
  req.agency?.supplierId
  || (req.user?.type === bookcarsTypes.UserType.Supplier ? req.user._id : undefined)
)

const requestedSupplierId = (req: Request) => (
  (typeof req.params.supplierId === 'string' && req.params.supplierId)
  || (typeof req.params.id === 'string' && req.params.id)
  || (typeof req.body?.supplier === 'string' && req.body.supplier)
  || (typeof req.query.supplier === 'string' && req.query.supplier)
  || undefined
)

/**
 * Require an agency capability while preserving the platform admin bypass.
 * Admin requests may supply an agency selector; agency owners and staff are
 * always resolved from their authenticated identity/membership.
 */
export const requireAnyAgencyPermission = (permissions: AgencyPermission[]) => async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    res.status(401).send({ message: 'Unauthorized!' })
    return
  }

  if (req.user.type === bookcarsTypes.UserType.User) {
    res.status(403).send({ message: 'Agency access required' })
    return
  }

  if (req.user.type === bookcarsTypes.UserType.Admin) {
    req.agency = {
      supplierId: requestedSupplierId(req) || '',
      role: bookcarsTypes.AgencyRole.Owner,
    }
    next()
    return
  }

  const requested = req.user.type === bookcarsTypes.UserType.Supplier
    ? undefined
    : (requestedSupplierId(req) || req.agency?.supplierId)
  const context = await getAgencyContext(req.user, requested)
  if (!context || !permissions.some((permission) => hasAgencyPermission(context, permission))) {
    res.status(403).send({ message: 'Insufficient agency permission' })
    return
  }

  req.agency = context
  next()
}

export const requireAgencyPermission = (permission: AgencyPermission) => async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    res.status(401).send({ message: 'Unauthorized!' })
    return
  }

  // Customer booking history uses this same endpoint. Keep customer access
  // under the controller's driver ownership check and require agency scope
  // for every back-office capability.
  if (req.user.type === bookcarsTypes.UserType.User) {
    if (permission === AgencyPermission.ReadBookings) {
      next()
      return
    }
    res.status(403).send({ message: 'Agency access required' })
    return
  }

  if (req.user.type === bookcarsTypes.UserType.Admin) {
    req.agency = {
      supplierId: requestedSupplierId(req) || '',
      role: bookcarsTypes.AgencyRole.Owner,
    }
    next()
    return
  }

  const requested = req.user.type === bookcarsTypes.UserType.Supplier
    ? undefined
    : (requestedSupplierId(req) || req.agency?.supplierId)
  const context = await getAgencyContext(req.user, requested)
  if (!context || !hasAgencyPermission(context, permission)) {
    res.status(403).send({ message: 'Insufficient agency permission' })
    return
  }

  req.agency = context
  next()
}
