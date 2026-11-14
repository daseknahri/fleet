import React, { useCallback, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Select, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import Layout from '@/components/Layout'
import AccessDenied from '@/components/AccessDenied'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import * as InvoiceService from '@/services/InvoiceService'
import * as QuoteService from '@/services/QuoteService'
import * as CarService from '@/services/CarService'
import * as BookingService from '@/services/BookingService'
import * as RentalPaymentService from '@/services/RentalPaymentService'
import * as ApprovalService from '@/services/ApprovalService'
import * as SupplierService from '@/services/SupplierService'
import * as UserService from '@/services/UserService'
import * as helper from '@/utils/helper'
import { strings } from '@/lang/invoices'
import { invoiceWhatsAppUrl } from '@/utils/whatsapp'
import { useUserContext, UserContextType } from '@/context/UserContext'

import '@/assets/css/invoices.css'

type Invoice = InvoiceService.InvoiceWithApproval

const bookingOf = (invoice: Invoice): bookcarsTypes.Booking | undefined => (
  typeof invoice.booking === 'string' ? undefined : invoice.booking
)
const bookingIdOf = (invoice: Invoice): string => (
  typeof invoice.booking === 'string' ? invoice.booking : invoice.booking?._id || ''
)
const clientName = (invoice: Invoice): string => {
  const driver = bookingOf(invoice)?.driver
  return driver && typeof driver !== 'string' ? driver.fullName || driver.email || '—' : '—'
}
const carLabel = (invoice: Invoice): string => {
  const car = bookingOf(invoice)?.car
  if (!car || typeof car === 'string') return '—'
  return `${car.name}${car.licensePlate ? ` · ${car.licensePlate}` : ''}`
}
const contractLabel = (invoice: Invoice): string => {
  const booking = bookingOf(invoice)
  return booking?.reference || bookingIdOf(invoice).slice(-8).toUpperCase() || '—'
}
// GA-PAR-23: the client's stored phone comes from the invoice payload
// (backend populates booking.driver with fullName/email/phone). No number
// is ever fabricated: undefined here disables the WhatsApp action.
const clientPhone = (invoice: Invoice): string | undefined => {
  const driver = bookingOf(invoice)?.driver
  return driver && typeof driver !== 'string' ? driver.phone || undefined : undefined
}
const agencyNameOf = (invoice: Invoice, fallback: string): string => {
  const supplier = invoice.supplier
  if (supplier && typeof supplier !== 'string') {
    return supplier.fullName || fallback
  }
  return fallback
}

const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}
const formatAmount = (amount: number | undefined, currency?: string) => (
  `${new Intl.NumberFormat(uiLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0)} ${currency || 'MAD'}`
)
// GA-PAR-23: number only (the WhatsApp template carries {currency} itself).
const formatAmountValue = (amount: number | undefined) => (
  new Intl.NumberFormat(uiLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0)
)

const statusLabel = (status: bookcarsTypes.InvoiceStatus) => (
  status === bookcarsTypes.InvoiceStatus.Issued ? strings.ISSUED
    : status === bookcarsTypes.InvoiceStatus.Voided ? strings.VOIDED : strings.DRAFT
)
const statusColor = (status: bookcarsTypes.InvoiceStatus) => (
  status === bookcarsTypes.InvoiceStatus.Issued ? 'success'
    : status === bookcarsTypes.InvoiceStatus.Voided ? 'error' : 'default'
) as 'success' | 'error' | 'default'
const paymentLabel = (paymentStatus?: string) => (
  paymentStatus === 'paid' ? strings.PAID_STATUS : paymentStatus === 'partial' ? strings.PARTIAL : strings.UNPAID
)
const paymentColor = (paymentStatus?: string) => (
  paymentStatus === 'paid' ? 'success' : paymentStatus === 'partial' ? 'warning' : 'default'
) as 'success' | 'warning' | 'default'

type Quote = bookcarsTypes.Quote

const quoteClientName = (quote: Quote): string => {
  const client = quote.client
  if (client && typeof client !== 'string') return client.fullName || client.email || '—'
  const booking = quote.booking && typeof quote.booking !== 'string' ? quote.booking : undefined
  const driver = booking?.driver
  if (driver && typeof driver !== 'string') return driver.fullName || driver.email || '—'
  return quote.clientSnapshot?.name || '—'
}
const quoteCarLabel = (quote: Quote): string => {
  const car = quote.car
  if (car && typeof car !== 'string') return `${car.name}${car.licensePlate ? ` · ${car.licensePlate}` : ''}`
  const booking = quote.booking && typeof quote.booking !== 'string' ? quote.booking : undefined
  const bCar = booking?.car
  if (bCar && typeof bCar !== 'string') return `${bCar.name}${bCar.licensePlate ? ` · ${bCar.licensePlate}` : ''}`
  return quote.carLabel || '—'
}
const quoteContractLabel = (quote: Quote): string => {
  const booking = quote.booking && typeof quote.booking !== 'string' ? quote.booking : undefined
  if (booking) return booking.reference || (booking._id || '').slice(-8).toUpperCase()
  return typeof quote.booking === 'string' ? quote.booking.slice(-8).toUpperCase() : '—'
}
const quoteStatusLabel = (status: bookcarsTypes.QuoteStatus) => (
  status === bookcarsTypes.QuoteStatus.Sent ? strings.Q_SENT
    : status === bookcarsTypes.QuoteStatus.Accepted ? strings.Q_ACCEPTED
      : status === bookcarsTypes.QuoteStatus.Expired ? strings.Q_EXPIRED
        : status === bookcarsTypes.QuoteStatus.Converted ? strings.Q_CONVERTED : strings.Q_DRAFT
)
const quoteStatusColor = (status: bookcarsTypes.QuoteStatus) => (
  status === bookcarsTypes.QuoteStatus.Accepted ? 'success'
    : status === bookcarsTypes.QuoteStatus.Converted ? 'primary'
      : status === bookcarsTypes.QuoteStatus.Expired ? 'error'
        : status === bookcarsTypes.QuoteStatus.Sent ? 'warning' : 'default'
) as 'success' | 'primary' | 'error' | 'warning' | 'default'

const Invoices = () => {
  const { user: currentUser } = useUserContext() as UserContextType
  const agencyPermissions = useAgencyPermissions()
  const invoicesDenied = !!agencyPermissions?.loaded && !agencyPermissions.can(AgencyPermission.ReadInvoices)
  const canManage = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.ManageInvoices)

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [bookings, setBookings] = useState<bookcarsTypes.Booking[]>([])
  const [payments, setPayments] = useState<bookcarsTypes.RentalPayment[]>([])
  const [approvals, setApprovals] = useState<ApprovalService.Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createBooking, setCreateBooking] = useState('')
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [payTarget, setPayTarget] = useState<Invoice | null>(null)
  const [payPayment, setPayPayment] = useState('')
  // GA-PAR-05: Quotes tab (same page, no new route)
  const [tab, setTab] = useState<'invoices' | 'quotes'>('invoices')
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [cars, setCars] = useState<bookcarsTypes.Car[]>([])
  const [drivers, setDrivers] = useState<bookcarsTypes.User[]>([])
  const [quoteKeyword, setQuoteKeyword] = useState('')
  const [quoteStatusFilter, setQuoteStatusFilter] = useState('')
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false)
  const [quoteEditId, setQuoteEditId] = useState<string | null>(null)
  const [qClientMode, setQClientMode] = useState<'registered' | 'free'>('free')
  const [qClientId, setQClientId] = useState('')
  const [qClientName, setQClientName] = useState('')
  const [qClientPhone, setQClientPhone] = useState('')
  const [qClientCin, setQClientCin] = useState('')
  const [qCarMode, setQCarMode] = useState<'registered' | 'free'>('free')
  const [qCarId, setQCarId] = useState('')
  const [qCarLabel, setQCarLabel] = useState('')
  const [qBookingId, setQBookingId] = useState('')
  const [qDays, setQDays] = useState('')
  const [qDailyRate, setQDailyRate] = useState('')
  const [qSubtotal, setQSubtotal] = useState('')
  const [qTaxAmount, setQTaxAmount] = useState('')

  const load = useCallback(async (user?: bookcarsTypes.User) => {
    if (!user) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(false)
    try {
      const supplierIds = helper.admin(user)
        ? bookcarsHelper.flattenSuppliers(await SupplierService.getAllSuppliers())
        : [agencyPermissions?.supplier || user._id || '']
      const [invoiceRows, bookingResult, paymentRows, approvalRows, quoteRows, carResult, driverResult] = await Promise.all([
        InvoiceService.list(),
        BookingService.getBookings({ suppliers: supplierIds, statuses: Object.values(bookcarsTypes.BookingStatus) }, 1, 1000),
        RentalPaymentService.list(),
        ApprovalService.list().catch(() => [] as ApprovalService.Approval[]),
        QuoteService.list().catch(() => [] as Quote[]),
        CarService.getCars('', { suppliers: supplierIds }, 1, 1000).catch(() => null),
        UserService.getDrivers('', 1, 1000).catch(() => null),
      ])
      setInvoices(invoiceRows || [])
      setBookings(bookingResult?.[0]?.resultData || [])
      setPayments(paymentRows || [])
      setApprovals(approvalRows || [])
      setQuotes(quoteRows || [])
      setCars((carResult as unknown as Array<{ resultData?: bookcarsTypes.Car[] }>)?.[0]?.resultData || [])
      setDrivers((driverResult as unknown as Array<{ resultData?: bookcarsTypes.User[] }>)?.[0]?.resultData || [])
    } catch (error) {
      setLoadError(true)
      helper.error(error)
    } finally {
      setLoading(false)
    }
  }, [agencyPermissions?.supplier])

  // N1 surface: the invoice's approval state (record field first, then the
  // approvals queue entry for this invoice) is shown as a visible status.
  const approvalStateOf = (invoice: Invoice): bookcarsTypes.ApprovalDecision | undefined => {
    if (invoice.approvalDecision) return invoice.approvalDecision
    const entry = approvals.find((a) => a.subjectType === 'invoice' && a.subject === invoice._id)
    return entry?.status
  }
  const approvalLabel = (state: bookcarsTypes.ApprovalDecision) => (
    state === bookcarsTypes.ApprovalDecision.Approved ? strings.APPROVAL_APPROVED
      : state === bookcarsTypes.ApprovalDecision.Rejected ? strings.APPROVAL_REJECTED : strings.APPROVAL_PENDING
  )
  const approvalBlocksPayment = (invoice: Invoice) => {
    const state = approvalStateOf(invoice)
    return state === bookcarsTypes.ApprovalDecision.Pending || state === bookcarsTypes.ApprovalDecision.Rejected
  }

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    return invoices.filter((invoice) => {
      if (statusFilter && invoice.status !== statusFilter) return false
      if (paymentFilter && (invoice.paymentStatus || 'unpaid') !== paymentFilter) return false
      if (!needle) return true
      return [invoice.number || '', clientName(invoice), carLabel(invoice), contractLabel(invoice)]
        .some((value) => value.toLowerCase().includes(needle))
    })
  }, [invoices, keyword, statusFilter, paymentFilter])

  const bookableBookings = useMemo(() => {
    const activeBookingIds = new Set(
      invoices.filter((i) => i.status !== bookcarsTypes.InvoiceStatus.Voided).map((i) => bookingIdOf(i)),
    )
    return bookings.filter((booking) => booking._id
      && !activeBookingIds.has(booking._id)
      && booking.status !== bookcarsTypes.BookingStatus.Void
      && booking.status !== bookcarsTypes.BookingStatus.Cancelled)
  }, [invoices, bookings])

  const bookingOptionLabel = (booking: bookcarsTypes.Booking) => {
    const driver = typeof booking.driver === 'string' ? '' : booking.driver?.fullName || ''
    const car = typeof booking.car === 'string' ? '' : booking.car?.name || ''
    return `${booking.reference || (booking._id || '').slice(-8).toUpperCase()}${driver ? ` · ${driver}` : ''}${car ? ` · ${car}` : ''}`
  }

  const linkablePayments = (invoice: Invoice) => {
    const linkedIds = new Set<string>()
    invoices.forEach((i) => {
      if (i.status !== bookcarsTypes.InvoiceStatus.Voided) {
        ;(i.payments || []).forEach((p) => linkedIds.add(String(p)))
      }
    })
    const bookingId = bookingIdOf(invoice)
    return payments.filter((payment) => {
      const paymentBookingId = typeof payment.booking === 'string' ? payment.booking : payment.booking?._id
      if (paymentBookingId !== bookingId) return false
      // Only posted rent payments may be linked; deposit-purpose payments
      // are never offered (the API also refuses them with 400).
      if (payment.purpose && payment.purpose !== bookcarsTypes.RentalPaymentPurpose.Rent) return false
      if (payment.status && payment.status !== bookcarsTypes.RentalPaymentStatus.Posted) return false
      if (payment._id && linkedIds.has(payment._id)) return false
      return true
    })
  }

  const runAction = async (action: () => Promise<void>, success: string) => {
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
    } catch (err) {
      const message = helper.getErrorMessage(err, strings.ACTION_ERROR)
      setActionError(message.includes('rental payments') || message.includes('Only rent') ? strings.DEPOSIT_NOT_ALLOWED : message)
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = () => runAction(async () => {
    await InvoiceService.create({ booking: createBooking })
    setCreateOpen(false)
    setCreateBooking('')
    await load(currentUser || undefined)
  }, strings.CREATED)

  const handleIssue = (invoice: Invoice) => runAction(async () => {
    await InvoiceService.issue(invoice._id as string)
    await load(currentUser || undefined)
  }, strings.ISSUED_OK)

  const handleVoid = () => {
    if (!voidTarget?._id) return
    runAction(async () => {
      await InvoiceService.voidInvoice(voidTarget._id as string, { reason: voidReason.trim() })
      setVoidTarget(null)
      setVoidReason('')
      await load(currentUser || undefined)
    }, strings.VOIDED_OK)
  }

  const handleRecordPayment = () => {
    if (!payTarget?._id) return
    runAction(async () => {
      await InvoiceService.recordPayment(payTarget._id as string, payPayment)
      setPayTarget(null)
      setPayPayment('')
      await load(currentUser || undefined)
    }, strings.PAYMENT_OK)
  }

  // GA-PAR-23: opens the wa.me deep link in a new tab (no backend call).
  const openWhatsApp = (url: string | null) => {
    if (url) {
      window.open(url, '_blank', 'noopener')
    }
  }

  const handleDownloadPdf = (invoice: Invoice) => runAction(async () => {
    const blob = await InvoiceService.downloadPdf(invoice._id as string)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `invoice-${invoice.number || invoice._id}.pdf`
    anchor.click()
    URL.revokeObjectURL(url)
  }, '')

  const filteredQuotes = useMemo(() => {
    const needle = quoteKeyword.trim().toLowerCase()
    return quotes.filter((quote) => {
      if (quoteStatusFilter && quote.status !== quoteStatusFilter) return false
      if (!needle) return true
      return [quote.number || '', quoteClientName(quote), quoteCarLabel(quote), quoteContractLabel(quote)]
        .some((value) => value.toLowerCase().includes(needle))
    })
  }, [quotes, quoteKeyword, quoteStatusFilter])

  const openQuoteCreate = () => {
    setQuoteEditId(null)
    setQClientMode('free'); setQClientId(''); setQClientName(''); setQClientPhone(''); setQClientCin('')
    setQCarMode('free'); setQCarId(''); setQCarLabel('')
    setQBookingId(''); setQDays(''); setQDailyRate(''); setQSubtotal(''); setQTaxAmount('')
    setQuoteDialogOpen(true)
  }

  const openQuoteEdit = (quote: Quote) => {
    setQuoteEditId(quote._id || null)
    if (quote.client) {
      setQClientMode('registered')
      setQClientId(typeof quote.client === 'string' ? quote.client : quote.client._id || '')
    } else {
      setQClientMode('free'); setQClientId('')
      setQClientName(quote.clientSnapshot?.name || ''); setQClientPhone(quote.clientSnapshot?.phone || ''); setQClientCin(quote.clientSnapshot?.cinNumber || '')
    }
    if (quote.car) {
      setQCarMode('registered')
      setQCarId(typeof quote.car === 'string' ? quote.car : quote.car._id || '')
    } else {
      setQCarMode('free'); setQCarId(''); setQCarLabel(quote.carLabel || '')
    }
    setQBookingId(quote.booking ? (typeof quote.booking === 'string' ? quote.booking : quote.booking._id || '') : '')
    setQDays(quote.days !== undefined && quote.days !== null ? String(quote.days) : '')
    setQDailyRate(quote.dailyRate !== undefined && quote.dailyRate !== null ? String(quote.dailyRate) : '')
    setQSubtotal(String(quote.subtotal))
    setQTaxAmount(String(quote.taxAmount))
    setQuoteDialogOpen(true)
  }

  const quotePayload = (): bookcarsTypes.CreateQuotePayload => ({
    client: qClientMode === 'registered' && qClientId ? qClientId : undefined,
    clientSnapshot: qClientMode === 'free' ? { name: qClientName.trim() || undefined, phone: qClientPhone.trim() || undefined, cinNumber: qClientCin.trim() || undefined } : undefined,
    car: qCarMode === 'registered' && qCarId ? qCarId : undefined,
    carLabel: qCarMode === 'free' && qCarLabel.trim() ? qCarLabel.trim() : undefined,
    booking: qBookingId || undefined,
    days: qDays.trim() !== '' ? Number(qDays) : undefined,
    dailyRate: qDailyRate.trim() !== '' ? Number(qDailyRate) : undefined,
    subtotal: qSubtotal.trim() !== '' ? Number(qSubtotal) : undefined,
    taxAmount: qTaxAmount.trim() !== '' ? Number(qTaxAmount) : undefined,
  })

  const handleQuoteSave = () => runAction(async () => {
    if (quoteEditId) {
      await QuoteService.update(quoteEditId, quotePayload())
    } else {
      await QuoteService.create(quotePayload())
    }
    setQuoteDialogOpen(false)
    await load(currentUser || undefined)
  }, quoteEditId ? strings.Q_UPDATED : strings.Q_CREATED)

  const handleQuoteTransition = (quote: Quote, status: bookcarsTypes.QuoteStatus, success: string) => runAction(async () => {
    await QuoteService.transition(quote._id as string, status)
    await load(currentUser || undefined)
  }, success)

  const handleQuoteConvert = (quote: Quote) => runAction(async () => {
    await QuoteService.convert(quote._id as string)
    await load(currentUser || undefined)
    setTab('invoices')
  }, strings.Q_CONVERTED_OK)

  const handleQuotePdf = (quote: Quote) => runAction(async () => {
    const blob = await QuoteService.downloadPdf(quote._id as string)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `quote-${quote.number || quote._id}.pdf`
    anchor.click()
    URL.revokeObjectURL(url)
  }, '')


  return (
    <Layout strict onLoad={load}>
      {invoicesDenied ? <AccessDenied /> : (
        <div className="agency-invoices">
          <Box className="agency-invoices__heading">
            <div>
              <Typography component="h1" className="agency-invoices__title">{strings.TITLE}</Typography>
              <Typography className="agency-invoices__subtitle">{strings.SUBTITLE}</Typography>
            </div>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => load(currentUser || undefined)}>{strings.REFRESH}</Button>
              {canManage && tab === 'invoices' && (
                <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setCreateOpen(true)}>{strings.CREATE}</Button>
              )}
              {canManage && tab === 'quotes' && (
                <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openQuoteCreate}>{strings.Q_CREATE}</Button>
              )}
            </Box>
          </Box>

          <Tabs className="agency-invoices__tabs" value={tab} onChange={(_, value) => setTab(value)}>
            <Tab value="invoices" label={strings.TAB_INVOICES} />
            <Tab value="quotes" label={strings.TAB_QUOTES} />
          </Tabs>

          {loadError && <Alert severity="error">{strings.ERROR}</Alert>}
          {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
          {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}

          {tab === 'invoices' && (<>
          <Box className="agency-invoices__toolbar">
            <TextField size="small" label={strings.SEARCH} value={keyword} onChange={(e) => setKeyword(e.target.value)} sx={{ flex: '1 1 260px' }} />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>{strings.STATUS}</InputLabel>
              <Select label={strings.STATUS} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <MenuItem value="">{strings.ALL_STATUSES}</MenuItem>
                <MenuItem value={bookcarsTypes.InvoiceStatus.Draft}>{strings.DRAFT}</MenuItem>
                <MenuItem value={bookcarsTypes.InvoiceStatus.Issued}>{strings.ISSUED}</MenuItem>
                <MenuItem value={bookcarsTypes.InvoiceStatus.Voided}>{strings.VOIDED}</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>{strings.PAYMENT_STATUS}</InputLabel>
              <Select label={strings.PAYMENT_STATUS} value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
                <MenuItem value="">{strings.ALL_PAYMENTS}</MenuItem>
                <MenuItem value="unpaid">{strings.UNPAID}</MenuItem>
                <MenuItem value="partial">{strings.PARTIAL}</MenuItem>
                <MenuItem value="paid">{strings.PAID_STATUS}</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {loading ? (
            <Box sx={{ p: 5, textAlign: 'center' }}><CircularProgress /><Typography>{strings.LOADING}</Typography></Box>
          ) : filtered.length === 0 ? (
            <Typography sx={{ p: 3 }}>{strings.EMPTY}</Typography>
          ) : (
            <div className="agency-invoices__panel">
              <div className="agency-invoices__head agency-invoices__grid">
                <span>{strings.NUMBER}</span><span>{strings.CLIENT}</span><span>{strings.CAR}</span>
                <span>{strings.STATUS}</span><span>{strings.PAYMENT_STATUS}</span><span>{strings.TOTAL}</span>
                <span>{strings.PAID}</span><span>{strings.APPROVAL}</span><span />
              </div>
              {filtered.map((invoice) => {
                const approvalState = approvalStateOf(invoice)
                const blocked = approvalBlocksPayment(invoice)
                // GA-PAR-23: wa.me deep link (Issued only, rendered below).
                // Null when the client has no usable stored phone.
                const waUrl = invoiceWhatsAppUrl({
                  phone: clientPhone(invoice),
                  template: strings.WA_INVOICE_MESSAGE,
                  clientName: clientName(invoice),
                  agencyName: agencyNameOf(invoice, currentUser?.fullName || ''),
                  invoiceNumber: invoice.number || '',
                  amountText: formatAmountValue(invoice.total),
                  currency: invoice.currency || 'MAD',
                })
                return (
                  <div key={invoice._id} className="agency-invoices__row agency-invoices__grid">
                    <span data-label={strings.NUMBER}><strong>{invoice.number || strings.DRAFT_NUMBER}</strong><br /><small>{contractLabel(invoice)}</small></span>
                    <span data-label={strings.CLIENT}>{clientName(invoice)}</span>
                    <span data-label={strings.CAR}>{carLabel(invoice)}</span>
                    <span data-label={strings.STATUS}><Chip size="small" color={statusColor(invoice.status)} label={statusLabel(invoice.status)} /></span>
                    <span data-label={strings.PAYMENT_STATUS}><Chip size="small" color={paymentColor(invoice.paymentStatus)} label={paymentLabel(invoice.paymentStatus)} /></span>
                    <span data-label={strings.TOTAL}>{formatAmount(invoice.total, invoice.currency)}<br /><small>{`${strings.SUBTOTAL} ${formatAmount(invoice.subtotal, invoice.currency)} · ${strings.TAX} ${formatAmount(invoice.taxAmount, invoice.currency)}`}</small></span>
                    <span data-label={strings.PAID}>{formatAmount(invoice.paidAmount, invoice.currency)}</span>
                    <span data-label={strings.APPROVAL}>
                      {approvalState ? <Chip size="small" color={approvalState === bookcarsTypes.ApprovalDecision.Approved ? 'success' : approvalState === bookcarsTypes.ApprovalDecision.Rejected ? 'error' : 'warning'} label={approvalLabel(approvalState)} /> : '—'}
                      {blocked && <><br /><small>{strings.APPROVAL_BLOCKED}</small></>}
                      {invoice.status === bookcarsTypes.InvoiceStatus.Voided && invoice.voidReason && <><br /><small>{`${strings.VOID_REASON_VALUE}: ${invoice.voidReason}`}</small></>}
                    </span>
                    <span className="agency-invoices__actions">
                      {canManage && invoice.status === bookcarsTypes.InvoiceStatus.Draft && (
                        <Button size="small" variant="contained" disabled={busy} onClick={() => handleIssue(invoice)}>{strings.ISSUE}</Button>
                      )}
                      {canManage && invoice.status === bookcarsTypes.InvoiceStatus.Issued && (
                        <>
                          <Button size="small" variant="outlined" disabled={busy || blocked} onClick={() => { setPayTarget(invoice); setPayPayment('') }}>{strings.RECORD_PAYMENT}</Button>
                          <Button size="small" variant="outlined" color="error" disabled={busy} onClick={() => { setVoidTarget(invoice); setVoidReason('') }}>{strings.VOID}</Button>
                        </>
                      )}
                      {invoice.status === bookcarsTypes.InvoiceStatus.Issued && (
                        <Button size="small" startIcon={<PictureAsPdfRoundedIcon />} disabled={busy} onClick={() => handleDownloadPdf(invoice)}>{strings.DOWNLOAD_PDF}</Button>
                      )}
                      {invoice.status === bookcarsTypes.InvoiceStatus.Issued && (
                        <Button size="small" startIcon={<WhatsAppIcon />} disabled={busy || !waUrl} title={waUrl ? undefined : strings.WA_NO_PHONE} onClick={() => openWhatsApp(waUrl)}>{strings.WA_SEND}</Button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          </>)}

          <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
            <DialogTitle>{strings.CREATE_TITLE}</DialogTitle>
            <DialogContent className="agency-invoices__form">
              {bookableBookings.length === 0 ? <Typography>{strings.NO_BOOKING}</Typography> : (
                <FormControl fullWidth size="small">
                  <InputLabel>{strings.BOOKING}</InputLabel>
                  <Select label={strings.BOOKING} value={createBooking} onChange={(e) => setCreateBooking(e.target.value)}>
                    {bookableBookings.map((booking) => (
                      <MenuItem key={booking._id} value={booking._id}>{bookingOptionLabel(booking)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setCreateOpen(false)}>{strings.CANCEL}</Button>
              <Button variant="contained" disabled={busy || !createBooking} onClick={handleCreate}>{strings.CREATE}</Button>
            </DialogActions>
          </Dialog>

          <Dialog open={!!voidTarget} onClose={() => setVoidTarget(null)} fullWidth maxWidth="sm">
            <DialogTitle>{strings.VOID_TITLE}</DialogTitle>
            <DialogContent className="agency-invoices__form">
              <TextField fullWidth size="small" label={strings.VOID_REASON} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setVoidTarget(null)}>{strings.CANCEL}</Button>
              <Button variant="contained" color="error" disabled={busy || voidReason.trim().length < 3} onClick={handleVoid}>{strings.VOID}</Button>
            </DialogActions>
          </Dialog>

          <Dialog open={!!payTarget} onClose={() => setPayTarget(null)} fullWidth maxWidth="sm">
            <DialogTitle>{strings.PAYMENT_TITLE}</DialogTitle>
            <DialogContent className="agency-invoices__form">
              {payTarget && linkablePayments(payTarget).length === 0 ? <Typography>{strings.NO_PAYMENT}</Typography> : (
                <FormControl fullWidth size="small">
                  <InputLabel>{strings.PAYMENT}</InputLabel>
                  <Select label={strings.PAYMENT} value={payPayment} onChange={(e) => setPayPayment(e.target.value)}>
                    {payTarget && linkablePayments(payTarget).map((payment) => (
                      <MenuItem key={payment._id} value={payment._id}>
                        {`${formatAmount(payment.amount, payment.currency)} · ${payment.method}${payment.reference ? ` · ${payment.reference}` : ''}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPayTarget(null)}>{strings.CANCEL}</Button>
              <Button variant="contained" disabled={busy || !payPayment} onClick={handleRecordPayment}>{strings.LINK}</Button>
            </DialogActions>
          </Dialog>

          {tab === 'quotes' && (<>
            <Typography className="agency-invoices__subtitle" sx={{ mb: 2 }}>{strings.Q_SUBTITLE}</Typography>
            <Box className="agency-invoices__toolbar">
              <TextField size="small" label={strings.Q_SEARCH} value={quoteKeyword} onChange={(e) => setQuoteKeyword(e.target.value)} sx={{ flex: '1 1 260px' }} />
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>{strings.STATUS}</InputLabel>
                <Select label={strings.STATUS} value={quoteStatusFilter} onChange={(e) => setQuoteStatusFilter(e.target.value)}>
                  <MenuItem value="">{strings.ALL_STATUSES}</MenuItem>
                  <MenuItem value={bookcarsTypes.QuoteStatus.Draft}>{strings.Q_DRAFT}</MenuItem>
                  <MenuItem value={bookcarsTypes.QuoteStatus.Sent}>{strings.Q_SENT}</MenuItem>
                  <MenuItem value={bookcarsTypes.QuoteStatus.Accepted}>{strings.Q_ACCEPTED}</MenuItem>
                  <MenuItem value={bookcarsTypes.QuoteStatus.Expired}>{strings.Q_EXPIRED}</MenuItem>
                  <MenuItem value={bookcarsTypes.QuoteStatus.Converted}>{strings.Q_CONVERTED}</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {loading ? (
              <Box sx={{ p: 5, textAlign: 'center' }}><CircularProgress /><Typography>{strings.Q_LOADING}</Typography></Box>
            ) : filteredQuotes.length === 0 ? (
              <Typography sx={{ p: 3 }}>{strings.Q_EMPTY}</Typography>
            ) : (
              <div className="agency-invoices__panel">
                <div className="agency-invoices__head agency-invoices__grid agency-invoices__grid--quotes">
                  <span>{strings.Q_NUMBER}</span><span>{strings.CLIENT}</span><span>{strings.CAR}</span>
                  <span>{strings.STATUS}</span><span>{strings.TOTAL}</span><span />
                </div>
                {filteredQuotes.map((quote) => (
                  <div key={quote._id} className="agency-invoices__row agency-invoices__grid agency-invoices__grid--quotes">
                    <span data-label={strings.Q_NUMBER}><strong>{quote.number || '—'}</strong><br /><small>{quoteContractLabel(quote)}</small></span>
                    <span data-label={strings.CLIENT}>{quoteClientName(quote)}</span>
                    <span data-label={strings.CAR}>{quoteCarLabel(quote)}</span>
                    <span data-label={strings.STATUS}><Chip size="small" color={quoteStatusColor(quote.status)} label={quoteStatusLabel(quote.status)} /></span>
                    <span data-label={strings.TOTAL}>{formatAmount(quote.total, quote.currency)}<br /><small>{`${strings.SUBTOTAL} ${formatAmount(quote.subtotal, quote.currency)} · ${strings.TAX} ${formatAmount(quote.taxAmount, quote.currency)}`}</small></span>
                    <span className="agency-invoices__actions">
                      {canManage && quote.status === bookcarsTypes.QuoteStatus.Draft && (
                        <>
                          <Button size="small" variant="outlined" disabled={busy} onClick={() => openQuoteEdit(quote)}>{strings.Q_EDIT}</Button>
                          <Button size="small" variant="contained" disabled={busy} onClick={() => handleQuoteTransition(quote, bookcarsTypes.QuoteStatus.Sent, strings.Q_SENT_OK)}>{strings.Q_SEND}</Button>
                          <Button size="small" variant="outlined" color="error" disabled={busy} onClick={() => handleQuoteTransition(quote, bookcarsTypes.QuoteStatus.Expired, strings.Q_EXPIRED_OK)}>{strings.Q_EXPIRE}</Button>
                        </>
                      )}
                      {canManage && quote.status === bookcarsTypes.QuoteStatus.Sent && (
                        <>
                          <Button size="small" variant="contained" disabled={busy} onClick={() => handleQuoteTransition(quote, bookcarsTypes.QuoteStatus.Accepted, strings.Q_ACCEPTED_OK)}>{strings.Q_ACCEPT}</Button>
                          <Button size="small" variant="outlined" color="error" disabled={busy} onClick={() => handleQuoteTransition(quote, bookcarsTypes.QuoteStatus.Expired, strings.Q_EXPIRED_OK)}>{strings.Q_EXPIRE}</Button>
                        </>
                      )}
                      {canManage && quote.status === bookcarsTypes.QuoteStatus.Accepted && (
                        <Button size="small" variant="contained" disabled={busy} onClick={() => handleQuoteConvert(quote)}>{strings.Q_CONVERT}</Button>
                      )}
                      {quote.status === bookcarsTypes.QuoteStatus.Converted && (
                        <Button size="small" variant="outlined" disabled={busy} onClick={() => setTab('invoices')}>{strings.Q_OPEN_INVOICE}</Button>
                      )}
                      <Button size="small" startIcon={<PictureAsPdfRoundedIcon />} disabled={busy} onClick={() => handleQuotePdf(quote)}>{strings.Q_PDF}</Button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>)}

          <Dialog open={quoteDialogOpen} onClose={() => setQuoteDialogOpen(false)} fullWidth maxWidth="sm">
            <DialogTitle>{quoteEditId ? strings.Q_EDIT_TITLE : strings.Q_CREATE_TITLE}</DialogTitle>
            <DialogContent className="agency-invoices__form">
              <FormControl fullWidth size="small">
                <InputLabel>{strings.CLIENT}</InputLabel>
                <Select label={strings.CLIENT} value={qClientMode} onChange={(e) => setQClientMode(e.target.value as 'registered' | 'free')}>
                  <MenuItem value="registered">{strings.Q_REGISTERED_CLIENT}</MenuItem>
                  <MenuItem value="free">{strings.Q_FREE_CLIENT}</MenuItem>
                </Select>
              </FormControl>
              {qClientMode === 'registered' ? (
                <FormControl fullWidth size="small">
                  <InputLabel>{strings.Q_REGISTERED_CLIENT}</InputLabel>
                  <Select label={strings.Q_REGISTERED_CLIENT} value={qClientId} onChange={(e) => setQClientId(e.target.value)}>
                    {drivers.map((driver) => (
                      <MenuItem key={driver._id} value={driver._id}>{driver.fullName || driver.email}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : (
                <>
                  <TextField fullWidth size="small" label={strings.Q_CLIENT_NAME} value={qClientName} onChange={(e) => setQClientName(e.target.value)} />
                  <TextField fullWidth size="small" label={strings.Q_CLIENT_PHONE} value={qClientPhone} onChange={(e) => setQClientPhone(e.target.value)} />
                  <TextField fullWidth size="small" label={strings.Q_CLIENT_CIN} value={qClientCin} onChange={(e) => setQClientCin(e.target.value)} />
                </>
              )}
              <FormControl fullWidth size="small">
                <InputLabel>{strings.CAR}</InputLabel>
                <Select label={strings.CAR} value={qCarMode} onChange={(e) => setQCarMode(e.target.value as 'registered' | 'free')}>
                  <MenuItem value="registered">{strings.Q_REGISTERED_CAR}</MenuItem>
                  <MenuItem value="free">{strings.Q_FREE_CLIENT}</MenuItem>
                </Select>
              </FormControl>
              {qCarMode === 'registered' ? (
                <FormControl fullWidth size="small">
                  <InputLabel>{strings.Q_REGISTERED_CAR}</InputLabel>
                  <Select label={strings.Q_REGISTERED_CAR} value={qCarId} onChange={(e) => setQCarId(e.target.value)}>
                    {cars.map((car) => (
                      <MenuItem key={car._id} value={car._id}>{`${car.name}${car.licensePlate ? ` · ${car.licensePlate}` : ''}`}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : (
                <TextField fullWidth size="small" label={strings.Q_CAR_LABEL} value={qCarLabel} onChange={(e) => setQCarLabel(e.target.value)} />
              )}
              <FormControl fullWidth size="small">
                <InputLabel>{strings.Q_BOOKING_OPTIONAL}</InputLabel>
                <Select label={strings.Q_BOOKING_OPTIONAL} value={qBookingId} onChange={(e) => setQBookingId(e.target.value)}>
                  <MenuItem value="">{strings.Q_NO_LINK}</MenuItem>
                  {bookings.map((booking) => (
                    <MenuItem key={booking._id} value={booking._id}>{bookingOptionLabel(booking)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField fullWidth size="small" type="number" label={strings.Q_DAYS} value={qDays} onChange={(e) => setQDays(e.target.value)} />
              <TextField fullWidth size="small" type="number" label={strings.Q_DAILY_RATE} value={qDailyRate} onChange={(e) => setQDailyRate(e.target.value)} />
              <Typography variant="body2">{strings.Q_DAYS_RATE_HINT}</Typography>
              <TextField fullWidth size="small" type="number" label={strings.Q_SUBTOTAL_FIELD} value={qSubtotal} onChange={(e) => setQSubtotal(e.target.value)} />
              <TextField fullWidth size="small" type="number" label={strings.Q_TAX_FIELD} value={qTaxAmount} onChange={(e) => setQTaxAmount(e.target.value)} />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setQuoteDialogOpen(false)}>{strings.CANCEL}</Button>
              <Button variant="contained" disabled={busy} onClick={handleQuoteSave}>{quoteEditId ? strings.Q_EDIT : strings.Q_CREATE}</Button>
            </DialogActions>
          </Dialog>
        </div>
      )}
    </Layout>
  )
}

export default Invoices
