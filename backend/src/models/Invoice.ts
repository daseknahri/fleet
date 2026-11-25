import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

const deliverySchema = new Schema(
  {
    channel: { type: String, required: true, enum: Object.values(bookcarsTypes.InvoiceDeliveryChannel) },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
)

const unlinkLogSchema = new Schema(
  {
    payment: { type: Schema.Types.ObjectId, required: true, ref: 'RentalPayment' },
    reason: { type: String, required: true, maxlength: 1000, trim: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
)

const schema = new Schema<env.Invoice>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  booking: { type: Schema.Types.ObjectId, required: true, ref: 'Booking', index: true },
  number: { type: String, trim: true, maxlength: 80 },
  status: { type: String, required: true, enum: Object.values(bookcarsTypes.InvoiceStatus), default: bookcarsTypes.InvoiceStatus.Draft, index: true },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  subtotal: { type: Number, required: true, min: 0 },
  taxAmount: { type: Number, required: true, min: 0 },
  taxRate: { type: Number, min: 0, max: 100, default: null },
  // F7 / W3 B-3 — true when the tax was set by an explicit override
  // (manual taxAmount, or a quote's verbatim tax) rather than computed
  // from the supplier's configured VAT rate. The HT-vs-TTC basis is
  // still an open ADR-001 decision; the flag only records provenance.
  taxOverride: { type: Boolean, default: false },
  total: { type: Number, required: true, min: 0 },
  paidAmount: { type: Number, required: true, min: 0, default: 0 },
  paymentStatus: { type: String, required: true, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid', index: true },
  payments: [{ type: Schema.Types.ObjectId, ref: 'RentalPayment' }],
  // F7 / W3 B-2 — snapshot of the paid state at void time (the live
  // paidAmount / paymentStatus / payments are cleared on void, so no
  // stale paid status remains on a cancelled document).
  voidedPaidAmount: { type: Number, min: 0 },
  voidedPaymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid'] },
  // F7 / W3 B-4 — delivery log (status tracking only, no sending).
  deliveries: { type: [deliverySchema], default: undefined },
  // F7 / W3 B-5 — log of payments unlinked from this invoice.
  unlinkLog: { type: [unlinkLogSchema], default: undefined },
  approvalDecision: { type: String, enum: Object.values(bookcarsTypes.ApprovalDecision) },
  approvalDecidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvalDecidedAt: Date,
  approvalNote: { type: String, maxlength: 1000, trim: true },
  issuedAt: Date,
  issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  voidedAt: Date,
  voidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  voidReason: { type: String, maxlength: 1000, trim: true },
  // GH-25 - fiscal-identity snapshot taken at issue time. An issued invoice
  // is a fiscal document: its identity must not change when the supplier
  // later edits their profile. Values copied byte-identical from the
  // supplier record (User.ice / registreCommerce / identifiantFiscal /
  // patente / rib / fiscalAddress / city); absent values stay absent -
  // the PDF already renders only set values (invoicePdf.ts:136-141).
  fiscalIdentity: {
    ice: { type: String, trim: true, maxlength: 50 },
    registreCommerce: { type: String, trim: true, maxlength: 100 },
    identifiantFiscal: { type: String, trim: true, maxlength: 50 },
    patente: { type: String, trim: true, maxlength: 50 },
    rib: { type: String, trim: true, maxlength: 34 },
    fiscalAddress: { type: String, trim: true, maxlength: 500 },
    city: { type: String, trim: true, maxlength: 100 },
  },
}, { timestamps: true, strict: true, collection: 'Invoice' })

// GA-PAR-05 step 0: the previous unique SPARSE index indexed every draft
// (number absent/null) as (supplier, null), so a supplier could hold only
// ONE draft invoice and a second draft create failed E11000. Following the
// PAR-02 Booking-reference pattern, uniqueness is enforced only over
// documents whose number is actually a string (issued invoices): drafts
// coexist freely, issued numbers stay unique per supplier.
schema.index({ supplier: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } })
schema.index({ supplier: 1, createdAt: -1 })
export default model<env.Invoice>('Invoice', schema)
