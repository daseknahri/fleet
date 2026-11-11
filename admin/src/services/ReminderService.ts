import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

// GA-PAR-13 — reminders API (scorecard #30). Reads are gated server-side
// by ReadReminders; mutations and the firing history by ManageReminders.
export const list = (supplier?: string): Promise<bookcarsTypes.Reminder[]> =>
  axiosInstance.get('/api/reminders', { withCredentials: true, params: supplier ? { supplier } : undefined }).then((res) => res.data)

export const getOne = (id: string): Promise<bookcarsTypes.Reminder> =>
  axiosInstance.get(`/api/reminders/${encodeURIComponent(id)}`, { withCredentials: true }).then((res) => res.data)

export const create = (data: bookcarsTypes.CreateReminderPayload): Promise<bookcarsTypes.Reminder> =>
  axiosInstance.post('/api/reminders', data, { withCredentials: true }).then((res) => res.data)

export const update = (id: string, data: bookcarsTypes.UpdateReminderPayload): Promise<bookcarsTypes.Reminder> =>
  axiosInstance.put(`/api/reminders/${encodeURIComponent(id)}`, data, { withCredentials: true }).then((res) => res.data)

export const remove = (id: string): Promise<number> =>
  axiosInstance.delete(`/api/reminders/${encodeURIComponent(id)}`, { withCredentials: true }).then((res) => res.status)

export const firings = (id: string): Promise<bookcarsTypes.ReminderFiring[]> =>
  axiosInstance.get(`/api/reminders/${encodeURIComponent(id)}/firings`, { withCredentials: true }).then((res) => res.data)
