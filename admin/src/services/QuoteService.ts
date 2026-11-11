import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

// GA-PAR-05 — quotes (devis) API client. Quotes live on their own backend
// resource (/api/quotes) gated by the invoices permissions; this service
// mirrors InvoiceService conventions.
export const list = (): Promise<bookcarsTypes.Quote[]> =>
  axiosInstance.get('/api/quotes', { withCredentials: true }).then((res) => res.data)

export const get = (id: string): Promise<bookcarsTypes.Quote> =>
  axiosInstance.get(`/api/quotes/${encodeURIComponent(id)}`, { withCredentials: true }).then((res) => res.data)

export const create = (data: bookcarsTypes.CreateQuotePayload): Promise<bookcarsTypes.Quote> =>
  axiosInstance.post('/api/quotes', data, { withCredentials: true }).then((res) => res.data)

export const update = (id: string, data: bookcarsTypes.UpdateQuotePayload): Promise<bookcarsTypes.Quote> =>
  axiosInstance.put(`/api/quotes/${encodeURIComponent(id)}`, data, { withCredentials: true }).then((res) => res.data)

export const transition = (id: string, status: bookcarsTypes.QuoteStatus): Promise<bookcarsTypes.Quote> =>
  axiosInstance.post(`/api/quotes/${encodeURIComponent(id)}/transition`, { status }, { withCredentials: true }).then((res) => res.data)

export const convert = (id: string): Promise<bookcarsTypes.ConvertQuoteResult> =>
  axiosInstance.post(`/api/quotes/${encodeURIComponent(id)}/convert`, {}, { withCredentials: true }).then((res) => res.data)

export const downloadPdf = (id: string): Promise<Blob> =>
  axiosInstance.get(`/api/quotes/${encodeURIComponent(id)}/pdf`, { withCredentials: true, responseType: 'blob' }).then((res) => res.data as Blob)
