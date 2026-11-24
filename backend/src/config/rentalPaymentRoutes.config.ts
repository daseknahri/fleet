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
  // GH-11 — pending wire/manual refunds list (ReadPayments).
  pendingRefunds: '/api/rental-payments/pending-refunds',
  // F6 / W3 C-7 — manually link a posted cash payment into a chosen
  // open cash session (RecordPayments, like create/confirm).
  linkCashSession: '/api/rental-payments/:id/link-cash-session',
  // Wave 2.6 — the bank mirror of link-cash-session.
  linkBankSession: '/api/rental-payments/:id/link-bank-session',
  // F6 / W3 P-8 — edit / delete a stuck Pending entry (RecordPayments,
  // like create/confirm).
  update: '/api/rental-payments/:id',
  remove: '/api/rental-payments/:id',
}

export default routes