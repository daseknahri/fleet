import express from 'express'
import multer from 'multer'
import routeNames from '../config/locationRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as locationController from '../controllers/locationController'

const routes = express.Router()

// The :id routes carry a location id, not an agency selector.
// requireAgencyPermission reads params.id as a supplier candidate, which
// would leave staff (e.g. Manager with ManageLocations) unable to resolve their
// agency context; pin the selector to the agency authJwt already resolved
// from the staff membership. Same pattern as approvalRoutes (GAQ12B3-D1).
const pinAgencySelector = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.agency?.supplierId) {
    req.params.supplierId = req.agency.supplierId
  }
  next()
}

routes.route(routeNames.validate).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), locationController.validate)
routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), locationController.create)
routes.route(routeNames.update).put(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), locationController.update)
routes.route(routeNames.delete).delete(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), locationController.deleteLocation)
routes.route(routeNames.getLocation).get(locationController.getLocation)
routes.route(routeNames.getLocations).get(locationController.getLocations)
routes.route(routeNames.getLocationsWithPosition).get(locationController.getLocationsWithPosition)
routes.route(routeNames.checkLocation).get(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), locationController.checkLocation)
routes.route(routeNames.getLocationId).get(locationController.getLocationId)
routes.route(routeNames.createImage).post([authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('image')], locationController.createImage)
routes.route(routeNames.updateImage).post([authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('image')], locationController.updateImage)
routes.route(routeNames.deleteImage).post(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), locationController.deleteImage)
routes.route(routeNames.deleteTempImage).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), locationController.deleteTempImage)

export default routes
