import axiosInstance from './axiosInstance'
import * as UserService from './UserService'
import * as bookcarsTypes from ':bookcars-types'

/**
 * Complete the checkout process and create the booking.
 *
 * @param {bookcarsTypes.CheckoutPayload} data
 * @returns {Promise<number>}
 */
export const checkout = (data: bookcarsTypes.CheckoutPayload): Promise<{ status: number } & bookcarsTypes.CheckoutResult> =>
  axiosInstance
    .post(
      '/api/checkout',
      data
    )
    .then((res) => ({ status: res.status, ...res.data }))

/** Confirm a PaymentSheet charge against its already-created booking. */
export const confirmPaymentIntent = (bookingId: string, paymentIntentId: string): Promise<number> =>
  axiosInstance
    .post('/api/confirm-payment-intent', { bookingId, paymentIntentId })
    .then((res) => res.status)

/** Release a temporary booking if the customer cancels before payment. */
export const deleteTempBooking = (bookingId: string, sessionId: string): Promise<number> =>
  axiosInstance
    .delete(`/api/delete-temp-booking/${encodeURIComponent(bookingId)}/${encodeURIComponent(sessionId)}`)
    .then((res) => res.status)

/**
 * Get bookings.
 *
 * @async
 * @param {bookcarsTypes.GetBookingsPayload} payload
 * @param {number} page
 * @param {number} size
 * @returns {Promise<bookcarsTypes.Result<bookcarsTypes.Booking>>}
 */
export const getBookings = async (payload: bookcarsTypes.GetBookingsPayload, page: number, size: number): Promise<bookcarsTypes.Result<bookcarsTypes.Booking>> => {
  const headers = await UserService.authHeader()
  const language = await UserService.getLanguage()
  return axiosInstance
    .post(
      `/api/bookings/${page}/${size}/${language}`,
      payload,
      { headers }
    )
    .then((res) => res.data)
}

/**
 * Get a Booking by ID.
 *
 * @async
 * @param {string} id
 * @returns {Promise<bookcarsTypes.Booking>}
 */
export const getBooking = async (id: string): Promise<bookcarsTypes.Booking> => {
  const headers = await UserService.authHeader()
  const language = await UserService.getLanguage()
  return axiosInstance
    .get(
      `/api/booking/${encodeURIComponent(id)}/${language}`,
      { headers }
    )
    .then((res) => res.data)
}

/**
 * Check whether a customer has bookings or not.
 *
 * @async
 * @param {string} driver
 * @returns {Promise<number>}
 */
export const hasBookings = async (driver: string): Promise<number> => {
  const headers = await UserService.authHeader()
  return axiosInstance
    .get(
      `/api/has-bookings/${encodeURIComponent(driver)}`,
      { headers }
    )
    .then((res) => res.status)
}

/**
 * Cancel a booking.
 *
 * @async
 * @param {string} id
 * @returns {Promise<number>}
 */
export const cancel = async (id: string): Promise<number> => {
  const headers = await UserService.authHeader()
  return axiosInstance
    .post(
      `/api/cancel-booking/${encodeURIComponent(id)}`,
      null,
      { headers }
    ).then((res) => res.status)
}
