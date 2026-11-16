import { z } from 'zod'
import { strings as commonStrings } from '@/lang/common'

// const numberRegex = /^\d+(\.\d+)?$/
const numberRegex = /^\d+$/

const validateHour = (val: string) => {
  const hour = parseFloat(val)
  return Number.isFinite(hour) && hour >= 0 && hour <= 23
}

export const schema = z.object({
  // F8 / W5 S4 — the old `!val ||` escape let an empty string through,
  // which the form then sent as Number('') = 0. Empty and zero are now
  // rejected: counts must be integers >= 1, hours integers 0-23.
  minPickupHours: z.string().refine((val) => numberRegex.test(val) && Number.parseFloat(val) >= 1, { message: commonStrings.FIELD_NOT_VALID }),
  minRentalHours: z.string().refine((val) => numberRegex.test(val) && Number.parseFloat(val) >= 1, { message: commonStrings.FIELD_NOT_VALID }),
  minPickupDropoffHour: z.string().refine((val) => numberRegex.test(val) && validateHour(val), { message: commonStrings.FIELD_NOT_VALID }),
  maxPickupDropoffHour: z.string().refine((val) => numberRegex.test(val) && validateHour(val), { message: commonStrings.FIELD_NOT_VALID }),
})

export type FormFields = z.infer<typeof schema>
