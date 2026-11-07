import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material'
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded'
import * as bookcarsTypes from ':bookcars-types'
import Layout from '@/components/Layout'
import * as MaintenanceExpenseService from '@/services/MaintenanceExpenseService'
import * as RentalPaymentService from '@/services/RentalPaymentService'
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
}

const vehicleName = (car: string | bookcarsTypes.Car | null | undefined) => {
  // The expense API can return a null car when the referenced vehicle no
  // longer resolves; rendering must degrade to a placeholder, not throw.
  if (!car || typeof car === 'string') {
    return '—'
  }
  return `${car.name}${car.licensePlate ? ` · ${car.licensePlate}` : ''}`
}

const getCustomer = (booking?: bookcarsTypes.Booking) => (
  booking?.driver && typeof booking.driver !== 'string' ? booking.driver.fullName || booking.driver.email || '' : ''
)

const methodName = (method: bookcarsTypes.RentalPaymentMethod) => {
  switch (method) {
    case bookcarsTypes.RentalPaymentMethod.BankTransfer: return strings.BANK
    case bookcarsTypes.RentalPaymentMethod.Card: return strings.CARD
    case bookcarsTypes.RentalPaymentMethod.Other: return strings.OTHER
    default: return strings.CASH
  }
}

const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}

const formatAmount = (amount: number) => `${new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 2 }).format(amount)} ${env.CURRENCY}`

const formatDate = (date: Date) => new Intl.DateTimeFormat(uiLocale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date))

const accountName = (account: bookcarsTypes.CashAccountType) => (account === bookcarsTypes.CashAccountType.Bank ? strings.BANK_ACCOUNT : strings.CASH)

const CashJournal = () => {
  const [user, setUser] = useState<bookcarsTypes.User | null>(null)
  const [agencies, setAgencies] = useState<bookcarsTypes.User[]>([])
  const [agencyId, setAgencyId] = useState('')
  const [rows, setRows] = useState<JournalRow[]>([])
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
  const [sessionError, setSessionError] = useState(false)
  const [sessionErrorMessage, setSessionErrorMessage] = useState('')
  const [movementDirection, setMovementDirection] = useState<bookcarsTypes.CashMovementDirection>(bookcarsTypes.CashMovementDirection.In)
  const [movementAmount, setMovementAmount] = useState('')
  const [movementReference, setMovementReference] = useState('')
  const [movementNote, setMovementNote] = useState('')

  const isAdmin = user?.type === bookcarsTypes.RecordType.Admin
  const supplierScope = isAdmin ? (agencyId || undefined) : undefined
  const canMutate = !isAdmin || !!supplierScope

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
      const [payments, expenses, listedSessions, currentCash, currentBank] = await Promise.all([
        RentalPaymentService.list(),
        MaintenanceExpenseService.list(),
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
      const movementRows: JournalRow[] = selectedSession?._id
        ? (await CashService.movements(selectedSession._id, scope)).map((movement) => ({
          id: `movement-${movement._id}`,
          date: new Date(movement.date),
          direction: movement.direction,
          reason: movement.source === bookcarsTypes.CashMovementSource.Transfer ? strings.TRANSFER : strings.MANUAL_MOVEMENT,
          context: [movement.reference, movement.note].filter(Boolean).join(' · ') || '—',
          method: selectedSession.account === bookcarsTypes.CashAccountType.Bank ? strings.BANK : strings.CASH,
          amount: movement.amount,
          searchText: `${movement.reference || ''} ${movement.note || ''} ${movement.source}`.toLocaleLowerCase(),
        })) : []
      const paymentRows: JournalRow[] = (payments || []).map((payment) => {
        const booking = typeof payment.booking === 'string' ? undefined : payment.booking
        const car = booking?.car
        const vehicle = car ? vehicleName(car) : ''
        const customer = getCustomer(booking)
        const contractId = booking?._id || (typeof payment.booking === 'string' ? payment.booking : '')
        return {
          id: `payment-${payment._id}`,
          date: new Date(payment.date),
          direction: 'in',
          reason: strings.PAYMENT,
          context: [contractId ? contractId.slice(-8).toUpperCase() : '', vehicle, customer].filter(Boolean).join(' · ') || '—',
          method: methodName(payment.method),
          amount: payment.amount,
          searchText: `${strings.PAYMENT} ${contractId} ${vehicle} ${customer} ${payment.reference || ''} ${payment.note || ''}`.toLocaleLowerCase(),
        }
      })
      const expenseRows: JournalRow[] = (expenses || []).map((expense) => {
        const vehicle = vehicleName(expense.car)
        const reason = expense.vendor || expense.note || strings.MAINTENANCE
        return {
          id: `expense-${expense._id}`,
          date: new Date(expense.date),
          direction: 'out',
          reason,
          context: vehicle,
          method: strings.MAINTENANCE,
          amount: expense.amount,
          searchText: `${strings.MAINTENANCE} ${reason} ${vehicle} ${expense.type}`.toLocaleLowerCase(),
        }
      })
      setRows([...movementRows, ...paymentRows, ...expenseRows].sort((a, b) => b.date.getTime() - a.date.getTime()))
    } catch (error) {
 setLoadError(true); helper.error(error) 
} finally {
 setLoading(false) 
}
  }, [agencies.length, agencyId, accountFocus])

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
        await CashService.open({ account: openAccount, openingBalance: Number(openingBalance), supplier: supplierScope })
      } else if (sessionDialog === 'close' && session?._id) {
        await CashService.close(session._id, { countedClosingBalance: Number(countedBalance), closingNote }, supplierScope)
      }
      setSessionDialog(null)
      await onLoad(UserService.getCurrentUser() || undefined)
    } catch (error) {
 setSessionError(true); setSessionErrorMessage(helper.getErrorMessage(error, strings.SESSION_ERROR)); helper.error(error, helper.getErrorMessage(error, strings.SESSION_ERROR)) 
}
  }

  const otherAccount = accountFocus === bookcarsTypes.CashAccountType.Cash ? bookcarsTypes.CashAccountType.Bank : bookcarsTypes.CashAccountType.Cash
  const otherCurrent = currentByAccount[otherAccount]

  const openSessionDialog = () => {
    // Default the dialog to the focused account, or to the other account when
    // the focused one already has an open session.
    setOpenAccount(!currentByAccount[accountFocus] ? accountFocus : (!otherCurrent ? otherAccount : accountFocus))
    setSessionDialog('open')
  }

  const income = filtered.reduce((sum, row) => sum + (row.direction === 'in' ? row.amount : 0), 0)
  const expenses = filtered.reduce((sum, row) => sum + (row.direction === 'out' ? row.amount : 0), 0)
  const net = income - expenses

  return (
    <Layout strict onLoad={onLoad}>
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
            {session?.status === bookcarsTypes.CashSessionStatus.Open ? <span className="agency-cash__session-actions"><Button disabled={!canMutate} variant="outlined" onClick={() => setSessionDialog('movement')}>{strings.ADD_MOVEMENT}</Button><Button disabled={!canMutate} variant="outlined" onClick={openTransfer}>{strings.TRANSFER}</Button><Button disabled={!canMutate} variant="contained" onClick={() => setSessionDialog('close')}>{strings.CLOSE_SESSION}</Button></span> : <Button disabled={!canMutate} variant="contained" onClick={openSessionDialog}>{strings.OPEN_SESSION}</Button>}
          </div>
        </div>
        {loadError && <Alert severity="error" className="agency-cash__alert">{strings.LOAD_ERROR}</Alert>}
        {sessionError && <Alert severity="error" className="agency-cash__alert">{sessionErrorMessage || strings.SESSION_ERROR}</Alert>}
        {isAdmin && <div className="agency-cash__toolbar"><TextField select size="small" label={strings.AGENCY} value={agencyId} onChange={(event) => setAgencyId(event.target.value)}><MenuItem value="">{strings.ALL_AGENCIES}</MenuItem>{agencies.map((agency) => <MenuItem key={agency._id} value={agency._id || ''}>{agency.fullName}</MenuItem>)}</TextField>{!agencyId && <Typography variant="caption">{strings.AGENCY_REQUIRED}</Typography>}</div>}
        <div className="agency-cash__summary">
          <Card><CardContent><span className="agency-cash__summary-icon"><AccountBalanceWalletRoundedIcon /></span><small>{strings.INCOME}</small><strong>{loading ? '—' : formatAmount(income)}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-cash__summary-icon agency-cash__summary-icon--out">−</span><small>{strings.EXPENSES}</small><strong>{loading ? '—' : formatAmount(expenses)}</strong></CardContent></Card>
          <Card><CardContent><span className="agency-cash__summary-icon agency-cash__summary-icon--net">{strings.ENTRIES.slice(0, 1)}</span><small>{strings.NET}</small><strong>{loading ? '—' : formatAmount(net)}</strong></CardContent></Card>
        </div>
        <section className="agency-cash__panel">
          <div className="agency-cash__toolbar">
            <TextField size="small" placeholder={strings.SEARCH} slotProps={{ htmlInput: { 'aria-label': strings.SEARCH } }} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <TextField size="small" type="date" label={strings.FROM} value={from} onChange={(event) => setFrom(event.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" type="date" label={strings.TO} value={to} onChange={(event) => setTo(event.target.value)} InputLabelProps={{ shrink: true }} />
          </div>
          <div className="agency-cash__table-head"><span>{strings.DATE}</span><span>{strings.TYPE}</span><span>{strings.REASON}</span><span>{strings.CONTEXT}</span><span>{strings.METHOD}</span><span>{strings.AMOUNT}</span></div>
          {loading ? <div className="agency-cash__empty">…</div> : filtered.length === 0 ? (
            <div className="agency-cash__empty"><AccountBalanceWalletRoundedIcon /><p>{strings.EMPTY}</p></div>
          ) : filtered.map((row) => (
            <div className="agency-cash__row" key={row.id}>
              <span>{formatDate(row.date)}</span>
              <span><span className={`agency-cash__kind ${row.direction === 'out' ? 'agency-cash__kind--out' : ''}`}>{row.direction === 'in' ? strings.INCOMING : strings.OUTGOING}</span></span>
              <strong>{row.reason}</strong><span>{row.context}</span><span>{row.method}</span>
              <strong className={row.direction === 'out' ? 'agency-cash__amount--out' : ''}>{row.direction === 'out' ? '−' : '+'}{formatAmount(row.amount)}</strong>
            </div>
          ))}
        </section>
        <Dialog open={sessionDialog !== null} onClose={() => setSessionDialog(null)} fullWidth maxWidth="xs">
          <DialogTitle>{sessionDialog === 'open' ? strings.OPEN_SESSION : sessionDialog === 'close' ? strings.CLOSE_SESSION : strings.ADD_MOVEMENT}</DialogTitle>
          <DialogContent className="agency-cash__dialog">
            {sessionDialog === 'open' ? <><TextField select label={strings.ACCOUNT} value={openAccount} onChange={(event) => setOpenAccount(event.target.value as bookcarsTypes.CashAccountType)} SelectProps={{ native: true }}><option value={bookcarsTypes.CashAccountType.Cash} disabled={!!currentByAccount[bookcarsTypes.CashAccountType.Cash]}>{strings.CASH}</option><option value={bookcarsTypes.CashAccountType.Bank} disabled={!!currentByAccount[bookcarsTypes.CashAccountType.Bank]}>{strings.BANK_ACCOUNT}</option></TextField><TextField autoFocus type="number" label={strings.OPENING_BALANCE} value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} inputProps={{ min: 0, step: 0.01 }} /></> : sessionDialog === 'close' ? <><TextField autoFocus type="number" label={strings.COUNTED_BALANCE} value={countedBalance} onChange={(event) => setCountedBalance(event.target.value)} inputProps={{ min: 0, step: 0.01 }} /><TextField label={strings.CLOSE_NOTE} value={closingNote} onChange={(event) => setClosingNote(event.target.value)} multiline minRows={2} /></> : <><TextField select label={strings.DIRECTION} value={movementDirection} onChange={(event) => setMovementDirection(event.target.value as bookcarsTypes.CashMovementDirection)} SelectProps={{ native: true }}><option value={bookcarsTypes.CashMovementDirection.In}>{strings.INCOMING}</option><option value={bookcarsTypes.CashMovementDirection.Out}>{strings.OUTGOING}</option></TextField><TextField autoFocus type="number" label={strings.AMOUNT} value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} inputProps={{ min: 0, step: 0.01 }} /><TextField label={strings.REFERENCE} value={movementReference} onChange={(event) => setMovementReference(event.target.value)} /><TextField label={strings.NOTE} value={movementNote} onChange={(event) => setMovementNote(event.target.value)} multiline minRows={2} /></>}
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
    </Layout>
  )
}

export default CashJournal


