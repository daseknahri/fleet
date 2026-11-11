import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

/**
 * GA-PAR-12: public online-signing API. These calls are unauthenticated
 * by design — the capability token in the URL is the credential — and
 * they never carry credentials or any other booking identifier.
 */

/**
 * Fetch the display-safe summary for the booking bound to `token`.
 *
 * @param {string} token
 * @returns {Promise<bookcarsTypes.SigningSummary>}
 */
export const getSigningSummary = (token: string): Promise<bookcarsTypes.SigningSummary> =>
  axiosInstance
    .get(`/api/sign/${encodeURIComponent(token)}`)
    .then((res) => res.data)

/**
 * Submit the drawn signature (base64 PNG) for the booking bound to
 * `token`. A successful submit consumes the link.
 *
 * @param {string} token
 * @param {string} signaturePngBase64
 * @returns {Promise<number>}
 */
export const signBooking = (token: string, signaturePngBase64: string): Promise<number> =>
  axiosInstance
    .post(
      `/api/sign/${encodeURIComponent(token)}`,
      { signaturePngBase64 } as bookcarsTypes.SignBookingPayload,
    )
    .then((res) => res.status)
