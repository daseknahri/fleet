import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

const config = (supplierId?: string) => ({ withCredentials: true, ...(supplierId ? { params: { supplier: supplierId } } : {}) })

export const getAgencyReturnSettings = (supplierId?: string) => axiosInstance
  .get('/api/agency-return-settings', config(supplierId))
  .then((res) => res.data as bookcarsTypes.AgencyReturnSettings | null)

export const updateAgencyReturnSettings = (data: bookcarsTypes.UpdateAgencyReturnSettingsPayload, supplierId?: string) => axiosInstance
  .put('/api/agency-return-settings', supplierId ? { ...data, supplier: supplierId } : data, config())
  .then((res) => ({ status: res.status, data: res.data as bookcarsTypes.AgencyReturnSettings }))
