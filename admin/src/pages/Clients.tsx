import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import * as bookcarsTypes from ':bookcars-types'
import Layout from '@/components/Layout'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import AccessDenied from '@/components/AccessDenied'
import env from '@/config/env.config'
import { strings } from '@/lang/clients'
import { strings as commonStrings } from '@/lang/common'
import { strings as trashStrings } from '@/lang/trash'
import Search from '@/components/Search'
import UserList from '@/components/UserList'

import '@/assets/css/clients.css'

const Clients = () => {
  const navigate = useNavigate()
  const agencyPermissions = useAgencyPermissions()
  const clientsDenied = !!agencyPermissions?.loaded && !agencyPermissions.can(AgencyPermission.ReadClients)
  const canManageClients = !agencyPermissions || !agencyPermissions.loaded || agencyPermissions.can(AgencyPermission.ManageClients)
  const [user, setUser] = useState<bookcarsTypes.User>()
  const [keyword, setKeyword] = useState('')
  // F5b (W2-04): client-list filters, passed down to UserList (which
  // sends them as GetUsersBody.filters). Held in state so the object
  // identity only changes on user action.
  const [filters, setFilters] = useState<bookcarsTypes.ClientListFilters>({})
  const hasActiveFilters = !!(filters.clientStatus || filters.clientType || filters.missingDocs || filters.hasContracts)

  return (
    <Layout strict onLoad={setUser}>
      {user && clientsDenied && <AccessDenied />}
      {user && !clientsDenied && (
        <div className="agency-clients">
          <div className="agency-clients__heading">
            <div>
              <Typography component="p" className="agency-clients__eyebrow">{strings.EYEBROW}</Typography>
              <Typography component="h1" className="agency-clients__title">{strings.TITLE}</Typography>
              <Typography className="agency-clients__subtitle">{strings.SUBTITLE}</Typography>
            </div>
            {canManageClients && (
              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                className="agency-clients__action"
                onClick={() => navigate('/create-user?type=user&from=clients')}
              >
                {strings.ADD_CLIENT}
              </Button>
            )}
            {canManageClients && (
              <Button variant="text" size="small" onClick={() => navigate('/trash')}>
                {trashStrings.VIEW_TRASH}
              </Button>
            )}
          </div>

          <div className="agency-clients__toolbar">
            <Search onSubmit={setKeyword} className="agency-clients__search" />
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
              <FormControl variant="standard" style={{ minWidth: 160 }}>
                <InputLabel>{strings.FILTER_STATUS}</InputLabel>
                <Select
                  label={strings.FILTER_STATUS}
                  value={filters.clientStatus || ''}
                  onChange={(e) => setFilters({ ...filters, clientStatus: e.target.value || undefined })}
                >
                  <MenuItem value="">{strings.FILTER_ALL}</MenuItem>
                  <MenuItem value={bookcarsTypes.ClientStatus.Active}>{commonStrings.CLIENT_STATUS_ACTIVE}</MenuItem>
                  <MenuItem value={bookcarsTypes.ClientStatus.UnderReview}>{commonStrings.CLIENT_STATUS_UNDER_REVIEW}</MenuItem>
                  <MenuItem value={bookcarsTypes.ClientStatus.Blocked}>{commonStrings.CLIENT_STATUS_BLOCKED}</MenuItem>
                </Select>
              </FormControl>
              <FormControl variant="standard" style={{ minWidth: 160 }}>
                <InputLabel>{strings.FILTER_TYPE}</InputLabel>
                <Select
                  label={strings.FILTER_TYPE}
                  value={filters.clientType || ''}
                  onChange={(e) => setFilters({ ...filters, clientType: e.target.value || undefined })}
                >
                  <MenuItem value="">{strings.FILTER_ALL}</MenuItem>
                  <MenuItem value={bookcarsTypes.ClientType.Individual}>{commonStrings.CLIENT_TYPE_INDIVIDUAL}</MenuItem>
                  <MenuItem value={bookcarsTypes.ClientType.Company}>{commonStrings.CLIENT_TYPE_COMPANY}</MenuItem>
                </Select>
              </FormControl>
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={!!filters.missingDocs}
                    onChange={(e) => setFilters({ ...filters, missingDocs: e.target.checked || undefined })}
                    color="primary"
                  />
                )}
                label={strings.FILTER_MISSING_DOCS}
              />
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={!!filters.hasContracts}
                    onChange={(e) => setFilters({ ...filters, hasContracts: e.target.checked || undefined })}
                    color="primary"
                  />
                )}
                label={strings.FILTER_HAS_CONTRACTS}
              />
              {hasActiveFilters && (
                <Button variant="text" size="small" onClick={() => setFilters({})}>
                  {strings.FILTER_CLEAR}
                </Button>
              )}
            </div>
          </div>

          <section className="agency-clients__table" aria-label={strings.TITLE}>
            <UserList
              user={user}
              types={[bookcarsTypes.UserType.User]}
              keyword={keyword}
              filters={filters}
              checkboxSelection={!env.isMobile}
              hideDesktopColumns={env.isMobile}
              clientMode
            />
          </section>
        </div>
      )}
    </Layout>
  )
}

export default Clients
