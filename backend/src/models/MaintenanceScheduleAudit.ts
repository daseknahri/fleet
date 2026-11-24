import { Document, Schema, Types, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'

/**
 * GH-09 / gap-hunt 2026-11-24 — append-only audit trail for
 * maintenance schedules, mirroring MaintenanceExpenseAudit (F7 /
 * W3 M-7). `schedule` is a plain ObjectId — deliberately no ref — so
 * the trail survives the schedule's hard delete. A delete records no
 * field changes, only the reason. The action vocabulary is reused
 * from MaintenanceExpenseAuditAction (created/updated/deleted).
 */
export interface MaintenanceScheduleAudit extends Document {
  supplier: Types.ObjectId
  // The schedule id is kept after the schedule is deleted, so the
  // trail survives a hard delete (plain ObjectId, deliberately no ref).
  schedule: Types.ObjectId
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

const schema = new Schema<MaintenanceScheduleAudit>(
  {
    supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    schedule: { type: Schema.Types.ObjectId, required: true, index: true },
    action: { type: String, required: true, enum: Object.values(bookcarsTypes.MaintenanceExpenseAuditAction), index: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, trim: true, maxlength: 1000 },
    changes: { type: [changeSchema], default: undefined },
  },
  { timestamps: true, strict: true, collection: 'MaintenanceScheduleAudit' },
)

schema.index({ supplier: 1, schedule: 1, createdAt: -1 })

export default model<MaintenanceScheduleAudit>('MaintenanceScheduleAudit', schema)
