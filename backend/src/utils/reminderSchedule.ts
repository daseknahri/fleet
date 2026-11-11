import * as bookcarsTypes from ':bookcars-types'

/**
 * GA-PAR-13 — reminder occurrence engine (pure; no I/O, no clock reads).
 *
 * Convention (stated per the item brief): occurrence instants are
 * computed on the Africa/Casablanca WALL CLOCK for the calendar kinds
 * (monthly / yearly) — the same timezone basis the codebase uses for
 * contract references and display dates (`env.TIMEZONE`, which is
 * Africa/Casablanca in the deployment). The anchor's wall-clock
 * time-of-day in that zone is preserved across occurrences; the day is
 * clamped to the target month's length (Jan 31 → Feb 28/29; Feb 29 →
 * Feb 28 in non-leap years). The duration kinds are exact elapsed-time
 * steps on the instant itself: weekly = +7×24 h exactly, custom =
 * +intervalDays×24 h exactly (so a weekly nextDueAt is always precisely
 * 7 days after the previous occurrence instant, whatever the wall clock
 * does around DST/Ramadan transitions). `once` yields the anchor itself
 * when it is strictly after `after`, otherwise no occurrence.
 */

export interface ReminderRecurrenceLike {
  kind: bookcarsTypes.ReminderRecurrenceKind | string
  intervalDays?: number
}

const DAY_MS = 24 * 60 * 60 * 1000
export const REMINDER_TIMEZONE = 'Africa/Casablanca'

interface WallParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
  ms: number
}

const wallParts = (date: Date, timeZone: string): WallParts => {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts: Record<string, number> = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value)
    }
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour % 24,
    minute: parts.minute,
    second: parts.second,
    ms: date.getMilliseconds(),
  }
}

/** Offset (wall − UTC) in ms for the given instant in the given zone. */
const zoneOffsetMs = (date: Date, timeZone: string): number => {
  const p = wallParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, date.getMilliseconds())
  // Truncate to seconds: Intl parts carry no sub-second precision.
  const truncated = Math.floor(date.getTime() / 1000) * 1000
  return asUtc - truncated
}

/** Convert a wall-clock time in `timeZone` to the corresponding instant. */
const wallToInstant = (p: WallParts, timeZone: string): Date => {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.ms)
  let instant = guess - zoneOffsetMs(new Date(guess), timeZone)
  // Re-evaluate once at the candidate instant: settles DST-boundary cases.
  instant = guess - zoneOffsetMs(new Date(instant), timeZone)
  return new Date(instant)
}

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

/**
 * The next occurrence strictly after `after` for a reminder anchored at
 * `firstDueAt`, or null when there is none (a past `once`).
 */
export const nextOccurrence = (
  firstDueAt: Date,
  recurrence: ReminderRecurrenceLike,
  after: Date,
  timeZone: string = REMINDER_TIMEZONE,
): Date | null => {
  const first = new Date(firstDueAt)
  const afterMs = after.getTime()
  if (Number.isNaN(first.getTime()) || Number.isNaN(afterMs)) {
    return null
  }

  switch (recurrence.kind) {
    case bookcarsTypes.ReminderRecurrenceKind.Once:
      return first.getTime() > afterMs ? first : null

    case bookcarsTypes.ReminderRecurrenceKind.Weekly: {
      if (first.getTime() > afterMs) {
        return first
      }
      const steps = Math.floor((afterMs - first.getTime()) / (7 * DAY_MS)) + 1
      return new Date(first.getTime() + steps * 7 * DAY_MS)
    }

    case bookcarsTypes.ReminderRecurrenceKind.Custom: {
      const interval = Math.floor(Number(recurrence.intervalDays))
      if (!Number.isFinite(interval) || interval < 1) {
        return null
      }
      if (first.getTime() > afterMs) {
        return first
      }
      const stepMs = interval * DAY_MS
      const steps = Math.floor((afterMs - first.getTime()) / stepMs) + 1
      return new Date(first.getTime() + steps * stepMs)
    }

    case bookcarsTypes.ReminderRecurrenceKind.Monthly: {
      const anchor = wallParts(first, timeZone)
      const afterParts = wallParts(after, timeZone)
      let k = Math.max(0, (afterParts.year - anchor.year) * 12 + (afterParts.month - anchor.month) - 1)
      for (let i = 0; i < 2400; i += 1, k += 1) {
        const totalMonths = (anchor.month - 1) + k
        const year = anchor.year + Math.floor(totalMonths / 12)
        const month = (totalMonths % 12) + 1
        const day = Math.min(anchor.day, daysInMonth(year, month))
        const candidate = wallToInstant({ ...anchor, year, month, day }, timeZone)
        if (candidate.getTime() > afterMs) {
          return candidate
        }
      }
      return null
    }

    case bookcarsTypes.ReminderRecurrenceKind.Yearly: {
      const anchor = wallParts(first, timeZone)
      const afterParts = wallParts(after, timeZone)
      let k = Math.max(0, afterParts.year - anchor.year - 1)
      for (let i = 0; i < 400; i += 1, k += 1) {
        const year = anchor.year + k
        const day = Math.min(anchor.day, daysInMonth(year, anchor.month))
        const candidate = wallToInstant({ ...anchor, year, day }, timeZone)
        if (candidate.getTime() > afterMs) {
          return candidate
        }
      }
      return null
    }

    default:
      return null
  }
}
