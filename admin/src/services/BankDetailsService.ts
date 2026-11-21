import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

/**
 * Upsert BankDetails.
 *
 * @param {bookcarsTypes.ValidateCountryPayload} data
 * @returns {Promise<number>}
 */
export const upsertBankDetails = (data: bookcarsTypes.UpsertBankDetailsPayload): Promise<bookcarsTypes.Response<bookcarsTypes.BankDetails>> =>
  axiosInstance
    .post(
      '/api/upsert-bank-details',
      data,
      { withCredentials: true }
    )
    .then((res) => ({ status: res.status, data: res.data }))

/**
 * Get BankDetails. A platform admin may pass a supplier id to read
 * that agency's RIB (Wave 2.6 — one RIB per agency); agency callers
 * always read their own row.
 *
 * @param {string} [supplier]
 * @returns {Promise<bookcarsTypes.BankDetails | null>}
 */
export const getBankDetails = (supplier?: string): Promise<bookcarsTypes.BankDetails | null> =>
  axiosInstance
    .get(
      supplier ? `/api/bank-details?supplier=${encodeURIComponent(supplier)}` : '/api/bank-details',
      { withCredentials: true }
    )
    .then((res) => res.data)
