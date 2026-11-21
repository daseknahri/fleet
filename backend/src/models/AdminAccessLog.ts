import { Schema, model } from 'mongoose'
import * as env from '../config/env.config'

/**
 * Wave 2.11 — platform-admin cross-agency access audit. One row per
 * (actor, agency, action): who acted, in which agency, doing what,
 * and when. Append-only; written best-effort by the agency
 * middleware, so a logging failure never refuses the call it audits.
 * No TTL: the audit trail is kept until an operator prunes it.
 */
const schema = new Schema<env.AdminAccessLog>(
  {
    actor: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    agency: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    action: { type: String, required: true, maxlength: 200, trim: true },
    method: { type: String, maxlength: 10, trim: true },
    path: { type: String, maxlength: 500, trim: true },
  },
  { timestamps: true, strict: true, collection: 'AdminAccessLog' },
)

schema.index({ agency: 1, createdAt: -1 })
schema.index({ actor: 1, createdAt: -1 })

const AdminAccessLog = model<env.AdminAccessLog>('AdminAccessLog', schema)

export default AdminAccessLog
