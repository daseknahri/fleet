import * as env from '../config/env.config'

/** R3-07 / R5-07 — the start of the current Africa/Casablanca wall day,
 *  as a UTC instant: TRUE local midnight (00:00 on the Casablanca wall
 *  clock), not midnight UTC of the wall date. In winter (UTC+0) the two
 *  coincide; in summer (UTC+1) true midnight is 23:00Z the previous
 *  day. Built on the same Intl.DateTimeFormat wall-parts approach as
 *  autoReminders.dateKey (GH-22) — never the process-local start of
 *  day, which is UTC in the container and disagrees with the business
 *  day for one hour a night in summer.
 *
 *  The offset is resolved with the standard two-step: take the wall
 *  date as a naive UTC instant, read the zone offset at that instant
 *  from the wall parts, subtract it, and refine once (a DST transition
 *  sitting on midnight would move the first estimate). */
export const CASABLANCA_TIMEZONE = 'Africa/Casablanca'

type WallParts = { year: number, month: number, day: number, hour: number, minute: number, second: number }

const casablancaWallParts = (instant: Date): WallParts => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CASABLANCA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** Zone offset (wall time minus UTC) at an instant, in milliseconds. */
const casablancaOffsetMs = (instant: Date): number => {
  const p = casablancaWallParts(instant)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime()
}

/** True local-midnight instant for a wall date (year/month/day). */
const casablancaDayStartForWall = (year: number, month: number, day: number): Date => {
  const naive = Date.UTC(year, month - 1, day)
  const first = new Date(naive - casablancaOffsetMs(new Date(naive)))
  // One refinement pass: if the offset at the first estimate differs
  // (DST transition on midnight), the refined instant is exact.
  return new Date(naive - casablancaOffsetMs(first))
}

export const casablancaTodayStart = (now: Date = new Date()): Date => {
  const p = casablancaWallParts(now)
  return casablancaDayStartForWall(p.year, p.month, p.day)
}

/** R5-07 — the Casablanca wall day containing `date`, as a half-open
 *  [start, end) pair of UTC instants: start is true local midnight of
 *  the wall date, end is true local midnight of the next wall date
 *  (a wall day is 23/25 h across a DST transition, never assumed 24 h). */
export const casablancaDayBounds = (date: Date = new Date()): [Date, Date] => {
  const p = casablancaWallParts(date)
  const start = casablancaDayStartForWall(p.year, p.month, p.day)
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1))
  return [start, casablancaDayStartForWall(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())]
}

/** R5-07 — the ISO week (Monday–Sunday) containing `date` on the
 *  Casablanca WALL calendar, as a half-open [start, end) pair of UTC
 *  instants: Monday 00:00 local to next Monday 00:00 local. Built from
 *  wall dates, never from getUTCDay() on an instant — a true-midnight
 *  instant sits at 23:00Z the previous UTC day in summer, so the old
 *  arithmetic (autoReminders weekStart) would have pointed at the
 *  previous Monday. */
export const casablancaWeekBounds = (date: Date = new Date()): [Date, Date] => {
  const p = casablancaWallParts(date)
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day)
  const daysSinceMonday = (new Date(wallAsUtc).getUTCDay() + 6) % 7
  const monday = new Date(wallAsUtc - daysSinceMonday * 86400000)
  const nextMonday = new Date(wallAsUtc + (7 - daysSinceMonday) * 86400000)
  return [
    casablancaDayStartForWall(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()),
    casablancaDayStartForWall(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth() + 1, nextMonday.getUTCDate()),
  ]
}

/** R5-09 — the Casablanca wall date of an instant, 'YYYY-MM-DD'.
 *  The single wall-clock helper: workOrderStale.ts used to carry its
 *  own copy — it now imports this one, so a timezone correction can
 *  never desynchronise the stale-day badge from the past-pickup math. */
export const wallDay = (date: Date | string): string => {
  const p = casablancaWallParts(new Date(date))
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}
