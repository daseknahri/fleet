import { z } from 'zod'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import { strings } from '@/lang/create-car'
import { strings as commonStrings } from '@/lang/common'
import env from '@/config/env.config'
import { supplierSchema, optionSchema } from '@/models/common'

const numberRegex = /^\d+(\.\d+)?$/

const dateBasedPriceSchema = z.object({
  _id: z.string().optional(),
  startDate: z.date().nullable(),
  endDate: z.date().nullable(),
  dailyPrice: z.string()
    .refine((val) => !isNaN(Number(val)), { message: commonStrings.REQUIRED }),
})

export type DateBasedPrice = z.infer<typeof dateBasedPriceSchema>

export const schema = z.object({
  name: z.string(),
  licensePlate: z.string().optional(),
  supplier: supplierSchema.optional(),
  minimumAge: z.string()
    .refine((val) => !val || /^\d{2}$/.test(val), { message: commonStrings.FIELD_NOT_VALID })
    .refine(
      (val) => {
        if (!val) {
          return true // if no value is provided, skip the validation
        }
        const age = Number.parseInt(val, 10)
        return age >= env.MINIMUM_AGE && age <= 99
      },
      { message: strings.MINIMUM_AGE_NOT_VALID }
    ),
  locations: z.array(optionSchema),
  dailyPrice: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }),
  discountedDailyPrice: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  hourlyPrice: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }),
  discountedHourlyPrice: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  biWeeklyPrice: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  discountedBiWeeklyPrice: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  weeklyPrice: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  discountedWeeklyPrice: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  monthlyPrice: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  discountedMonthlyPrice: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  deposit: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }),
  available: z.boolean(),
  fullyBooked: z.boolean(),
  comingSoon: z.boolean(),
  // Fleet statuses (scorecard #15): operator-set state of the car.
  operationalStatus: z.nativeEnum(bookcarsTypes.CarOperationalStatus),
  blockOnPay: z.boolean(),
  type: z.string(),
  gearbox: z.string(),
  seats: z.string(),
  doors: z.string(),
  aircon: z.boolean(),
  mileage: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  fuelPolicy: z.string(),
  cancellation: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  amendments: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  theftProtection: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  collisionDamageWaiver: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  fullInsurance: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  additionalDriver: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  range: z.string(),
  multimedia: z.array(z.enum([...bookcarsHelper.getAllMultimedias()] as [string, ...string[]])).optional(),
  rating: z.string().optional(),
  co2: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  tankCapacityLitres: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  // GA-PAR-08: financing block (flat form fields, assembled into the
  // financing sub-object at payload time) + document expiry dates.
  financingType: z.string().optional(),
  financingPurchasePrice: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  financingLender: z.string().optional(),
  financingInstalmentAmount: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  financingDownPayment: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  financingDurationMonths: z.string().refine((val) => !val || /^\d+$/.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  financingFirstDueDate: z.date().optional().nullable(),
  financingNextDueDate: z.date().optional().nullable(),
  financingRemainingAmount: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  financingAutoDebit: z.boolean().optional(),
  insuranceExpiryDate: z.date().optional().nullable(),
  technicalInspectionExpiryDate: z.date().optional().nullable(),
  vignetteExpiryDate: z.date().optional().nullable(),
  // Scorecard #17: garage block (flat form fields, assembled into the
  // garage sub-object at payload time). Name 1–200 chars when set
  // (enforced server-side; the form only requires the date order).
  garageName: z.string().optional(),
  garageSince: z.date().optional().nullable(),
  garageExpectedBack: z.date().optional().nullable(),
  // Scorecard #18: service state (flat form fields, assembled into the
  // service sub-object at payload time). Km values are numbers >= 0
  // (enforced server-side); the form only requires the next >= last
  // order per pair.
  serviceLastOilChangeKm: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  serviceLastFilterChangeKm: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  serviceNextOilChangeKm: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  serviceNextFilterChangeKm: z.string().refine((val) => !val || numberRegex.test(val), { message: commonStrings.FIELD_NOT_VALID }).optional(),
  isDateBasedPrice: z.boolean(),
  dateBasedPrices: z.array(dateBasedPriceSchema).optional(),
}).superRefine((data, ctx) => {
  // Scorecard #17: expected back must not precede since.
  if (data.garageSince && data.garageExpectedBack && data.garageExpectedBack < data.garageSince) {
    ctx.addIssue({
      code: 'custom',
      path: ['garageExpectedBack'],
      message: strings.GARAGE_DATES_NOT_VALID,
    })
  }
  // Scorecard #18: next change km must not precede the last change km, per pair.
  if (data.serviceLastOilChangeKm && data.serviceNextOilChangeKm && Number(data.serviceNextOilChangeKm) < Number(data.serviceLastOilChangeKm)) {
    ctx.addIssue({
      code: 'custom',
      path: ['serviceNextOilChangeKm'],
      message: strings.SERVICE_KM_NOT_VALID,
    })
  }
  if (data.serviceLastFilterChangeKm && data.serviceNextFilterChangeKm && Number(data.serviceNextFilterChangeKm) < Number(data.serviceLastFilterChangeKm)) {
    ctx.addIssue({
      code: 'custom',
      path: ['serviceNextFilterChangeKm'],
      message: strings.SERVICE_KM_NOT_VALID,
    })
  }
})

export type FormFields = z.infer<typeof schema>
