import express from 'express'
import multer from 'multer'
import routeNames from '../config/supplierRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as supplierController from '../controllers/supplierController'

const routes = express.Router()

routes.route(routeNames.validate).post(authJwt.verifyToken, authJwt.authSupplier, supplierController.validate)
routes.route(routeNames.update).put(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageAgencyProfile), supplierController.update)
routes.route(routeNames.delete).delete(authJwt.verifyToken, authJwt.authAdmin, supplierController.deleteSupplier)
routes.route(routeNames.getSupplier).get(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadAgencyProfile), supplierController.getSupplier)
routes.route(routeNames.getSuppliers).get(authJwt.verifyToken, authJwt.authAdmin, supplierController.getSuppliers)
routes.route(routeNames.getAllSuppliers).get(supplierController.getAllSuppliers)
routes.route(routeNames.getFrontendSuppliers).post(supplierController.getFrontendSuppliers)
routes.route(routeNames.getAdminSuppliers).post(authJwt.verifyToken, authJwt.authAdmin, supplierController.getAdminSuppliers)
routes.route(routeNames.createContract).post([authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManagePrivateDocuments), multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('file')], supplierController.createContract)
routes.route(routeNames.updateContract).post([authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManagePrivateDocuments), multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('file')], supplierController.updateContract)
routes.route(routeNames.deleteContract).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManagePrivateDocuments), supplierController.deleteContract)
routes.route(routeNames.deleteTempContract).post(authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManagePrivateDocuments), supplierController.deleteTempContract)

export default routes
