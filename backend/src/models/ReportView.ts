import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

/**
 * GA-PAR-14 — saved reports-builder view (scorecard #40).
 * Owned by exactly one user inside one agency: controllers scope every
 * read/write by {supplier, user}, so a view is invisible to other users
 * of the same agency and to every other agency.
 */
const configSchema = new Schema<env.ReportViewConfig>({
  from: { type: String, trim: true, maxlength: 40 },
  to: { type: String, trim: true, maxlength: 40 },
  periodPreset: { type: String, trim: true, maxlength: 20 },
  carId: { type: String, trim: true, maxlength: 40 },
  groupBy: {
    type: String,
    required: true,
    enum: Object.values(bookcarsTypes.ReportGroupBy),
    default: bookcarsTypes.ReportGroupBy.Car,
  },
  compare: { type: Boolean, required: true, default: false },
}, { _id: false })

const schema = new Schema<env.ReportView>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  user: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  config: { type: configSchema, required: true },
}, { timestamps: true, strict: true, collection: 'ReportView' })

schema.index({ supplier: 1, user: 1, updatedAt: -1 })
export default model<env.ReportView>('ReportView', schema)
