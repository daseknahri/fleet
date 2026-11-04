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

export const update = (id: string, data: bookcarsTypes.UpsertMaintenanceExpensePayload): Promise<bookcarsTypes.MaintenanceExpense> =>
  axiosInstance
    .put(`/api/maintenance-expenses/${encodeURIComponent(id)}`, data, { withCredentials: true })
    .then((res) => res.data)

export const remove = (id: string): Promise<number> =>
  axiosInstance
    .delete(`/api/maintenance-expenses/${encodeURIComponent(id)}`, { withCredentials: true })
    .then((res) => res.status)


export const uploadReceipt = (file: File): Promise<{ filename: string }> => {
  const data = new FormData()
  data.append('file', file)
  return axiosInstance.post('/api/maintenance-expenses/receipts', data, { withCredentials: true }).then((res) => res.data)
}

export const report = (from?: string, to?: string): Promise<{ currency: string; total: number; categories: Array<{ category: string; count: number; total: number; receipts: number }> }> =>
  axiosInstance.get('/api/maintenance-expenses/report', { params: { from, to }, withCredentials: true }).then((res) => res.data)
