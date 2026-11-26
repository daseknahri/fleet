import * as bookcarsTypes from ':bookcars-types'

/** GH-21 - a work order is stale when it is still Scheduled N days
 *  after its planned start. N = 7 is packed per the gap hunt's
 *  suggestion and needs the user's confirmation (one-constant change). */
export const STALE_WORK_ORDER_DAYS = 7

export const staleWorkOrderCutoff = (now: Date = new Date()): Date =>
  new Date(now.getTime() - STALE_WORK_ORDER_DAYS * 86400000)

export const isWorkOrderStale = (
  status: bookcarsTypes.WorkOrderStatus,
  scheduledStart: Date | string,
  now: Date = new Date(),
): boolean =>
  status === bookcarsTypes.WorkOrderStatus.Scheduled
  && new Date(scheduledStart).getTime() < staleWorkOrderCutoff(now).getTime()

/** Whole days between the planned start and now (for the badge text
 *  and the reminder body). Returns 0 when the start is in the future.
 *  Day boundaries are Casablanca wall days (R3-06 — was process-local
 *  midnight, so the badge read one day low for an hour a day in summer). */
const CASABLANCA_TZ = 'Africa/Casablanca'
const wallDay = (date: Date | string): string => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CASABLANCA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
export const workOrderStaleDays = (scheduledStart: Date | string, now: Date | string = new Date()): number =>
  Math.max(0, Math.floor((new Date(`${wallDay(now)}T00:00:00Z`).getTime() - new Date(`${wallDay(scheduledStart)}T00:00:00Z`).getTime()) / 86400000))