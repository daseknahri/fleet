import * as env from '../config/env.config'
import { casablancaWallParts } from './casablancaWall'

export { CASABLANCA_TIMEZONE, wallDay } from './casablancaWall'

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
// R6-05 - the wall-parts math + wallDay live in casablancaWall.ts
// (zero-import leaf: helper.ts needs them without the env.config
// cycle). Re-exported above so existing import sites keep working.

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

/** R6-18 — the [start, end) bounds of the Casablanca wall day N days
 *  after (negative N: before) the wall day containing `date`. The
 *  shift is on the wall calendar, never by 24 h chunks: across a DST
 *  transition a wall day is 23/25 h, so `+ N * 86400000` would land
 *  on the wrong wall date. The noon-UTC probe is always inside the
 *  shifted wall day (12:00/13:00 local), so its bounds are the
 *  shifted day's bounds. */
export const casablancaDayBoundsShifted = (date: Date, days: number): [Date, Date] => {
  const p = casablancaWallParts(date)
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days))
  return casablancaDayBounds(new Date(shifted.getTime() + 12 * 3600 * 1000))
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** R6-14 — parse a from/to query pair the way the report range does:
 *  a date-only bound is a Casablanca wall day (from = true local
 *  midnight, to = the last millisecond of that wall day); a full
 *  datetime is taken as-is. `invalid` is true when a supplied bound
 *  does not parse, so each caller keeps its own error. */
export const parseDateRange = (fromRaw?: string, toRaw?: string): { from: Date | null, to: Date | null, invalid: boolean } => {
  let invalid = false
  const parse = (raw: string | undefined, isEnd: boolean): Date | null => {
    if (!raw) {
      return null
    }
    if (DATE_ONLY.test(raw)) {
      const probe = new Date(`${raw}T12:00:00.000Z`)
      if (Number.isNaN(probe.getTime())) {
        invalid = true
        return null
      }
      const [start, end] = casablancaDayBounds(probe)
      return isEnd ? new Date(end.getTime() - 1) : start
    }
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) {
      invalid = true
      return null
    }
    return d
  }
  return { from: parse(fromRaw, false), to: parse(toRaw, true), invalid }
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
