import * as env from '../config/env.config'

/** R3-07 — the start of the current Africa/Casablanca wall day, as a
 *  UTC instant. Built on the same Intl.DateTimeFormat wall-parts
 *  approach as autoReminders.dateKey (GH-22) — never the process-local
 *  start of day, which is UTC in the container and disagrees with the
 *  business day for one hour a night in summer. */
export const CASABLANCA_TIMEZONE = 'Africa/Casablanca'

export const casablancaTodayStart = (now: Date = new Date()): Date => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CASABLANCA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return new Date(Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))))
}
