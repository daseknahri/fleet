import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

/**
 * GA-PAR-13 — agency reminder (scorecard #30).
 *
 * `nextDueAt` is the CURRENT occurrence instant (materialised by the
 * controller on create/update and advanced by the scheduler after the
 * final notify-ahead offset of an occurrence fires). It is indexed so
 * the 60 s tick query stays cheap. Exactly-once firing is NOT guarded
 * here — that is ReminderFiring's unique claim index.
 */
const schema = new Schema<env.Reminder>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  note: { type: String, trim: true, maxlength: 1000 },
  category: {
    type: String,
    required: true,
    enum: Object.values(bookcarsTypes.ReminderCategory),
    default: bookcarsTypes.ReminderCategory.Custom,
  },
  linkType: {
    type: String,
    required: true,
    enum: Object.values(bookcarsTypes.ReminderLinkType),
    default: bookcarsTypes.ReminderLinkType.None,
  },
  car: { type: Schema.Types.ObjectId, ref: 'Car' },
  client: { type: Schema.Types.ObjectId, ref: 'User' },
  recurrence: {
    kind: {
      type: String,
      required: true,
      enum: Object.values(bookcarsTypes.ReminderRecurrenceKind),
      default: bookcarsTypes.ReminderRecurrenceKind.Once,
    },
    intervalDays: { type: Number, min: 1 },
  },
  firstDueAt: { type: Date, required: true },
  notifyAheadHours: {
    type: [Number],
    default: [0],
    validate: (value: number[]) => Array.isArray(value) && value.length > 0
      && value.every((h) => Number.isInteger(h) && h >= 0 && h <= 720),
  },
  channels: {
    inApp: { type: Boolean, default: true },
    email: { type: Boolean, default: false },
    push: { type: Boolean, default: false },
  },
  active: { type: Boolean, required: true, default: true },
  nextDueAt: { type: Date, index: true },
  lastFiredAt: { type: Date },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, strict: true, collection: 'Reminder' })

schema.index({ supplier: 1, active: 1, nextDueAt: 1 })
export default model<env.Reminder>('Reminder', schema)
