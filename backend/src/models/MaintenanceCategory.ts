import { Schema, model } from 'mongoose'
import * as env from '../config/env.config'

const maintenanceCategorySchema = new Schema<env.MaintenanceCategory>(
  {
    supplier: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'User',
      index: true,
    },
    name: {
      type: String,
      required: [true, "can't be blank"],
      trim: true,
      maxlength: 100,
    },
    color: {
      type: String,
      trim: true,
      maxlength: 7,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    strict: true,
    collection: 'MaintenanceCategory',
  },
)

// Names are unique per agency (the controller also checks case-insensitively).
maintenanceCategorySchema.index({ supplier: 1, name: 1 }, { unique: true })

const MaintenanceCategory = model<env.MaintenanceCategory>('MaintenanceCategory', maintenanceCategorySchema)

export default MaintenanceCategory