import express from 'express'
import routeNames from '../config/signingRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import { signGetRateLimiter, signPostRateLimiter } from '../middlewares/rateLimiter'
import * as signingController from '../controllers/signingController'

const routes = express.Router()

// GA-PAR-12 staff side: link management is a booking-management action,
// gated exactly like the PAR-10/PAR-11 booking mutations (authJwt +
// agency context + ManageBookings). No new agency permission is added.
routes.route(routeNames.issue).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), signingController.issueSigningLink)
routes.route(routeNames.revoke).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), signingController.revokeSigningLink)

// GA-PAR-12 public side: unauthenticated by design (capability token),
// behind the dedicated signing limiters — never the shared auth bucket.
routes.route(routeNames.summary).get(signGetRateLimiter, signingController.getSigningSummary)
routes.route(routeNames.sign).post(signPostRateLimiter, signingController.signBooking)

export default routes
