import React, { useCallback, useMemo, useRef, useState } from 'react'
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

import '@/assets/css/payments.css'

interface PaymentForm {
  booking: string
  date: string
  amount: string
  method: bookcarsTypes.RentalPaymentMethod
  purpose: bookcarsTypes.RentalPaymentPurpose
  reference: string
  note: string
}

const emptyForm = (): PaymentForm => ({
  booking: '', date: new Date().toISOString().slice(0, 10), amount: '',
  method: bookcarsTypes.RentalPaymentMethod.Cash, purpose: bookcarsTypes.RentalPaymentPurpose.Rent, reference: '', note: '',
})

const getBooking = (payment: bookcarsTypes.RentalPayment): bookcarsTypes.Booking | undefined => (
  typeof payment.booking === 'string' ? undefined : payment.booking
)

const bookingIdOf = (booking?: bookcarsTypes.Booking) => booking?._id || (booking ? '' : '')

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

const Payments = () => {
  const agencyPermissions = useAgencyPermissions()
  const paymentsDenied = !!agencyPermissions?.loaded && !agencyPermissions.can(AgencyPermission.ReadPayments)
  const canRecordPayments = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.RecordPayments)
  const [bookings, setBookings] = useState<bookcarsTypes.Booking[]>([])
  const [payments, setPayments] = useState<bookcarsTypes.RentalPayment[]>([])
  const [collections, setCollections] = useState<bookcarsTypes.CollectionsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(false)
  const [form, setForm] = useState<PaymentForm>(emptyForm)
  const [reversingId, setReversingId] = useState('')
  const [notice, setNotice] = useState('')
  const reversalInFlight = useRef<Set<string>>(new Set())
  // Keep one key per payment interaction so a lost response can be safely retried.
  // A new payment ID gets a new key; the server remains the final idempotency authority.
  const reversalKeys = useRef<Record<string, string>>({})

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
      const [bookingResult, paymentRows] = await Promise.all([
        BookingService.getBookings({ suppliers: supplierIds, statuses: Object.values(bookcarsTypes.BookingStatus) }, 1, 1000),
        RentalPaymentService.list(),
      ])
      setBookings(bookingResult?.[0]?.resultData || [])
      setPayments(paymentRows || [])
      // GA-PAR-17 — collections KPI (dictionary v2026-11-11.2). A failure
      // degrades this card only, never the page.
      try {
        setCollections(await RentalPaymentService.collectionsSummary())
      } catch {
        setCollections(null)
      }
    } catch (error) {
      setLoadError(true)
      helper.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  const onLoad = reload

  const paymentTotals = useMemo(() => payments.reduce<Record<string, { rent: number, deposit: number }>>((totals, payment) => {
    // Only posted (or legacy status-less) payments are money received:
    // pending counter entries never count toward the amount due, and an
    // annulled reversal pair counts as zero - the same rule the backend
    // posted sums apply (GAQ12B2-D3).
    if (payment.status && payment.status !== bookcarsTypes.RentalPaymentStatus.Posted) {
      return totals
    }
    const bookingId = typeof payment.booking === 'string' ? payment.booking : payment.booking?._id
    if (bookingId) {
      const purpose = payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent
      const signedAmount = payment.direction === bookcarsTypes.RentalPaymentDirection.Debit ? -payment.amount : payment.amount
      const current = totals[bookingId] || { rent: 0, deposit: 0 }
      current[purpose === bookcarsTypes.RentalPaymentPurpose.Deposit ? 'deposit' : 'rent'] += signedAmount
      totals[bookingId] = current
    }
    return totals
  }, {}), [payments])

  // A receivable is overdue when the rental end has passed and the rental balance is not fully posted.
  // Refundable deposits are deliberately excluded: they are not rental receivable.
  const overdueRows = useMemo(() => bookings
    .filter((booking) => {
      const id = bookingIdOf(booking)
      if (!id || [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled].includes(booking.status)) {
        return false
      }
      const rentalTotal = Number(booking.financialSnapshot?.rentalTotal || booking.price || 0)
      const postedRent = paymentTotals[id]?.rent || 0
      return new Date(booking.to).getTime() <= new Date().getTime() && rentalTotal - postedRent > 0.005
    })
    .map((booking) => {
      const id = bookingIdOf(booking)
      const rentalTotal = Number(booking.financialSnapshot?.rentalTotal || booking.price || 0)
      return {
        booking,
        outstanding: Math.max(0, rentalTotal - (paymentTotals[id]?.rent || 0)),
        depositHeld: Math.max(0, Number(booking.financialSnapshot?.depositAmount || 0) - (paymentTotals[id]?.deposit || 0)),
      }
    })
    .sort((a, b) => b.outstanding - a.outstanding), [bookings, paymentTotals])

  const overdueTotal = overdueRows.reduce((sum, row) => sum + row.outstanding, 0)
  const postedNetTotal = payments.reduce((sum, payment) => {
    if (payment.status && payment.status !== bookcarsTypes.RentalPaymentStatus.Posted) {
      return sum
    }
    return sum + (payment.direction === bookcarsTypes.RentalPaymentDirection.Debit ? -payment.amount : payment.amount)
  }, 0)

  const eligibleBookings = bookings.filter((booking) => booking._id
    && booking.price !== undefined
    && ![bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled,
      bookcarsTypes.BookingStatus.Paid, bookcarsTypes.BookingStatus.PaidInFull].includes(booking.status)
    && Number(booking.financialSnapshot?.rentalTotal || booking.price) - (paymentTotals[booking._id]?.rent || 0) > 0.005)

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
  const remainingRent = form.booking
    ? Math.max(0, Number(selectedFinancialSnapshot?.rentalTotal || selectedBooking?.price || 0) - (paymentTotals[form.booking]?.rent || 0))
    : 0
  const remainingDeposit = form.booking
    ? Math.max(0, Number(selectedFinancialSnapshot?.depositAmount || 0) - (paymentTotals[form.booking]?.deposit || 0))
    : 0
  const remaining = form.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit ? remainingDeposit : remainingRent

  const openNew = (bookingId?: string) => {
    setForm({ ...emptyForm(), booking: bookingId || eligibleBookings[0]?._id || '' })
    setFormError(false)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    const amount = Number(form.amount)
    if (!form.booking || !form.date || !Number.isFinite(amount) || amount <= 0 || amount > remaining + 0.005) {
      setFormError(true)
      return
    }
    setSaving(true)
    setFormError(false)
    try {
      const payment = await RentalPaymentService.create({
        booking: form.booking,
        date: new Date(`${form.date}T12:00:00`),
        amount,
        method: form.method,
        purpose: form.purpose,
        idempotencyKey: globalThis.crypto.randomUUID(),
        reference: form.reference.trim(),
        note: form.note.trim(),
      })
      setPayments((rows) => [payment, ...rows])
      setDialogOpen(false)
      setNotice('')
    } catch (error) {
      helper.error(error, helper.getErrorMessage(error, strings.SAVE_ERROR))
      setFormError(true)
    } finally {
      setSaving(false)
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
            <Typography component="h1" className="agency-payments__title">{strings.TITLE}</Typography>
            <Typography className="agency-payments__subtitle">{strings.SUBTITLE}</Typography>
          </div>
          {canRecordPayments && <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => openNew()} disabled={!eligibleBookings.length}>{strings.ADD}</Button>}
        </div>
        {loadError && <Alert severity="error">{strings.LOAD_ERROR}</Alert>}
        {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
        <div className="agency-payments__summary">
          <Card><CardContent><span className="agency-payments__summary-icon"><PaymentsRoundedIcon /></span><small>{strings.TOTAL}</small><strong>{loading ? '—' : formatAmount(postedNetTotal)}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-payments__summary-icon">T</span><small>{strings.ENTRIES}</small><strong>{loading ? '—' : payments.length}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-payments__summary-icon agency-payments__summary-icon--warning"><WarningAmberRoundedIcon /></span><small>{strings.OVERDUE}</small><strong>{loading ? '—' : formatAmount(overdueTotal)}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-payments__summary-icon"><PaymentsRoundedIcon /></span><small>{strings.COLLECTIONS}</small><strong>{loading || !collections ? '—' : `${formatAmount(collections.collected)} / ${formatAmount(collections.contractAmount)}`}</strong>{collections && <small>{strings.COLLECTION_RATE}: {collections.collectionRatePct === null ? '—' : `${collections.collectionRatePct.toFixed(2)}%`}</small>}</CardContent></Card>
        </div>
        <section className="agency-payments__panel agency-payments__receivables">
          <div className="agency-payments__panel-title">{strings.RECEIVABLES}</div>
          <div className="agency-payments__table-head agency-payments__receivables-head"><span>{strings.CONTRACT}</span><span>{strings.CUSTOMER}</span><span>{strings.VEHICLE}</span><span>{strings.OUTSTANDING}</span><span>{strings.DEPOSIT}</span><span>{strings.DATE}</span></div>
          {loading ? <div className="agency-payments__empty">…</div> : overdueRows.length === 0 ? (
            <div className="agency-payments__empty"><WarningAmberRoundedIcon /><p>{strings.NO_OVERDUE}</p></div>
          ) : overdueRows.map((row) => (
            <div className="agency-payments__row agency-payments__receivables-row" key={row.booking._id}>
              <strong data-label={strings.CONTRACT}>{bookingLabel(row.booking)}</strong>
              <span data-label={strings.CUSTOMER}>{customerName(row.booking)}</span>
              <span data-label={strings.VEHICLE}>{carName(row.booking)}</span>
              <strong data-label={strings.OUTSTANDING}>{formatAmount(row.outstanding)}</strong>
              <span data-label={strings.DEPOSIT}>{formatAmount(row.depositHeld)}</span>
              <span data-label={strings.DATE}>{formatDate(row.booking.to)}</span>
            </div>
          ))}
        </section>
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
              </span>
            </div>
          })}
        </section>
      </div>
      )}
      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{strings.NEW}</DialogTitle>
        <DialogContent className="agency-payments__form">
          {formError && <Alert severity="error">{strings.SAVE_ERROR}</Alert>}
          <TextField select fullWidth required label={strings.BOOKING} value={form.booking} onChange={setField('booking')}>
            {eligibleBookings.map((booking) => <MenuItem key={booking._id} value={booking._id}>
              {bookingLabel(booking)} ·· {carName(booking)} ·· {customerName(booking)}
            </MenuItem>)}
          </TextField>
          <TextField select fullWidth required label={strings.PURPOSE_FIELD} value={form.purpose} onChange={setField('purpose')}>
            <MenuItem value={bookcarsTypes.RentalPaymentPurpose.Rent}>{purposeLabel(bookcarsTypes.RentalPaymentPurpose.Rent)}</MenuItem>
            <MenuItem value={bookcarsTypes.RentalPaymentPurpose.Deposit}>{purposeLabel(bookcarsTypes.RentalPaymentPurpose.Deposit)}</MenuItem>
          </TextField>
          {selectedBooking && <Typography variant="body2" color="text.secondary">{strings.REMAINING}: {formatAmount(remaining)}{form.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit ? ` · ${strings.REFUNDABLE}` : ''}</Typography>}
          <div className="agency-payments__form-grid">
            <TextField fullWidth required type="date" label={strings.DATE_FIELD} value={form.date} onChange={setField('date')} InputLabelProps={{ shrink: true }} />
            <TextField fullWidth required type="number" label={strings.AMOUNT} value={form.amount} onChange={setField('amount')} inputProps={{ min: 0.01, step: 0.01, max: remaining }} />
            <TextField select fullWidth required label={strings.METHOD} value={form.method} onChange={setField('method')}>
              {Object.values(bookcarsTypes.RentalPaymentMethod).map((method) => <MenuItem key={method} value={method}>{methodLabel(method)}</MenuItem>)}
            </TextField>
            <TextField fullWidth label={strings.REFERENCE} value={form.reference} onChange={setField('reference')} inputProps={{ maxLength: 160 }} />
          </div>
          <TextField fullWidth multiline minRows={2} label={strings.NOTE} value={form.note} onChange={setField('note')} inputProps={{ maxLength: 1000 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>{strings.CANCEL}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !eligibleBookings.length}>{strings.SAVE}</Button>
        </DialogActions>
      </Dialog>
    </Layout>
  )
}

export default Payments
