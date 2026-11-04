import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

const schema = new Schema<env.Invoice>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  booking: { type: Schema.Types.ObjectId, required: true, ref: 'Booking', index: true },
  number: { type: String, trim: true, maxlength: 80 },
  status: { type: String, required: true, enum: Object.values(bookcarsTypes.InvoiceStatus), default: bookcarsTypes.InvoiceStatus.Draft, index: true },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  subtotal: { type: Number, required: true, min: 0 },
  taxAmount: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  paidAmount: { type: Number, required: true, min: 0, default: 0 },
  paymentStatus: { type: String, required: true, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid', index: true },
  payments: [{ type: Schema.Types.ObjectId, ref: 'RentalPayment' }],
  approvalDecision: { type: String, enum: Object.values(bookcarsTypes.ApprovalDecision) },
  approvalDecidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvalDecidedAt: Date,
  approvalNote: { type: String, maxlength: 1000, trim: true },
  issuedAt: Date,
  issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  voidedAt: Date,
  voidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  voidReason: { type: String, maxlength: 1000, trim: true },
}, { timestamps: true, strict: true, collection: 'Invoice' })

schema.index({ supplier: 1, number: 1 }, { unique: true, sparse: true })
schema.index({ supplier: 1, createdAt: -1 })
export default model<env.Invoice>('Invoice', schema)
