import { Schema, model } from 'mongoose'

const schema = new Schema({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  name: { type: String, required: true, trim: true },
  year: { type: Number, required: true, min: 2000 },
  value: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: true, strict: true, collection: 'Counter' })

schema.index({ supplier: 1, name: 1, year: 1 }, { unique: true })
export default model('Counter', schema)
