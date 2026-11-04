import crypto from 'node:crypto'
import path from 'node:path'
import * as env from '../config/env.config'

const CAPABILITY_PURPOSE = 'checkout-license'
const CAPABILITY_PARTS = 3

const sign = (nonce: string, expiresAt: string, extension: string) => (
  crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`${CAPABILITY_PURPOSE}.${nonce}.${expiresAt}.${extension}`)
    .digest('base64url')
)

/**
 * Create a bearer filename for an anonymous checkout license upload.
 * The filename contains no customer data and expires with TOKEN_EXPIRE_AT.
 */
export const createLicenseCapabilityFilename = (extension: string) => {
  const normalizedExtension = extension.toLowerCase()
  const nonce = crypto.randomBytes(24).toString('base64url')
  const expiresAt = String(Math.floor(Date.now() / 1000) + env.TOKEN_EXPIRE_AT)
  const signature = sign(nonce, expiresAt, normalizedExtension)
  return `${nonce}.${expiresAt}.${signature}${normalizedExtension}`
}

/** Validate a capability filename without touching the filesystem. */
export const isValidLicenseCapabilityFilename = (filename: string) => {
  if (!filename || filename !== path.basename(filename) || filename.includes('\0')) {
    return false
  }

  const extension = path.extname(filename).toLowerCase()
  const stem = extension ? filename.slice(0, -extension.length) : filename
  const parts = stem.split('.')
  if (parts.length !== CAPABILITY_PARTS) {
    return false
  }

  const [nonce, expiresAt, providedSignature] = parts
  if (!nonce || !/^\d+$/.test(expiresAt) || !providedSignature) {
    return false
  }

  const expectedSignature = sign(nonce, expiresAt, extension)
  const provided = Buffer.from(providedSignature)
  const expected = Buffer.from(expectedSignature)
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return false
  }

  return Number(expiresAt) >= Math.floor(Date.now() / 1000)
}
