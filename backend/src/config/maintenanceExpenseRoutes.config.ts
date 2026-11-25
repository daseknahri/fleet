const routes = {
  list: '/api/maintenance-expenses',
  report: '/api/maintenance-expenses/report',
  uploadReceipt: '/api/maintenance-expenses/receipts',
  deleteTempReceipt: '/api/maintenance-expenses/receipts/:file',
  create: '/api/maintenance-expenses',
  update: '/api/maintenance-expenses/:id',
  delete: '/api/maintenance-expenses/:id',
  // F7 / W3 M-2 — append-only payment records backing paidAmount.
  recordPayment: '/api/maintenance-expenses/:id/payments',
  listPayments: '/api/maintenance-expenses/:id/payments',
  // GH-24 — repair path for payments posted unlinked + the unlinked list.
  linkBankSession: '/api/maintenance-expenses/:id/payments/:paymentId/link-bank-session',
  linkCashSession: '/api/maintenance-expenses/:id/payments/:paymentId/link-cash-session',
  listUnlinkedPayments: '/api/maintenance-expenses/unlinked-payments',
  // F7 / W3 M-7 — append-only audit trail (survives a hard delete).
  listAudit: '/api/maintenance-expenses/:id/audit',
}

export default routes
