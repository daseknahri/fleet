import * as Sentry from '@sentry/node'
import express from 'express'
import compression from 'compression'
import helmet from 'helmet'
import nocache from 'nocache'
import cookieParser from 'cookie-parser'
import i18n from './lang/i18n'
import * as env from './config/env.config'
import cors from './middlewares/cors'
import allowedMethods from './middlewares/allowedMethods'
import supplierRoutes from './routes/supplierRoutes'
import bookingRoutes from './routes/bookingRoutes'
import locationRoutes from './routes/locationRoutes'
import notificationRoutes from './routes/notificationRoutes'
import carRoutes from './routes/carRoutes'
import userRoutes from './routes/userRoutes'
import stripeRoutes from './routes/stripeRoutes'
import countryRoutes from './routes/countryRoutes'
import paypalRoutes from './routes/paypalRoutes'
import ipinfoRoutes from './routes/ipinfoRoutes'
import bankDetailsRoutes from './routes/bankDetailsRoutes'
import settingRoutes from './routes/settingRoutes'
import maintenanceExpenseRoutes from './routes/maintenanceExpenseRoutes'
import maintenanceWorkOrderRoutes from './routes/maintenanceWorkOrderRoutes'
import maintenanceScheduleRoutes from './routes/maintenanceScheduleRoutes'
import rentalPaymentRoutes from './routes/rentalPaymentRoutes'
import documentRoutes from './routes/documentRoutes'
import agencyMembershipRoutes from './routes/agencyMembershipRoutes'
import cashRoutes from './routes/cashRoutes'
import invoiceRoutes from './routes/invoiceRoutes'
import approvalRoutes from './routes/approvalRoutes'
import contractOperationRoutes from './routes/contractOperationRoutes'
import reportRoutes from './routes/reportRoutes'
import * as helper from './utils/helper'

const app = express()

app.set('trust proxy' , 1)

app.use(helmet.contentSecurityPolicy())
app.use(helmet.dnsPrefetchControl())
app.use(helmet.crossOriginEmbedderPolicy())
app.use(helmet.frameguard())
app.use(helmet.hidePoweredBy())
app.use(helmet.hsts())
app.use(helmet.ieNoOpen())
app.use(helmet.noSniff())
app.use(helmet.permittedCrossDomainPolicies())
app.use(helmet.referrerPolicy())
app.use(helmet.xssFilter())
app.use(helmet.originAgentCluster())
app.use(helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }))
app.use(helmet.crossOriginOpenerPolicy())

app.use(nocache())
app.use(compression({ threshold: 0 }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))
app.use(express.json({ limit: '50mb' }))

app.use(cors())
// app.options('*', cors())
app.use(cookieParser(env.COOKIE_SECRET))
app.use(allowedMethods)

// Only public media is served statically. Contracts, licenses and temporary files
// are private and are delivered by authenticated document routes.
app.use('/cdn/bookcars/users', express.static(env.CDN_USERS))
app.use('/cdn/bookcars/cars', express.static(env.CDN_CARS))
app.use('/cdn/bookcars/locations', express.static(env.CDN_LOCATIONS))

app.use('/', supplierRoutes)
app.use('/', bookingRoutes)
app.use('/', locationRoutes)
app.use('/', notificationRoutes)
app.use('/', carRoutes)
app.use('/', userRoutes)
app.use('/', stripeRoutes)
app.use('/', countryRoutes)
app.use('/', paypalRoutes)
app.use('/', ipinfoRoutes)
app.use('/', bankDetailsRoutes)
app.use('/', settingRoutes)
app.use('/', maintenanceExpenseRoutes)
app.use('/', maintenanceWorkOrderRoutes)
app.use('/', maintenanceScheduleRoutes)
app.use('/', rentalPaymentRoutes)
app.use('/', documentRoutes)
app.use('/', agencyMembershipRoutes)
app.use('/', cashRoutes)
app.use('/', invoiceRoutes)
app.use('/', approvalRoutes)
app.use('/', contractOperationRoutes)
app.use('/', reportRoutes)

if (env.ENABLE_SENTRY) {
  Sentry.setupExpressErrorHandler(app)
}

i18n.locale = env.DEFAULT_LANGUAGE

await helper.mkdir(env.CDN_USERS)
await helper.mkdir(env.CDN_TEMP_USERS)
await helper.mkdir(env.CDN_CARS)
await helper.mkdir(env.CDN_TEMP_CARS)
await helper.mkdir(env.CDN_LOCATIONS)
await helper.mkdir(env.CDN_TEMP_LOCATIONS)
await helper.mkdir(env.CDN_CONTRACTS)
await helper.mkdir(env.CDN_TEMP_CONTRACTS)
await helper.mkdir(env.CDN_LICENSES)
await helper.mkdir(env.CDN_TEMP_LICENSES)
await helper.mkdir(env.CDN_MAINTENANCE)
await helper.mkdir(env.CDN_TEMP_MAINTENANCE)

export default app
