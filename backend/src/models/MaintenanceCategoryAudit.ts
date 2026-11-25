import { Document, Schema, Types, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'

/**
 * GH-36 / gap-hunt 2026-11-24 - append-only audit trail for
 * maintenance categories, mirroring MaintenanceScheduleAudit (GH-09).
 * `category` is a plain ObjectId - deliberately no ref - so the
 * trail survives the category's hard delete. A delete records no
 * field changes, only the reason. The action vocabulary is reused
 * from MaintenanceExpenseAuditAction (created/updated/deleted).
 */
export interface MaintenanceCategoryAudit extends Document {
  supplier: Types.ObjectId
  // The category id is kept after the category is deleted, so the
  // trail survives a hard delete (plain ObjectId, deliberately no ref).
  category: Types.ObjectId
  action: bookcarsTypes.MaintenanceExpenseAuditAction
  actor?: Types.ObjectId
  reason?: string
  changes?: Array<{ field: string, before?: string | number | null, after?: string | number | null }>
}

const changeSchema = new Schema(
  {
    field: { type: String, required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
  },
  { _id: false },
)

const schema = new Schema<MaintenanceCategoryAudit>(
  {
    supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    category: { type: Schema.Types.ObjectId, required: true, index: true },
    action: { type: String, required: true, enum: Object.values(bookcarsTypes.MaintenanceExpenseAuditAction), index: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, trim: true, maxlength: 1000 },
    changes: { type: [changeSchema], default: undefined },
  },
  { timestamps: true, strict: true, collection: 'MaintenanceCategoryAudit' },
)

schema.index({ supplier: 1, category: 1, createdAt: -1 })

export default model<MaintenanceCategoryAudit>('MaintenanceCategoryAudit', schema)