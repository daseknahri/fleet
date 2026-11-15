import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
const schema = new Schema<env.ContractInspection>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  booking: { type: Schema.Types.ObjectId, required: true, ref: 'Booking', index: true },
  car: { type: Schema.Types.ObjectId, required: true, ref: 'Car', index: true },
  type: { type: String, required: true, enum: Object.values(bookcarsTypes.InspectionType) },
  occurredAt: { type: Date, required: true },
  odometer: { type: Number, min: 0 },
  fuelLevel: { type: Number, min: 0, max: 100 },
  condition: { type: String, maxlength: 4000, trim: true },
  damageNote: { type: String, maxlength: 4000, trim: true },
  photoFiles: [{ type: String, maxlength: 200 }],
  checklist: {
    spareWheelAndTools: { type: Boolean },
    radio: { type: Boolean },
    washed: { type: Boolean },
  },
  photos: [{
    _id: false,
    slot: { type: String, enum: Object.values(bookcarsTypes.InspectionPhotoSlot) },
    file: { type: String, maxlength: 200 },
  }],
  signatureFile: { type: String, maxlength: 200 },
  acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
  // F4 / W1 #7 — dispute flag (open while resolvedAt is
  // absent). Metadata only: it never edits the record's evidence
  // fields; an open dispute blocks completion.
  dispute: {
    reason: { type: String, maxlength: 1000, trim: true },
    raisedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    raisedAt: { type: Date },
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolution: { type: String, maxlength: 1000, trim: true },
  },
}, { timestamps: true, strict: true, collection: 'ContractInspection' })
schema.index({ supplier: 1, booking: 1, type: 1, occurredAt: -1 })
export default model<env.ContractInspection>('ContractInspection', schema)


