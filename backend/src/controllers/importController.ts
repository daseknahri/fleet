import { Request, Response } from 'express'
import { agencySupplierId } from '../utils/agencyAuthorization'
import {
  ImportEntity,
  ImportFileError,
  buildTemplateWorkbook,
  runImport,
} from '../utils/importWorkbook'
import * as logger from '../utils/logger'

/**
 * GA-PAR-15 — Excel import endpoints (scorecard row #5).
 *
 * GA-PAR-16: expenses added as the 4th entity, gated by ManageExpenses
 * — exactly the permission that gates POST /api/maintenance-expenses
 * (expense creation today: routes/maintenanceExpenseRoutes.ts uses
 * agencyAuth.AgencyPermission.ManageExpenses for create/update/delete).
 *
 * Routes (each gated by the SAME agency permission as the entity's
 * create endpoint — see importRoutes.ts):
 *   GET  /api/imports/:entity/template  → downloadable .xlsx template
 *   POST /api/imports/:entity           → multipart file + dryRun flag
 *
 * The agency scope is resolved from the authenticated session by the
 * permission middleware (req.agency / the supplier's own identity) and
 * is NEVER read from the uploaded file. File-level problems (not an
 * .xlsx, unparseable workbook, missing required column, row cap) are a
 * single 400 with a clear message and nothing is processed; row-level
 * problems are reported per row in the ImportReport.
 */

const ENTITIES: ImportEntity[] = ['cars', 'clients', 'bookings', 'expenses']

const entityOf = (req: Request): ImportEntity | null => {
  const { entity } = req.params
  return ENTITIES.includes(entity as ImportEntity) ? (entity as ImportEntity) : null
}

export const downloadTemplate = async (req: Request, res: Response) => {
  const entity = entityOf(req)
  if (!entity) {
    res.status(404).send({ message: 'Unknown import entity' })
    return
  }
  try {
    const buffer = await buildTemplateWorkbook(entity)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="bookcars-import-${entity}-template.xlsx"`)
    res.send(buffer)
  } catch (err) {
    logger.error('[import.downloadTemplate]', err)
    res.status(500).send({ message: 'Template could not be generated' })
  }
}

export const importFile = async (req: Request, res: Response) => {
  const entity = entityOf(req)
  if (!entity) {
    res.status(404).send({ message: 'Unknown import entity' })
    return
  }
  try {
    const file = req.file
    if (!file) {
      res.status(400).send({ message: 'No file uploaded (expected a multipart field named "file")' })
      return
    }
    const originalName = (file.originalname || '').toLowerCase()
    const isZipMagic = file.buffer.length >= 2 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b
    if (!originalName.endsWith('.xlsx') || !isZipMagic) {
      res.status(400).send({ message: 'Only .xlsx files are accepted' })
      return
    }
    const supplierId = agencySupplierId(req)
    if (!supplierId) {
      res.status(403).send({ message: 'Agency access required' })
      return
    }
    // dryRun is the SAFE default: only an explicit dryRun=false commits.
    const rawDryRun = (req.body as Record<string, unknown> | undefined)?.dryRun ?? req.query.dryRun
    const dryRun = !(rawDryRun === 'false' || rawDryRun === false || rawDryRun === '0')
    const report = await runImport(entity, file.buffer, dryRun, supplierId, {
      user: req.user,
      agency: req.agency as { supplierId: string, role: string } | undefined,
    })
    res.json(report)
  } catch (err) {
    if (err instanceof ImportFileError) {
      res.status(400).send({ message: err.message })
      return
    }
    logger.error('[import.importFile]', err)
    res.status(500).send({ message: 'Import failed' })
  }
}
