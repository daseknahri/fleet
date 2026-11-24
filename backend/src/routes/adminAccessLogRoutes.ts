import express from 'express'
import routeNames from '../config/adminAccessLogRoutes.config'
import authJwt from '../middlewares/authJwt'
import * as controller from '../controllers/adminAccessLogController'

const routes = express.Router()
// GH-07 — the audit log names every agency an admin touched, so only
// a platform admin reads it (verifyToken + authAdmin, like
// settingRoutes.getConnections).
routes.get(routeNames.list, authJwt.verifyToken, authJwt.authAdmin, controller.list)
export default routes
