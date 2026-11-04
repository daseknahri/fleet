import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

export const list = (): Promise<bookcarsTypes.MaintenanceSchedule[]> => axiosInstance.get('/api/maintenance-schedules', { withCredentials: true }).then((res) => res.data)
export const create = (data: bookcarsTypes.UpsertMaintenanceSchedulePayload): Promise<bookcarsTypes.MaintenanceSchedule> => axiosInstance.post('/api/maintenance-schedules', data, { withCredentials: true }).then((res) => res.data)
export const update = (id: string, data: bookcarsTypes.UpsertMaintenanceSchedulePayload): Promise<bookcarsTypes.MaintenanceSchedule> => axiosInstance.put(`/api/maintenance-schedules/${encodeURIComponent(id)}`, data, { withCredentials: true }).then((res) => res.data)
export const remove = (id: string): Promise<number> => axiosInstance.delete(`/api/maintenance-schedules/${encodeURIComponent(id)}`, { withCredentials: true }).then((res) => res.status)
