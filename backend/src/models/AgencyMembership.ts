import { Schema, model } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'

const agencyMembershipSchema = new Schema<env.AgencyMembership>(
  {
    supplier: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'User',
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'User',
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(bookcarsTypes.AgencyRole),
      required: [true, "can't be blank"],
    },
    status: {
      type: String,
      enum: Object.values(bookcarsTypes.AgencyMembershipStatus),
      default: bookcarsTypes.AgencyMembershipStatus.Active,
      required: true,
      index: true,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    activatedAt: Date,
    suspendedAt: Date,
  },
  {
    timestamps: true,
    strict: true,
    collection: 'AgencyMembership',
  },
)

agencyMembershipSchema.index({ supplier: 1, user: 1 }, { unique: true })
agencyMembershipSchema.index({ user: 1, status: 1 })

const AgencyMembership = model<env.AgencyMembership>('AgencyMembership', agencyMembershipSchema)

export default AgencyMembership
