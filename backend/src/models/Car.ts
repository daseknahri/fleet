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
    insuranceExpiryDate: {
      type: Date,
    },
    technicalInspectionExpiryDate: {
      type: Date,
    },
    vignetteExpiryDate: {
      type: Date,
    },
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
