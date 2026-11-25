import { Schema, model } from 'mongoose'
import * as env from '../config/env.config'

const pushTokenSchema = new Schema<env.PushToken>(
  {
    user: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'User',
      index: true,
    },
    token: {
      type: String,
      required: [true, "can't be blank"],
    },
    // GH-23 - consecutive-failure counting for dead-token pruning.
    // Reset to 0 on any successful send and on re-registration.
    consecutiveFailures: { type: Number, default: 0, min: 0 },
    lastFailureAt: { type: Date },
    lastFailureReason: { type: String, trim: true, maxlength: 1000 },
  },
  {
    timestamps: true,
    strict: true,
    collection: 'PushToken',
  },
)

const PushToken = model<env.PushToken>('PushToken', pushTokenSchema)

export default PushToken
