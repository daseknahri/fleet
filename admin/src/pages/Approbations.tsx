import React, { useCallback, useId, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Layout from '@/components/Layout'
import * as ApprovalService from '@/services/ApprovalService'
import * as UserService from '@/services/UserService'
import * as SupplierService from '@/services/SupplierService'
import * as helper from '@/utils/helper'
import * as bookcarsTypes from ':bookcars-types'
import { strings } from '@/lang/approvals'
import env from '@/config/env.config'
import { useUserContext, UserContextType } from '@/context/UserContext'

const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}

const formatDateTime = (date?: string) => (date
  ? new Intl.DateTimeFormat(uiLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date))
  : '—')

const formatAmount = (approval: ApprovalService.Approval) => (approval.amount === undefined
  ? '—'
  : `${new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 2 }).format(approval.amount)} ${approval.currency || env.CURRENCY}`)

const statusLabel = (status: bookcarsTypes.ApprovalDecision) => (status === bookcarsTypes.ApprovalDecision.Approved
  ? strings.APPROVED
  : status === bookcarsTypes.ApprovalDecision.Rejected ? strings.REJECTED : strings.PENDING)

const statusColor = (status: bookcarsTypes.ApprovalDecision) => (status === bookcarsTypes.ApprovalDecision.Approved
  ? 'success'
  : status === bookcarsTypes.ApprovalDecision.Rejected ? 'error' : 'warning') as 'success' | 'error' | 'warning'

const Approbations = () => {
  const { user } = useUserContext() as UserContextType
  const [approvals, setApprovals] = useState<ApprovalService.Approval[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [suppliers, setSuppliers] = useState<bookcarsTypes.User[]>([])
  const [supplierNames, setSupplierNames] = useState<Record<string, string>>({})
  const [userNames, setUserNames] = useState<Record<string, string>>({})
  const [agencyFilter, setAgencyFilter] = useState('')
  const agencyFilterLabelId = useId()
  const formAgencyLabelId = useId()
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ supplier: '', subject: '', subjectType: '', amount: '', currency: 'MAD', reason: '' })

  const load = useCallback(async (currentUser?: bookcarsTypes.User) => {
    if (!currentUser) {
      return
    }
    setLoading(true)
    setError('')
    try {
      const list = await ApprovalService.list()
      setApprovals(list)
      if (helper.admin(currentUser)) {
        const available = await SupplierService.getAllSuppliers()
        setSuppliers(available)
        setSupplierNames(Object.fromEntries(available.map((s) => [s._id || '', s.fullName || s.email || ''])))
        setForm((current) => (current.supplier ? current : { ...current, supplier: available[0]?._id || '' }))
      }
      // Resolve requester/decider display names best-effort; ids that cannot
      // be resolved fall back to a short id rendering.
      const ids = new Set<string>()
      list.forEach((approval) => {
        if (approval.requestedBy) {
          ids.add(approval.requestedBy)
        }
        if (approval.decidedBy) {
          ids.add(approval.decidedBy)
        }
      })
      const names: Record<string, string> = {}
      await Promise.all(Array.from(ids).map(async (id) => {
        try {
          const resolved = await UserService.getUser(id)
          if (resolved?.fullName) {
            names[id] = resolved.fullName
          }
        } catch {
          // Name resolution is cosmetic; the backend record stays authoritative.
        }
      }))
      setUserNames(names)
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setLoading(false)
    }
  }, [])

  const personName = (id?: string) => {
    if (!id) {
      return '—'
    }
    return userNames[id] || supplierNames[id] || id.slice(-8).toUpperCase()
  }

  const agencyName = (id: string) => supplierNames[id] || id.slice(-8).toUpperCase()

  const decide = async (approval: ApprovalService.Approval, decision: bookcarsTypes.ApprovalDecision.Approved | bookcarsTypes.ApprovalDecision.Rejected) => {
    setBusy(true)
    setActionError('')
    try {
      await ApprovalService.decide(approval._id, decision, decisionReasons[approval._id]?.trim() || undefined)
      await load(user || undefined)
    } catch (err) {
      setActionError(helper.getErrorMessage(err, strings.ACTION_ERROR))
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    setBusy(true)
    setActionError('')
    try {
      await ApprovalService.create({
        ...(helper.admin(user) ? { supplier: form.supplier || undefined } : {}),
        subject: form.subject.trim(),
        subjectType: form.subjectType.trim(),
        amount: Number(form.amount),
        currency: form.currency || undefined,
        reason: form.reason.trim() || undefined,
      })
      setForm((current) => ({ ...current, subject: '', subjectType: '', amount: '', reason: '' }))
      await load(user || undefined)
    } catch (err) {
      setActionError(helper.getErrorMessage(err, strings.ACTION_ERROR))
    } finally {
      setBusy(false)
    }
  }

  const visible = helper.admin(user) && agencyFilter
    ? approvals.filter((approval) => approval.supplier === agencyFilter)
    : approvals

  return (
    <Layout strict onLoad={load}>
      <main className="agency-dashboard">
        <Box className="agency-dashboard__heading">
          <div>
            <Typography component="h1" className="agency-dashboard__title">{strings.TITLE}</Typography>
            <Typography>{strings.SUBTITLE}</Typography>
          </div>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {helper.admin(user) && (
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id={agencyFilterLabelId}>{strings.AGENCY}</InputLabel>
                <Select label={strings.AGENCY} labelId={agencyFilterLabelId} value={agencyFilter} onChange={(e) => setAgencyFilter(e.target.value)}>
                  <MenuItem value="">{strings.ALL_AGENCIES}</MenuItem>
                  {suppliers.map((supplier) => <MenuItem key={supplier._id} value={supplier._id}>{supplier.fullName}</MenuItem>)}
                </Select>
              </FormControl>
            )}
            <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => load(user || undefined)}>{strings.REFRESH}</Button>
          </Box>
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        {actionError && <Alert severity="error">{actionError}</Alert>}
        {loading ? (
          <Box sx={{ p: 5, textAlign: 'center' }}><CircularProgress /><Typography>{strings.LOADING}</Typography></Box>
        ) : !error && visible.length === 0 ? (
          <Typography sx={{ p: 3 }}>{strings.EMPTY}</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {visible.map((approval) => (
              <Card key={approval._id}>
                <CardContent>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="h6" component="h2">{approval.subject}</Typography>
                    <Chip size="small" label={approval.subjectType} />
                    <Chip size="small" color={statusColor(approval.status)} label={statusLabel(approval.status)} />
                  </Box>
                  <Typography variant="body2">
                    {`${strings.AMOUNT}: ${formatAmount(approval)} · ${strings.AGENCY}: ${agencyName(approval.supplier)}`}
                  </Typography>
                  <Typography variant="body2">
                    {`${strings.REQUESTED_BY}: ${personName(approval.requestedBy)} · ${strings.REQUESTED_AT}: ${formatDateTime(approval.createdAt)}`}
                  </Typography>
                  {approval.status !== bookcarsTypes.ApprovalDecision.Pending && (
                    <Typography variant="body2">
                      {`${strings.DECIDED_BY}: ${personName(approval.decidedBy)} · ${strings.DECIDED_AT}: ${formatDateTime(approval.decidedAt)}`}
                    </Typography>
                  )}
                  {approval.reason && <Typography variant="body2">{`${strings.REASON}: ${approval.reason}`}</Typography>}
                  {approval.status === bookcarsTypes.ApprovalDecision.Pending && (
                    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                      <TextField
                        size="small"
                        label={strings.DECISION_REASON}
                        value={decisionReasons[approval._id] || ''}
                        onChange={(e) => setDecisionReasons((current) => ({ ...current, [approval._id]: e.target.value }))}
                        sx={{ minWidth: 240, flex: '1 1 240px' }}
                      />
                      <Button variant="contained" color="success" disabled={busy} onClick={() => decide(approval, bookcarsTypes.ApprovalDecision.Approved)}>{strings.APPROVE}</Button>
                      <Button variant="outlined" color="error" disabled={busy} onClick={() => decide(approval, bookcarsTypes.ApprovalDecision.Rejected)}>{strings.REJECT}</Button>
                    </Box>
                  )}
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
        <Divider sx={{ my: 3 }} />
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2">{strings.NEW_TITLE}</Typography>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', mt: 1 }}>
              {helper.admin(user) && (
                <FormControl size="small">
                  <InputLabel id={formAgencyLabelId}>{strings.AGENCY}</InputLabel>
                  <Select label={strings.AGENCY} labelId={formAgencyLabelId} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })}>
                    {suppliers.map((supplier) => <MenuItem key={supplier._id} value={supplier._id}>{supplier.fullName}</MenuItem>)}
                  </Select>
                </FormControl>
              )}
              <TextField size="small" label={strings.SUBJECT} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              <TextField size="small" label={strings.SUBJECT_TYPE} value={form.subjectType} onChange={(e) => setForm({ ...form, subjectType: e.target.value })} />
              <TextField size="small" label={strings.AMOUNT} type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              <TextField size="small" label={strings.REASON} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Box>
            <Button sx={{ mt: 2 }} variant="contained" disabled={busy || !form.subject.trim() || !form.subjectType.trim() || !form.amount} onClick={create}>{strings.CREATE}</Button>
          </CardContent>
        </Card>
      </main>
    </Layout>
  )
}

export default Approbations
