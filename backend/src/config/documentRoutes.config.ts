const routes = {
  downloadContract: '/api/supplier-contract/:supplierId/:filename',
  downloadLicense: '/api/user-license/:userId/:filename',
  downloadMaintenanceReceipt: '/api/maintenance-expense-receipt/:expenseId/:filename',
  downloadClientDocument: '/api/client-document/:userId/:filename',
  // F5b (W2-14): privately stored car documents (see documentController).
  downloadCarDocument: '/api/car-document/:id/:filename',
}

export default routes
