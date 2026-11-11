import express from 'express'
import routeNames from '../config/reminderRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as controller from '../controllers/reminderController'

const routes = express.Router()
// GA-PAR-13: ReadReminders gates list/get; ManageReminders gates every
// mutation AND the firing history. The firings route is registered
// before :id-shaped routes are matched for the same method is not an
// issue (distinct path suffix), but keep it explicit and first anyway.
routes.get(routeNames.firings, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageReminders), controller.firings)
routes.get(routeNames.list, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadReminders), controller.list)
routes.post(routeNames.create, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageReminders), controller.create)
routes.get(routeNames.get, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadReminders), controller.getOne)
routes.put(routeNames.update, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageReminders), controller.update)
routes.delete(routeNames.remove, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageReminders), controller.remove)
export default routes
