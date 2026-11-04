import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import RentalPayment from '../models/RentalPayment'
import { LedgerError, postRentalPayment, reverseRentalPayment } from '../utils/ledger'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'

const getScope = (req: Request): Record<string, unknown> => {
  if (req.user?.type === bookcarsTypes.UserType.Admin) {
    return {}
  }
  return { supplier: agencySupplierId(req) || '000000000000000000000000' }
}
const populatedPaths = [
  { path: 'booking', populate: [{ path: 'car', select: 'name licensePlate' }, { path: 'driver', select: 'fullName email phone' }] },
  { path: 'supplier', select: 'fullName' },
]

export const list = async (req: Request, res: Response) => {
  try {
    const payments = await RentalPayment.find(getScope(req)).sort({ date: -1, createdAt: -1 }).populate(populatedPaths)
    res.json(payments)
  } catch (err) {
    logger.error(`[rentalPayment.list] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const create = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const payload = req.body as bookcarsTypes.CreateRentalPaymentPayload
    const date = new Date(payload?.date)
    const amount = Number(payload?.amount)
    const reference = String(payload?.reference || '').trim()
    const note = String(payload?.note || '').trim()
    const idempotencyKey = typeof payload?.idempotencyKey === 'string' ? payload.idempotencyKey.trim() : undefined
    const providerReference = typeof payload?.providerReference === 'string' ? payload.providerReference.trim() : undefined
    if (!user || !mongoose.isValidObjectId(payload?.booking) || Number.isNaN(date.getTime())
      || !Number.isFinite(amount) || amount <= 0
      || !Object.values(bookcarsTypes.RentalPaymentMethod).includes(payload.method)
      || (payload.purpose !== undefined && !Object.values(bookcarsTypes.RentalPaymentPurpose).includes(payload.purpose))
      || reference.length > 160 || note.length > 1000
      || (idempotencyKey !== undefined && (idempotencyKey.length < 8 || idempotencyKey.length > 200))
      || (providerReference !== undefined && providerReference.length > 200)) {
      res.status(400).send('Invalid rental payment')
      return
    }

    const supplierId = agencySupplierId(req)
    const payment = await postRentalPayment({
      bookingId: payload.booking,
      supplierId: user.type === bookcarsTypes.UserType.Admin ? undefined : supplierId,
      date,
      amount,
      currency: payload.currency,
      method: payload.method,
      purpose: payload.purpose || bookcarsTypes.RentalPaymentPurpose.Rent,
      idempotencyKey,
      providerReference,
      actorId: user._id,
      reference,
      note,
    })
    await payment.populate(populatedPaths)
    res.status(201).json(payment)
  } catch (err) {
    if (err instanceof LedgerError) {
      const status = err.code === 'BOOKING_NOT_FOUND' ? 404
        : err.code === 'DUPLICATE_IDEMPOTENCY_KEY' ? 409
          : 400
      res.status(status).send(err.message)
      return
    }
    logger.error(`[rentalPayment.create] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const reverse = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : ''
    const note = String(req.body?.note || '').trim()
    if (!user || !mongoose.isValidObjectId(req.params.id)
      || idempotencyKey.length < 8 || idempotencyKey.length > 200 || note.length > 1000) {
      res.status(400).send('Invalid rental payment reversal')
      return
    }

    const payment = await RentalPayment.findOne({ _id: req.params.id, ...getScope(req) }).select('_id')
    if (!payment) {
      res.sendStatus(404)
      return
    }

    const reversal = await reverseRentalPayment({
      paymentId: payment._id,
      actorId: user._id,
      idempotencyKey,
      note: note || undefined,
    })
    await reversal.populate(populatedPaths)
    res.status(201).json(reversal)
  } catch (err) {
    if (err instanceof LedgerError) {
      res.status(err.code === 'INVALID_REVERSAL' ? 400 : 409).send(err.message)
      return
    }
    logger.error(`[rentalPayment.reverse] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
