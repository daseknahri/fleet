import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

/**
 * F8 / W5 N3 — notification delivery log: every send attempt (in-app,
 * email, push), one row per recipient per channel, newest first.
 * The list is unpaginated (no page/size params) so the response is
 * the plain filtered array.
 */
export const list = (
  supplier?: string,
  filters?: { status?: string, channel?: string, templateKey?: string },
): Promise<bookcarsTypes.NotificationDelivery[]> =>
  axiosInstance
    .get(
      '/api/notification-deliveries',
      {
        withCredentials: true,
        params: { ...(supplier ? { supplier } : {}), ...(filters || {}) },
      },
    )
    .then((res) => res.data)

/**
 * Retry one delivery over its stored channel, with its stored
 * subject/body. Only queued/failed rows retry (the backend 400s a
 * row that is already sent).
 */
export const retry = (id: string): Promise<bookcarsTypes.NotificationDelivery> =>
  axiosInstance
    .post(
      `/api/notification-deliveries/${encodeURIComponent(id)}/retry`,
      {},
      { withCredentials: true },
    )
    .then((res) => res.data)
