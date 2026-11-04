import express from 'express'
import routeNames from '../config/approvalRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as controller from '../controllers/approvalController'
const routes = express.Router()
routes.get(routeNames.list, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.DecideInvoices), controller.list)
routes.post(routeNames.create, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageInvoices), controller.create)
routes.post(routeNames.decide, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.DecideInvoices), controller.decide)
export default routes
