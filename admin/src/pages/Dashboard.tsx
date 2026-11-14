import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import DirectionsCarRoundedIcon from '@mui/icons-material/DirectionsCarRounded'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import KeyRoundedIcon from '@mui/icons-material/KeyRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import * as bookcarsTypes from ':bookcars-types'
import { Booking, BookingStatus, Car, User } from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import Layout from '@/components/Layout'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import * as BookingService from '@/services/BookingService'
import * as CarService from '@/services/CarService'
import * as CashService from '@/services/CashService'
import * as MaintenanceScheduleService from '@/services/MaintenanceScheduleService'
import * as RentalPaymentService from '@/services/RentalPaymentService'
import * as ReportService from '@/services/ReportService'
import * as SupplierService from '@/services/SupplierService'
import * as UserService from '@/services/UserService'
import env from '@/config/env.config'
import * as helper from '@/utils/helper'
import { strings } from '@/lang/dashboard'

import '@/assets/css/dashboard.css'

/*
 * GA-PAR-09 — dashboard parity (Phase A: client-side composition only, no
 * new backend endpoint). Every block loads and fails independently.
 *
 * Semantics (coordinator decisions, do not silently change):
 * - Period amounts use whole-contract attribution: a contract counts in
 *   full in every period its [from,to] overlaps. No prorating.
 * - Collected / remaining use posted-only contractReceivable semantics:
 *   only RentalPayments with status posted (or legacy status-less),
 *   purpose rent (or legacy purpose-less), direction debit negative.
 *   Deposit-purpose payments are NEVER counted. Remaining per contract =
 *   max(0, rentalTotal - postedRent). Approved contract charges are not
 *   present in any list payload Phase A consumes, so they cannot be
 *   included here (see the PAR-09 builder report).
 * - Bookings/cars are fetched at a 1,000-row page; a full page sets a
 *   partial-data flag shown on every card derived from that source.
 *   Payments / cash / schedules list endpoints are unpaged.
 * - GA-PAR-14 (Phase B): for agency users the period-KPI amounts and
 *   the period-contracts count come from GET /api/dashboard/summary
 *   (server-side aggregate, dictionary v2026-11-11.1 — contractAmount
 *   INCLUDES approved contract charges, exact at any scale, no fetch
 *   cap). If that endpoint errors, those two cards show their own
 *   inline error state; they NEVER fall back to the capped Phase A
 *   composition. All other cards keep the Phase A composition. The
 *   platform-Admin all-suppliers view keeps Phase A composition
 *   (it is not an agency path).
 * - New aggregations never use the platform-Admin all-suppliers
 *   flattening: payments, cash and schedules are scoped by the backend
 *   from the caller's agency membership (agencySupplierId). The
 *   bookings/cars flattening for platform Admin is the pre-existing
 *   dashboard behaviour and is kept unchanged.
 */

const PAGE_SIZE = 1000
const statuses = Object.values(BookingStatus)

type BlockStatus = 'loading' | 'ready' | 'error'

interface ListBlock<T> {
  status: BlockStatus
  data: T[]
  partial: boolean
}

interface CashBlock {
  status: BlockStatus
  sessions: bookcarsTypes.CashSession[]
  movements: Record<string, bookcarsTypes.CashMovement[]>
  movementErrors: Record<string, boolean>
}

const emptyListBlock = <T, >(): ListBlock<T> => ({ status: 'loading', data: [], partial: false })

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'ar' ? 'ar-MA' : language === 'fr' ? 'fr-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}

const formatDate = (value: Date | string) => new Intl.DateTimeFormat(uiLocale(), {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
}).format(new Date(value))

const formatDay = (value: Date | string) => new Intl.DateTimeFormat(uiLocale(), {
  day: '2-digit', month: 'short', year: 'numeric',
}).format(new Date(value))

const formatAmount = (amount: number) => `${new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 2 }).format(amount)} ${env.CURRENCY}`

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const getBookingDate = (booking: Booking, field: 'from' | 'to') => new Date(booking[field]).getTime()

const isExcluded = (booking: Booking) => booking.status === BookingStatus.Void || booking.status === BookingStatus.Cancelled
const isCompleted = (booking: Booking) => booking.lifecycle === bookcarsTypes.ContractLifecycle.Completed

const rentalTotalOf = (booking: Booking) => Number(booking.financialSnapshot?.rentalTotal || booking.price || 0)

const bookingLabel = (booking: Booking) => booking.reference || (booking._id || '').slice(-8).toUpperCase() || '—'

const getCarName = (booking: Booking) => {
  if (typeof booking.car === 'object' && booking.car) {
    const car = booking.car as Car
    return car.licensePlate ? `${car.name} · ${car.licensePlate}` : car.name
  }
  return strings.CAR_FALLBACK
}

const getCustomerName = (booking: Booking) => {
  if (typeof booking.driver === 'object' && booking.driver) {
    return booking.driver.fullName || booking.driver.email || strings.CLIENT_FALLBACK
  }
  return strings.CLIENT_FALLBACK
}

const carLabel = (car: Car) => (car.licensePlate ? `${car.name} · ${car.licensePlate}` : car.name)

type PeriodKind = 'all' | 'today' | 'month' | '7' | '14' | '28' | 'custom'

interface PeriodRange { start: number, end: number }

const periodRangeFor = (kind: PeriodKind, customFrom: string, customTo: string): PeriodRange | null => {
  const now = new Date()
  switch (kind) {
    case 'all': return null
    case 'today': return { start: startOfDay(now).getTime(), end: endOfDay(now).getTime() }
    case 'month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { start: startOfDay(first).getTime(), end: endOfDay(last).getTime() }
    }
    case '7': return { start: startOfDay(addDays(now, -6)).getTime(), end: endOfDay(now).getTime() }
    case '14': return { start: startOfDay(addDays(now, -13)).getTime(), end: endOfDay(now).getTime() }
    case '28': return { start: startOfDay(addDays(now, -27)).getTime(), end: endOfDay(now).getTime() }
    case 'custom': {
      if (!customFrom || !customTo) return null
      const start = startOfDay(new Date(`${customFrom}T00:00:00`)).getTime()
      const end = endOfDay(new Date(`${customTo}T00:00:00`)).getTime()
      if (Number.isNaN(start) || Number.isNaN(end) || start > end) return null
      return { start, end }
    }
    default: return null
  }
}

type WidgetSection = 'kpi' | 'attention' | 'lists'

const DEFAULT_WIDGET_ORDER: Record<WidgetSection, string[]> = {
  kpi: ['amounts', 'availability', 'contracts', 'treasury'],
  attention: ['credit', 'documents', 'upcoming', 'active'],
  lists: ['departures', 'returns', 'latest'],
}

const WIDGET_TITLES: Record<string, () => string> = {
  amounts: () => strings.CONTRACT_AMOUNTS,
  availability: () => strings.AVAILABLE_CARS,
  contracts: () => strings.PERIOD_CONTRACTS,
  treasury: () => strings.TREASURY,
  credit: () => strings.CREDIT_DUE,
  documents: () => strings.EXPIRING_DOCUMENTS,
  upcoming: () => strings.UPCOMING_CONTRACTS,
  active: () => strings.ACTIVE_CONTRACTS,
  departures: () => strings.DEPARTURES_TODAY,
  returns: () => strings.RETURNS_TITLE,
  latest: () => strings.LATEST_CONTRACTS,
}

interface WidgetPrefs { order: Record<WidgetSection, string[]>, hidden: string[] }

const defaultPrefs = (): WidgetPrefs => ({
  order: {
    kpi: [...DEFAULT_WIDGET_ORDER.kpi],
    attention: [...DEFAULT_WIDGET_ORDER.attention],
    lists: [...DEFAULT_WIDGET_ORDER.lists],
  },
  hidden: [],
})

const Dashboard = () => {
  const agencyPermissions = useAgencyPermissions()
  const canManageBookings = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.ManageBookings)
  const navigate = useNavigate()
  // FRAR D-AR-07: mirror forward arrows in RTL.
  const isAr = UserService.getLanguage() === 'ar'

  const [user, setUser] = useState<User | null>(null)
  const userRef = useRef<User | null>(null)
  const supplierIdsRef = useRef<string[]>([])
  const isAdminRef = useRef(false)
  const agencySupplierRef = useRef<string | null>(null)

  useEffect(() => {
    agencySupplierRef.current = agencyPermissions?.supplier || null
  }, [agencyPermissions])

  const [bookingsBlock, setBookingsBlock] = useState<ListBlock<Booking>>(emptyListBlock)
  const [carsBlock, setCarsBlock] = useState<ListBlock<Car>>(emptyListBlock)
  const [paymentsBlock, setPaymentsBlock] = useState<ListBlock<bookcarsTypes.RentalPayment>>(emptyListBlock)
  const [schedulesBlock, setSchedulesBlock] = useState<ListBlock<bookcarsTypes.MaintenanceSchedule>>(emptyListBlock)
  const [cashBlock, setCashBlock] = useState<CashBlock>({ status: 'loading', sessions: [], movements: {}, movementErrors: {} })
  const [summaryBlock, setSummaryBlock] = useState<{ status: BlockStatus, data: bookcarsTypes.DashboardSummary | null }>({ status: 'loading', data: null })

  const [period, setPeriod] = useState<PeriodKind>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const [customizeMode, setCustomizeMode] = useState(false)
  const [widgetPrefs, setWidgetPrefs] = useState<WidgetPrefs>(defaultPrefs)
  const prefsLoadedForRef = useRef<string>('')

  const loadBookings = useCallback(async (supplierIds: string[]) => {
    setBookingsBlock((b) => ({ ...b, status: 'loading' }))
    try {
      const result = await BookingService.getBookings({ suppliers: supplierIds, statuses }, 1, PAGE_SIZE)
      const rows = result?.[0]?.resultData || []
      setBookingsBlock({ status: 'ready', data: rows, partial: rows.length >= PAGE_SIZE })
    } catch (error) {
      setBookingsBlock((b) => ({ ...b, status: 'error' }))
      helper.error(error)
    }
  }, [])

  const loadCars = useCallback(async (supplierIds: string[]) => {
    setCarsBlock((b) => ({ ...b, status: 'loading' }))
    try {
      const result = await CarService.getCars('', {
        suppliers: supplierIds,
        includeAlreadyBookedCars: true,
        includeComingSoonCars: true,
      }, 1, PAGE_SIZE)
      const rows = result?.[0]?.resultData || []
      setCarsBlock({ status: 'ready', data: rows, partial: rows.length >= PAGE_SIZE })
    } catch (error) {
      setCarsBlock((b) => ({ ...b, status: 'error' }))
      helper.error(error)
    }
  }, [])

  const loadPayments = useCallback(async () => {
    setPaymentsBlock((b) => ({ ...b, status: 'loading' }))
    try {
      const rows = await RentalPaymentService.list()
      setPaymentsBlock({ status: 'ready', data: rows || [], partial: false })
    } catch (error) {
      setPaymentsBlock((b) => ({ ...b, status: 'error' }))
      helper.error(error)
    }
  }, [])

  const loadSchedules = useCallback(async () => {
    setSchedulesBlock((b) => ({ ...b, status: 'loading' }))
    try {
      const rows = await MaintenanceScheduleService.list()
      setSchedulesBlock({ status: 'ready', data: rows || [], partial: false })
    } catch (error) {
      setSchedulesBlock((b) => ({ ...b, status: 'error' }))
      helper.error(error)
    }
  }, [])

  const loadCash = useCallback(async () => {
    setCashBlock((b) => ({ ...b, status: 'loading' }))
    try {
      // Backend agency scoping decides the supplier for agency users;
      // platform Admin keeps its unscoped reporting view (no flattening
      // list is built here). CashJournal uses the same convention.
      const scope = isAdminRef.current ? undefined : (agencySupplierRef.current || undefined)
      const sessions = await CashService.listSessions(scope)
      const open = (sessions || []).filter((s) => s.status === bookcarsTypes.CashSessionStatus.Open)
      const movements: Record<string, bookcarsTypes.CashMovement[]> = {}
      const movementErrors: Record<string, boolean> = {}
      await Promise.all(open.map(async (session) => {
        if (!session._id) return
        try {
          movements[session._id] = await CashService.movements(session._id, scope)
        } catch {
          movementErrors[session._id] = true
        }
      }))
      setCashBlock({ status: 'ready', sessions: sessions || [], movements, movementErrors })
    } catch (error) {
      setCashBlock((b) => ({ ...b, status: 'error' }))
      helper.error(error)
    }
  }, [])

  // GA-PAR-14 Phase B: period-KPI aggregate for agency users only.
  const loadSummary = useCallback(async () => {
    if (isAdminRef.current) {
      return
    }
    setSummaryBlock((b) => ({ ...b, status: 'loading' }))
    try {
      const r = periodRangeFor(period, customFrom, customTo)
      const from = r ? new Date(r.start).toISOString() : '1970-01-01'
      const to = r ? new Date(r.end).toISOString() : '2100-01-01'
      const data = await ReportService.dashboardSummary(from, to)
      setSummaryBlock({ status: 'ready', data })
    } catch (error) {
      // Degradation rule: the KPI cards show their own error state;
      // there is deliberately NO fallback to capped Phase A figures.
      setSummaryBlock((b) => ({ ...b, status: 'error' }))
      helper.error(error)
    }
  }, [period, customFrom, customTo])

  useEffect(() => {
    if (user && !isAdminRef.current) {
      void loadSummary()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, period, customFrom, customTo])

  const onLoad = useCallback(async (u?: User) => {
    if (!u) {
      setBookingsBlock((b) => ({ ...b, status: 'error' }))
      setCarsBlock((b) => ({ ...b, status: 'error' }))
      setPaymentsBlock((b) => ({ ...b, status: 'error' }))
      setSchedulesBlock((b) => ({ ...b, status: 'error' }))
      setCashBlock((b) => ({ ...b, status: 'error' }))
      return
    }
    setUser(u)
    userRef.current = u
    isAdminRef.current = helper.admin(u)
    void loadPayments()
    void loadSchedules()
    void loadCash()
    try {
      const supplierIds = helper.admin(u)
        ? bookcarsHelper.flattenSuppliers(await SupplierService.getAllSuppliers())
        : [u._id || '']
      supplierIdsRef.current = supplierIds
      void loadBookings(supplierIds)
      void loadCars(supplierIds)
    } catch (error) {
      setBookingsBlock((b) => ({ ...b, status: 'error' }))
      setCarsBlock((b) => ({ ...b, status: 'error' }))
      helper.error(error)
    }
  }, [loadBookings, loadCars, loadPayments, loadSchedules, loadCash])

  // ---- widget customisation (localStorage per user, no backend) ----
  useEffect(() => {
    const uid = user?._id
    if (!uid || prefsLoadedForRef.current === uid) return
    prefsLoadedForRef.current = uid
    try {
      const raw = globalThis.localStorage.getItem(`ga-par09-dashboard-widgets:${uid}`)
      if (raw) {
        const parsed = JSON.parse(raw) as WidgetPrefs
        const merged = defaultPrefs()
        ;(Object.keys(DEFAULT_WIDGET_ORDER) as WidgetSection[]).forEach((section) => {
          const saved = Array.isArray(parsed.order?.[section]) ? parsed.order[section] : []
          merged.order[section] = [...saved.filter((id) => DEFAULT_WIDGET_ORDER[section].includes(id)),
            ...DEFAULT_WIDGET_ORDER[section].filter((id) => !saved.includes(id))]
        })
        merged.hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter((id) => !!WIDGET_TITLES[id]) : []
        setWidgetPrefs(merged)
      }
    } catch { /* corrupted prefs fall back to defaults */ }
  }, [user])

  useEffect(() => {
    const uid = user?._id
    if (!uid || prefsLoadedForRef.current !== uid) return
    try {
      globalThis.localStorage.setItem(`ga-par09-dashboard-widgets:${uid}`, JSON.stringify(widgetPrefs))
    } catch { /* storage unavailable: customisation stays session-only */ }
  }, [widgetPrefs, user])

  const moveWidget = (section: WidgetSection, id: string, dir: -1 | 1) => {
    setWidgetPrefs((prefs) => {
      const order = [...prefs.order[section]]
      const idx = order.indexOf(id)
      const next = idx + dir
      if (idx < 0 || next < 0 || next >= order.length) return prefs
      const [item] = order.splice(idx, 1)
      order.splice(next, 0, item)
      return { ...prefs, order: { ...prefs.order, [section]: order } }
    })
  }

  const toggleWidgetHidden = (id: string) => {
    setWidgetPrefs((prefs) => ({
      ...prefs,
      hidden: prefs.hidden.includes(id) ? prefs.hidden.filter((h) => h !== id) : [...prefs.hidden, id],
    }))
  }

  // ---- derived data ----
  const now = Date.now()
  const range = useMemo(() => periodRangeFor(period, customFrom, customTo), [period, customFrom, customTo])

  const postedRentByBooking = useMemo(() => {
    const map = new Map<string, number>()
    for (const payment of paymentsBlock.data) {
      if (payment.status && payment.status !== bookcarsTypes.RentalPaymentStatus.Posted) continue
      const purpose = payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent
      if (purpose !== bookcarsTypes.RentalPaymentPurpose.Rent) continue
      const bookingId = typeof payment.booking === 'string' ? payment.booking : payment.booking?._id
      if (!bookingId) continue
      const signed = payment.direction === bookcarsTypes.RentalPaymentDirection.Debit ? -Number(payment.amount || 0) : Number(payment.amount || 0)
      map.set(bookingId, round2((map.get(bookingId) || 0) + signed))
    }
    return map
  }, [paymentsBlock.data])

  const outstandingOf = useCallback((booking: Booking) => {
    const posted = postedRentByBooking.get(booking._id || '') || 0
    return round2(Math.max(0, rentalTotalOf(booking) - posted))
  }, [postedRentByBooking])

  const liveBookings = useMemo(() => bookingsBlock.data.filter((b) => !isExcluded(b)), [bookingsBlock.data])

  const periodBookings = useMemo(() => {
    if (!range) return liveBookings
    return liveBookings.filter((b) => getBookingDate(b, 'from') <= range.end && getBookingDate(b, 'to') >= range.start)
  }, [liveBookings, range])

  const periodAmounts = useMemo(() => {
    let total = 0
    let collected = 0
    let remaining = 0
    for (const booking of periodBookings) {
      const rentalTotal = rentalTotalOf(booking)
      total = round2(total + rentalTotal)
      collected = round2(collected + (postedRentByBooking.get(booking._id || '') || 0))
      remaining = round2(remaining + Math.max(0, rentalTotal - (postedRentByBooking.get(booking._id || '') || 0)))
    }
    return { total, collected, remaining }
  }, [periodBookings, postedRentByBooking])

  const summaryMode = !!user && !helper.admin(user)

  // Fleet statuses (scorecard #15): a car in maintenance or stopped is
  // NOT available, even when its `available` flag is true (a legacy car
  // with no stored status reads as in service).
  const availableCars = useMemo(
    () => carsBlock.data.filter(
      (car) => car.available
        && car.operationalStatus !== bookcarsTypes.CarOperationalStatus.Maintenance
        && car.operationalStatus !== bookcarsTypes.CarOperationalStatus.Stopped,
    ).length,
    [carsBlock.data],
  )

  // Credit due (GA-PAR-08 financing): omitted entirely when no car in the
  // payload carries a financing block.
  const creditData = useMemo(() => {
    const financed = carsBlock.data.filter((car) => !!car.financing)
    const horizon = endOfDay(addDays(new Date(), 30)).getTime()
    const due = financed
      .filter((car) => car.financing?.nextDueDate && new Date(car.financing.nextDueDate).getTime() <= horizon)
      .sort((a, b) => new Date(a.financing!.nextDueDate!).getTime() - new Date(b.financing!.nextDueDate!).getTime())
    const total = round2(due.reduce((sum, car) => sum + Number(car.financing?.instalmentAmount || 0), 0))
    return { exists: financed.length > 0, due, total }
  }, [carsBlock.data])

  // Expiring documents: per car, PAR-08 fields win; a car with no document
  // fields falls back to its maintenance schedules. Never both sources.
  const documentsData = useMemo(() => {
    const horizon = endOfDay(addDays(new Date(), 30)).getTime()
    const todayStart = startOfDay(new Date()).getTime()
    const carById = new Map<string, Car>()
    carsBlock.data.forEach((car) => { if (car._id) carById.set(car._id, car) })
    const hasDocFields = (car: Car) => !!(car.insuranceExpiryDate || car.technicalInspectionExpiryDate || car.vignetteExpiryDate)
    const anyDocFields = carsBlock.data.some(hasDocFields)
    type DocRow = { key: string, carLabel: string, docLabel: string, date: Date, expired: boolean, fromSchedule: boolean }
    const rows: DocRow[] = []
    for (const car of carsBlock.data) {
      if (!hasDocFields(car)) continue
      const fields: [string, Date | string | undefined][] = [
        [strings.DOC_INSURANCE, car.insuranceExpiryDate as Date | string | undefined],
        [strings.DOC_INSPECTION, car.technicalInspectionExpiryDate as Date | string | undefined],
        [strings.DOC_VIGNETTE, car.vignetteExpiryDate as Date | string | undefined],
      ]
      for (const [label, value] of fields) {
        if (!value) continue
        const date = new Date(value)
        if (date.getTime() <= horizon) {
          rows.push({ key: `${car._id}-${label}`, carLabel: carLabel(car), docLabel: label, date, expired: date.getTime() < todayStart, fromSchedule: false })
        }
      }
    }
    let usesSchedules = false
    if (schedulesBlock.status === 'ready') {
      for (const schedule of schedulesBlock.data) {
        const carId = typeof schedule.car === 'string' ? schedule.car : schedule.car?._id
        const car = carId ? carById.get(carId) : undefined
        // Cars with PAR-08 fields are field-sourced only. A schedule whose
        // car is outside the fetched fleet is treated as field-less.
        if (car && hasDocFields(car)) continue
        if (schedule.status === bookcarsTypes.MaintenanceScheduleStatus.Completed) continue
        const date = new Date(schedule.nextDueDate)
        if (date.getTime() > horizon) continue
        const scheduleCarLabel = car ? carLabel(car) : (typeof schedule.car === 'object' && schedule.car ? schedule.car.name : strings.CAR_FALLBACK)
        rows.push({
          key: `schedule-${schedule._id}`,
          carLabel: scheduleCarLabel,
          docLabel: `${strings.SCHEDULE_SOURCE} · ${schedule.title}`,
          date,
          expired: date.getTime() < todayStart,
          fromSchedule: true,
        })
        usesSchedules = true
      }
    }
    rows.sort((a, b) => Number(b.expired) - Number(a.expired) || a.date.getTime() - b.date.getTime())
    const exists = carsBlock.status === 'ready' && (anyDocFields || schedulesBlock.status === 'ready')
    return { exists, rows, usesSchedules, anyDocFields }
  }, [carsBlock, schedulesBlock])

  const upcomingBookings = useMemo(() => liveBookings
    .filter((b) => !isCompleted(b) && getBookingDate(b, 'from') > now)
    .sort((a, b) => getBookingDate(a, 'from') - getBookingDate(b, 'from')), [liveBookings, now])

  const activeBookings = useMemo(() => liveBookings
    .filter((b) => !isCompleted(b) && getBookingDate(b, 'from') <= now && getBookingDate(b, 'to') >= now)
    .sort((a, b) => getBookingDate(a, 'to') - getBookingDate(b, 'to')), [liveBookings, now])

  const overdueBookings = useMemo(() => liveBookings
    .filter((b) => !isCompleted(b) && getBookingDate(b, 'to') < now && outstandingOf(b) > 0)
    .sort((a, b) => getBookingDate(a, 'to') - getBookingDate(b, 'to')), [liveBookings, now, outstandingOf])

  const departuresToday = useMemo(() => {
    const start = startOfDay(new Date()).getTime()
    const end = endOfDay(new Date()).getTime()
    return liveBookings
      .filter((b) => !isCompleted(b) && getBookingDate(b, 'from') >= start && getBookingDate(b, 'from') <= end)
      .sort((a, b) => getBookingDate(a, 'from') - getBookingDate(b, 'from'))
  }, [liveBookings])

  const returnsList = useMemo(() => {
    const start = startOfDay(new Date()).getTime()
    const horizon = endOfDay(addDays(new Date(), 3)).getTime()
    const overdue = liveBookings
      .filter((b) => !isCompleted(b) && getBookingDate(b, 'to') < start)
      .sort((a, b) => getBookingDate(a, 'to') - getBookingDate(b, 'to'))
      .map((booking) => ({ booking, overdue: true }))
    const upcoming = liveBookings
      .filter((b) => !isCompleted(b) && getBookingDate(b, 'to') >= start && getBookingDate(b, 'to') <= horizon)
      .sort((a, b) => getBookingDate(a, 'to') - getBookingDate(b, 'to'))
      .map((booking) => ({ booking, overdue: false }))
    return [...overdue, ...upcoming]
  }, [liveBookings])

  const latestBookings = useMemo(() => {
    const createdMs = (b: Booking) => {
      const created = (b as unknown as { createdAt?: string }).createdAt
      const t = created ? new Date(created).getTime() : Number.NaN
      return Number.isNaN(t) ? 0 : t
    }
    return [...liveBookings]
      .sort((a, b) => createdMs(b) - createdMs(a) || String(b._id || '').localeCompare(String(a._id || '')))
      .slice(0, 8)
  }, [liveBookings])

  const openCashSessions = useMemo(() => cashBlock.sessions
    .filter((s) => s.status === bookcarsTypes.CashSessionStatus.Open)
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()), [cashBlock.sessions])

  const treasuryExpected = useCallback((session: bookcarsTypes.CashSession): number | null => {
    if (session.expectedClosingBalance !== undefined && session.expectedClosingBalance !== null) {
      return Number(session.expectedClosingBalance)
    }
    if (!session._id || cashBlock.movementErrors[session._id]) return null
    const movements = cashBlock.movements[session._id]
    if (!movements) return null
    const confirmed = movements.filter((m) => {
      const status = (m as unknown as { status?: string }).status
      return !status || status === 'confirmed'
    })
    const delta = confirmed.reduce((sum, m) => sum + (m.direction === bookcarsTypes.CashMovementDirection.In ? Number(m.amount || 0) : -Number(m.amount || 0)), 0)
    return round2(Number(session.openingBalance || 0) + delta)
  }, [cashBlock])

  // ---- widget existence (data-driven omission) ----
  const existingWidgets: Record<WidgetSection, string[]> = {
    kpi: DEFAULT_WIDGET_ORDER.kpi,
    attention: [
      ...(carsBlock.status === 'ready' && !creditData.exists ? [] : ['credit']),
      ...(carsBlock.status === 'ready' && !documentsData.exists ? [] : ['documents']),
      'upcoming',
      'active',
    ],
    lists: DEFAULT_WIDGET_ORDER.lists,
  }

  const orderedVisible = (section: WidgetSection) => {
    const order = widgetPrefs.order[section].filter((id) => existingWidgets[section].includes(id))
    const missing = existingWidgets[section].filter((id) => !order.includes(id))
    return [...order, ...missing].filter((id) => !widgetPrefs.hidden.includes(id))
  }

  const renderCustomControls = (section: WidgetSection, id: string) => {
    if (!customizeMode) return null
    const order = widgetPrefs.order[section]
    const idx = order.indexOf(id)
    return (
      <span className="agency-dashboard__widget-controls">
        <IconButton size="small" aria-label={strings.MOVE_UP} disabled={idx <= 0} onClick={() => moveWidget(section, id, -1)}><ArrowUpwardRoundedIcon fontSize="small" /></IconButton>
        <IconButton size="small" aria-label={strings.MOVE_DOWN} disabled={idx < 0 || idx >= order.length - 1} onClick={() => moveWidget(section, id, 1)}><ArrowDownwardRoundedIcon fontSize="small" /></IconButton>
        <IconButton size="small" aria-label={strings.HIDE} onClick={() => toggleWidgetHidden(id)}><VisibilityOffRoundedIcon fontSize="small" /></IconButton>
      </span>
    )
  }

  const partialChip = (partial: boolean) => (partial ? (
    <Tooltip title={strings.PARTIAL_DATA}><Chip size="small" color="warning" label={strings.PARTIAL_DATA} className="agency-dashboard__partial-chip" /></Tooltip>
  ) : null)

  const blockBody = (status: BlockStatus, onRetry: () => void, ready: React.ReactNode) => {
    if (status === 'loading') return <div className="agency-dashboard__loading"><CircularProgress size={24} /></div>
    if (status === 'error') {
      return (
        <div className="agency-dashboard__empty">
          <WarningAmberRoundedIcon />
          <Typography>{strings.BLOCK_ERROR}</Typography>
          <Button onClick={onRetry}>{strings.RETRY}</Button>
        </div>
      )
    }
    return ready
  }

  const bookingRow = (booking: Booking, dateField: 'from' | 'to', dateLabel: string, extra?: string) => (
    <button type="button" className="agency-dashboard__booking-row" key={`${dateField}-${booking._id}`} onClick={() => navigate(`/update-booking?b=${booking._id}`)}>
      <span className="agency-dashboard__booking-car"><DirectionsCarRoundedIcon /></span>
      <span className="agency-dashboard__booking-info">
        <strong>{getCarName(booking)}</strong>
        <span>{getCustomerName(booking)}</span>
      </span>
      <span className="agency-dashboard__booking-date">
        <span>{dateLabel}</span>
        <strong>{formatDate(booking[dateField])}</strong>
      </span>
      <Chip size="small" label={extra || bookingLabel(booking)} className="agency-dashboard__status" />
    </button>
  )

  // ---- widgets ----
  const renderAmountsWidget = () => (
    <Card className="agency-dashboard__metric agency-dashboard__metric--mint" key="amounts">
      <CardContent>
        <div className="agency-dashboard__widget-head">
          <span className="agency-dashboard__metric-icon"><PaymentsRoundedIcon /></span>
          {renderCustomControls('kpi', 'amounts')}
        </div>
        <Typography className="agency-dashboard__metric-label">{strings.CONTRACT_AMOUNTS}</Typography>
        {summaryMode ? blockBody(summaryBlock.status, () => void loadSummary(), (
          <>
            <Tooltip title={strings.AMOUNTS_TOOLTIP}>
              <Typography component="p" className="agency-dashboard__metric-value">{formatAmount(summaryBlock.data?.contractAmount || 0)}</Typography>
            </Tooltip>
            <Typography className="agency-dashboard__metric-detail">{`${strings.COLLECTED}: ${formatAmount(summaryBlock.data?.collected || 0)}`}</Typography>
            <Typography className="agency-dashboard__metric-detail">{`${strings.REMAINING}: ${formatAmount(summaryBlock.data?.remaining || 0)}`}</Typography>
          </>
        )) : blockBody(bookingsBlock.status, () => void loadBookings(supplierIdsRef.current), (
          <>
            <Tooltip title={strings.AMOUNTS_TOOLTIP}>
              <Typography component="p" className="agency-dashboard__metric-value">{formatAmount(periodAmounts.total)}</Typography>
            </Tooltip>
            {paymentsBlock.status === 'loading' ? <Typography className="agency-dashboard__metric-detail">…</Typography>
              : paymentsBlock.status === 'error' ? (
                <span className="agency-dashboard__inline-error">{strings.BLOCK_ERROR} <Button size="small" onClick={() => void loadPayments()}>{strings.RETRY}</Button></span>
              ) : (
                <>
                  <Typography className="agency-dashboard__metric-detail">{`${strings.COLLECTED}: ${formatAmount(periodAmounts.collected)}`}</Typography>
                  <Typography className="agency-dashboard__metric-detail">{`${strings.REMAINING}: ${formatAmount(periodAmounts.remaining)}`}</Typography>
                </>
              )}
            {partialChip(bookingsBlock.partial)}
          </>
        ))}
      </CardContent>
    </Card>
  )

  const renderAvailabilityWidget = () => (
    <Card className="agency-dashboard__metric agency-dashboard__metric--blue" key="availability">
      <CardContent>
        <div className="agency-dashboard__widget-head">
          <span className="agency-dashboard__metric-icon"><DirectionsCarRoundedIcon /></span>
          {renderCustomControls('kpi', 'availability')}
        </div>
        <Typography className="agency-dashboard__metric-label">{strings.AVAILABLE_CARS}</Typography>
        {blockBody(carsBlock.status, () => void loadCars(supplierIdsRef.current), (
          <>
            <Typography component="p" className="agency-dashboard__metric-value">{`${availableCars} / ${carsBlock.data.length}`}</Typography>
            <Typography className="agency-dashboard__metric-detail">{strings.READY_TO_RENT}</Typography>
            {partialChip(carsBlock.partial)}
          </>
        ))}
      </CardContent>
    </Card>
  )

  const renderContractsWidget = () => (
    <Card className="agency-dashboard__metric agency-dashboard__metric--amber" key="contracts">
      <CardContent>
        <div className="agency-dashboard__widget-head">
          <span className="agency-dashboard__metric-icon"><CalendarMonthRoundedIcon /></span>
          {renderCustomControls('kpi', 'contracts')}
        </div>
        <Typography className="agency-dashboard__metric-label">{strings.PERIOD_CONTRACTS}</Typography>
        {summaryMode ? blockBody(summaryBlock.status, () => void loadSummary(), (
          <>
            <Typography component="p" className="agency-dashboard__metric-value">{String(summaryBlock.data?.contracts || 0)}</Typography>
            <Typography className="agency-dashboard__metric-detail">{strings.PERIOD_CONTRACTS_DETAIL}</Typography>
          </>
        )) : blockBody(bookingsBlock.status, () => void loadBookings(supplierIdsRef.current), (
          <>
            <Typography component="p" className="agency-dashboard__metric-value">{String(periodBookings.length)}</Typography>
            <Typography className="agency-dashboard__metric-detail">{strings.PERIOD_CONTRACTS_DETAIL}</Typography>
            {partialChip(bookingsBlock.partial)}
          </>
        ))}
      </CardContent>
    </Card>
  )

  const renderTreasuryWidget = () => (
    <Card className="agency-dashboard__metric agency-dashboard__metric--violet" key="treasury">
      <CardContent>
        <div className="agency-dashboard__widget-head">
          <span className="agency-dashboard__metric-icon"><KeyRoundedIcon /></span>
          {renderCustomControls('kpi', 'treasury')}
        </div>
        <Typography className="agency-dashboard__metric-label">{strings.TREASURY}</Typography>
        {blockBody(cashBlock.status, () => void loadCash(), (
          openCashSessions.length === 0 ? (
            <Typography className="agency-dashboard__metric-detail">{strings.NO_OPEN_SESSION}</Typography>
          ) : (
            <>
              {[bookcarsTypes.CashAccountType.Cash, bookcarsTypes.CashAccountType.Bank].map((account) => {
                const session = openCashSessions.find((s) => s.account === account)
                const expected = session ? treasuryExpected(session) : null
                return (
                  <Typography className="agency-dashboard__metric-detail" key={account}>
                    {`${account === bookcarsTypes.CashAccountType.Bank ? strings.TREASURY_BANK : strings.TREASURY_CASH}: ${session ? (expected === null ? '—' : formatAmount(expected)) : strings.NO_OPEN_SESSION}`}
                  </Typography>
                )
              })}
              <Typography className="agency-dashboard__metric-detail">{strings.EXPECTED_BALANCE}</Typography>
            </>
          )
        ))}
      </CardContent>
    </Card>
  )

  const renderCreditWidget = () => (
    <Card className="agency-dashboard__panel" key="credit">
      <CardContent>
        <div className="agency-dashboard__panel-heading">
          <Typography component="h2" className="agency-dashboard__panel-title">{strings.CREDIT_DUE}</Typography>
          <span>{partialChip(carsBlock.partial)}{renderCustomControls('attention', 'credit')}</span>
        </div>
        {blockBody(carsBlock.status, () => void loadCars(supplierIdsRef.current), (
          creditData.due.length === 0 ? <div className="agency-dashboard__empty"><Typography>{strings.NOTHING_DUE}</Typography></div> : (
            <>
              <div className="agency-dashboard__booking-list">
                {creditData.due.map((car) => {
                  const dueMs = new Date(car.financing!.nextDueDate!).getTime()
                  const overdue = dueMs < startOfDay(new Date()).getTime()
                  return (
                    <div className="agency-dashboard__attention-row" key={car._id}>
                      <span className="agency-dashboard__booking-info">
                        <strong>{carLabel(car)}</strong>
                        <span>{`${strings.LENDER}: ${car.financing?.lender || '—'}`}</span>
                      </span>
                      <span className="agency-dashboard__booking-date">
                        <span>{strings.NEXT_DUE}</span>
                        <strong>{formatDay(car.financing!.nextDueDate!)}</strong>
                      </span>
                      <span className="agency-dashboard__booking-date">
                        <span>{strings.INSTALMENT}</span>
                        <strong>{car.financing?.instalmentAmount !== undefined ? formatAmount(Number(car.financing.instalmentAmount)) : '—'}</strong>
                      </span>
                      <span className="agency-dashboard__booking-date">
                        <span>{strings.REMAINING_AMOUNT}</span>
                        <strong>{car.financing?.remainingAmount !== undefined ? formatAmount(Number(car.financing.remainingAmount)) : '—'}</strong>
                      </span>
                      {overdue && <Chip size="small" color="error" label={strings.OVERDUE_CONTRACTS} />}
                    </div>
                  )
                })}
              </div>
              <Typography className="agency-dashboard__panel-copy">{`${strings.CREDIT_TOTAL_LABEL}: ${formatAmount(creditData.total)}`}</Typography>
            </>
          )
        ))}
      </CardContent>
    </Card>
  )

  const renderDocumentsWidget = () => (
    <Card className="agency-dashboard__panel" key="documents">
      <CardContent>
        <div className="agency-dashboard__panel-heading">
          <Typography component="h2" className="agency-dashboard__panel-title">{strings.EXPIRING_DOCUMENTS}</Typography>
          <span>{partialChip(carsBlock.partial || schedulesBlock.partial)}{renderCustomControls('attention', 'documents')}</span>
        </div>
        {documentsData.usesSchedules && <Chip size="small" label={strings.INCLUDES_SCHEDULES} className="agency-dashboard__source-chip" />}
        {blockBody(carsBlock.status, () => void loadCars(supplierIdsRef.current), (
          documentsData.rows.length === 0 ? <div className="agency-dashboard__empty"><Typography>{strings.NOTHING_EXPIRING}</Typography></div> : (
            <div className="agency-dashboard__booking-list">
              {documentsData.rows.slice(0, 10).map((row) => (
                <div className="agency-dashboard__attention-row" key={row.key}>
                  <span className="agency-dashboard__booking-info">
                    <strong>{row.carLabel}</strong>
                    <span>{row.docLabel}</span>
                  </span>
                  <span className="agency-dashboard__booking-date">
                    <span>{strings.DUE_LABEL}</span>
                    <strong>{formatDay(row.date)}</strong>
                  </span>
                  {row.expired && <Chip size="small" color="error" label={strings.EXPIRED} />}
                </div>
              ))}
            </div>
          )
        ))}
        {schedulesBlock.status === 'error' && documentsData.anyDocFields && (
          <span className="agency-dashboard__inline-error">{strings.BLOCK_ERROR} <Button size="small" onClick={() => void loadSchedules()}>{strings.RETRY}</Button></span>
        )}
      </CardContent>
    </Card>
  )

  const renderUpcomingWidget = () => (
    <Card className="agency-dashboard__panel" key="upcoming">
      <CardContent>
        <div className="agency-dashboard__panel-heading">
          <Typography component="h2" className="agency-dashboard__panel-title">{`${strings.UPCOMING_CONTRACTS} (${bookingsBlock.status === 'ready' ? upcomingBookings.length : '—'})`}</Typography>
          <span>{partialChip(bookingsBlock.partial)}{renderCustomControls('attention', 'upcoming')}</span>
        </div>
        {blockBody(bookingsBlock.status, () => void loadBookings(supplierIdsRef.current), (
          upcomingBookings.length === 0 ? <div className="agency-dashboard__empty"><Typography>{strings.NO_UPCOMING}</Typography></div> : (
            <div className="agency-dashboard__booking-list">{upcomingBookings.slice(0, 5).map((b) => bookingRow(b, 'from', strings.DEPARTURE))}</div>
          )
        ))}
      </CardContent>
    </Card>
  )

  const renderActiveWidget = () => (
    <Card className="agency-dashboard__panel" key="active">
      <CardContent>
        <div className="agency-dashboard__panel-heading">
          <Typography component="h2" className="agency-dashboard__panel-title">{`${strings.ACTIVE_CONTRACTS} (${bookingsBlock.status === 'ready' ? activeBookings.length : '—'})`}</Typography>
          <span>{partialChip(bookingsBlock.partial)}{renderCustomControls('attention', 'active')}</span>
        </div>
        {blockBody(bookingsBlock.status, () => void loadBookings(supplierIdsRef.current), (
          activeBookings.length === 0 && (paymentsBlock.status !== 'ready' || overdueBookings.length === 0)
            ? <div className="agency-dashboard__empty"><Typography>{strings.NO_ACTIVE}</Typography></div> : (
              <>
                {paymentsBlock.status === 'ready' && overdueBookings.length > 0 && (
                  <>
                    <Typography className="agency-dashboard__panel-copy">{`${strings.OVERDUE_CONTRACTS}: ${overdueBookings.length}`}</Typography>
                    <div className="agency-dashboard__booking-list">
                      {overdueBookings.slice(0, 5).map((b) => bookingRow(b, 'to', strings.RETURN_LABEL, `${strings.OVERDUE_CONTRACTS} · ${formatAmount(outstandingOf(b))}`))}
                    </div>
                  </>
                )}
                {paymentsBlock.status === 'error' && (
                  <span className="agency-dashboard__inline-error">{strings.BLOCK_ERROR} <Button size="small" onClick={() => void loadPayments()}>{strings.RETRY}</Button></span>
                )}
                <div className="agency-dashboard__booking-list">{activeBookings.slice(0, 5).map((b) => bookingRow(b, 'to', strings.RETURN_LABEL))}</div>
              </>
            )
        ))}
      </CardContent>
    </Card>
  )

  const renderDeparturesWidget = () => (
    <Card className="agency-dashboard__panel" key="departures">
      <CardContent>
        <div className="agency-dashboard__panel-heading">
          <Typography component="h2" className="agency-dashboard__panel-title">{strings.DEPARTURES_TODAY}</Typography>
          <span>{partialChip(bookingsBlock.partial)}{renderCustomControls('lists', 'departures')}</span>
        </div>
        {blockBody(bookingsBlock.status, () => void loadBookings(supplierIdsRef.current), (
          departuresToday.length === 0 ? <div className="agency-dashboard__empty"><Typography>{strings.NO_DEPARTURES}</Typography></div> : (
            <div className="agency-dashboard__booking-list">{departuresToday.slice(0, 10).map((b) => bookingRow(b, 'from', strings.DEPARTURE))}</div>
          )
        ))}
      </CardContent>
    </Card>
  )

  const renderReturnsWidget = () => (
    <Card className="agency-dashboard__panel" key="returns">
      <CardContent>
        <div className="agency-dashboard__panel-heading">
          <Typography component="h2" className="agency-dashboard__panel-title">{strings.RETURNS_TITLE}</Typography>
          <span>{partialChip(bookingsBlock.partial)}{renderCustomControls('lists', 'returns')}</span>
        </div>
        {blockBody(bookingsBlock.status, () => void loadBookings(supplierIdsRef.current), (
          returnsList.length === 0 ? <div className="agency-dashboard__empty"><Typography>{strings.NO_RETURNS}</Typography></div> : (
            <div className="agency-dashboard__booking-list">
              {returnsList.slice(0, 10).map(({ booking, overdue }) => bookingRow(booking, 'to', strings.RETURN_LABEL, overdue ? strings.OVERDUE_CONTRACTS : bookingLabel(booking)))}
            </div>
          )
        ))}
      </CardContent>
    </Card>
  )

  const paymentChipFor = (booking: Booking) => {
    if (paymentsBlock.status !== 'ready') return <Chip size="small" label="—" className="agency-dashboard__status agency-dashboard__status--muted" />
    const posted = postedRentByBooking.get(booking._id || '') || 0
    const total = rentalTotalOf(booking)
    if (total > 0 && posted >= total - 0.005) return <Chip size="small" label={strings.PAID_IN_FULL} className="agency-dashboard__status" />
    if (posted > 0.005) return <Chip size="small" color="warning" label={strings.PARTIALLY_PAID} />
    return <Chip size="small" color="error" label={strings.UNPAID} />
  }

  const renderLatestWidget = () => (
    <Card className="agency-dashboard__panel" key="latest">
      <CardContent>
        <div className="agency-dashboard__panel-heading">
          <div>
            <Typography component="h2" className="agency-dashboard__panel-title">{strings.LATEST_CONTRACTS}</Typography>
            <Typography className="agency-dashboard__panel-copy">{strings.FOLLOW_UP_COPY}</Typography>
          </div>
          <span>
            {partialChip(bookingsBlock.partial)}
            {renderCustomControls('lists', 'latest')}
            <Button endIcon={isAr ? <ArrowBackRoundedIcon /> : <ArrowForwardRoundedIcon />} onClick={() => navigate('/bookings')}>{strings.VIEW_ALL}</Button>
          </span>
        </div>
        {blockBody(bookingsBlock.status, () => void loadBookings(supplierIdsRef.current), (
          latestBookings.length === 0 ? (
            <div className="agency-dashboard__empty">
              <EventAvailableRoundedIcon />
              <Typography>{strings.EMPTY_BOOKINGS}</Typography>
              {canManageBookings && <Button onClick={() => navigate('/create-booking')}>{strings.CREATE_BOOKING}</Button>}
            </div>
          ) : (
            <div className="agency-dashboard__table-wrap">
              <table className="agency-dashboard__table">
                <thead>
                  <tr>
                    <th>{strings.TABLE_CONTRACT}</th>
                    <th>{strings.TABLE_CLIENT}</th>
                    <th>{strings.TABLE_CAR}</th>
                    <th>{strings.TABLE_DATES}</th>
                    <th>{strings.TABLE_AMOUNT}</th>
                    <th>{strings.TABLE_PAYMENT}</th>
                  </tr>
                </thead>
                <tbody>
                  {latestBookings.map((booking) => (
                    <tr key={booking._id} onClick={() => navigate(`/update-booking?b=${booking._id}`)}>
                      <td><strong>{bookingLabel(booking)}</strong></td>
                      <td>{getCustomerName(booking)}</td>
                      <td>{getCarName(booking)}</td>
                      <td>{`${formatDay(booking.from)} → ${formatDay(booking.to)}`}</td>
                      <td>{formatAmount(rentalTotalOf(booking))}</td>
                      <td>{paymentChipFor(booking)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ))}
      </CardContent>
    </Card>
  )

  const widgetRenderers: Record<string, () => React.ReactNode> = {
    amounts: renderAmountsWidget,
    availability: renderAvailabilityWidget,
    contracts: renderContractsWidget,
    treasury: renderTreasuryWidget,
    credit: renderCreditWidget,
    documents: renderDocumentsWidget,
    upcoming: renderUpcomingWidget,
    active: renderActiveWidget,
    departures: renderDeparturesWidget,
    returns: renderReturnsWidget,
    latest: renderLatestWidget,
  }

  const hiddenExisting = (Object.keys(DEFAULT_WIDGET_ORDER) as WidgetSection[])
    .flatMap((section) => existingWidgets[section].filter((id) => widgetPrefs.hidden.includes(id)))

  const periodButtons: { kind: PeriodKind, label: string }[] = [
    { kind: 'all', label: strings.PERIOD_ALL },
    { kind: 'today', label: strings.PERIOD_TODAY },
    { kind: 'month', label: strings.PERIOD_MONTH },
    { kind: '7', label: strings.PERIOD_7D },
    { kind: '14', label: strings.PERIOD_14D },
    { kind: '28', label: strings.PERIOD_28D },
    { kind: 'custom', label: strings.PERIOD_CUSTOM },
  ]

  return (
    <Layout strict onLoad={onLoad}>
      <div className="agency-dashboard">
        <Box className="agency-dashboard__heading">
          <div>
            <Typography component="p" className="agency-dashboard__eyebrow">{strings.EYEBROW}</Typography>
            <Typography component="h1" className="agency-dashboard__title">{strings.TITLE}</Typography>
            <Typography className="agency-dashboard__subtitle">{strings.SUBTITLE}</Typography>
          </div>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<TuneRoundedIcon />} onClick={() => setCustomizeMode((v) => !v)}>
              {customizeMode ? strings.CUSTOMIZE_DONE : strings.CUSTOMIZE}
            </Button>
            {canManageBookings && (
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => navigate('/create-booking')} className="agency-dashboard__primary-action">
                {strings.NEW_BOOKING}
              </Button>
            )}
          </Stack>
        </Box>

        <Box className="agency-dashboard__period-bar">
          <Typography className="agency-dashboard__period-label">{strings.PERIOD_LABEL}</Typography>
          <Stack direction="row" spacing={0.75} className="agency-dashboard__period-buttons">
            {periodButtons.map(({ kind, label }) => (
              <Button key={kind} size="small" variant={period === kind ? 'contained' : 'outlined'} onClick={() => setPeriod(kind)}>{label}</Button>
            ))}
          </Stack>
          {period === 'custom' && (
            <Stack direction="row" spacing={1}>
              <TextField size="small" type="date" label={strings.CUSTOM_FROM} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField size="small" type="date" label={strings.CUSTOM_TO} value={customTo} onChange={(e) => setCustomTo(e.target.value)} InputLabelProps={{ shrink: true }} />
            </Stack>
          )}
        </Box>

        {customizeMode && (
          <Box className="agency-dashboard__customize-bar">
            <Button size="small" startIcon={<VisibilityRoundedIcon />} onClick={() => setWidgetPrefs(defaultPrefs())}>{strings.RESET_WIDGETS}</Button>
            {hiddenExisting.length > 0 && (
              <>
                <Typography className="agency-dashboard__period-label">{strings.HIDDEN_WIDGETS}</Typography>
                {hiddenExisting.map((id) => (
                  <Chip key={id} size="small" label={WIDGET_TITLES[id]()} onDelete={() => toggleWidgetHidden(id)} deleteIcon={<VisibilityRoundedIcon />} />
                ))}
              </>
            )}
          </Box>
        )}

        <Box className="agency-dashboard__metrics">
          {orderedVisible('kpi').map((id) => widgetRenderers[id]())}
        </Box>

        <Typography component="h2" className="agency-dashboard__section-title">{strings.ATTENTION_TITLE}</Typography>
        <Box className="agency-dashboard__attention">
          {orderedVisible('attention').map((id) => widgetRenderers[id]())}
        </Box>

        <Box className="agency-dashboard__content">
          <div className="agency-dashboard__lists">
            {orderedVisible('lists').map((id) => widgetRenderers[id]())}
          </div>
          <Card className="agency-dashboard__panel agency-dashboard__shortcuts">
            <CardContent>
              <Typography component="h2" className="agency-dashboard__panel-title">{strings.QUICK_ACCESS}</Typography>
              <Typography className="agency-dashboard__panel-copy">{strings.DAILY_TOOLS}</Typography>
              <Stack spacing={1.25} className="agency-dashboard__shortcut-list">
                <Shortcut label={strings.PLANNING} detail={strings.CHECK_AVAILABILITY} flipIcon={isAr} onClick={() => navigate('/calendar')} />
                <Shortcut label={strings.FLEET} detail={strings.MANAGE_VEHICLES} flipIcon={isAr} onClick={() => navigate('/cars')} />
                <Shortcut label={strings.CLIENTS} detail={strings.MANAGE_CLIENTS} flipIcon={isAr} onClick={() => navigate('/clients')} />
                <Shortcut label={strings.MAINTENANCE} detail={strings.MANAGE_MAINTENANCE} flipIcon={isAr} onClick={() => navigate('/maintenance')} />
                <Shortcut label={strings.PAYMENTS} detail={strings.MANAGE_PAYMENTS} flipIcon={isAr} onClick={() => navigate('/payments')} />
                <Shortcut label={strings.CASH_JOURNAL} detail={strings.REVIEW_CASH} flipIcon={isAr} onClick={() => navigate('/caisse')} />
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </div>
    </Layout>
  )
}

interface ShortcutProps {
  label: string
  detail: string
  onClick: () => void
  flipIcon?: boolean
}

const Shortcut = ({ label, detail, onClick, flipIcon }: ShortcutProps) => (
  <button type="button" className="agency-dashboard__shortcut" onClick={onClick}>
    <span><strong>{label}</strong><small>{detail}</small></span>
    {flipIcon ? <ArrowBackRoundedIcon /> : <ArrowForwardRoundedIcon />}
  </button>
)

export default Dashboard
