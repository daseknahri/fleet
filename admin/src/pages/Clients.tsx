import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import * as bookcarsTypes from ':bookcars-types'
import Layout from '@/components/Layout'
import env from '@/config/env.config'
import { strings } from '@/lang/clients'
import Search from '@/components/Search'
import UserList from '@/components/UserList'

import '@/assets/css/clients.css'

const Clients = () => {
  const navigate = useNavigate()
  const [user, setUser] = useState<bookcarsTypes.User>()
  const [keyword, setKeyword] = useState('')

  return (
    <Layout strict onLoad={setUser}>
      {user && (
        <main className="agency-clients">
          <div className="agency-clients__heading">
            <div>
              <Typography component="p" className="agency-clients__eyebrow">{strings.EYEBROW}</Typography>
              <Typography component="h1" className="agency-clients__title">{strings.TITLE}</Typography>
              <Typography className="agency-clients__subtitle">{strings.SUBTITLE}</Typography>
            </div>
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              className="agency-clients__action"
              onClick={() => navigate('/create-user?type=user&from=clients')}
            >
              {strings.ADD_CLIENT}
            </Button>
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
            />
          </section>
        </main>
      )}
    </Layout>
  )
}

export default Clients
