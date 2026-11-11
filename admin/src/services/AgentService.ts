import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

// GA-PAR-07 — apporteur (business referrer) API. The list/get responses are
// enriched server-side with the agent's outstanding `due` and
// `rentalBrought` (declared on the shared Agent type); getOne additionally
// carries the agent's settlement history.
export type AgentWithSettlements = bookcarsTypes.Agent & {
  settlements?: bookcarsTypes.AgentSettlement[]
}

export const list = (supplier?: string): Promise<bookcarsTypes.Agent[]> =>
  axiosInstance.get('/api/agents', { withCredentials: true, params: supplier ? { supplier } : undefined }).then((res) => res.data)

export const kpis = (supplier?: string): Promise<bookcarsTypes.AgentKpis> =>
  axiosInstance.get('/api/agents/kpis', { withCredentials: true, params: supplier ? { supplier } : undefined }).then((res) => res.data)

export const getOne = (id: string): Promise<AgentWithSettlements> =>
  axiosInstance.get(`/api/agents/${encodeURIComponent(id)}`, { withCredentials: true }).then((res) => res.data)

export const create = (data: bookcarsTypes.CreateAgentPayload): Promise<bookcarsTypes.Agent> =>
  axiosInstance.post('/api/agents', data, { withCredentials: true }).then((res) => res.data)

export const update = (id: string, data: bookcarsTypes.UpdateAgentPayload): Promise<bookcarsTypes.Agent> =>
  axiosInstance.put(`/api/agents/${encodeURIComponent(id)}`, data, { withCredentials: true }).then((res) => res.data)

export const remove = (id: string): Promise<number> =>
  axiosInstance.delete(`/api/agents/${encodeURIComponent(id)}`, { withCredentials: true }).then((res) => res.status)

export const settle = (id: string, data: bookcarsTypes.SettleAgentPayload): Promise<bookcarsTypes.SettleAgentResult> =>
  axiosInstance.post(`/api/agents/${encodeURIComponent(id)}/settle`, data, { withCredentials: true }).then((res) => res.data)
