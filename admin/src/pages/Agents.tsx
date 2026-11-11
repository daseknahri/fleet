import React, { useCallback, useMemo, useState } from 'react'
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
import * as AgentService from '@/services/AgentService'
import * as UserService from '@/services/UserService'
import * as helper from '@/utils/helper'
import { strings } from '@/lang/agents'

import '@/assets/css/agents.css'

type Agent = bookcarsTypes.Agent

const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}
const formatAmount = (amount: number | undefined) => (
  `${new Intl.NumberFormat(uiLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0)} MAD`
)
const formatDate = (value?: Date | string) => (
  value ? new Intl.DateTimeFormat(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
)

const typeLabel = (type: bookcarsTypes.AgentType) => (
  type === bookcarsTypes.AgentType.Riad ? strings.TYPE_RIAD
    : type === bookcarsTypes.AgentType.Hotel ? strings.TYPE_HOTEL
      : type === bookcarsTypes.AgentType.Taxi ? strings.TYPE_TAXI
        : type === bookcarsTypes.AgentType.Guide ? strings.TYPE_GUIDE
          : type === bookcarsTypes.AgentType.Agency ? strings.TYPE_AGENCY : strings.TYPE_OTHER
)
const modeLabel = (mode: bookcarsTypes.CommissionMode) => (
  mode === bookcarsTypes.CommissionMode.Percent ? strings.MODE_PERCENT
    : mode === bookcarsTypes.CommissionMode.PerDay ? strings.MODE_PER_DAY : strings.MODE_FIXED
)
const commissionLabel = (agent: Agent) => (
  agent.commissionMode === bookcarsTypes.CommissionMode.Percent
    ? `${agent.commissionValue} %`
    : `${formatAmount(agent.commissionValue)}${agent.commissionMode === bookcarsTypes.CommissionMode.PerDay ? ` / ${strings.MODE_PER_DAY.toLowerCase()}` : ''}`
)
const methodLabel = (method: bookcarsTypes.AgentSettlementMethod) => (
  method === bookcarsTypes.AgentSettlementMethod.BankTransfer ? strings.METHOD_BANK_TRANSFER
    : method === bookcarsTypes.AgentSettlementMethod.Card ? strings.METHOD_CARD
      : method === bookcarsTypes.AgentSettlementMethod.Other ? strings.METHOD_OTHER : strings.METHOD_CASH
)

const Agents = () => {
  const agencyPermissions = useAgencyPermissions()
  const agentsDenied = !!agencyPermissions?.loaded && !agencyPermissions.can(AgencyPermission.ReadAgents)
  const canManage = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.ManageAgents)
  const supplierScope = agencyPermissions?.supplier || undefined

  const [agents, setAgents] = useState<Agent[]>([])
  const [kpis, setKpis] = useState<bookcarsTypes.AgentKpis>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  // create / edit dialog
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [fName, setFName] = useState('')
  const [fPhone, setFPhone] = useState('')
  const [fType, setFType] = useState<bookcarsTypes.AgentType>(bookcarsTypes.AgentType.Other)
  const [fMode, setFMode] = useState<bookcarsTypes.CommissionMode>(bookcarsTypes.CommissionMode.Percent)
  const [fValue, setFValue] = useState('')
  const [fActive, setFActive] = useState(true)
  const [fNotes, setFNotes] = useState('')

  // settle dialog
  const [settleTarget, setSettleTarget] = useState<Agent | null>(null)
  const [sAmount, setSAmount] = useState('')
  const [sMethod, setSMethod] = useState<bookcarsTypes.AgentSettlementMethod>(bookcarsTypes.AgentSettlementMethod.Cash)
  const [sNote, setSNote] = useState('')

  // delete + settlements history
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [settlements, setSettlements] = useState<bookcarsTypes.AgentSettlement[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [list, kpiData] = await Promise.all([
        AgentService.list(supplierScope),
        AgentService.kpis(supplierScope),
      ])
      setAgents(list)
      setKpis(kpiData)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [supplierScope])

  const onLoad = useCallback(() => {
    load()
  }, [load])

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

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    if (!needle) return agents
    return agents.filter((agent) => [agent.name, agent.phone || ''].some((value) => value.toLowerCase().includes(needle)))
  }, [agents, keyword])

  const openCreate = () => {
    setEditId(null)
    setFName(''); setFPhone(''); setFType(bookcarsTypes.AgentType.Other)
    setFMode(bookcarsTypes.CommissionMode.Percent); setFValue(''); setFActive(true); setFNotes('')
    setFormOpen(true)
  }

  const openEdit = (agent: Agent) => {
    setEditId(agent._id || null)
    setFName(agent.name); setFPhone(agent.phone || ''); setFType(agent.type)
    setFMode(agent.commissionMode); setFValue(String(agent.commissionValue))
    setFActive(agent.active); setFNotes(agent.notes || '')
    setFormOpen(true)
  }

  const handleSave = () => runAction(async () => {
    const payload: bookcarsTypes.CreateAgentPayload = {
      supplier: supplierScope,
      name: fName.trim(),
      phone: fPhone.trim() || undefined,
      type: fType,
      commissionMode: fMode,
      commissionValue: Number(fValue),
      active: fActive,
      notes: fNotes.trim() || undefined,
    }
    if (editId) {
      await AgentService.update(editId, payload)
    } else {
      await AgentService.create(payload)
    }
    setFormOpen(false)
    await load()
  }, editId ? strings.UPDATED : strings.CREATED)

  const openSettle = (agent: Agent) => {
    setSettleTarget(agent)
    setSAmount(String(agent.due || 0))
    setSMethod(bookcarsTypes.AgentSettlementMethod.Cash)
    setSNote('')
  }

  const settleAmount = Number(sAmount)
  const settleDue = settleTarget?.due || 0
  const settleExceeds = Number.isFinite(settleAmount) && settleAmount > settleDue
  const settleInvalid = !Number.isFinite(settleAmount) || settleAmount <= 0 || settleExceeds

  const handleSettle = () => {
    if (!settleTarget?._id) return
    runAction(async () => {
      await AgentService.settle(settleTarget._id as string, {
        amount: settleAmount,
        method: sMethod,
        note: sNote.trim() || undefined,
      })
      setSettleTarget(null)
      await load()
    }, strings.SETTLED_OK)
  }

  const handleDelete = () => {
    if (!deleteTarget?._id) return
    runAction(async () => {
      await AgentService.remove(deleteTarget._id as string)
      setDeleteTarget(null)
      await load()
    }, strings.DELETED_OK)
  }

  const toggleHistory = (agent: Agent) => {
    if (historyFor === agent._id) {
      setHistoryFor(null)
      setSettlements([])
      return
    }
    runAction(async () => {
      const full = await AgentService.getOne(agent._id as string)
      setSettlements(full.settlements || [])
      setHistoryFor(agent._id || null)
    }, '')
  }

  if (agentsDenied) {
    return (
      <Layout strict onLoad={onLoad}>
        <AccessDenied />
      </Layout>
    )
  }

  return (
    <Layout strict onLoad={onLoad}>
      <div className="agency-agents">
        <div className="agency-agents__heading">
          <div>
            <Typography variant="h4" className="agency-agents__title">{strings.TITLE}</Typography>
            <Typography className="agency-agents__subtitle">{strings.SUBTITLE}</Typography>
          </div>
          <Box className="agency-agents__toolbar">
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

        {kpis && (
          <div className="agency-agents__kpis">
            <div className="agency-agents__kpi"><small>{strings.KPI_TOTAL_DUE}</small><strong>{formatAmount(kpis.totalDue)}</strong></div>
            <div className="agency-agents__kpi"><small>{strings.KPI_THIS_MONTH}</small><strong>{formatAmount(kpis.commissionsThisMonth)}</strong></div>
            <div className="agency-agents__kpi"><small>{strings.KPI_RENTAL_BROUGHT}</small><strong>{formatAmount(kpis.rentalBrought)}</strong></div>
            <div className="agency-agents__kpi"><small>{strings.KPI_ACTIVE_AGENTS}</small><strong>{kpis.activeAgents}</strong></div>
          </div>
        )}

        <Box className="agency-agents__toolbar">
          <TextField
            size="small"
            label={strings.SEARCH}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            sx={{ minWidth: 280 }}
          />
        </Box>

        {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
        {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
        {loadError && <Alert severity="error" sx={{ mb: 2 }}>{strings.ERROR}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 6 }}>
            <CircularProgress size={22} />
            <Typography>{strings.LOADING}</Typography>
          </Box>
        ) : (
          <div className="agency-agents__panel">
            <div className="agency-agents__grid agency-agents__head">
              <span>{strings.NAME}</span><span>{strings.TYPE}</span><span>{strings.COMMISSION}</span>
              <span>{strings.DUE}</span><span>{strings.RENTAL_BROUGHT}</span><span>{strings.STATUS}</span>
              <span />
              <span>{strings.ACTIONS}</span>
            </div>
            {filtered.length === 0 && (
              <Box sx={{ p: 3 }}><Typography>{strings.EMPTY}</Typography></Box>
            )}
            {filtered.map((agent) => (
              <React.Fragment key={agent._id}>
                <div className="agency-agents__grid agency-agents__row">
                  <span data-label={strings.NAME}>
                    <strong>{agent.name}</strong>
                    {agent.phone && (<><br /><small>{agent.phone}</small></>)}
                  </span>
                  <span data-label={strings.TYPE}>{typeLabel(agent.type)}</span>
                  <span data-label={strings.COMMISSION}>
                    {commissionLabel(agent)}
                    <br /><small>{modeLabel(agent.commissionMode)}</small>
                  </span>
                  <span data-label={strings.DUE}><strong>{formatAmount(agent.due)}</strong></span>
                  <span data-label={strings.RENTAL_BROUGHT}>{formatAmount(agent.rentalBrought)}</span>
                  <span data-label={strings.STATUS}>
                    <Chip size="small" color={agent.active ? 'success' : 'default'} label={agent.active ? strings.ACTIVE : strings.INACTIVE} />
                  </span>
                  <span />
                  <span className="agency-agents__actions">
                    {canManage && (
                      <Button size="small" variant="contained" disabled={busy || !(agent.due && agent.due > 0)} onClick={() => openSettle(agent)}>
                        {strings.SETTLE}
                      </Button>
                    )}
                    <Button size="small" variant="outlined" disabled={busy} onClick={() => toggleHistory(agent)}>
                      {strings.SETTLEMENTS}
                    </Button>
                    {canManage && (
                      <>
                        <Button size="small" variant="outlined" disabled={busy} onClick={() => openEdit(agent)}>
                          {strings.EDIT_TITLE}
                        </Button>
                        <Button size="small" color="error" variant="outlined" disabled={busy} onClick={() => setDeleteTarget(agent)}>
                          {strings.DELETE}
                        </Button>
                      </>
                    )}
                  </span>
                </div>
                {historyFor === agent._id && (
                  <div className="agency-agents__row" style={{ padding: '4px 16px 12px' }}>
                    <div className="agency-agents__settlements">
                      <Typography variant="subtitle2">{strings.SETTLEMENTS}</Typography>
                      {settlements.length === 0 && <Typography variant="body2">{strings.NO_SETTLEMENTS}</Typography>}
                      {settlements.map((settlement) => (
                        <div className="agency-agents__settlements-row" key={settlement._id}>
                          <span>{formatDate(settlement.confirmedAt || settlement.createdAt)}</span>
                          <strong>{formatAmount(settlement.amount)}</strong>
                          <span>{methodLabel(settlement.method)}</span>
                          <span>
                            {strings.CONFIRMED_BY}
                            : {typeof settlement.confirmedBy === 'string' ? settlement.confirmedBy : settlement.confirmedBy?.fullName || '—'}
                          </span>
                          <span>{strings.BOOKINGS_COVERED}: {(settlement.bookingRefs || []).length}</span>
                          {settlement.note && <span>{settlement.note}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        <Typography className="agency-agents__note">{strings.COMMISSION_SNAPSHOT_NOTE}</Typography>

        <Dialog open={formOpen} onClose={() => setFormOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>{editId ? strings.EDIT_TITLE : strings.CREATE_TITLE}</DialogTitle>
          <DialogContent className="agency-agents__form">
            <TextField label={strings.NAME} value={fName} onChange={(e) => setFName(e.target.value)} required fullWidth />
            <TextField label={strings.PHONE} value={fPhone} onChange={(e) => setFPhone(e.target.value)} fullWidth />
            <FormControl fullWidth>
              <InputLabel>{strings.TYPE}</InputLabel>
              <Select label={strings.TYPE} value={fType} onChange={(e) => setFType(e.target.value as bookcarsTypes.AgentType)}>
                {Object.values(bookcarsTypes.AgentType).map((type) => (
                  <MenuItem key={type} value={type}>{typeLabel(type)}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>{strings.COMMISSION_MODE}</InputLabel>
              <Select label={strings.COMMISSION_MODE} value={fMode} onChange={(e) => setFMode(e.target.value as bookcarsTypes.CommissionMode)}>
                {Object.values(bookcarsTypes.CommissionMode).map((mode) => (
                  <MenuItem key={mode} value={mode}>{modeLabel(mode)}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label={strings.COMMISSION_VALUE}
              type="number"
              value={fValue}
              onChange={(e) => setFValue(e.target.value)}
              required
              fullWidth
              inputProps={{ min: 0, step: 'any' }}
            />
            <FormControlLabel control={<Switch checked={fActive} onChange={(e) => setFActive(e.target.checked)} />} label={strings.ACTIVE} />
            <TextField label={strings.NOTES} value={fNotes} onChange={(e) => setFNotes(e.target.value)} fullWidth multiline minRows={2} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFormOpen(false)} disabled={busy}>{strings.CANCEL}</Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={busy || !fName.trim() || fValue === '' || !Number.isFinite(Number(fValue)) || Number(fValue) < 0}
            >
              {strings.SAVE}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={!!settleTarget} onClose={() => setSettleTarget(null)} fullWidth maxWidth="sm">
          <DialogTitle>{strings.SETTLE_TITLE}</DialogTitle>
          <DialogContent className="agency-agents__form">
            <Typography>
              {settleTarget?.name} — {strings.DUE}: <strong>{formatAmount(settleDue)}</strong>
            </Typography>
            <TextField
              label={strings.SETTLE_AMOUNT}
              type="number"
              value={sAmount}
              onChange={(e) => setSAmount(e.target.value)}
              required
              fullWidth
              error={settleExceeds}
              helperText={settleExceeds ? strings.SETTLE_EXCEEDS : `${strings.DUE_AFTER}: ${formatAmount(Math.max(0, settleDue - (Number.isFinite(settleAmount) ? settleAmount : 0)))}`}
              inputProps={{ min: 0, step: 'any' }}
            />
            <FormControl fullWidth>
              <InputLabel>{strings.SETTLE_METHOD}</InputLabel>
              <Select label={strings.SETTLE_METHOD} value={sMethod} onChange={(e) => setSMethod(e.target.value as bookcarsTypes.AgentSettlementMethod)}>
                {Object.values(bookcarsTypes.AgentSettlementMethod).map((method) => (
                  <MenuItem key={method} value={method}>{methodLabel(method)}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label={strings.SETTLE_NOTE} value={sNote} onChange={(e) => setSNote(e.target.value)} fullWidth />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSettleTarget(null)} disabled={busy}>{strings.CANCEL}</Button>
            <Button variant="contained" onClick={handleSettle} disabled={busy || settleInvalid}>{strings.SETTLE_CONFIRM}</Button>
          </DialogActions>
        </Dialog>

        <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} fullWidth maxWidth="sm">
          <DialogTitle>{strings.DELETE}</DialogTitle>
          <DialogContent><Typography>{strings.DELETE_CONFIRM}</Typography></DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteTarget(null)} disabled={busy}>{strings.CANCEL}</Button>
            <Button color="error" variant="contained" onClick={handleDelete} disabled={busy}>{strings.DELETE}</Button>
          </DialogActions>
        </Dialog>
      </div>
    </Layout>
  )
}

export default Agents
