const routes = { list: '/api/invoices', create: '/api/invoices', issue: '/api/invoices/:id/issue', void: '/api/invoices/:id/void', payments: '/api/invoices/:id/payments', unlinkPayment: '/api/invoices/:id/payments/unlink', recordDelivery: '/api/invoices/:id/deliveries', pdf: '/api/invoices/:id/pdf' }
export default routes
