import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

export const listSessions = (supplier?: string): Promise<bookcarsTypes.CashSession[]> => axiosInstance.get('/api/cash/sessions', { params: supplier ? { supplier } : undefined, withCredentials: true }).then((res) => res.data)
export const current = (account = bookcarsTypes.CashAccountType.Cash, supplier?: string): Promise<bookcarsTypes.CashSession | null> => axiosInstance.get('/api/cash/sessions/current', { params: { account, ...(supplier ? { supplier } : {}) }, withCredentials: true }).then((res) => res.data)

// F6 / W3 C-1 — the previous counted close for the open-session
// dialog: the chained opening balance (null on a first session).
export const previousClose = (account = bookcarsTypes.CashAccountType.Cash, supplier?: string): Promise<{ sessionId: string, countedClosingBalance: number, closedAt: string, currency: string } | null> => axiosInstance.get('/api/cash/sessions/previous-close', { params: { account, ...(supplier ? { supplier } : {}) }, withCredentials: true }).then((res) => res.data)
export const open = (data: bookcarsTypes.OpenCashSessionPayload): Promise<bookcarsTypes.CashSession> => axiosInstance.post('/api/cash/sessions', data, { withCredentials: true }).then((res) => res.data)
export const movements = (sessionId: string, supplier?: string): Promise<bookcarsTypes.CashMovement[]> => axiosInstance.get(`/api/cash/sessions/${encodeURIComponent(sessionId)}/movements`, { params: supplier ? { supplier } : undefined, withCredentials: true }).then((res) => res.data)
export const createMovement = (sessionId: string, data: bookcarsTypes.CreateCashMovementPayload, supplier?: string): Promise<bookcarsTypes.CashMovement> => axiosInstance.post(`/api/cash/sessions/${encodeURIComponent(sessionId)}/movements`, { ...data, ...(supplier ? { supplier } : {}) }, { withCredentials: true }).then((res) => res.data)
export const close = (sessionId: string, data: bookcarsTypes.CloseCashSessionPayload, supplier?: string): Promise<bookcarsTypes.CashSession> => axiosInstance.post(`/api/cash/sessions/${encodeURIComponent(sessionId)}/close`, { ...data, ...(supplier ? { supplier } : {}) }, { withCredentials: true }).then((res) => res.data)

export const zReport = (sessionId: string, supplier?: string): Promise<Blob> => axiosInstance.get(`/api/cash/sessions/${encodeURIComponent(sessionId)}/z-report`, { params: supplier ? { supplier } : undefined, responseType: 'blob', withCredentials: true }).then((res) => res.data as Blob)

// F6 / W3 C-5 — server-side cash journal: one session, one scope, one
// set of figures (confirmed-only income/expenses, deposits held
// separately, pending listed never counted) + the unlinked cash
// payments the drawer cannot yet account for (C-7 reconciliation).
export const journal = (sessionId: string, supplier?: string, params?: { from?: string, to?: string, keyword?: string, page?: number, size?: number }): Promise<bookcarsTypes.CashJournalResponse> => axiosInstance.get('/api/cash/journal', { params: { sessionId, ...(supplier ? { supplier } : {}), ...(params || {}) }, withCredentials: true }).then((res) => res.data)
export const journalCsv = (sessionId: string, supplier?: string, params?: { from?: string, to?: string, keyword?: string }): Promise<Blob> => axiosInstance.get('/api/cash/journal.csv', { params: { sessionId, ...(supplier ? { supplier } : {}), ...(params || {}) }, responseType: 'blob', withCredentials: true }).then((res) => res.data as Blob)
export const transfer = (data: bookcarsTypes.CreateCashTransferPayload): Promise<{ from: bookcarsTypes.CashMovement, to: bookcarsTypes.CashMovement }> => axiosInstance.post('/api/cash/transfers', data, { withCredentials: true }).then((res) => res.data)
