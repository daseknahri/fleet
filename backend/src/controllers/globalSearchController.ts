import mongoose from 'mongoose'
import escapeStringRegexp from 'escape-string-regexp'
import { Request, Response } from 'express'
import * as bookcarsTypes from ':bookcars-types'
import i18n from '../lang/i18n'
import Booking from '../models/Booking'
import Car from '../models/Car'
import User from '../models/User'
import * as logger from '../utils/logger'
import { AgencyPermission, agencySupplierId, hasAgencyPermission } from '../utils/agencyAuthorization'
import { notTemporaryBookingFilter } from '../utils/bookingReservationHelper'

/**
 * GA-Q4-2 (#52) — agency-scoped global search (read-only).
 *
 * One keyword across the three list surfaces the admin top bar needs:
 * bookings by reference / client name, cars by name (make + model) /
 * license plate, clients by name / email / CIN. Results are grouped
 * (bookings / cars / clients) with a small per-group cap.
 *
 * Agency scope is enforced exactly like the list endpoints:
 * - Supplier / Staff callers are pinned to the agency resolved from
 *   their authenticated identity/membership; any `suppliers` payload
 *   they send is ignored, so a guessed reference / plate / name from
 *   another agency can never match.
 * - Platform-admin callers pass the agencies explicitly (`suppliers`),
 *   exactly as `getBookings` / `getCars` accept them; a missing or
 *   empty list is a 400.
 * - Each group is returned only when the caller's agency role holds
 *   that group's list-read capability (ReadBookings / ReadFleet /
 *   ReadClients); a group the caller may not list comes back empty.
 *   The route gate already requires at least one of the three.
 * - Only live rows are searched (`deletedAt: null`, `expireAt: null`),
 *   matching the PAR-22 live-list rule; trashed rows never surface.
 * - A blank keyword returns empty groups (never a full-table dump).
 */
export const globalSearch = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.GlobalSearchPayload } = req
    const rawKeyword = typeof body?.keyword === 'string' ? body.keyword : ''
    const keyword = rawKeyword.trim()

    if (keyword.length > bookcarsTypes.GLOBAL_SEARCH_MAX_KEYWORD_LENGTH) {
      res.status(400).send('Invalid keyword')
      return
    }

    const empty: bookcarsTypes.GlobalSearchResult = { bookings: [], cars: [], clients: [] }
    if (!keyword) {
      res.json(empty)
      return
    }

    // begin of security check (same shape as booking.getBookings)
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    if (!sessionUser) {
      logger.error(`[globalSearch] Unauthorized attempt to search by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot search')
      return
    }

    let suppliers: mongoose.Types.ObjectId[]
    if (sessionUser.type === bookcarsTypes.UserType.Admin) {
      const ids = Array.isArray(body?.suppliers) ? body.suppliers.filter((id) => mongoose.isValidObjectId(id)) : []
      if (ids.length === 0) {
        res.status(400).send('Agency is required')
        return
      }
      suppliers = ids.map((id) => new mongoose.Types.ObjectId(id))
    } else {
      // Supplier / Staff: the agency comes from the authenticated
      // identity/membership only — the body cannot widen the scope.
      const supplierId = agencySupplierId(req)
      if (!supplierId) {
        res.status(403).send('Agency membership is required')
        return
      }
      suppliers = [new mongoose.Types.ObjectId(supplierId)]
    }
    // end of security check

    const pattern = escapeStringRegexp(keyword)
    const options = 'i'
    const limit = bookcarsTypes.GLOBAL_SEARCH_PER_GROUP_LIMIT
    const result: bookcarsTypes.GlobalSearchResult = { bookings: [], cars: [], clients: [] }

    // Bookings: reference, or client (driver) name.
    if (hasAgencyPermission(req.agency, AgencyPermission.ReadBookings)) {
      const drivers = await User
        .find({
          type: bookcarsTypes.UserType.User,
          supplier: { $in: suppliers },
          deletedAt: null,
          expireAt: null,
          fullName: { $regex: pattern, $options: options },
        })
        .select('_id')
        .limit(100)
        .lean()
      const bookings = await Booking
        .find({
          supplier: { $in: suppliers },
          deletedAt: null,
          // GAP-C1/M1 — a pay-later hold carries `expireAt` and must
          // stay searchable; only Void placeholders are excluded.
          $and: [
            notTemporaryBookingFilter(),
            {
              $or: [
                { reference: { $regex: pattern, $options: options } },
                { driver: { $in: drivers.map((d) => d._id) } },
              ],
            },
          ],
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('driver', 'fullName')
        .lean()
      result.bookings = bookings.map((booking) => {
        const driver = booking.driver as unknown as { fullName?: string } | null
        const from = booking.from ? new Date(booking.from as unknown as string).toISOString().slice(0, 10) : ''
        return {
          id: booking._id.toString(),
          label: booking.reference || booking._id.toString(),
          subtitle: driver?.fullName ? `${driver.fullName}${from ? ` · ${from}` : ''}` : from,
          link: `/update-booking?b=${booking._id.toString()}`,
        }
      })
    }

    // Cars: name (make + model) or license plate.
    if (hasAgencyPermission(req.agency, AgencyPermission.ReadFleet)) {
      const cars = await Car
        .find({
          supplier: { $in: suppliers },
          deletedAt: null,
          $or: [
            { name: { $regex: pattern, $options: options } },
            { licensePlate: { $regex: pattern, $options: options } },
          ],
        })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean()
      result.cars = cars.map((car) => ({
        id: car._id.toString(),
        label: car.name,
        subtitle: car.licensePlate || '',
        link: `/update-car?cr=${car._id.toString()}`,
      }))
    }

    // Clients: name, email or CIN number.
    if (hasAgencyPermission(req.agency, AgencyPermission.ReadClients)) {
      const clients = await User
        .find({
          type: bookcarsTypes.UserType.User,
          supplier: { $in: suppliers },
          deletedAt: null,
          expireAt: null,
          $or: [
            { fullName: { $regex: pattern, $options: options } },
            { email: { $regex: pattern, $options: options } },
            { cinNumber: { $regex: pattern, $options: options } },
          ],
        })
        .sort({ fullName: 1 })
        .limit(limit)
        .lean()
      result.clients = clients.map((client) => ({
        id: client._id.toString(),
        label: client.fullName,
        subtitle: client.email,
        link: `/update-user?u=${client._id.toString()}`,
      }))
    }

    res.json(result)
  } catch (err) {
    logger.error(`[globalSearch] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
