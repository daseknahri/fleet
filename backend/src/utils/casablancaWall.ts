/**
 * R6-05 - the Casablanca wall-calendar primitives, in a module with NO
 * imports of its own. `helper.ts` needs the wall-day count for `days`,
 * but it cannot import `casablancaDate.ts`: that module imports
 * `env.config`, which calls `helper.StringToBoolean` at module
 * evaluation time, so the cycle would throw at startup. The wall-parts
 * math therefore lives here; `casablancaDate.ts` imports it (and
 * re-exports `wallDay`, so every existing
 * `import { wallDay } from '../utils/casablancaDate'` keeps working)
 * and `helper.ts` imports `wallDaysBetween` from here.
 * `packages/bookcars-helper` cannot import backend code at all, so it
 * carries its own copy of the same rule (see the comment there) - the
 * two copies must stay in sync.
 */

export const CASABLANCA_TIMEZONE = 'Africa/Casablanca'

export type WallParts = { year: number, month: number, day: number, hour: number, minute: number, second: number }

export const casablancaWallParts = (instant: Date): WallParts => {
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

/**
 * R5-09 - the Casablanca wall date of an instant, 'YYYY-MM-DD'.
 * The single wall-clock helper: workOrderStale.ts used to carry its
 * own copy - it now imports this one, so a timezone correction can
 * never desynchronise the stale-day badge from the past-pickup math.
 */
export const wallDay = (date: Date | string): string => {
  const p = casablancaWallParts(new Date(date))
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/**
 * R6-05 - whole wall days between two instants on the Casablanca wall
 * calendar: ceil of the wall-clock elapsed time (the wall parts read
 * as a naive UTC instant), NOT ceil of real elapsed milliseconds. A
 * wall day is 23/25 real hours across a DST transition, so the old
 * `ceil(elapsedMs / 86400000)` charged 2 days for a 1-wall-day rental
 * spanning a fall-back night (10:00 local Sat -> 10:00 local Sun is 25
 * real hours). This equals `wallDay(to) - wallDay(from)` in days, plus
 * the partial-day rule the hourly branch already encodes: a rental
 * that ends part-way into a wall day counts that partial day (the
 * wall-time of `to` past the wall-time of `from` pushes the ceil over
 * the whole-day boundary). A spring-forward night (23 real hours for
 * 24 wall hours) still counts 1. An inverted range stays <= 0 - the
 * caller (`daysOrZero`) floors it.
 */
export const wallDaysBetween = (from: Date | string, to: Date | string): number => {
  const fromWall = casablancaWallParts(new Date(from))
  const toWall = casablancaWallParts(new Date(to))
  const fromMs = Date.UTC(fromWall.year, fromWall.month - 1, fromWall.day, fromWall.hour, fromWall.minute, fromWall.second)
  const toMs = Date.UTC(toWall.year, toWall.month - 1, toWall.day, toWall.hour, toWall.minute, toWall.second)
  return Math.ceil((toMs - fromMs) / 86400000)
}
