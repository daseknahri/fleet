import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

export const list = (): Promise<bookcarsTypes.MaintenanceWorkOrder[]> => axiosInstance.get('/api/maintenance-work-orders', { withCredentials: true }).then((res) => res.data)
export const create = (data: bookcarsTypes.UpsertMaintenanceWorkOrderPayload): Promise<bookcarsTypes.MaintenanceWorkOrder> => axiosInstance.post('/api/maintenance-work-orders', data, { withCredentials: true }).then((res) => res.data)
export const update = (id: string, data: bookcarsTypes.UpsertMaintenanceWorkOrderPayload): Promise<bookcarsTypes.MaintenanceWorkOrder> => axiosInstance.put(`/api/maintenance-work-orders/${encodeURIComponent(id)}`, data, { withCredentials: true }).then((res) => res.data)
export const remove = (id: string): Promise<number> => axiosInstance.delete(`/api/maintenance-work-orders/${encodeURIComponent(id)}`, { withCredentials: true }).then((res) => res.status)
