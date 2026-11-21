import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material'
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded'
import * as bookcarsTypes from ':bookcars-types'
import Layout from '@/components/Layout'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import AccessDenied from '@/components/AccessDenied'
import * as CashService from '@/services/CashService'
import * as UserService from '@/services/UserService'
import * as SupplierService from '@/services/SupplierService'
import * as helper from '@/utils/helper'
import env from '@/config/env.config'
import { strings } from '@/lang/cash-journal'

import '@/assets/css/cash-journal.css'

interface JournalRow {
  id: string
  date: Date
  direction: 'in' | 'out'
  reason: string
  context: string
  method: string
  amount: number
  searchText: string
  // F6 / W3 C-5 — server-computed journal rows carry the movement's
  // status and ledger purpose: pending entries are shown, never
  // counted; deposit-purpose cash is held, never income.
  status?: 'pending' | 'confirmed'
  purpose?: bookcarsTypes.RentalPaymentPurpose
  rentalPayment?: string
}

const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}

const formatAmount = (amount: number) => `${new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 2 }).format(amount)} ${env.CURRENCY}`

const formatDate = (date: Date) => new Intl.DateTimeFormat(uiLocale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date))

const accountName = (account: bookcarsTypes.CashAccountType) => (account === bookcarsTypes.CashAccountType.Bank ? strings.BANK_ACCOUNT : strings.CASH)

const CashJournal = () => {
  const agencyPermissions = useAgencyPermissions()
  const cashDenied = !!agencyPermissions?.loaded && !agencyPermissions.can(AgencyPermission.ReadCash)
  const canManageCash = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.ManageCash)
  const canRecordCash = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.RecordCash)
  const [user, setUser] = useState<bookcarsTypes.User | null>(null)
  const [agencies, setAgencies] = useState<bookcarsTypes.User[]>([])
  const [agencyId, setAgencyId] = useState('')
  const [rows, setRows] = useState<JournalRow[]>([])
  const [journalTotals, setJournalTotals] = useState<bookcarsTypes.CashJournalTotals | null>(null)
  const [unlinkedCashPayments, setUnlinkedCashPayments] = useState<bookcarsTypes.UnlinkedCashPaymentRow[]>([])
  const [unlinkedCashTotal, setUnlinkedCashTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [session, setSession] = useState<bookcarsTypes.CashSession | null>(null)
  const [sessions, setSessions] = useState<bookcarsTypes.CashSession[]>([])
  const [accountFocus, setAccountFocus] = useState<bookcarsTypes.CashAccountType>(bookcarsTypes.CashAccountType.Cash)
  const [currentByAccount, setCurrentByAccount] = useState<Partial<Record<bookcarsTypes.CashAccountType, bookcarsTypes.CashSession | null>>>({})
  const [openAccount, setOpenAccount] = useState<bookcarsTypes.CashAccountType>(bookcarsTypes.CashAccountType.Cash)
  const [transferDialog, setTransferDialog] = useState(false)
  const [transferFrom, setTransferFrom] = useState('')
  const [transferTo, setTransferTo] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferReference, setTransferReference] = useState('')
  const [transferNote, setTransferNote] = useState('')
  const [transferIdempotencyKey, setTransferIdempotencyKey] = useState('')
  const [sessionDialog, setSessionDialog] = useState<'open' | 'close' | 'movement' | null>(null)
  const [openingBalance, setOpeningBalance] = useState('0')
  const [countedBalance, setCountedBalance] = useState('0')
  const [closingNote, setClosingNote] = useState('')
  // F6 / W3 C-1 — chained opening from the previous counted close.
  const [previousCloseBalance, setPreviousCloseBalance] = useState<number | null>(null)
  const [openingDifferenceReason, setOpeningDifferenceReason] = useState('')
  // F6 / W3 C-4 — close-time pending carry + discrepancy approval.
  const [closePreview, setClosePreview] = useState<{ pendingCount: number, pendingIn: number, pendingOut: number, expectedBalance: number } | null>(null)
  const [pendingCarryReason, setPendingCarryReason] = useState('')
  const [discrepancyReason, setDiscrepancyReason] = useState('')
  const [sessionError, setSessionError] = useState(false)
  const [sessionErrorMessage, setSessionErrorMessage] = useState('')
  const [movementDirection, setMovementDirection] = useState<bookcarsTypes.CashMovementDirection>(bookcarsTypes.CashMovementDirection.In)
  const [movementAmount, setMovementAmount] = useState('')
  const [movementReference, setMovementReference] = useState('')
  const [movementNote, setMovementNote] = useState('')

  const isAdmin = user?.type === bookcarsTypes.RecordType.Admin
  const supplierScope = isAdmin ? (agencyId || undefined) : undefined
  const canMutate = !isAdmin || !!supplierScope
  const canMutateCash = canMutate && canManageCash
  const canAddMovement = canMutate && (canManageCash || canRecordCash)

  const onLoad = useCallback(async (currentUser?: bookcarsTypes.User) => {
    if (!currentUser) {
 setLoading(false); return 
}
    setUser(currentUser)
    // Admin pages must select an agency before mutating; reads stay unscoped
    // until the operator picks one so the list can show every agency.
    const scope = currentUser.type === bookcarsTypes.RecordType.Admin
      ? (agencyId || undefined)
      : undefined
    if (currentUser.type === bookcarsTypes.RecordType.Admin && !agencies.length) {
      try {
        const suppliers = await SupplierService.getAllSuppliers()
        // The all-suppliers endpoint intentionally returns the agency identity projection without `type`.
        // Treat every returned row as an agency option; filtering on the omitted field leaves admins
        // with an empty selector and makes every cash mutation look unavailable.
        setAgencies(suppliers)
        // Select the first available agency so a platform admin can begin a
        // controlled cash operation immediately; the operator can change it.
        if (!agencyId && suppliers[0]?._id) {
          setAgencyId(suppliers[0]._id)
        }
      } catch (error) {
        helper.error(error)
      }
    }
    setLoading(true)
    setLoadError(false)
    try {
      const [listedSessions, currentCash, currentBank] = await Promise.all([
        CashService.listSessions(scope),
        CashService.current(bookcarsTypes.CashAccountType.Cash, scope),
        CashService.current(bookcarsTypes.CashAccountType.Bank, scope),
      ])
      const currents: Partial<Record<bookcarsTypes.CashAccountType, bookcarsTypes.CashSession | null>> = {
        [bookcarsTypes.CashAccountType.Cash]: currentCash,
        [bookcarsTypes.CashAccountType.Bank]: currentBank,
      }
      setCurrentByAccount(currents)
      const orderedSessions = (listedSessions || []).sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())
      const selectedSession = currents[accountFocus] || orderedSessions.find((item) => item.account === accountFocus) || null
      setSessions(orderedSessions)
      setSession(selectedSession)
      if (selectedSession) {
        setCountedBalance(String(selectedSession.countedClosingBalance ?? selectedSession.openingBalance))
      }
      // F6 / W3 C-5 — the journal is computed server-side from the
      // selected session's movements under one scope (confirmed-only
      // income/expenses, deposits held separately, pending listed, never
      // counted). The page no longer merges all agency payments and all
      // expenses client-side: that merge counted reversed/pending/deposit
      // payments as income and unpaid expenses as outflows, and its scope
      // could not reconcile to any session. Maintenance expenses are not
      // drawer movements and stay on Maintenance + Reports.
      const journal = selectedSession?._id
        ? await CashService.journal(selectedSession._id, scope, { from: from || undefined, to: to || undefined })
        : null
      setJournalTotals(journal?.totals || null)
      setUnlinkedCashPayments(journal?.unlinkedCashPayments || [])
      setUnlinkedCashTotal(journal?.unlinkedCashTotal || 0)
      const movementRows: JournalRow[] = (journal?.rows || []).map((row) => ({
        id: row.id,
        date: new Date(row.date),
        direction: row.direction,
        reason: row.source === bookcarsTypes.CashMovementSource.Transfer
          ? strings.TRANSFER
          : row.rentalPayment
            ? strings.PAYMENT
            : strings.MANUAL_MOVEMENT,
        context: [row.bookingReference, row.reference, row.note].filter(Boolean).join(' · ') || '—',
        method: row.rentalPayment
          ? strings.CASH
          : selectedSession?.account === bookcarsTypes.CashAccountType.Bank ? strings.BANK : strings.CASH,
        amount: row.amount,
        searchText: `${row.reference || ''} ${row.note || ''} ${row.source} ${row.bookingReference || ''}`.toLocaleLowerCase(),
        status: row.status,
        purpose: row.purpose,
        rentalPayment: row.rentalPayment,
      }))
      setRows(movementRows.sort((a, b) => b.date.getTime() - a.date.getTime()))
    } catch (error) {
 setLoadError(true); helper.error(error) 
} finally {
 setLoading(false) 
}
  }, [agencies.length, agencyId, accountFocus, from, to])

  useEffect(() => {
    if (user?.type === bookcarsTypes.RecordType.Admin && agencyId) {
      void onLoad(user)
    }
  }, [agencyId, onLoad, user]) // reload the selected admin agency scope

  useEffect(() => {
    if (user) {
      void onLoad(user)
    }
  }, [accountFocus, onLoad, user]) // reload when the operator switches the focused cash/bank account

  const filtered = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase()
    const start = from ? new Date(`${from}T00:00:00`).getTime() : undefined
    const end = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined
    return rows.filter((row) => {
      const time = row.date.getTime()
      return (!query || row.searchText.includes(query))
        && (start === undefined || time >= start)
        && (end === undefined || time <= end)
    })
  }, [rows, keyword, from, to])

  const openTransfer = () => {
    if (!session || !canMutate) {
      if (isAdmin && !canMutate) {
        setSessionError(true)
        setSessionErrorMessage(strings.AGENCY_REQUIRED)
      }
      return
    }
    setTransferFrom(session._id || '')
    setTransferTo('')
    setTransferAmount('')
    setTransferReference('')
    setTransferNote('')
    setTransferIdempotencyKey(`cash-transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    setTransferDialog(true)
  }

  const saveTransfer = async () => {
    if (!transferFrom || !transferTo || !(Number(transferAmount) > 0)) {
      setSessionError(true)
      setSessionErrorMessage(strings.TRANSFER_ERROR)
      helper.error(null, strings.TRANSFER_ERROR)
      return
    }
    try {
      setSessionError(false)
      setSessionErrorMessage('')
      await CashService.transfer({
        ...(supplierScope ? { supplier: supplierScope } : {}),
        fromSession: transferFrom,
        toSession: transferTo,
        amount: Number(transferAmount),
        date: new Date().toISOString(),
        idempotencyKey: transferIdempotencyKey,
        reference: transferReference || undefined,
        note: transferNote || undefined,
      })
      setTransferDialog(false)
      await onLoad(UserService.getCurrentUser() || undefined)
    } catch (error) {
      setSessionError(true)
      setSessionErrorMessage(helper.getErrorMessage(error, strings.SESSION_ERROR))
      helper.error(error, helper.getErrorMessage(error, strings.SESSION_ERROR))
    }
  }

  const saveMovement = async () => {
    if (!session?._id || !canMutate) {
      if (isAdmin && !canMutate) {
        setSessionError(true)
        setSessionErrorMessage(strings.AGENCY_REQUIRED)
      }
      return
    }
    try {
      setSessionError(false)
      setSessionErrorMessage('')
      await CashService.createMovement(session._id, {
        date: new Date(),
        direction: movementDirection,
        amount: Number(movementAmount),
        source: bookcarsTypes.CashMovementSource.Manual,
        idempotencyKey: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        reference: movementReference,
        note: movementNote,
      }, supplierScope)
      setMovementAmount('')
      setMovementReference('')
      setMovementNote('')
      setSessionDialog(null)
      await onLoad(UserService.getCurrentUser() || undefined)
    } catch (error) {
 setSessionError(true); setSessionErrorMessage(helper.getErrorMessage(error, strings.SESSION_ERROR)); helper.error(error, helper.getErrorMessage(error, strings.SESSION_ERROR)) 
}
  }

  const saveSession = async () => {
    try {
      setSessionError(false)
      setSessionErrorMessage('')
      if (!canMutate) {
        setSessionError(true)
        setSessionErrorMessage(strings.AGENCY_REQUIRED)
        return
      }
      if (sessionDialog === 'open') {
        // F6 / W3 C-1 — a blank opening chains from the previous counted
        // close (the server defaults it); a value that differs from the
        // chain needs a recorded reason. The server enforces both.
        const entered = openingBalance.trim() === '' ? undefined : Number(openingBalance)
        if (previousCloseBalance !== null && entered !== undefined && entered !== previousCloseBalance && openingDifferenceReason.trim().length < 3) {
          setSessionError(true)
          setSessionErrorMessage(strings.OPENING_DIFFERENCE_REASON_REQUIRED)
          return
        }
        await CashService.open({ account: openAccount, openingBalance: entered, openingDifferenceReason: openingDifferenceReason.trim() || undefined, supplier: supplierScope })
      } else if (sessionDialog === 'close' && session?._id) {
        // F6 / W3 C-4 — pending entries are carried only with a reason,
        // and any discrepancy needs an approved reason (tolerance is
        // ZERO). The server re-checks both against the live session.
        const counted = Number(countedBalance)
        const expected = closePreview?.expectedBalance ?? session.expectedClosingBalance ?? counted
        const discrepancy = Number((counted - expected).toFixed(2))
        const pendingCount = closePreview?.pendingCount ?? 0
        if (pendingCount > 0 && pendingCarryReason.trim().length < 3) {
          setSessionError(true)
          setSessionErrorMessage(strings.PENDING_CARRY_REASON_REQUIRED)
          return
        }
        if (discrepancy !== 0 && discrepancyReason.trim().length < 3) {
          setSessionError(true)
          setSessionErrorMessage(strings.DISCREPANCY_REASON_REQUIRED)
          return
        }
        await CashService.close(session._id, { countedClosingBalance: counted, closingNote, acknowledgePending: pendingCount > 0, pendingCarryReason: pendingCarryReason.trim() || undefined, discrepancyApproved: discrepancy !== 0, discrepancyReason: discrepancyReason.trim() || undefined }, supplierScope)
      }
      setSessionDialog(null)
      await onLoad(UserService.getCurrentUser() || undefined)
    } catch (error) {
 setSessionError(true); setSessionErrorMessage(helper.getErrorMessage(error, strings.SESSION_ERROR)); helper.error(error, helper.getErrorMessage(error, strings.SESSION_ERROR)) 
}
  }

  // F6 / W3 C-5 — headline figures come from the server-side journal
  // totals (one scope, confirmed-only, deposits held separately).
  // They are never re-summed from the rendered rows: a reversed,
  // pending or deposit row must not leak back into income/expenses.
  const income = journalTotals?.income ?? 0
  const expenses = journalTotals?.expenses ?? 0
  const net = journalTotals?.net ?? 0
  const deposits = journalTotals?.deposits ?? 0
  const depositRefunds = journalTotals?.depositRefunds ?? 0
  const pendingIn = journalTotals?.pendingIn ?? 0
  const pendingOut = journalTotals?.pendingOut ?? 0

  // GA-PAR-24 — on-demand Z-report PDF for the closed focused session.
  // Same blob-download pattern as the Reports car PDF; the button renders
  // only for a closed session and shares the close action's gating.
  const downloadZReport = async () => {
    if (!session?._id) {
      return
    }
    try {
      setSessionError(false)
      setSessionErrorMessage('')
      const blob = await CashService.zReport(session._id, supplierScope)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gestion-auto-z-report-${session._id}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setSessionError(true)
      setSessionErrorMessage(helper.getErrorMessage(error, strings.Z_REPORT_ERROR))
      helper.error(error, helper.getErrorMessage(error, strings.Z_REPORT_ERROR))
    }
  }

  const otherAccount = accountFocus === bookcarsTypes.CashAccountType.Cash ? bookcarsTypes.CashAccountType.Bank : bookcarsTypes.CashAccountType.Cash
  const otherCurrent = currentByAccount[otherAccount]

  // F6 / W3 C-1 — prefill the opening balance from the previous
  // counted close of the chosen account (null on a first session).
  const loadPreviousClose = async (account: bookcarsTypes.CashAccountType) => {
    try {
      const prev = await CashService.previousClose(account, supplierScope)
      setPreviousCloseBalance(prev ? prev.countedClosingBalance : null)
      setOpeningBalance(prev ? String(prev.countedClosingBalance) : '0')
      setOpeningDifferenceReason('')
    } catch {
      setPreviousCloseBalance(null)
    }
  }

  const openSessionDialog = async () => {
    // Default the dialog to the focused account, or to the other account when
    // the focused one already has an open session.
    const account = !currentByAccount[accountFocus] ? accountFocus : (!otherCurrent ? otherAccount : accountFocus)
    setOpenAccount(account)
    setSessionDialog('open')
    await loadPreviousClose(account)
  }

  // F6 / W3 C-4 — the close dialog previews the whole session's pending
  // entries and the expected balance (unfiltered: the journal table
  // itself may be date-filtered), so the closer sees what will be
  // carried and what discrepancy they are approving.
  const openCloseDialog = async () => {
    setSessionDialog('close')
    setPendingCarryReason('')
    setDiscrepancyReason('')
    setClosePreview(null)
    if (!session?._id) {
      return
    }
    try {
      const journal = await CashService.journal(session._id, supplierScope)
      const pending = (journal.rows || []).filter((row) => row.status === 'pending')
      setClosePreview({
        pendingCount: pending.length,
        pendingIn: pending.filter((row) => row.direction === bookcarsTypes.CashMovementDirection.In).reduce((sum, row) => sum + row.amount, 0),
        pendingOut: pending.filter((row) => row.direction === bookcarsTypes.CashMovementDirection.Out).reduce((sum, row) => sum + row.amount, 0),
        expectedBalance: journal.totals.expectedBalance,
      })
    } catch {
      setClosePreview(null)
    }
  }

  // F6 / W3 C-5 — journal CSV export (same filters + server totals as
  // the page). Same blob-download pattern as the Z-report.
  const downloadJournalCsv = async () => {
    if (!session?._id) {
      return
    }
    try {
      setSessionError(false)
      setSessionErrorMessage('')
      const blob = await CashService.journalCsv(session._id, supplierScope, { from: from || undefined, to: to || undefined })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gestion-auto-cash-journal-${session._id}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setSessionError(true)
      setSessionErrorMessage(helper.getErrorMessage(error, strings.JOURNAL_EXPORT_ERROR))
      helper.error(error, helper.getErrorMessage(error, strings.JOURNAL_EXPORT_ERROR))
    }
  }

  return (
    <Layout strict onLoad={onLoad}>
      {cashDenied ? <AccessDenied /> : (
      <div className="agency-cash">
        <div className="agency-cash__heading">
          <Typography component="p" className="agency-cash__eyebrow">{strings.EYEBROW}</Typography>
          <Typography component="h1" className="agency-cash__title">{strings.TITLE}</Typography>
          <Typography className="agency-cash__subtitle">{strings.SUBTITLE}</Typography>
          <div className="agency-cash__session">
            <TextField select size="small" label={strings.ACCOUNT} value={accountFocus} onChange={(event) => setAccountFocus(event.target.value as bookcarsTypes.CashAccountType)} SelectProps={{ native: true }}>
              <option value={bookcarsTypes.CashAccountType.Cash}>{strings.CASH}</option>
              <option value={bookcarsTypes.CashAccountType.Bank}>{strings.BANK_ACCOUNT}</option>
            </TextField>
            {otherCurrent ? <span>{`${accountName(otherAccount)} · ${strings.SESSION_OPEN}`}</span> : null}
            <span>{session ? `${accountName(session.account)} · ${session.status === bookcarsTypes.CashSessionStatus.Open ? strings.SESSION_OPEN : strings.SESSION_CLOSED} · ${session.currency}` : strings.NO_SESSION}</span>
            {session && <span className="agency-cash__session-balances">{strings.OPENING_BALANCE}: {formatAmount(session.openingBalance)} · {strings.EXPECTED}: {session.expectedClosingBalance === undefined ? '—' : formatAmount(session.expectedClosingBalance)} · {strings.COUNTED_BALANCE}: {session.countedClosingBalance === undefined ? '—' : formatAmount(session.countedClosingBalance)} · {strings.DISCREPANCY}: {session.discrepancy === undefined ? '—' : formatAmount(session.discrepancy)}</span>}
            {session?.status === bookcarsTypes.CashSessionStatus.Open ? <span className="agency-cash__session-actions"><Button disabled={!canAddMovement} variant="outlined" onClick={() => setSessionDialog('movement')}>{strings.ADD_MOVEMENT}</Button><Button disabled={!canMutateCash} variant="outlined" onClick={openTransfer}>{strings.TRANSFER}</Button><Button disabled={!canMutateCash} variant="contained" onClick={openCloseDialog}>{strings.CLOSE_SESSION}</Button></span> : <span className="agency-cash__session-actions"><Button disabled={!canMutateCash} variant="outlined" onClick={downloadZReport}>{strings.Z_REPORT}</Button><Button disabled={!canMutateCash} variant="contained" onClick={openSessionDialog}>{strings.OPEN_SESSION}</Button></span>}
          </div>
        </div>
        {loadError && <Alert severity="error" className="agency-cash__alert">{strings.LOAD_ERROR}</Alert>}
        {sessionError && <Alert severity="error" className="agency-cash__alert">{sessionErrorMessage || strings.SESSION_ERROR}</Alert>}
        {isAdmin && <div className="agency-cash__toolbar"><TextField select size="small" label={strings.AGENCY} value={agencyId} onChange={(event) => setAgencyId(event.target.value)}><MenuItem value="">{strings.ALL_AGENCIES}</MenuItem>{agencies.map((agency) => <MenuItem key={agency._id} value={agency._id || ''}>{agency.fullName}</MenuItem>)}</TextField>{!agencyId && <Typography variant="caption">{strings.AGENCY_REQUIRED}</Typography>}</div>}
        <div className="agency-cash__summary">
          <Card><CardContent><span className="agency-cash__summary-icon"><AccountBalanceWalletRoundedIcon /></span><small>{strings.INCOME}</small><strong>{loading ? '—' : formatAmount(income)}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-cash__summary-icon agency-cash__summary-icon--out">−</span><small>{strings.EXPENSES}</small><strong>{loading ? '—' : formatAmount(expenses)}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-cash__summary-icon agency-cash__summary-icon--net">{strings.ENTRIES.slice(0, 1)}</span><small>{strings.NET}</small><strong>{loading ? '—' : formatAmount(net)}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-cash__summary-icon">D</span><small>{strings.DEPOSITS}</small><strong>{loading ? '—' : formatAmount(deposits)}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-cash__summary-icon agency-cash__summary-icon--out">−</span><small>{strings.DEPOSIT_REFUNDS}</small><strong>{loading ? '—' : formatAmount(depositRefunds)}</strong></CardContent></Card>
        </div>
        {!loading && (pendingIn > 0 || pendingOut > 0) && <Typography variant="caption" className="agency-cash__pending">{strings.PENDING}: +{formatAmount(pendingIn)} / −{formatAmount(pendingOut)}</Typography>}
        {!loading && unlinkedCashTotal > 0 && <Alert severity="warning" className="agency-cash__alert">{strings.UNLINKED_CASH}: {formatAmount(unlinkedCashTotal)} ({unlinkedCashPayments.length})</Alert>}
        <section className="agency-cash__panel">
          <div className="agency-cash__toolbar">
            <TextField size="small" placeholder={strings.SEARCH} slotProps={{ htmlInput: { 'aria-label': strings.SEARCH } }} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <TextField size="small" type="date" label={strings.FROM} value={from} onChange={(event) => setFrom(event.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" type="date" label={strings.TO} value={to} onChange={(event) => setTo(event.target.value)} InputLabelProps={{ shrink: true }} />
            <Button variant="outlined" disabled={!session} onClick={downloadJournalCsv}>{strings.EXPORT_CSV}</Button>
          </div>
          <div className="agency-cash__table-head"><span>{strings.DATE}</span><span>{strings.TYPE}</span><span>{strings.REASON}</span><span>{strings.CONTEXT}</span><span>{strings.METHOD}</span><span>{strings.AMOUNT}</span></div>
          {loading ? <div className="agency-cash__empty">…</div> : filtered.length === 0 ? (
            <div className="agency-cash__empty"><AccountBalanceWalletRoundedIcon /><p>{strings.EMPTY}</p></div>
          ) : filtered.map((row) => (
            <div className="agency-cash__row" key={row.id}>
              <span>{formatDate(row.date)}</span>
              <span><span className={`agency-cash__kind ${row.direction === 'out' ? 'agency-cash__kind--out' : ''}`}>{row.direction === 'in' ? strings.INCOMING : strings.OUTGOING}{row.status === 'pending' ? ` · ${strings.PENDING}` : ''}</span></span>
              <strong>{row.reason}{row.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit ? ` · ${strings.DEPOSIT}` : ''}</strong><span>{row.context}</span><span>{row.method}</span>
              <strong className={row.direction === 'out' ? 'agency-cash__amount--out' : ''}>{row.direction === 'out' ? '−' : '+'}{formatAmount(row.amount)}</strong>
            </div>
          ))}
        </section>
        <Dialog open={sessionDialog !== null} onClose={() => setSessionDialog(null)} fullWidth maxWidth="xs">
          <DialogTitle>{sessionDialog === 'open' ? strings.OPEN_SESSION : sessionDialog === 'close' ? strings.CLOSE_SESSION : strings.ADD_MOVEMENT}</DialogTitle>
          <DialogContent className="agency-cash__dialog">
            {sessionDialog === 'open' ? <><TextField select label={strings.ACCOUNT} value={openAccount} onChange={(event) => { const account = event.target.value as bookcarsTypes.CashAccountType; setOpenAccount(account); loadPreviousClose(account) }} SelectProps={{ native: true }}><option value={bookcarsTypes.CashAccountType.Cash} disabled={!!currentByAccount[bookcarsTypes.CashAccountType.Cash]}>{strings.CASH}</option><option value={bookcarsTypes.CashAccountType.Bank} disabled={!!currentByAccount[bookcarsTypes.CashAccountType.Bank]}>{strings.BANK_ACCOUNT}</option></TextField><TextField autoFocus type="number" label={strings.OPENING_BALANCE} value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} inputProps={{ min: 0, step: 0.01 }} />{previousCloseBalance !== null && <Typography variant="body2">{strings.OPENING_CHAINED}: {formatAmount(previousCloseBalance)}</Typography>}{previousCloseBalance !== null && openingBalance !== '' && Number(openingBalance) !== previousCloseBalance && <TextField label={strings.OPENING_DIFFERENCE_REASON} value={openingDifferenceReason} onChange={(event) => setOpeningDifferenceReason(event.target.value)} multiline minRows={2} />}</> : sessionDialog === 'close' ? <><TextField autoFocus type="number" label={strings.COUNTED_BALANCE} value={countedBalance} onChange={(event) => setCountedBalance(event.target.value)} inputProps={{ min: 0, step: 0.01 }} /><TextField label={strings.CLOSE_NOTE} value={closingNote} onChange={(event) => setClosingNote(event.target.value)} multiline minRows={2} />{closePreview && closePreview.pendingCount > 0 && <Typography variant="body2">{strings.CLOSE_PENDING_WARNING}: {closePreview.pendingCount} ({formatAmount(closePreview.pendingIn)} / {formatAmount(closePreview.pendingOut)})</Typography>}{closePreview && closePreview.pendingCount > 0 && <TextField label={strings.PENDING_CARRY_REASON} value={pendingCarryReason} onChange={(event) => setPendingCarryReason(event.target.value)} multiline minRows={2} />}{closePreview && Number((Number(countedBalance) - closePreview.expectedBalance).toFixed(2)) !== 0 && <Typography variant="body2">{strings.CLOSE_DISCREPANCY_WARNING}: {formatAmount(Number((Number(countedBalance) - closePreview.expectedBalance).toFixed(2)))}</Typography>}{closePreview && Number((Number(countedBalance) - closePreview.expectedBalance).toFixed(2)) !== 0 && <TextField label={strings.DISCREPANCY_REASON} value={discrepancyReason} onChange={(event) => setDiscrepancyReason(event.target.value)} multiline minRows={2} />}</> : <><TextField select label={strings.DIRECTION} value={movementDirection} onChange={(event) => setMovementDirection(event.target.value as bookcarsTypes.CashMovementDirection)} SelectProps={{ native: true }}><option value={bookcarsTypes.CashMovementDirection.In}>{strings.INCOMING}</option><option value={bookcarsTypes.CashMovementDirection.Out}>{strings.OUTGOING}</option></TextField><TextField autoFocus type="number" label={strings.AMOUNT} value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} inputProps={{ min: 0, step: 0.01 }} /><TextField label={strings.REFERENCE} value={movementReference} onChange={(event) => setMovementReference(event.target.value)} /><TextField label={strings.NOTE} value={movementNote} onChange={(event) => setMovementNote(event.target.value)} multiline minRows={2} /></>}
          </DialogContent>
          <DialogActions><Button onClick={() => setSessionDialog(null)}>{strings.CANCEL}</Button><Button variant="contained" onClick={sessionDialog === 'movement' ? saveMovement : saveSession}>{strings.SAVE}</Button></DialogActions>
        </Dialog>
        <Dialog open={transferDialog} onClose={() => setTransferDialog(false)} fullWidth maxWidth="xs">
          <DialogTitle>{strings.TRANSFER}</DialogTitle>
          <DialogContent className="agency-cash__dialog">
            <TextField select label={strings.FROM} value={transferFrom} onChange={(event) => setTransferFrom(event.target.value)} SelectProps={{ native: true }}>
              <option value="" />
              {sessions.filter((item) => item.status === bookcarsTypes.CashSessionStatus.Open).map((item) => <option key={item._id} value={item._id}>{accountName(item.account)} · {item.currency}</option>)}
            </TextField>
            <TextField select label={strings.TO} value={transferTo} onChange={(event) => setTransferTo(event.target.value)} SelectProps={{ native: true }}>
              <option value="" />
              {sessions.filter((item) => item.status === bookcarsTypes.CashSessionStatus.Open && item._id !== transferFrom).map((item) => <option key={item._id} value={item._id}>{accountName(item.account)} · {item.currency}</option>)}
            </TextField>
            <TextField autoFocus type="number" label={strings.AMOUNT} value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} inputProps={{ min: 0, step: 0.01 }} />
            <TextField label={strings.REFERENCE} value={transferReference} onChange={(event) => setTransferReference(event.target.value)} />
            <TextField label={strings.NOTE} value={transferNote} onChange={(event) => setTransferNote(event.target.value)} multiline minRows={2} />
          </DialogContent>
          <DialogActions><Button onClick={() => setTransferDialog(false)}>{strings.CANCEL}</Button><Button variant="contained" onClick={saveTransfer}>{strings.SAVE}</Button></DialogActions>
        </Dialog>
      </div>
      )}
    </Layout>
  )
}

export default CashJournal


