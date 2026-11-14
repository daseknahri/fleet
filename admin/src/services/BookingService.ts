import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'
import * as UserService from './UserService'

/**
 * Create a Booking.
 *
 * @param {bookcarsTypes.UpsertBookingPayload} data
 * @returns {Promise<bookcarsTypes.Booking>}
 */
export const create = (data: bookcarsTypes.UpsertBookingPayload): Promise<bookcarsTypes.Booking> =>
  axiosInstance
    .post(
      '/api/create-booking',
      data,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Update a Booking.
 *
 * @param {bookcarsTypes.UpsertBookingPayload} data
 * @returns {Promise<number>}
 */
export const update = (data: bookcarsTypes.UpsertBookingPayload): Promise<number> =>
  axiosInstance
    .put(
      '/api/update-booking',
      data,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Update a Booking status.
 *
 * @param {bookcarsTypes.UpdateStatusPayload} data
 * @returns {Promise<number>}
 */
export const updateStatus = (data: bookcarsTypes.UpdateStatusPayload): Promise<number> =>
  axiosInstance
    .post(
      '/api/update-booking-status',
      data,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Delete Bookings (purge-from-trash only, GA-PAR-22).
 *
 * The route refuses live bookings (409 NOT_TRASHED) and bookings with
 * linked payments/invoices/charges/quotes/snapshots/inspections. It is
 * called only from the Trash view; the reason is required (3–1000).
 *
 * @param {string[]} ids
 * @param {string} reason
 * @returns {Promise<number>}
 */
export const deleteBookings = (ids: string[], reason?: string): Promise<number> =>
  axiosInstance
    .post(
      '/api/delete-bookings',
      { ids, reason },
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Trash Bookings (GA-PAR-22).
 *
 * @param {string[]} ids
 * @param {string} reason
 * @returns {Promise<number>}
 */
export const trashBookings = (ids: string[], reason: string): Promise<number> =>
  axiosInstance
    .post(
      '/api/trash-bookings',
      { ids, reason },
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Restore Bookings (GA-PAR-22).
 *
 * @param {string[]} ids
 * @param {string} [reason]
 * @returns {Promise<number>}
 */
export const restoreBookings = (ids: string[], reason?: string): Promise<number> =>
  axiosInstance
    .post(
      '/api/restore-bookings',
      { ids, reason },
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Get Trashed Bookings (GA-PAR-22).
 *
 * @param {string[]} suppliers
 * @param {string} keyword
 * @param {number} page
 * @param {number} size
 * @returns {Promise<bookcarsTypes.Result<bookcarsTypes.Booking>>}
 */
export const getTrashedBookings = (suppliers: string[], keyword: string, page: number, size: number): Promise<bookcarsTypes.Result<bookcarsTypes.Booking>> =>
  axiosInstance
    .post(
      `/api/trashed-bookings/${page}/${size}/${UserService.getLanguage()}/?s=${encodeURIComponent(keyword)}`,
      { suppliers },
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Get the trash-warning figures for one Booking (GA-PAR-22, §5.7).
 *
 * @param {string} id
 * @returns {Promise<bookcarsTypes.TrashWarning>}
 */
export const getBookingTrashWarning = (id: string): Promise<bookcarsTypes.TrashWarning> =>
  axiosInstance
    .get(
      `/api/bookings/${encodeURIComponent(id)}/trash-warning`,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Get a Booking by ID.
 *
 * @param {string} id
 * @returns {Promise<bookcarsTypes.Booking>}
 */
export const getBooking = (id: string): Promise<bookcarsTypes.Booking> =>
  axiosInstance
    .get(
      `/api/booking/${encodeURIComponent(id)}/${UserService.getLanguage()}`,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Get Bookings.
 *
 * @param {bookcarsTypes.GetBookingsPayload} payload
 * @param {number} page
 * @param {number} size
 * @returns {Promise<bookcarsTypes.Result<bookcarsTypes.Booking>>}
 */
export const getBookings = (payload: bookcarsTypes.GetBookingsPayload, page: number, size: number): Promise<bookcarsTypes.Result<bookcarsTypes.Booking>> =>
  axiosInstance
    .post(
      `/api/bookings/${page}/${size}/${UserService.getLanguage()}`,
      payload,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * GA-PAR-11: Amend / extend a Booking (contract amendment workflow).
 *
 * @param {string} id
 * @param {bookcarsTypes.AmendBookingPayload} data
 * @returns {Promise<bookcarsTypes.Booking>}
 */
export const amend = (id: string, data: bookcarsTypes.AmendBookingPayload): Promise<bookcarsTypes.Booking> =>
  axiosInstance
    .post(
      `/api/bookings/${encodeURIComponent(id)}/amend`,
      data,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * GA-PAR-12: Issue a shareable online-signing link for a Booking.
 * The response carries the only live copy of the capability token —
 * it is never persisted in any booking payload.
 *
 * @param {string} id
 * @returns {Promise<bookcarsTypes.SigningLinkResponse>}
 */
export const issueSigningLink = (id: string): Promise<bookcarsTypes.SigningLinkResponse> =>
  axiosInstance
    .post(
      `/api/bookings/${encodeURIComponent(id)}/signing-link`,
      {},
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * GA-PAR-12: Revoke every outstanding signing link for a Booking
 * (server-side nonce rotation).
 *
 * @param {string} id
 * @returns {Promise<number>}
 */
export const revokeSigningLink = (id: string): Promise<number> =>
  axiosInstance
    .post(
      `/api/bookings/${encodeURIComponent(id)}/signing-link/revoke`,
      {},
      { withCredentials: true }
    )
    .then((res) => res.status)
