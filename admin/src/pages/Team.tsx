import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Select, TextField, Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import * as bookcarsTypes from ':bookcars-types'
import * as SupplierService from '@/services/SupplierService'
import * as AgencyMembershipService from '@/services/AgencyMembershipService'
import Layout from '@/components/Layout'
import * as helper from '@/utils/helper'
import * as UserService from '@/services/UserService'
import { strings } from '@/lang/team'

import '@/assets/css/team.css'

interface MembershipForm {
  email: string
  fullName: string
  password: string
  role: bookcarsTypes.AgencyRole
}

interface MembershipRow extends bookcarsTypes.AgencyMembership {}

const emptyForm = (): MembershipForm => ({
  email: '', fullName: '', password: '', role: bookcarsTypes.AgencyRole.CounterAgent,
})

const roleLabel = (role: bookcarsTypes.AgencyRole) => {
  switch (role) {
    case bookcarsTypes.AgencyRole.Manager: return strings.MANAGER
    case bookcarsTypes.AgencyRole.CounterAgent: return strings.COUNTER_AGENT
    case bookcarsTypes.AgencyRole.Accountant: return strings.ACCOUNTANT
    case bookcarsTypes.AgencyRole.Mechanic: return strings.MECHANIC
    case bookcarsTypes.AgencyRole.ReadOnly: return strings.READ_ONLY
    default: return role
  }
}

const statusLabel = (status: bookcarsTypes.AgencyMembershipStatus) => {
  switch (status) {
    case bookcarsTypes.AgencyMembershipStatus.Active: return strings.ACTIVE
    case bookcarsTypes.AgencyMembershipStatus.Suspended: return strings.SUSPENDED
    case bookcarsTypes.AgencyMembershipStatus.Pending: return strings.PENDING
    default: return status
  }
}

const Team = () => {
  const [user, setUser] = useState<bookcarsTypes.User>()
  const [language] = useState(UserService.getLanguage())
  const isRtl = language === 'ar'
  const isAdmin = helper.admin(user)
  const isAgencyOwner = user?.type === bookcarsTypes.UserType.Supplier
  const [agencies, setAgencies] = useState<bookcarsTypes.User[]>([])
  const [selectedAgencyId, setSelectedAgencyId] = useState<string>('')
  const [memberships, setMemberships] = useState<MembershipRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [networkError, setNetworkError] = useState(false)
  const [unauthorized, setUnauthorized] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(false)
  const [form, setForm] = useState<MembershipForm>(emptyForm)

  const canManage = useMemo(() => isAdmin || isAgencyOwner, [isAdmin, isAgencyOwner])

  const loadAgencies = useCallback(async () => {
    if (!isAdmin) {
      return
    }
    try {
      const rows = await SupplierService.getAllSuppliers()
      setAgencies(rows)
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status
      setLoadError(true)
      setUnauthorized(status === 401 || status === 403)
      setNetworkError(!(status === 401 || status === 403))
      helper.error(error, status === 401 || status === 403 ? strings.UNAUTHORIZED : strings.NETWORK_ERROR)
    }
  }, [isAdmin])

  const loadMemberships = useCallback(async (supplierId: string) => {
    setLoading(true)
    setLoadError(false)
    setNetworkError(false)
    setUnauthorized(false)
    try {
      const rows = isAdmin || isAgencyOwner
        ? await AgencyMembershipService.list(supplierId)
        : await AgencyMembershipService.listCurrent()
      setMemberships(rows as MembershipRow[])
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status
      setLoadError(true)
      setUnauthorized(status === 401 || status === 403)
      setNetworkError(!(status === 401 || status === 403))
      helper.error(error, status === 401 || status === 403 ? strings.UNAUTHORIZED : strings.NETWORK_ERROR)
    } finally {
      setLoading(false)
    }
  }, [isAdmin, isAgencyOwner])

  useEffect(() => {
    if (isAdmin) {
      void loadAgencies()
    }
  }, [isAdmin, loadAgencies])

  useEffect(() => {
    if (isAdmin && agencies.length && !selectedAgencyId) {
      setSelectedAgencyId(agencies[0]._id || '')
    }
    if (isAgencyOwner && user?._id && !selectedAgencyId) {
      setSelectedAgencyId(user._id)
    }
    if (isAdmin && !agencies.length && !selectedAgencyId) {
      setLoading(false)
    }
  }, [isAdmin, isAgencyOwner, user?._id, agencies, selectedAgencyId])

  const userKnown = !!user

  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
    if (!userKnown) {
      // Identity is not known yet (Layout onLoad is async). Loading now would
      // fire a spurious /current request that the backend rejects with 400
      // for admin and supplier sessions, which have no implicit current agency.
      return
    }
    if ((isAdmin || isAgencyOwner) && selectedAgencyId) {
      void loadMemberships(selectedAgencyId)
    } else if (!isAdmin && !isAgencyOwner) {
      void loadMemberships('')
    }
  }, [selectedAgencyId, isAdmin, isAgencyOwner, isRtl, loadMemberships, userKnown])

  const handleCreate = async () => {
    if (!form.email || !form.fullName || !form.password || !form.role) {
      setFormError(true)
      return
    }
    const supplierId = isAdmin || isAgencyOwner ? selectedAgencyId : memberships[0]?.supplier || ''
    if (!supplierId) {
      setFormError(true)
      return
    }
    setSaving(true)
    setFormError(false)
    try {
      await AgencyMembershipService.create(supplierId, {
        email: form.email.trim().toLowerCase(),
        fullName: form.fullName.trim(),
        password: form.password,
        role: form.role,
      })
      setDialogOpen(false)
      setForm(emptyForm())
      void loadMemberships(supplierId)
    } catch (error) {
      helper.error(error, strings.CREATE_ERROR)
      setFormError(true)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (membership: MembershipRow, field: 'role' | 'status', value: string) => {
    const supplierId = isAdmin || isAgencyOwner ? selectedAgencyId : memberships[0]?.supplier || ''
    if (!membership._id || !supplierId) {
      return
    }
    setSaving(true)
    try {
      if (field === 'role') {
        await AgencyMembershipService.update(supplierId, membership._id, { role: value as bookcarsTypes.AgencyRole })
      } else {
        await AgencyMembershipService.update(supplierId, membership._id, { status: value as bookcarsTypes.AgencyMembershipStatus })
      }
      setMemberships((rows) => rows.map((row) =>
        row._id === membership._id ? { ...row, [field]: value } : row,
      ))
    } catch (error) {
      helper.error(error, strings.UPDATE_ERROR)
    } finally {
      setSaving(false)
    }
  }

  const openCreate = () => {
    setForm(emptyForm())
    setFormError(false)
    setDialogOpen(true)
  }

  return (
    <Layout strict onLoad={setUser} style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
      {user && (
        <div className="agency-team">
          <div className="agency-team__heading">
            <div>
              <Typography component="p" className="agency-team__eyebrow">{strings.EYEBROW}</Typography>
              <Typography component="h1" className="agency-team__title">{strings.TITLE}</Typography>
              <Typography className="agency-team__subtitle">{strings.SUBTITLE}</Typography>
            </div>
            {canManage && (
              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                disabled={loading || !selectedAgencyId}
                onClick={openCreate}
              >
                {strings.ADD_MEMBER}
              </Button>
            )}
          </div>

          {loadError && <Alert severity="error">{strings.LOAD_ERROR}</Alert>}
          {networkError && <Alert severity="error">{strings.NETWORK_ERROR}</Alert>}
          {unauthorized && <Alert severity="warning">{strings.UNAUTHORIZED}</Alert>}

          {isAdmin && (
            <div className="agency-team__agency-picker">
              <TextField
                select
                fullWidth
                label={strings.SELECT_AGENCY}
                value={selectedAgencyId}
                onChange={(event) => setSelectedAgencyId(event.target.value)}
                disabled={loading}
              >
                {agencies.map((agency) => (
                  <MenuItem key={agency._id} value={agency._id}>
                    {agency.fullName}
                  </MenuItem>
                ))}
              </TextField>
            </div>
          )}

          <section className="agency-team__table" aria-label={strings.TITLE}>
            {loading ? (
              <div className="agency-team__empty"><CircularProgress size={36} /></div>
            ) : memberships.length === 0 ? (
              <div className="agency-team__empty"><Typography>{strings.EMPTY}</Typography></div>
            ) : (
              <>
              <div className="agency-team__table-head">
                <span>{strings.FULL_NAME}</span>
                <span>{strings.EMAIL}</span>
                <span>{strings.ROLE}</span>
                <span>{strings.STATUS}</span>
              </div>
              {memberships.map((membership) => {
                const member = typeof membership.user === 'string' ? undefined : membership.user
                const isOwner = membership.role === bookcarsTypes.AgencyRole.Owner
                return (
                  <div className="agency-team__row" key={membership._id}>
                    <span>{member?.fullName || '—'}</span>
                    <span>{member?.email || '—'}</span>
                    <span>
                      {isOwner ? strings.OWNER : (
                        <Select
                          displayEmpty
                          inputProps={{ 'aria-label': strings.ROLE }}
                          value={membership.role}
                          onChange={(event) => handleUpdate(membership, 'role', event.target.value)}
                          disabled={!canManage || isOwner || saving}
                        >
                          <MenuItem value="" disabled>
                            {strings.ROLE}
                          </MenuItem>
                          {[bookcarsTypes.AgencyRole.Manager, bookcarsTypes.AgencyRole.CounterAgent,
                            bookcarsTypes.AgencyRole.Accountant, bookcarsTypes.AgencyRole.Mechanic,
                            bookcarsTypes.AgencyRole.ReadOnly].map((role) => (
                            <MenuItem key={role} value={role}>{roleLabel(role)}</MenuItem>
                          ))}
                        </Select>
                      )}
                    </span>
                    <span>
                      <Select
                        displayEmpty
                        inputProps={{ 'aria-label': strings.STATUS }}
                        value={membership.status}
                        onChange={(event) => handleUpdate(membership, 'status', event.target.value)}
                        disabled={!canManage || isOwner || saving}
                        renderValue={(value) => statusLabel(value as bookcarsTypes.AgencyMembershipStatus)}
                      >
                        <MenuItem value={bookcarsTypes.AgencyMembershipStatus.Active}>{strings.ACTIVE}</MenuItem>
                        <MenuItem value={bookcarsTypes.AgencyMembershipStatus.Suspended}>{strings.SUSPENDED}</MenuItem>
                      </Select>
                    </span>
                  </div>
                )
              })}
              </>
            )}
          </section>

          <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
            <DialogTitle>{strings.CREATE}</DialogTitle>
            <DialogContent className="agency-team__form">
              {formError && <Alert severity="error">{strings.FORM_ERROR}</Alert>}
              <TextField
                autoFocus
                fullWidth
                required
                label={strings.FULL_NAME}
                value={form.fullName}
                onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              />
              <TextField
                fullWidth
                required
                type="email"
                label={strings.EMAIL}
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
              <TextField
                fullWidth
                required
                type="password"
                label={strings.PASSWORD}
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                inputProps={{ maxLength: 128 }}
              />
              <TextField
                select
                fullWidth
                required
                label={strings.ROLE}
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as bookcarsTypes.AgencyRole })}
              >
                {[bookcarsTypes.AgencyRole.Manager, bookcarsTypes.AgencyRole.CounterAgent,
                  bookcarsTypes.AgencyRole.Accountant, bookcarsTypes.AgencyRole.Mechanic,
                  bookcarsTypes.AgencyRole.ReadOnly].map((role) => (
                  <MenuItem key={role} value={role}>{roleLabel(role)}</MenuItem>
                ))}
              </TextField>
              <Typography variant="caption" color="text.secondary">
                {strings.PASSWORD_HINT}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialogOpen(false)} disabled={saving}>{strings.CANCEL}</Button>
              <Button variant="contained" onClick={handleCreate} disabled={saving || !selectedAgencyId}>
                {strings.SAVE}
              </Button>
            </DialogActions>
          </Dialog>
        </div>
      )}
    </Layout>
  )
}

export default Team
