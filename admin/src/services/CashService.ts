import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

export const listSessions = (supplier?: string): Promise<bookcarsTypes.CashSession[]> => axiosInstance.get('/api/cash/sessions', { params: supplier ? { supplier } : undefined, withCredentials: true }).then((res) => res.data)
export const current = (account = bookcarsTypes.CashAccountType.Cash, supplier?: string): Promise<bookcarsTypes.CashSession | null> => axiosInstance.get('/api/cash/sessions/current', { params: { account, ...(supplier ? { supplier } : {}) }, withCredentials: true }).then((res) => res.data)
export const open = (data: bookcarsTypes.OpenCashSessionPayload): Promise<bookcarsTypes.CashSession> => axiosInstance.post('/api/cash/sessions', data, { withCredentials: true }).then((res) => res.data)
export const movements = (sessionId: string, supplier?: string): Promise<bookcarsTypes.CashMovement[]> => axiosInstance.get(`/api/cash/sessions/${encodeURIComponent(sessionId)}/movements`, { params: supplier ? { supplier } : undefined, withCredentials: true }).then((res) => res.data)
export const createMovement = (sessionId: string, data: bookcarsTypes.CreateCashMovementPayload, supplier?: string): Promise<bookcarsTypes.CashMovement> => axiosInstance.post(`/api/cash/sessions/${encodeURIComponent(sessionId)}/movements`, { ...data, ...(supplier ? { supplier } : {}) }, { withCredentials: true }).then((res) => res.data)
export const close = (sessionId: string, data: bookcarsTypes.CloseCashSessionPayload, supplier?: string): Promise<bookcarsTypes.CashSession> => axiosInstance.post(`/api/cash/sessions/${encodeURIComponent(sessionId)}/close`, { ...data, ...(supplier ? { supplier } : {}) }, { withCredentials: true }).then((res) => res.data)

export const zReport = (sessionId: string, supplier?: string): Promise<Blob> => axiosInstance.get(`/api/cash/sessions/${encodeURIComponent(sessionId)}/z-report`, { params: supplier ? { supplier } : undefined, responseType: 'blob', withCredentials: true }).then((res) => res.data as Blob)
export const transfer = (data: bookcarsTypes.CreateCashTransferPayload): Promise<{ from: bookcarsTypes.CashMovement, to: bookcarsTypes.CashMovement }> => axiosInstance.post('/api/cash/transfers', data, { withCredentials: true }).then((res) => res.data)
