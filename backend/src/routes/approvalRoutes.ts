import express from 'express'
import routeNames from '../config/approvalRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as controller from '../controllers/approvalController'
const routes = express.Router()
routes.get(routeNames.list, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.DecideInvoices), controller.list)
routes.post(routeNames.create, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageInvoices), controller.create)
// The decide route's :id is an approval id, not an agency selector.
// requireAgencyPermission reads params.id as a supplier candidate, which
// would leave staff deciders (Manager, decision 1.3) unable to resolve
// their agency context; pin the selector to the agency authJwt already
// resolved from the staff membership.
const pinAgencySelector = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.agency?.supplierId) {
 req.params.supplierId = req.agency.supplierId 
}
  next()
}
routes.post(routeNames.decide, authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.DecideInvoices), controller.decide)
export default routes
