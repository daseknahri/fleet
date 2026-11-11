import crypto from 'node:crypto'
import * as env from '../config/env.config'

/**
 * GA-PAR-12 — online client signing capability tokens.
 *
 * This mirrors the established capability pattern of
 * `utils/tempFileCapability.ts` (H-005 decided pattern): an
 * HMAC-SHA256 MAC keyed by `env.JWT_SECRET`, a purpose string, an
 * expiry taken from `TOKEN_EXPIRE_AT` (86 400 s), and
 * `timingSafeEqual` validation. The payload binds exactly
 * bookingId + nonce + exp — no password, session or JWT material ever
 * appears in a signing URL.
 *
 * Known coupling (accepted for GA-PAR-12, flagged in the builder
 * report): because the MAC key is `JWT_SECRET`, rotating that secret
 * invalidates every outstanding signing link together with all
 * sessions. Revocation does NOT depend on the secret: the per-booking
 * `Booking.signingNonce` is the revocation anchor — rotating it kills
 * every outstanding link for that booking instantly.
 */

const SIGNING_PURPOSE = 'booking-sign'
const TOKEN_PARTS = 4

const sign = (bookingId: string, nonce: string, expiresAt: string) => (
  crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`${SIGNING_PURPOSE}.${bookingId}.${nonce}.${expiresAt}`)
    .digest('base64url')
)

/** A fresh server-side nonce for a booking's signing links. */
export const newSigningNonce = () => crypto.randomBytes(24).toString('base64url')

/**
 * Mint a signing token over the booking's CURRENT nonce. The token is
 * the only credential the public signing surface checks.
 */
export const createSigningToken = (bookingId: string, nonce: string) => {
  const expiresAt = Math.floor(Date.now() / 1000) + env.TOKEN_EXPIRE_AT
  const signature = sign(bookingId, nonce, String(expiresAt))
  return {
    token: `${bookingId}.${nonce}.${expiresAt}.${signature}`,
    expiresAt: new Date(expiresAt * 1000),
  }
}

export type ParsedSigningToken = {
  bookingId: string
  nonce: string
  expiresAt: number
}

/**
 * Parse and MAC-validate a signing token. Returns null for ANY defect
 * (shape, MAC, expiry) — callers answer one generic invalid-link error
 * and log specifics server-side only, so the endpoint is not an oracle
 * for which check failed. The nonce is NOT checked here: the caller
 * compares it against the booking's current nonce (and checks the
 * already-signed state first, so a genuine but consumed link can be
 * answered with the distinct already-signed state).
 */
export const parseSigningToken = (token: string): ParsedSigningToken | null => {
  if (!token || typeof token !== 'string' || token.includes('\0')) {
    return null
  }
  const parts = token.split('.')
  if (parts.length !== TOKEN_PARTS) {
    return null
  }
  const [bookingId, nonce, expiresAt, providedSignature] = parts
  if (!bookingId || !nonce || !/^\d+$/.test(expiresAt) || !providedSignature) {
    return null
  }
  const expectedSignature = sign(bookingId, nonce, expiresAt)
  const provided = Buffer.from(providedSignature)
  const expected = Buffer.from(expectedSignature)
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null
  }
  if (Number(expiresAt) < Math.floor(Date.now() / 1000)) {
    return null
  }
  return { bookingId, nonce, expiresAt: Number(expiresAt) }
}

/**
 * The only booking-signature shape an API payload may carry: presence
 * plus the signing timestamp. The stored file name and content hash
 * stay server-side.
 */
export const publicOnlineSignature = (
  onlineSignature?: { signedAt?: Date } | null,
): { signedAt: Date } | undefined => (
  onlineSignature?.signedAt ? { signedAt: onlineSignature.signedAt } : undefined
)
