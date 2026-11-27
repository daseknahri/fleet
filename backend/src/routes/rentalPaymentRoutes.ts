import express from 'express'
import routeNames from '../config/rentalPaymentRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as rentalPaymentController from '../controllers/rentalPaymentController'

const routes = express.Router()

routes.route(routeNames.list).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments, { allowPlatformAdminAll: true }), rentalPaymentController.list)
routes.route(routeNames.overdue).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments, { allowPlatformAdminAll: true }), rentalPaymentController.overdue)
routes.route(routeNames.pendingRefunds).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments, { allowPlatformAdminAll: true }), rentalPaymentController.pendingRefunds)
routes.route(routeNames.collectionsSummary).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments, { allowPlatformAdminAll: true }), rentalPaymentController.collectionsSummary)
routes.route(routeNames.purposeRemaining).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments, { allowPlatformAdminAll: true }), rentalPaymentController.purposeRemaining)
routes.route(routeNames.exportCsv).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments, { allowPlatformAdminAll: true }), rentalPaymentController.exportPaymentsCsv)
routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.create)
routes.route(routeNames.reverse).post(authJwt.verifyToken, agencyAuth.requirePaymentAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.reverse)
routes.route(routeNames.confirm).post(authJwt.verifyToken, agencyAuth.requirePaymentAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.confirm)
routes.route(routeNames.linkCashSession).post(authJwt.verifyToken, agencyAuth.requirePaymentAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.linkCashSession)
routes.route(routeNames.linkBankSession).post(authJwt.verifyToken, agencyAuth.requirePaymentAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.linkBankSession)
routes.route(routeNames.update).patch(authJwt.verifyToken, agencyAuth.requirePaymentAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.update)
routes.route(routeNames.remove).delete(authJwt.verifyToken, agencyAuth.requirePaymentAgencyPermission(agencyAuth.AgencyPermission.RecordPayments), rentalPaymentController.remove)

export default routes
