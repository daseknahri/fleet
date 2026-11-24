import mongoose from 'mongoose'
import { Request, Response } from 'express'
import escapeStringRegexp from 'escape-string-regexp'
import AdminAccessLog from '../models/AdminAccessLog'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { parsePagination, pagedResponse, paginationSkip } from '../utils/pagination'

/**
 * GH-07 — read the platform-admin cross-agency access audit log.
 * Platform-admin only (the route enforces authAdmin): the rows name
 * every agency an admin touched, so agency staff never see them.
 *
 * Filters (all optional): agency — an agency ObjectId, or the literal
 * 'platform-wide' for rows with no agency (platform-wide reads);
 * actor — an admin user ObjectId; action — a case-insensitive
 * substring (e.g. 'car:' or 'agency:readExpenses'). Newest first;
 * actor/agency populated with fullName + email. Pagination follows
 * the finance-list convention: no page/size params returns the full
 * filtered array, with them a PagedResult { rows, total, page, size }.
 */
export const list = async (req: Request, res: Response) => {
  try {
    const parsed = parsePagination(req)
    if ('error' in parsed) {
      res.status(400).send(parsed.error)
      return
    }
    const filter: Record<string, unknown> = {}
    if (typeof req.query.agency === 'string' && req.query.agency) {
      if (req.query.agency === 'platform-wide') {
        filter.agency = null
      } else if (mongoose.isValidObjectId(req.query.agency)) {
        filter.agency = new mongoose.Types.ObjectId(req.query.agency)
      } else {
        res.status(400).send('Invalid agency filter')
        return
      }
    }
    if (typeof req.query.actor === 'string' && req.query.actor) {
      if (!mongoose.isValidObjectId(req.query.actor)) {
        res.status(400).send('Invalid actor filter')
        return
      }
      filter.actor = new mongoose.Types.ObjectId(req.query.actor)
    }
    if (typeof req.query.action === 'string' && req.query.action) {
      filter.action = { $regex: escapeStringRegexp(req.query.action), $options: 'i' }
    }
    const query = AdminAccessLog.find(filter)
      .sort({ createdAt: -1 })
      .populate('actor', 'fullName email')
      .populate('agency', 'fullName email')
    if (!parsed.pagination) {
      res.json(await query)
      return
    }
    const total = await AdminAccessLog.countDocuments(filter)
    const rows = await query.skip(paginationSkip(parsed.pagination)).limit(parsed.pagination.size)
    res.json(pagedResponse(rows, total, parsed.pagination))
  } catch (err) {
    logger.error(`[adminAccessLog.list] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
