import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import User from '../models/User'
import Invoice from '../models/Invoice'
import RentalPayment from '../models/RentalPayment'
import Counter from '../models/Counter'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'
import { recomputeInvoicePayment } from '../utils/invoicePayment'
import { approvalRequiredFor, findLatestApproval, produceApprovalRequest } from '../utils/approvalProducer'
import { renderInvoicePdf } from '../utils/invoicePdf'
import { createInvoiceForBooking, InvoiceCreationError } from '../utils/invoiceCreation'

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
    const booking = await Booking.findOne({ _id: bookingId, supplier: supplierId }).select('_id supplier price financialSnapshot status deletedAt')
    if (!booking || [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled].includes(booking.status)) {
 res.status(404).send('Contract not found'); return
}
    // GA-PAR-22: no invoice may be created for a trashed booking.
    if (booking.deletedAt) {
 res.status(409).send('TRASHED: This booking is trashed and cannot be modified. Restore it first.'); return
}
    // GA-PAR-05: creation itself lives in the shared util
    // (utils/invoiceCreation) so the manual endpoint, the booking
    // auto-draft hook and quote conversion share ONE path — the PAR-01
    // tax behaviour and the one-active guard exist exactly once. The
    // explicit-tax detection below is the original controller semantics:
    // an own-property taxAmount on the body is the manual override.
    const hasExplicitTax = !!req.body
      && Object.prototype.hasOwnProperty.call(req.body, 'taxAmount')
      && req.body.taxAmount !== undefined
      && req.body.taxAmount !== null
      && req.body.taxAmount !== ''
    let invoice
    try {
      invoice = await createInvoiceForBooking(
        { _id: booking._id, supplier: booking.supplier, price: booking.price, financialSnapshot: booking.financialSnapshot, status: booking.status },
        hasExplicitTax ? { taxAmount: req.body.taxAmount } : {},
      )
    } catch (creationErr) {
      if (creationErr instanceof InvoiceCreationError && creationErr.code === 'ACTIVE_INVOICE_EXISTS') {
 res.status(409).send('An active invoice already exists for this contract'); return
}
      if (creationErr instanceof InvoiceCreationError && creationErr.code === 'INVALID_TAX') {
 res.status(400).send('Invalid tax amount'); return
}
      throw creationErr
    }
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
    // GA-PAR-22: a draft invoice on a trashed booking cannot be
    // issued — restore the booking first. (Void stays allowed: it is
    // fiscal close-out, not contract advancement.)
    const invoiceBooking = await Booking.findById(invoice.booking).select('_id deletedAt').lean()
    if (invoiceBooking?.deletedAt) {
 res.status(409).send('TRASHED: This booking is trashed and cannot be modified. Restore it first.'); return 
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
    // Approvals producer (decisions 1.1/1.2, GA-P10-DECISIONS-01): issuing
    // at or above the threshold opens a queue request. A producer failure
    // must not un-issue the invoice, so it is logged, not thrown.
    if (approvalRequiredFor(invoice.total)) {
      try {
        await produceApprovalRequest({
          supplier: invoice.supplier,
          subjectType: 'invoice',
          subject: invoice._id.toString(),
          amount: invoice.total,
          currency: invoice.currency,
          requestedBy: invoice.issuedBy,
          reason: `Invoice ${invoice.number} issued`,
        })
      } catch (producerErr) {
        logger.error('[invoice.issue] approval producer failed', producerErr)
      }
    }
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
    // GA-PAR-22: no payment may be recorded against an invoice of a
    // trashed booking — restore the booking first.
    const recordBooking = await Booking.findById(invoice.booking).select('_id deletedAt').lean()
    if (recordBooking?.deletedAt) {
 res.status(409).send('TRASHED: This booking is trashed and cannot be modified. Restore it first.'); return 
}
    // Blocking effect (decision 1.5): an invoice at or above the approval
    // threshold cannot take payments while its request is pending, and a
    // rejected request stops it.
    const gate = await findLatestApproval(invoice.supplier, 'invoice', invoice._id.toString())
    if (gate && gate.status === bookcarsTypes.ApprovalDecision.Pending) {
 res.status(409).send('Invoice approval is pending'); return 
}
    if (gate && gate.status === bookcarsTypes.ApprovalDecision.Rejected) {
 res.status(409).send('Invoice approval was rejected'); return 
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


export const getInvoicePdf = async (req: Request, res: Response) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, ...scope(req) })
    if (!invoice) {
 res.sendStatus(404); return
}
    // GA-PAR-03 coordinator decision: the PDF is an issued fiscal document.
    // Drafts have no number yet and voided invoices are cancelled, so both
    // are refused with 409 rather than rendered.
    if (invoice.status !== bookcarsTypes.InvoiceStatus.Issued) {
 res.status(409).send('Invoice PDF is available only for issued invoices'); return
}
    const [supplier, booking] = await Promise.all([
      User.findById(invoice.supplier)
        .select('fullName email phone ice registreCommerce identifiantFiscal patente rib fiscalAddress city')
        .lean(),
      Booking.findById(invoice.booking)
        .populate([
          { path: 'driver', select: 'fullName email phone cinNumber' },
          { path: 'car', select: 'name licensePlate' },
        ])
        .lean(),
    ])
    const buffer = await renderInvoicePdf({
      invoice: invoice.toObject(),
      supplier: supplier as never,
      booking: booking as never,
    })
    res.type('application/pdf')
      .set('Cache-Control', 'private, no-store')
      .set('Content-Disposition', `attachment; filename="invoice-${invoice.number || invoice._id}.pdf"`)
      .send(buffer)
  } catch (err) {
 logger.error('[invoice.getInvoicePdf]', err); res.status(400).send(i18n.t('ERROR'))
}
}
