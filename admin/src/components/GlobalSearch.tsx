import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TextField,
  InputAdornment,
  IconButton,
  Paper,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  ClickAwayListener,
} from '@mui/material'
import { Search as SearchIcon, Clear as ClearIcon } from '@mui/icons-material'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import { strings } from '@/lang/global-search'
import { strings as headerStrings } from '@/lang/header'
import { strings as commonStrings } from '@/lang/common'
import * as helper from '@/utils/helper'
import * as langHelper from '@/utils/langHelper'
import * as GlobalSearchService from '@/services/GlobalSearchService'
import * as SupplierService from '@/services/SupplierService'
import { useUserContext, UserContextType } from '@/context/UserContext'

import '@/assets/css/header.css'

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 300

interface FlatHit {
  group: 'bookings' | 'cars' | 'clients'
  hit: bookcarsTypes.GlobalSearchHit
}

const emptyResult: bookcarsTypes.GlobalSearchResult = { bookings: [], cars: [], clients: [] }

/**
 * GA-Q4-2 (#52) — global search in the admin top bar.
 *
 * One keyword across bookings (reference / client name), cars (name /
 * license plate) and clients (name / email / CIN), grouped in a
 * dropdown. Agency scope is enforced server-side; the client only
 * passes the agency selector a platform admin needs (exactly like the
 * list pages): admins send every agency, agency owners send their own
 * id, staff send nothing and the server resolves their membership.
 *
 * Keyboard: ArrowDown / ArrowUp move through the hits, Enter opens the
 * active hit (or the first one), Escape closes the dropdown.
 */
const GlobalSearch = () => {
  const navigate = useNavigate()
  const { user } = useUserContext() as UserContextType

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<bookcarsTypes.GlobalSearchResult>(emptyResult)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [suppliers, setSuppliers] = useState<string[] | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const language = langHelper.getLanguage()
    langHelper.setLanguage(strings, language)
  }, [])

  useEffect(() => {
    if (!user) {
      return
    }
    const loadSuppliers = async () => {
      try {
        if (helper.admin(user)) {
          const allSuppliers = await SupplierService.getAllSuppliers()
          setSuppliers(bookcarsHelper.flattenSuppliers(allSuppliers))
        } else if (user.type === bookcarsTypes.UserType.Supplier) {
          setSuppliers([user._id ?? ''])
        } else {
          // Staff: the server resolves the agency from the membership.
          setSuppliers(undefined)
        }
      } catch (err) {
        helper.error(err)
        setSuppliers(helper.admin(user) ? [] : undefined)
      }
    }

    loadSuppliers()
  }, [user])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults(emptyResult)
      setOpen(false)
      setActiveIndex(-1)
      return undefined
    }

    const handle = setTimeout(async () => {
      try {
        const data: bookcarsTypes.GlobalSearchPayload = { keyword: trimmed }
        // Admins without a loaded agency list cannot search yet; agency
        // owners and staff always have their scope resolved server-side.
        if (user && helper.admin(user) && !suppliers) {
          return
        }
        if (suppliers) {
          data.suppliers = suppliers
        }
        const res = await GlobalSearchService.search(data)
        setResults(res)
        setOpen(true)
        setActiveIndex(-1)
      } catch (err) {
        helper.error(err)
        setResults(emptyResult)
        setOpen(false)
        setActiveIndex(-1)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(handle)
  }, [query, suppliers, user])

  const flatHits: FlatHit[] = [
    ...results.bookings.map((hit) => ({ group: 'bookings' as const, hit })),
    ...results.cars.map((hit) => ({ group: 'cars' as const, hit })),
    ...results.clients.map((hit) => ({ group: 'clients' as const, hit })),
  ]
  const hasResults = flatHits.length > 0
  const showEmpty = open && query.trim().length >= MIN_QUERY_LENGTH && !hasResults

  const openHit = (hit: bookcarsTypes.GlobalSearchHit) => {
    setOpen(false)
    setQuery('')
    setResults(emptyResult)
    setActiveIndex(-1)
    navigate(hit.link)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open && !hasResults) {
        return
      }
      event.preventDefault()
      setOpen(true)
      if (flatHits.length === 0) {
        return
      }
      setActiveIndex((prev) => {
        if (event.key === 'ArrowDown') {
          return prev < flatHits.length - 1 ? prev + 1 : 0
        }
        return prev > 0 ? prev - 1 : flatHits.length - 1
      })
    } else if (event.key === 'Enter') {
      if (flatHits.length === 0) {
        return
      }
      event.preventDefault()
      openHit(flatHits[activeIndex >= 0 ? activeIndex : 0].hit)
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  // Group titles reuse the header strings (one label per area, no
  // duplicate keys): the search groups are the same areas as the nav.
  const groupTitle = (group: FlatHit['group']) => (
    group === 'bookings' ? headerStrings.BOOKINGS : group === 'cars' ? headerStrings.CARS : headerStrings.CLIENTS
  )

  let lastGroup: FlatHit['group'] | '' = ''

  return (
    <ClickAwayListener onClickAway={() => { setOpen(false); setActiveIndex(-1) }}>
      <div className="global-search">
        <TextField
          inputRef={inputRef}
          size="small"
          variant="outlined"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (hasResults) { setOpen(true) } }}
          placeholder={strings.SEARCH_PLACEHOLDER}
          aria-label={strings.SEARCH_LABEL}
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-results"
          autoComplete="off"
          className="global-search-input"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon className="global-search-icon" />
                </InputAdornment>
              ),
              endAdornment: query ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    aria-label={commonStrings.CLEAR}
                    onClick={() => {
                      setQuery('')
                      setResults(emptyResult)
                      setOpen(false)
                      setActiveIndex(-1)
                      inputRef.current?.focus()
                    }}
                  >
                    <ClearIcon className="global-search-icon" style={{ width: 20, height: 20 }} />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
        {(open && hasResults) && (
          <Paper className="global-search-dropdown" id="global-search-results" role="listbox">
            <List dense disablePadding>
              {flatHits.map((item, index) => {
                const header = item.group !== lastGroup
                lastGroup = item.group
                return (
                  <React.Fragment key={`${item.group}-${item.hit.id}`}>
                    {header && (
                      <ListSubheader className="global-search-group" disableSticky>{groupTitle(item.group)}</ListSubheader>
                    )}
                    <ListItemButton
                      selected={index === activeIndex}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => openHit(item.hit)}
                      role="option"
                      aria-selected={index === activeIndex}
                    >
                      <ListItemText primary={item.hit.label} secondary={item.hit.subtitle} />
                    </ListItemButton>
                  </React.Fragment>
                )
              })}
            </List>
          </Paper>
        )}
        {showEmpty && (
          <Paper className="global-search-dropdown">
            <List dense disablePadding>
              <ListSubheader className="global-search-group" disableSticky>{strings.NO_RESULTS}</ListSubheader>
            </List>
          </Paper>
        )}
      </div>
    </ClickAwayListener>
  )
}

export default GlobalSearch
