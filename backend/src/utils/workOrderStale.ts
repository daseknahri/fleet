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
 *  and the reminder body). Returns 0 when the start is in the future. */
export const workOrderStaleDays = (scheduledStart: Date | string, now: Date = new Date()): number =>
  Math.max(0, Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(scheduledStart).setHours(0, 0, 0, 0)) / 86400000))