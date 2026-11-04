import React, { useCallback, useMemo, useState } from 'react'

import {

  Alert,

  Button,

  Card,

  CardContent,

  Dialog,

  DialogActions,

  DialogContent,

  DialogTitle,

  MenuItem,

  TextField,

  Typography,

} from '@mui/material'

import AddRoundedIcon from '@mui/icons-material/AddRounded'

import BuildRoundedIcon from '@mui/icons-material/BuildRounded'

import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'

import EditRoundedIcon from '@mui/icons-material/EditRounded'

import * as bookcarsTypes from ':bookcars-types'

import * as bookcarsHelper from ':bookcars-helper'

import Layout from '@/components/Layout'

import * as CarService from '@/services/CarService'

import * as SupplierService from '@/services/SupplierService'

import * as MaintenanceExpenseService from '@/services/MaintenanceExpenseService'

import * as MaintenanceScheduleService from '@/services/MaintenanceScheduleService'

import * as UserService from '@/services/UserService'

import * as helper from '@/utils/helper'

import env from '@/config/env.config'

import { strings } from '@/lang/maintenance'


import '@/assets/css/maintenance.css'


// The API returns actionable validation text (e.g. "Invalid supplier").

// Surface it so operators can fix the form instead of seeing only a generic failure.

const apiErrorMessage = (error: unknown): string => {
  const detail = (error as { response?: { data?: unknown } })?.response?.data

  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim()
  }

  if (detail && typeof detail === 'object') {
    const message = (detail as { message?: unknown }).message

    if (typeof message === 'string' && message.trim()) {
      return message.trim()
    }
  }

  return ''
}


interface ExpenseForm {

  car: string

  date: string

  type: bookcarsTypes.MaintenanceExpenseType

  amount: string

  mileage: string

  vendor: string

  note: string

}


interface ScheduleForm {

  car: string

  title: string

  type: bookcarsTypes.MaintenanceExpenseType

  nextDueDate: string

  intervalDays: string

  intervalKm: string

  nextDueMileage: string

  note: string

  status: bookcarsTypes.MaintenanceScheduleStatus

}


const emptyScheduleForm = (car = ''): ScheduleForm => ({

  car,

  title: '',

  type: bookcarsTypes.MaintenanceExpenseType.Maintenance,

  nextDueDate: new Date().toISOString().slice(0, 10),

  intervalDays: '90',

  intervalKm: '',

  nextDueMileage: '',

  note: '',

  status: bookcarsTypes.MaintenanceScheduleStatus.Upcoming,

})


const emptyForm = (): ExpenseForm => ({

  car: '',

  date: new Date().toISOString().slice(0, 10),

  type: bookcarsTypes.MaintenanceExpenseType.Maintenance,

  amount: '',

  mileage: '',

  vendor: '',

  note: '',

})


const typeLabel = (type: bookcarsTypes.MaintenanceExpenseType) => {
  switch (type) {
    case bookcarsTypes.MaintenanceExpenseType.Maintenance: return strings.MAINTENANCE

    case bookcarsTypes.MaintenanceExpenseType.Repair: return strings.REPAIR

    case bookcarsTypes.MaintenanceExpenseType.Cleaning: return strings.CLEANING

    case bookcarsTypes.MaintenanceExpenseType.Fuel: return strings.FUEL

    case bookcarsTypes.MaintenanceExpenseType.Insurance: return strings.INSURANCE

    default: return strings.OTHER
  }
}


const carName = (expense: bookcarsTypes.MaintenanceExpense) => {
  if (!expense.car || typeof expense.car === 'string') {
return '—'
}

  return `${expense.car.name || '—'}${expense.car.licensePlate ? ` · ${expense.car.licensePlate}` : ''}`
}


const formatDate = (date: Date) => {
  const language = UserService.getLanguage()

  const locale = language === 'fr' ? 'fr-MA' : language === 'es' ? 'es-ES' : 'en-GB'

  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date))
}


const formatAmount = (amount: number) => `${new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 2 }).format(amount)} ${env.CURRENCY}`


const Maintenance = () => {
  const [cars, setCars] = useState<bookcarsTypes.Car[]>([])

  const [expenses, setExpenses] = useState<bookcarsTypes.MaintenanceExpense[]>([])

  const [schedules, setSchedules] = useState<bookcarsTypes.MaintenanceSchedule[]>([])

  const [report, setReport] = useState<Awaited<ReturnType<typeof MaintenanceExpenseService.report>> | null>(null)

  const [receiptFile, setReceiptFile] = useState<File | null>(null)

  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)

  const [selectedSchedule, setSelectedSchedule] = useState<bookcarsTypes.MaintenanceSchedule | null>(null)

  const [scheduleSaving, setScheduleSaving] = useState(false)

  const [scheduleFormError, setScheduleFormError] = useState(false)

  const [scheduleFormErrorMessage, setScheduleFormErrorMessage] = useState('')

  const [scheduleForm, setScheduleForm] = useState<ScheduleForm>(emptyScheduleForm())

  const [loading, setLoading] = useState(true)

  const [loadError, setLoadError] = useState(false)

  const [keyword, setKeyword] = useState('')

  const [typeFilter, setTypeFilter] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)

  const [selected, setSelected] = useState<bookcarsTypes.MaintenanceExpense | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<bookcarsTypes.MaintenanceExpense | null>(null)

  const [saving, setSaving] = useState(false)

  const [formError, setFormError] = useState(false)

  const [formErrorMessage, setFormErrorMessage] = useState('')

  const [form, setForm] = useState<ExpenseForm>(emptyForm)


  const onLoad = useCallback(async (user?: bookcarsTypes.User) => {
    if (!user) {
      setLoading(false)

      return
    }

    setLoading(true)

    setLoadError(false)

    try {
      const supplierIds = helper.admin(user)

        ? bookcarsHelper.flattenSuppliers(await SupplierService.getAllSuppliers())

        : [user._id || '']

      const [carResult, expenseRows, scheduleRows, reportData] = await Promise.all([

        CarService.getCars('', { suppliers: supplierIds, includeAlreadyBookedCars: true, includeComingSoonCars: true }, 1, 1000),

        MaintenanceExpenseService.list(),

        MaintenanceScheduleService.list(),

        MaintenanceExpenseService.report(),

      ])

      setCars(carResult?.[0]?.resultData || [])

      setExpenses(expenseRows || [])

      setSchedules(scheduleRows || [])

      setReport(reportData || null)
    } catch (error) {
      setLoadError(true)

      helper.error(error)
    } finally {
      setLoading(false)
    }
  }, [])


  const filtered = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase()

    return expenses.filter((expense) => {
      const matchesType = !typeFilter || expense.type === typeFilter

      const matchesQuery = !query || `${carName(expense)} ${expense.vendor || ''} ${expense.note || ''}`.toLocaleLowerCase().includes(query)

      return matchesType && matchesQuery
    })
  }, [expenses, keyword, typeFilter])

  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)


  const openNew = () => {
    setSelected(null)

    setReceiptFile(null)

    setForm({ ...emptyForm(), car: cars[0]?._id || '' })

    setFormError(false)

    setFormErrorMessage('')

    setDialogOpen(true)
  }


  const openEdit = (expense: bookcarsTypes.MaintenanceExpense) => {
    setSelected(expense)

    setReceiptFile(null)

    setForm({

      car: typeof expense.car === 'string' ? expense.car : expense.car?._id || '',

      date: new Date(expense.date).toISOString().slice(0, 10),

      type: expense.type,

      amount: String(expense.amount),

      mileage: expense.mileage === undefined ? '' : String(expense.mileage),

      vendor: expense.vendor || '',

      note: expense.note || '',

    })

    setFormError(false)

    setFormErrorMessage('')

    setDialogOpen(true)
  }


  const handleSave = async () => {
    const amount = Number(form.amount)

    const mileage = form.mileage.trim() ? Number(form.mileage) : undefined

    if (!form.car || !form.date || !Number.isFinite(amount) || amount <= 0

      || (mileage !== undefined && (!Number.isFinite(mileage) || mileage < 0))) {
      setFormError(true)

      return
    }


    setSaving(true)

    setFormError(false)


    try {
      let receipt: string | undefined

      if (receiptFile) {
receipt = (await MaintenanceExpenseService.uploadReceipt(receiptFile)).filename
}

      const payload: bookcarsTypes.UpsertMaintenanceExpensePayload = {

        car: form.car,

        date: new Date(`${form.date}T12:00:00`),

        type: form.type,

        amount,

        mileage,

        vendor: form.vendor.trim(),

        note: form.note.trim(),

        receipt,

      }

      if (selected?._id) {
        const updated = await MaintenanceExpenseService.update(selected._id, payload)

        setExpenses((rows) => rows.map((row) => row._id === selected._id ? updated : row))
      } else {
        const created = await MaintenanceExpenseService.create(payload)

        setExpenses((rows) => [created, ...rows])
      }

      setDialogOpen(false)

      setReceiptFile(null)
    } catch (error) {
      const detail = apiErrorMessage(error)

      helper.error(error, detail || undefined)

      setFormError(true)

      setFormErrorMessage(detail)
    } finally {
      setSaving(false)
    }
  }


  const openScheduleNew = () => {
    setSelectedSchedule(null)

    setScheduleForm(emptyScheduleForm(cars[0]?._id || ''))

    setScheduleFormError(false)

    setScheduleFormErrorMessage('')

    setScheduleDialogOpen(true)
  }


  const openScheduleEdit = (schedule: bookcarsTypes.MaintenanceSchedule) => {
    setSelectedSchedule(schedule)

    setScheduleForm({

      car: typeof schedule.car === 'string' ? schedule.car : schedule.car?._id || '',

      title: schedule.title,

      type: schedule.type,

      nextDueDate: new Date(schedule.nextDueDate).toISOString().slice(0, 10),

      intervalDays: schedule.intervalDays === undefined ? '' : String(schedule.intervalDays),

      intervalKm: schedule.intervalKm === undefined ? '' : String(schedule.intervalKm),

      nextDueMileage: schedule.nextDueMileage === undefined ? '' : String(schedule.nextDueMileage),

      note: schedule.note || '',

      status: schedule.status,

    })

    setScheduleFormError(false)

    setScheduleFormErrorMessage('')

    setScheduleDialogOpen(true)
  }


  const handleScheduleSave = async () => {
    const intervalDays = scheduleForm.intervalDays.trim() ? Number(scheduleForm.intervalDays) : undefined

    const intervalKm = scheduleForm.intervalKm.trim() ? Number(scheduleForm.intervalKm) : undefined

    const nextDueMileage = scheduleForm.nextDueMileage.trim() ? Number(scheduleForm.nextDueMileage) : undefined

    if (!scheduleForm.car || !scheduleForm.title.trim() || !scheduleForm.nextDueDate

      || (intervalDays === undefined && intervalKm === undefined)

      || (intervalDays !== undefined && (!Number.isInteger(intervalDays) || intervalDays < 1))

      || (intervalKm !== undefined && (!Number.isInteger(intervalKm) || intervalKm < 1))

      || (nextDueMileage !== undefined && (!Number.isFinite(nextDueMileage) || nextDueMileage < 0))) {
      setScheduleFormError(true)

      return
    }

    setScheduleSaving(true)

    setScheduleFormError(false)

    const payload: bookcarsTypes.UpsertMaintenanceSchedulePayload = {

      car: scheduleForm.car,

      title: scheduleForm.title.trim(),

      type: scheduleForm.type,

      nextDueDate: new Date(`${scheduleForm.nextDueDate}T12:00:00`),

      intervalDays,

      intervalKm,

      nextDueMileage,

      status: scheduleForm.status,

      note: scheduleForm.note.trim(),

    }

    try {
      if (selectedSchedule?._id) {
        const updated = await MaintenanceScheduleService.update(selectedSchedule._id, payload)

        setSchedules((rows) => rows.map((row) => row._id === selectedSchedule._id ? updated : row))
      } else {
        const created = await MaintenanceScheduleService.create(payload)

        setSchedules((rows) => [...rows, created].sort((a, b) => new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime()))
      }

      setScheduleDialogOpen(false)
    } catch (error) {
      const detail = apiErrorMessage(error)

      helper.error(error, detail || undefined)

      setScheduleFormError(true)

      setScheduleFormErrorMessage(detail)
    } finally {
      setScheduleSaving(false)
    }
  }


  const handleScheduleDelete = async (schedule: bookcarsTypes.MaintenanceSchedule) => {
    if (!schedule._id || !window.confirm(strings.DELETE_SCHEDULE_CONFIRM)) {
return
}

    try {
      await MaintenanceScheduleService.remove(schedule._id)

      setSchedules((rows) => rows.filter((row) => row._id !== schedule._id))
    } catch (error) {
      helper.error(error)
    }
  }


  const scheduleStatusLabel = (status: bookcarsTypes.MaintenanceScheduleStatus) => {
    switch (status) {
      case bookcarsTypes.MaintenanceScheduleStatus.Due: return strings.DUE

      case bookcarsTypes.MaintenanceScheduleStatus.Overdue: return strings.OVERDUE

      case bookcarsTypes.MaintenanceScheduleStatus.Completed: return strings.COMPLETED

      default: return strings.UPCOMING
    }
  }


  const handleDelete = async () => {
    if (!deleteTarget?._id) {
return
}

    try {
      await MaintenanceExpenseService.remove(deleteTarget._id)

      setExpenses((rows) => rows.filter((row) => row._id !== deleteTarget._id))

      setDeleteTarget(null)
    } catch (error) {
      helper.error(error)
    }
  }


  const setField = (key: keyof ExpenseForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }))
  }


  return (

    <Layout strict onLoad={onLoad}>

      <main className="agency-maintenance">

        <div className="agency-maintenance__heading">

          <div>

            <Typography component="p" className="agency-maintenance__eyebrow">{strings.EYEBROW}</Typography>

            <Typography component="h1" className="agency-maintenance__title">{strings.TITLE}</Typography>

            <Typography className="agency-maintenance__subtitle">{strings.SUBTITLE}</Typography>

          </div>

          <Button variant="contained" startIcon={<AddRoundedIcon />} className="agency-maintenance__action" onClick={openNew} disabled={cars.length === 0}>

            {strings.ADD}

          </Button>

        </div>


        {loadError && <Alert severity="error" className="agency-maintenance__alert">{strings.LOAD_ERROR}</Alert>}


        <div className="agency-maintenance__summary">

          <Card><CardContent><span className="agency-maintenance__summary-icon"><BuildRoundedIcon /></span><small>{strings.TOTAL}</small><strong>{loading ? 'â€”' : formatAmount(total)}</strong></CardContent></Card>

          <Card><CardContent><span className="agency-maintenance__summary-icon agency-maintenance__summary-icon--blue">{strings.TYPE.slice(0, 1)}</span><small>{strings.RECORDS}</small><strong>{loading ? 'â€”' : expenses.length}</strong></CardContent></Card>

          <Card><CardContent><span className="agency-maintenance__summary-icon">{strings.SCHEDULES.slice(0, 1)}</span><small>{strings.SCHEDULES}</small><strong>{loading ? 'â€”' : schedules.length}</strong></CardContent></Card>

        </div>


        <section className="agency-maintenance__panel">

          <div className="agency-maintenance__toolbar">

            <TextField size="small" placeholder={strings.SEARCH} value={keyword} onChange={(event) => setKeyword(event.target.value)} />

            <TextField size="small" select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>

              <MenuItem value="">{strings.ALL_TYPES}</MenuItem>

              {Object.values(bookcarsTypes.MaintenanceExpenseType).map((type) => <MenuItem value={type} key={type}>{typeLabel(type)}</MenuItem>)}

            </TextField>

          </div>

          <div className="agency-maintenance__table-head">

            <span>{strings.DATE}</span><span>{strings.TYPE}</span><span>{strings.VEHICLE}</span><span>{strings.AMOUNT}</span><span>{strings.MILEAGE}</span><span>{strings.VENDOR}</span><span>{strings.ACTIONS}</span>

          </div>

          {loading ? (

            <div className="agency-maintenance__empty">â€¦</div>

          ) : filtered.length === 0 ? (

            <div className="agency-maintenance__empty"><BuildRoundedIcon /><p>{cars.length === 0 ? strings.EMPTY_CARS : strings.EMPTY}</p></div>

          ) : filtered.map((expense) => (

            <div className="agency-maintenance__row" key={expense._id}>

              <span className="agency-maintenance__date">{formatDate(expense.date)}</span>

              <span><span className="agency-maintenance__type">{typeLabel(expense.type)}</span></span>

              <strong className="agency-maintenance__vehicle">{carName(expense)}</strong>

              <strong>{formatAmount(expense.amount)}</strong>

              <span>{expense.mileage ? `${new Intl.NumberFormat().format(expense.mileage)} km` : 'â€”'}</span>

              <span>{expense.vendor || expense.note || 'â€”'}</span>

              <span className="agency-maintenance__actions">

                <Button size="small" aria-label={strings.EDIT} onClick={() => openEdit(expense)}><EditRoundedIcon /></Button>

                <Button size="small" color="error" aria-label={strings.DELETE} onClick={() => setDeleteTarget(expense)}><DeleteOutlineRoundedIcon /></Button>

              </span>

            </div>

          ))}

        </section>

        <section className="agency-maintenance__panel" aria-label={strings.SCHEDULES}>

          <div className="agency-maintenance__section-heading">

            <Typography component="h2">{strings.SCHEDULES}</Typography>

            <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={openScheduleNew} disabled={cars.length === 0}>{strings.ADD_SCHEDULE}</Button>

          </div>

          {schedules.length === 0 ? <div className="agency-maintenance__empty">{strings.NO_SCHEDULES}</div> : schedules.map((schedule) => <div className="agency-maintenance__schedule-row" key={schedule._id}><div><strong>{schedule.title}</strong><span>{!schedule.car || typeof schedule.car === 'string' ? '—' : schedule.car.name || '—'}</span></div><span>{formatDate(schedule.nextDueDate)}</span><span className={`agency-maintenance__status agency-maintenance__status--${schedule.status}`}>{scheduleStatusLabel(schedule.status)}</span><span className="agency-maintenance__actions"><Button size="small" aria-label={strings.EDIT} onClick={() => openScheduleEdit(schedule)}><EditRoundedIcon /></Button><Button size="small" color="error" aria-label={strings.DELETE} onClick={() => handleScheduleDelete(schedule)}><DeleteOutlineRoundedIcon /></Button></span></div>)}

        </section>

        <section className="agency-maintenance__panel" aria-label={strings.CATEGORY_REPORT}>

          <div className="agency-maintenance__section-heading"><Typography component="h2">{strings.CATEGORY_REPORT}</Typography><strong>{report ? formatAmount(report.total) : 'â€”'}</strong></div>

          {report?.categories.length ? report.categories.map((row) => <div className="agency-maintenance__report-row" key={row.category}><span>{typeLabel(row.category as bookcarsTypes.MaintenanceExpenseType)}</span><span>{row.count} Â· {row.receipts} {strings.RECEIPTS}</span><strong>{formatAmount(row.total)}</strong></div>) : <div className="agency-maintenance__empty">{strings.NO_REPORT}</div>}

        </section>

      </main>


      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">

        <DialogTitle>{selected ? strings.EDIT : strings.NEW}</DialogTitle>

        <DialogContent className="agency-maintenance__form">

          {formError && <Alert severity="error">{formErrorMessage || strings.SAVE_ERROR}</Alert>}

          <TextField select fullWidth required label={strings.VEHICLE} value={form.car} onChange={setField('car')}>

            {cars.map((car) => <MenuItem value={car._id} key={car._id}>{car.name}{car.licensePlate ? ` Â· ${car.licensePlate}` : ''}</MenuItem>)}

          </TextField>

          <div className="agency-maintenance__form-grid">

            <TextField select fullWidth required label={strings.TYPE} value={form.type} onChange={setField('type')}>

              {Object.values(bookcarsTypes.MaintenanceExpenseType).map((type) => <MenuItem value={type} key={type}>{typeLabel(type)}</MenuItem>)}

            </TextField>

            <TextField fullWidth required type="date" label={strings.DATE} value={form.date} onChange={setField('date')} InputLabelProps={{ shrink: true }} />

            <TextField fullWidth required type="number" label={strings.AMOUNT} value={form.amount} onChange={setField('amount')} inputProps={{ min: 0.01, step: 0.01 }} />

            <TextField fullWidth type="number" label={strings.MILEAGE} value={form.mileage} onChange={setField('mileage')} inputProps={{ min: 0, step: 1 }} />

          </div>

          <TextField fullWidth label={strings.VENDOR} value={form.vendor} onChange={setField('vendor')} inputProps={{ maxLength: 160 }} />

          <input aria-label={strings.RECEIPT} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} />

          <TextField fullWidth multiline minRows={3} label={strings.NOTE} value={form.note} onChange={setField('note')} inputProps={{ maxLength: 1000 }} />

        </DialogContent>

        <DialogActions>

          <Button onClick={() => setDialogOpen(false)} disabled={saving}>{strings.CANCEL}</Button>

          <Button variant="contained" onClick={handleSave} disabled={saving || cars.length === 0}>{strings.SAVE}</Button>

        </DialogActions>

      </Dialog>


      <Dialog open={scheduleDialogOpen} onClose={() => !scheduleSaving && setScheduleDialogOpen(false)} fullWidth maxWidth="sm">

        <DialogTitle>{selectedSchedule ? strings.EDIT_SCHEDULE : strings.NEW_SCHEDULE}</DialogTitle>

        <DialogContent className="agency-maintenance__form">

          {scheduleFormError && <Alert severity="error">{scheduleFormErrorMessage || strings.SCHEDULE_SAVE_ERROR}</Alert>}

          <TextField select fullWidth required label={strings.VEHICLE} value={scheduleForm.car} onChange={(event) => setScheduleForm((current) => ({ ...current, car: event.target.value }))}>

            {cars.map((car) => <MenuItem value={car._id} key={car._id}>{car.name}{car.licensePlate ? ` Â· ${car.licensePlate}` : ''}</MenuItem>)}

          </TextField>

          <TextField fullWidth required label={strings.SCHEDULE_TITLE} value={scheduleForm.title} onChange={(event) => setScheduleForm((current) => ({ ...current, title: event.target.value }))} inputProps={{ maxLength: 200 }} />

          <div className="agency-maintenance__form-grid">

            <TextField select fullWidth required label={strings.TYPE} value={scheduleForm.type} onChange={(event) => setScheduleForm((current) => ({ ...current, type: event.target.value as bookcarsTypes.MaintenanceExpenseType }))}>{Object.values(bookcarsTypes.MaintenanceExpenseType).map((type) => <MenuItem value={type} key={type}>{typeLabel(type)}</MenuItem>)}</TextField>

            <TextField fullWidth required type="date" label={strings.NEXT_DUE} value={scheduleForm.nextDueDate} onChange={(event) => setScheduleForm((current) => ({ ...current, nextDueDate: event.target.value }))} InputLabelProps={{ shrink: true }} />

            <TextField fullWidth type="number" label={strings.INTERVAL_DAYS} value={scheduleForm.intervalDays} onChange={(event) => setScheduleForm((current) => ({ ...current, intervalDays: event.target.value }))} inputProps={{ min: 1, step: 1 }} />

            <TextField fullWidth type="number" label={strings.INTERVAL_KM} value={scheduleForm.intervalKm} onChange={(event) => setScheduleForm((current) => ({ ...current, intervalKm: event.target.value }))} inputProps={{ min: 1, step: 1 }} />

            <TextField fullWidth type="number" label={strings.NEXT_MILEAGE} value={scheduleForm.nextDueMileage} onChange={(event) => setScheduleForm((current) => ({ ...current, nextDueMileage: event.target.value }))} inputProps={{ min: 0, step: 1 }} />

            <TextField select fullWidth label={strings.STATUS} value={scheduleForm.status} onChange={(event) => setScheduleForm((current) => ({ ...current, status: event.target.value as bookcarsTypes.MaintenanceScheduleStatus }))}>{Object.values(bookcarsTypes.MaintenanceScheduleStatus).map((status) => <MenuItem value={status} key={status}>{scheduleStatusLabel(status)}</MenuItem>)}</TextField>

          </div>

          <TextField fullWidth multiline minRows={3} label={strings.NOTE} value={scheduleForm.note} onChange={(event) => setScheduleForm((current) => ({ ...current, note: event.target.value }))} inputProps={{ maxLength: 1000 }} />

        </DialogContent>

        <DialogActions><Button onClick={() => setScheduleDialogOpen(false)} disabled={scheduleSaving}>{strings.CANCEL}</Button><Button variant="contained" onClick={handleScheduleSave} disabled={scheduleSaving || cars.length === 0}>{strings.SAVE_SCHEDULE}</Button></DialogActions>

      </Dialog>


      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>

        <DialogTitle>{strings.DELETE}</DialogTitle>

        <DialogContent>{strings.DELETE_CONFIRM}</DialogContent>

        <DialogActions>

          <Button onClick={() => setDeleteTarget(null)}>{strings.CANCEL}</Button>

          <Button color="error" variant="contained" onClick={handleDelete}>{strings.DELETE}</Button>

        </DialogActions>

      </Dialog>

    </Layout>

  )
}


export default Maintenance

