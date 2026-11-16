/**
 * F8 / W5 S5 — IBAN (ISO 13616 mod-97) and SWIFT/BIC validation,
 * shared by the bank-details upsert endpoint. The admin form mirrors
 * the same rules in its zod schema (admin/src/models/BankDetailsForm.ts);
 * the two copies are deliberately identical so the rule is testable in
 * the backend suite and not bypassable by a direct API call.
 */

/** IBAN: structure check + mod-97 (rearranged value % 97 === 1). */
export const isValidIban = (value: string): boolean => {
  const v = value.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(v)) {
    return false
  }
  const rearranged = v.slice(4) + v.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 55 : Number(ch)
    if (code >= 10) {
      // Two digits: feed them one at a time to avoid overflow.
      remainder = (remainder * 10 + Math.floor(code / 10)) % 97
      remainder = (remainder * 10 + (code % 10)) % 97
    } else {
      remainder = (remainder * 10 + code) % 97
    }
  }
  return remainder === 1
}

/** SWIFT/BIC: 8 or 11 chars — 6-letter bank+country code, then 2 (or 5) alphanumerics. */
export const isValidSwiftBic = (value: string): boolean => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value.replace(/\s+/g, '').toUpperCase())
