import express from 'express'
import routeNames from '../config/reportRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as controller from '../controllers/reportController'
const routes = express.Router()
routes.get(routeNames.summary, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments), controller.summary)
routes.get(routeNames.exportCsv, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadPayments), controller.exportCsv)
export default routes
