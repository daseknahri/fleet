import { z } from 'zod'
import isMobilePhone from 'validator/es/lib/isMobilePhone'
import { strings as commonStrings } from '@/lang/common'

export const schema = z.object({
    fullName: z.string(),
    email: z.string().email({ message: commonStrings.EMAIL_NOT_VALID }),
    phone: z.string().refine((val) => !val || isMobilePhone(val), { message: commonStrings.PHONE_NOT_VALID }).optional(),
    location: z.string().optional(),
    bio: z.string().optional(),
    blacklisted: z.boolean().optional(),
    payLater: z.boolean().optional(),
    licenseRequired: z.boolean().optional(),
    minimumRentalDays: z.string().refine((val) => !val || /^\d+$/.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
    priceChangeRate: z.string().refine((val) => !val || /^-?\d+(\.\d+)?$/.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
    supplierCarLimit: z.string().refine((val) => !val || /^\d+$/.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
    notifyAdminOnNewCar: z.boolean().optional(),
    ice: z.string().max(50, { message: commonStrings.FIELD_NOT_VALID }).optional(),
    registreCommerce: z.string().max(100, { message: commonStrings.FIELD_NOT_VALID }).optional(),
    identifiantFiscal: z.string().max(50, { message: commonStrings.FIELD_NOT_VALID }).optional(),
    patente: z.string().max(50, { message: commonStrings.FIELD_NOT_VALID }).optional(),
    rib: z.string().max(34, { message: commonStrings.FIELD_NOT_VALID }).optional(),
    fiscalAddress: z.string().max(500, { message: commonStrings.FIELD_NOT_VALID }).optional(),
    city: z.string().max(100, { message: commonStrings.FIELD_NOT_VALID }).optional(),
    vatEnabled: z.boolean().optional(),
    vatRate: z.string().refine((val) => !val || (/^\d+(\.\d+)?$/.test(val) && Number(val) >= 0 && Number(val) <= 100), { message: commonStrings.FIELD_NOT_VALID }).optional()
})

export type FormFields = z.infer<typeof schema>
