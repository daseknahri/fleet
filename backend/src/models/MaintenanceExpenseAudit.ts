import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

/**
 * F7 / W3 M-7 — append-only audit trail for maintenance expenses,
 * following the RentalPayment pattern (the payment ledger is
 * append-only; expenses now get the same treatment). `expense` is a
 * plain ObjectId — deliberately no ref — so the trail survives the
 * expense's hard delete. `changes` records the fields that actually
 * changed (before/after, dates as ISO strings); a delete records no
 * field changes, only the reason.
 */
const changeSchema = new Schema(
  {
    field: { type: String, required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
  },
  { _id: false },
)

const schema = new Schema<env.MaintenanceExpenseAudit>(
  {
    supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    expense: { type: Schema.Types.ObjectId, required: true, index: true },
    action: { type: String, required: true, enum: Object.values(bookcarsTypes.MaintenanceExpenseAuditAction), index: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, trim: true, maxlength: 1000 },
    changes: { type: [changeSchema], default: undefined },
  },
  { timestamps: true, strict: true, collection: 'MaintenanceExpenseAudit' },
)

schema.index({ supplier: 1, expense: 1, createdAt: -1 })

export default model<env.MaintenanceExpenseAudit>('MaintenanceExpenseAudit', schema)
