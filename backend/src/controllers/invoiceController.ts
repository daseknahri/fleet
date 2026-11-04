import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import Invoice from '../models/Invoice'
import RentalPayment from '../models/RentalPayment'
import Counter from '../models/Counter'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'
import { currencyExponent, toMinorUnits } from '../utils/paymentAmount'
import { recomputeInvoicePayment } from '../utils/invoicePayment'

const scope = (req: Request) => req.user?.type === bookcarsTypes.UserType.Admin ? {} : { supplier: agencySupplierId(req) || '000000000000000000000000' }
const populate = [{ path: 'booking', populate: [{ path: 'driver', select: 'fullName email phone' }, { path: 'car', select: 'name licensePlate' }] }, { path: 'supplier', select: 'fullName' }]

export const list = async (req: Request, res: Response) => {
  try {
 res.json(await Invoice.find(scope(req)).sort({ createdAt: -1 }).populate(populate)) 
} catch (err) {
 logger.error('[invoice.list]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const create = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const supplierId = user?.type === bookcarsTypes.UserType.Admin ? req.body?.supplier : agencySupplierId(req)
    const bookingId = req.body?.booking
    if (!user || !mongoose.isValidObjectId(supplierId) || !mongoose.isValidObjectId(bookingId)) {
 res.status(400).send('Invalid invoice'); return 
}
    const booking = await Booking.findOne({ _id: bookingId, supplier: supplierId }).select('_id supplier price financialSnapshot status')
    if (!booking || [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled].includes(booking.status)) {
 res.status(404).send('Contract not found'); return 
}
    const existing = await Invoice.findOne({ booking: booking._id, supplier: supplierId, status: { $ne: bookcarsTypes.InvoiceStatus.Voided } })
    if (existing) {
 res.status(409).send('An active invoice already exists for this contract'); return 
}
    const currency = (booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
    const exponent = currencyExponent(currency)
    const subtotal = Number(Number(booking.financialSnapshot?.rentalTotal || booking.price || 0).toFixed(exponent))
    const taxAmount = Number(Number(req.body?.taxAmount || 0).toFixed(exponent))
    if (!Number.isFinite(taxAmount) || taxAmount < 0) {
 res.status(400).send('Invalid tax amount'); return 
}
    const invoice = await Invoice.create({ supplier: supplierId, booking: booking._id, status: bookcarsTypes.InvoiceStatus.Draft, currency, subtotal, taxAmount, total: (toMinorUnits(subtotal, currency) + toMinorUnits(taxAmount, currency)) / (10 ** exponent) })
    await invoice.populate(populate)
    res.status(201).json(invoice)
  } catch (err) {
 logger.error('[invoice.create]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const issue = async (req: Request, res: Response) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, ...scope(req) })
    if (!invoice) {
 res.sendStatus(404); return 
}
    if (invoice.status !== bookcarsTypes.InvoiceStatus.Draft) {
 res.status(409).send('Only draft invoices can be issued'); return 
}
    const year = new Date().getFullYear()
    const counter = await Counter.findOneAndUpdate(
      { supplier: invoice.supplier, name: 'invoice', year },
      { $inc: { value: 1 }, $setOnInsert: { supplier: invoice.supplier, name: 'invoice', year } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
    invoice.number = `GA-${year}-${String(counter.value).padStart(6, '0')}`
    invoice.status = bookcarsTypes.InvoiceStatus.Issued
    invoice.issuedAt = new Date()
    invoice.issuedBy = req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : undefined
    await invoice.save()
    await invoice.populate(populate)
    res.json(invoice)
  } catch (err) {
 logger.error('[invoice.issue]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const voidInvoice = async (req: Request, res: Response) => {
  try {
    const reason = String(req.body?.reason || '').trim()
    const invoice = await Invoice.findOne({ _id: req.params.id, ...scope(req) })
    if (!invoice || invoice.status !== bookcarsTypes.InvoiceStatus.Issued || reason.length < 3 || reason.length > 1000) {
 res.status(400).send('Invalid invoice void'); return 
}
    invoice.status = bookcarsTypes.InvoiceStatus.Voided
    invoice.voidedAt = new Date()
    invoice.voidedBy = req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : undefined
    invoice.voidReason = reason
    await invoice.save()
    res.json(invoice)
  } catch (err) {
 logger.error('[invoice.void]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const recordPayment = async (req: Request, res: Response) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, ...scope(req) })
    if (!invoice || invoice.status !== bookcarsTypes.InvoiceStatus.Issued) {
 res.status(404).send('Issued invoice not found'); return 
}
    const paymentId = req.body?.payment
    if (!mongoose.isValidObjectId(paymentId)) {
 res.status(400).send('Invalid payment'); return 
}
    const payment = await RentalPayment.findOne({ _id: paymentId, ...scope(req) })
    if (!payment || payment.booking.toString() !== invoice.booking.toString()) {
 res.status(404).send('Payment not found for this contract'); return 
}
    if (payment.purpose && payment.purpose !== bookcarsTypes.RentalPaymentPurpose.Rent) {
 res.status(400).send('Only rental payments can be linked to an invoice'); return 
}
    if (payment.currency.toUpperCase() !== invoice.currency.toUpperCase()) {
 res.status(400).send('Payment currency does not match invoice'); return 
}
    if ((invoice.payments || []).some((item) => item.toString() === payment._id.toString())) {
 res.status(409).send('Payment is already linked to this invoice'); return 
}
    const linkedElsewhere = await Invoice.findOne({ _id: { $ne: invoice._id }, payments: payment._id, status: { $ne: bookcarsTypes.InvoiceStatus.Voided } }).select('_id')
    if (linkedElsewhere) {
 res.status(409).send('Payment is already linked to another invoice'); return 
}
    invoice.payments = [...(invoice.payments || []), payment._id]
    await invoice.save()
    const updated = await recomputeInvoicePayment(invoice._id)
    if (!updated) {
 res.status(404).send('Invoice not found'); return 
}
    await updated.populate(populate)
    res.json(updated)
  } catch (err) {
    logger.error('[invoice.recordPayment]', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

