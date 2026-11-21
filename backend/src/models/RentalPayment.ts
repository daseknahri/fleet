import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

const rentalPaymentSchema = new Schema<env.RentalPayment>(
  {
    supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    booking: { type: Schema.Types.ObjectId, required: true, ref: 'Booking', index: true },
    date: { type: Date, required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3, default: env.BASE_CURRENCY },
    method: { type: String, required: true, enum: Object.values(bookcarsTypes.RentalPaymentMethod) },
    purpose: { type: String, required: true, enum: Object.values(bookcarsTypes.RentalPaymentPurpose), default: bookcarsTypes.RentalPaymentPurpose.Rent },
    direction: { type: String, required: true, enum: Object.values(bookcarsTypes.RentalPaymentDirection), default: bookcarsTypes.RentalPaymentDirection.Credit },
    source: { type: String, required: true, enum: Object.values(bookcarsTypes.RentalPaymentSource), default: bookcarsTypes.RentalPaymentSource.Manual },
    status: { type: String, required: true, enum: Object.values(bookcarsTypes.RentalPaymentStatus), default: bookcarsTypes.RentalPaymentStatus.Posted },
    idempotencyKey: { type: String, maxlength: 200, trim: true },
    providerReference: { type: String, maxlength: 200, trim: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    confirmedAt: { type: Date },
    reversedFrom: { type: Schema.Types.ObjectId, ref: 'RentalPayment' },
    refundProviderReference: { type: String, maxlength: 200, trim: true },
    refundedAt: { type: Date },
    settledAt: { type: Date },
    // F2 / W4 GAP-10 — provider-settled leg of a provider checkout
    // posting: the amount the provider actually settled, in the payment
    // currency, at the snapshot FX rate. Informational only — the
    // base-currency amount/currency above still post under the ledger's
    // purpose caps and the recorded totals sum `amount`, never these.
    settledAmount: { type: Number, min: 0 },
    settledCurrency: { type: String, uppercase: true, minlength: 3, maxlength: 3 },
    fxRate: { type: Number, min: 0 },
    fxSource: { type: String, maxlength: 50, trim: true },
    fxAt: { type: Date },
    // F6 / W3 C-7 — the cash session this cash-method payment is linked
    // into (unset while no open cash session exists at posting time).
    cashSession: { type: Schema.Types.ObjectId, ref: 'CashSession', index: true },
    // Wave 2.6 — the bank session this bank-transfer payment is linked
    // into (same pattern as cashSession, for the Bank account).
    bankSession: { type: Schema.Types.ObjectId, ref: 'CashSession', index: true },
    reference: { type: String, maxlength: 160, trim: true },
    note: { type: String, maxlength: 1000, trim: true },
  },
  { timestamps: true, strict: true, collection: 'RentalPayment' },
)

rentalPaymentSchema.index({ supplier: 1, date: -1 })
rentalPaymentSchema.index({ booking: 1, date: -1 })
rentalPaymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true })
rentalPaymentSchema.index({ supplier: 1, status: 1, date: -1 })

const RentalPayment = model<env.RentalPayment>('RentalPayment', rentalPaymentSchema)

export default RentalPayment
