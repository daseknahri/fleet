import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

const maintenanceExpenseSchema = new Schema<env.MaintenanceExpense>(
  {
    supplier: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'User',
      index: true,
    },
    car: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'Car',
      index: true,
    },
    date: {
      type: Date,
      required: [true, "can't be blank"],
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(bookcarsTypes.MaintenanceExpenseType),
      required: [true, "can't be blank"],
    },
    amount: {
      type: Number,
      required: [true, "can't be blank"],
      min: 0.01,
    },
    mileage: {
      type: Number,
      min: 0,
    },
    vendor: {
      type: String,
      trim: true,
      maxlength: 160,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    receipt: { type: String, trim: true, maxlength: 255 },
  },
  {
    timestamps: true,
    strict: true,
    collection: 'MaintenanceExpense',
  },
)

maintenanceExpenseSchema.index({ supplier: 1, date: -1 })
maintenanceExpenseSchema.index({ car: 1, date: -1 })

const MaintenanceExpense = model<env.MaintenanceExpense>('MaintenanceExpense', maintenanceExpenseSchema)

export default MaintenanceExpense
