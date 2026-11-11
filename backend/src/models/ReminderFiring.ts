import { Schema, model } from 'mongoose'
import * as env from '../config/env.config'

/**
 * GA-PAR-13 — one claimed firing of one occurrence at one notify-ahead
 * offset. The UNIQUE compound index (reminder, occurrenceAt,
 * offsetHours) is the exactly-once mechanism: the scheduler INSERTS the
 * claim before notifying, and a duplicate-key error means another tick
 * (or a pre-restart process) already fired this offset — skip silently.
 * Rows are append-only; deleting a reminder removes its rows with it.
 */
const schema = new Schema<env.ReminderFiring>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  reminder: { type: Schema.Types.ObjectId, required: true, ref: 'Reminder', index: true },
  occurrenceAt: { type: Date, required: true },
  offsetHours: { type: Number, required: true, min: 0, max: 720 },
  firedAt: { type: Date, required: true, default: Date.now },
  inAppCount: { type: Number, default: 0 },
  emailCount: { type: Number, default: 0 },
  pushCount: { type: Number, default: 0 },
}, { timestamps: true, strict: true, collection: 'ReminderFiring' })

schema.index({ reminder: 1, occurrenceAt: 1, offsetHours: 1 }, { unique: true })
export default model<env.ReminderFiring>('ReminderFiring', schema)
