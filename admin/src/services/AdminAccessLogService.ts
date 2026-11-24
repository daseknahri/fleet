import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

/**
 * GH-07 — one row of the admin-access audit log. actor/agency arrive
 * populated ({ _id, fullName, email }) when the backend populated
 * them; agency is null on platform-wide rows (no agency was named).
 */
export interface AdminAccessLogRow {
  _id: string
  actor: { _id: string, fullName?: string, email?: string } | string
  agency: { _id: string, fullName?: string, email?: string } | string | null
  action: string
  method?: string
  path?: string
  createdAt: string
}

export interface AdminAccessLogFilters {
  agency?: string
  actor?: string
  action?: string
  page?: number
  size?: number
}

/**
 * List audit rows, newest first. Always pass page/size (the backend
 * returns the full filtered array without them).
 */
export const list = (
  filters?: AdminAccessLogFilters,
): Promise<bookcarsTypes.PagedResult<AdminAccessLogRow>> =>
  axiosInstance
    .get(
      '/api/admin-access-log',
      {
        withCredentials: true,
        params: { ...(filters || {}) },
      },
    )
    .then((res) => res.data)
