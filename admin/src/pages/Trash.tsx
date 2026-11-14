import React, { useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Restore as RestoreIcon, DeleteForever as PurgeIcon } from '@mui/icons-material'
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
import Search from '@/components/Search'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import env from '@/config/env.config'
import { strings } from '@/lang/trash'
import { strings as commonStrings } from '@/lang/common'
import * as helper from '@/utils/helper'
import * as langHelper from '@/utils/langHelper'
import * as BookingService from '@/services/BookingService'
import * as UserService from '@/services/UserService'
import * as CarService from '@/services/CarService'
import * as SupplierService from '@/services/SupplierService'

type TrashTab = 'bookings' | 'clients' | 'cars'

const formatTrashedAt = (value: Date | string | null | undefined, language: string) => {
  if (!value) {
    return ''
  }
  // §5.3: trashed-at renders in Africa/Casablanca.
  return new Intl.DateTimeFormat(language, {
    timeZone: 'Africa/Casablanca',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

const Trash = () => {
  const agencyPermissions = useAgencyPermissions()
  const canManageBookings = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.ManageBookings)
  const canManageClients = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.ManageClients)
  const canManageFleet = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.ManageFleet)
  const trashDenied = !!agencyPermissions?.loaded && !canManageBookings && !canManageClients && !canManageFleet

  const [user, setUser] = useState<bookcarsTypes.User>()
  const [suppliers, setSuppliers] = useState<string[]>()
  const [tab, setTab] = useState<TrashTab>('bookings')
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<(bookcarsTypes.Booking | bookcarsTypes.User | bookcarsTypes.Car)[]>([])
  const [rowCount, setRowCount] = useState(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: env.PAGE_SIZE })
  const [loading, setLoading] = useState(true)
  const [fetch, setFetch] = useState(false)

  const [openRestoreDialog, setOpenRestoreDialog] = useState(false)
  const [openPurgeDialog, setOpenPurgeDialog] = useState(false)
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [warning, setWarning] = useState<bookcarsTypes.TrashWarning | null>(null)

  const language = langHelper.getLanguage() || env.DEFAULT_LANGUAGE
  const visibleTabs: TrashTab[] = [
    ...(canManageBookings ? ['bookings' as TrashTab] : []),
    ...(canManageClients ? ['clients' as TrashTab] : []),
    ...(canManageFleet ? ['cars' as TrashTab] : []),
  ]
  const reasonValid = reason.trim().length >= 3 && reason.trim().length <= 1000

  useEffect(() => {
    // Keep the active tab on a visible one once permissions resolve.
    if (agencyPermissions?.loaded && !visibleTabs.includes(tab)) {
      setTab(visibleTabs[0] || 'bookings')
    }
  }, [agencyPermissions?.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const page = paginationModel.page + 1
      const size = paginationModel.pageSize
      let data: bookcarsTypes.Result<bookcarsTypes.Booking | bookcarsTypes.User | bookcarsTypes.Car> | undefined
      if (tab === 'bookings') {
        data = await BookingService.getTrashedBookings(suppliers || [], keyword, page, size)
      } else if (tab === 'clients') {
        data = await UserService.getTrashedUsers(keyword, page, size)
      } else {
        data = await CarService.getTrashedCars(suppliers || [], keyword, page, size)
      }
      const _data = data?.[0] ?? { pageInfo: { totalRecord: 0 }, resultData: [] }
      setRows((_data.resultData || []) as (bookcarsTypes.Booking | bookcarsTypes.User | bookcarsTypes.Car)[])
      setRowCount(Array.isArray(_data.pageInfo) && _data.pageInfo.length > 0 ? _data.pageInfo[0].totalRecords : 0)
      setSelectedIds([])
    } catch (err) {
      helper.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user && suppliers) {
      fetchData()
    }
  }, [user, suppliers, tab, keyword, paginationModel, fetch]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = () => {
    setFetch((prev) => !prev)
  }

  const openRestore = (ids: string[]) => {
    setPendingIds(ids)
    setReason('')
    setReasonTouched(false)
    setWarning(null)
    setOpenRestoreDialog(true)
  }

  const openPurge = async (ids: string[]) => {
    setPendingIds(ids)
    setReason('')
    setReasonTouched(false)
    setWarning(null)
    setOpenPurgeDialog(true)
    // Single-row purge shows the live §5.7 figures behind the warning.
    if (ids.length === 1) {
      try {
        if (tab === 'bookings') {
          setWarning(await BookingService.getBookingTrashWarning(ids[0]))
        } else if (tab === 'clients') {
          setWarning(await UserService.getUserTrashWarning(ids[0]))
        } else {
          setWarning(await CarService.getCarTrashWarning(ids[0]))
        }
      } catch (err) {
        helper.error(err)
      }
    }
  }

  const handleConfirmRestore = async () => {
    try {
      let status = 0
      if (tab === 'bookings') {
        status = await BookingService.restoreBookings(pendingIds, reason.trim() || undefined)
      } else if (tab === 'clients') {
        status = await UserService.restoreUsers(pendingIds, reason.trim() || undefined)
      } else {
        // Cars restore one at a time (single-id route).
        status = await CarService.restoreCar(pendingIds[0], reason.trim() || undefined)
      }
      if (status === 200) {
        setOpenRestoreDialog(false)
        reload()
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    }
  }

  const handleConfirmPurge = async () => {
    if (!reasonValid) {
      setReasonTouched(true)
      return
    }
    try {
      let status = 0
      if (tab === 'bookings') {
        status = await BookingService.deleteBookings(pendingIds, reason.trim())
      } else if (tab === 'clients') {
        status = await UserService.purgeUsers(pendingIds, reason.trim())
      } else {
        status = await CarService.deleteCar(pendingIds[0], reason.trim())
      }
      if (status === 200) {
        setOpenPurgeDialog(false)
        reload()
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    }
  }

  const confirmText = (verb: 'restore' | 'purge') => {
    const single = pendingIds.length === 1
    if (tab === 'bookings') {
      return verb === 'restore' ? (single ? strings.RESTORE_BOOKING : strings.RESTORE_BOOKINGS) : (single ? strings.PURGE_BOOKING : strings.PURGE_BOOKINGS)
    }
    if (tab === 'clients') {
      return verb === 'restore' ? (single ? strings.RESTORE_CLIENT : strings.RESTORE_CLIENTS) : (single ? strings.PURGE_CLIENT : strings.PURGE_CLIENTS)
    }
    return verb === 'restore' ? strings.RESTORE_CAR : strings.PURGE_CAR
  }

  const warningLines = () => {
    if (!warning) {
      return null
    }
    const lines: string[] = []
    if (tab === 'bookings') {
      if ((warning.paymentsCount || 0) > 0) {
        lines.push(`${strings.WARNING_PAYMENTS}: ${warning.paymentsCount} — ${warning.paymentsCollected} MAD. ${strings.MONEY_NOTE}`)
      }
      if ((warning.invoicesCount || 0) > 0) {
        lines.push(`${strings.WARNING_INVOICES}: ${warning.invoicesCount} (${warning.invoicesIssuedCount} ${strings.WARNING_ISSUED})`)
      }
      if ((warning.pendingChargesCount || 0) > 0) {
        lines.push(`${strings.WARNING_CHARGES}: ${warning.pendingChargesCount}`)
      }
    } else if (tab === 'clients') {
      if ((warning.bookingsCount || 0) > 0) {
        lines.push(`${strings.WARNING_BOOKINGS}: ${warning.bookingsCount}`)
      }
      if ((warning.paymentsCount || 0) > 0) {
        lines.push(`${strings.WARNING_PAYMENTS}: ${warning.paymentsCount} — ${warning.paymentsCollected} MAD`)
      }
    } else if ((warning.bookingsCount || 0) > 0) {
      lines.push(`${strings.WARNING_BOOKINGS}: ${warning.liveBookingsCount} ${strings.WARNING_LIVE}, ${warning.trashedBookingsCount} ${strings.WARNING_TRASHED}`)
    }
    return lines.length > 0 ? lines : null
  }

  const actionsColumn: GridColDef = {
    field: 'actions',
    headerName: '',
    width: 110,
    sortable: false,
    renderCell: (params: GridRenderCellParams) => (
      <>
        <Tooltip title={strings.RESTORE}>
          <IconButton
            onClick={() => openRestore([params.row._id as string])}
          >
            <RestoreIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title={strings.PURGE}>
          <IconButton
            onClick={() => openPurge([params.row._id as string])}
          >
            <PurgeIcon />
          </IconButton>
        </Tooltip>
      </>
    ),
  }

  const trashedColumns: GridColDef[] = [
    { field: 'deletedAt', headerName: strings.TRASHED_AT, width: 190, valueFormatter: (value: Date | string) => formatTrashedAt(value, language) },
    { field: 'deletedByName', headerName: strings.TRASHED_BY, width: 150 },
    { field: 'deleteReason', headerName: strings.REASON, width: 260, flex: 1 },
  ]

  const columns: GridColDef[] = tab === 'bookings'
    ? [
      { field: 'reference', headerName: 'Ref', width: 130 },
      { field: 'car', headerName: 'Car', width: 160, valueGetter: (_value: unknown, row: bookcarsTypes.Booking) => (row.car as bookcarsTypes.Car)?.name || '' },
      { field: 'driver', headerName: 'Driver', width: 160, valueGetter: (_value: unknown, row: bookcarsTypes.Booking) => (row.driver as bookcarsTypes.User)?.fullName || '' },
      {
        field: 'moneyFlags',
        headerName: '',
        width: 150,
        sortable: false,
        valueGetter: (_value: unknown, row: bookcarsTypes.Booking) => [
          ...(row.hadPayments ? [strings.MONEY_FLAGS_PAYMENTS] : []),
          ...(row.hadInvoices ? [strings.MONEY_FLAGS_INVOICES] : []),
        ].join(' · '),
      },
      ...trashedColumns,
      actionsColumn,
    ]
    : tab === 'clients'
      ? [
        { field: 'fullName', headerName: 'Name', width: 200 },
        { field: 'email', headerName: 'Email', width: 240 },
        { field: 'phone', headerName: 'Phone', width: 150 },
        ...trashedColumns,
        actionsColumn,
      ]
      : [
        { field: 'name', headerName: 'Name', width: 200 },
        { field: 'licensePlate', headerName: 'Plate', width: 140 },
        ...trashedColumns,
        actionsColumn,
      ]

  return (
    <Layout strict onLoad={onLoad}>
      {user && trashDenied && <AccessDenied />}
      {user && !trashDenied && (
        <div className="trash">
          <Typography component="h1">{strings.TITLE}</Typography>
          <Tabs value={tab} onChange={(_e, value: TrashTab) => { setTab(value); setPaginationModel({ page: 0, pageSize: env.PAGE_SIZE }) }}>
            {canManageBookings && <Tab value="bookings" label={strings.TAB_BOOKINGS} />}
            {canManageClients && <Tab value="clients" label={strings.TAB_CLIENTS} />}
            {canManageFleet && <Tab value="cars" label={strings.TAB_CARS} />}
          </Tabs>
          <div>
            <Search onSubmit={setKeyword} />
            {tab !== 'cars' && selectedIds.length > 0 && (
              <div>
                <Button variant="contained" className="btn-primary" onClick={() => openRestore(selectedIds)}>
                  {strings.RESTORE}
                </Button>
                <Button variant="contained" color="error" onClick={() => openPurge(selectedIds)}>
                  {strings.PURGE}
                </Button>
              </div>
            )}
          </div>
          <DataGrid
            checkboxSelection={tab !== 'cars'}
            getRowId={(row) => row._id as string}
            columns={columns}
            rows={rows}
            rowCount={rowCount}
            loading={loading}
            initialState={{
              pagination: { paginationModel: { pageSize: env.PAGE_SIZE } },
            }}
            pageSizeOptions={[env.PAGE_SIZE, 50, 100]}
            pagination
            paginationMode="server"
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            onRowSelectionModelChange={(_selectedIds) => {
              setSelectedIds(Array.from(_selectedIds.ids).map((id) => id.toString()))
            }}
            localeText={{ noRowsLabel: strings.EMPTY_LIST }}
            disableRowSelectionOnClick
          />
        </div>
      )}

      <Dialog disableEscapeKeyDown maxWidth="xs" open={openRestoreDialog}>
        <DialogTitle className="dialog-header">{commonStrings.CONFIRM_TITLE}</DialogTitle>
        <DialogContent className="dialog-content">
          {confirmText('restore')}
          <TextField
            label={strings.REASON}
            fullWidth
            multiline
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            margin="normal"
          />
        </DialogContent>
        <DialogActions className="dialog-actions">
          <Button onClick={() => setOpenRestoreDialog(false)} variant="contained" className="btn-secondary">
            {commonStrings.CANCEL}
          </Button>
          <Button onClick={handleConfirmRestore} variant="contained" className="btn-primary">
            {strings.RESTORE}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog disableEscapeKeyDown maxWidth="xs" open={openPurgeDialog}>
        <DialogTitle className="dialog-header">{commonStrings.CONFIRM_TITLE}</DialogTitle>
        <DialogContent className="dialog-content">
          {confirmText('purge')}
          {warningLines()?.map((line) => (
            <Typography key={line}>{line}</Typography>
          ))}
          <Typography>{strings.PURGE_WARNING}</Typography>
          <TextField
            label={strings.REASON_LABEL}
            fullWidth
            multiline
            rows={2}
            value={reason}
            onChange={(e) => { setReason(e.target.value); setReasonTouched(true) }}
            error={reasonTouched && !reasonValid}
            helperText={reasonTouched && !reasonValid ? strings.REASON_REQUIRED : ''}
            margin="normal"
          />
        </DialogContent>
        <DialogActions className="dialog-actions">
          <Button onClick={() => setOpenPurgeDialog(false)} variant="contained" className="btn-secondary">
            {commonStrings.CANCEL}
          </Button>
          <Button onClick={handleConfirmPurge} variant="contained" color="error" disabled={!reasonValid}>
            {strings.PURGE}
          </Button>
        </DialogActions>
      </Dialog>
    </Layout>
  )
}

export default Trash
