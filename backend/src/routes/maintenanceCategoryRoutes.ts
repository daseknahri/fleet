import express from 'express'
import routeNames from '../config/maintenanceCategoryRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as maintenanceCategoryController from '../controllers/maintenanceCategoryController'

const routes = express.Router()

routes.get(routeNames.list, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadExpenses, { allowPlatformAdminAll: true }), maintenanceCategoryController.list)
routes.post(routeNames.create, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageExpenses), maintenanceCategoryController.create)
routes.put(routeNames.update, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageExpenses), maintenanceCategoryController.update)
routes.delete(routeNames.delete, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageExpenses), maintenanceCategoryController.remove)

export default routes