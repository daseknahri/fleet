import { Schema, model } from 'mongoose'
import * as env from '../config/env.config'

/**
 * GA-PAR-06 (coordinator decision 2): per-agency return & settlement rates.
 * This is a NEW collection keyed by supplier; the global Setting singleton
 * (pickup/rental hours only) is NOT modified and stays byte-compatible.
 * All rate fields are optional: an absent includedKmPerDay means unlimited
 * kilometres; absent prices/fees mean that settlement line is unavailable.
 */
const schema = new Schema<env.AgencyReturnSettings>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', unique: true, index: true },
  includedKmPerDay: { type: Number, min: 0 },
  extraKmPrice: { type: Number, min: 0 },
  fuelPricePerLitre: { type: Number, min: 0 },
  washFee: { type: Number, min: 0 },
  defaultDeposit: { type: Number, min: 0 },
}, { timestamps: true, strict: true, collection: 'AgencyReturnSettings' })

export default model<env.AgencyReturnSettings>('AgencyReturnSettings', schema)
