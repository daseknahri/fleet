import React, { useCallback, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, InputLabel, MenuItem, Select, Switch, TextField, Typography,
} from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import * as bookcarsTypes from ':bookcars-types'
import Layout from '@/components/Layout'
import AccessDenied from '@/components/AccessDenied'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import * as ReminderService from '@/services/ReminderService'
import * as CarService from '@/services/CarService'
import * as UserService from '@/services/UserService'
import * as helper from '@/utils/helper'
import { strings } from '@/lang/reminders'

import '@/assets/css/reminders.css'

type Reminder = bookcarsTypes.Reminder

const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}
const formatDate = (value?: Date | string) => (
  value ? new Intl.DateTimeFormat(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
)
const toLocalInput = (value?: Date | string) => {
  if (!value) return ''
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const categoryLabel = (category: bookcarsTypes.ReminderCategory) => (
  category === bookcarsTypes.ReminderCategory.Rent ? strings.CAT_RENT
    : category === bookcarsTypes.ReminderCategory.OilChange ? strings.CAT_OIL
      : category === bookcarsTypes.ReminderCategory.Insurance ? strings.CAT_INSURANCE
        : category === bookcarsTypes.ReminderCategory.Visite ? strings.CAT_VISITE
          : category === bookcarsTypes.ReminderCategory.CallClient ? strings.CAT_CALL : strings.CAT_CUSTOM
)
const recurrenceLabel = (reminder: Reminder) => (
  reminder.recurrence.kind === bookcarsTypes.ReminderRecurrenceKind.Weekly ? strings.REC_WEEKLY
    : reminder.recurrence.kind === bookcarsTypes.ReminderRecurrenceKind.Monthly ? strings.REC_MONTHLY
      : reminder.recurrence.kind === bookcarsTypes.ReminderRecurrenceKind.Yearly ? strings.REC_YEARLY
        : reminder.recurrence.kind === bookcarsTypes.ReminderRecurrenceKind.Custom ? `${strings.REC_CUSTOM} (${reminder.recurrence.intervalDays || '?'}d)`
          : strings.REC_ONCE
)
const linkedLabel = (reminder: Reminder) => {
  if (reminder.linkType === bookcarsTypes.ReminderLinkType.Car && reminder.car && typeof reminder.car === 'object') {
    const car = reminder.car as bookcarsTypes.Car
    return car.licensePlate ? `${car.name} (${car.licensePlate})` : car.name
  }
  if (reminder.linkType === bookcarsTypes.ReminderLinkType.Client && reminder.client && typeof reminder.client === 'object') {
    return (reminder.client as bookcarsTypes.User).fullName
  }
  return '—'
}

const CATEGORIES: bookcarsTypes.ReminderCategory[] = [
  bookcarsTypes.ReminderCategory.Rent,
  bookcarsTypes.ReminderCategory.OilChange,
  bookcarsTypes.ReminderCategory.Insurance,
  bookcarsTypes.ReminderCategory.Visite,
  bookcarsTypes.ReminderCategory.CallClient,
  bookcarsTypes.ReminderCategory.Custom,
]

const Reminders = () => {
  const agencyPermissions = useAgencyPermissions()
  const denied = !!agencyPermissions?.loaded && !agencyPermissions.can(AgencyPermission.ReadReminders)
  const canManage = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.ManageReminders)
  const supplierScope = agencyPermissions?.supplier || undefined

  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const [cars, setCars] = useState<bookcarsTypes.Car[]>([])
  const [clients, setClients] = useState<bookcarsTypes.User[]>([])

  // create / edit dialog
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [fTitle, setFTitle] = useState('')
  const [fNote, setFNote] = useState('')
  const [fCategory, setFCategory] = useState<bookcarsTypes.ReminderCategory>(bookcarsTypes.ReminderCategory.Custom)
  const [fLinkType, setFLinkType] = useState<bookcarsTypes.ReminderLinkType>(bookcarsTypes.ReminderLinkType.None)
  const [fCar, setFCar] = useState('')
  const [fClient, setFClient] = useState('')
  const [fKind, setFKind] = useState<bookcarsTypes.ReminderRecurrenceKind>(bookcarsTypes.ReminderRecurrenceKind.Once)
  const [fInterval, setFInterval] = useState('')
  const [fFirstDue, setFFirstDue] = useState('')
  const [fOffsets, setFOffsets] = useState('0')
  const [fInApp, setFInApp] = useState(true)
  const [fEmail, setFEmail] = useState(false)
  const [fPush, setFPush] = useState(false)
  const [fActive, setFActive] = useState(true)

  const [deleteTarget, setDeleteTarget] = useState<Reminder | null>(null)
  const [historyFor, setHistoryFor] = useState<Reminder | null>(null)
  const [firings, setFirings] = useState<bookcarsTypes.ReminderFiring[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      setReminders(await ReminderService.list(supplierScope))
      if (supplierScope) {
        try {
          const carResult = await CarService.getCars('', { suppliers: [supplierScope] }, 1, 200)
          setCars(carResult?.[0]?.resultData || [])
        } catch { /* pickers stay empty; ids can still be saved from existing links */ }
        try {
          const userResult = await UserService.getUsers({ user: supplierScope, types: [bookcarsTypes.UserType.User] }, '', 1, 200)
          setClients(userResult?.[0]?.resultData || [])
        } catch { /* same as cars */ }
      }
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [supplierScope])

  const onLoad = useCallback(() => { load() }, [load])

  const runAction = async (action: () => Promise<void>, success: string) => {
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      await action()
      if (success) setNotice(success)
    } catch (err) {
      setActionError(helper.getErrorMessage(err, strings.ACTION_ERROR))
    } finally {
      setBusy(false)
    }
  }

  const openCreate = () => {
    setEditId(null)
    setFTitle(''); setFNote(''); setFCategory(bookcarsTypes.ReminderCategory.Custom)
    setFLinkType(bookcarsTypes.ReminderLinkType.None); setFCar(''); setFClient('')
    setFKind(bookcarsTypes.ReminderRecurrenceKind.Once); setFInterval('')
    setFFirstDue(toLocalInput(new Date())); setFOffsets('0')
    setFInApp(true); setFEmail(false); setFPush(false); setFActive(true)
    setFormOpen(true)
  }

  const openEdit = (reminder: Reminder) => {
    setEditId(reminder._id || null)
    setFTitle(reminder.title); setFNote(reminder.note || ''); setFCategory(reminder.category)
    setFLinkType(reminder.linkType)
    setFCar(reminder.car ? (typeof reminder.car === 'object' ? (reminder.car._id as string) : reminder.car) : '')
    setFClient(reminder.client ? (typeof reminder.client === 'object' ? (reminder.client._id as string) : reminder.client) : '')
    setFKind(reminder.recurrence.kind); setFInterval(reminder.recurrence.intervalDays ? String(reminder.recurrence.intervalDays) : '')
    setFFirstDue(toLocalInput(reminder.firstDueAt)); setFOffsets((reminder.notifyAheadHours || [0]).join(', '))
    setFInApp(reminder.channels.inApp); setFEmail(reminder.channels.email); setFPush(reminder.channels.push)
    setFActive(reminder.active)
    setFormOpen(true)
  }

  const parseOffsets = () => fOffsets.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 720)

  const handleSave = () => runAction(async () => {
    const offsets = parseOffsets()
    const payload: bookcarsTypes.CreateReminderPayload = {
      supplier: supplierScope,
      title: fTitle.trim(),
      note: fNote.trim() || undefined,
      category: fCategory,
      linkType: fLinkType,
      car: fLinkType === bookcarsTypes.ReminderLinkType.Car ? fCar : null,
      client: fLinkType === bookcarsTypes.ReminderLinkType.Client ? fClient : null,
      recurrence: {
        kind: fKind,
        intervalDays: fKind === bookcarsTypes.ReminderRecurrenceKind.Custom ? Number(fInterval) : undefined,
      },
      firstDueAt: new Date(fFirstDue).toISOString(),
      notifyAheadHours: offsets.length ? offsets : [0],
      channels: { inApp: fInApp, email: fEmail, push: fPush },
      active: fActive,
    }
    if (editId) {
      await ReminderService.update(editId, payload)
    } else {
      await ReminderService.create(payload)
    }
    setFormOpen(false)
    await load()
  }, editId ? strings.UPDATED : strings.CREATED)

  const handleDelete = () => {
    if (!deleteTarget?._id) return
    runAction(async () => {
      await ReminderService.remove(deleteTarget._id as string)
      setDeleteTarget(null)
      await load()
    }, strings.DELETED_OK)
  }

  const openHistory = (reminder: Reminder) => {
    runAction(async () => {
      setFirings(await ReminderService.firings(reminder._id as string))
      setHistoryFor(reminder)
    }, '')
  }

  if (denied) {
    return (
      <Layout strict onLoad={onLoad}>
        <AccessDenied />
      </Layout>
    )
  }

  return (
    <Layout strict onLoad={onLoad}>
      <div className="agency-reminders">
        <div className="agency-reminders__heading">
          <div>
            <Typography variant="h4" className="agency-reminders__title">{strings.TITLE}</Typography>
            <Typography className="agency-reminders__subtitle">{strings.SUBTITLE}</Typography>
          </div>
          <Box className="agency-reminders__toolbar">
            <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => load()} disabled={loading || busy}>
              {strings.REFRESH}
            </Button>
            {canManage && (
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openCreate} disabled={busy}>
                {strings.CREATE}
              </Button>
            )}
          </Box>
        </div>

        {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
        {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
        {loadError && <Alert severity="error" sx={{ mb: 2 }}>{strings.ERROR}</Alert>}

        <div className="agency-reminders__panel">
          <div className="agency-reminders__grid agency-reminders__head">
            <span>{strings.TITLE_LABEL}</span>
            <span>{strings.CATEGORY}</span>
            <span>{strings.LINK}</span>
            <span>{strings.RECURRENCE}</span>
            <span>{strings.NEXT_DUE}</span>
            <span>{strings.STATUS}</span>
            <span>{strings.ACTIONS}</span>
          </div>
          {loading && <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>}
          {!loading && reminders.length === 0 && <Box sx={{ p: 3 }}>{strings.EMPTY}</Box>}
          {!loading && reminders.map((reminder) => (
            <div className="agency-reminders__grid agency-reminders__row" key={reminder._id}>
              <span data-label={strings.TITLE_LABEL}>
                <strong>{reminder.title}</strong>
                {reminder.note && <><br /><small>{reminder.note}</small></>}
              </span>
              <span data-label={strings.CATEGORY}>{categoryLabel(reminder.category)}</span>
              <span data-label={strings.LINK}>{linkedLabel(reminder)}</span>
              <span data-label={strings.RECURRENCE}>{recurrenceLabel(reminder)}</span>
              <span data-label={strings.NEXT_DUE}>
                {formatDate(reminder.nextDueAt)}
                {reminder.lastFiredAt && <><br /><small>{`${strings.LAST_FIRED}: ${formatDate(reminder.lastFiredAt)}`}</small></>}
              </span>
              <span data-label={strings.STATUS}>
                <Chip size="small" color={reminder.active ? 'success' : 'default'} label={reminder.active ? strings.ACTIVE : strings.INACTIVE} />
              </span>
              <span className="agency-reminders__actions">
                {canManage && <Button size="small" onClick={() => openEdit(reminder)} disabled={busy}>{strings.EDIT_TITLE}</Button>}
                {canManage && <Button size="small" onClick={() => openHistory(reminder)} disabled={busy}>{strings.HISTORY}</Button>}
                {canManage && <Button size="small" color="error" onClick={() => setDeleteTarget(reminder)} disabled={busy}>{strings.DELETE}</Button>}
              </span>
            </div>
          ))}
        </div>

        <Dialog open={formOpen} onClose={() => setFormOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>{editId ? strings.EDIT_TITLE : strings.CREATE_TITLE}</DialogTitle>
          <DialogContent className="agency-reminders__form">
            <TextField label={strings.TITLE_LABEL} value={fTitle} onChange={(e) => setFTitle(e.target.value)} fullWidth required />
            <TextField label={strings.NOTE} value={fNote} onChange={(e) => setFNote(e.target.value)} fullWidth />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {CATEGORIES.map((category) => (
                <Chip
                  key={category}
                  label={categoryLabel(category)}
                  color={fCategory === category ? 'primary' : 'default'}
                  onClick={() => setFCategory(category)}
                />
              ))}
            </Box>
            <FormControl fullWidth>
              <InputLabel>{strings.LINK}</InputLabel>
              <Select value={fLinkType} label={strings.LINK} onChange={(e) => setFLinkType(e.target.value as bookcarsTypes.ReminderLinkType)}>
                <MenuItem value={bookcarsTypes.ReminderLinkType.None}>{strings.LINK_NONE}</MenuItem>
                <MenuItem value={bookcarsTypes.ReminderLinkType.Car}>{strings.LINK_CAR}</MenuItem>
                <MenuItem value={bookcarsTypes.ReminderLinkType.Client}>{strings.LINK_CLIENT}</MenuItem>
              </Select>
            </FormControl>
            {fLinkType === bookcarsTypes.ReminderLinkType.Car && (
              <FormControl fullWidth>
                <InputLabel>{strings.LINK_CAR}</InputLabel>
                <Select value={fCar} label={strings.LINK_CAR} onChange={(e) => setFCar(e.target.value)}>
                  {cars.map((car) => (
                    <MenuItem key={car._id} value={car._id}>{car.licensePlate ? `${car.name} (${car.licensePlate})` : car.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {fLinkType === bookcarsTypes.ReminderLinkType.Client && (
              <FormControl fullWidth>
                <InputLabel>{strings.LINK_CLIENT}</InputLabel>
                <Select value={fClient} label={strings.LINK_CLIENT} onChange={(e) => setFClient(e.target.value)}>
                  {clients.map((client) => (
                    <MenuItem key={client._id} value={client._id}>{client.fullName}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <FormControl fullWidth>
              <InputLabel>{strings.RECURRENCE}</InputLabel>
              <Select value={fKind} label={strings.RECURRENCE} onChange={(e) => setFKind(e.target.value as bookcarsTypes.ReminderRecurrenceKind)}>
                <MenuItem value={bookcarsTypes.ReminderRecurrenceKind.Once}>{strings.REC_ONCE}</MenuItem>
                <MenuItem value={bookcarsTypes.ReminderRecurrenceKind.Weekly}>{strings.REC_WEEKLY}</MenuItem>
                <MenuItem value={bookcarsTypes.ReminderRecurrenceKind.Monthly}>{strings.REC_MONTHLY}</MenuItem>
                <MenuItem value={bookcarsTypes.ReminderRecurrenceKind.Yearly}>{strings.REC_YEARLY}</MenuItem>
                <MenuItem value={bookcarsTypes.ReminderRecurrenceKind.Custom}>{strings.REC_CUSTOM}</MenuItem>
              </Select>
            </FormControl>
            {fKind === bookcarsTypes.ReminderRecurrenceKind.Custom && (
              <TextField label={strings.INTERVAL_DAYS} type="number" value={fInterval} onChange={(e) => setFInterval(e.target.value)} fullWidth />
            )}
            <TextField label={strings.FIRST_DUE} type="datetime-local" value={fFirstDue} onChange={(e) => setFFirstDue(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
            <TextField label={strings.NOTIFY_AHEAD} value={fOffsets} onChange={(e) => setFOffsets(e.target.value)} fullWidth />
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <FormControlLabel control={<Switch checked={fInApp} onChange={(e) => setFInApp(e.target.checked)} />} label={`${strings.CHANNELS}: ${strings.CHANNEL_INAPP}`} />
              <FormControlLabel control={<Switch checked={fEmail} onChange={(e) => setFEmail(e.target.checked)} />} label={strings.CHANNEL_EMAIL} />
              <FormControlLabel control={<Switch checked={fPush} onChange={(e) => setFPush(e.target.checked)} />} label={strings.CHANNEL_PUSH} />
              <FormControlLabel control={<Switch checked={fActive} onChange={(e) => setFActive(e.target.checked)} />} label={strings.ACTIVE} />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFormOpen(false)}>{strings.CANCEL}</Button>
            <Button variant="contained" onClick={handleSave} disabled={busy || !fTitle.trim() || !fFirstDue}>{strings.SAVE}</Button>
          </DialogActions>
        </Dialog>

        <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
          <DialogTitle>{strings.DELETE}</DialogTitle>
          <DialogContent>{strings.DELETE_CONFIRM}</DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteTarget(null)}>{strings.CANCEL}</Button>
            <Button variant="contained" color="error" onClick={handleDelete} disabled={busy}>{strings.DELETE}</Button>
          </DialogActions>
        </Dialog>

        <Dialog open={!!historyFor} onClose={() => setHistoryFor(null)} fullWidth maxWidth="sm">
          <DialogTitle>{strings.HISTORY}</DialogTitle>
          <DialogContent>
            {firings.length === 0 && <Typography>{strings.HISTORY_EMPTY}</Typography>}
            {firings.map((firing) => (
              <div className="agency-reminders__settlements-row" key={firing._id}>
                <span>{`${strings.FIRED_AT}: ${formatDate(firing.firedAt)}`}</span>
                <span>{`${strings.OCCURRENCE}: ${formatDate(firing.occurrenceAt)}`}</span>
                <span>{`${strings.OFFSET}: ${firing.offsetHours}`}</span>
                <span>{`${strings.SENT}: ${firing.inAppCount || 0} / ${firing.emailCount || 0} / ${firing.pushCount || 0}`}</span>
              </div>
            ))}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setHistoryFor(null)}>{strings.CANCEL}</Button>
          </DialogActions>
        </Dialog>
      </div>
    </Layout>
  )
}

export default Reminders
