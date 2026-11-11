const routes = {
  summary: '/api/reports/summary',
  exportCsv: '/api/reports/summary.csv',
  // GA-PAR-14 — builder, builder CSV, drill-down, saved views and the
  // GA-PAR-09 Phase B dashboard aggregate. All gated ReadPayments,
  // exactly like the established summary/exportCsv routes above.
  builder: '/api/reports/builder',
  builderCsv: '/api/reports/builder.csv',
  drilldown: '/api/reports/drilldown',
  views: '/api/reports/views',
  view: '/api/reports/views/:id',
  dashboardSummary: '/api/dashboard/summary',
  // GA-PAR-17 — per-car PDF (scorecard #21 residual), ReadPayments.
  carPdf: '/api/reports/car/:carId/pdf',
}
export default routes
