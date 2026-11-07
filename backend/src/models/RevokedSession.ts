import { Schema, model } from 'mongoose'
import * as env from '../config/env.config'

export const REVOKED_SESSION_EXPIRE_AT_INDEX_NAME = 'expireAt'

//
// Server-side JWT revocation denylist (H-007). Sign-out records the
// presented token's session id (sid claim) here; auth verification rejects
// any token whose sid is listed. Entries live only until the revoked token
// would have expired anyway — the TTL index on expireAt deletes them.
//
const revokedSessionSchema = new Schema<env.RevokedSession>(
  {
    sid: {
      type: String,
      required: [true, "can't be blank"],
      unique: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      required: [true, "can't be blank"],
      ref: 'User',
      index: true,
    },
    expireAt: {
      type: Date,
      required: true,
      index: { name: REVOKED_SESSION_EXPIRE_AT_INDEX_NAME, expireAfterSeconds: 0, background: true },
    },
  },
  {
    timestamps: true,
    strict: true,
    collection: 'RevokedSession',
  },
)

const RevokedSession = model<env.RevokedSession>('RevokedSession', revokedSessionSchema)

export default RevokedSession
