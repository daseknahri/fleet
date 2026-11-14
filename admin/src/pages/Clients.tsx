import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import * as bookcarsTypes from ':bookcars-types'
import Layout from '@/components/Layout'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import AccessDenied from '@/components/AccessDenied'
import env from '@/config/env.config'
import { strings } from '@/lang/clients'
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
          </div>

          <section className="agency-clients__table" aria-label={strings.TITLE}>
            <UserList
              user={user}
              types={[bookcarsTypes.UserType.User]}
              keyword={keyword}
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
