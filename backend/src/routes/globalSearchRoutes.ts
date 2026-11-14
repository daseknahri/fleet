import express from 'express'
import routeNames from '../config/globalSearchRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as globalSearchController from '../controllers/globalSearchController'

const routes = express.Router()

// GA-Q4-2 (#52): agency-scoped global search. Read-only; the route gate
// admits any caller holding at least one of the three list-read
// capabilities, and the controller enforces the per-group list gates
// (ReadBookings / ReadFleet / ReadClients) group by group, so a caller
// only ever sees the groups their role may list. No new capability.
routes.route(routeNames.search).post(
  authJwt.verifyToken,
  agencyAuth.requireAnyAgencyPermission([
    agencyAuth.AgencyPermission.ReadBookings,
    agencyAuth.AgencyPermission.ReadFleet,
    agencyAuth.AgencyPermission.ReadClients,
  ]),
  globalSearchController.globalSearch,
)

export default routes
