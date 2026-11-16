const routes = {
  sessions: '/api/cash/sessions',
  current: '/api/cash/sessions/current',
  open: '/api/cash/sessions',
  movements: '/api/cash/sessions/:sessionId/movements',
  confirmMovement: '/api/cash/sessions/:sessionId/movements/:movementId/confirm',
  close: '/api/cash/sessions/:sessionId/close',
  zReport: '/api/cash/sessions/:sessionId/z-report',
  transfer: '/api/cash/transfers',
  // F6 / W3 C-5 — server-side cash journal (JSON + CSV export), one
  // scope and one set of figures per session.
  journal: '/api/cash/journal',
  journalCsv: '/api/cash/journal.csv',
  // F6 / W3 C-1 — the chained opening for the open-session dialog.
  previousClose: '/api/cash/sessions/previous-close',
}
export default routes
