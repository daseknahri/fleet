import express from 'express'
import multer from 'multer'
import routeNames from '../config/importRoutes.config'
import authJwt from '../middlewares/authJwt'
import agencyAuth from '../middlewares/agencyAuth'
import * as importController from '../controllers/importController'
import { IMPORT_MAX_FILE_SIZE } from '../utils/importWorkbook'

const routes = express.Router()

// GA-PAR-15 — every import surface is gated by EXACTLY the agency
// permission of the entity's create endpoint (no new permissions):
//   cars     → ManageFleet    (POST /api/create-car)
//   clients  → ManageClients  (POST /api/create-user)
//   bookings → ManageBookings (POST /api/create-booking)
//   expenses → ManageExpenses (POST /api/maintenance-expenses) [GA-PAR-16]
// The template download is gated the same way. Uploads are memory-held
// (the codebase's established multer discipline), capped at 5 MB, and
// the buffer is dropped when the request ends — nothing is written to
// disk, so there is no temp file to clean up.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_MAX_FILE_SIZE },
}).single('file')

const perEntity = (handler: (req: express.Request, res: express.Response) => Promise<void>, withUpload: boolean) => [
  authJwt.verifyToken,
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const permission = req.params.entity === 'cars'
      ? agencyAuth.AgencyPermission.ManageFleet
      : req.params.entity === 'clients'
        ? agencyAuth.AgencyPermission.ManageClients
        : req.params.entity === 'bookings'
          ? agencyAuth.AgencyPermission.ManageBookings
          : req.params.entity === 'expenses'
            ? agencyAuth.AgencyPermission.ManageExpenses
            : null
    if (!permission) {
      res.status(404).send({ message: 'Unknown import entity' })
      return
    }
    const middleware = agencyAuth.requireAgencyPermission(permission)
    if (withUpload) {
      upload(req, res, (uploadErr) => {
        if (uploadErr) {
          if (uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE') {
            res.status(400).send({ message: 'File exceeds the maximum size of 5 MB' })
            return
          }
          res.status(400).send({ message: 'Upload could not be read' })
          return
        }
        void middleware(req, res, next)
      })
      return
    }
    void middleware(req, res, next)
  },
  handler,
]

routes.get(routeNames.template, ...perEntity(importController.downloadTemplate, false))
routes.post(routeNames.importFile, ...perEntity(importController.importFile, true))

export default routes
