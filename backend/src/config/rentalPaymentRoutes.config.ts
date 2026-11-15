const routes = {
  list: '/api/rental-payments',
  create: '/api/rental-payments',
  reverse: '/api/rental-payments/:id/reverse',
  confirm: '/api/rental-payments/:id/confirm',
  // GA-PAR-17 — collections summary + payments CSV export; both gated
  // ReadPayments exactly like the list route above.
  collectionsSummary: '/api/rental-payments/collections-summary',
  exportCsv: '/api/rental-payments/export.csv',
  // F6 / W3 P-3 — shared outstanding/receivable table (ReadPayments).
  overdue: '/api/rental-payments/overdue',
  // F6 / W3 C-7 — manually link a posted cash payment into a chosen
  // open cash session (RecordPayments, like create/confirm).
  linkCashSession: '/api/rental-payments/:id/link-cash-session',
}

export default routes