import axiosInstance from '@/services/axiosInstance'

export interface ReportSummary { metricDictionaryVersion: string; currency: string; timezone: string; from: string; to: string; metrics: Record<string, number> }
export const summary = (from?: string, to?: string, supplier?: string): Promise<ReportSummary> => axiosInstance.get('/api/reports/summary', { params: { from, to, ...(supplier ? { supplier } : {}) }, withCredentials: true }).then(res => res.data)
export const exportCsv = (from?: string, to?: string, supplier?: string) => axiosInstance.get('/api/reports/summary.csv', { params: { from, to, ...(supplier ? { supplier } : {}) }, responseType: 'blob', withCredentials: true }).then(res => res.data as Blob)
