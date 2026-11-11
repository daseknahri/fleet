/**
 * GA-PAR-04 — client identity pack helpers.
 *
 * Identity fields live on the customer record (User with type=User): CIN,
 * passport and licence numbers with their expiry dates, the client type
 * (individual/company) and the client workflow status. Following the
 * GA-PAR-01 fiscal pattern, these helpers centralise validation:
 *  - string numbers are trimmed and length-capped;
 *  - expiry values must parse as real dates — a malformed date is a
 *    field-level error (the controller answers 400 naming the field);
 *    past expiries are VALID and stored (they display as expired);
 *  - clientType / clientStatus must be members of their enums;
 *  - `clientStatus` is a new, separate field (decision N5): nothing here
 *    ever reads or writes `blacklisted` / `active`.
 */
import * as bookcarsTypes from ':bookcars-types'

export interface ClientIdentityFields {
  cinNumber?: string
  cinExpiry?: Date | null
  passportNumber?: string
  passportExpiry?: Date | null
  licenseNumber?: string
  licenseExpiry?: Date | null
  clientType?: bookcarsTypes.ClientType
  clientStatus?: bookcarsTypes.ClientStatus
}

export const CLIENT_IDENTITY_STRING_LIMITS: Record<string, number> = {
  cinNumber: 50,
  passportNumber: 50,
  licenseNumber: 50,
}

export const CLIENT_IDENTITY_DATE_KEYS = ['cinExpiry', 'passportExpiry', 'licenseExpiry'] as const

export const CLIENT_IDENTITY_KEYS = [
  ...Object.keys(CLIENT_IDENTITY_STRING_LIMITS),
  ...CLIENT_IDENTITY_DATE_KEYS,
  'clientType',
  'clientStatus',
]

export type ClientIdentityNormalizeResult =
  | { ok: true, value: Partial<ClientIdentityFields>, present: Set<string> }
  | { ok: false, error: string, field: string }

/**
 * Validate and normalise the identity fields present on an incoming
 * payload. Only keys actually present are returned (in `value` and
 * `present`) so callers keep partial-PUT preservation (H-026): "not
 * provided" leaves the stored value untouched, `null`/empty clears it.
 */
export const normalizeClientIdentityFields = (
  input: Record<string, unknown> | undefined | null,
): ClientIdentityNormalizeResult => {
  const value: Partial<ClientIdentityFields> = {}
  const present = new Set<string>()
  if (!input) {
    return { ok: true, value, present }
  }

  for (const key of Object.keys(CLIENT_IDENTITY_STRING_LIMITS)) {
    if (!Object.prototype.hasOwnProperty.call(input, key) || typeof input[key] === 'undefined') {
      continue
    }
    const raw = input[key]
    if (raw !== null && typeof raw !== 'string') {
      return { ok: false, error: `Invalid client identity field: ${key}`, field: key }
    }
    const trimmed = (raw || '').trim()
    if (trimmed.length > CLIENT_IDENTITY_STRING_LIMITS[key]) {
      return { ok: false, error: `Client identity field too long: ${key}`, field: key }
    }
    present.add(key)
    ;(value as Record<string, unknown>)[key] = trimmed === '' ? undefined : trimmed
  }

  for (const key of CLIENT_IDENTITY_DATE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key) || typeof input[key] === 'undefined') {
      continue
    }
    const raw = input[key]
    if (raw === null || raw === '') {
      present.add(key)
      ;(value as Record<string, unknown>)[key] = null
      continue
    }
    const date = raw instanceof Date ? raw : new Date(raw as string)
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: `Invalid date for field: ${key}`, field: key }
    }
    present.add(key)
    ;(value as Record<string, unknown>)[key] = date
  }

  if (Object.prototype.hasOwnProperty.call(input, 'clientType') && typeof input.clientType !== 'undefined') {
    const raw = input.clientType
    if (raw === null || raw === '') {
      present.add('clientType')
      value.clientType = undefined
    } else if (!Object.values(bookcarsTypes.ClientType).includes(raw as bookcarsTypes.ClientType)) {
      return { ok: false, error: 'Invalid client identity field: clientType', field: 'clientType' }
    } else {
      present.add('clientType')
      value.clientType = raw as bookcarsTypes.ClientType
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'clientStatus') && typeof input.clientStatus !== 'undefined') {
    const raw = input.clientStatus
    if (raw === null || raw === '') {
      present.add('clientStatus')
      value.clientStatus = undefined
    } else if (!Object.values(bookcarsTypes.ClientStatus).includes(raw as bookcarsTypes.ClientStatus)) {
      return { ok: false, error: 'Invalid client identity field: clientStatus', field: 'clientStatus' }
    } else {
      present.add('clientStatus')
      value.clientStatus = raw as bookcarsTypes.ClientStatus
    }
  }

  return { ok: true, value, present }
}

/** Apply normalised identity fields onto a user document (present keys only). */
export const applyClientIdentityFields = (
  target: Record<string, any>,
  result: Extract<ClientIdentityNormalizeResult, { ok: true }>,
) => {
  const { value, present } = result
  for (const key of present) {
    target[key] = (value as Record<string, unknown>)[key]
  }
}
