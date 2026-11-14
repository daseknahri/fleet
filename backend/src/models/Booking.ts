import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

export const BOOKING_EXPIRE_AT_INDEX_NAME = 'expireAt'

const bookingSchema = new Schema<env.Booking>(
  {
    supplier: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'User',
      index: true,
    },
    // GA-PAR-02: human contract reference (GA-YYMMDD-NNNN), allocated
    // atomically at creation from the per-agency/per-day Counter sequence
    // (see utils/bookingReference). Optional: bookings created before this
    // field existed keep no reference and fall back to their _id in the UI
    // and on the contract snapshot. No backfill/migration is performed.
    reference: {
      type: String,
      trim: true,
    },
    car: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'Car',
    },
    driver: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'User',
      index: true,
    },
    pickupLocation: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'Location',
    },
    dropOffLocation: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'Location',
    },
    from: {
      type: Date,
      required: [true, "can't be blank"],
    },
    to: {
      type: Date,
      required: [true, "can't be blank"],
    },
    lifecycle: {
      type: String,
      enum: Object.values(bookcarsTypes.ContractLifecycle),
      default: bookcarsTypes.ContractLifecycle.Draft,
      index: true,
    },
    status: {
      type: String,
      enum: [
        bookcarsTypes.BookingStatus.Void,
        bookcarsTypes.BookingStatus.Pending,
        bookcarsTypes.BookingStatus.Deposit,
        bookcarsTypes.BookingStatus.Paid,
        bookcarsTypes.BookingStatus.PaidInFull,
        bookcarsTypes.BookingStatus.Reserved,
        bookcarsTypes.BookingStatus.Cancelled,
      ],
      required: [true, "can't be blank"],
    },
    cancellation: {
      type: Boolean,
      default: false,
    },
    amendments: {
      type: Boolean,
      default: false,
    },
    theftProtection: {
      type: Boolean,
      default: false,
    },
    collisionDamageWaiver: {
      type: Boolean,
      default: false,
    },
    fullInsurance: {
      type: Boolean,
      default: false,
    },
    additionalDriver: {
      type: Boolean,
      default: false,
    },
    _additionalDriver: {
      type: Schema.Types.ObjectId,
      ref: 'AdditionalDriver',
    },
    price: {
      type: Number,
      required: [true, "can't be blank"],
    },
    cancelRequest: {
      type: Boolean,
      default: false,
    },
    sessionId: {
      type: String,
      index: true,
    },
    paymentIntentId: {
      type: String,
    },
    customerId: {
      type: String,
    },
    isDeposit: {
      type: Boolean,
      default: false,
    },
    isPayedInFull: {
      type: Boolean,
      default: false,
    },
    ledgerVersion: {
      type: Number,
      default: 0,
    },
    paypalOrderId: {
      type: String,
    },
    depositSettlement: {
      heldAmount: { type: Number, min: 0 },
      keptAmount: { type: Number, min: 0 },
      returnedAmount: { type: Number, min: 0 },
      method: { type: String, trim: true, maxlength: 100 },
      note: { type: String, trim: true, maxlength: 1000 },
      recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      recordedAt: { type: Date },
    },
    // GA-PAR-10: recorded overlap exception. Only the reason is ever
    // client-supplied (create/update payloads, Owner/Manager only — the
    // gate lives in bookingController); authorisedBy/authorisedAt are
    // stamped server-side and conflictingBooking records the booking the
    // exception overrode when identifiable. Maintenance work-order
    // conflicts can never be excepted (bookingReservationHelper).
    overlapException: {
      reason: { type: String, maxlength: 1000 },
      authorisedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      authorisedAt: { type: Date },
      conflictingBooking: { type: Schema.Types.ObjectId, ref: 'Booking' },
    },
    // GA-PAR-11: contract amendment history. Each successful POST
    // /api/bookings/:id/amend appends exactly one row. The price basis
    // is the ORIGINAL snapshot's rate basis (the financial snapshot
    // stores no daily rate — see bookingAmendmentController): the
    // basis daily rate is snapshot rentalTotal / original rental days,
    // recorded here verbatim (basisDailyRate + basisDays) so the delta
    // stays auditable without re-pricing from today's car prices.
    amendmentHistory: [{
      at: { type: Date },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      reason: { type: String, maxlength: 1000 },
      fromBefore: { type: Date },
      toBefore: { type: Date },
      fromAfter: { type: Date },
      toAfter: { type: Date },
      rentalTotalBefore: { type: Number },
      rentalTotalAfter: { type: Number },
      priceDelta: { type: Number },
      basisDailyRate: { type: Number },
      basisDays: { type: Number },
    }],
    // GA-PAR-07: apporteur commission SNAPSHOT captured at booking time
    // (mode/value = the agent default or the per-contract override then in
    // force; amount computed server-side — see utils/agentCommission).
    // Later edits to the agent's default never rewrite this snapshot, and
    // the snapshot is never rendered on the contract document or invoice.
    agent: {
      agent: { type: Schema.Types.ObjectId, ref: 'Agent', index: true },
      mode: { type: String, enum: Object.values(bookcarsTypes.CommissionMode) },
      value: { type: Number, min: 0 },
      amount: { type: Number, min: 0 },
    },
    financialSnapshot: {
      version: Number,
      baseCurrency: String,
      paymentCurrency: String,
      mode: {
        type: String,
        enum: Object.values(bookcarsTypes.CheckoutPaymentMode),
      },
      rentalTotal: Number,
      depositAmount: Number,
      amountDueNow: Number,
      amountDueNowInPaymentCurrency: Number,
      quotedAt: Date,
    },
    // GA-PAR-12: online client signing. `signingNonce` is the revocation
    // anchor for signing links: issue mints an HMAC capability token over
    // the current nonce, revoke rotates it (every outstanding link dies),
    // and a successful signing rotates it again (the link is consumed).
    // `select: false` keeps it out of every default query/populate/
    // serialization path — it must never appear in an API response; the
    // signing controller loads it explicitly with `+signingNonce`.
    signingNonce: {
      type: String,
      select: false,
    },

    // GA-PAR-22: trash / restore (scorecard #47). Trashed is a
    // timestamp, not a status: absent/`null` = live, set = trashed.
    // `deletedAt` is the single source of truth; there is no
    // `isDeleted` boolean. Trash writes exactly these three fields
    // and appends one `trashHistory` row; restore clears exactly
    // those three fields and appends one row (exact-reversal
    // invariant, D-22.2). Legacy rows carry none of these fields and
    // read as live with zero migration.
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    deleteReason: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    trashHistory: [{
      at: { type: Date },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      action: { type: String, enum: ['trashed', 'restored'] },
      reason: { type: String, maxlength: 1000 },
      // Booking rows only: whether the trash money-warning fired
      // (§2.5 — posted payments / non-voided invoices present).
      hadPayments: { type: Boolean },
      hadInvoices: { type: Boolean },
    }],
    // GA-PAR-12: the recorded online signature. `file` names a PNG in the
    // private contracts store (env.CDN_CONTRACTS), served only through
    // authenticated routes; `contentHash` is the SHA-256 of the stored
    // bytes; `signedAt` is stamped server-side at signing time.
    onlineSignature: {
      file: { type: String },
      signedAt: { type: Date },
      contentHash: { type: String },
    },
    expireAt: {
      //
      // Bookings created from checkout with Stripe are temporary and
      // are automatically deleted if the payment checkout session expires.
      //
      type: Date,
      index: { name: BOOKING_EXPIRE_AT_INDEX_NAME, expireAfterSeconds: env.BOOKING_EXPIRE_AT, background: true },
    },
  },
  {
    timestamps: true,
    strict: true,
    collection: 'Booking',
  },
)

// GA-PAR-02 backstop: a reference, when present, is unique per agency.
// A literal unique+sparse compound index cannot express this: MongoDB
// indexes a sparse compound document whenever at least one key is present,
// and supplier is always present, so every reference-less booking would be
// indexed as (supplier, null) and only one could exist per agency. The
// partial filter below is the equivalent that indexes only documents whose
// reference is a string, leaving any number of reference-less bookings
// untouched while still failing a duplicate reference insert loudly.
bookingSchema.index(
  { supplier: 1, reference: 1 },
  { unique: true, partialFilterExpression: { reference: { $type: 'string' } } },
)

// Common filter for every query
bookingSchema.index({ 'supplier._id': 1, status: 1, expireAt: 1 })
// GA-PAR-22: serves both the live lists (`deletedAt: null`) and the
// trash view (`deletedAt: { $ne: null }`) per agency.
bookingSchema.index({ supplier: 1, deletedAt: 1 })

// Optional filters (can combine with the above depending on frequency)
bookingSchema.index({ 'driver._id': 1 })
bookingSchema.index({ 'car._id': 1 })
bookingSchema.index({ from: 1, to: 1 }) // For date range filtering
bookingSchema.index({ 'pickupLocation._id': 1 })
bookingSchema.index({ 'dropOffLocation._id': 1 })

// If keyword is used often with regex, and performance is an issue:
bookingSchema.index({ 'supplier.fullName': 1 }) // Consider text index if full-text search is needed
bookingSchema.index({ 'driver.fullName': 1 })
bookingSchema.index({ 'car.name': 1 })

const Booking = model<env.Booking>('Booking', bookingSchema)

export default Booking
