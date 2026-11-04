import express from 'express'
import multer from 'multer'
import routeNames from '../config/maintenanceExpenseRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as maintenanceExpenseController from '../controllers/maintenanceExpenseController'

const routes = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

routes.get(routeNames.report, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadExpenses), maintenanceExpenseController.report)
routes.post(routeNames.uploadReceipt, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageExpenses), upload.single('file'), maintenanceExpenseController.uploadReceipt)
routes.post(routeNames.deleteTempReceipt, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageExpenses), maintenanceExpenseController.deleteTempReceipt)
routes.get(routeNames.list, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadExpenses), maintenanceExpenseController.list)
routes.post(routeNames.create, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageExpenses), maintenanceExpenseController.create)
routes.put(routeNames.update, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageExpenses), maintenanceExpenseController.update)
routes.delete(routeNames.delete, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageExpenses), maintenanceExpenseController.remove)

export default routes
