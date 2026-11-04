import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

const schema = new Schema<env.CashSession>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  account: { type: String, required: true, enum: Object.values(bookcarsTypes.CashAccountType) },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  openedAt: { type: Date, required: true, index: true },
  openedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  openingBalance: { type: Number, required: true, min: 0 },
  status: { type: String, required: true, enum: Object.values(bookcarsTypes.CashSessionStatus), default: bookcarsTypes.CashSessionStatus.Open, index: true },
  closedAt: Date,
  closedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  expectedClosingBalance: { type: Number, min: 0 },
  countedClosingBalance: { type: Number, min: 0 },
  discrepancy: Number,
  closingNote: { type: String, maxlength: 1000, trim: true },
}, { timestamps: true, strict: true, collection: 'CashSession' })

schema.index({ supplier: 1, account: 1, status: 1 }, { partialFilterExpression: { status: bookcarsTypes.CashSessionStatus.Open }, unique: true })
schema.index({ supplier: 1, openedAt: -1 })

export default model<env.CashSession>('CashSession', schema)
