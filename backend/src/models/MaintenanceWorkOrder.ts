import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

const schema = new Schema<env.MaintenanceWorkOrder>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  car: { type: Schema.Types.ObjectId, required: true, ref: 'Car', index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  type: { type: String, required: true, enum: Object.values(bookcarsTypes.MaintenanceExpenseType) },
  status: { type: String, required: true, enum: Object.values(bookcarsTypes.WorkOrderStatus), default: bookcarsTypes.WorkOrderStatus.Scheduled, index: true },
  scheduledStart: { type: Date, required: true, index: true },
  scheduledEnd: { type: Date, required: true, index: true },
  completedAt: Date,
  odometer: { type: Number, min: 0 },
  vendor: { type: String, trim: true, maxlength: 160 },
  note: { type: String, trim: true, maxlength: 1000 },
  expense: { type: Schema.Types.ObjectId, ref: 'MaintenanceExpense' },
}, { timestamps: true, strict: true, collection: 'MaintenanceWorkOrder' })

schema.index({ supplier: 1, car: 1, scheduledStart: 1, scheduledEnd: 1 })
schema.index({ car: 1, status: 1, scheduledStart: 1, scheduledEnd: 1 })

export default model<env.MaintenanceWorkOrder>('MaintenanceWorkOrder', schema)
