import express from 'express'
import routeNames from '../config/countryRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as countryController from '../controllers/countryController'

const routes = express.Router()

routes.route(routeNames.validate).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), countryController.validate)
routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), countryController.create)
routes.route(routeNames.update).put(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), countryController.update)
routes.route(routeNames.delete).delete(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), countryController.deleteCountry)
routes.route(routeNames.getCountry).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), countryController.getCountry)
routes.route(routeNames.getCountries).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), countryController.getCountries)
routes.route(routeNames.getCountriesWithLocations).get(countryController.getCountriesWithLocations)
routes.route(routeNames.checkCountry).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), countryController.checkCountry)
routes.route(routeNames.getCountryId).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), countryController.getCountryId)

export default routes
