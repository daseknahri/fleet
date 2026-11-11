import express from 'express'
import routeNames from '../config/rentalPaymentRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as rentalPaymentController from '../controllers/rentalPaymentController'

const routes = express.Router()

routes.route(routeNames.list).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments), rentalPaymentController.list)
routes.route(routeNames.collectionsSummary).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments), rentalPaymentController.collectionsSummary)
routes.route(routeNames.exportCsv).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments), rentalPaymentController.exportPaymentsCsv)
routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.create)
routes.route(routeNames.reverse).post(authJwt.verifyToken, agencyAuth.requirePaymentAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.reverse)
routes.route(routeNames.confirm).post(authJwt.verifyToken, agencyAuth.requirePaymentAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.confirm)

export default routes
