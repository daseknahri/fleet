import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import AgencyMembership from '../models/AgencyMembership'
import AdminAccessLog from '../models/AdminAccessLog'
import User from '../models/User'
import * as logger from './logger'
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
  // F8 / W5 A3 — read the approvals queue without deciding. Requesters
  // (Accountant, CounterAgent) hold it so they can see their own
  // requests; deciding still requires DecideInvoices, and the list
  // controller restricts non-deciders to their own rows. Addition-only,
  // no existing role decision changes.
  ReadApprovals = 'readApprovals',
  // GA-PAR-07: apporteur module — the one Queue-2 item sanctioned to touch
  // this matrix. It only ADDS capabilities; no existing role decision
  // changes (role-matrix items 2–5 stay open).
  ReadAgents = 'readAgents',
  ManageAgents = 'manageAgents',
  // GA-PAR-13: reminders — additions only, no existing role decision
  // changes. Owner + Manager = read+manage; Accountant, CounterAgent,
  // Mechanic, ReadOnly = read (the Manager/role lists below).
  ReadReminders = 'readReminders',
  ManageReminders = 'manageReminders',
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
    AgencyPermission.ReadApprovals,
    AgencyPermission.ReadAgents,
    AgencyPermission.ManageAgents,
    AgencyPermission.ReadReminders,
    AgencyPermission.ManageReminders,
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
    // GA-PAR-07: counter agents attach agents at booking time, so they
    // need the picker (read) — never create/edit/settle (manage).
    AgencyPermission.ReadAgents,
    // GA-PAR-13: reminders are read-only for counter agents.
    AgencyPermission.ReadReminders,
    // F8 / W5 A3: counter agents see their own approval requests.
    AgencyPermission.ReadApprovals,
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
    // GA-PAR-07: accountants read agent balances; settling stays with
    // Owner/Manager (ManageAgents).
    AgencyPermission.ReadAgents,
    // GA-PAR-13: reminders are read-only for accountants.
    AgencyPermission.ReadReminders,
    // F8 / W5 A3: accountants see their own approval requests.
    AgencyPermission.ReadApprovals,
  ],
  [bookcarsTypes.AgencyRole.Mechanic]: [
    AgencyPermission.ReadBookings,
    AgencyPermission.ReadFleet,
    AgencyPermission.ReadLocations,
    AgencyPermission.ReadExpenses,
    AgencyPermission.ManageExpenses,
    // GA-PAR-13: mechanics read reminders (oil change / visite dates are
    // their working surface) — never manage.
    AgencyPermission.ReadReminders,
  ],
  [bookcarsTypes.AgencyRole.ReadOnly]: [
    AgencyPermission.ReadBookings,
    AgencyPermission.ReadFleet,
    AgencyPermission.ReadClients,
    AgencyPermission.ReadLocations,
    AgencyPermission.ReadPayments,
    AgencyPermission.ReadCash,
    AgencyPermission.ReadInvoices,
    AgencyPermission.ReadAgents,
    // GA-PAR-13: reminders are read-only for the ReadOnly role.
    AgencyPermission.ReadReminders,
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
  || (typeof req.body?.supplier === 'string' && req.body.supplier)
  || (typeof req.query.supplier === 'string' && req.query.supplier)
  || undefined
)

// ---------------------------------------------------------------------
// Wave 2.11 — platform-admin cross-agency access: explicit selector +
// audit log. An admin call that touches agency data must name the
// agency it acts in. The selector is read from every shape the admin
// UI and the tests already send: a path/query/body `supplier`, a
// `suppliers` array (list calls), or the supplier nested in the
// resource payload (booking / car / location updates).
// ---------------------------------------------------------------------

/**
 * Every agency id this admin call explicitly selects (deduped, valid
 * ObjectIds only). Empty when the call names no agency at all.
 */
export const adminSelectorSupplierIds = (req: Request): string[] => {
  const ids: string[] = []
  const push = (value: unknown) => {
    if (typeof value === 'string' && mongoose.isValidObjectId(value) && !ids.includes(value)) {
      ids.push(value)
    }
  }
  push(req.params.supplierId)
  push(req.query.supplier)
  push(req.body?.supplier)
  const suppliers = req.body?.suppliers
  if (Array.isArray(suppliers)) {
    for (const value of suppliers) {
      push(value)
    }
  }
  push(req.body?.booking?.supplier)
  push(req.body?.car?.supplier)
  push(req.body?.location?.supplier)
  return ids.slice(0, 100)
}

/**
 * One audit row per selected agency: who acted, in which agency,
 * doing what, and when. Best-effort by design — a logging failure is
 * recorded in the server log and never refuses the call it audits.
 */
export const logAdminCrossAgencyAccess = async (
  req: Request,
  supplierIds: string[],
  action: string,
): Promise<void> => {
  try {
    const actor = req.user?._id
    if (!actor || !mongoose.isValidObjectId(actor) || supplierIds.length === 0) {
      return
    }
    const rows = supplierIds.map((agency) => ({
      actor: new mongoose.Types.ObjectId(actor),
      agency: new mongoose.Types.ObjectId(agency),
      action,
      method: req.method,
      path: req.path,
    }))
    await AdminAccessLog.insertMany(rows, { ordered: false })
  } catch (err) {
    logger.error('[agencyAuthorization.logAdminCrossAgencyAccess] audit log failed', err)
  }
}

/**
 * True when this request addresses specific resources: an ObjectId in
 * the path (e.g. /api/bookings/:id/cancel) OR the resource ids in the
 * body (bulk staff routes — updateStatus / delete / trash / restore —
 * carry `ids` in the body, not the path). The agency is then determined
 * by the resource itself, not by a selector, and the controller that
 * loads the resource logs the access with its agency. Collection
 * routes (lists, no resource id) have no resource to attribute to —
 * they need the explicit selector.
 */
export const hasResourceIdParam = (req: Request): boolean => {
  if (Object.values(req.params || {}).some((value) => typeof value === 'string' && mongoose.isValidObjectId(value))) {
    return true
  }
  // A bulk call posts the ids as a top-level array (e.g. delete-users):
  // the agency is determined by the resources themselves, and the
  // controller that loads them logs the access with their agencies.
  if (Array.isArray(req.body) && req.body.some((value) => typeof value === 'string' && mongoose.isValidObjectId(value))) {
    return true
  }
  const body = (req.body || {}) as { ids?: unknown, id?: unknown, _id?: unknown, booking?: unknown, car?: unknown, location?: unknown }
  if (typeof body.id === 'string' && mongoose.isValidObjectId(body.id)) {
    return true
  }
  // A single-resource write names its resource by _id in the body
  // (e.g. an admin updating a supplier): the agency is the resource
  // itself, and the controller that loads it logs the access.
  if (typeof body._id === 'string' && mongoose.isValidObjectId(body._id)) {
    return true
  }
  // A booking-scoped write names its booking, not a supplier (e.g. an
  // admin posting a rental payment): the agency is determined by that
  // booking, and the controller that loads it logs the access with its
  // agency.
  if (typeof body.booking === 'string' && mongoose.isValidObjectId(body.booking)) {
    return true
  }
  // A vehicle- or location-scoped write names its car / location, not a
  // supplier (e.g. an admin creating a maintenance schedule or expense
  // for an agency vehicle): the agency is the resource's agency, and
  // the controller that loads it logs the access with that agency.
  // The value may be a bare id or an object carrying _id (admin forms
  // submit the whole resource).
  const resourceId = (value: unknown): string | undefined => {
    if (typeof value === 'string' && mongoose.isValidObjectId(value)) {
      return value
    }
    if (value && typeof value === 'object' && typeof (value as { _id?: unknown })._id === 'string'
      && mongoose.isValidObjectId((value as { _id: string })._id)) {
      return (value as { _id: string })._id
    }
    return undefined
  }
  if (resourceId(body.car) || resourceId(body.location)) {
    return true
  }
  return Array.isArray(body.ids) && body.ids.some((value) => typeof value === 'string' && mongoose.isValidObjectId(value))
}

export type AgencyPermissionOptions = {
  /**
   * Platform-wide routes by design (all-agency aggregates, reference
   * data, user management, temp-file utilities): a platform admin
   * without a selector reads the whole platform there instead of being
   * refused 400. Never set on agency-scoped collection routes — the
   * 2.11 test asserts those still refuse 400 without a selector.
   */
  allowPlatformAdminAll?: boolean
}

/**
 * Require an agency capability while preserving the platform admin bypass.
 * Admin requests may supply an agency selector; agency owners and staff are
 * always resolved from their authenticated identity/membership.
 */
export const requireAnyAgencyPermission = (permissions: AgencyPermission[], options?: AgencyPermissionOptions) => async (
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
    // Wave 2.11 — a collection call must name its agency; a
    // single-resource call attributes through the resource instead
    // (the controller logs it with the resource's agency).
    const supplierIds = adminSelectorSupplierIds(req)
    if (supplierIds.length === 0 && !hasResourceIdParam(req)) {
      // Wave 2.11 fix — a route flagged allowPlatformAdminAll is
      // platform-wide by design: the admin reads the whole platform
      // with an empty agency context instead of being refused.
      if (options?.allowPlatformAdminAll) {
        req.agency = {
          supplierId: '',
          role: bookcarsTypes.AgencyRole.Owner,
        }
        next()
        return
      }
      res.status(400).send({ message: 'Agency is required' })
      return
    }
    req.agency = {
      supplierId: supplierIds[0] || '',
      role: bookcarsTypes.AgencyRole.Owner,
    }
    await logAdminCrossAgencyAccess(req, supplierIds, `agency:${permissions.join('+')}`)
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

export const requireAgencyPermission = (permission: AgencyPermission, options?: AgencyPermissionOptions) => async (
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
    // Wave 2.11 — a collection call must name its agency; a
    // single-resource call attributes through the resource instead
    // (the controller logs it with the resource's agency).
    const supplierIds = adminSelectorSupplierIds(req)
    if (supplierIds.length === 0 && !hasResourceIdParam(req)) {
      // Wave 2.11 fix — a route flagged allowPlatformAdminAll is
      // platform-wide by design: the admin reads the whole platform
      // with an empty agency context instead of being refused.
      if (options?.allowPlatformAdminAll) {
        req.agency = {
          supplierId: '',
          role: bookcarsTypes.AgencyRole.Owner,
        }
        next()
        return
      }
      res.status(400).send({ message: 'Agency is required' })
      return
    }
    req.agency = {
      supplierId: supplierIds[0] || '',
      role: bookcarsTypes.AgencyRole.Owner,
    }
    await logAdminCrossAgencyAccess(req, supplierIds, `agency:${permission}`)
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
