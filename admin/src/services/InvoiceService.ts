import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

// The invoice record also carries the approval fields written by the
// approvals flow (backend Invoice model); the shared Invoice type does not
// declare them yet, so the page reads them through this extension.
export type InvoiceWithApproval = bookcarsTypes.Invoice & {
  approvalDecision?: bookcarsTypes.ApprovalDecision
  approvalDecidedAt?: Date
  approvalNote?: string
}

export const list = (): Promise<InvoiceWithApproval[]> =>
  axiosInstance.get('/api/invoices', { withCredentials: true }).then((res) => res.data)

export const create = (data: bookcarsTypes.CreateInvoicePayload): Promise<InvoiceWithApproval> =>
  axiosInstance.post('/api/invoices', data, { withCredentials: true }).then((res) => res.data)

export const issue = (id: string): Promise<InvoiceWithApproval> =>
  axiosInstance.post(`/api/invoices/${encodeURIComponent(id)}/issue`, {}, { withCredentials: true }).then((res) => res.data)

export const voidInvoice = (id: string, data: bookcarsTypes.VoidInvoicePayload): Promise<InvoiceWithApproval> =>
  axiosInstance.post(`/api/invoices/${encodeURIComponent(id)}/void`, data, { withCredentials: true }).then((res) => res.data)

export const recordPayment = (id: string, payment: string): Promise<InvoiceWithApproval> =>
  axiosInstance.post(`/api/invoices/${encodeURIComponent(id)}/payments`, { payment }, { withCredentials: true }).then((res) => res.data)

export const downloadPdf = (id: string): Promise<Blob> =>
  axiosInstance.get(`/api/invoices/${encodeURIComponent(id)}/pdf`, { withCredentials: true, responseType: 'blob' }).then((res) => res.data as Blob)
