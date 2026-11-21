import express from 'express'
import routeNames from '../config/bookingRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import { checkoutRateLimiter } from '../middlewares/rateLimiter'
import * as bookingController from '../controllers/bookingController'
import * as bookingAmendmentController from '../controllers/bookingAmendmentController'

const routes = express.Router()

routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.create)
// F4 / W1 #8 (= W4 GAP-01) — the public checkout surface gets its
// rate limiter back (own 'checkout' bucket; anonymous-capable, no
// auth middleware — checkout identity comes from the body).
routes.route(routeNames.checkout).post(checkoutRateLimiter, bookingController.checkout)
routes.route(routeNames.confirmPaymentIntent).post(checkoutRateLimiter, bookingController.confirmPaymentIntent)
routes.route(routeNames.update).put(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.update)
routes.route(routeNames.updateStatus).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.updateStatus)
routes.route(routeNames.delete).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.deleteBookings)
// GA-PAR-22: trash / restore / trash view are ManageBookings work —
// the same capability as the delete they replace (no new capability).
routes.route(routeNames.trash).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.trashBookings)
routes.route(routeNames.restore).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.restoreBookings)
routes.route(routeNames.getTrashed).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.getTrashedBookings)
routes.route(routeNames.trashWarning).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.getBookingTrashWarning)
routes.route(routeNames.deleteTempBooking).delete(bookingController.deleteTempBooking)
routes.route(routeNames.getBooking).get(authJwt.verifyTokenOptional, bookingController.getBooking)
routes.route(routeNames.getBookingId).get(bookingController.getBookingId)
routes.route(routeNames.getBookings).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadBookings), bookingController.getBookings)
routes.route(routeNames.hasBookings).get(authJwt.verifyToken, bookingController.hasBookings)
routes.route(routeNames.cancelBooking).post(authJwt.verifyToken, bookingController.cancelBooking)
// F3 / W1 #1 + #9 + #3 — staff cancel workflow (ManageBookings, same
// capability as update/updateStatus).
routes.route(routeNames.cancelBookingStaff).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.cancelBookingStaff)
routes.route(routeNames.getCancelRequests).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.getCancelRequests)
routes.route(routeNames.decideCancelRequest).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.decideCancelRequest)
// Wave 2.3 — refund plan (ManageBookings, same capability as the cancel
// it precedes). Wave 2.1 — confirm a hold (Owner/Manager enforced in
// the controller) + the confirmed-unpaid watchlist (ReadBookings).
routes.route(routeNames.getRefundPlan).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.getRefundPlan)
routes.route(routeNames.confirmReservation).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.confirmReservation)
routes.route(routeNames.getConfirmedUnpaid).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadBookings), bookingController.getConfirmedUnpaid)
routes.route(routeNames.amend).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingAmendmentController.amend)
// F4 / W1 #7 — no-show marking + overdue list (ManageBookings, same
// capability as the cancel workflow they sit beside).
routes.route(routeNames.markNoShow).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.markNoShow)
routes.route(routeNames.getOverdueBookings).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.getOverdueBookings)

export default routes
