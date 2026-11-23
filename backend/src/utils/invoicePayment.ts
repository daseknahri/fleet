import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Invoice from '../models/Invoice'
import RentalPayment from '../models/RentalPayment'
import { currencyExponent, toMinorUnits } from './paymentAmount'
import { findActiveInvoice } from './invoiceCreation'
import { approvalRequiredFor } from './approvalPolicy'

/** Recompute an invoice from the posted rent ledger entries it links. */
export const recomputeInvoicePayment = async (
  invoiceId: mongoose.Types.ObjectId | string,
  session?: mongoose.ClientSession,
) => {
  const invoiceQuery = Invoice.findById(invoiceId)
  if (session) {
invoiceQuery.session(session)
}
  const invoice = await invoiceQuery
  if (!invoice) {
return null
}

  const paymentQuery = RentalPayment.find({
    _id: { $in: invoice.payments || [] },
    purpose: { $in: [bookcarsTypes.RentalPaymentPurpose.Rent, null] },
  }).select('amount direction status currency purpose')
  if (session) {
paymentQuery.session(session)
}
  const linked = await paymentQuery
  const paidMinor = linked.reduce((sum, item) => {
    if (item.status !== bookcarsTypes.RentalPaymentStatus.Posted) {
return sum
}
    if ((item.currency || invoice.currency).toUpperCase() !== invoice.currency.toUpperCase()) {
return sum
}
    const value = toMinorUnits(item.amount, invoice.currency)
    return item.direction === bookcarsTypes.RentalPaymentDirection.Debit ? sum - value : sum + value
  }, 0)
  const exponent = currencyExponent(invoice.currency)
  invoice.paidAmount = Number((paidMinor / (10 ** exponent)).toFixed(exponent))
  const totalMinor = toMinorUnits(invoice.total, invoice.currency)
  invoice.paymentStatus = paidMinor >= totalMinor ? 'paid' : paidMinor > 0 ? 'partial' : 'unpaid'
  await invoice.save(session ? { session } : undefined)
  return invoice
}
/**
 * GA5 - a posted rent payment belongs on the booking's issued invoice.
 *
 * Root cause of the paidAmount-0 gap: recomputeInvoicePayment only sums
 * the payments listed in invoice.payments, and the ONLY writer of that
 * list was the manual invoice recordPayment endpoint - a rent payment
 * posted through the ledger (Payments page, provider checkout) never
 * linked, so the invoice stayed "unpaid" while the booking went Paid.
 *
 * Guards mirror recordPayment (invoiceController.ts) and stay
 * conservative: only a Posted, rent-purpose, same-currency payment;
 * only the booking's active Issued invoice; never above the approval
 * threshold (those links stay manual, under the approval gate);
 * never linked to another live invoice. Best-effort by design: the
 * caller logs a failure and the ledger posting already succeeded.
 */
export const linkPostedRentPaymentToInvoice = async (payment: {
  _id: mongoose.Types.ObjectId | string
  booking: mongoose.Types.ObjectId | string
  supplier: mongoose.Types.ObjectId | string
  purpose?: bookcarsTypes.RentalPaymentPurpose | null
  status?: string
  currency?: string
}) => {
  if (payment.status !== bookcarsTypes.RentalPaymentStatus.Posted) {
    return null
  }
  if (payment.purpose && payment.purpose !== bookcarsTypes.RentalPaymentPurpose.Rent) {
    return null
  }
  const invoice = await findActiveInvoice(payment.booking, payment.supplier)
  if (!invoice || invoice.status !== bookcarsTypes.InvoiceStatus.Issued) {
    return null
  }
  if ((payment.currency || '').toUpperCase() !== (invoice.currency || '').toUpperCase()) {
    return null
  }  // Above the approval threshold the manual link (with its approval
  // gate) still owns the link - auto-link never bypasses it.
  if (approvalRequiredFor(invoice.total)) {
    return null
  }
  const paymentId = payment._id.toString()
  if ((invoice.payments || []).some((item) => item.toString() === paymentId)) {
    return recomputeInvoicePayment(invoice._id)
  }
  const linkedElsewhere = await Invoice.findOne({ _id: { $ne: invoice._id }, payments: payment._id, status: { $ne: bookcarsTypes.InvoiceStatus.Voided } }).select('_id')
  if (linkedElsewhere) {
    return null
  }
  invoice.payments = [...(invoice.payments || []), payment._id as mongoose.Types.ObjectId]
  await invoice.save()
  return recomputeInvoicePayment(invoice._id)
}