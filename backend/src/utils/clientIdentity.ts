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
 *
 * F5b (W2-18 / W2-05): the same treatment extends to the company fields
 * (companyName / companyRegistration / companyContactName) and the
 * consent fields (consentGiven / consentScope). `consentAt` is NOT
 * normalised here: it is server-derived only (consentAtForTransition
 * below) and any payload value is ignored by the controller.
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
  companyName?: string
  companyRegistration?: string
  companyContactName?: string
  consentGiven?: boolean
  consentScope?: string[]
}

export const CLIENT_IDENTITY_STRING_LIMITS: Record<string, number> = {
  cinNumber: 50,
  passportNumber: 50,
  licenseNumber: 50,
  companyName: 100,
  companyRegistration: 100,
  companyContactName: 100,
}

export const CLIENT_IDENTITY_DATE_KEYS = ['cinExpiry', 'passportExpiry', 'licenseExpiry'] as const

/** F5b (W2-05): the consent purposes a client can agree to. */
export const CONSENT_SCOPES = ['marketing', 'processing'] as const

export const CLIENT_IDENTITY_KEYS = [
  ...Object.keys(CLIENT_IDENTITY_STRING_LIMITS),
  ...CLIENT_IDENTITY_DATE_KEYS,
  'clientType',
  'clientStatus',
  'consentGiven',
  'consentScope',
  // `consentAt` is listed so the controller's strip branch (non-customer
  // targets) removes it too — it is never accepted from a payload.
  'consentAt',
]

/**
 * F5b (W2-05): server-side consent timestamp. The client never sends
 * `consentAt` — it is derived from the consent transition: granting
 * consent (false→true) stamps now, withdrawing it (→false) clears the
 * stamp, and an omitted `consentGiven` leaves the stored stamp
 * untouched. Returns `undefined` when the caller should leave the
 * stored value alone.
 */
export const consentAtForTransition = (
  storedConsentGiven: boolean | undefined,
  newConsentGiven: boolean | undefined,
): Date | null | undefined => {
  if (typeof newConsentGiven === 'undefined') {
    return undefined
  }
  if (newConsentGiven) {
    return storedConsentGiven ? undefined : new Date()
  }
  return null
}

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

  // F5b (W2-05): consent. `consentGiven` accepts a boolean, or — for
  // spreadsheet rows — the words yes/no/true/false/1/0. `consentScope`
  // accepts an array of purposes, or a comma-separated string (the
  // import form). Both are validated against the known purposes; an
  // unknown member is a field-level error. `consentAt` is never read
  // here (server-derived; see consentAtForTransition).
  if (Object.prototype.hasOwnProperty.call(input, 'consentGiven') && typeof input.consentGiven !== 'undefined') {
    const raw = input.consentGiven
    if (raw === null || raw === '') {
      present.add('consentGiven')
      value.consentGiven = undefined
    } else if (typeof raw === 'boolean') {
      present.add('consentGiven')
      value.consentGiven = raw
    } else if (typeof raw === 'string') {
      const lowered = raw.trim().toLowerCase()
      if (['true', 'yes', '1'].includes(lowered)) {
        present.add('consentGiven')
        value.consentGiven = true
      } else if (['false', 'no', '0'].includes(lowered)) {
        present.add('consentGiven')
        value.consentGiven = false
      } else {
        return { ok: false, error: 'Invalid consent field: consentGiven', field: 'consentGiven' }
      }
    } else {
      return { ok: false, error: 'Invalid consent field: consentGiven', field: 'consentGiven' }
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'consentScope') && typeof input.consentScope !== 'undefined') {
    const raw = input.consentScope
    if (raw === null || raw === '') {
      present.add('consentScope')
      value.consentScope = []
    } else {
      const members = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(',')
          : null
      if (members === null || members.some((m) => typeof m !== 'string')) {
        return { ok: false, error: 'Invalid consent field: consentScope', field: 'consentScope' }
      }
      const cleaned = [...new Set(members.map((m) => (m as string).trim().toLowerCase()).filter(Boolean))]
      if (cleaned.some((m) => !(CONSENT_SCOPES as readonly string[]).includes(m))) {
        return { ok: false, error: 'Invalid consent field: consentScope', field: 'consentScope' }
      }
      present.add('consentScope')
      value.consentScope = cleaned
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
