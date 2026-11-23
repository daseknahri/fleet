import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

const schema = new Schema<env.MaintenanceSchedule>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  car: { type: Schema.Types.ObjectId, required: true, ref: 'Car', index: true },
  type: { type: String, required: true, enum: Object.values(bookcarsTypes.MaintenanceExpenseType) },
  // Next pass - the agency-created category, if any.
  category: { type: Schema.Types.ObjectId, ref: 'MaintenanceCategory', index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  intervalDays: { type: Number, min: 1 },
  intervalKm: { type: Number, min: 1 },
  lastServiceDate: Date,
  lastServiceMileage: { type: Number, min: 0 },
  // GAP-MAINT-P0-1 — optional: a km-only schedule (intervalKm, no
  // intervalDays, no explicit due date) carries no nextDueDate; the
  // date leg is skipped for it and the mileage leg governs.
  nextDueDate: { type: Date, index: true },
  nextDueMileage: { type: Number, min: 0 },
  status: { type: String, required: true, enum: Object.values(bookcarsTypes.MaintenanceScheduleStatus), default: bookcarsTypes.MaintenanceScheduleStatus.Upcoming, index: true },
  note: { type: String, trim: true, maxlength: 1000 },
}, { timestamps: true, strict: true, collection: 'MaintenanceSchedule' })

schema.index({ supplier: 1, car: 1, nextDueDate: 1 })
schema.index({ supplier: 1, status: 1, nextDueDate: 1 })
export default model<env.MaintenanceSchedule>('MaintenanceSchedule', schema)
