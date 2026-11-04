import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

export const listCurrent = (): Promise<bookcarsTypes.AgencyMembership[]> => axiosInstance
  .get('/api/agency-memberships/current', { withCredentials: true })
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
