import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

export interface Approval {
  _id: string
  supplier: string
  subject: string
  subjectType: string
  amount?: number
  currency?: string
  status: bookcarsTypes.ApprovalDecision
  requestedBy?: string
  requestedByName?: string
  decidedBy?: string
  decidedByName?: string
  decidedAt?: string
  reason?: string
  createdAt?: string
  updatedAt?: string
}

export interface CreateApprovalPayload {
  supplier?: string
  subject: string
  subjectType: string
  amount: number
  currency?: string
  reason?: string
}

export const list = (): Promise<Approval[]> => axiosInstance
  .get('/api/approvals', { withCredentials: true })
  .then((res) => res.data)

export const create = (data: CreateApprovalPayload): Promise<Approval> => axiosInstance
  .post('/api/approvals', data, { withCredentials: true })
  .then((res) => res.data)

export const decide = (
  id: string,
  decision: bookcarsTypes.ApprovalDecision.Approved | bookcarsTypes.ApprovalDecision.Rejected,
  reason?: string,
): Promise<Approval> => axiosInstance
  .post(`/api/approvals/${encodeURIComponent(id)}/decide`, { decision, ...(reason ? { reason } : {}) }, { withCredentials: true })
  .then((res) => res.data)
