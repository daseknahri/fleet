import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

/**
 * F8 / W5 N3 — delivery log for every notification send (in-app,
 * email, push), one row per recipient per channel.
 *
 * Exactly-once: the UNIQUE compound index (templateKey, subjectType,
 * subjectId, dedupeKey, channel, recipient) is the claim mechanism —
 * the sender INSERTS the row as `queued` before sending, and a
 * duplicate-key error means this exact delivery was already claimed
 * (skip silently). A row left `queued` by a crashed process is
 * re-sendable from the log's retry endpoint; a `failed` row records
 * the last error and its attempt count.
 */
const schema = new Schema<env.NotificationDelivery>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  templateKey: { type: String, required: true, index: true },
  subjectType: { type: String, trim: true },
  subjectId: { type: String, trim: true },
  dedupeKey: { type: String, required: true, trim: true },
  channel: { type: String, required: true, enum: ['inApp', 'email', 'push'] as bookcarsTypes.NotificationDeliveryChannel[] },
  recipient: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  subject: { type: String, trim: true, maxlength: 500 },
  body: { type: String, required: true, maxlength: 5000 },
  status: { type: String, required: true, enum: ['queued', 'sent', 'failed'] as bookcarsTypes.NotificationDeliveryStatus[], default: 'queued', index: true },
  attempts: { type: Number, required: true, default: 0, min: 0 },
  lastError: { type: String, trim: true, maxlength: 1000 },
  providerId: { type: String, trim: true, maxlength: 200 },
  sentAt: { type: Date },
}, { timestamps: true, strict: true, collection: 'NotificationDelivery' })

schema.index(
  { templateKey: 1, subjectType: 1, subjectId: 1, dedupeKey: 1, channel: 1, recipient: 1 },
  { unique: true, name: 'notification_delivery_dedupe' },
)
schema.index({ supplier: 1, createdAt: -1 })

export default model<env.NotificationDelivery>('NotificationDelivery', schema)
