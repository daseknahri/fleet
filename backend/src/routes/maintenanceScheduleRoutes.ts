import express from 'express'
import routeNames from '../config/maintenanceScheduleRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as controller from '../controllers/maintenanceScheduleController'
const routes = express.Router()
routes.get(routeNames.list, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadExpenses), controller.list)
routes.post(routeNames.create, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageExpenses), controller.create)
routes.put(routeNames.update, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageExpenses), controller.update)
routes.delete(routeNames.delete, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageExpenses), controller.remove)
export default routes
