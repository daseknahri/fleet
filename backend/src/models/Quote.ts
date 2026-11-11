import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

/**
 * GA-PAR-05 — Quote (devis) document (Option B: separate model).
 *
 * A quote is a commercial document from birth: its number (DV-YYYY-NNNNNN,
 * Counter name 'quote') is assigned at CREATE, unlike an invoice number
 * which is a fiscal act assigned at issue. Quotes carry their own money
 * fields mirroring Invoice's, an optional link to a booking, and either a
 * registered client (client ref) or a free-entry client snapshot.
 * Conversion creates a DRAFT invoice through the shared creation path and
 * stores it in convertedInvoice; a quote converts at most once.
 */
const schema = new Schema<env.Quote>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  number: { type: String, trim: true, maxlength: 80 },
  status: { type: String, required: true, enum: Object.values(bookcarsTypes.QuoteStatus), default: bookcarsTypes.QuoteStatus.Draft, index: true },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  subtotal: { type: Number, required: true, min: 0 },
  taxAmount: { type: Number, required: true, min: 0 },
  taxRate: { type: Number, min: 0, max: 100, default: null },
  total: { type: Number, required: true, min: 0 },
  booking: { type: Schema.Types.ObjectId, ref: 'Booking', index: true },
  client: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  clientSnapshot: {
    name: { type: String, trim: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 50 },
    cinNumber: { type: String, trim: true, maxlength: 50 },
  },
  car: { type: Schema.Types.ObjectId, ref: 'Car', index: true },
  carLabel: { type: String, trim: true, maxlength: 200 },
  days: { type: Number, min: 0 },
  dailyRate: { type: Number, min: 0 },
  convertedInvoice: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, strict: true, collection: 'Quote' })

schema.index({ supplier: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } })
schema.index({ supplier: 1, createdAt: -1 })
export default model<env.Quote>('Quote', schema)
