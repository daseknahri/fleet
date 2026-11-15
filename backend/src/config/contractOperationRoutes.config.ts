const routes = {
  list: '/api/contract-operations/:bookingId',
  handover: '/api/contract-operations/:bookingId/handover',
  returnInspection: '/api/contract-operations/:bookingId/return',
  complete: '/api/contract-operations/:bookingId/complete',
  settlementPreview: '/api/contract-operations/:bookingId/settlement-preview',
  uploadFile: '/api/contract-operations/:bookingId/files',
  deleteFile: '/api/contract-operations/:bookingId/files/:filename',
  getFile: '/api/contract-operations/:bookingId/files/:filename',
  charges: '/api/contract-operations/:bookingId/charges',
  decideCharge: '/api/contract-operations/:bookingId/charges/:chargeId/decide',
  // F4 / W1 #7 — dispute raise/resolve on charges and inspections.
  disputeCharge: '/api/contract-operations/:bookingId/charges/:chargeId/dispute',
  resolveChargeDispute: '/api/contract-operations/:bookingId/charges/:chargeId/dispute/resolve',
  disputeInspection: '/api/contract-operations/:bookingId/inspections/:inspectionId/dispute',
  resolveInspectionDispute: '/api/contract-operations/:bookingId/inspections/:inspectionId/dispute/resolve',
  snapshot: '/api/contract-operations/:bookingId/snapshots',
  snapshotFile: '/api/contract-operations/:bookingId/snapshots/:filename',
}
export default routes
