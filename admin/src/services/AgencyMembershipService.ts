import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

export const listCurrent = (): Promise<bookcarsTypes.AgencyMembership[]> => axiosInstance
  .get('/api/agency-memberships/current', { withCredentials: true })
  .then((res) => res.data)

export interface AgencyPermissionContext {
  supplier: string | null
  role: bookcarsTypes.AgencyRole
  permissions: string[]
}

// The caller's own agency context + the permissions the backend enforces
// for their role (H-038). The permission list is computed by the backend
// from its own role matrix, so the UI never re-implements the matrix.
export const getMine = (): Promise<AgencyPermissionContext> => axiosInstance
  .get('/api/agency-memberships/me', { withCredentials: true })
  .then((res) => res.data)

export const list = (supplierId: string): Promise<bookcarsTypes.AgencyMembership[]> => axiosInstance
  .get(`/api/agency-memberships/${encodeURIComponent(supplierId)}`, { withCredentials: true })
  .then((res) => res.data)

export const create = (
  supplierId: string,
  data: bookcarsTypes.CreateAgencyMembershipPayload,
): Promise<bookcarsTypes.AgencyMembership> => axiosInstance
  .post(`/api/agency-memberships/${encodeURIComponent(supplierId)}`, data, { withCredentials: true })
  .then((res) => res.data)

export const update = (
  supplierId: string,
  membershipId: string,
  data: bookcarsTypes.UpdateAgencyMembershipPayload,
): Promise<bookcarsTypes.AgencyMembership> => axiosInstance
  .put(`/api/agency-memberships/${encodeURIComponent(supplierId)}/${encodeURIComponent(membershipId)}`, data, { withCredentials: true })
  .then((res) => res.data)
