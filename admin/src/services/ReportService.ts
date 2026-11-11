import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from '@/services/axiosInstance'

export interface ReportSummary { metricDictionaryVersion: string; currency: string; timezone: string; from: string; to: string; metrics: Record<string, number> }
export const summary = (from?: string, to?: string, supplier?: string): Promise<ReportSummary> => axiosInstance.get('/api/reports/summary', { params: { from, to, ...(supplier ? { supplier } : {}) }, withCredentials: true }).then((res) => res.data)
export const exportCsv = (from?: string, to?: string, supplier?: string) => axiosInstance.get('/api/reports/summary.csv', { params: { from, to, ...(supplier ? { supplier } : {}) }, responseType: 'blob', withCredentials: true }).then((res) => res.data as Blob)

// GA-PAR-14 — reports builder, drill-down, saved views, builder CSV and
// the GA-PAR-09 Phase B dashboard aggregate (dictionary v2026-11-11.1).
export interface BuilderParams {
  from: string
  to: string
  groupBy: bookcarsTypes.ReportGroupBy
  carId?: string
  compare?: boolean
  scope?: bookcarsTypes.ReportScope
  supplier?: string
}

const builderQuery = (params: BuilderParams) => ({
  from: params.from,
  to: params.to,
  groupBy: params.groupBy,
  ...(params.carId ? { carId: params.carId } : {}),
  ...(params.compare ? { compare: 'true' } : {}),
  ...(params.scope && params.scope !== bookcarsTypes.ReportScope.All ? { scope: params.scope } : {}),
  ...(params.supplier ? { supplier: params.supplier } : {}),
})

export const builder = (params: BuilderParams): Promise<bookcarsTypes.ReportBuilderResult> => axiosInstance.get('/api/reports/builder', { params: builderQuery(params), withCredentials: true }).then((res) => res.data)

export const builderCsv = (params: BuilderParams) => axiosInstance.get('/api/reports/builder.csv', { params: builderQuery(params), responseType: 'blob', withCredentials: true }).then((res) => res.data as Blob)

export const drilldown = (params: BuilderParams & { bucket: string }): Promise<bookcarsTypes.ReportDrilldownResult> => axiosInstance.get('/api/reports/drilldown', { params: { ...builderQuery(params), bucket: params.bucket }, withCredentials: true }).then((res) => res.data)

export const listViews = (supplier?: string): Promise<bookcarsTypes.ReportView[]> => axiosInstance.get('/api/reports/views', { params: supplier ? { supplier } : undefined, withCredentials: true }).then((res) => res.data)

export const createView = (data: bookcarsTypes.CreateReportViewPayload): Promise<bookcarsTypes.ReportView> => axiosInstance.post('/api/reports/views', data, { withCredentials: true }).then((res) => res.data)

export const updateView = (id: string, data: bookcarsTypes.UpdateReportViewPayload): Promise<bookcarsTypes.ReportView> => axiosInstance.put(`/api/reports/views/${encodeURIComponent(id)}`, data, { withCredentials: true }).then((res) => res.data)

export const deleteView = (id: string, supplier?: string): Promise<number> => axiosInstance.delete(`/api/reports/views/${encodeURIComponent(id)}`, { params: supplier ? { supplier } : undefined, withCredentials: true }).then((res) => res.status)

export const dashboardSummary = (from: string, to: string, supplier?: string): Promise<bookcarsTypes.DashboardSummary> => axiosInstance.get('/api/dashboard/summary', { params: { from, to, ...(supplier ? { supplier } : {}) }, withCredentials: true }).then((res) => res.data)

// GA-PAR-17 — per-car PDF (scorecard #21 residual).
export const carPdf = (carId: string, from: string, to: string, supplier?: string) => axiosInstance.get(`/api/reports/car/${encodeURIComponent(carId)}/pdf`, { params: { from, to, ...(supplier ? { supplier } : {}) }, responseType: 'blob', withCredentials: true }).then((res) => res.data as Blob)
