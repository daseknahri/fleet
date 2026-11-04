import express from 'express'
import multer from 'multer'
import routeNames from '../config/locationRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as locationController from '../controllers/locationController'

const routes = express.Router()

routes.route(routeNames.validate).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), locationController.validate)
routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), locationController.create)
routes.route(routeNames.update).put(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), locationController.update)
routes.route(routeNames.delete).delete(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), locationController.deleteLocation)
routes.route(routeNames.getLocation).get(locationController.getLocation)
routes.route(routeNames.getLocations).get(locationController.getLocations)
routes.route(routeNames.getLocationsWithPosition).get(locationController.getLocationsWithPosition)
routes.route(routeNames.checkLocation).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadLocations), locationController.checkLocation)
routes.route(routeNames.getLocationId).get(locationController.getLocationId)
routes.route(routeNames.createImage).post([authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), multer({ storage: multer.memoryStorage() }).single('image')], locationController.createImage)
routes.route(routeNames.updateImage).post([authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), multer({ storage: multer.memoryStorage() }).single('image')], locationController.updateImage)
routes.route(routeNames.deleteImage).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), locationController.deleteImage)
routes.route(routeNames.deleteTempImage).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageLocations), locationController.deleteTempImage)

export default routes
