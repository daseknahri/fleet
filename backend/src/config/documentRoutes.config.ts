const routes = {
  downloadContract: '/api/supplier-contract/:supplierId/:filename',
  downloadLicense: '/api/user-license/:userId/:filename',
  downloadMaintenanceReceipt: '/api/maintenance-expense-receipt/:expenseId/:filename',
  downloadClientDocument: '/api/client-document/:userId/:filename',
}

export default routes
