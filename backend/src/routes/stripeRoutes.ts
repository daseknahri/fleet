import express from 'express'
import routeNames from '../config/stripeRoutes.config'
import * as stripeController from '../controllers/stripeController'

const routes = express.Router()

routes.route(routeNames.checkCheckoutSession).post(stripeController.checkCheckoutSession)

export default routes
