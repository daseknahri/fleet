const routes = {
  list: '/api/contract-operations/:bookingId',
  handover: '/api/contract-operations/:bookingId/handover',
  returnInspection: '/api/contract-operations/:bookingId/return',
  complete: '/api/contract-operations/:bookingId/complete',
  uploadFile: '/api/contract-operations/:bookingId/files',
  deleteFile: '/api/contract-operations/:bookingId/files/:filename',
  getFile: '/api/contract-operations/:bookingId/files/:filename',
  charges: '/api/contract-operations/:bookingId/charges',
  decideCharge: '/api/contract-operations/:bookingId/charges/:chargeId/decide',
  snapshot: '/api/contract-operations/:bookingId/snapshots',
  snapshotFile: '/api/contract-operations/:bookingId/snapshots/:filename',
}
export default routes
