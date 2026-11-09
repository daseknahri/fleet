import { z } from 'zod'
import { strings as commonStrings } from '@/lang/common'
import { supplierSchema } from '@/models/common'

const countryNameSchema = z.object({
  language: z.string(),
  name: z.string().min(1, commonStrings.REQUIRED)
})


export const schema = z.object({
  names: z.array(countryNameSchema),
  supplier: supplierSchema.optional()
})

export type FormFields = z.infer<typeof schema>
