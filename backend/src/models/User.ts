import validator from 'validator'
import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

export const USER_EXPIRE_AT_INDEX_NAME = 'expireAt'

const userSchema = new Schema<env.User>(
  {
    supplier: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    email: {
      type: String,
      lowercase: true,
      unique: true,
      required: [true, "can't be blank"],
      validate: [validator.isEmail, 'is not valid'],
      index: true,
      trim: true,
    },
    phone: {
      type: String,
      validate: {
        validator: (value: string) => {
          // Check if value is empty then return true.
          if (!value) {
            return true
          }

          // If value is empty will not validate for mobile phone.
          return validator.isMobilePhone(value)
        },
        message: '{VALUE} is not valid',
      },
      trim: true,
    },
    fullName: {
      type: String,
      required: [true, "can't be blank"],
      index: true,
      trim: true,
    },
    password: {
      type: String,
      minlength: 6,
    },
    birthDate: {
      type: Date,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
    },
    // How the account was created: 'self' through the public sign-up
    // endpoints, 'admin' through an authenticated create flow. Legacy
    // rows carry no marker and default to 'admin' (exempt), so nobody
    // is locked out retroactively (decision F-SEC-7, GA-P10-DECISIONS-01).
    signupOrigin: {
      type: String,
      enum: ['self', 'admin'],
      default: 'admin',
    },
    // Server-side session revocation (H-007): bumped whenever the password
    // changes. JWTs carry the version they were issued with (tv claim) and
    // token verification rejects them once it no longer matches.
    tokenVersion: {
      type: Number,
      default: 0,
    },
    active: {
      type: Boolean,
      default: false,
    },
    language: {
      // ISO 639-1 (alpha-2 code)
      type: String,
      default: env.DEFAULT_LANGUAGE,
      lowercase: true,
      minlength: 2,
      maxlength: 2,
    },
    enableEmailNotifications: {
      type: Boolean,
      default: true,
    },
    // GA-PAR-13: per-category email toggles (scorecard #43). Nested paths
    // (not a subdocument) so legacy rows read as undefined and every
    // consumer treats undefined as true; new rows default all true.
    emailNotificationCategories: {
      returnsDue: { type: Boolean, default: true },
      carDueDates: { type: Boolean, default: true },
      signedContracts: { type: Boolean, default: true },
      weeklyRecap: { type: Boolean, default: true },
      tips: { type: Boolean, default: true },
      news: { type: Boolean, default: true },
    },
    avatar: {
      type: String,
    },
    bio: {
      type: String,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: [
        bookcarsTypes.UserType.Admin,
        bookcarsTypes.UserType.Supplier,
        bookcarsTypes.UserType.User,
        bookcarsTypes.UserType.Staff,
      ],
      default: bookcarsTypes.UserType.User,
    },
    blacklisted: {
      type: Boolean,
      default: false,
    },
    payLater: {
      type: Boolean,
      default: true,
    },
    customerId: {
      type: String,
    },
    contracts: [{
      language: {
        type: String,
        required: [true, "can't be blank"],
        trim: true,
        lowercase: true,
        minLength: 2,
        maxLength: 2,
      },
      file: String,
    }],
    licenseRequired: {
      type: Boolean,
      default: false,
    },
    license: {
      type: String,
    },
    minimumRentalDays: {
      type: Number,
    },
    priceChangeRate: {
      type: Number,
    },
    supplierCarLimit: {
      type: Number,
    },
    notifyAdminOnNewCar: {
      type: Boolean,
    },
    expireAt: {
      //
      // Non verified and active users created from checkout with Stripe are temporary and
      // are automatically deleted if the payment checkout session expires.
      //
      type: Date,
      index: { name: USER_EXPIRE_AT_INDEX_NAME, expireAfterSeconds: env.USER_EXPIRE_AT, background: true },
    },
    isSocial: {
      //
      // Indicates whether the user account was created via social login
      // (e.g., Google, Facebook, Apple OAuth) rather than password credentials.
      //
      type: Boolean,
      default: false,
    },
    // GA-PAR-01: agency fiscal identity (supplier records only). All fields
    // are optional; records that never set them behave exactly as before.
    // `location` above is a free-text display location and is NOT reused
    // here: `fiscalAddress` is the address printed for fiscal purposes.
    ice: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    registreCommerce: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    identifiantFiscal: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    patente: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    rib: {
      type: String,
      trim: true,
      maxlength: 34,
    },
    fiscalAddress: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    city: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    vatEnabled: {
      type: Boolean,
      default: false,
    },
    vatRate: {
      // Percent (e.g. 20 means 20%). Stored explicitly; invoice creation
      // falls back to 20 when VAT is enabled and no rate was stored.
      type: Number,
      min: 0,
      max: 100,
    },
    // GA-PAR-14: agency stamp image for the contract snapshot PDF.
    // Stored filename inside the private contracts store
    // (CDN_CONTRACTS); set only by the dedicated stamp upload
    // endpoint, never by the generic supplier update. Optional —
    // a stamp-less agency renders the snapshot without a stamp.
    stampFile: {
      type: String,
      trim: true,
      maxlength: 240,
    },
    // GA-PAR-04: client identity pack (records with type=User only; the
    // controller validates/strips these fields for every other type, so
    // staff/supplier creation cannot regress). All optional. `license`
    // above remains the licence FILE; `licenseNumber` is the number.
    cinNumber: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    cinExpiry: {
      type: Date,
    },
    passportNumber: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    passportExpiry: {
      type: Date,
    },
    licenseNumber: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    licenseExpiry: {
      type: Date,
    },
    clientType: {
      type: String,
      enum: [bookcarsTypes.ClientType.Individual, bookcarsTypes.ClientType.Company],
    },
    clientStatus: {
      // NEW separate workflow status (coordinator decision N5): never
      // writes or derives from `blacklisted` / `active`; auth unchanged.
      type: String,
      enum: [
        bookcarsTypes.ClientStatus.Active,
        bookcarsTypes.ClientStatus.UnderReview,
        bookcarsTypes.ClientStatus.Blocked,
      ],
    },

    // GA-PAR-22: trash / restore (scorecard #47). Applies to client
    // rows (`type=User`) only — Staff/Supplier rows keep today's
    // hard-delete path. See Booking.ts for the shared semantics
    // (timestamp, not status; exact-reversal invariant D-22.2).
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
    clientDocuments: [{
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
      uploadedAt: {
        type: Date,
        default: Date.now,
      },
    }],
  },
  {
    timestamps: true,
    strict: true,
    collection: 'User',
  },
)

// Add custom indexes
userSchema.index({ type: 1, expireAt: 1, fullName: 1 })
// GA-PAR-22: serves both the live lists (`deletedAt: null`) and the
// trash view (`deletedAt: { $ne: null }`) per agency.
userSchema.index({ supplier: 1, deletedAt: 1 })
userSchema.index({ type: 1, expireAt: 1, email: 1 })
userSchema.index({ type: 1, expireAt: 1, fullName: 1, _id: 1 })
userSchema.index({ type: 1, expireAt: 1, email: 1, _id: 1 })

const User = model<env.User>('User', userSchema)

export default User
