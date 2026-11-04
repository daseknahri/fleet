import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Invoice from '../models/Invoice'
import RentalPayment from '../models/RentalPayment'
import { currencyExponent, toMinorUnits } from './paymentAmount'

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
