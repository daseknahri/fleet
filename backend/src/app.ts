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
import quoteRoutes from './routes/quoteRoutes'
import agentRoutes from './routes/agentRoutes'
import reminderRoutes from './routes/reminderRoutes'
import agencyReturnSettingsRoutes from './routes/agencyReturnSettingsRoutes'
import approvalRoutes from './routes/approvalRoutes'
import contractOperationRoutes from './routes/contractOperationRoutes'
import signingRoutes from './routes/signingRoutes'
import reportRoutes from './routes/reportRoutes'
import importRoutes from './routes/importRoutes'
import * as helper from './utils/helper'
import * as logger from './utils/logger'

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

// A CDN miss must not fall through to the HTML error page: with
// X-Content-Type-Options: nosniff, browsers block HTML responses loaded as
// images (ERR_BLOCKED_BY_ORB), so answer media misses with a plain-text 404.
app.use('/cdn', (req, res) => {
  // The fixed body cannot be sniffed into another type, and keeping the
  // global nosniff header here would still make browsers ORB-block the 404.
  res.removeHeader('X-Content-Type-Options')
  res.status(404).type('text/plain').send('Not found')
})

app.use('/', supplierRoutes)
// GA-PAR-12: signing routes register BEFORE bookingRoutes — its
// POST /api/bookings/:page/:size/:language pattern would otherwise
// swallow /api/bookings/:id/signing-link/revoke (3 segments).
app.use('/', signingRoutes)
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
app.use('/', quoteRoutes)
app.use('/', agentRoutes)
app.use('/', reminderRoutes)
app.use('/', agencyReturnSettingsRoutes)
app.use('/', approvalRoutes)
app.use('/', contractOperationRoutes)
app.use('/', reportRoutes)
app.use('/', importRoutes)

if (env.ENABLE_SENTRY) {
  Sentry.setupExpressErrorHandler(app)
}

// Unmatched API routes answer JSON instead of the Express HTML error page.
app.use('/api', (req, res) => {
  res.status(404).send({ message: 'Not found' })
})

// Final error handler: upload (multer) and body-parser failures are client
// errors (400); anything else is a generic 500. Internals are logged
// server-side and never sent to clients.
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(err)
    return
  }
  logger.error(`[app] Unhandled error on ${req.method} ${req.originalUrl}`, err)
  const name = (err as { name?: string } | null)?.name
  const type = (err as { type?: string } | null)?.type
  if (name === 'MulterError' || type === 'entity.parse.failed' || type === 'entity.too.large') {
    res.status(400).send(i18n.t('ERROR'))
    return
  }
  res.status(500).send(i18n.t('ERROR'))
})

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
