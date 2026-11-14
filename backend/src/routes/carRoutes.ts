import express from 'express'
import multer from 'multer'
import routeNames from '../config/carRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as carController from '../controllers/carController'

const routes = express.Router()

// The :id routes carry a car id, not an agency selector.
// requireAgencyPermission reads params.id as a supplier candidate, which
// would leave staff (e.g. Manager with ManageFleet) unable to resolve their
// agency context; pin the selector to the agency authJwt already resolved
// from the staff membership. Same pattern as approvalRoutes (GAQ12B3-D1).
const pinAgencySelector = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.agency?.supplierId) {
    req.params.supplierId = req.agency.supplierId
  }
  next()
}

routes.route(routeNames.create).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.create)
routes.route(routeNames.update).put(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.update)
routes.route(routeNames.checkCar).get(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadFleet), carController.checkCar)
routes.route(routeNames.validateLicensePlate).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadFleet), carController.validateLicensePlate)
routes.route(routeNames.validateCarLicensePlate).get(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadFleet), carController.validateCarLicensePlate)
routes.route(routeNames.delete).delete(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.deleteCar)
// GA-PAR-22: trash / restore / trash view are ManageFleet work (a
// CounterAgent holds only ReadFleet and gains nothing — §6). The :id
// routes pin the agency selector exactly like delete-car (GAQ12B3-D1).
routes.route(routeNames.trash).post(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.trashCar)
routes.route(routeNames.restore).post(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.restoreCar)
routes.route(routeNames.getTrashed).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.getTrashedCars)
routes.route(routeNames.trashWarning).get(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.getCarTrashWarning)
routes.route(routeNames.createImage).post([authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('image')], carController.createImage)
routes.route(routeNames.updateImage).post([authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('image')], carController.updateImage)
routes.route(routeNames.deleteImage).post(authJwt.verifyToken, pinAgencySelector, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.deleteImage)
routes.route(routeNames.deleteTempImage).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageFleet), carController.deleteTempImage)
routes.route(routeNames.getCar).get(authJwt.verifyTokenOptional, carController.getCar)
routes.route(routeNames.getCars).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadFleet), carController.getCars)
routes.route(routeNames.getBookingCars).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadFleet), carController.getBookingCars)
routes.route(routeNames.getFrontendCars).post(carController.getFrontendCars)

export default routes
