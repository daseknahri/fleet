import express from 'express'
import routeNames from '../config/settingRoutes.config'
import authJwt from '../middlewares/authJwt'
import * as settingController from '../controllers/settingController'

const routes = express.Router()

routes.route(routeNames.getSettings).get(authJwt.verifyToken, settingController.getSettings)
routes.route(routeNames.getConnections).get(authJwt.verifyToken, settingController.getConnections)
routes.route(routeNames.updateSettings).put(authJwt.verifyToken, authJwt.authAdmin, settingController.updateSettings)

export default routes
