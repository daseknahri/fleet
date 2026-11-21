import express from 'express'
import routeNames from '../config/settingRoutes.config'
import authJwt from '../middlewares/authJwt'
import * as settingController from '../controllers/settingController'

const routes = express.Router()

// Anonymous search needs settings: the Setting document holds only four
// public numeric limits (minPickupHours, minRentalHours, min/max pickup/
// dropoff hour) and no secrets, so getSettings is public. getConnections
// and updateSettings stay behind verifyToken + authAdmin (Wave 1.7:
// getConnections used to be verifyToken-only, so any signed-in user
// could read the integration connection list).
routes.route(routeNames.getSettings).get(settingController.getSettings)
routes.route(routeNames.getConnections).get(authJwt.verifyToken, authJwt.authAdmin, settingController.getConnections)
routes.route(routeNames.updateSettings).put(authJwt.verifyToken, authJwt.authAdmin, settingController.updateSettings)

export default routes
