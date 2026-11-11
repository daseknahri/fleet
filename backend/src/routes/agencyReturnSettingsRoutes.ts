import express from 'express'
import routeNames from '../config/agencyReturnSettingsRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as controller from '../controllers/agencyReturnSettingsController'

const routes = express.Router()
routes.get(routeNames.get, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadAgencyProfile), controller.getAgencyReturnSettings)
routes.put(routeNames.update, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageAgencyProfile), controller.updateAgencyReturnSettings)
export default routes
