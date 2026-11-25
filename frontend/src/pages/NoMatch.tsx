import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@mui/material'
import { strings as commonStrings } from '@/lang/common'
import { strings } from '@/lang/no-match'
import Layout from '@/components/Layout'

interface NoMatchProps {
  hideHeader?: boolean
  // R2-A03 - 'lost-search': the search/checkout state did not survive
  // a refresh (no URL, no state, no storage). Explains instead of the
  // bare dead end, and offers a fresh search.
  variant?: 'default' | 'lost-search'
}

const NoMatch = ({ hideHeader, variant = 'default' }: NoMatchProps) => {
  const navigate = useNavigate()

  const noMatch = () => (
    <div className="msg">
      <h2>{variant === 'lost-search' ? strings.NO_MATCH_SEARCH : strings.NO_MATCH}</h2>
      <p>
        <Button variant="text" onClick={() => navigate('/')} className="btn-lnk">{commonStrings.GO_TO_HOME}</Button>
      </p>
      {variant === 'lost-search' && (
        <p>
          <Button variant="contained" onClick={() => navigate('/')} className="btn-margin-bottom">{strings.START_NEW_SEARCH}</Button>
        </p>
      )}
    </div>
  )

  return hideHeader ? noMatch() : <Layout strict={false}>{noMatch()}</Layout>
}

export default NoMatch
