const routes = {
  list: '/api/rental-payments',
  create: '/api/rental-payments',
  reverse: '/api/rental-payments/:id/reverse',
  confirm: '/api/rental-payments/:id/confirm',
  // GA-PAR-17 — collections summary + payments CSV export; both gated
  // ReadPayments exactly like the list route above.
  collectionsSummary: '/api/rental-payments/collections-summary',
  exportCsv: '/api/rental-payments/export.csv',
}

export default routes