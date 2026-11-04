import { Schema, model } from 'mongoose'
import * as env from '../config/env.config'
const schema = new Schema<env.ContractSnapshot>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  booking: { type: Schema.Types.ObjectId, required: true, ref: 'Booking', index: true },
  version: { type: Number, required: true, min: 1 },
  pdfFile: { type: String, required: true, maxlength: 240 },
  contentHash: { type: String, required: true, maxlength: 128 },
  generatedAt: { type: Date, required: true },
}, { timestamps: true, strict: true, collection: 'ContractSnapshot' })
schema.index({ booking: 1, version: 1 }, { unique: true, sparse: true })
export default model<env.ContractSnapshot>('ContractSnapshot', schema)
