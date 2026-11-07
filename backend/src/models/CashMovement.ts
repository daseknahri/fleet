import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

const schema = new Schema<env.CashMovement>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  session: { type: Schema.Types.ObjectId, required: true, ref: 'CashSession', index: true },
  account: { type: String, required: true, enum: Object.values(bookcarsTypes.CashAccountType) },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  date: { type: Date, required: true, index: true },
  direction: { type: String, required: true, enum: Object.values(bookcarsTypes.CashMovementDirection) },
  amount: { type: Number, required: true, min: 0.01 },
  source: { type: String, required: true, enum: Object.values(bookcarsTypes.CashMovementSource), default: bookcarsTypes.CashMovementSource.Manual },
  // Counter-agent entries are recorded as 'pending' and only count toward
  // session balances once an accountant or above confirms them (owner
  // decision 1.5, GA-P10-DECISIONS-01). Movements written before this field
  // existed carry no status and are treated as confirmed.
  status: { type: String, required: true, enum: ['pending', 'confirmed'], default: 'confirmed' },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: Date,
  idempotencyKey: { type: String, maxlength: 200, trim: true },
  transferId: { type: Schema.Types.ObjectId, ref: 'CashMovement', index: true },
  reference: { type: String, maxlength: 160, trim: true },
  note: { type: String, maxlength: 1000, trim: true },
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, strict: true, collection: 'CashMovement' })

schema.index({ idempotencyKey: 1 }, { unique: true, sparse: true })
schema.index({ supplier: 1, account: 1, date: -1 })
schema.index({ session: 1, date: 1 })

export default model<env.CashMovement>('CashMovement', schema)
