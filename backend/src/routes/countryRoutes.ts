import express from 'express'
import routeNames from '../config/countryRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as countryController from '../controllers/countryController'

const routes = express.Router()

// The :id routes carry a country id, not an agency selector.
// requireAgencyPermission reads params.id as a supplier candidate, which
// locks staff out of their own agency's countries; pin the selector to the
// agency authJwt already resolved (same pattern as car/location routes).
const pinAgencySelector = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.agency?.supplierId) {
    req.params.supplierId = req.agency.supplierId
  }
  next()
}

routes.route(routeNames.validate).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), countryController.validate)
routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), countryController.create)
routes.route(routeNames.update).put(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), countryController.update)
routes.route(routeNames.delete).delete(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), countryController.deleteCountry)
routes.route(routeNames.getCountry).get(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), countryController.getCountry)
routes.route(routeNames.getCountries).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), countryController.getCountries)
routes.route(routeNames.getCountriesWithLocations).get(countryController.getCountriesWithLocations)
routes.route(routeNames.checkCountry).get(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), countryController.checkCountry)
routes.route(routeNames.getCountryId).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), countryController.getCountryId)

export default routes
