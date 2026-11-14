import crypto from 'node:crypto'

/**
 * GA-Q4-1 — per-agency editable contract terms (FR + AR).
 *
 * Terms live on the supplier (User type=Supplier) record, following the
 * PAR-01 fiscal-identity pattern: flat optional strings, trimmed and
 * length-capped, validated here (never trusted from the client).
 * Empty is allowed (no terms yet); absent in an update payload means
 * "leave unchanged", present-but-empty means "clear" — the same
 * present/undefined semantics as utils/fiscal.ts.
 *
 * The snapshot hash is SHA-256 over the canonical form
 * "<FR>\n<AR>" (missing side = empty string). The hash is stored on the
 * ContractSnapshot at issue so a reprint can be proven to carry the
 * terms as issued: recompute from the stored termsFr/termsAr and
 * compare with the stored termsSha256.
 */
export const CONTRACT_TERMS_MAX_LENGTH = 20000

export const CONTRACT_TERMS_KEYS = ['contractTermsFr', 'contractTermsAr'] as const

export type ContractTermsNormalizeResult =
  | { ok: true, value: { contractTermsFr?: string, contractTermsAr?: string }, present: Set<string> }
  | { ok: false, error: string }

export const normalizeContractTerms = (input: Record<string, unknown> | undefined | null): ContractTermsNormalizeResult => {
  const value: { contractTermsFr?: string, contractTermsAr?: string } = {}
  const present = new Set<string>()
  if (!input) {
    return { ok: true, value, present }
  }
  for (const key of CONTRACT_TERMS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key) || typeof input[key] === 'undefined') {
      continue
    }
    const raw = input[key]
    if (raw !== null && typeof raw !== 'string') {
      return { ok: false, error: `Invalid contract terms field: ${key}` }
    }
    const trimmed = (raw || '').trim()
    if (trimmed.length > CONTRACT_TERMS_MAX_LENGTH) {
      return { ok: false, error: `Contract terms field too long: ${key}` }
    }
    present.add(key)
    ;(value as Record<string, unknown>)[key] = trimmed === '' ? undefined : trimmed
  }
  return { ok: true, value, present }
}

export const contractTermsSha256 = (fr: string | null | undefined, ar: string | null | undefined): string =>
  crypto.createHash('sha256').update(`${fr || ''}\n${ar || ''}`, 'utf8').digest('hex')
