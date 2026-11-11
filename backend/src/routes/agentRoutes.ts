import express from 'express'
import routeNames from '../config/agentRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as controller from '../controllers/agentController'

const routes = express.Router()
// GA-PAR-07: ReadAgents gates reads (list doubles as the booking-form agent
// picker); ManageAgents gates every mutation including settle. The kpis
// route is registered before :id so "kpis" is never captured as an id.
routes.get(routeNames.list, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadAgents), controller.list)
routes.post(routeNames.create, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageAgents), controller.create)
routes.get(routeNames.kpis, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadAgents), controller.kpis)
routes.get(routeNames.get, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadAgents), controller.getOne)
routes.put(routeNames.update, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageAgents), controller.update)
routes.delete(routeNames.remove, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageAgents), controller.remove)
routes.post(routeNames.settle, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageAgents), controller.settle)
export default routes
