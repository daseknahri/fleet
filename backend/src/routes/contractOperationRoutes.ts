import express from 'express'
import routes from '../config/contractOperationRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import multer from 'multer'
import * as controller from '../controllers/contractOperationController'
const router = express.Router()
router.post(routes.uploadFile, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single('file'), controller.uploadFile)
router.delete(routes.deleteFile, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), controller.deleteFile)
router.get(routes.getFile, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadBookings), controller.getFile)
router.get(routes.list, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadBookings), controller.list)
router.post(routes.handover, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), controller.handover)
router.post(routes.returnInspection, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), controller.returnInspection)
router.post(routes.complete, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), controller.complete)
router.get(routes.settlementPreview, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadBookings), controller.settlementPreview)
router.post(routes.charges, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), controller.createCharge)
router.get(routes.charges, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadBookings), controller.listCharges)
router.post(routes.decideCharge, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.DecideInvoices), controller.decideCharge)
router.post(routes.snapshot, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageBookings), controller.createSnapshot)
router.get(routes.snapshotFile, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadBookings), controller.getSnapshotFile)
export default router

