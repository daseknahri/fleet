import express from 'express'
import routeNames from '../config/invoiceRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as controller from '../controllers/invoiceController'
const routes = express.Router()
routes.get(routeNames.list, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ReadInvoices), controller.list)
routes.post(routeNames.create, authJwt.verifyToken, agencyAuth.requireAgencyPermission(agencyAuth.AgencyPermission.ManageInvoices), controller.create)
routes.post(routeNames.issue, authJwt.verifyToken, agencyAuth.requireInvoiceAgencyPermission(agencyAuth.AgencyPermission.ManageInvoices), controller.issue)
routes.post(routeNames.void, authJwt.verifyToken, agencyAuth.requireInvoiceAgencyPermission(agencyAuth.AgencyPermission.ManageInvoices), controller.voidInvoice)
routes.post(routeNames.payments, authJwt.verifyToken, agencyAuth.requireInvoiceAgencyPermission(agencyAuth.AgencyPermission.ManageInvoices), controller.recordPayment)
export default routes
