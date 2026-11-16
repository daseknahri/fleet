import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

const carSchema = new Schema<env.Car>(
  {
    name: {
      type: String,
      required: [true, "can't be blank"],
      index: true,
      trim: true,
    },
    licensePlate: {
      type: String,
      index: true,
      trim: true,
    },
    // F5b (W2-12): vehicle identity — all optional, informational only.
    // `name` stays the display name; make/model/year are the structured
    // identity the name used to carry as free text.
    make: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    model: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    year: {
      type: Number,
      min: 1900,
      max: 2100,
    },
    // F5b (W2-13): the car's current odometer reading (km). NOT
    // `mileage` below — that is the km/day rental allowance (-1 =
    // unlimited). The tight year/odometer bounds live in the controller
    // (invalidCarIdentityField); the schema keeps only coarse guards so
    // a legacy row never fails an unrelated save.
    odometerKm: {
      type: Number,
      min: 0,
    },
    supplier: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'User',
      index: true,
    },
    minimumAge: {
      type: Number,
      required: [true, "can't be blank"],
      min: env.MINIMUM_AGE,
      max: 99,
    },
    locations: {
      type: [Schema.Types.ObjectId],
      ref: 'Location',
      validate: (value: any): boolean => Array.isArray(value) && value.length > 0,
    },

    // --------- price fields ---------
    dailyPrice: {
      type: Number,
      required: [true, "can't be blank"],
    },
    discountedDailyPrice: {
      type: Number,
    },
    hourlyPrice: {
      type: Number,
    },
    discountedHourlyPrice: {
      type: Number,
    },
    biWeeklyPrice: {
      type: Number,
    },
    discountedBiWeeklyPrice: {
      type: Number,
    },
    weeklyPrice: {
      type: Number,
    },
    discountedWeeklyPrice: {
      type: Number,
    },
    monthlyPrice: {
      type: Number,
    },
    discountedMonthlyPrice: {
      type: Number,
    },

    // date based price fields
    isDateBasedPrice: {
      type: Boolean,
      default: false,
    },
    dateBasedPrices: {
      type: [Schema.Types.ObjectId],
      ref: 'DateBasedPrice',
    },
    // --------- end of price fields ---------

    deposit: {
      type: Number,
      required: [true, "can't be blank"],
    },
    available: {
      type: Boolean,
      required: [true, "can't be blank"],
      index: true,
    },
    fullyBooked: {
      type: Boolean,
      default: false,
    },
    comingSoon: {
      type: Boolean,
      default: false,
    },
    // Fleet statuses (scorecard #15): operator-set state of the car.
    // `rented` is NOT stored — it stays derived from live bookings (see
    // backend/src/utils/fleetStatus.ts). A car with no stored value
    // (legacy docs) reads as inService everywhere.
    operationalStatus: {
      type: String,
      enum: [
        bookcarsTypes.CarOperationalStatus.InService,
        bookcarsTypes.CarOperationalStatus.Maintenance,
        bookcarsTypes.CarOperationalStatus.Stopped,
      ],
      default: bookcarsTypes.CarOperationalStatus.InService,
      index: true,
    },
    type: {
      type: String,
      enum: [
        bookcarsTypes.CarType.Diesel,
        bookcarsTypes.CarType.Gasoline,
        bookcarsTypes.CarType.Electric,
        bookcarsTypes.CarType.Hybrid,
        bookcarsTypes.CarType.PlugInHybrid,
        bookcarsTypes.CarType.Unknown,
      ],
      required: [true, "can't be blank"],
    },
    gearbox: {
      type: String,
      enum: [bookcarsTypes.GearboxType.Manual, bookcarsTypes.GearboxType.Automatic],
      required: [true, "can't be blank"],
    },
    aircon: {
      type: Boolean,
      required: [true, "can't be blank"],
    },
    image: {
      type: String,
    },
    // F5b (W2-14): additional gallery photos beyond the cover `image`
    // above (the cover stays the single `image` for backwards
    // compatibility — the booking/frontend flows read it). Managed
    // through the gallery endpoints only (cap 8, enforced in the
    // controller); never written through the create/update payload.
    images: {
      type: [String],
      default: [],
    },
    seats: {
      type: Number,
      required: [true, "can't be blank"],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer',
      },
    },
    doors: {
      type: Number,
      required: [true, "can't be blank"],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer',
      },
    },
    fuelPolicy: {
      type: String,
      enum: [
        bookcarsTypes.FuelPolicy.LikeForLike,
        bookcarsTypes.FuelPolicy.FreeTank,
        bookcarsTypes.FuelPolicy.FullToFull,
        bookcarsTypes.FuelPolicy.FullToEmpty,
      ],
      required: [true, "can't be blank"],
    },
    mileage: {
      type: Number,
      required: [true, "can't be blank"],
    },
    cancellation: {
      type: Number,
      required: [true, "can't be blank"],
    },
    amendments: {
      type: Number,
      required: [true, "can't be blank"],
    },
    theftProtection: {
      type: Number,
      required: [true, "can't be blank"],
    },
    collisionDamageWaiver: {
      type: Number,
      required: [true, "can't be blank"],
    },
    fullInsurance: {
      type: Number,
      required: [true, "can't be blank"],
    },
    additionalDriver: {
      type: Number,
      required: [true, "can't be blank"],
    },
    range: {
      type: String,
      enum: [
        bookcarsTypes.CarRange.Mini,
        bookcarsTypes.CarRange.Midi,
        bookcarsTypes.CarRange.Maxi,
        bookcarsTypes.CarRange.Scooter,
        bookcarsTypes.CarRange.Bus,
        bookcarsTypes.CarRange.Truck,
        bookcarsTypes.CarRange.Caravan,
      ],
      required: [true, "can't be blank"],
    },
    multimedia: [{
      type: String,
      enum: [
        bookcarsTypes.CarMultimedia.AndroidAuto,
        bookcarsTypes.CarMultimedia.AppleCarPlay,
        bookcarsTypes.CarMultimedia.Bluetooth,
        bookcarsTypes.CarMultimedia.Touchscreen,
      ],
    }],
    rating: {
      type: Number,
      min: 1,
      max: 5,
    },
    trips: {
      type: Number,
      default: 0,
    },
    co2: {
      type: Number,
    },
    tankCapacityLitres: {
      type: Number,
      min: 0,
    },
    // GA-PAR-08: financing block (nested paths, all optional). Amounts
    // carry min: 0 only — no cross-field rules are enforced (remaining
    // vs purchase price is the operator's data). The type enum, the
    // min validators and Date casting reject bad values at save (400).
    financing: {
      type: {
        type: String,
        enum: [
          bookcarsTypes.CarFinancingType.Credit,
          bookcarsTypes.CarFinancingType.Cash,
          bookcarsTypes.CarFinancingType.Instalments,
          bookcarsTypes.CarFinancingType.Leasing,
        ],
      },
      purchasePrice: {
        type: Number,
        min: 0,
      },
      lender: {
        type: String,
        trim: true,
      },
      instalmentAmount: {
        type: Number,
        min: 0,
      },
      downPayment: {
        type: Number,
        min: 0,
      },
      durationMonths: {
        type: Number,
        min: 0,
        validate: {
          validator: Number.isInteger,
          message: '{VALUE} is not an integer',
        },
      },
      firstDueDate: {
        type: Date,
      },
      nextDueDate: {
        type: Date,
      },
      remainingAmount: {
        type: Number,
        min: 0,
      },
      autoDebit: {
        type: Boolean,
      },
    },
    // GA-PAR-08: document expiry dates (all optional) — GA-PAR-09's
    // expiring-documents card reads these raw fields.
    // F5b (W2-19): the insurance policy data — provider + policy number
    // live here next to the insurance expiry date. The policy FILE
    // itself lives in the `documents` array below with kind `insurance`
    // (no duplicate `insuranceDocument` string field).
    insuranceProvider: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    insurancePolicyNumber: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    insuranceExpiryDate: {
      type: Date,
    },
    technicalInspectionExpiryDate: {
      type: Date,
    },
    vignetteExpiryDate: {
      type: Date,
    },
    // F5b (W2-14): privately stored car documents (insurance,
    // technical inspection, vignette, other) — mirrors the client
    // `clientDocuments` sub-documents. The files live in the private
    // car-documents store (env.CDN_CAR_DOCUMENTS); only the owning
    // agency / admin can download them (see documentController).
    // `expiryDate` is the document's own expiry, independent of the
    // three expiry-date fields above.
    documents: [{
      kind: {
        type: String,
        required: [true, "can't be blank"],
        trim: true,
        maxlength: 30,
      },
      file: {
        type: String,
        required: [true, "can't be blank"],
        trim: true,
      },
      originalName: {
        type: String,
        trim: true,
        maxlength: 255,
      },
      expiryDate: {
        type: Date,
      },
      uploadedAt: {
        type: Date,
        default: Date.now,
      },
    }],
    // Scorecard #17: garage block (all optional, informational only).
    // No required fields, no default: a car with no stored block is
    // simply not at a garage. A block whose every field is cleared is
    // stored as absent, never as an empty sub-document (see
    // normalizeGarage in carController.ts). The block never drives
    // booking behaviour — that rides solely on operationalStatus (#15);
    // a car at the garage will normally also be `maintenance`, but the
    // system does not enforce the coupling.
    garage: {
      garageName: {
        type: String,
        trim: true,
        maxlength: 200,
      },
      since: {
        type: Date,
      },
      expectedBack: {
        type: Date,
      },
    },
    // Scorecard #18: service state — oil/filter change km tracking
    // (all optional, informational only). No required fields, no
    // default: a car with no stored block simply has no recorded
    // service state. A block whose every field is cleared is stored
    // as absent, never as an empty sub-document (see normalizeService
    // in carController.ts). The block never drives booking behaviour.
    // The generic MaintenanceSchedule rows (intervalKm /
    // nextDueMileage, per-type schedule entries) are a separate
    // concern and are NOT the source of these fields.
    service: {
      lastOilChangeKm: {
        type: Number,
        min: 0,
      },
      lastFilterChangeKm: {
        type: Number,
        min: 0,
      },
      nextOilChangeKm: {
        type: Number,
        min: 0,
      },
      nextFilterChangeKm: {
        type: Number,
        min: 0,
      },
    },
    blockOnPay: {
      type: Boolean,
      default: true,
    },
    bookingReservationVersion: {
      type: Number,
      default: 0,
      select: false,
    },

    // GA-PAR-22: trash / restore (scorecard #47). See Booking.ts for
    // the shared semantics (timestamp, not status; exact-reversal
    // invariant D-22.2). Trash IS the retirement the deleteCar 409
    // message has been prescribing: a car with live bookings CAN be
    // trashed (its bookings stay live), and can essentially never be
    // purged while booking history exists.
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
    }],
  },
  {
    timestamps: true,
    strict: true,
    collection: 'Car',
  },
)

// Add custom indexes
carSchema.index({ updatedAt: -1, _id: 1 })
// GA-PAR-22: serves both the live lists (`deletedAt: null`) and the
// trash view (`deletedAt: { $ne: null }`) per agency.
carSchema.index({ supplier: 1, deletedAt: 1 })
// F5a (W2-01): per-agency license-plate uniqueness, backing the
// server-side check in carController create/update (the check alone is
// raceable). Partial: only live cars with a non-empty plate take part,
// so legacy empty-plate rows and trashed cars never block index
// creation and a trashed car's plate stays reusable (same rule as
// validateLicensePlate / restoreCar). Case-insensitive (strength-2
// collation) to match the importer's rule that the same plate in
// another case is the same plate. Per-agency, not global: the same
// plate already exists under different agencies in the local dev data
// and multi-agency is gated (#48). Deploy precondition: the target
// database must hold no live per-agency plate duplicate, or
// initialize() fails and the server exits(1) — see F5A-REPORT.md.
carSchema.index(
  { supplier: 1, licensePlate: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    partialFilterExpression: { licensePlate: { $type: 'string', $ne: '' }, deletedAt: null },
  },
)
// Fleet statuses (scorecard #15): serves the fleet-status counts and
// the status filter in getCars.
carSchema.index({ supplier: 1, operationalStatus: 1 })
carSchema.index({ supplier: 1, type: 1, available: 1, rating: -1, updatedAt: -1, _id: 1 })
carSchema.index({ available: 1, gearbox: 1, deposit: 1 })
carSchema.index({ seats: 1, doors: 1 })
carSchema.index({ mileage: 1, fuelPolicy: 1 })
carSchema.index({ locations: 1, available: 1, fullyBooked: 1 })
carSchema.index({ comingSoon: 1 })
carSchema.index({ range: 1 })
carSchema.index({ multimedia: 1 })
carSchema.index({ dailyPrice: 1, _id: 1 })
carSchema.index({ dateBasedPrices: 1 })
carSchema.index(
  { name: 'text' },
  {
    default_language: 'none', // This disables stemming
    language_override: '_none', // Prevent MongoDB from expecting a language field
    background: true,
  },
)

const Car = model<env.Car>('Car', carSchema)

export default Car
