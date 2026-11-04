import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'

const schema = new Schema({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  subject: { type: String, required: true, maxlength: 200, trim: true },
  subjectType: { type: String, required: true, maxlength: 100, trim: true },
  amount: { type: Number, min: 0 },
  currency: { type: String, uppercase: true, minlength: 3, maxlength: 3 },
  status: { type: String, required: true, enum: Object.values(bookcarsTypes.ApprovalDecision), default: bookcarsTypes.ApprovalDecision.Pending, index: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  decidedAt: Date,
  reason: { type: String, maxlength: 1000, trim: true },
}, { timestamps: true, strict: true, collection: 'Approval' })

schema.index({ supplier: 1, subjectType: 1, status: 1 })
schema.index({ supplier: 1, subject: 1, subjectType: 1 }, { name: 'approval_pending_subject', unique: true, partialFilterExpression: { status: bookcarsTypes.ApprovalDecision.Pending } })
export default model('Approval', schema)
