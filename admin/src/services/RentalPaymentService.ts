import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

export const list = (params?: { page?: number, size?: number, status?: string, purpose?: string, booking?: string, from?: string, to?: string }): Promise<bookcarsTypes.RentalPayment[] | bookcarsTypes.PagedResult<bookcarsTypes.RentalPayment>> =>
  axiosInstance.get('/api/rental-payments', { params, withCredentials: true }).then((res) => res.data)

// F6 / W3 P-8 — edit / delete a stuck Pending entry.
export const update = (paymentId: string, data: bookcarsTypes.UpdateRentalPaymentPayload): Promise<bookcarsTypes.RentalPayment> =>
  axiosInstance.patch(`/api/rental-payments/${encodeURIComponent(paymentId)}`, data, { withCredentials: true }).then((res) => res.data)

export const remove = (paymentId: string): Promise<void> =>
  axiosInstance.delete(`/api/rental-payments/${encodeURIComponent(paymentId)}`, { withCredentials: true }).then(() => undefined)

// Audit-fix 2026-11-24 (F-02) — the payment-status refresh outcome.
// It rides on a create 201 when the booking's confirmation was blocked
// (e.g. an overdue maintenance schedule), and comes back from the retry
// endpoint with the booking's status and outstanding balance.
export interface PaymentStatusRefresh {
  conflict: boolean
  conflictReason?: string
  updated: boolean
}

export interface RefreshPaymentStatusResult extends PaymentStatusRefresh {
  status: bookcarsTypes.BookingStatus
  outstandingBalance: number
  currency: string
}

export const refreshPaymentStatus = (bookingId: string): Promise<RefreshPaymentStatusResult> =>
  axiosInstance.post(`/api/bookings/${encodeURIComponent(bookingId)}/refresh-payment-status`, {}, { withCredentials: true }).then((res) => res.data)

export const create = (data: bookcarsTypes.CreateRentalPaymentPayload): Promise<bookcarsTypes.RentalPayment & { statusRefresh?: PaymentStatusRefresh }> =>
  axiosInstance.post('/api/rental-payments', data, { withCredentials: true }).then((res) => res.data)

export const reverse = (paymentId: string, idempotencyKey: string, note?: string): Promise<bookcarsTypes.RentalPayment> =>
  axiosInstance.post(`/api/rental-payments/${encodeURIComponent(paymentId)}/reverse`, {
    idempotencyKey,
    note,
  }, { withCredentials: true }).then((res) => res.data)

// GA-PAR-17 — collections summary (dictionary v2026-11-15.1) + payments CSV export.
export const collectionsSummary = (): Promise<bookcarsTypes.CollectionsSummary> =>
  axiosInstance.get('/api/rental-payments/collections-summary', { withCredentials: true }).then((res) => res.data)

// R6-13 — per-purpose remaining cap for the payment dialog (the Charge
// cap comes from the server; the dialog cannot derive it client-side).
export interface PurposeRemaining {
  remaining: number
  recorded: number
  cap: number
  currency: string
}

export const purposeRemaining = (bookingId: string, purpose: bookcarsTypes.RentalPaymentPurpose): Promise<PurposeRemaining> =>
  axiosInstance.get(`/api/rental-payments/bookings/${encodeURIComponent(bookingId)}/purpose-remaining`, { params: { purpose }, withCredentials: true }).then((res) => res.data)

// F6 / W3 P-3 — shared outstanding/receivable table (dictionary
// v2026-11-15.1): charges included, overdue per the shared due rule.
// GH-02 / Wave 3.1 — filters (?filter=, ?clientId=) + paid-in-full
// rows in the same response (read in Payments.tsx through a cast
// until the shared OverdueReceivableResponse gains them).
export const overdue = (params?: { filter?: string, clientId?: string }): Promise<bookcarsTypes.OverdueReceivableResponse> =>
  axiosInstance.get('/api/rental-payments/overdue', { params, withCredentials: true }).then((res) => res.data)

// GH-11 — pending wire/manual refunds: money the agency owes back.
// One row per Cancelled booking whose cancellationRecord.refundStatus
// is 'pending'.
export interface PendingRefundRow {
  booking: bookcarsTypes.Booking
  amount: number
  currency: string
  method: bookcarsTypes.RentalPaymentMethod | null
  methods: Array<{ method: bookcarsTypes.RentalPaymentMethod, amount: number }>
  reason: string
  since?: string
  refundDecision: bookcarsTypes.CancelRefundDecision
  wireRefundPending: boolean
  rentPaid: number
  depositPaid: number
  refundedRent: number
  refundedDeposit: number
}

export interface PendingRefundsResponse {
  rows: PendingRefundRow[]
  count: number
  total: number
  currency: string
}

export const pendingRefunds = (): Promise<PendingRefundsResponse> =>
  axiosInstance.get('/api/rental-payments/pending-refunds', { withCredentials: true }).then((res) => res.data)

// F6 / W3 C-7 — link a posted cash payment into a chosen open cash
// session (the repair path for payments posted unlinked).
export const linkCashSession = (paymentId: string, cashSessionId: string): Promise<{ payment: bookcarsTypes.RentalPayment, movement: bookcarsTypes.CashMovement }> =>
  axiosInstance.post(`/api/rental-payments/${encodeURIComponent(paymentId)}/link-cash-session`, { cashSessionId }, { withCredentials: true }).then((res) => res.data)

// GH-33 - the bank mirror of linkCashSession (backend endpoint already
// exists; it had no admin caller).
export const linkBankSession = (paymentId: string, bankSessionId: string): Promise<{ payment: bookcarsTypes.RentalPayment, movement: bookcarsTypes.CashMovement }> =>
  axiosInstance.post(`/api/rental-payments/${encodeURIComponent(paymentId)}/link-bank-session`, { bankSessionId }, { withCredentials: true }).then((res) => res.data)

export const exportCsv = () =>
  axiosInstance.get('/api/rental-payments/export.csv', { responseType: 'blob', withCredentials: true }).then((res) => res.data as Blob)
