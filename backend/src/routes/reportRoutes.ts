import express from 'express'
import routeNames from '../config/reportRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as controller from '../controllers/reportController'
const routes = express.Router()
const readPayments = agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments)
routes.get(routeNames.summary, authJwt.verifyToken, readPayments, controller.summary)
routes.get(routeNames.exportCsv, authJwt.verifyToken, readPayments, controller.exportCsv)
// GA-PAR-14: saved-view routes are registered before the other
// /api/reports/* GETs only for readability — every path is distinct.
routes.get(routeNames.views, authJwt.verifyToken, readPayments, controller.listViews)
routes.post(routeNames.views, authJwt.verifyToken, readPayments, controller.createView)
routes.put(routeNames.view, authJwt.verifyToken, readPayments, controller.updateView)
routes.delete(routeNames.view, authJwt.verifyToken, readPayments, controller.deleteView)
routes.get(routeNames.builder, authJwt.verifyToken, readPayments, controller.builder)
routes.get(routeNames.builderCsv, authJwt.verifyToken, readPayments, controller.builderCsv)
routes.get(routeNames.drilldown, authJwt.verifyToken, readPayments, controller.drilldown)
routes.get(routeNames.dashboardSummary, authJwt.verifyToken, readPayments, controller.dashboardSummary)
routes.get(routeNames.carPdf, authJwt.verifyToken, readPayments, controller.carPdf)
export default routes
