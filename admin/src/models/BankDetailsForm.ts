import { z } from 'zod'
import { strings as commonStrings } from '@/lang/common'

// F8 / W5 S5 — IBAN (ISO 13616 mod-97) and SWIFT/BIC validation,
// mirrored server-side in backend/src/utils/bankValidation.ts.
// Empty stays allowed by zod (the form's HTML `required` still blocks
// an empty submit in the browser); a non-empty value must be valid.
const isValidIban = (value: string): boolean => {
  const v = value.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(v)) {
    return false
  }
  const rearranged = v.slice(4) + v.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 55 : Number(ch)
    if (code >= 10) {
      remainder = (remainder * 10 + Math.floor(code / 10)) % 97
      remainder = (remainder * 10 + (code % 10)) % 97
    } else {
      remainder = (remainder * 10 + code) % 97
    }
  }
  return remainder === 1
}

const isValidSwiftBic = (value: string): boolean => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value.replace(/\s+/g, '').toUpperCase())

export const schema = z.object({
    accountHolder: z.string(),
    bankName: z.string(),
    iban: z.string().refine((val) => !val || isValidIban(val), { message: commonStrings.FIELD_NOT_VALID }),
    swiftBic: z.string().refine((val) => !val || isValidSwiftBic(val), { message: commonStrings.FIELD_NOT_VALID }),
    showBankDetailsPage: z.boolean(),
})

export type FormFields = z.infer<typeof schema>
