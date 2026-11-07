import express from 'express'
import routeNames from '../config/cashRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as controller from '../controllers/cashController'

const routes = express.Router()
routes.get(routeNames.sessions, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadCash), controller.listSessions)
routes.get(routeNames.current, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadCash), controller.current)
routes.post(routeNames.open, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageCash), controller.open)
routes.get(routeNames.movements, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadCash), controller.listMovements)
routes.post(routeNames.movements, authJwt.verifyToken, agencyAuth.requireAnyAgencyPermission([agencyAuth.AgencyPermission.ManageCash, agencyAuth.AgencyPermission.RecordCash]), controller.createMovement)
routes.post(routeNames.confirmMovement, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageCash), controller.confirmMovement)
routes.post(routeNames.close, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageCash), controller.close)
routes.post(routeNames.transfer, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageCash), controller.transfer)
export default routes
