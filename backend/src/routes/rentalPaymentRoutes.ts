import express from 'express'
import routeNames from '../config/rentalPaymentRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as rentalPaymentController from '../controllers/rentalPaymentController'

const routes = express.Router()

routes.route(routeNames.list).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments), rentalPaymentController.list)
routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.create)
routes.route(routeNames.reverse).post(authJwt.verifyToken, agencyAuth.requirePaymentAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.reverse)

export default routes
