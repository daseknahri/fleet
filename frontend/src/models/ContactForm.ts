import { z } from 'zod'
import { strings as commonStrings } from '@/lang/common'

export const schema = z.object({
  email: z.string().email({ message: commonStrings.EMAIL_NOT_VALID }),
  subject: z.string().min(1, { message: commonStrings.REQUIRED_FIELD }),
  message: z.string().min(1, { message: commonStrings.REQUIRED_FIELD }),
})

export type FormFields = z.infer<typeof schema>
