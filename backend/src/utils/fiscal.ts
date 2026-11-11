/**
 * GA-PAR-01 — agency fiscal identity + VAT helpers.
 *
 * Fiscal fields live on the supplier (User type=Supplier) record, following
 * the codebase pattern where agency-level configuration is stored on the
 * supplier. These helpers centralise the validation the task requires:
 * strings are trimmed and length-capped, vatRate must be within 0–100.
 */

export interface FiscalFields {
  ice?: string
  registreCommerce?: string
  identifiantFiscal?: string
  patente?: string
  rib?: string
  fiscalAddress?: string
  city?: string
  vatEnabled?: boolean
  vatRate?: number | null
}

export const FISCAL_STRING_LIMITS: Record<string, number> = {
  ice: 50,
  registreCommerce: 100,
  identifiantFiscal: 50,
  patente: 50,
  rib: 34,
  fiscalAddress: 500,
  city: 100,
}

export const FISCAL_STRING_KEYS = Object.keys(FISCAL_STRING_LIMITS)

export const DEFAULT_VAT_RATE = 20

export type FiscalNormalizeResult =
  | { ok: true, value: Partial<FiscalFields>, present: Set<string> }
  | { ok: false, error: string }

/**
 * Validate and normalise the fiscal fields present on an incoming payload.
 * Only keys actually present on the input are returned (in `value` and
 * `present`), so callers can distinguish "not provided" (leave unchanged)
 * from "provided empty" (clear the stored value).
 */
export const normalizeFiscalFields = (input: Record<string, unknown> | undefined | null): FiscalNormalizeResult => {
  const value: Partial<FiscalFields> = {}
  const present = new Set<string>()
  if (!input) {
    return { ok: true, value, present }
  }

  for (const key of FISCAL_STRING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key) || typeof input[key] === 'undefined') {
      continue
    }
    const raw = input[key]
    if (raw !== null && typeof raw !== 'string') {
      return { ok: false, error: `Invalid fiscal field: ${key}` }
    }
    const trimmed = (raw || '').trim()
    if (trimmed.length > FISCAL_STRING_LIMITS[key]) {
      return { ok: false, error: `Fiscal field too long: ${key}` }
    }
    present.add(key)
    ;(value as Record<string, unknown>)[key] = trimmed === '' ? undefined : trimmed
  }

  if (Object.prototype.hasOwnProperty.call(input, 'vatEnabled') && typeof input.vatEnabled !== 'undefined') {
    if (typeof input.vatEnabled !== 'boolean') {
      return { ok: false, error: 'Invalid fiscal field: vatEnabled' }
    }
    present.add('vatEnabled')
    value.vatEnabled = input.vatEnabled
  }

  if (Object.prototype.hasOwnProperty.call(input, 'vatRate') && typeof input.vatRate !== 'undefined') {
    const raw = input.vatRate
    if (raw === null || raw === '') {
      present.add('vatRate')
      value.vatRate = null
    } else {
      const rate = Number(raw)
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return { ok: false, error: 'Invalid fiscal field: vatRate must be between 0 and 100' }
      }
      present.add('vatRate')
      value.vatRate = rate
    }
  }

  return { ok: true, value, present }
}

/**
 * Apply normalised fiscal fields onto a supplier document. When VAT is
 * enabled and no explicit rate is stored afterwards, the Moroccan standard
 * rate (20%) is stored explicitly, as GA-PAR-01 requires.
 */
export const applyFiscalFields = (target: Record<string, any>, result: Extract<FiscalNormalizeResult, { ok: true }>) => {
  const { value, present } = result
  for (const key of present) {
    target[key] = (value as Record<string, unknown>)[key]
  }
  if (target.vatEnabled && (target.vatRate === undefined || target.vatRate === null)) {
    target.vatRate = DEFAULT_VAT_RATE
  }
}
