import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import AgencyMembership from '../models/AgencyMembership'
import User from '../models/User'
import * as authHelper from '../utils/authHelper'
import * as helper from '../utils/helper'
import * as logger from '../utils/logger'
import { AgencyPermission, isStaffRole, rolePermissions, validateAgencyOwner } from '../utils/agencyAuthorization'

const publicUserFields = '_id fullName email phone type active verified language avatar'

/**
 * The caller's own agency context and effective permissions.
 *
 * H-038: the admin UI gates write actions on exactly the permissions the
 * backend enforces, so the matrix stays single-sourced here — this endpoint
 * returns the caller's role plus the permission list computed from
 * `rolePermissions`. Platform admins and agency owners hold every
 * permission, mirroring the bypass in the agency middleware. For staff,
 * `verifyToken` has already resolved the single active membership onto
 * `req.agency`.
 */
export const me = async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).send({ message: 'Unauthorized!' })
    return
  }

  if (req.user.type === bookcarsTypes.UserType.User) {
    res.status(403).send({ message: 'Agency access required' })
    return
  }

  if (req.user.type === bookcarsTypes.UserType.Admin) {
    res.json({
      supplier: null,
      role: bookcarsTypes.AgencyRole.Owner,
      permissions: Object.values(AgencyPermission),
    })
    return
  }

  if (req.user.type === bookcarsTypes.UserType.Supplier) {
    res.json({
      supplier: req.user._id,
      role: bookcarsTypes.AgencyRole.Owner,
      permissions: Object.values(AgencyPermission),
    })
    return
  }

  if (!req.agency) {
    res.status(403).send({ message: 'Agency access required' })
    return
  }

  res.json({
    supplier: req.agency.supplierId,
    role: req.agency.role,
    permissions: [...(rolePermissions[req.agency.role] || [])],
  })
}

const getSupplierId = (req: Request) => req.params.supplierId

const sendError = (res: Response, status: number, message: string) => {
  res.status(status).send(message)
}


/** List memberships for the authenticated user's current agency. */
export const current = async (req: Request, res: Response) => {
  const supplierId = req.agency?.supplierId || (req.user?.type === bookcarsTypes.UserType.Supplier ? req.user._id : undefined)
  if (!supplierId) {
    sendError(res, 400, 'Current agency is unavailable')
    return
  }

  try {
    if (!(await validateAgencyOwner(supplierId))) {
      sendError(res, 400, 'Invalid agency')
      return
    }

    const memberships = await AgencyMembership.find({ supplier: supplierId })
      .sort({ createdAt: -1, _id: 1 })
      .populate('user', publicUserFields)
      .lean()

    res.json(memberships.map((membership) => ({
      _id: membership._id,
      supplier: membership.supplier,
      role: membership.role,
      status: membership.status,
      invitedBy: membership.invitedBy,
      activatedAt: membership.activatedAt,
      suspendedAt: membership.suspendedAt,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
      user: membership.user,
    })))
  } catch (err) {
    logger.error('[agencyMembership.current] Failed to list memberships', err)
    res.status(400).send('Unable to list agency memberships')
  }
}

/** List the agency's staff memberships without exposing credentials or identity documents. */
export const list = async (req: Request, res: Response) => {
  const supplierId = getSupplierId(req)
  try {
    if (!(await validateAgencyOwner(supplierId))) {
      sendError(res, 400, 'Invalid agency')
      return
    }

    const memberships = await AgencyMembership.find({ supplier: supplierId })
      .sort({ createdAt: -1, _id: 1 })
      .populate('user', publicUserFields)
      .lean()

    res.json(memberships.map((membership) => ({
      _id: membership._id,
      supplier: membership.supplier,
      role: membership.role,
      status: membership.status,
      invitedBy: membership.invitedBy,
      activatedAt: membership.activatedAt,
      suspendedAt: membership.suspendedAt,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
      user: membership.user,
    })))
  } catch (err) {
    logger.error('[agencyMembership.list] Failed to list memberships', err)
    res.status(400).send('Unable to list agency memberships')
  }
}

/**
 * Create an active staff membership. Existing staff users may be linked by ID;
 * otherwise the owner provisions a staff login with an explicit password.
 */
export const create = async (req: Request, res: Response) => {
  const supplierId = getSupplierId(req)
  const body: bookcarsTypes.CreateAgencyMembershipPayload = req.body || {}
  let createdStaffUserId: mongoose.Types.ObjectId | undefined
  let membershipSaved = false

  const cleanupCreatedUser = async () => {
    if (createdStaffUserId && !membershipSaved) {
      try {
        await User.deleteOne({ _id: createdStaffUserId, type: bookcarsTypes.UserType.Staff })
      } catch (cleanupErr) {
        logger.error('[agencyMembership.create] Failed to clean up unlinked staff user', cleanupErr)
      }
    }
  }

  try {
    if (!(await validateAgencyOwner(supplierId))) {
      sendError(res, 400, 'Invalid agency')
      return
    }
    if (!isStaffRole(body.role)) {
      sendError(res, 400, 'A staff role is required')
      return
    }
    if (body.user && !helper.isValidObjectId(body.user)) {
      sendError(res, 400, 'Invalid staff user')
      return
    }

    let staffUser: env.User | null = null
    if (body.user) {
      staffUser = await User.findOne({ _id: body.user, type: bookcarsTypes.UserType.Staff })
      if (!staffUser) {
        sendError(res, 404, 'Staff user not found')
        return
      }
    } else {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
      if (!helper.isValidEmail(email) || fullName.length < 2 || typeof body.password !== 'string' || body.password.length < 6) {
        sendError(res, 400, 'Email, full name and a password of at least 6 characters are required')
        return
      }
      if (await User.exists({ email })) {
        sendError(res, 409, 'A user with this email already exists')
        return
      }
      staffUser = new User({
        email,
        fullName,
        password: await authHelper.hashPassword(body.password),
        language: env.DEFAULT_LANGUAGE,
        type: bookcarsTypes.UserType.Staff,
        active: true,
        verified: true,
        blacklisted: false,
      })
      await staffUser.save()
      createdStaffUserId = staffUser._id
    }

    if (staffUser._id.toString() === supplierId) {
      await cleanupCreatedUser()
      sendError(res, 400, 'The agency owner cannot be a staff member')
      return
    }

    const activeElsewhere = await AgencyMembership.exists({
      user: staffUser._id,
      status: bookcarsTypes.AgencyMembershipStatus.Active,
      supplier: { $ne: supplierId },
    })
    if (activeElsewhere) {
      await cleanupCreatedUser()
      sendError(res, 409, 'Staff user already has an active agency membership')
      return
    }

    const existing = await AgencyMembership.findOne({ supplier: supplierId, user: staffUser._id })
    if (existing) {
      await cleanupCreatedUser()
      sendError(res, 409, 'This staff user is already linked to the agency')
      return
    }

    const membership = new AgencyMembership({
      supplier: new mongoose.Types.ObjectId(supplierId),
      user: staffUser._id,
      role: body.role,
      status: bookcarsTypes.AgencyMembershipStatus.Active,
      invitedBy: req.user?._id,
      activatedAt: new Date(),
    })
    await membership.save()
    membershipSaved = true

    res.status(201).json({
      _id: membership._id,
      supplier: membership.supplier,
      user: {
        _id: staffUser._id,
        fullName: staffUser.fullName,
        email: staffUser.email,
        type: staffUser.type,
        active: staffUser.active,
      },
      role: membership.role,
      status: membership.status,
      activatedAt: membership.activatedAt,
    })
  } catch (err) {
    if (createdStaffUserId && !membershipSaved) {
      try {
        await User.deleteOne({ _id: createdStaffUserId, type: bookcarsTypes.UserType.Staff })
      } catch (cleanupErr) {
        logger.error('[agencyMembership.create] Failed to clean up unlinked staff user', cleanupErr)
      }
    }
    logger.error('[agencyMembership.create] Failed to create membership', err)
    res.status(400).send('Unable to create agency membership')
  }
}

/** Change a staff role or suspend/reactivate the membership. */
export const update = async (req: Request, res: Response) => {
  const { supplierId, membershipId } = req.params
  const body: bookcarsTypes.UpdateAgencyMembershipPayload = req.body || {}

  try {
    if (!mongoose.isValidObjectId(supplierId) || !mongoose.isValidObjectId(membershipId)) {
      sendError(res, 400, 'Invalid membership reference')
      return
    }
    if (body.role !== undefined && !isStaffRole(body.role)) {
      sendError(res, 400, 'Invalid staff role')
      return
    }
    if (body.status !== undefined && ![
      bookcarsTypes.AgencyMembershipStatus.Active,
      bookcarsTypes.AgencyMembershipStatus.Suspended,
    ].includes(body.status)) {
      sendError(res, 400, 'Membership invitations are not implemented')
      return
    }

    const membership = await AgencyMembership.findOne({ _id: membershipId, supplier: supplierId })
    if (!membership) {
      res.sendStatus(404)
      return
    }

    const staffUser = await User.findOne({ _id: membership.user, type: bookcarsTypes.UserType.Staff }).select('_id active')
    if (!staffUser) {
      sendError(res, 409, 'Membership target is not a staff account')
      return
    }

    // H-023 (hardening Wave 4): reactivation must enforce the same
    // single-active-agency invariant as create. Without this check an owner
    // could reactivate a membership while the staff user is active in another
    // agency, leaving the account with two active memberships — a state
    // verifyToken rejects outright, locking the staff user out completely.
    if (body.status === bookcarsTypes.AgencyMembershipStatus.Active
      && membership.status !== bookcarsTypes.AgencyMembershipStatus.Active) {
      const activeElsewhere = await AgencyMembership.exists({
        user: membership.user,
        status: bookcarsTypes.AgencyMembershipStatus.Active,
        supplier: { $ne: supplierId },
      })
      if (activeElsewhere) {
        sendError(res, 409, 'Staff user already has an active agency membership')
        return
      }
    }

    if (body.role !== undefined) {
      membership.role = body.role
    }
    if (body.status !== undefined) {
      membership.status = body.status
      if (body.status === bookcarsTypes.AgencyMembershipStatus.Active) {
        membership.activatedAt = new Date()
        membership.suspendedAt = undefined
      } else if (body.status === bookcarsTypes.AgencyMembershipStatus.Suspended) {
        membership.suspendedAt = new Date()
      }
    }
    await membership.save()

    const publicStaffUser = await User.findById(membership.user).select(publicUserFields).lean()
    res.json({ ...membership.toObject(), user: publicStaffUser })
  } catch (err) {
    logger.error('[agencyMembership.update] Failed to update membership', err)
    res.status(400).send('Unable to update agency membership')
  }
}
