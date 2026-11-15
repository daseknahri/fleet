import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import {
  DataGrid,
  GridColDef,
  GridPaginationModel,
  GridRenderCellParams,
} from '@mui/x-data-grid'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import Layout from '@/components/Layout'
import AccessDenied from '@/components/AccessDenied'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import env from '@/config/env.config'
import { strings } from '@/lang/cancel-requests'
import { strings as commonStrings } from '@/lang/common'
import * as helper from '@/utils/helper'
import * as langHelper from '@/utils/langHelper'
import * as BookingService from '@/services/BookingService'
import * as SupplierService from '@/services/SupplierService'

/**
 * F3 / W1 #9 — cancel-request queue (admin surface).
 *
 * Lists pending customer cancel requests with the amounts at stake
 * (rent collected, deposit collected, outstanding balance) so staff can
 * decide each request with the money in view. Approve executes the staff
 * cancel (reason + explicit refund decision — never auto-decided);
 * deny clears the flag and leaves the booking untouched. The queue is
 * the executable outcome the write-only `cancelRequest` flag never had.
 */
const CancelRequests = () => {
  const navigate = useNavigate()
  const agencyPermissions = useAgencyPermissions()
  const canManageBookings = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.ManageBookings)

  const [user, setUser] = useState<bookcarsTypes.User>()
  const [suppliers, setSuppliers] = useState<string[]>()
  const [rows, setRows] = useState<bookcarsTypes.CancelRequestRow[]>([])
  const [rowCount, setRowCount] = useState(0)
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: env.PAGE_SIZE })
  const [loading, setLoading] = useState(true)

  const [openDialog, setOpenDialog] = useState(false)
  const [pendingRow, setPendingRow] = useState<bookcarsTypes.CancelRequestRow | null>(null)
  const [decision, setDecision] = useState<'approve' | 'deny'>('approve')
  const [reason, setReason] = useState('')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [refundDecision, setRefundDecision] = useState<bookcarsTypes.CancelRefundDecision | ''>('')
  const [busy, setBusy] = useState(false)

  const language = langHelper.getLanguage() || env.DEFAULT_LANGUAGE
  const reasonValid = reason.trim().length >= 3 && reason.trim().length <= 1000
  const canConfirm = reasonValid && (decision === 'deny' || !!refundDecision)

  const onLoad = async (_user?: bookcarsTypes.User) => {
    if (_user) {
      const _admin = helper.admin(_user)
      setUser(_user)
      try {
        const _allSuppliers = await SupplierService.getAllSuppliers()
        setSuppliers(_admin ? bookcarsHelper.flattenSuppliers(_allSuppliers) : [_user._id ?? ''])
      } catch (err) {
        helper.error(err)
        setSuppliers(_admin ? [] : [_user._id ?? ''])
      }
    }
  }

  const fetchData = async () => {
    try {
      setLoading(true)
      const data = await BookingService.getCancelRequests(suppliers || [], paginationModel.page + 1, paginationModel.pageSize)
      const _data = data?.[0] ?? { pageInfo: { totalRecord: 0 }, resultData: [] }
      setRows(_data.resultData || [])
      setRowCount(Array.isArray(_data.pageInfo) && _data.pageInfo.length > 0 ? _data.pageInfo[0].totalRecords : 0)
    } catch (err) {
      helper.error(err, helper.getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user && suppliers) {
      fetchData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, suppliers, paginationModel])

  const openDecide = (row: bookcarsTypes.CancelRequestRow, _decision: 'approve' | 'deny') => {
    setPendingRow(row)
    setDecision(_decision)
    setReason('')
    setReasonTouched(false)
    setRefundDecision('')
    setOpenDialog(true)
  }

  const handleConfirm = async () => {
    if (!pendingRow?.booking._id || !canConfirm) {
      setReasonTouched(true)
      return
    }
    setBusy(true)
    try {
      await BookingService.decideCancelRequest(pendingRow.booking._id, {
        decision,
        reason: reason.trim(),
        ...(decision === 'approve' ? { refundDecision: refundDecision as bookcarsTypes.CancelRefundDecision } : {}),
      })
      setRows(rows.filter((row) => row.booking._id !== pendingRow.booking._id))
      setRowCount(Math.max(0, rowCount - 1))
      setOpenDialog(false)
      helper.info(decision === 'approve' ? strings.APPROVED : strings.DENIED)
    } catch (err) {
      helper.error(err, helper.getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const driverName = (row: bookcarsTypes.CancelRequestRow) => {
    const driver = row.booking.driver
    return typeof driver === 'string' ? driver : driver?.fullName || ''
  }

  const carName = (row: bookcarsTypes.CancelRequestRow) => {
    const car = row.booking.car
    return typeof car === 'string' ? car : car?.name || ''
  }

  const columns: GridColDef<bookcarsTypes.CancelRequestRow>[] = [
    {
      field: 'reference',
      headerName: strings.REFERENCE,
      flex: 1,
      valueGetter: (_value, row) => row.booking.reference || row.booking._id || '',
    },
    {
      field: 'driver',
      headerName: strings.DRIVER,
      flex: 1,
      valueGetter: (_value, row) => driverName(row),
    },
    {
      field: 'car',
      headerName: strings.CAR,
      flex: 1,
      valueGetter: (_value, row) => carName(row),
    },
    {
      field: 'dates',
      headerName: strings.DATES,
      flex: 1.2,
      valueGetter: (_value, row) => `${new Date(row.booking.from).toLocaleDateString(language)} → ${new Date(row.booking.to).toLocaleDateString(language)}`,
    },
    {
      field: 'requestedAt',
      headerName: strings.REQUESTED,
      flex: 1,
      valueGetter: (_value, row) => (row.requestedAt ? new Date(row.requestedAt).toLocaleString(language) : ''),
    },
    {
      field: 'rentPaid',
      headerName: strings.RENT_PAID,
      flex: 0.8,
      valueGetter: (_value, row) => `${row.rentPaid} ${row.currency}`,
    },
    {
      field: 'depositPaid',
      headerName: strings.DEPOSIT_PAID,
      flex: 0.8,
      valueGetter: (_value, row) => `${row.depositPaid} ${row.currency}`,
    },
    {
      field: 'outstandingBalance',
      headerName: strings.OUTSTANDING,
      flex: 0.8,
      valueGetter: (_value, row) => `${row.outstandingBalance} ${row.currency}`,
    },
    {
      field: 'actions',
      headerName: '',
      flex: 1.4,
      sortable: false,
      renderCell: (params: GridRenderCellParams<bookcarsTypes.CancelRequestRow>) => (
        <>
          <Button size="small" variant="contained" className="btn-primary" onClick={() => openDecide(params.row, 'approve')}>
            {strings.APPROVE}
          </Button>
          <Button size="small" variant="contained" className="btn-secondary" onClick={() => openDecide(params.row, 'deny')} style={{ marginLeft: 8 }}>
            {strings.DENY}
          </Button>
          <Button size="small" variant="text" onClick={() => navigate(`/update-booking?b=${params.row.booking._id}`)}>
            {strings.VIEW_BOOKING}
          </Button>
        </>
      ),
    },
  ]

  return (
    <Layout onLoad={onLoad} strict>
      {user && (
        <div className="cancel-requests">
          <h2>{strings.TITLE}</h2>
          {!canManageBookings ? (
            <AccessDenied />
          ) : (
            <>
              {rows.length === 0 && !loading ? (
                <Typography>{strings.EMPTY}</Typography>
              ) : (
                <DataGrid
                  getRowId={(row: bookcarsTypes.CancelRequestRow): string => row.booking._id as string}
                  columns={columns}
                  rows={rows}
                  rowCount={rowCount}
                  loading={loading}
                  initialState={{ pagination: { paginationModel: { pageSize: env.PAGE_SIZE } } }}
                  pageSizeOptions={[env.PAGE_SIZE, 50, 100]}
                  pagination
                  paginationMode="server"
                  paginationModel={paginationModel}
                  onPaginationModelChange={setPaginationModel}
                  disableRowSelectionOnClick
                />
              )}
              <Dialog maxWidth="sm" fullWidth open={openDialog} onClose={() => setOpenDialog(false)}>
                <DialogTitle className="dialog-header">
                  {decision === 'approve' ? strings.DECISION_TITLE_APPROVE : strings.DECISION_TITLE_DENY}
                </DialogTitle>
                <DialogContent>
                  <TextField
                    label={strings.DECISION_REASON}
                    fullWidth
                    multiline
                    rows={2}
                    value={reason}
                    onChange={(e) => { setReason(e.target.value); setReasonTouched(true) }}
                    error={reasonTouched && !reasonValid}
                    helperText={reasonTouched && !reasonValid ? strings.DECISION_REASON : ''}
                    margin="normal"
                  />
                  {decision === 'approve' && (
                    <FormControl fullWidth margin="dense">
                      <InputLabel>{strings.REFUND_DECISION}</InputLabel>
                      <Select
                        label={strings.REFUND_DECISION}
                        value={refundDecision}
                        onChange={(e) => setRefundDecision(e.target.value as bookcarsTypes.CancelRefundDecision)}
                      >
                        <MenuItem value="full">{strings.REFUND_FULL}</MenuItem>
                        <MenuItem value="none">{strings.REFUND_NONE}</MenuItem>
                        <MenuItem value="manual">{strings.REFUND_MANUAL}</MenuItem>
                      </Select>
                    </FormControl>
                  )}
                </DialogContent>
                <DialogActions className="dialog-actions">
                  <Button onClick={() => setOpenDialog(false)} variant="contained" className="btn-secondary">
                    {commonStrings.CANCEL}
                  </Button>
                  <Button onClick={handleConfirm} variant="contained" color={decision === 'approve' ? 'error' : 'primary'} disabled={busy || !canConfirm}>
                    {decision === 'approve' ? strings.CONFIRM_APPROVE : strings.CONFIRM_DENY}
                  </Button>
                </DialogActions>
              </Dialog>
            </>
          )}
        </div>
      )}
    </Layout>
  )
}

export default CancelRequests
