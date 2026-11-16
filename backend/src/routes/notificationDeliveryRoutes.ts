import express from 'express'
import routeNames from '../config/notificationDeliveryRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as controller from '../controllers/notificationDeliveryController'

const routes = express.Router()
// F8 / W5 N3 — delivery log: ReadReminders gates the list,
// ManageReminders gates retry (same split as the reminders routes).
routes.get(routeNames.list, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadReminders), controller.list)
routes.post(routeNames.retry, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageReminders), controller.retry)
export default routes
