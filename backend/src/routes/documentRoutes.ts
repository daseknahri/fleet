import express from 'express'
import routeNames from '../config/documentRoutes.config'
import authJwt from '../middlewares/authJwt'
import * as documentController from '../controllers/documentController'

const routes = express.Router()

routes.route(routeNames.downloadContract).get(authJwt.verifyToken, documentController.downloadContract)
routes.route(routeNames.downloadLicense).get(authJwt.verifyToken, documentController.downloadLicense)
routes.route(routeNames.downloadMaintenanceReceipt).get(authJwt.verifyToken, documentController.downloadMaintenanceReceipt)

export default routes
