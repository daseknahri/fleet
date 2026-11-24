import React, { useCallback, useMemo, useState } from 'react'

import {

  Alert,

  Button,

  Checkbox,

  Card,

  CardContent,

  Dialog,

  DialogActions,

  DialogContent,

  DialogTitle,

  FormControlLabel,

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

import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'

import AccessDenied from '@/components/AccessDenied'

import * as CarService from '@/services/CarService'

import * as SupplierService from '@/services/SupplierService'

import * as MaintenanceExpenseService from '@/services/MaintenanceExpenseService'

import * as MaintenanceScheduleService from '@/services/MaintenanceScheduleService'

import * as MaintenanceWorkOrderService from '@/services/MaintenanceWorkOrderService'

import * as MaintenanceCategoryService from '@/services/MaintenanceCategoryService'

import HelpIcon from '@/components/HelpIcon'

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

  // F7 / W3 M-5 — the linked work order ('' = none).
  workOrder: string

  // Next pass - item 3: the agency's own category ('' = none).
  category: string

  date: string

  type: bookcarsTypes.MaintenanceExpenseType

  amount: string

  mileage: string

  vendor: string

  note: string

  // F7 / W3 M-7 — optional reason recorded on the update audit row.
  reason: string

}


interface WorkOrderForm {

  car: string

  title: string

  type: bookcarsTypes.MaintenanceExpenseType

  status: bookcarsTypes.WorkOrderStatus

  scheduledStart: string

  scheduledEnd: string

  odometer: string

  vendor: string

  note: string

}


interface PaymentForm {

  date: string

  amount: string

  method: bookcarsTypes.RentalPaymentMethod

  reference: string

  note: string

}


interface ScheduleForm {

  car: string

  title: string

  type: bookcarsTypes.MaintenanceExpenseType

  // Next pass - item 3: the agency's own category ('' = none).
  category: string

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

  category: '',

  nextDueDate: new Date().toISOString().slice(0, 10),

  intervalDays: '90',

  intervalKm: '',

  nextDueMileage: '',

  note: '',

  status: bookcarsTypes.MaintenanceScheduleStatus.Upcoming,

})


const emptyWorkOrderForm = (car = ''): WorkOrderForm => ({

  car,

  title: '',

  type: bookcarsTypes.MaintenanceExpenseType.Maintenance,

  status: bookcarsTypes.WorkOrderStatus.Scheduled,

  scheduledStart: new Date().toISOString().slice(0, 10),

  scheduledEnd: new Date().toISOString().slice(0, 10),

  odometer: '',

  vendor: '',

  note: '',

})


const emptyPaymentForm = (): PaymentForm => ({

  date: new Date().toISOString().slice(0, 10),

  amount: '',

  method: bookcarsTypes.RentalPaymentMethod.Cash,

  reference: '',

  note: '',

})


const emptyForm = (): ExpenseForm => ({

  car: '',

  workOrder: '',

  category: '',

  date: new Date().toISOString().slice(0, 10),

  type: bookcarsTypes.MaintenanceExpenseType.Maintenance,

  amount: '',

  mileage: '',

  vendor: '',

  note: '',

  reason: '',

})


const typeLabel = (type: bookcarsTypes.MaintenanceExpenseType) => {
  switch (type) {
    case bookcarsTypes.MaintenanceExpenseType.Maintenance: return strings.MAINTENANCE
    case bookcarsTypes.MaintenanceExpenseType.Repair: return strings.REPAIR
    case bookcarsTypes.MaintenanceExpenseType.Cleaning: return strings.CLEANING
    case bookcarsTypes.MaintenanceExpenseType.Fuel: return strings.FUEL
    case bookcarsTypes.MaintenanceExpenseType.Insurance: return strings.INSURANCE
    case bookcarsTypes.MaintenanceExpenseType.Oil: return strings.OIL
    case bookcarsTypes.MaintenanceExpenseType.Tyres: return strings.TYRES
    case bookcarsTypes.MaintenanceExpenseType.Battery: return strings.BATTERY
    case bookcarsTypes.MaintenanceExpenseType.Vignette: return strings.VIGNETTE
    case bookcarsTypes.MaintenanceExpenseType.VisiteTechnique: return strings.VISITE_TECHNIQUE
    case bookcarsTypes.MaintenanceExpenseType.AdBlue: return strings.ADBLUE
    case bookcarsTypes.MaintenanceExpenseType.Fines: return strings.FINES
    case bookcarsTypes.MaintenanceExpenseType.LoanPayment: return strings.LOAN_PAYMENT
    case bookcarsTypes.MaintenanceExpenseType.Rent: return strings.RENT
    case bookcarsTypes.MaintenanceExpenseType.Salaries: return strings.SALARIES
    case bookcarsTypes.MaintenanceExpenseType.Agents: return strings.AGENTS
    case bookcarsTypes.MaintenanceExpenseType.Accounting: return strings.ACCOUNTING
    case bookcarsTypes.MaintenanceExpenseType.BankFees: return strings.BANK_FEES
    case bookcarsTypes.MaintenanceExpenseType.Bodywork: return strings.BODYWORK
    case bookcarsTypes.MaintenanceExpenseType.Glass: return strings.GLASS
    case bookcarsTypes.MaintenanceExpenseType.Electrical: return strings.ELECTRICAL
    case bookcarsTypes.MaintenanceExpenseType.AirConditioning: return strings.AIR_CONDITIONING
    case bookcarsTypes.MaintenanceExpenseType.Exhaust: return strings.EXHAUST
    default: return strings.OTHER
  }
}

// GA-PAR-16: derived payment status — mirrors the backend rule
// (paidAmount >= amount = paid; 0 < paidAmount < amount = partial;
// 0 or untracked = unpaid). Prefer the server-computed status when present.
const paymentStatusOf = (expense: bookcarsTypes.MaintenanceExpense): bookcarsTypes.MaintenanceExpensePaymentStatus => {
  if (expense.paymentStatus) {
    return expense.paymentStatus
  }
  const paid = expense.paidAmount
  if (paid === undefined || paid === null || paid <= 0) {
    return bookcarsTypes.MaintenanceExpensePaymentStatus.Unpaid
  }
  return paid >= expense.amount
    ? bookcarsTypes.MaintenanceExpensePaymentStatus.Paid
    : bookcarsTypes.MaintenanceExpensePaymentStatus.Partial
}

const paymentStatusLabel = (status: bookcarsTypes.MaintenanceExpensePaymentStatus) => {
  switch (status) {
    case bookcarsTypes.MaintenanceExpensePaymentStatus.Paid: return strings.PAID
    case bookcarsTypes.MaintenanceExpensePaymentStatus.Partial: return strings.PARTIAL
    default: return strings.UNPAID
  }
}


const carName = (expense: bookcarsTypes.MaintenanceExpense) => {
  if (!expense.car || typeof expense.car === 'string') {
return strings.GENERAL_EXPENSE
}

  return `${expense.car.name || '—'}${expense.car.licensePlate ? ` · ${expense.car.licensePlate}` : ''}`
}


const uiLocale = () => {
  const language = UserService.getLanguage()

  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}


const formatDate = (date: Date) => {
  const locale = uiLocale()

  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date))
}


const formatAmount = (amount: number) => `${new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 2 }).format(amount)} ${env.CURRENCY}`


// H-037: mirrors the backend's dueStatus derivation
// (backend/src/controllers/maintenanceScheduleController.ts): Completed is
// the only operator-set status; every other status is derived from the due
// date (overdue < today <= due within 30 days <= upcoming).
const derivedScheduleStatus = (status: bookcarsTypes.MaintenanceScheduleStatus, nextDueDate: string): bookcarsTypes.MaintenanceScheduleStatus => {
  if (status === bookcarsTypes.MaintenanceScheduleStatus.Completed) {
    return bookcarsTypes.MaintenanceScheduleStatus.Completed
  }
  const due = new Date(`${nextDueDate}T00:00:00`)
  if (Number.isNaN(due.getTime())) {
    return bookcarsTypes.MaintenanceScheduleStatus.Upcoming
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueSoon = new Date(today)
  dueSoon.setDate(dueSoon.getDate() + 30)
  if (due.getTime() < today.getTime()) {
    return bookcarsTypes.MaintenanceScheduleStatus.Overdue
  }
  if (due.getTime() <= dueSoon.getTime()) {
    return bookcarsTypes.MaintenanceScheduleStatus.Due
  }
  return bookcarsTypes.MaintenanceScheduleStatus.Upcoming
}


const Maintenance = () => {
  const agencyPermissions = useAgencyPermissions()

  const canManageExpenses = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.ManageExpenses)

  const maintenanceDenied = !!agencyPermissions?.loaded && !agencyPermissions.can(AgencyPermission.ReadExpenses)
  const [cars, setCars] = useState<bookcarsTypes.Car[]>([])

  const [expenses, setExpenses] = useState<bookcarsTypes.MaintenanceExpense[]>([])

  const [schedules, setSchedules] = useState<bookcarsTypes.MaintenanceSchedule[]>([])

  const [report, setReport] = useState<Awaited<ReturnType<typeof MaintenanceExpenseService.report>> | null>(null)

  // Next pass - item 3: the agency's own expense categories.
  const [categories, setCategories] = useState<bookcarsTypes.MaintenanceCategory[]>([])

  const [categoryFilter, setCategoryFilter] = useState('')

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)

  const [selectedCategory, setSelectedCategory] = useState<bookcarsTypes.MaintenanceCategory | null>(null)

  const [categoryForm, setCategoryForm] = useState({ name: '', color: '', active: true })

  const [categorySaving, setCategorySaving] = useState(false)

  const [categoryFormError, setCategoryFormError] = useState(false)

  const [categoryFormErrorMessage, setCategoryFormErrorMessage] = useState('')

  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<bookcarsTypes.MaintenanceCategory | null>(null)

  // Next pass - item 3: a platform admin names the agency a new
  // category belongs to (an agency user always works in their own).
  const [isAdmin, setIsAdmin] = useState(false)

  const [suppliers, setSuppliers] = useState<bookcarsTypes.User[]>([])

  const [adminSupplier, setAdminSupplier] = useState('')

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

  const [scheduleDeleteTarget, setScheduleDeleteTarget] = useState<bookcarsTypes.MaintenanceSchedule | null>(null)

  // GAP-MAINT-P0-2 — "Complete service" dialog state.
  const [completeTarget, setCompleteTarget] = useState<bookcarsTypes.MaintenanceSchedule | null>(null)

  const [completeForm, setCompleteForm] = useState({ serviceDate: new Date().toISOString().slice(0, 10), odometerKm: '', workOrderId: '', note: '' })

  const [completeSaving, setCompleteSaving] = useState(false)

  const [completeError, setCompleteError] = useState(false)

  const [completeErrorMessage, setCompleteErrorMessage] = useState('')

  // F7 / W3 M-5 — work orders (admin UI; the API existed, the page did not).
  const [workOrders, setWorkOrders] = useState<bookcarsTypes.MaintenanceWorkOrder[]>([])

  const [workOrderDialogOpen, setWorkOrderDialogOpen] = useState(false)

  const [selectedWorkOrder, setSelectedWorkOrder] = useState<bookcarsTypes.MaintenanceWorkOrder | null>(null)

  const [workOrderSaving, setWorkOrderSaving] = useState(false)

  const [workOrderFormError, setWorkOrderFormError] = useState(false)

  const [workOrderFormErrorMessage, setWorkOrderFormErrorMessage] = useState('')

  const [workOrderForm, setWorkOrderForm] = useState<WorkOrderForm>(emptyWorkOrderForm())

  const [workOrderDeleteTarget, setWorkOrderDeleteTarget] = useState<bookcarsTypes.MaintenanceWorkOrder | null>(null)

  // F7 / W3 M-2 — record-payment dialog (paidAmount is never typed in
  // the expense dialog any more; it is the sum of these records).
  const [paymentTarget, setPaymentTarget] = useState<bookcarsTypes.MaintenanceExpense | null>(null)

  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm())

  const [paymentSaving, setPaymentSaving] = useState(false)

  const [paymentError, setPaymentError] = useState(false)

  const [paymentErrorMessage, setPaymentErrorMessage] = useState('')

  // F7 / W3 M-7 — audit history dialog + delete reason.
  const [historyTarget, setHistoryTarget] = useState<bookcarsTypes.MaintenanceExpense | null>(null)

  const [historyRows, setHistoryRows] = useState<bookcarsTypes.MaintenanceExpenseAudit[]>([])

  const [historyLoading, setHistoryLoading] = useState(false)

  const [deleteReason, setDeleteReason] = useState('')

  const [deleteError, setDeleteError] = useState(false)

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
      const adminUser = helper.admin(user)

      setIsAdmin(adminUser)

      const allSuppliers = adminUser ? (await SupplierService.getAllSuppliers()) || [] : []

      setSuppliers(allSuppliers)

      if (adminUser && allSuppliers.length > 0) {

        setAdminSupplier(allSuppliers[0]._id || '')

      }

      const supplierIds = adminUser

        ? bookcarsHelper.flattenSuppliers(allSuppliers)

        : [user._id || '']

      // Audit-fix 2026-11-24 (F-03) — one failing call must not blank
      // the whole page: each list settles independently, and the banner
      // only flags the failure while the sections that loaded render.
      const [carResult, expenseRows, scheduleRows, workOrderRows, reportData, categoryRows] = await Promise.allSettled([

        CarService.getCars('', { suppliers: supplierIds, includeAlreadyBookedCars: true, includeComingSoonCars: true }, 1, 1000),

        MaintenanceExpenseService.list(),

        MaintenanceScheduleService.list(),

        MaintenanceWorkOrderService.list(),

        MaintenanceExpenseService.report(),

        MaintenanceCategoryService.list(),

      ])

      if (carResult.status === 'fulfilled') {
        setCars(carResult.value?.[0]?.resultData || [])
      }

      if (expenseRows.status === 'fulfilled') {
        setExpenses(expenseRows.value || [])
      }

      if (scheduleRows.status === 'fulfilled') {
        setSchedules(scheduleRows.value || [])
      }

      if (workOrderRows.status === 'fulfilled') {
        setWorkOrders(workOrderRows.value || [])
      }

      if (reportData.status === 'fulfilled') {
        setReport(reportData.value || null)
      }

      if (categoryRows.status === 'fulfilled') {
        setCategories(categoryRows.value || [])
      }

      if ([carResult, expenseRows, scheduleRows, workOrderRows, reportData, categoryRows].some((result) => result.status === 'rejected')) {
        setLoadError(true)
      }
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

      const categoryId = !expense.category ? '' : typeof expense.category === 'string' ? expense.category : expense.category._id || ''

      const matchesCategory = !categoryFilter || (categoryFilter === 'none' ? !categoryId : categoryId === categoryFilter)

      const categoryName = !expense.category ? '' : typeof expense.category === 'string' ? (categories.find((category) => category._id === expense.category)?.name || '') : expense.category.name || ''

      const matchesQuery = !query || `${carName(expense)} ${expense.vendor || ''} ${expense.note || ''} ${categoryName}`.toLocaleLowerCase().includes(query)

      return matchesType && matchesCategory && matchesQuery
    })
  }, [expenses, keyword, typeFilter, categoryFilter, categories])

  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)


  const openNew = () => {
    setSelected(null)

    setReceiptFile(null)

    setForm({ ...emptyForm(), car: '' })

    setFormError(false)

    setFormErrorMessage('')

    setDialogOpen(true)
  }


  const openEdit = (expense: bookcarsTypes.MaintenanceExpense) => {
    setSelected(expense)

    setReceiptFile(null)

    setForm({

      car: typeof expense.car === 'string' ? expense.car : expense.car?._id || '',

      workOrder: !expense.workOrder ? '' : typeof expense.workOrder === 'string' ? expense.workOrder : expense.workOrder._id || '',

      category: !expense.category ? '' : typeof expense.category === 'string' ? expense.category : expense.category._id || '',

      date: new Date(expense.date).toISOString().slice(0, 10),

      type: expense.type,

      amount: String(expense.amount),

      mileage: expense.mileage === undefined ? '' : String(expense.mileage),

      vendor: expense.vendor || '',

      note: expense.note || '',

      reason: '',

    })

    setFormError(false)

    setFormErrorMessage('')

    setDialogOpen(true)
  }


  const handleSave = async () => {
    const amount = Number(form.amount)

    const mileage = form.mileage.trim() ? Number(form.mileage) : undefined

    if (!form.date || !Number.isFinite(amount) || amount <= 0

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

        car: form.car || undefined,

        workOrder: form.workOrder || null,

        category: form.category || null,

        date: new Date(`${form.date}T12:00:00`),

        type: form.type,

        amount,

        mileage,

        vendor: form.vendor.trim(),

        note: form.note.trim(),

        receipt,

      }

      if (selected?._id) {
        const updated = await MaintenanceExpenseService.update(selected._id, payload, form.reason.trim() || undefined)

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

      category: !schedule.category ? '' : typeof schedule.category === 'string' ? schedule.category : schedule.category._id || '',

      // GAP-MAINT-P0-1 — a km-only schedule has no due date; the form
      // opens with an empty date instead of crashing on toISOString().
      nextDueDate: schedule.nextDueDate ? new Date(schedule.nextDueDate).toISOString().slice(0, 10) : '',

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

    const failScheduleValidation = (message: string) => {
      setScheduleFormError(true)

      setScheduleFormErrorMessage(message)
    }

    if (!scheduleForm.car) {
      failScheduleValidation(`${strings.SCHEDULE_REQUIRED_FIELD}${strings.VEHICLE}`)

      return
    }

    if (!scheduleForm.title.trim()) {
      failScheduleValidation(`${strings.SCHEDULE_REQUIRED_FIELD}${strings.SCHEDULE_TITLE}`)

      return
    }

    // GAP-MAINT-P0-1 — a km-only schedule (intervalKm set) needs no
    // due date; the mileage leg governs it. Any other schedule still
    // needs a date (the form has no last-service date to derive one
    // from, so a date-less intervalDays schedule would never fire).
    if (!scheduleForm.nextDueDate && intervalKm === undefined) {
      failScheduleValidation(`${strings.SCHEDULE_REQUIRED_FIELD}${strings.NEXT_DUE}`)

      return
    }

    if (intervalDays === undefined && intervalKm === undefined) {
      failScheduleValidation(strings.SCHEDULE_INTERVAL_REQUIRED)

      return
    }

    if (intervalDays !== undefined && (!Number.isInteger(intervalDays) || intervalDays < 1)) {
      failScheduleValidation(`${strings.SCHEDULE_INVALID_FIELD}${strings.INTERVAL_DAYS}`)

      return
    }

    if (intervalKm !== undefined && (!Number.isInteger(intervalKm) || intervalKm < 1)) {
      failScheduleValidation(`${strings.SCHEDULE_INVALID_FIELD}${strings.INTERVAL_KM}`)

      return
    }

    if (nextDueMileage !== undefined && (!Number.isFinite(nextDueMileage) || nextDueMileage < 0)) {
      failScheduleValidation(`${strings.SCHEDULE_INVALID_FIELD}${strings.NEXT_MILEAGE}`)

      return
    }

    setScheduleSaving(true)

    setScheduleFormError(false)

    const payload: bookcarsTypes.UpsertMaintenanceSchedulePayload = {

      car: scheduleForm.car,

      title: scheduleForm.title.trim(),

      type: scheduleForm.type,

      category: scheduleForm.category || null,

      nextDueDate: scheduleForm.nextDueDate ? new Date(`${scheduleForm.nextDueDate}T12:00:00`) : undefined,

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

        setSchedules((rows) => [...rows, created].sort((a, b) => (a.nextDueDate ? new Date(a.nextDueDate).getTime() : Infinity) - (b.nextDueDate ? new Date(b.nextDueDate).getTime() : Infinity)))
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


  // Next pass - item 3: the agency's own categories (create / edit /
  // deactivate / delete). A platform admin names the agency in the
  // dialog; an agency user always works in their own agency.
  const openCategoryNew = () => {

    setSelectedCategory(null)

    setCategoryForm({ name: '', color: '', active: true })

    setCategoryFormError(false)

    setCategoryFormErrorMessage('')

    setCategoryDialogOpen(true)

  }


  const openCategoryEdit = (category: bookcarsTypes.MaintenanceCategory) => {

    setSelectedCategory(category)

    setCategoryForm({ name: category.name, color: category.color || '', active: category.active })

    setCategoryFormError(false)

    setCategoryFormErrorMessage('')

    setCategoryDialogOpen(true)

  }


  const handleCategorySave = async () => {

    if (!categoryForm.name.trim()) {

      setCategoryFormError(true)

      setCategoryFormErrorMessage(strings.CATEGORY_SAVE_ERROR)

      return

    }

    setCategorySaving(true)

    setCategoryFormError(false)

    try {

      const payload: bookcarsTypes.UpsertMaintenanceCategoryPayload = {

        name: categoryForm.name.trim(),

        color: categoryForm.color.trim() || undefined,

        ...(isAdmin && adminSupplier ? { supplier: adminSupplier } : {}),

      }

      if (selectedCategory?._id) {

        const updated = await MaintenanceCategoryService.update(selectedCategory._id, { ...payload, active: categoryForm.active })

        setCategories((rows) => rows.map((row) => row._id === selectedCategory._id ? updated : row))

      } else {

        const created = await MaintenanceCategoryService.create(payload)

        setCategories((rows) => [...rows, created].sort((a, b) => a.name.localeCompare(b.name)))

      }

      setCategoryDialogOpen(false)

    } catch (error) {

      const detail = apiErrorMessage(error)

      helper.error(error, detail || undefined)

      setCategoryFormError(true)

      setCategoryFormErrorMessage(detail || strings.CATEGORY_SAVE_ERROR)

    } finally {

      setCategorySaving(false)

    }

  }


  const handleCategoryDelete = async () => {

    if (!categoryDeleteTarget?._id) {

      return

    }

    try {

      await MaintenanceCategoryService.remove(categoryDeleteTarget._id)

      setCategories((rows) => rows.filter((row) => row._id !== categoryDeleteTarget._id))

      setCategoryDeleteTarget(null)

    } catch (error) {

      const detail = apiErrorMessage(error)

      helper.error(error, detail || undefined)

      setCategoryFormError(true)

      setCategoryFormErrorMessage(detail || strings.CATEGORY_DELETE_ERROR)

      setCategoryDeleteTarget(null)

    }

  }


  const handleScheduleDelete = async () => {
    if (!scheduleDeleteTarget?._id) {
return
}

    try {
      await MaintenanceScheduleService.remove(scheduleDeleteTarget._id)

      setSchedules((rows) => rows.filter((row) => row._id !== scheduleDeleteTarget._id))

      setScheduleDeleteTarget(null)
    } catch (error) {
      helper.error(error)
    }
  }

  // GAP-MAINT-P0-2 — "Complete service": close the work order, record
  // the service date/odometer, complete the schedule and roll the next
  // interval forward, in one server call.
  const openCompleteService = (schedule: bookcarsTypes.MaintenanceSchedule) => {
    setCompleteTarget(schedule)

    setCompleteForm({ serviceDate: new Date().toISOString().slice(0, 10), odometerKm: '', workOrderId: '', note: '' })

    setCompleteError(false)

    setCompleteErrorMessage('')
  }

  const handleCompleteService = async () => {
    if (!completeTarget?._id) {
      return
    }

    const odometerKm = completeForm.odometerKm.trim() === '' ? undefined : Number(completeForm.odometerKm)
    if (completeTarget.intervalKm && odometerKm === undefined) {
      setCompleteErrorMessage(strings.ODOMETER_REQUIRED)

      setCompleteError(true)

      return
    }

    if (odometerKm !== undefined && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
      setCompleteErrorMessage(`${strings.SCHEDULE_INVALID_FIELD}${strings.MILEAGE}`)

      setCompleteError(true)

      return
    }

    setCompleteSaving(true)

    setCompleteError(false)

    try {
      const result = await MaintenanceScheduleService.completeService(completeTarget._id, {
        workOrderId: completeForm.workOrderId || undefined,
        serviceDate: completeForm.serviceDate ? new Date(`${completeForm.serviceDate}T12:00:00`) : undefined,
        odometerKm,
        note: completeForm.note.trim() || undefined,
      })

      setSchedules((rows) => {
        const updated = rows.map((row) => (row._id === result.schedule._id ? result.schedule : row))
        return result.nextSchedule ? [...updated, result.nextSchedule].sort((a, b) => (a.nextDueDate ? new Date(a.nextDueDate).getTime() : Infinity) - (b.nextDueDate ? new Date(b.nextDueDate).getTime() : Infinity)) : updated
      })

      // A closed work order leaves the open list.
      if (completeForm.workOrderId) {
        setWorkOrders((rows) => rows.map((row) => (row._id === completeForm.workOrderId ? { ...row, status: bookcarsTypes.WorkOrderStatus.Completed, completedAt: result.schedule.lastServiceDate } : row)))
      }

      setCompleteTarget(null)
    } catch (error) {
      const detail = apiErrorMessage(error)

      setCompleteErrorMessage(detail || strings.COMPLETE_SERVICE_ERROR)

      setCompleteError(true)
    } finally {
      setCompleteSaving(false)
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

    // F7 / W3 M-7 — a hard delete requires a recorded reason.
    if (deleteReason.trim().length < 3) {
      setDeleteError(true)

      return
    }

    try {
      await MaintenanceExpenseService.remove(deleteTarget._id, deleteReason.trim())

      setExpenses((rows) => rows.filter((row) => row._id !== deleteTarget._id))

      setDeleteTarget(null)

      setDeleteReason('')

      setDeleteError(false)
    } catch (error) {
      helper.error(error)
    }
  }


  const workOrderStatusLabel = (status: bookcarsTypes.WorkOrderStatus) => {
    switch (status) {
      case bookcarsTypes.WorkOrderStatus.InProgress: return strings.WO_IN_PROGRESS

      case bookcarsTypes.WorkOrderStatus.Completed: return strings.COMPLETED

      case bookcarsTypes.WorkOrderStatus.Cancelled: return strings.WO_CANCELLED

      default: return strings.WO_SCHEDULED
    }
  }


  const workOrderCarName = (workOrder: bookcarsTypes.MaintenanceWorkOrder) => {
    if (!workOrder.car || typeof workOrder.car === 'string') {
return '—'
}

    return `${workOrder.car.name || '—'}${workOrder.car.licensePlate ? ` · ${workOrder.car.licensePlate}` : ''}`
  }


  const openWorkOrderNew = () => {
    setSelectedWorkOrder(null)

    setWorkOrderForm(emptyWorkOrderForm(cars[0]?._id || ''))

    setWorkOrderFormError(false)

    setWorkOrderFormErrorMessage('')

    setWorkOrderDialogOpen(true)
  }


  const openWorkOrderEdit = (workOrder: bookcarsTypes.MaintenanceWorkOrder) => {
    setSelectedWorkOrder(workOrder)

    setWorkOrderForm({

      car: typeof workOrder.car === 'string' ? workOrder.car : workOrder.car?._id || '',

      title: workOrder.title,

      type: workOrder.type,

      status: workOrder.status,

      scheduledStart: new Date(workOrder.scheduledStart).toISOString().slice(0, 10),

      scheduledEnd: new Date(workOrder.scheduledEnd).toISOString().slice(0, 10),

      odometer: workOrder.odometer === undefined ? '' : String(workOrder.odometer),

      vendor: workOrder.vendor || '',

      note: workOrder.note || '',

    })

    setWorkOrderFormError(false)

    setWorkOrderFormErrorMessage('')

    setWorkOrderDialogOpen(true)
  }


  const handleWorkOrderSave = async () => {
    const odometer = workOrderForm.odometer.trim() ? Number(workOrderForm.odometer) : undefined

    const failWorkOrderValidation = (message: string) => {
      setWorkOrderFormError(true)

      setWorkOrderFormErrorMessage(message)
    }

    if (!workOrderForm.car) {
      failWorkOrderValidation(`${strings.WORK_ORDER_REQUIRED_FIELD}${strings.VEHICLE}`)

      return
    }

    if (!workOrderForm.title.trim()) {
      failWorkOrderValidation(`${strings.WORK_ORDER_REQUIRED_FIELD}${strings.WORK_ORDER_TITLE}`)

      return
    }

    if (!workOrderForm.scheduledStart || !workOrderForm.scheduledEnd) {
      failWorkOrderValidation(`${strings.WORK_ORDER_REQUIRED_FIELD}${strings.START}`)

      return
    }

    if (new Date(`${workOrderForm.scheduledStart}T12:00:00`) >= new Date(`${workOrderForm.scheduledEnd}T12:00:00`)) {
      failWorkOrderValidation(`${strings.WORK_ORDER_INVALID_FIELD}${strings.END}`)

      return
    }

    if (odometer !== undefined && (!Number.isFinite(odometer) || odometer < 0)) {
      failWorkOrderValidation(`${strings.WORK_ORDER_INVALID_FIELD}${strings.MILEAGE}`)

      return
    }

    setWorkOrderSaving(true)

    setWorkOrderFormError(false)

    const payload: bookcarsTypes.UpsertMaintenanceWorkOrderPayload = {

      car: workOrderForm.car,

      title: workOrderForm.title.trim(),

      type: workOrderForm.type,

      status: workOrderForm.status,

      scheduledStart: new Date(`${workOrderForm.scheduledStart}T12:00:00`),

      scheduledEnd: new Date(`${workOrderForm.scheduledEnd}T12:00:00`),

      odometer,

      vendor: workOrderForm.vendor.trim(),

      note: workOrderForm.note.trim(),

    }

    try {
      if (selectedWorkOrder?._id) {
        await MaintenanceWorkOrderService.update(selectedWorkOrder._id, payload)
      } else {
        await MaintenanceWorkOrderService.create(payload)
      }

      // Re-list: the totals (expenseTotal / expenseCount) are computed
      // server-side on list, so the row is refreshed from the server.
      setWorkOrders(await MaintenanceWorkOrderService.list())

      setWorkOrderDialogOpen(false)
    } catch (error) {
      const detail = apiErrorMessage(error)

      helper.error(error, detail || undefined)

      setWorkOrderFormError(true)

      setWorkOrderFormErrorMessage(detail)
    } finally {
      setWorkOrderSaving(false)
    }
  }


  const handleWorkOrderDelete = async () => {
    if (!workOrderDeleteTarget?._id) {
return
}

    try {
      await MaintenanceWorkOrderService.remove(workOrderDeleteTarget._id)

      setWorkOrders((rows) => rows.filter((row) => row._id !== workOrderDeleteTarget._id))

      setWorkOrderDeleteTarget(null)
    } catch (error) {
      helper.error(error)
    }
  }


  const paymentMethodLabel = (method: bookcarsTypes.RentalPaymentMethod) => {
    switch (method) {
      case bookcarsTypes.RentalPaymentMethod.BankTransfer: return strings.BANK_TRANSFER

      case bookcarsTypes.RentalPaymentMethod.Card: return strings.CARD

      case bookcarsTypes.RentalPaymentMethod.Other: return strings.OTHER

      default: return strings.CASH
    }
  }


  const openPayment = (expense: bookcarsTypes.MaintenanceExpense) => {
    setPaymentTarget(expense)

    setPaymentForm(emptyPaymentForm())

    setPaymentError(false)

    setPaymentErrorMessage('')
  }


  const handlePaymentSave = async () => {
    if (!paymentTarget?._id) {
return
}

    const amount = Number(paymentForm.amount)

    if (!paymentForm.date || !Number.isFinite(amount) || amount <= 0) {
      setPaymentError(true)

      return
    }

    setPaymentSaving(true)

    setPaymentError(false)

    try {
      const { expense } = await MaintenanceExpenseService.recordPayment(paymentTarget._id, {

        date: new Date(`${paymentForm.date}T12:00:00`),

        amount,

        method: paymentForm.method,

        reference: paymentForm.reference.trim() || undefined,

        note: paymentForm.note.trim() || undefined,

      })

      setExpenses((rows) => rows.map((row) => row._id === paymentTarget._id ? expense : row))

      setPaymentTarget(null)
    } catch (error) {
      const detail = apiErrorMessage(error)

      helper.error(error, detail || undefined)

      setPaymentError(true)

      setPaymentErrorMessage(detail)
    } finally {
      setPaymentSaving(false)
    }
  }


  const openHistory = async (expense: bookcarsTypes.MaintenanceExpense) => {
    setHistoryTarget(expense)

    setHistoryRows([])

    setHistoryLoading(true)

    try {
      setHistoryRows(await MaintenanceExpenseService.listAudit(expense._id || ''))
    } catch (error) {
      helper.error(error)
    } finally {
      setHistoryLoading(false)
    }
  }


  const auditActionLabel = (action: bookcarsTypes.MaintenanceExpenseAuditAction) => {
    switch (action) {
      case bookcarsTypes.MaintenanceExpenseAuditAction.Updated: return strings.AUDIT_UPDATED

      case bookcarsTypes.MaintenanceExpenseAuditAction.Deleted: return strings.AUDIT_DELETED

      default: return strings.AUDIT_CREATED
    }
  }


  const setField = (key: keyof ExpenseForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }))
  }

  // GAP-MAINT-P0-2 — open work orders for the car of the schedule
  // being completed, offered as the optional linked work order.
  const completeCarId = completeTarget ? (typeof completeTarget.car === 'string' ? completeTarget.car : completeTarget.car?._id || '') : ''
  const completeWorkOrders = completeTarget ? workOrders.filter((workOrder) => {
    const carId = typeof workOrder.car === 'string' ? workOrder.car : workOrder.car?._id || ''
    return carId === completeCarId && workOrder.status !== bookcarsTypes.WorkOrderStatus.Completed && workOrder.status !== bookcarsTypes.WorkOrderStatus.Cancelled
  }) : []


  return (

    <Layout strict onLoad={onLoad}>

      {maintenanceDenied ? <AccessDenied /> : (

      <div className="agency-maintenance">

        <div className="agency-maintenance__heading">

          <div>

            <Typography component="p" className="agency-maintenance__eyebrow">{strings.EYEBROW}</Typography>

            <Typography component="h1" className="agency-maintenance__title">{strings.TITLE}<HelpIcon text={strings.HELP_EXPENSE_FORM} /></Typography>

            <Typography className="agency-maintenance__subtitle">{strings.SUBTITLE}</Typography>

          </div>

          <Button variant="contained" startIcon={<AddRoundedIcon />} className="agency-maintenance__action" onClick={openNew} disabled={!canManageExpenses}>

            {strings.ADD}

          </Button>

        </div>


        {loadError && <Alert severity="error" className="agency-maintenance__alert">{strings.LOAD_ERROR}</Alert>}


        <div className="agency-maintenance__summary">

          <Card><CardContent><span className="agency-maintenance__summary-icon"><BuildRoundedIcon /></span><small>{strings.TOTAL}</small><strong>{loading ? '—' : formatAmount(total)}</strong></CardContent></Card>

          <Card><CardContent><span className="agency-maintenance__summary-icon agency-maintenance__summary-icon--blue">{strings.TYPE.slice(0, 1)}</span><small>{strings.RECORDS}</small><strong>{loading ? '—' : expenses.length}</strong></CardContent></Card>

          <Card><CardContent><span className="agency-maintenance__summary-icon">{strings.SCHEDULES.slice(0, 1)}</span><small>{strings.SCHEDULES}</small><strong>{loading ? '—' : schedules.length}</strong></CardContent></Card>

        </div>


        <section className="agency-maintenance__panel">

          <div className="agency-maintenance__toolbar">

            <TextField size="small" placeholder={strings.SEARCH} slotProps={{ htmlInput: { 'aria-label': strings.SEARCH } }} value={keyword} onChange={(event) => setKeyword(event.target.value)} />

            <TextField size="small" select label={strings.TYPE} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>

              <MenuItem value="">{strings.ALL_TYPES}</MenuItem>

              {Object.values(bookcarsTypes.MaintenanceExpenseType).map((type) => <MenuItem value={type} key={type}>{typeLabel(type)}</MenuItem>)}

            </TextField>

            <TextField size="small" select label={strings.CATEGORY} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>

              <MenuItem value="">{strings.ALL_CATEGORIES}</MenuItem>

              <MenuItem value="none">{strings.NO_CATEGORY}</MenuItem>

              {categories.filter((category) => category.active).map((category) => <MenuItem value={category._id} key={category._id}>{category.name}</MenuItem>)}

            </TextField>

          </div>

          <div className="agency-maintenance__table-head">

            <span>{strings.DATE}</span><span>{strings.TYPE}</span><span>{strings.VEHICLE}</span><span>{strings.AMOUNT}</span><span>{strings.MILEAGE}</span><span>{strings.VENDOR}</span><span>{strings.ACTIONS}</span>

          </div>

          {loading ? (

            <div className="agency-maintenance__empty">…</div>

          ) : filtered.length === 0 ? (

            <div className="agency-maintenance__empty"><BuildRoundedIcon /><p>{strings.EMPTY}</p></div>

          ) : filtered.map((expense) => (

            <div className="agency-maintenance__row" key={expense._id}>

              <span className="agency-maintenance__date">{formatDate(expense.date)}</span>

              <span><span className="agency-maintenance__type">{typeLabel(expense.type)}</span>{expense.category && <span className="agency-maintenance__type">{typeof expense.category === 'string' ? (categories.find((category) => category._id === expense.category)?.name || strings.NO_CATEGORY) : expense.category.name}</span>}</span>

              <strong className="agency-maintenance__vehicle">{carName(expense)}</strong>

              <span><strong>{formatAmount(expense.amount)}</strong>{' '}<span className="agency-maintenance__type">{paymentStatusLabel(paymentStatusOf(expense))}</span></span>

              <span>{expense.mileage ? `${new Intl.NumberFormat(uiLocale()).format(expense.mileage)} km` : '—'}</span>

              <span>{expense.vendor || expense.note || '—'}</span>

              {canManageExpenses && <span className="agency-maintenance__actions">

                <Button size="small" aria-label={strings.RECORD_PAYMENT} onClick={() => openPayment(expense)}>{strings.RECORD_PAYMENT}</Button>

                <Button size="small" aria-label={strings.HISTORY} onClick={() => openHistory(expense)}>{strings.HISTORY}</Button>

                <Button size="small" aria-label={strings.EDIT} onClick={() => openEdit(expense)}><EditRoundedIcon /></Button>

                <Button size="small" color="error" aria-label={strings.DELETE} onClick={() => { setDeleteTarget(expense); setDeleteReason(''); setDeleteError(false) }}><DeleteOutlineRoundedIcon /></Button>

              </span>}

            </div>

          ))}

        </section>

        <section className="agency-maintenance__panel" aria-label={strings.SCHEDULES}>

          <div className="agency-maintenance__section-heading">

            <Typography component="h2">{strings.SCHEDULES}</Typography>

            <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={openScheduleNew} disabled={cars.length === 0 || !canManageExpenses}>{strings.ADD_SCHEDULE}</Button>

          </div>

          {schedules.length === 0 ? <div className="agency-maintenance__empty">{strings.NO_SCHEDULES}</div> : schedules.map((schedule) => <div className="agency-maintenance__schedule-row" key={schedule._id}><div><strong>{schedule.title}</strong><span>{!schedule.car || typeof schedule.car === 'string' ? '—' : schedule.car.name || '—'}</span></div><span>{schedule.nextDueDate ? formatDate(schedule.nextDueDate) : '—'}</span><span className={`agency-maintenance__status agency-maintenance__status--${schedule.status}`}>{scheduleStatusLabel(schedule.status)}</span>{canManageExpenses && <span className="agency-maintenance__actions"><Button size="small" aria-label={strings.EDIT} onClick={() => openScheduleEdit(schedule)}><EditRoundedIcon /></Button>{schedule.status !== bookcarsTypes.MaintenanceScheduleStatus.Completed && (<Button size="small" onClick={() => openCompleteService(schedule)}>{strings.COMPLETE_SERVICE}</Button>)}<Button size="small" color="error" aria-label={strings.DELETE} onClick={() => setScheduleDeleteTarget(schedule)}><DeleteOutlineRoundedIcon /></Button></span>}</div>)}

        </section>

        <section className="agency-maintenance__panel" aria-label={strings.WORK_ORDERS}>

          <div className="agency-maintenance__section-heading">

            <Typography component="h2">{strings.WORK_ORDERS}</Typography>

            <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={openWorkOrderNew} disabled={cars.length === 0 || !canManageExpenses}>{strings.ADD_WORK_ORDER}</Button>

          </div>

          {workOrders.length === 0 ? <div className="agency-maintenance__empty">{strings.NO_WORK_ORDERS}</div> : workOrders.map((workOrder) => <div className="agency-maintenance__schedule-row" key={workOrder._id}><div><strong>{workOrder.title}</strong><span>{workOrderCarName(workOrder)}</span></div><span>{formatDate(workOrder.scheduledStart)} → {formatDate(workOrder.scheduledEnd)}</span><span className={`agency-maintenance__status agency-maintenance__status--${workOrder.status}`}>{workOrderStatusLabel(workOrder.status)}</span><span>{strings.LINKED_EXPENSES}: {workOrder.expenseCount || 0} · {formatAmount(workOrder.expenseTotal || 0)}</span>{canManageExpenses && <span className="agency-maintenance__actions"><Button size="small" aria-label={strings.EDIT} onClick={() => openWorkOrderEdit(workOrder)}><EditRoundedIcon /></Button><Button size="small" color="error" aria-label={strings.DELETE} onClick={() => setWorkOrderDeleteTarget(workOrder)}><DeleteOutlineRoundedIcon /></Button></span>}</div>)}

        </section>

        <section className="agency-maintenance__panel" aria-label={strings.CATEGORIES}>

          <div className="agency-maintenance__section-heading">

            <Typography component="h2">{strings.CATEGORIES}<HelpIcon text={strings.HELP_CATEGORY} /></Typography>

            <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={openCategoryNew} disabled={!canManageExpenses}>{strings.ADD_CATEGORY}</Button>

          </div>

          {categories.length === 0 ? <div className="agency-maintenance__empty">{strings.NO_CATEGORIES}</div> : categories.map((category) => <div className="agency-maintenance__schedule-row" key={category._id} style={{ opacity: category.active ? 1 : 0.5 }}><div><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: category.color || '#9e9e9e', marginRight: 8 }} /><strong>{category.name}</strong></div>{canManageExpenses && <span className="agency-maintenance__actions"><Button size="small" aria-label={strings.EDIT} onClick={() => openCategoryEdit(category)}><EditRoundedIcon /></Button><Button size="small" color="error" aria-label={strings.DELETE} onClick={() => setCategoryDeleteTarget(category)}><DeleteOutlineRoundedIcon /></Button></span>}</div>)}

        </section>

        <section className="agency-maintenance__panel" aria-label={strings.CATEGORY_REPORT}>

          <div className="agency-maintenance__section-heading"><Typography component="h2">{strings.CATEGORY_REPORT}</Typography><strong>{report ? formatAmount(report.total) : '—'}</strong></div>

          {report?.categories.length ? report.categories.map((row) => <div className="agency-maintenance__report-row" key={row.category}><span>{typeLabel(row.category as bookcarsTypes.MaintenanceExpenseType)}</span><span>{row.count} · {row.receipts} {strings.RECEIPTS} · {strings.PAID} {formatAmount(row.paidTotal ?? 0)}{row.untracked ? ` (${row.untracked} ${strings.UNPAID})` : ''}</span><strong>{formatAmount(row.total)}</strong></div>) : <div className="agency-maintenance__empty">{strings.NO_REPORT}</div>}
          {report?.byCategory?.length ? (<><div className="agency-maintenance__section-heading"><Typography component="h3">{strings.BY_CATEGORY}<HelpIcon text={strings.HELP_REPORT} /></Typography></div>{report.byCategory.map((row) => <div className="agency-maintenance__report-row" key={row.category || 'none'}><span>{row.name || strings.UNCATEGORISED}</span><span>{row.count} - {row.receipts} {strings.RECEIPTS} - {strings.PAID} {formatAmount(row.paidTotal ?? 0)}{row.untracked ? ` (${row.untracked} ${strings.UNPAID})` : ''}</span><strong>{formatAmount(row.total)}</strong></div>)}</>) : null}

        </section>

      </div>

      )}


      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">

        <DialogTitle>{selected ? strings.EDIT : strings.NEW}</DialogTitle>

        <DialogContent className="agency-maintenance__form">

          {formError && <Alert severity="error">{formErrorMessage || strings.SAVE_ERROR}</Alert>}

          <TextField select fullWidth label={strings.VEHICLE} value={form.car} onChange={setField('car')}>

            <MenuItem value="">{strings.GENERAL_EXPENSE}</MenuItem>

            {cars.map((car) => <MenuItem value={car._id} key={car._id}>{car.name}{car.licensePlate ? ` · ${car.licensePlate}` : ''}</MenuItem>)}

          </TextField>

          <div className="agency-maintenance__form-grid">

            <TextField select fullWidth required label={strings.TYPE} value={form.type} onChange={setField('type')}>

              {Object.values(bookcarsTypes.MaintenanceExpenseType).map((type) => <MenuItem value={type} key={type}>{typeLabel(type)}</MenuItem>)}

            </TextField>

            <TextField fullWidth required type="date" label={strings.DATE} value={form.date} onChange={setField('date')} InputLabelProps={{ shrink: true }} />

            <TextField fullWidth required type="number" label={strings.AMOUNT} value={form.amount} onChange={setField('amount')} inputProps={{ min: 0.01, step: 0.01 }} />

            <TextField select fullWidth label={strings.CATEGORY} value={form.category} onChange={setField('category')}>

              <MenuItem value="">{strings.NO_CATEGORY}</MenuItem>

              {categories.filter((category) => category.active).map((category) => <MenuItem value={category._id} key={category._id}>{category.name}</MenuItem>)}

            </TextField>

            <TextField select fullWidth label={strings.WORK_ORDER} value={form.workOrder} onChange={setField('workOrder')}>

              <MenuItem value="">—</MenuItem>

              {workOrders.filter((workOrder) => !form.car || (typeof workOrder.car === 'string' ? workOrder.car === form.car : workOrder.car?._id === form.car)).map((workOrder) => <MenuItem value={workOrder._id} key={workOrder._id}>{workOrder.title}</MenuItem>)}

            </TextField>

            {selected && <Typography variant="body2">{strings.PAYMENT_STATUS}: {paymentStatusLabel(paymentStatusOf(selected))} · {strings.PAID}: {formatAmount(selected.paidAmount ?? 0)}</Typography>}

            <TextField fullWidth type="number" label={strings.MILEAGE} value={form.mileage} onChange={setField('mileage')} inputProps={{ min: 0, step: 1 }} />

          </div>

          <TextField fullWidth label={strings.VENDOR} value={form.vendor} onChange={setField('vendor')} inputProps={{ maxLength: 160 }} />

          <input aria-label={strings.RECEIPT} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} />

          <TextField fullWidth multiline minRows={3} label={strings.NOTE} value={form.note} onChange={setField('note')} inputProps={{ maxLength: 1000 }} />

          {selected && <TextField fullWidth label={strings.UPDATE_REASON} value={form.reason} onChange={setField('reason')} inputProps={{ maxLength: 1000 }} />}

        </DialogContent>

        <DialogActions>

          <Button onClick={() => setDialogOpen(false)} disabled={saving}>{strings.CANCEL}</Button>

          <Button variant="contained" onClick={handleSave} disabled={saving}>{strings.SAVE}</Button>

        </DialogActions>

      </Dialog>


      <Dialog open={categoryDialogOpen} onClose={() => !categorySaving && setCategoryDialogOpen(false)} fullWidth maxWidth="xs">

        <DialogTitle>{selectedCategory ? strings.EDIT_CATEGORY : strings.NEW_CATEGORY}</DialogTitle>

        <DialogContent className="agency-maintenance__form">

          {categoryFormError && <Alert severity="error">{categoryFormErrorMessage || strings.CATEGORY_SAVE_ERROR}</Alert>}

          {isAdmin && (
            <TextField select fullWidth required label={strings.AGENCY} value={adminSupplier} onChange={(event) => setAdminSupplier(event.target.value)}>

              {suppliers.map((supplier) => <MenuItem value={supplier._id} key={supplier._id}>{supplier.fullName || supplier.email}</MenuItem>)}

            </TextField>
          )}

          <TextField fullWidth required label={strings.CATEGORY_NAME} value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} inputProps={{ maxLength: 100 }} />

          <TextField fullWidth label={strings.CATEGORY_COLOR} value={categoryForm.color} onChange={(event) => setCategoryForm((current) => ({ ...current, color: event.target.value }))} inputProps={{ maxLength: 7 }} placeholder="#2e7d32" />

          {selectedCategory && <FormControlLabel control={<Checkbox checked={categoryForm.active} onChange={(event) => setCategoryForm((current) => ({ ...current, active: event.target.checked }))} />} label={strings.ACTIVE} />}

        </DialogContent>

        <DialogActions>

          <Button onClick={() => setCategoryDialogOpen(false)} disabled={categorySaving}>{strings.CANCEL}</Button>

          <Button variant="contained" onClick={handleCategorySave} disabled={categorySaving}>{strings.SAVE}</Button>

        </DialogActions>

      </Dialog>


      <Dialog open={!!categoryDeleteTarget} onClose={() => setCategoryDeleteTarget(null)} maxWidth="xs" fullWidth>

        <DialogTitle>{strings.DELETE}</DialogTitle>

        <DialogContent>{strings.DELETE_CATEGORY_CONFIRM}</DialogContent>

        <DialogActions>

          <Button onClick={() => setCategoryDeleteTarget(null)}>{strings.CANCEL}</Button>

          <Button color="error" variant="contained" onClick={handleCategoryDelete}>{strings.DELETE}</Button>

        </DialogActions>

      </Dialog>


      <Dialog open={scheduleDialogOpen} onClose={() => !scheduleSaving && setScheduleDialogOpen(false)} fullWidth maxWidth="sm">

        <DialogTitle>{selectedSchedule ? strings.EDIT_SCHEDULE : strings.NEW_SCHEDULE}</DialogTitle>

        <DialogContent className="agency-maintenance__form">

          {scheduleFormError && <Alert severity="error">{scheduleFormErrorMessage || strings.SCHEDULE_SAVE_ERROR}</Alert>}

          <TextField select fullWidth required label={strings.VEHICLE} value={scheduleForm.car} onChange={(event) => setScheduleForm((current) => ({ ...current, car: event.target.value }))}>

            {cars.map((car) => <MenuItem value={car._id} key={car._id}>{car.name}{car.licensePlate ? ` · ${car.licensePlate}` : ''}</MenuItem>)}

          </TextField>

          <TextField fullWidth required label={strings.SCHEDULE_TITLE} value={scheduleForm.title} onChange={(event) => setScheduleForm((current) => ({ ...current, title: event.target.value }))} inputProps={{ maxLength: 200 }} />

          <div className="agency-maintenance__form-grid">

            <TextField select fullWidth required label={strings.TYPE} value={scheduleForm.type} onChange={(event) => setScheduleForm((current) => ({ ...current, type: event.target.value as bookcarsTypes.MaintenanceExpenseType }))}>{Object.values(bookcarsTypes.MaintenanceExpenseType).map((type) => <MenuItem value={type} key={type}>{typeLabel(type)}</MenuItem>)}</TextField>

            <TextField select fullWidth label={strings.CATEGORY} value={scheduleForm.category} onChange={(event) => setScheduleForm((current) => ({ ...current, category: event.target.value }))}>

              <MenuItem value="">{strings.NO_CATEGORY}</MenuItem>

              {categories.filter((category) => category.active).map((category) => <MenuItem value={category._id} key={category._id}>{category.name}</MenuItem>)}

            </TextField>

            <TextField fullWidth required={!scheduleForm.intervalKm} type="date" label={strings.NEXT_DUE} value={scheduleForm.nextDueDate} onChange={(event) => setScheduleForm((current) => ({ ...current, nextDueDate: event.target.value }))} InputLabelProps={{ shrink: true }} />

            <TextField fullWidth type="number" label={strings.INTERVAL_DAYS} value={scheduleForm.intervalDays} onChange={(event) => setScheduleForm((current) => ({ ...current, intervalDays: event.target.value }))} inputProps={{ min: 1, step: 1 }} />

            <TextField fullWidth type="number" label={strings.INTERVAL_KM} value={scheduleForm.intervalKm} onChange={(event) => setScheduleForm((current) => ({ ...current, intervalKm: event.target.value }))} inputProps={{ min: 1, step: 1 }} />

            <TextField fullWidth type="number" label={strings.NEXT_MILEAGE} value={scheduleForm.nextDueMileage} onChange={(event) => setScheduleForm((current) => ({ ...current, nextDueMileage: event.target.value }))} inputProps={{ min: 0, step: 1 }} />

            <div>

              <Typography variant="body2">{`${strings.STATUS}: ${scheduleStatusLabel(derivedScheduleStatus(scheduleForm.status, scheduleForm.nextDueDate))}`}</Typography>

              <Typography variant="caption" color="textSecondary">{strings.STATUS_DERIVED_HINT}</Typography>

              <FormControlLabel control={<Checkbox checked={scheduleForm.status === bookcarsTypes.MaintenanceScheduleStatus.Completed} onChange={(event) => setScheduleForm((current) => ({ ...current, status: event.target.checked ? bookcarsTypes.MaintenanceScheduleStatus.Completed : bookcarsTypes.MaintenanceScheduleStatus.Upcoming }))} />} label={strings.COMPLETED} />

            </div>

          </div>

          <TextField fullWidth multiline minRows={3} label={strings.NOTE} value={scheduleForm.note} onChange={(event) => setScheduleForm((current) => ({ ...current, note: event.target.value }))} inputProps={{ maxLength: 1000 }} />

        </DialogContent>

        <DialogActions><Button onClick={() => setScheduleDialogOpen(false)} disabled={scheduleSaving}>{strings.CANCEL}</Button><Button variant="contained" onClick={handleScheduleSave} disabled={scheduleSaving || cars.length === 0}>{strings.SAVE_SCHEDULE}</Button></DialogActions>

      </Dialog>


      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>

        <DialogTitle>{strings.DELETE}</DialogTitle>

        <DialogContent>

          <Typography>{strings.DELETE_CONFIRM}</Typography>

          <TextField fullWidth required label={strings.DELETE_REASON} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} error={deleteError} helperText={deleteError ? strings.DELETE_REASON_REQUIRED : ''} inputProps={{ maxLength: 1000 }} sx={{ mt: 2 }} />

        </DialogContent>

        <DialogActions>

          <Button onClick={() => setDeleteTarget(null)}>{strings.CANCEL}</Button>

          <Button color="error" variant="contained" onClick={handleDelete}>{strings.DELETE}</Button>

        </DialogActions>

      </Dialog>


      <Dialog open={!!scheduleDeleteTarget} onClose={() => setScheduleDeleteTarget(null)} maxWidth="xs" fullWidth>

        <DialogTitle>{strings.DELETE}</DialogTitle>

        <DialogContent>{strings.DELETE_SCHEDULE_CONFIRM}</DialogContent>

        <DialogActions>

          <Button onClick={() => setScheduleDeleteTarget(null)}>{strings.CANCEL}</Button>

          <Button color="error" variant="contained" onClick={handleScheduleDelete}>{strings.DELETE}</Button>

        </DialogActions>

      </Dialog>


      <Dialog open={completeTarget !== null} onClose={() => !completeSaving && setCompleteTarget(null)} fullWidth maxWidth="sm">

        <DialogTitle>{strings.COMPLETE_SERVICE}</DialogTitle>

        <DialogContent className="agency-maintenance__form">

          {completeError && <Alert severity="error">{completeErrorMessage || strings.COMPLETE_SERVICE_ERROR}</Alert>}

          <TextField fullWidth required type="date" label={strings.SERVICE_DATE} value={completeForm.serviceDate} onChange={(event) => setCompleteForm((current) => ({ ...current, serviceDate: event.target.value }))} InputLabelProps={{ shrink: true }} />

          <TextField fullWidth required={!!completeTarget?.intervalKm} type="number" label={strings.MILEAGE} value={completeForm.odometerKm} onChange={(event) => setCompleteForm((current) => ({ ...current, odometerKm: event.target.value }))} inputProps={{ min: 0, step: 1 }} />

          <TextField select fullWidth label={strings.WORK_ORDER} value={completeForm.workOrderId} onChange={(event) => setCompleteForm((current) => ({ ...current, workOrderId: event.target.value }))}>

            <MenuItem value="">—</MenuItem>

            {completeWorkOrders.map((workOrder) => <MenuItem value={workOrder._id} key={workOrder._id}>{workOrder.title}</MenuItem>)}

          </TextField>

          <TextField fullWidth multiline minRows={3} label={strings.NOTE} value={completeForm.note} onChange={(event) => setCompleteForm((current) => ({ ...current, note: event.target.value }))} inputProps={{ maxLength: 1000 }} />

        </DialogContent>

        <DialogActions><Button onClick={() => setCompleteTarget(null)} disabled={completeSaving}>{strings.CANCEL}</Button><Button variant="contained" onClick={handleCompleteService} disabled={completeSaving}>{strings.COMPLETE_SERVICE}</Button></DialogActions>

      </Dialog>


      <Dialog open={workOrderDialogOpen} onClose={() => !workOrderSaving && setWorkOrderDialogOpen(false)} fullWidth maxWidth="sm">

        <DialogTitle>{selectedWorkOrder ? strings.EDIT_WORK_ORDER : strings.NEW_WORK_ORDER}</DialogTitle>

        <DialogContent className="agency-maintenance__form">

          {workOrderFormError && <Alert severity="error">{workOrderFormErrorMessage || strings.WORK_ORDER_SAVE_ERROR}</Alert>}

          <TextField select fullWidth required label={strings.VEHICLE} value={workOrderForm.car} onChange={(event) => setWorkOrderForm((current) => ({ ...current, car: event.target.value }))}>

            {cars.map((car) => <MenuItem value={car._id} key={car._id}>{car.name}{car.licensePlate ? ` · ${car.licensePlate}` : ''}</MenuItem>)}

          </TextField>

          <TextField fullWidth required label={strings.WORK_ORDER_TITLE} value={workOrderForm.title} onChange={(event) => setWorkOrderForm((current) => ({ ...current, title: event.target.value }))} inputProps={{ maxLength: 200 }} />

          <div className="agency-maintenance__form-grid">

            <TextField select fullWidth required label={strings.TYPE} value={workOrderForm.type} onChange={(event) => setWorkOrderForm((current) => ({ ...current, type: event.target.value as bookcarsTypes.MaintenanceExpenseType }))}>{Object.values(bookcarsTypes.MaintenanceExpenseType).map((type) => <MenuItem value={type} key={type}>{typeLabel(type)}</MenuItem>)}</TextField>

            <TextField select fullWidth required label={strings.STATUS} value={workOrderForm.status} onChange={(event) => setWorkOrderForm((current) => ({ ...current, status: event.target.value as bookcarsTypes.WorkOrderStatus }))}>

              <MenuItem value={bookcarsTypes.WorkOrderStatus.Scheduled}>{strings.WO_SCHEDULED}</MenuItem>

              <MenuItem value={bookcarsTypes.WorkOrderStatus.InProgress}>{strings.WO_IN_PROGRESS}</MenuItem>

              <MenuItem value={bookcarsTypes.WorkOrderStatus.Completed}>{strings.COMPLETED}</MenuItem>

              <MenuItem value={bookcarsTypes.WorkOrderStatus.Cancelled}>{strings.WO_CANCELLED}</MenuItem>

            </TextField>

            <TextField fullWidth required type="date" label={strings.START} value={workOrderForm.scheduledStart} onChange={(event) => setWorkOrderForm((current) => ({ ...current, scheduledStart: event.target.value }))} InputLabelProps={{ shrink: true }} />

            <TextField fullWidth required type="date" label={strings.END} value={workOrderForm.scheduledEnd} onChange={(event) => setWorkOrderForm((current) => ({ ...current, scheduledEnd: event.target.value }))} InputLabelProps={{ shrink: true }} />

            <TextField fullWidth type="number" label={strings.MILEAGE} value={workOrderForm.odometer} onChange={(event) => setWorkOrderForm((current) => ({ ...current, odometer: event.target.value }))} inputProps={{ min: 0, step: 1 }} />

          </div>

          <TextField fullWidth label={strings.VENDOR} value={workOrderForm.vendor} onChange={(event) => setWorkOrderForm((current) => ({ ...current, vendor: event.target.value }))} inputProps={{ maxLength: 160 }} />

          <TextField fullWidth multiline minRows={3} label={strings.NOTE} value={workOrderForm.note} onChange={(event) => setWorkOrderForm((current) => ({ ...current, note: event.target.value }))} inputProps={{ maxLength: 1000 }} />

        </DialogContent>

        <DialogActions><Button onClick={() => setWorkOrderDialogOpen(false)} disabled={workOrderSaving}>{strings.CANCEL}</Button><Button variant="contained" onClick={handleWorkOrderSave} disabled={workOrderSaving || cars.length === 0}>{strings.SAVE_WORK_ORDER}</Button></DialogActions>

      </Dialog>


      <Dialog open={!!workOrderDeleteTarget} onClose={() => setWorkOrderDeleteTarget(null)} maxWidth="xs" fullWidth>

        <DialogTitle>{strings.DELETE}</DialogTitle>

        <DialogContent>{strings.DELETE_WORK_ORDER_CONFIRM}</DialogContent>

        <DialogActions>

          <Button onClick={() => setWorkOrderDeleteTarget(null)}>{strings.CANCEL}</Button>

          <Button color="error" variant="contained" onClick={handleWorkOrderDelete}>{strings.DELETE}</Button>

        </DialogActions>

      </Dialog>


      <Dialog open={!!paymentTarget} onClose={() => !paymentSaving && setPaymentTarget(null)} fullWidth maxWidth="sm">

        <DialogTitle>{strings.RECORD_PAYMENT}</DialogTitle>

        <DialogContent className="agency-maintenance__form">

          {paymentError && <Alert severity="error">{paymentErrorMessage || strings.PAYMENT_SAVE_ERROR}</Alert>}

          <div className="agency-maintenance__form-grid">

            <TextField fullWidth required type="date" label={strings.DATE} value={paymentForm.date} onChange={(event) => setPaymentForm((current) => ({ ...current, date: event.target.value }))} InputLabelProps={{ shrink: true }} />

            <TextField fullWidth required type="number" label={strings.AMOUNT} value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} inputProps={{ min: 0.01, step: 0.01 }} />

            <TextField select fullWidth required label={strings.PAYMENT_METHOD} value={paymentForm.method} onChange={(event) => setPaymentForm((current) => ({ ...current, method: event.target.value as bookcarsTypes.RentalPaymentMethod }))}>

              <MenuItem value={bookcarsTypes.RentalPaymentMethod.Cash}>{strings.CASH}</MenuItem>

              <MenuItem value={bookcarsTypes.RentalPaymentMethod.BankTransfer}>{strings.BANK_TRANSFER}</MenuItem>

              <MenuItem value={bookcarsTypes.RentalPaymentMethod.Card}>{strings.CARD}</MenuItem>

              <MenuItem value={bookcarsTypes.RentalPaymentMethod.Other}>{strings.OTHER}</MenuItem>

            </TextField>

            <TextField fullWidth label={strings.PAYMENT_REFERENCE} value={paymentForm.reference} onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))} inputProps={{ maxLength: 160 }} />

          </div>

          <TextField fullWidth multiline minRows={3} label={strings.NOTE} value={paymentForm.note} onChange={(event) => setPaymentForm((current) => ({ ...current, note: event.target.value }))} inputProps={{ maxLength: 1000 }} />

        </DialogContent>

        <DialogActions><Button onClick={() => setPaymentTarget(null)} disabled={paymentSaving}>{strings.CANCEL}</Button><Button variant="contained" onClick={handlePaymentSave} disabled={paymentSaving}>{strings.SAVE}</Button></DialogActions>

      </Dialog>


      <Dialog open={!!historyTarget} onClose={() => setHistoryTarget(null)} fullWidth maxWidth="sm">

        <DialogTitle>{strings.HISTORY}</DialogTitle>

        <DialogContent>

          {historyLoading ? <div className="agency-maintenance__empty">…</div> : historyRows.length === 0 ? <div className="agency-maintenance__empty">{strings.NO_HISTORY}</div> : historyRows.map((row) => (

            <div key={row._id} className="agency-maintenance__report-row">

              <span>{auditActionLabel(row.action)} · {row.createdAt ? formatDate(new Date(row.createdAt)) : '—'}</span>

              <span>{row.actor && typeof row.actor === 'object' ? row.actor.fullName : ''}{row.reason ? ` — ${row.reason}` : ''}</span>

              <span>{row.changes?.length ? `${strings.CHANGES}: ${row.changes.map((change) => `${change.field}: ${change.before ?? '—'} → ${change.after ?? '—'}`).join('; ')}` : ''}</span>

            </div>

          ))}

        </DialogContent>

        <DialogActions><Button onClick={() => setHistoryTarget(null)}>{strings.CANCEL}</Button></DialogActions>

      </Dialog>

    </Layout>

  )
}


export default Maintenance

