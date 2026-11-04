import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
const schema = new Schema<env.ContractCharge>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  booking: { type: Schema.Types.ObjectId, required: true, ref: 'Booking', index: true },
  inspection: { type: Schema.Types.ObjectId, ref: 'ContractInspection' },
  type: { type: String, required: true, enum: Object.values(bookcarsTypes.ContractChargeType) },
  reason: { type: String, required: true, maxlength: 1000, trim: true },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  status: { type: String, required: true, enum: Object.values(bookcarsTypes.ApprovalDecision), default: bookcarsTypes.ApprovalDecision.Pending, index: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  decidedAt: Date,
  decisionNote: { type: String, maxlength: 1000, trim: true },
}, { timestamps: true, strict: true, collection: 'ContractCharge' })
schema.index({ supplier: 1, booking: 1, status: 1 })
export default model<env.ContractCharge>('ContractCharge', schema)
