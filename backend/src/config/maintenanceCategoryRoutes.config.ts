const routes = {
  list: '/api/maintenance-categories',
  create: '/api/maintenance-categories',
  update: '/api/maintenance-categories/:id',
  delete: '/api/maintenance-categories/:id',
  // GH-36 - append-only audit trail (survives a hard delete).
  listAudit: '/api/maintenance-categories/:id/audit',
}

export default routes