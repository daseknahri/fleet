const routes = {
  create: '/api/create-booking',
  checkout: '/api/checkout',
  confirmPaymentIntent: '/api/confirm-payment-intent',
  update: '/api/update-booking',
  updateStatus: '/api/update-booking-status',
  delete: '/api/delete-bookings',
  // GA-PAR-22: trash / restore + the trash view's read path. Purge
  // reuses the existing delete route (trash precondition, §4.1).
  trash: '/api/trash-bookings',
  restore: '/api/restore-bookings',
  getTrashed: '/api/trashed-bookings/:page/:size/:language',
  trashWarning: '/api/bookings/:id/trash-warning',
  deleteTempBooking: '/api/delete-temp-booking/:bookingId/:sessionId',
  getBooking: '/api/booking/:id/:language',
  getBookingId: '/api/booking-id/:sessionId',
  getBookings: '/api/bookings/:page/:size/:language',
  hasBookings: '/api/has-bookings/:driver',
  cancelBooking: '/api/cancel-booking/:id',
  // F3 / W1 #1 + #9 — staff cancel workflow, cancel-request queue
  // + decision. ManageBookings work, same capability as update/updateStatus.
  cancelBookingStaff: '/api/bookings/:id/cancel',
  getCancelRequests: '/api/cancel-requests/:page/:size/:language',
  decideCancelRequest: '/api/bookings/:id/decide-cancel-request',
  amend: '/api/bookings/:id/amend',
  // F4 / W1 #7 — no-show marking + overdue (late-return) list.
  markNoShow: '/api/bookings/:id/mark-no-show',
  getOverdueBookings: '/api/overdue-bookings/:page/:size/:language',
}

export default routes
