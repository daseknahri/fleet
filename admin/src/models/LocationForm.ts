import { z } from 'zod'
import { optionSchema, supplierSchema } from '@/models/common'
import { strings as commonStrings } from '@/lang/common'

// F5b (W2-20): coordinates are optional (empty = no coordinates) but,
// when provided, must be finite numbers in range — latitude -90..90,
// longitude -180..180. Same rule as the server-side
// invalidCoordinateField in utils/locationHelper.
const coordinateSchema = (min: number, max: number) => z.string().refine((val) => {
  if (!val) {
    return true
  }
  const num = Number(val)
  return Number.isFinite(num) && num >= min && num <= max
}, { message: commonStrings.FIELD_NOT_VALID })

const locationNameSchema = z.object({
  language: z.string(),
  name: z.string(),
})

const locationValueSchema = z.object({
  language: z.string(),
  value: z.string(),
})

const parkingSpotSchema = z.object({
  latitude: coordinateSchema(-90, 90),
  longitude: coordinateSchema(-180, 180),
  values: z.array(locationValueSchema).optional(),
})

export type ParkingSpot = z.infer<typeof parkingSpotSchema>

export const schema = z.object({
  country: optionSchema.optional(),
  supplier: supplierSchema.optional(),
  names: z.array(locationNameSchema),
  latitude: coordinateSchema(-90, 90).optional(),
  longitude: coordinateSchema(-180, 180).optional(),
  image: z.string().optional(),
  parkingSpots: z.array(parkingSpotSchema).optional(),
  parentLocation: optionSchema.optional(),
})

export type FormFields = z.infer<typeof schema>
