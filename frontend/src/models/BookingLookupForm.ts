import { z } from 'zod'

export const schema = z.object({
  reference: z.string().trim().min(1),
  email: z.string().trim().email(),
})

export type FormFields = z.infer<typeof schema>
