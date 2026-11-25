import * as UserService from '@/services/UserService'

/**
 * R2-A13 - the one customer date helper (same convention as admin P1-5).
 * Every customer-facing date/time renders in Africa/Casablanca with a
 * 24-hour clock. The timezone label itself is a lang string appended by
 * the call site (commonStrings.TIMEZONE_MOROCCO) - never baked into the
 * helper, so the label stays localised. Invalid / missing input renders
 * '-' (never 'Invalid Date').
 */
export const CASABLANCA_TIMEZONE = 'Africa/Casablanca'

export const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}

const toDate = (value: Date | string | undefined | null): Date | null => {
  if (value === undefined || value === null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Date + time, e.g. ven. 24 nov. 2026, 14:30 / Tue, 24 Nov 2026, 14:30. */
export const formatDateTimeCasablanca = (value: Date | string | undefined | null): string => {
  const d = toDate(value)
  return d
    ? new Intl.DateTimeFormat(uiLocale(), { timeZone: CASABLANCA_TIMEZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
    : '\u2014'
}

/** Date only, e.g. 24/11/2026 - Casablanca day-parts, never browser-local. */
export const formatDateCasablanca = (value: Date | string | undefined | null): string => {
  const d = toDate(value)
  return d
    ? new Intl.DateTimeFormat(uiLocale(), { timeZone: CASABLANCA_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
    : '\u2014'
}
