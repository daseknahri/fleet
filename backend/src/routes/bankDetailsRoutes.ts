import express from 'express'
import authJwt from '../middlewares/authJwt'
import routeNames from '../config/bankDetailsRoutes.config'
import * as bankDetailsController from '../controllers/bankDetailsController'

const routes = express.Router()

// Wave 2.6 — the scope (platform-global vs one agency's RIB) is
// enforced inside the controller: Admin (global or a selected
// agency) and the agency Owner may write; reads serve Admin and the
// agency Owner only (Staff and customers are refused there, the same
// gate the old authSupplier enforced for reads).
routes.route(routeNames.upsert).post(authJwt.verifyToken, bankDetailsController.upsert)
routes.route(routeNames.get).get(authJwt.verifyToken, bankDetailsController.get)

export default routes
