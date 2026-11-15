import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

export const list = (): Promise<bookcarsTypes.MaintenanceExpense[]> =>
  axiosInstance
    .get('/api/maintenance-expenses', { withCredentials: true })
    .then((res) => res.data)

export const create = (data: bookcarsTypes.UpsertMaintenanceExpensePayload): Promise<bookcarsTypes.MaintenanceExpense> =>
  axiosInstance
    .post('/api/maintenance-expenses', data, { withCredentials: true })
    .then((res) => res.data)

export const update = (id: string, data: bookcarsTypes.UpsertMaintenanceExpensePayload, reason?: string): Promise<bookcarsTypes.MaintenanceExpense> =>
  axiosInstance
    .put(`/api/maintenance-expenses/${encodeURIComponent(id)}`, { ...data, reason }, { withCredentials: true })
    .then((res) => res.data)

export const remove = (id: string, reason?: string): Promise<number> =>
  axiosInstance
    .delete(`/api/maintenance-expenses/${encodeURIComponent(id)}`, { data: { reason }, withCredentials: true })
    .then((res) => res.status)


export const uploadReceipt = (file: File): Promise<{ filename: string }> => {
  const data = new FormData()
  data.append('file', file)
  return axiosInstance.post('/api/maintenance-expenses/receipts', data, { withCredentials: true }).then((res) => res.data)
}

export const report = (from?: string, to?: string): Promise<{ currency: string; total: number; paidTotal: number; untrackedCount: number; categories: Array<{ category: string; count: number; total: number; paidTotal: number; untracked: number; receipts: number }> }> =>
  axiosInstance.get('/api/maintenance-expenses/report', { params: { from, to }, withCredentials: true }).then((res) => res.data)

// F7 / W3 M-2 — record one payment against an expense (append-only;
// the server recomputes paidAmount from the payment records and, for
// cash, links a confirmed movement in the open cash session).
export const recordPayment = (id: string, data: bookcarsTypes.CreateMaintenanceExpensePaymentPayload): Promise<{ payment: bookcarsTypes.MaintenanceExpensePayment, expense: bookcarsTypes.MaintenanceExpense }> =>
  axiosInstance
    .post(`/api/maintenance-expenses/${encodeURIComponent(id)}/payments`, data, { withCredentials: true })
    .then((res) => res.data)

export const listPayments = (id: string): Promise<bookcarsTypes.MaintenanceExpensePayment[]> =>
  axiosInstance
    .get(`/api/maintenance-expenses/${encodeURIComponent(id)}/payments`, { withCredentials: true })
    .then((res) => res.data)

// F7 / W3 M-7 — append-only audit trail (survives a hard delete).
export const listAudit = (id: string): Promise<bookcarsTypes.MaintenanceExpenseAudit[]> =>
  axiosInstance
    .get(`/api/maintenance-expenses/${encodeURIComponent(id)}/audit`, { withCredentials: true })
    .then((res) => res.data)
