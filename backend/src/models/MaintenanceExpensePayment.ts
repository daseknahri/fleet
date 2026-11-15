import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

/**
 * F7 / W3 M-2 — one payment record against a maintenance expense.
 * Append-only: payments are never edited or deleted, so the expense's
 * `paidAmount` always traces to these records (and, for cash, to a
 * confirmed CashMovement in the open cash session — see
 * utils/expensePayment.ts, the F6 C-7 pattern). The currency is the
 * agency base currency (expenses carry no currency of their own).
 */
const schema = new Schema<env.MaintenanceExpensePayment>(
  {
    supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    expense: { type: Schema.Types.ObjectId, required: true, ref: 'MaintenanceExpense', index: true },
    date: { type: Date, required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    method: { type: String, required: true, enum: Object.values(bookcarsTypes.RentalPaymentMethod) },
    reference: { type: String, trim: true, maxlength: 160 },
    note: { type: String, trim: true, maxlength: 1000 },
    cashMovement: { type: Schema.Types.ObjectId, ref: 'CashMovement', index: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, strict: true, collection: 'MaintenanceExpensePayment' },
)

schema.index({ supplier: 1, expense: 1, date: -1 })

export default model<env.MaintenanceExpensePayment>('MaintenanceExpensePayment', schema)
