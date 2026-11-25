import express from 'express'
import routeNames from '../config/customerInvoiceRoutes.config'
import authJwt from '../middlewares/authJwt'
import * as controller from '../controllers/invoiceController'
const routes = express.Router()
routes.get(routeNames.byBooking, authJwt.verifyToken, controller.getCustomerInvoiceByBooking)
routes.get(routeNames.pdf, authJwt.verifyToken, controller.getCustomerInvoicePdf)
export default routes
