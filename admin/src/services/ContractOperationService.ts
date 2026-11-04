import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

const base = '/api/contract-operations'

const config = (supplierId?: string) => ({ withCredentials: true, ...(supplierId ? { params: { supplier: supplierId } } : {}) })
const withSupplier = (url: string, supplierId?: string) => (supplierId ? `${url}?supplier=${encodeURIComponent(supplierId)}` : url)

export const list = (bookingId: string, supplierId?: string) => axiosInstance.get(`${base}/${bookingId}`, config(supplierId)).then((res) => res.data as bookcarsTypes.ContractInspection[])
export const createInspection = (bookingId: string, type: 'handover' | 'return', data: bookcarsTypes.CreateContractInspectionPayload, supplierId?: string) => axiosInstance.post(withSupplier(`${base}/${bookingId}/${type}`, supplierId), data, config()).then((res) => res.data as { booking: bookcarsTypes.Booking; inspection: bookcarsTypes.ContractInspection })
export const listCharges = (bookingId: string, supplierId?: string) => axiosInstance.get(`${base}/${bookingId}/charges`, config(supplierId)).then((res) => res.data as bookcarsTypes.ContractCharge[])
export const createCharge = (bookingId: string, data: { type: bookcarsTypes.ContractChargeType; amount: number; currency?: string; reason: string }, supplierId?: string) => axiosInstance.post(withSupplier(`${base}/${bookingId}/charges`, supplierId), data, config()).then((res) => res.data as bookcarsTypes.ContractCharge)
export const decideCharge = (bookingId: string, chargeId: string, decision: bookcarsTypes.ApprovalDecision, note?: string, supplierId?: string) => axiosInstance.post(withSupplier(`${base}/${bookingId}/charges/${chargeId}/decide`, supplierId), { decision, note }, config()).then((res) => res.data as bookcarsTypes.ContractCharge)
export const createSnapshot = (bookingId: string, supplierId?: string) => axiosInstance.post(withSupplier(`${base}/${bookingId}/snapshots`, supplierId), null, config()).then((res) => res.data as bookcarsTypes.ContractSnapshot)
export const complete = (bookingId: string, supplierId?: string) => axiosInstance.post(withSupplier(`${base}/${bookingId}/complete`, supplierId), null, config()).then((res) => res.data as { booking: bookcarsTypes.Booking; receivable: { approvedCharges: number; outstandingBalance: number; overdue: boolean } })

const filePath = (bookingId: string, filename: string, supplierId?: string) => withSupplier(`${base}/${bookingId}/files/${encodeURIComponent(filename)}`, supplierId)

export const uploadFile = (bookingId: string, file: File, kind: 'photo' | 'signature' = 'photo', supplierId?: string) => {
  const data = new FormData()
  data.append('file', file)
  data.append('kind', kind)
  return axiosInstance.post(withSupplier(`${base}/${bookingId}/files`, supplierId), data, { ...config(), headers: { 'Content-Type': 'multipart/form-data' } }).then((res) => res.data as { filename: string; kind: string })
}

export const getFileUrl = (bookingId: string, filename: string, supplierId?: string) => `${axiosInstance.defaults.baseURL}${filePath(bookingId, filename, supplierId)}`

// Fetches a private contract file through the authenticated axios instance and returns a blob URL.
export const fetchFileUrl = async (bookingId: string, filename: string, supplierId?: string) => {
  const res = await axiosInstance.get(filePath(bookingId, filename, supplierId), { ...config(), responseType: 'blob' })
  return URL.createObjectURL(res.data as Blob)
}

export const getSnapshotUrl = (bookingId: string, filename: string, supplierId?: string) => `${axiosInstance.defaults.baseURL}${withSupplier(`${base}/${bookingId}/snapshots/${encodeURIComponent(filename)}`, supplierId)}`

// Fetches the private snapshot PDF through the authenticated axios instance and returns a blob URL.
export const fetchSnapshotUrl = async (bookingId: string, filename: string, supplierId?: string) => {
  const res = await axiosInstance.get(withSupplier(`${base}/${bookingId}/snapshots/${encodeURIComponent(filename)}`, supplierId), { ...config(), responseType: 'blob' })
  return URL.createObjectURL(res.data as Blob)
}
