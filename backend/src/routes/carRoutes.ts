import express from 'express'
import multer from 'multer'
import routeNames from '../config/carRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as carController from '../controllers/carController'

const routes = express.Router()

routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.create)
routes.route(routeNames.update).put(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.update)
routes.route(routeNames.checkCar).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadFleet), carController.checkCar)
routes.route(routeNames.validateLicensePlate).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadFleet), carController.validateLicensePlate)
routes.route(routeNames.validateCarLicensePlate).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadFleet), carController.validateCarLicensePlate)
routes.route(routeNames.delete).delete(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.deleteCar)
routes.route(routeNames.createImage).post([authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), multer({ storage: multer.memoryStorage() }).single('image')], carController.createImage)
routes.route(routeNames.updateImage).post([authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), multer({ storage: multer.memoryStorage() }).single('image')], carController.updateImage)
routes.route(routeNames.deleteImage).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.deleteImage)
routes.route(routeNames.deleteTempImage).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.deleteTempImage)
routes.route(routeNames.getCar).get(carController.getCar)
routes.route(routeNames.getCars).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadFleet), carController.getCars)
routes.route(routeNames.getBookingCars).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadFleet), carController.getBookingCars)
routes.route(routeNames.getFrontendCars).post(carController.getFrontendCars)

export default routes
