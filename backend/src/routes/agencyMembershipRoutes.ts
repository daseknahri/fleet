import express from 'express'
import routeNames from '../config/agencyMembershipRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as agencyMembershipController from '../controllers/agencyMembershipController'

const routes = express.Router()

routes.route(routeNames.current).get(authJwt.verifyToken, agencyAuth.requireAgencyMemberRead, agencyMembershipController.current)

routes.route(routeNames.list).get(authJwt.verifyToken, agencyAuth.requireAgencyMemberRead, agencyMembershipController.list)
routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyOwner, agencyMembershipController.create)
routes.route(routeNames.update).put(authJwt.verifyToken, agencyAuth.requireAgencyOwner, agencyMembershipController.update)

export default routes
