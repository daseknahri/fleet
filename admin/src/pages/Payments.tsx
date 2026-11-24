import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, TextField, Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import Layout from '@/components/Layout'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import AccessDenied from '@/components/AccessDenied'
import * as BookingService from '@/services/BookingService'
import * as SupplierService from '@/services/SupplierService'
import * as RentalPaymentService from '@/services/RentalPaymentService'
import * as UserService from '@/services/UserService'
import * as helper from '@/utils/helper'
import env from '@/config/env.config'
import { strings } from '@/lang/payments'
import HelpIcon from '@/components/HelpIcon'

import '@/assets/css/payments.css'

interface PaymentForm {
  booking: string
  date: string
  amount: string
  method: bookcarsTypes.RentalPaymentMethod
  purpose: bookcarsTypes.RentalPaymentPurpose
  // F6 / W3 P-8 — a debit is a manual debit / standalone refund entry
  // (ledger only, accountant-or-above, reason required).
  direction: bookcarsTypes.RentalPaymentDirection
  reason: string
  reference: string
  note: string
}

const emptyForm = (): PaymentForm => ({
  booking: '', date: new Date().toISOString().slice(0, 10), amount: '',
  method: bookcarsTypes.RentalPaymentMethod.Cash, purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
  direction: bookcarsTypes.RentalPaymentDirection.Credit, reason: '', reference: '', note: '',
})

// F6 / W3 X-1 — the payments table is server-paginated.
const PAGE_SIZE = 50

const getBooking = (payment: bookcarsTypes.RentalPayment): bookcarsTypes.Booking | undefined => (
  typeof payment.booking === 'string' ? undefined : payment.booking
)

// Visible contract label: the human reference (GA-PAR-02) when the booking
// has one, otherwise the shortened _id the page used before.
const bookingLabel = (booking?: bookcarsTypes.Booking) => booking?.reference || (booking?._id || '').slice(-8).toUpperCase() || '—'

const carName = (booking?: bookcarsTypes.Booking) => {
  if (!booking || typeof booking.car === 'string') {
    return '—'
  }
  return `${booking.car.name}${booking.car.licensePlate ? ` ·· ${booking.car.licensePlate}` : ''}`
}

const customerName = (booking?: bookcarsTypes.Booking) => (
  booking?.driver && typeof booking.driver !== 'string' ? booking.driver.fullName || booking.driver.email || '—' : '—'
)

const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}

const formatDate = (date: Date) => new Intl.DateTimeFormat(uiLocale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date))

const formatAmount = (amount: number) => `${new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 2 }).format(amount)} ${env.CURRENCY}`

// GH-02 — the extended receivable row: a local extension of the
// shared OverdueReceivableRow until the shared type gains these
// fields (see the optional types script). Payments.tsx reads the new
// fields through this cast.
interface ReceivableRow extends bookcarsTypes.OverdueReceivableRow {
  daysOverdue: number
  paymentDueAt?: string | Date
  daysToPaymentDue: number | null
  depositHeld: number
  lastRemindedAt?: string | Date
  reminderCount: number
  paidInFull: boolean
  paidRent: number
  contractTotal: number
  ageBucket: string
  lifecycle?: bookcarsTypes.ContractLifecycle
  status?: bookcarsTypes.BookingStatus
  pickupAt?: string | Date
  holdExpiresAt?: string | Date
  actions: { canTakePayment: boolean, canConfirm: boolean, canCancel: boolean, canMarkNoShow: boolean }
}

const Payments = () => {
  const agencyPermissions = useAgencyPermissions()
  const paymentsDenied = !!agencyPermissions?.loaded && !agencyPermissions.can(AgencyPermission.ReadPayments)
  const canRecordPayments = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.RecordPayments)
  const [bookings, setBookings] = useState<bookcarsTypes.Booking[]>([])
  const [payments, setPayments] = useState<bookcarsTypes.RentalPayment[]>([])
  const [collections, setCollections] = useState<bookcarsTypes.CollectionsSummary | null>(null)
  // F6 / W3 P-3 — the receivables table from the server's shared
  // outstanding definition (null until the endpoint answers).
  const [serverOverdue, setServerOverdue] = useState<bookcarsTypes.OverdueReceivableResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(false)
  const [form, setForm] = useState<PaymentForm>(emptyForm)
  // F6 / W3 X-1 — server pagination state for the payments table.
  const [page, setPage] = useState(1)
  const [paymentsTotal, setPaymentsTotal] = useState(0)
  // F6 / W3 P-8 — the Pending entry being edited (null = new entry).
  const [editingPayment, setEditingPayment] = useState<bookcarsTypes.RentalPayment | null>(null)
  // F6 / W3 X-1 — posted totals for the booking selected in the dialog,
  // fetched on demand (the list is paginated now, so no full-list totals
  // exist on the page). Null until the fetch answers.
  const [selectedTotals, setSelectedTotals] = useState<{ rent: number, deposit: number } | null>(null)
  const [reversingId, setReversingId] = useState('')
  const [notice, setNotice] = useState('')
  // Audit-fix 2026-11-24 (F-02) — a payment whose confirmation was
  // blocked (e.g. an overdue maintenance schedule): the 201 carries the
  // conflict, and the manager retries from here once it is cleared.
  const [refreshConflict, setRefreshConflict] = useState<{ bookingId: string, reason: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const navigate = useNavigate()
  // GH-02 / Wave 3.1 + GH-11 — Payments tabs: the receivables chase
  // ('receivables', the morning view), the ledger ('payments') and
  // the pending refunds ('refunds').
  type PaymentsTab = 'payments' | 'receivables' | 'refunds'
  type ReceivablesFilter = 'all' | 'overdue-due-soon' | 'overdue' | 'due-soon' | 'confirmed-unpaid' | 'holds-expiring' | 'paid-in-full' | 'age-current' | 'age-1-7' | 'age-8-30' | 'age-30-plus'
  const [activeTab, setActiveTab] = useState<PaymentsTab>('receivables')
  const [receivablesFilter, setReceivablesFilter] = useState<ReceivablesFilter>('overdue-due-soon')
  const [pendingRefunds, setPendingRefunds] = useState<RentalPaymentService.PendingRefundsResponse | null>(null)
  const [confirmingId, setConfirmingId] = useState('')
  const [noShowId, setNoShowId] = useState('')
  const reversalInFlight = useRef<Set<string>>(new Set())
  // Keep one key per payment interaction so a lost response can be safely retried.
  // A new payment ID gets a new key; the server remains the final idempotency authority.
  const reversalKeys = useRef<Record<string, string>>({})
  // Wave 1.5 — one idempotency key per new-payment dialog session (same
  // pattern as reversalKeys): a retry after a lost response re-sends the
  // SAME key, so the server replays the original payment instead of
  // posting a second one. A fresh UUID per save attempt defeated the
  // server-side dedupe.
  const createKey = useRef<string>('')

  const reload = useCallback(async (user?: bookcarsTypes.User) => {
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
      const [bookingResult, paymentPage] = await Promise.all([
        BookingService.getBookings({ suppliers: supplierIds, statuses: Object.values(bookcarsTypes.BookingStatus) }, 1, 1000),
        RentalPaymentService.list({ page: 1, size: PAGE_SIZE }),
      ])
      setBookings(bookingResult?.[0]?.resultData || [])
      // F6 / W3 X-1 — the table is server-paginated; the service returns
      // the envelope when page/size are given (a bare array only for the
      // legacy no-params call, which this page no longer makes).
      if (Array.isArray(paymentPage)) {
        setPayments(paymentPage)
        setPaymentsTotal(paymentPage.length)
      } else {
        setPayments(paymentPage.rows)
        setPaymentsTotal(paymentPage.total)
      }
      setPage(1)
      // GA-PAR-17 — collections KPI (dictionary v2026-11-15.1). A failure
      // degrades this card only, never the page.
      try {
        setCollections(await RentalPaymentService.collectionsSummary())
      } catch {
        setCollections(null)
      }
      // GH-11 — pending wire/manual refunds. A failure leaves the
      // tab empty rather than breaking the page. (The receivables
      // table itself is fetched by the filter effect below, so the
      // default overdue + due-today view applies on mount.)
      try {
        setPendingRefunds(await RentalPaymentService.pendingRefunds())
      } catch {
        setPendingRefunds(null)
      }
    } catch (error) {
      setLoadError(true)
      helper.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  const onLoad = reload

  // GH-02 — the receivables table is fetched per filter (the
  // 'overdue-due-soon' default view fetches 'all' and narrows
  // client-side, since it is the union of two server filters).
  const refreshReceivables = useCallback(async () => {
    try {
      setServerOverdue(await RentalPaymentService.overdue(receivablesFilter === 'overdue-due-soon' ? { filter: 'all' } : { filter: receivablesFilter }))
    } catch {
      setServerOverdue(null)
    }
  }, [receivablesFilter])

  useEffect(() => {
    void refreshReceivables()
  }, [refreshReceivables])

  // F6 / W3 X-1 — the dialog's caps come from an on-demand fetch of
  // the selected booking's payments (see the effect below): the list is
  // paginated now, so the page no longer holds the full-list totals.
  // Only posted (or legacy status-less) payments are money received:
  // pending counter entries never count toward the amount due, and an
  // annulled reversal pair counts as zero - the same rule the backend
  // posted sums apply (GAQ12B2-D3).
  useEffect(() => {
    if (!dialogOpen || !form.booking) {
      setSelectedTotals(null)
      return
    }
    let cancelled = false
    RentalPaymentService.list({ booking: form.booking, size: 100 }).then((res) => {
      if (cancelled) {
        return
      }
      const rows = Array.isArray(res) ? res : res.rows
      const totals = rows.reduce((acc, payment) => {
        if (payment.status && payment.status !== bookcarsTypes.RentalPaymentStatus.Posted) {
          return acc
        }
        const signedAmount = payment.direction === bookcarsTypes.RentalPaymentDirection.Debit ? -payment.amount : payment.amount
        if ((payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent) === bookcarsTypes.RentalPaymentPurpose.Deposit) {
          acc.deposit += signedAmount
        } else {
          acc.rent += signedAmount
        }
        return acc
      }, { rent: 0, deposit: 0 })
      setSelectedTotals(totals)
    }).catch(() => {
      if (!cancelled) {
        setSelectedTotals(null)
      }
    })
    return () => { cancelled = true }
  }, [dialogOpen, form.booking])

  // F6 / W3 P-3 — the receivables table comes from the server's shared
  // outstanding definition (dictionary v2026-11-15.1): rentalTotal +
  // APPROVED charges − posted rent, overdue per the shared due rule.
  // The client-side fallback that used to live here needed the full
  // payment list; the list is server-paginated now (X-1), so the
  // endpoint is the single source — when it fails, the table stays
  // empty and the OVERDUE card shows '—' rather than a wrong number.
  // GH-02 — the full extended rows (cast until the shared type
  // gains the new fields) + the paid-in-full rows from the same
  // response.
  const receivableRows = (serverOverdue?.rows || []) as unknown as ReceivableRow[]
  const paidInFullRows = ((serverOverdue || {}) as unknown as { paidInFullRows?: ReceivableRow[] }).paidInFullRows || []
  const overdueRows = receivableRows.map((row) => ({
    booking: row.booking,
    outstanding: row.outstandingBalance,
    depositDue: row.depositDue,
    dueAt: row.dueAt ? new Date(row.dueAt) : undefined,
    overdue: row.overdue,
  }))
  // The default view (overdue + due today/tomorrow) is the union of
  // two server filters, narrowed client-side from the 'all' fetch.
  const visibleReceivableRows = receivablesFilter === 'overdue-due-soon'
    ? receivableRows.filter((row) => row.overdue || (row.daysToPaymentDue !== null && row.daysToPaymentDue >= 0 && row.daysToPaymentDue <= 1))
    : receivablesFilter === 'paid-in-full' ? paidInFullRows : receivableRows

  // The OVERDUE card sums only the rows whose due date has passed;
  // the table itself lists every outstanding receivable.
  const overdueTotal = serverOverdue ? serverOverdue.overdueTotal : null

  // F6 / W3 X-1 — the TOTAL card is the server's net posted total
  // (collections summary): the paged list cannot sum it client-side.
  const postedNetTotal = collections?.postedNetTotal ?? null

  // A booking can take a payment when it still owes rent (it appears
  // in the server receivables table) or still owes a deposit (its
  // snapshot carries a deposit — the dialog's on-demand totals show
  // the true remaining and block the save when it is 0). When the
  // receivables endpoint failed, every live booking is offered and the
  // dialog caps decide. Paid/PaidInFull bookings are never offered.
  const overdueBookingIds = new Set(overdueRows.map((row) => row.booking._id))
  const eligibleBookings = bookings.filter((booking) => booking._id
    && booking.price !== undefined
    && ![bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled,
      bookcarsTypes.BookingStatus.Paid, bookcarsTypes.BookingStatus.PaidInFull].includes(booking.status)
    && (overdueBookingIds.has(booking._id)
      || Number(booking.financialSnapshot?.depositAmount || 0) > 0
      || !serverOverdue))

  const filtered = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase()
    if (!query) {
      return payments
    }
    return payments.filter((payment) => {
      const booking = getBooking(payment)
      const contract = booking?.reference || booking?._id || (typeof payment.booking === 'string' ? payment.booking : '')
      return `${contract} ${customerName(booking)} ${carName(booking)} ${payment.reference || ''} ${payment.note || ''}`.toLocaleLowerCase().includes(query)
    })
  }, [payments, keyword])

  const selectedBooking = bookings.find((booking) => booking._id === form.booking)
  const selectedFinancialSnapshot = selectedBooking?.financialSnapshot
  // Caps for the dialog, from the on-demand posted totals (null until
  // the fetch answers — the server re-enforces both caps on save).
  // A credit is capped by what remains; a debit by what was recorded.
  const remainingRent = selectedTotals
    ? Math.max(0, Number(selectedFinancialSnapshot?.rentalTotal || selectedBooking?.price || 0) - selectedTotals.rent)
    : null
  const remainingDeposit = selectedTotals
    ? Math.max(0, Number(selectedFinancialSnapshot?.depositAmount || 0) - selectedTotals.deposit)
    : null
  const recordedRent = selectedTotals?.rent ?? null
  const recordedDeposit = selectedTotals?.deposit ?? null
  const remaining = form.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit ? remainingDeposit : remainingRent
  const recorded = form.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit ? recordedDeposit : recordedRent
  const cap = form.direction === bookcarsTypes.RentalPaymentDirection.Debit ? recorded : remaining

  // F6 / W3 P-8 — in edit mode the edited booking is offered even when
  // it is no longer eligible for a new payment.
  const dialogBookings = editingPayment && selectedBooking
    ? [selectedBooking, ...eligibleBookings.filter((booking) => booking._id !== selectedBooking._id)]
    : eligibleBookings

  const openNew = (bookingId?: string) => {
    setEditingPayment(null)
    createKey.current = globalThis.crypto.randomUUID()
    setForm({ ...emptyForm(), booking: bookingId || eligibleBookings[0]?._id || '' })
    setFormError(false)
    setDialogOpen(true)
  }

  // F6 / W3 P-8 — edit a stuck Pending entry, prefilled in the same
  // dialog. The direction is fixed (a credit never becomes a debit by
  // editing); the booking is offered even when it is no longer
  // eligible for a new payment.
  const openEdit = (payment: bookcarsTypes.RentalPayment) => {
    const bookingId = typeof payment.booking === 'string' ? payment.booking : payment.booking?._id || ''
    setEditingPayment(payment)
    setForm({
      booking: bookingId,
      date: new Date(payment.date).toISOString().slice(0, 10),
      amount: String(payment.amount),
      method: payment.method,
      purpose: payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent,
      direction: payment.direction || bookcarsTypes.RentalPaymentDirection.Credit,
      reason: '',
      reference: payment.reference || '',
      note: payment.note || '',
    })
    setFormError(false)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    const amount = Number(form.amount)
    // F6 / W3 P-8 — a debit needs a recorded reason (>= 3 chars); the
    // cap is the recorded total for a debit, the remaining balance for
    // a credit. The server re-enforces both on save.
    if (!form.booking || !form.date || !Number.isFinite(amount) || amount <= 0
      || (cap !== null && amount > cap + 0.005)
      || (form.direction === bookcarsTypes.RentalPaymentDirection.Debit && form.reason.trim().length < 3)) {
      setFormError(true)
      return
    }
    setSaving(true)
    setFormError(false)
    try {
      if (editingPayment?._id) {
        const payment = await RentalPaymentService.update(editingPayment._id, {
          date: new Date(`${form.date}T12:00:00`),
          amount,
          method: form.method,
          purpose: form.purpose,
          reference: form.reference.trim(),
          note: form.note.trim(),
        })
        setPayments((rows) => rows.map((row) => (row._id === payment._id ? payment : row)))
        setDialogOpen(false)
        setEditingPayment(null)
        setNotice('')
        return
      }
      const payment = await RentalPaymentService.create({
        booking: form.booking,
        date: new Date(`${form.date}T12:00:00`),
        amount,
        method: form.method,
        purpose: form.purpose,
        direction: form.direction,
        reason: form.reason.trim() || undefined,
        idempotencyKey: createKey.current || (createKey.current = globalThis.crypto.randomUUID()),
        reference: form.reference.trim(),
        note: form.note.trim(),
      })
      setPayments((rows) => [payment, ...rows])
      setPaymentsTotal((total) => total + 1)
      setDialogOpen(false)
      createKey.current = ''
      setNotice('')
      if (payment.statusRefresh?.conflict) {
        setRefreshConflict({ bookingId: form.booking, reason: payment.statusRefresh.conflictReason || '' })
      } else {
        setRefreshConflict(null)
      }
    } catch (error) {
      helper.error(error, helper.getErrorMessage(error, strings.SAVE_ERROR))
      setFormError(true)
    } finally {
      setSaving(false)
    }
  }

  // Audit-fix 2026-11-24 (F-02) — retry a blocked payment confirmation
  // once the blocking condition is cleared. The endpoint re-runs the
  // refresh and returns its outcome; a confirmed booking clears the
  // warning, a still-blocked one refreshes the reason.
  const handleRetryConfirmation = async () => {
    if (!refreshConflict || refreshing) {
      return
    }
    setRefreshing(true)
    try {
      const result = await RentalPaymentService.refreshPaymentStatus(refreshConflict.bookingId)
      if (result.conflict) {
        setRefreshConflict({ bookingId: refreshConflict.bookingId, reason: result.conflictReason || refreshConflict.reason })
      } else {
        setRefreshConflict(null)
        setNotice(strings.REFRESH_CONFIRMED)
      }
    } catch (error) {
      helper.error(error)
    } finally {
      setRefreshing(false)
    }
  }

  // F6 / W3 P-8 — delete a stuck Pending entry (never-posted money).
  const handleDelete = async (payment: bookcarsTypes.RentalPayment) => {
    if (!payment._id || !globalThis.window.confirm(strings.DELETE_CONFIRM)) {
      return
    }
    try {
      await RentalPaymentService.remove(payment._id)
      setPayments((rows) => rows.filter((row) => row._id !== payment._id))
      setPaymentsTotal((total) => Math.max(0, total - 1))
      setNotice(strings.DELETED)
    } catch (error) {
      helper.error(error, helper.getErrorMessage(error, strings.SAVE_ERROR))
    }
  }

  // F6 / W3 X-1 — the pager fetches the requested page from the server.
  const goToPage = async (nextPage: number) => {
    if (nextPage < 1 || nextPage === page) {
      return
    }
    setLoading(true)
    try {
      const res = await RentalPaymentService.list({ page: nextPage, size: PAGE_SIZE })
      if (Array.isArray(res)) {
        setPayments(res)
        setPaymentsTotal(res.length)
      } else {
        setPayments(res.rows)
        setPaymentsTotal(res.total)
      }
      setPage(nextPage)
    } catch (error) {
      helper.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleReverse = async (payment: bookcarsTypes.RentalPayment) => {
    if (!payment._id || !globalThis.window.confirm(strings.REVERSE_CONFIRM)) {
      return
    }
    if (reversalInFlight.current.has(payment._id)) {
      return
    }
    reversalInFlight.current.add(payment._id)
    setReversingId(payment._id)
    setNotice('')
    try {
      const idempotencyKey = reversalKeys.current[payment._id]
        || (reversalKeys.current[payment._id] = globalThis.crypto.randomUUID())
      const reversal = await RentalPaymentService.reverse(payment._id, idempotencyKey, strings.REVERSE)
      setPayments((rows) => [reversal, ...rows.map((row) => (
        row._id === payment._id ? { ...row, status: bookcarsTypes.RentalPaymentStatus.Reversed } : row
      ))])
      setNotice(strings.REVERSED)
    } catch (error) {
      helper.error(error, helper.getErrorMessage(error, strings.SAVE_ERROR))
    } finally {
      reversalInFlight.current.delete(payment._id)
      setReversingId('')
    }
  }

  const handleExportCsv = async () => {
    try {
      const blob = await RentalPaymentService.exportCsv()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'gestion-auto-payments.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      helper.error(error)
    }
  }

  // GH-02 — receivables action column. Take payment reuses the
  // existing dialog (openNew); Confirm / Mark no-show call the
  // booking endpoints and refresh the table; Cancel opens the booking
  // page, where the staff-cancel flow (reason + explicit refund
  // decision) lives.
  const handleConfirmReservation = async (bookingId?: string) => {
    if (!bookingId || confirmingId) {
      return
    }
    setConfirmingId(bookingId)
    try {
      await BookingService.confirmReservation(bookingId)
      setNotice(strings.CONFIRMED_OK)
      await refreshReceivables()
    } catch (error) {
      helper.error(error)
    } finally {
      setConfirmingId('')
    }
  }

  const handleMarkNoShow = async (bookingId?: string) => {
    if (!bookingId || noShowId || !globalThis.window.confirm(strings.NO_SHOW_CONFIRM)) {
      return
    }
    setNoShowId(bookingId)
    try {
      await BookingService.markNoShow(bookingId)
      setNotice(strings.NO_SHOW_DONE)
      await refreshReceivables()
    } catch (error) {
      helper.error(error)
    } finally {
      setNoShowId('')
    }
  }

  const ageLabel = (row: ReceivableRow) => {
    if (row.overdue) {
      return strings.OVERDUE_BY.replace('{days}', String(row.daysOverdue))
    }
    if (row.daysToPaymentDue === 0) {
      return strings.DUE_TODAY
    }
    if (row.daysToPaymentDue !== null && row.daysToPaymentDue > 0) {
      return strings.DUE_IN.replace('{days}', String(row.daysToPaymentDue))
    }
    return '—'
  }

  const methodLabel = (method: bookcarsTypes.RentalPaymentMethod) => {
    switch (method) {
      case bookcarsTypes.RentalPaymentMethod.BankTransfer: return strings.BANK
      case bookcarsTypes.RentalPaymentMethod.Card: return strings.CARD
      case bookcarsTypes.RentalPaymentMethod.Other: return strings.OTHER
      default: return strings.CASH
    }
  }

  const purposeLabel = (purpose: bookcarsTypes.RentalPaymentPurpose) => purpose === bookcarsTypes.RentalPaymentPurpose.Deposit ? strings.DEPOSIT : strings.RENT
  const statusLabel = (status?: bookcarsTypes.RentalPaymentStatus) => status === bookcarsTypes.RentalPaymentStatus.Reversed ? strings.REVERSED : status === bookcarsTypes.RentalPaymentStatus.Pending ? strings.PENDING : strings.POSTED
  const setField = (key: keyof PaymentForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }))
  }

  return (
    <Layout strict onLoad={onLoad}>
      {paymentsDenied ? <AccessDenied /> : (
      <div className="agency-payments">
        <div className="agency-payments__heading">
          <div>
            <Typography component="p" className="agency-payments__eyebrow">{strings.EYEBROW}</Typography>
            <Typography component="h1" className="agency-payments__title">{strings.TITLE}<HelpIcon text={strings.HELP_PAYMENTS} /></Typography>
            <Typography className="agency-payments__subtitle">{strings.SUBTITLE}</Typography>
          </div>
          {canRecordPayments && <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => openNew()} disabled={!eligibleBookings.length}>{strings.ADD}</Button>}
        </div>
        {loadError && <Alert severity="error">{strings.LOAD_ERROR}</Alert>}
        {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
        {refreshConflict && (
          <Alert
            severity="warning"
            action={<Button size="small" disabled={refreshing} onClick={() => void handleRetryConfirmation()}>{strings.RETRY_CONFIRMATION}</Button>}
          >
            {strings.REFRESH_CONFLICT.replace('{reason}', refreshConflict.reason)}
          </Alert>
        )}
        <div className="agency-payments__summary">
          <Card><CardContent><span className="agency-payments__summary-icon"><PaymentsRoundedIcon /></span><small>{strings.TOTAL}</small><strong>{loading || postedNetTotal === null ? '—' : formatAmount(postedNetTotal)}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-payments__summary-icon">T</span><small>{strings.ENTRIES}</small><strong>{loading ? '—' : paymentsTotal}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-payments__summary-icon agency-payments__summary-icon--warning"><WarningAmberRoundedIcon /></span><small>{strings.OVERDUE}</small><strong>{loading || overdueTotal === null ? '—' : formatAmount(overdueTotal)}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-payments__summary-icon"><PaymentsRoundedIcon /></span><small>{strings.COLLECTIONS}</small><strong>{loading || !collections ? '—' : `${formatAmount(collections.collected)} / ${formatAmount(collections.contractAmount)}`}</strong>{collections && <small>{strings.COLLECTION_RATE}: {collections.collectionRatePct === null ? '—' : `${collections.collectionRatePct.toFixed(2)}%`}</small>}</CardContent></Card>
        </div>
        <div className="agency-payments__tabs" role="tablist">
          <Button variant={activeTab === 'receivables' ? 'contained' : 'outlined'} size="small" onClick={() => setActiveTab('receivables')}>{strings.TAB_RECEIVABLES}</Button>
          <Button variant={activeTab === 'payments' ? 'contained' : 'outlined'} size="small" onClick={() => setActiveTab('payments')}>{strings.TAB_PAYMENTS}</Button>
          <Button variant={activeTab === 'refunds' ? 'contained' : 'outlined'} size="small" onClick={() => setActiveTab('refunds')}>{strings.TAB_REFUNDS}{pendingRefunds && pendingRefunds.count > 0 ? ` (${pendingRefunds.count})` : ''}</Button>
        </div>
        {activeTab === 'receivables' && (
        <section className="agency-payments__panel agency-payments__receivables">
          <div className="agency-payments__panel-title">{strings.RECEIVABLES}<HelpIcon text={strings.HELP_RECEIVABLES} /></div>
          <div className="agency-payments__toolbar">
            <TextField select size="small" label={strings.FILTER_LABEL} value={receivablesFilter} onChange={(event) => setReceivablesFilter(event.target.value as typeof receivablesFilter)}>
              <MenuItem value="overdue-due-soon">{strings.FILTER_OVERDUE_DUE_SOON}</MenuItem>
              <MenuItem value="all">{strings.FILTER_ALL}</MenuItem>
              <MenuItem value="overdue">{strings.FILTER_OVERDUE}</MenuItem>
              <MenuItem value="due-soon">{strings.FILTER_DUE_SOON}</MenuItem>
              <MenuItem value="confirmed-unpaid">{strings.FILTER_CONFIRMED_UNPAID}</MenuItem>
              <MenuItem value="holds-expiring">{strings.FILTER_HOLDS_EXPIRING}</MenuItem>
              <MenuItem value="paid-in-full">{strings.FILTER_PAID_IN_FULL}</MenuItem>
              <MenuItem value="age-current">{strings.FILTER_AGE_CURRENT}</MenuItem>
              <MenuItem value="age-1-7">{strings.FILTER_AGE_1_7}</MenuItem>
              <MenuItem value="age-8-30">{strings.FILTER_AGE_8_30}</MenuItem>
              <MenuItem value="age-30-plus">{strings.FILTER_AGE_30_PLUS}</MenuItem>
            </TextField>
          </div>
          <div className="agency-payments__table-head agency-payments__receivables-head"><span>{strings.CONTRACT}</span><span>{strings.CUSTOMER}</span><span>{strings.VEHICLE}</span><span>{strings.OUTSTANDING}</span><span>{strings.PAID}</span><span>{strings.DEPOSIT}</span><span>{strings.DEPOSIT_HELD}</span><span>{strings.DUE}</span><span>{strings.AGE}</span><span>{strings.LAST_REMINDED}</span><span>{strings.ACTIONS}</span></div>
          {loading ? <div className="agency-payments__empty">…</div> : visibleReceivableRows.length === 0 ? (
            <div className="agency-payments__empty"><WarningAmberRoundedIcon /><p>{strings.NO_OVERDUE}</p></div>
          ) : visibleReceivableRows.map((row) => (
            <div className="agency-payments__row agency-payments__receivables-row" key={row.booking._id}>
              <strong data-label={strings.CONTRACT}>{bookingLabel(row.booking)}</strong>
              <span data-label={strings.CUSTOMER}>{customerName(row.booking)}</span>
              <span data-label={strings.VEHICLE}>{carName(row.booking)}</span>
              <strong data-label={strings.OUTSTANDING}>{formatAmount(row.outstandingBalance)}</strong>
              <span data-label={strings.PAID}>{formatAmount(row.paidRent)}</span>
              <span data-label={strings.DEPOSIT}>{formatAmount(row.depositDue)}</span>
              <span data-label={strings.DEPOSIT_HELD}>{formatAmount(row.depositHeld)}</span>
              <span data-label={strings.DUE}>{formatDate(new Date(row.paymentDueAt || row.dueAt || row.booking.to))}</span>
              <span data-label={strings.AGE}>{ageLabel(row)}</span>
              <span data-label={strings.LAST_REMINDED}>{row.lastRemindedAt ? `${formatDate(new Date(row.lastRemindedAt))} (${row.reminderCount})` : '—'}</span>
              <span data-label={strings.ACTIONS}>
                {row.actions.canTakePayment && canRecordPayments && (
                  <Button size="small" variant="outlined" onClick={() => openNew(row.booking._id)}>{strings.TAKE_PAYMENT}</Button>
                )}
                {row.actions.canConfirm && (
                  <Button size="small" variant="outlined" disabled={confirmingId === row.booking._id} onClick={() => handleConfirmReservation(row.booking._id)}>{strings.CONFIRM_RESERVATION}</Button>
                )}
                {row.actions.canCancel && (
                  <Button size="small" variant="outlined" onClick={() => navigate(`/update-booking?b=${row.booking._id}`)}>{strings.OPEN_BOOKING}</Button>
                )}
                {row.actions.canMarkNoShow && (
                  <Button size="small" color="error" variant="outlined" disabled={noShowId === row.booking._id} onClick={() => handleMarkNoShow(row.booking._id)}>{strings.MARK_NO_SHOW}</Button>
                )}
              </span>
            </div>
          ))}
        </section>
        )}
        {activeTab === 'refunds' && (
        <section className="agency-payments__panel agency-payments__receivables">
          <div className="agency-payments__panel-title">{strings.REFUNDS_TITLE}</div>
          <div className="agency-payments__table-head agency-payments__receivables-head"><span>{strings.CONTRACT}</span><span>{strings.CUSTOMER}</span><span>{strings.VEHICLE}</span><span>{strings.AMOUNT}</span><span>{strings.REFUND_METHOD}</span><span>{strings.REFUND_REASON}</span><span>{strings.REFUND_SINCE}</span></div>
          {loading ? <div className="agency-payments__empty">…</div> : !pendingRefunds || pendingRefunds.rows.length === 0 ? (
            <div className="agency-payments__empty"><WarningAmberRoundedIcon /><p>{strings.NO_REFUNDS}</p></div>
          ) : pendingRefunds.rows.map((refund) => (
            <div className="agency-payments__row agency-payments__receivables-row" key={refund.booking._id}>
              <strong data-label={strings.CONTRACT}>{bookingLabel(refund.booking)}</strong>
              <span data-label={strings.CUSTOMER}>{customerName(refund.booking)}</span>
              <span data-label={strings.VEHICLE}>{carName(refund.booking)}</span>
              <strong data-label={strings.AMOUNT}>{formatAmount(refund.amount)}</strong>
              <span data-label={strings.REFUND_METHOD}>{refund.method ? methodLabel(refund.method) : '—'}{refund.wireRefundPending ? ` · ${strings.WIRE_PENDING}` : ''}</span>
              <span data-label={strings.REFUND_REASON}>{refund.reason || '—'}</span>
              <span data-label={strings.REFUND_SINCE}>{refund.since ? formatDate(new Date(refund.since)) : '—'}</span>
            </div>
          ))}
        </section>
        )}
        {activeTab === 'payments' && (
        <section className="agency-payments__panel">
          <div className="agency-payments__toolbar">
            <TextField size="small" fullWidth placeholder={strings.SEARCH} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={handleExportCsv}>{strings.EXPORT_CSV}</Button>
          </div>
          <div className="agency-payments__table-head agency-payments__payments-head"><span>{strings.DATE}</span><span>{strings.CONTRACT}</span><span>{strings.CUSTOMER}</span><span>{strings.VEHICLE}</span><span>{strings.METHOD}</span><span>{strings.PURPOSE}</span><span>{strings.AMOUNT}</span><span>{strings.STATUS}</span><span>{strings.REFERENCE}</span><span>{strings.ACTIONS}</span></div>
          {loading ? <div className="agency-payments__empty">…</div> : filtered.length === 0 ? (
            <div className="agency-payments__empty"><PaymentsRoundedIcon /><p>{strings.EMPTY}</p></div>
          ) : filtered.map((payment) => {
            const booking = getBooking(payment)
            const canReverse = !!payment._id
              && payment.status !== bookcarsTypes.RentalPaymentStatus.Reversed
              && payment.direction !== bookcarsTypes.RentalPaymentDirection.Debit
              && canRecordPayments
            return <div className="agency-payments__row agency-payments__payments-row" key={payment._id}>
              <span data-label={strings.DATE}>{formatDate(payment.date)}</span>
              <strong>{bookingLabel(booking)}</strong>
              <span data-label={strings.CUSTOMER}>{customerName(booking)}</span>
              <span data-label={strings.VEHICLE}>{carName(booking)}</span>
              <span data-label={strings.METHOD}>{methodLabel(payment.method)}</span>
              <span data-label={strings.PURPOSE}>{purposeLabel(payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent)}</span>
              <strong data-label={strings.AMOUNT}>{formatAmount(payment.amount)}</strong>
              <span data-label={strings.STATUS}>{statusLabel(payment.status)}</span>
              <span>{payment.reference || payment.note || '—'}</span>
              <span data-label={strings.ACTIONS}>
                {canReverse && (
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    disabled={reversingId === payment._id}
                    onClick={() => handleReverse(payment)}
                  >
                    {payment.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit ? strings.REVERSE_DEPOSIT : strings.REVERSE}
                  </Button>
                )}
                {payment.status === bookcarsTypes.RentalPaymentStatus.Pending && canRecordPayments && (
                  <>
                    <Button size="small" variant="outlined" onClick={() => openEdit(payment)}>{strings.EDIT}</Button>
                    <Button size="small" color="error" variant="outlined" onClick={() => handleDelete(payment)}>{strings.DELETE}</Button>
                  </>
                )}
              </span>
            </div>
          })}
          {paymentsTotal > 0 && (
            <div className="agency-payments__pager">
              <Button size="small" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>{strings.PREVIOUS}</Button>
              <span>{strings.SHOWING} {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, paymentsTotal)} / {paymentsTotal}</span>
              <Button size="small" disabled={page * PAGE_SIZE >= paymentsTotal || loading} onClick={() => goToPage(page + 1)}>{strings.NEXT}</Button>
            </div>
          )}
        </section>
        )}
      </div>
      )}
      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingPayment ? strings.EDIT_PAYMENT : strings.NEW}</DialogTitle>
        <DialogContent className="agency-payments__form">
          {formError && <Alert severity="error">{strings.SAVE_ERROR}</Alert>}
          <TextField select fullWidth required label={strings.BOOKING} value={form.booking} onChange={setField('booking')}>
            {dialogBookings.map((booking) => <MenuItem key={booking._id} value={booking._id}>
              {bookingLabel(booking)} ·· {carName(booking)} ·· {customerName(booking)}
            </MenuItem>)}
          </TextField>
          <TextField select fullWidth required label={strings.PURPOSE_FIELD} value={form.purpose} onChange={setField('purpose')}>
            <MenuItem value={bookcarsTypes.RentalPaymentPurpose.Rent}>{purposeLabel(bookcarsTypes.RentalPaymentPurpose.Rent)}</MenuItem>
            <MenuItem value={bookcarsTypes.RentalPaymentPurpose.Deposit}>{purposeLabel(bookcarsTypes.RentalPaymentPurpose.Deposit)}</MenuItem>
          </TextField>
          {selectedBooking && <Typography variant="body2" color="text.secondary">{form.direction === bookcarsTypes.RentalPaymentDirection.Debit ? strings.DEBIT_CAP : strings.REMAINING}: {cap === null ? '—' : formatAmount(cap)}{form.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit ? ` · ${strings.REFUNDABLE}` : ''}</Typography>}
          <TextField select fullWidth required label={strings.DIRECTION} value={form.direction} disabled={!!editingPayment} onChange={setField('direction')}>
            <MenuItem value={bookcarsTypes.RentalPaymentDirection.Credit}>{strings.CREDIT}</MenuItem>
            <MenuItem value={bookcarsTypes.RentalPaymentDirection.Debit}>{strings.DEBIT}</MenuItem>
          </TextField>
          {form.direction === bookcarsTypes.RentalPaymentDirection.Debit && !editingPayment && <TextField fullWidth required label={strings.REASON} value={form.reason} onChange={setField('reason')} inputProps={{ maxLength: 1000 }} />}
          <div className="agency-payments__form-grid">
            <TextField fullWidth required type="date" label={strings.DATE_FIELD} value={form.date} onChange={setField('date')} InputLabelProps={{ shrink: true }} />
            <TextField fullWidth required type="number" label={strings.AMOUNT} value={form.amount} onChange={setField('amount')} inputProps={{ min: 0.01, step: 0.01, max: cap ?? undefined }} />
            <TextField select fullWidth required label={strings.METHOD} value={form.method} onChange={setField('method')}>
              {Object.values(bookcarsTypes.RentalPaymentMethod).map((method) => <MenuItem key={method} value={method}>{methodLabel(method)}</MenuItem>)}
            </TextField>
            <TextField fullWidth label={strings.REFERENCE} value={form.reference} onChange={setField('reference')} inputProps={{ maxLength: 160 }} />
          </div>
          <TextField fullWidth multiline minRows={2} label={strings.NOTE} value={form.note} onChange={setField('note')} inputProps={{ maxLength: 1000 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>{strings.CANCEL}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !dialogBookings.length}>{strings.SAVE}</Button>
        </DialogActions>
      </Dialog>
    </Layout>
  )
}

export default Payments
