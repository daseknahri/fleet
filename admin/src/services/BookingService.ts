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
 * F3 / W1 #1 — staff cancel of a Booking (reason + explicit refund
 * decision). The refund amount is never auto-decided: full refunds
 * everything collected, none keeps it, manual leaves the refund to
 * staff in the provider dashboard.
 *
 * @param {string} id
 * @param {bookcarsTypes.CancelBookingPayload} data
 * @returns {Promise<{ booking: bookcarsTypes.Booking, refund: { decision: bookcarsTypes.CancelRefundDecision, status: bookcarsTypes.CancelRefundStatus, rentPaid?: number, depositPaid?: number, refundedRent: number, refundedDeposit: number, refundProviderReferences: string[] } }>}
 */
export const cancelBookingStaff = (id: string, data: bookcarsTypes.CancelBookingPayload): Promise<{ booking: bookcarsTypes.Booking, refund: { decision: bookcarsTypes.CancelRefundDecision, status: bookcarsTypes.CancelRefundStatus, rentPaid?: number, depositPaid?: number, refundedRent: number, refundedDeposit: number, refundProviderReferences: string[], wireRefundPending?: boolean } }> =>
  axiosInstance
    .post(
      `/api/bookings/${encodeURIComponent(id)}/cancel`,
      data,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * F3 / W1 #9 — the cancel-request queue: pending customer cancel
 * requests with the amounts at stake.
 *
 * @param {string[]} suppliers
 * @param {number} page
 * @param {number} size
 * @returns {Promise<bookcarsTypes.Result<bookcarsTypes.CancelRequestRow>>}
 */
export const getCancelRequests = (suppliers: string[], page: number, size: number): Promise<bookcarsTypes.Result<bookcarsTypes.CancelRequestRow>> =>
  axiosInstance
    .post(
      `/api/cancel-requests/${page}/${size}/${UserService.getLanguage()}`,
      { suppliers },
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * F3 / W1 #9 — decide a customer cancel request (approve executes the
 * staff cancel; deny clears the flag).
 *
 * @param {string} id
 * @param {bookcarsTypes.DecideCancelRequestPayload} data
 * @returns {Promise<bookcarsTypes.Booking | { booking: bookcarsTypes.Booking, refund: { decision: bookcarsTypes.CancelRefundDecision, status: bookcarsTypes.CancelRefundStatus, rentPaid?: number, depositPaid?: number, refundedRent: number, refundedDeposit: number, refundProviderReferences: string[] } }>}
 */
export const decideCancelRequest = (id: string, data: bookcarsTypes.DecideCancelRequestPayload): Promise<bookcarsTypes.Booking | { booking: bookcarsTypes.Booking, refund: { decision: bookcarsTypes.CancelRefundDecision, status: bookcarsTypes.CancelRefundStatus, rentPaid?: number, depositPaid?: number, refundedRent: number, refundedDeposit: number, refundProviderReferences: string[], wireRefundPending?: boolean } }> =>
  axiosInstance
    .post(
      `/api/bookings/${encodeURIComponent(id)}/decide-cancel-request`,
      data,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Wave 2.3 — the refund plan for one booking, computed and shown BEFORE
 * a staff cancel is confirmed: amounts at stake, the per-method split,
 * whether approvals are required, and whether a cash/bank session is
 * open for the refund legs.
 *
 * @param {string} id
 * @returns {Promise<bookcarsTypes.RefundPlan>}
 */
export const getRefundPlan = (id: string): Promise<bookcarsTypes.RefundPlan> =>
  axiosInstance
    .get(
      `/api/bookings/${encodeURIComponent(id)}/refund-plan`,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Wave 2.1 — staff confirmation of a pay-later hold (Owner/Manager
 * only, enforced server-side). Lifecycle Draft → Confirmed, the hold
 * window is cleared, confirmedBy/confirmedAt are stamped and the
 * customer is notified.
 *
 * @param {string} id
 * @returns {Promise<bookcarsTypes.Booking>}
 */
export const confirmReservation = (id: string): Promise<bookcarsTypes.Booking> =>
  axiosInstance
    .post(
      `/api/bookings/${encodeURIComponent(id)}/confirm-reservation`,
      {},
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * GH-02 / Wave 3.1 — mark a booking as no-show from the receivables
 * action column (F4 / W1 #7: Draft/Confirmed, unpaid, pickup passed;
 * the server enforces every guard and 409s otherwise). The booking
 * is cancelled and the car freed; no refund or fee is decided here.
 *
 * @param {string} id
 * @returns {Promise<bookcarsTypes.Booking>}
 */
export const markNoShow = (id: string): Promise<bookcarsTypes.Booking> =>
  axiosInstance
    .post(
      `/api/bookings/${encodeURIComponent(id)}/mark-no-show`,
      {},
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Wave 2.1 — the "confirmed, unpaid" watchlist: Confirmed holds with
 * an outstanding balance, plus legacy Reserved rows (which still need
 * confirming).
 *
 * @param {string[]} suppliers
 * @param {number} page
 * @param {number} size
 * @returns {Promise<bookcarsTypes.Result<bookcarsTypes.ConfirmedUnpaidRow>>}
 */
export const getConfirmedUnpaid = (suppliers: string[], page: number, size: number): Promise<bookcarsTypes.Result<bookcarsTypes.ConfirmedUnpaidRow>> =>
  axiosInstance
    .post(
      `/api/confirmed-unpaid-bookings/${page}/${size}/${UserService.getLanguage()}`,
      { suppliers },
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
