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
