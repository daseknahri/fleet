import * as bookcarsTypes from ':bookcars-types'
import axios from 'axios'
import axiosInstance from './axiosInstance'

const route = '/api/maintenance-categories'

export const list = (): Promise<bookcarsTypes.MaintenanceCategory[]> => axiosInstance.get(route, { withCredentials: true }).then((res) => res.data)

export const create = (payload: bookcarsTypes.UpsertMaintenanceCategoryPayload): Promise<bookcarsTypes.MaintenanceCategory> =>
  axiosInstance.post(route, payload, { withCredentials: true }).then((res) => res.data)

export const update = (id: string, payload: bookcarsTypes.UpsertMaintenanceCategoryPayload): Promise<bookcarsTypes.MaintenanceCategory> =>
  axiosInstance.put(`${route}/${id}`, payload, { withCredentials: true }).then((res) => res.data)

export const remove = (id: string, reason?: string): Promise<number> => axiosInstance.delete(`${route}/${id}`, { data: { reason }, withCredentials: true }).then((res) => res.status)

export const getErrorMessage = (err: unknown): string => {
  if (axios.isAxiosError(err) && err.response?.data && typeof err.response.data === 'string') {
    return err.response.data
  }
  return ''
}