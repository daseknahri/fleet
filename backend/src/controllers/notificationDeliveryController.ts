import { Request, Response } from 'express'
import mongoose from 'mongoose'
import type { SendMailOptions } from 'nodemailer'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import NotificationDelivery from '../models/NotificationDelivery'
import User from '../models/User'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import * as mailHelper from '../utils/mailHelper'
import { pagedResponse, paginationSkip, parsePagination } from '../utils/pagination'
import { agencySupplierId } from '../utils/agencyAuthorization'
import { createInAppNotification, markDeliveryFailed, markDeliverySent, sendPush } from '../utils/reminderNotify'

/**
 * F8 / W5 N3 — delivery log: every notification send (in-app, email,
 * push), one row per recipient per channel, newest first.
 *
 * Agency-scoped exactly like the reminders controller: ReadReminders
 * gates the list, ManageReminders gates retry (route middleware).
 * Cross-agency rows answer 404 (the established :id-route pattern).
 * Filters: status, channel, templateKey. Pagination follows the F6
 * pattern (no page/size params → the full filtered array).
 */

const scope = (req: Request) => {
  if (req.user?.type === bookcarsTypes.UserType.Admin) {
    const requested = typeof req.query.supplier === 'string' ? req.query.supplier : undefined
    return requested && mongoose.isValidObjectId(requested) ? { supplier: requested } : {}
  }
  return { supplier: agencySupplierId(req) || '000000000000000000000000' }
}

export const list = async (req: Request, res: Response) => {
  try {
    const query: Record<string, unknown> = scope(req)
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const channel = typeof req.query.channel === 'string' ? req.query.channel : undefined
    const templateKey = typeof req.query.templateKey === 'string' ? req.query.templateKey : undefined
    if (status && ['queued', 'sent', 'failed'].includes(status)) {
      query.status = status
    }
    if (channel && ['inApp', 'email', 'push'].includes(channel)) {
      query.channel = channel
    }
    if (templateKey) {
      query.templateKey = templateKey
    }
    const parsed = parsePagination(req)
    if ('error' in parsed) {
      res.status(400).send(parsed.error)
      return
    }
    const total = await NotificationDelivery.countDocuments(query)
    let cursor = NotificationDelivery.find(query).sort({ createdAt: -1 }).lean()
    if (parsed.pagination) {
      cursor = cursor.skip(paginationSkip(parsed.pagination)).limit(parsed.pagination.size)
    }
    const rows = await cursor
    if (parsed.pagination) {
      res.json(pagedResponse(rows, total, parsed.pagination))
      return
    }
    res.json(rows)
  } catch (err) {
    logger.error('[notificationDelivery.list]', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Retry one delivery over its stored channel, using the stored
 * subject/body (the retry never re-renders the template: the text the
 * user sees is the text that failed). A row already `sent` answers
 * 400. A row left `queued` by a crashed process retries the same way.
 */
export const retry = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.sendStatus(404)
      return
    }
    const row = await NotificationDelivery.findOne({ _id: req.params.id, ...scope(req) })
    if (!row) {
      res.sendStatus(404)
      return
    }
    if (row.status === 'sent') {
      res.status(400).send('Delivery already sent')
      return
    }
    const recipient = await User.findById(row.recipient)
    if (!recipient) {
      await markDeliveryFailed(row._id, 'Recipient not found')
      res.status(400).send('Recipient not found')
      return
    }
    try {
      if (row.channel === 'email') {
        if (!recipient.email) {
          throw new Error('Recipient has no email address')
        }
        const mailOptions: SendMailOptions = {
          from: env.SMTP_FROM,
          to: recipient.email,
          subject: row.subject || row.body,
          html: `<p>Hello ${recipient.fullName},<br><br>${row.body}<br><br>Regards<br></p>`,
        }
        const info = await mailHelper.sendMail(mailOptions)
        await markDeliverySent(row._id, info?.messageId as string | undefined)
      } else if (row.channel === 'inApp') {
        await createInAppNotification(recipient._id, row.body)
        await markDeliverySent(row._id)
      } else if (row.channel === 'push') {
        if (!(await sendPush(recipient, row.body, undefined))) {
          throw new Error('Push not delivered')
        }
        await markDeliverySent(row._id)
      } else {
        res.status(400).send('Unknown channel')
        return
      }
    } catch (err) {
      await markDeliveryFailed(row._id, err)
      res.status(400).send('Delivery failed')
      return
    }
    const updated = await NotificationDelivery.findById(row._id).lean()
    res.json(updated)
  } catch (err) {
    logger.error('[notificationDelivery.retry]', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
