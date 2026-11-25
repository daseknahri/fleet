import axiosInstance from './axiosInstance'

export interface CustomerInvoiceSummary { id: string, number?: string, status: string, total: number, currency: string, issuedAt?: string }

export const getByBooking = (bookingId: string): Promise<CustomerInvoiceSummary | null> =>
  axiosInstance.get(`/api/customer-invoices/by-booking/${encodeURIComponent(bookingId)}`, { withCredentials: true })
    .then((res) => (res.status === 204 ? null : res.data))

export const downloadPdf = async (id: string, filename: string): Promise<void> => {
  const res = await axiosInstance.get(`/api/customer-invoices/${encodeURIComponent(id)}/pdf`, { withCredentials: true, responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
