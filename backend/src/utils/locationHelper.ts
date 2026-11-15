import * as env from '../config/env.config'

type LocationTranslation = Pick<env.LocationValue, 'language' | 'value'>

/**
 * Resolve a location name using the requested language and configured fallbacks.
 *
 * F1 / W1 #2: restored from upstream BookCars. Gestion Auto deleted this
 * helper and inlined a bare `[0].value` lookup in `confirm()` and
 * `getBooking`, which throws for any customer whose language has no
 * location value — after payment was captured. The fallback chain is
 * requested language → `en` → first value → `''`, and never throws.
 *
 * @param {LocationTranslation[] | null | undefined} values
 * @param {string} language
 * @returns {string}
 */
export const resolveLocationTranslation = (
  values: ReadonlyArray<LocationTranslation> | null | undefined,
  language: string,
): string => {
  const validValues = values?.filter((value) =>
    value
    && typeof value.language === 'string'
    && typeof value.value === 'string'
    && value.value.trim().length > 0
  ) || []

  return validValues.find((value) => value.language === language)?.value
    || validValues.find((value) => value.language === 'en')?.value
    || validValues[0]?.value
    || ''
}

/**
 * F5b (W2-20): latitude/longitude range validation, shared by the
 * location create/update endpoints (location + parking spots). Coordinates
 * are optional — undefined / null / blank means "no coordinates" and is
 * allowed. Anything else must be a finite number (a numeric string
 * parses) with latitude in -90..90 and longitude in -180..180.
 * Returns the offending field name ('latitude' | 'longitude') or null.
 * There is intentionally NO schema min/max on Location/ParkingSpot:
 * a schema minimum would make ANY later save() of a legacy
 * out-of-range row fail (same reason F5a kept the plate out of the
 * schema as `required`).
 *
 * @param {unknown} latitude
 * @param {unknown} longitude
 * @returns {'latitude' | 'longitude' | null}
 */
export const invalidCoordinateField = (
  latitude: unknown,
  longitude: unknown,
): 'latitude' | 'longitude' | null => {
  const check = (value: unknown, field: 'latitude' | 'longitude', min: number, max: number): 'latitude' | 'longitude' | null => {
    if (value === undefined || value === null) {
      return null
    }
    if (typeof value === 'string' && value.trim() === '') {
      return null
    }
    if (typeof value !== 'number' && typeof value !== 'string') {
      return field
    }
    const num = Number(value)
    if (!Number.isFinite(num) || num < min || num > max) {
      return field
    }
    return null
  }
  return check(latitude, 'latitude', -90, 90) ?? check(longitude, 'longitude', -180, 180)
}
