import React, { useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Tab, Table, TableBody, TableCell,
  TableHead, TableRow, Tabs, Typography,
} from '@mui/material'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import * as bookcarsTypes from ':bookcars-types'
import Layout from '@/components/Layout'
import AccessDenied from '@/components/AccessDenied'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import type { AgencyPermissionName } from '@/context/AgencyPermissionContext'
import * as ImportService from '@/services/ImportService'
import { strings } from '@/lang/imports'

import '@/assets/css/imports.css'

// GA-PAR-15 — Excel imports (scorecard #5). One surface per entity; each
// tab is gated by the entity's create permission, mirroring the backend
// (cars → ManageFleet, clients → ManageClients, bookings →
// ManageBookings, expenses → ManageExpenses [GA-PAR-16]). Flow: download template → choose file → dry run
// (validates everything, saves nothing) → import valid rows (the server
// re-validates from scratch; invalid rows are skipped and reported).

const ENTITIES: { key: ImportService.ImportEntityName, label: () => string, permission: AgencyPermissionName }[] = [
  { key: 'cars', label: () => strings.ENTITY_CARS, permission: AgencyPermission.ManageFleet },
  { key: 'clients', label: () => strings.ENTITY_CLIENTS, permission: AgencyPermission.ManageClients },
  { key: 'bookings', label: () => strings.ENTITY_BOOKINGS, permission: AgencyPermission.ManageBookings },
  { key: 'expenses', label: () => strings.ENTITY_EXPENSES, permission: AgencyPermission.ManageExpenses },
]

const Imports = () => {
  const agencyPermissions = useAgencyPermissions()
  const supplierScope = agencyPermissions?.supplier || undefined
  const visible = ENTITIES.filter((e) => !agencyPermissions?.loaded || agencyPermissions.can(e.permission))
  const denied = !!agencyPermissions?.loaded && visible.length === 0

  const [tab, setTab] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<bookcarsTypes.ImportReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')

  const entity = visible[Math.min(tab, Math.max(visible.length - 1, 0))]

  const reset = () => {
    setReport(null)
    setNotice('')
    setActionError('')
  }

  const run = async (dryRun: boolean) => {
    if (!entity) {
      return
    }
    if (!file) {
      setActionError(strings.FILE_REQUIRED)
      return
    }
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      const result = await ImportService.importFile(entity.key, file, dryRun, supplierScope)
      setReport(result)
      setNotice(dryRun ? strings.DRY_DONE : strings.IMPORT_DONE)
    } catch {
      setActionError(strings.ACTION_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const onLoad = () => {}

  if (denied) {
    return (
      <Layout strict onLoad={onLoad}>
        <AccessDenied />
      </Layout>
    )
  }

  return (
    <Layout strict onLoad={onLoad}>
      <Box className="imports-page">
        <Typography variant="h4" className="imports-title">{strings.TITLE}</Typography>
        <Typography variant="body1" className="imports-subtitle">{strings.SUBTITLE}</Typography>

        <Tabs
          value={Math.min(tab, Math.max(visible.length - 1, 0))}
          onChange={(_e, value: number) => { setTab(value); setFile(null); reset() }}
        >
          {visible.map((e) => <Tab key={e.key} label={e.label()} />)}
        </Tabs>

        {entity && (
          <Paper className="imports-panel">
            <Box className="imports-actions">
              <Button
                variant="outlined"
                startIcon={<DownloadRoundedIcon />}
                onClick={() => {
                  ImportService.downloadTemplate(entity.key, supplierScope).catch(() => setActionError(strings.ACTION_ERROR))
                }}
              >
                {strings.TEMPLATE}
              </Button>
              <Button variant="outlined" component="label" startIcon={<UploadFileRoundedIcon />}>
                {strings.FILE}
                <input
                  type="file"
                  accept=".xlsx"
                  hidden
                  onChange={(e) => { setFile(e.target.files?.[0] || null); reset() }}
                />
              </Button>
              {file && <Chip label={file.name} />}
              <Button variant="contained" disabled={busy || !file} onClick={() => run(true)}>
                {strings.DRY_RUN}
              </Button>
              <Button
                variant="contained"
                color="success"
                disabled={busy || !file || !report || !report.dryRun || report.validRows === 0}
                onClick={() => run(false)}
              >
                {strings.IMPORT}
              </Button>
              {busy && <CircularProgress size={22} />}
            </Box>
            {!report && <Typography variant="body2" className="imports-hint">{strings.RUN_DRY_FIRST}</Typography>}
            {notice && <Alert severity="success" className="imports-alert">{notice}</Alert>}
            {actionError && <Alert severity="error" className="imports-alert">{actionError}</Alert>}

            {report && (
              <Box className="imports-report">
                <Typography variant="h6">{strings.REPORT}</Typography>
                <Box className="imports-chips">
                  <Chip label={`${strings.TOTAL}: ${report.totalRows}`} />
                  <Chip color="success" label={`${strings.VALID}: ${report.validRows}`} />
                  <Chip color={report.invalidRows > 0 ? 'error' : 'default'} label={`${strings.INVALID}: ${report.invalidRows}`} />
                  {!report.dryRun && <Chip color="primary" label={`${strings.CREATED}: ${report.created}`} />}
                </Box>
                {report.errors.length === 0 ? (
                  <Alert severity="success">{strings.NO_ERRORS}</Alert>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{strings.ROW}</TableCell>
                        <TableCell>{strings.FIELD}</TableCell>
                        <TableCell>{strings.MESSAGE}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.errors.map((err, idx) => (
                        <TableRow key={`${err.row}-${idx}`}>
                          <TableCell>{err.row}</TableCell>
                          <TableCell>{err.field || '—'}</TableCell>
                          <TableCell>{err.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Box>
            )}
          </Paper>
        )}
      </Box>
    </Layout>
  )
}

export default Imports
