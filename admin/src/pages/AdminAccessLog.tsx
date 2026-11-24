import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, FormControl, InputLabel, MenuItem,
  Select, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import * as bookcarsTypes from ':bookcars-types'
import Layout from '@/components/Layout'
import AccessDenied from '@/components/AccessDenied'
import env from '@/config/env.config'
import { strings } from '@/lang/admin-access-log'
import * as helper from '@/utils/helper'
import * as UserService from '@/services/UserService'
import * as SupplierService from '@/services/SupplierService'
import * as AdminAccessLogService from '@/services/AdminAccessLogService'
import type { AdminAccessLogRow } from '@/services/AdminAccessLogService'

const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}
const formatDate = (value?: string) => (
  value ? new Intl.DateTimeFormat(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
)
const displayName = (value: AdminAccessLogRow['actor'] | AdminAccessLogRow['agency']) => {
  if (!value) {
    return '—'
  }
  if (typeof value === 'string') {
    return value
  }
  return value.fullName || value.email || value._id
}

// GH-07 — platform-admin-only audit page: newest-first table of every
// admin access to agency data, filterable by agency / actor / action,
// server-side paginated. Non-admins see AccessDenied (the endpoint is
// authAdmin-only too, so the page never leaks rows to agency staff).
const AdminAccessLog = () => {
  const [user, setUser] = useState<bookcarsTypes.User>()
  const denied = !!user && !helper.admin(user)
  const [rows, setRows] = useState<AdminAccessLogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [size] = useState(env.PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [suppliers, setSuppliers] = useState<bookcarsTypes.User[]>([])
  const [fAgency, setFAgency] = useState('')
  const [fActor, setFActor] = useState('')
  const [fAction, setFAction] = useState('')
  const [applied, setApplied] = useState({ agency: '', actor: '', action: '' })

  const fetchData = useCallback(async (p: number) => {
    setLoading(true)
    setLoadError(false)
    try {
      const data = await AdminAccessLogService.list({
        ...(applied.agency ? { agency: applied.agency } : {}),
        ...(applied.actor.trim() ? { actor: applied.actor.trim() } : {}),
        ...(applied.action.trim() ? { action: applied.action.trim() } : {}),
        page: p + 1,
        size,
      })
      const list = Array.isArray(data) ? data : data.rows || []
      setRows(list)
      setTotal(Array.isArray(data) ? list.length : data.total || 0)
    } catch (err) {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [applied, size])

  useEffect(() => {
    if (user && helper.admin(user)) {
      fetchData(page)
    }
  }, [user, page, fetchData])

  useEffect(() => {
    if (user && helper.admin(user)) {
      SupplierService.getAllSuppliers().then(setSuppliers).catch(() => setSuppliers([]))
    }
  }, [user])

  const applyFilters = () => {
    setApplied({ agency: fAgency, actor: fActor, action: fAction })
    setPage(0)
  }
  const clearFilters = () => {
    setFAgency('')
    setFActor('')
    setFAction('')
    setApplied({ agency: '', actor: '', action: '' })
    setPage(0)
  }

  const pageCount = Math.max(1, Math.ceil(total / size))

  return (
    <Layout strict onLoad={setUser}>
      {user && denied && <AccessDenied />}
      {user && !denied && (
        <div className="agency-admin-access-log">
          <div>
            <Typography component="h1">{strings.TITLE}</Typography>
            <Typography>{strings.SUBTITLE}</Typography>
          </div>

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
            <FormControl variant="standard" style={{ minWidth: 220 }}>
              <InputLabel>{strings.AGENCY}</InputLabel>
              <Select label={strings.AGENCY} value={fAgency} onChange={(e) => setFAgency(e.target.value)}>
                <MenuItem value="">{strings.AGENCY_ALL}</MenuItem>
                <MenuItem value="platform-wide">{strings.AGENCY_PLATFORM_WIDE}</MenuItem>
                {suppliers.map((supplier) => (
                  <MenuItem key={supplier._id as string} value={supplier._id as string}>
                    {supplier.fullName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              variant="standard"
              label={strings.ACTOR}
              placeholder={strings.ACTOR_PLACEHOLDER}
              value={fActor}
              onChange={(e) => setFActor(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <TextField
              variant="standard"
              label={strings.ACTION}
              placeholder={strings.ACTION_PLACEHOLDER}
              value={fAction}
              onChange={(e) => setFAction(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <Button variant="contained" onClick={applyFilters}>{strings.APPLY}</Button>
            <Button variant="text" onClick={clearFilters}>{strings.CLEAR}</Button>
            <Button variant="text" startIcon={<RefreshRoundedIcon />} onClick={() => fetchData(page)}>{strings.REFRESH}</Button>
          </Box>

          {loading && <Box sx={{ marginTop: 2 }}><CircularProgress /></Box>}
          {!loading && loadError && <Alert severity="error" sx={{ marginTop: 2 }}>{strings.ERROR}</Alert>}
          {!loading && !loadError && rows.length === 0 && (
            <Typography sx={{ marginTop: 2 }}>{strings.EMPTY}</Typography>
          )}
          {!loading && !loadError && rows.length > 0 && (
            <Box sx={{ marginTop: 2, overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{strings.DATE}</TableCell>
                    <TableCell>{strings.ACTOR}</TableCell>
                    <TableCell>{strings.AGENCY}</TableCell>
                    <TableCell>{strings.ACTION}</TableCell>
                    <TableCell>{strings.METHOD}</TableCell>
                    <TableCell>{strings.PATH}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell>{formatDate(row.createdAt)}</TableCell>
                      <TableCell>{displayName(row.actor)}</TableCell>
                      <TableCell>{row.agency === null ? strings.PLATFORM_WIDE : displayName(row.agency)}</TableCell>
                      <TableCell>{row.action}</TableCell>
                      <TableCell>{row.method || '—'}</TableCell>
                      <TableCell>{row.path || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', marginTop: 2 }}>
                <Button variant="text" disabled={page === 0} onClick={() => setPage(page - 1)}>{strings.PREV}</Button>
                <Typography>{strings.PAGE} {page + 1} {strings.OF} {pageCount}</Typography>
                <Button variant="text" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>{strings.NEXT}</Button>
              </Box>
            </Box>
          )}
        </div>
      )}
    </Layout>
  )
}

export default AdminAccessLog
