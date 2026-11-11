import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

export const list = (): Promise<bookcarsTypes.RentalPayment[]> =>
  axiosInstance.get('/api/rental-payments', { withCredentials: true }).then((res) => res.data)

export const create = (data: bookcarsTypes.CreateRentalPaymentPayload): Promise<bookcarsTypes.RentalPayment> =>
  axiosInstance.post('/api/rental-payments', data, { withCredentials: true }).then((res) => res.data)

export const reverse = (paymentId: string, idempotencyKey: string, note?: string): Promise<bookcarsTypes.RentalPayment> =>
  axiosInstance.post(`/api/rental-payments/${encodeURIComponent(paymentId)}/reverse`, {
    idempotencyKey,
    note,
  }, { withCredentials: true }).then((res) => res.data)

// GA-PAR-17 — collections summary (dictionary v2026-11-11.2) + payments CSV export.
export const collectionsSummary = (): Promise<bookcarsTypes.CollectionsSummary> =>
  axiosInstance.get('/api/rental-payments/collections-summary', { withCredentials: true }).then((res) => res.data)

export const exportCsv = () =>
  axiosInstance.get('/api/rental-payments/export.csv', { responseType: 'blob', withCredentials: true }).then((res) => res.data as Blob)
