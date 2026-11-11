import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

/**
 * GA-PAR-07 — one settlement payment made to an apporteur.
 *
 * A settlement is a single payment against the agent's outstanding balance
 * (see utils/agentCommission for the ONE outstanding definition). It is
 * allocated FIFO by booking creation date for the `bookingRefs` record —
 * the bookings the payment covers, oldest first — and carries the payment
 * method plus the server-stamped confirmer and confirmation time. It is
 * deliberately NOT a RentalPayment (rent/deposit purposes only) and is NOT
 * mirrored into MaintenanceExpense (N11 adjacency, registered not decided).
 */
const schema = new Schema<env.AgentSettlement>({
  supplier: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  agent: { type: Schema.Types.ObjectId, required: true, ref: 'Agent', index: true },
  amount: { type: Number, required: true, min: 0 },
  method: {
    type: String,
    required: true,
    enum: Object.values(bookcarsTypes.AgentSettlementMethod),
  },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: { type: Date },
  note: { type: String, trim: true, maxlength: 1000 },
  bookingRefs: [{ type: Schema.Types.ObjectId, ref: 'Booking' }],
}, { timestamps: true, strict: true, collection: 'AgentSettlement' })

schema.index({ supplier: 1, agent: 1, createdAt: -1 })
export default model<env.AgentSettlement>('AgentSettlement', schema)
