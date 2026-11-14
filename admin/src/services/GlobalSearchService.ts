import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

/**
 * GA-Q4-2 (#52) — agency-scoped global search.
 *
 * @param {bookcarsTypes.GlobalSearchPayload} data
 * @returns {Promise<bookcarsTypes.GlobalSearchResult>}
 */
export const search = (data: bookcarsTypes.GlobalSearchPayload): Promise<bookcarsTypes.GlobalSearchResult> =>
  axiosInstance
    .post(
      '/api/global-search',
      data,
      { withCredentials: true }
    )
    .then((res) => res.data)
