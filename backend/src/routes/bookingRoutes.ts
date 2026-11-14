import express from 'express'
import routeNames from '../config/bookingRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as bookingController from '../controllers/bookingController'
import * as bookingAmendmentController from '../controllers/bookingAmendmentController'

const routes = express.Router()

routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingController.create)
routes.route(routeNames.checkout).post(bookingController.checkout)
routes.route(routeNames.confirmPaymentIntent).post(bookingController.confirmPaymentIntent)
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
routes.route(routeNames.amend).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), bookingAmendmentController.amend)

export default routes
