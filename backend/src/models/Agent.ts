import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

/**
 * GA-PAR-07 — Apporteur (business referrer) record.
 *
 * An agent is an agency-scoped referrer (riad, hotel, taxi, guide, another
 * agency, other) who brings rentals to the agency. The record carries the
 * DEFAULT commission (a percent of the rent, a fixed amount, or an amount
 * per rental day); each booking captures its own snapshot of the terms in
 * force (see Booking.agent), so editing this default never rewrites the
 * commission history of existing bookings. Settlements paid to the agent
 * live in their own AgentSettlement collection — never as RentalPayments
 * and never mirrored into MaintenanceExpense (N11).
 */
const schema = new Schema<env.Agent>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  phone: { type: String, trim: true, maxlength: 50 },
  type: {
    type: String,
    required: true,
    enum: Object.values(bookcarsTypes.AgentType),
    default: bookcarsTypes.AgentType.Other,
  },
  commissionMode: {
    type: String,
    required: true,
    enum: Object.values(bookcarsTypes.CommissionMode),
    default: bookcarsTypes.CommissionMode.Percent,
  },
  commissionValue: { type: Number, required: true, min: 0, default: 0 },
  active: { type: Boolean, required: true, default: true },
  notes: { type: String, trim: true, maxlength: 1000 },
}, { timestamps: true, strict: true, collection: 'Agent' })

schema.index({ supplier: 1, name: 1 })
export default model<env.Agent>('Agent', schema)
