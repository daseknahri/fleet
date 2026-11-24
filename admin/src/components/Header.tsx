import React, { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Badge,
  MenuItem,
  Menu,
  Button,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Collapse,
  TextField,
  InputAdornment,
} from '@mui/material'
import {
  Delete as TrashIcon,
  Menu as MenuIcon,
  Mail as MailIcon,
  Notifications as NotificationsIcon,
  More as MoreIcon,
  Language as LanguageIcon,
  Settings as SettingsIcon,
  Dashboard as DashboardIcon,
  CorporateFare as SuppliersIcon,
  LocationOn as LocationsIcon,
  DirectionsCar as CarsIcon,
  EventNote as BookingsIcon,
  Build as MaintenanceIcon,
  People as UsersIcon,
  Contacts as ClientsIcon,
  InfoTwoTone as AboutIcon,
  DescriptionTwoTone as TosIcon,
  ExitToApp as SignoutIcon,
  Flag as CountriesIcon,
  CalendarMonth as SchedulerIcon,
  AccountBalance as BankDetailsIcon,
  MonetizationOn as PricingIcon,
  Payments as PaymentsIcon,
  AccountBalanceWallet as CashJournalIcon,
  FactCheck as ApprovalsIcon,
  Receipt as InvoicesIcon,
  SupportAgent as AgentsIcon,
  NotificationsActive as RemindersIcon,
  UploadFile as ImportsIcon,
  History as AuditLogIcon,
  Groups as TeamIcon,
  Assessment as ReportsIcon,
  Close as CloseIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material'
import { useNavigate, useLocation } from 'react-router-dom'
import * as bookcarsTypes from ':bookcars-types'
import env from '@/config/env.config'
import { strings } from '@/lang/header'
import { strings as commonStrings } from '@/lang/common'
import { strings as globalSearchStrings } from '@/lang/global-search'
import * as UserService from '@/services/UserService'
import * as BankDetailsService from '@/services/BankDetailsService'
import Avatar from './Avatar'
import GlobalSearch from './GlobalSearch'
import QuickCreate from './QuickCreate'
import * as langHelper from '@/utils/langHelper'
import * as helper from '@/utils/helper'
import { useNotificationContext, NotificationContextType } from '@/context/NotificationContext'
import { useUserContext, UserContextType } from '@/context/UserContext'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'

import '@/assets/css/header.css'

interface HeaderProps {
  hidden?: boolean
}

// B-C1 (B-A-04): session key for the collapsed drawer sections.
const DRAWER_COLLAPSED_KEY = 'ga:drawer-collapsed'

// B-C1 (B-A-08): accent-insensitive match so typing "parametres" finds
// "Paramètres" (and Arabic / case variants match as-is).
const normalizeText = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

interface DrawerNavItem {
  path: string
  label: string
  icon: React.ReactNode
  visible: boolean
  badge?: number
}

interface DrawerNavSection {
  key: string
  label: string
  items: DrawerNavItem[]
}

const Header = ({
  hidden,
}: HeaderProps) => {
  const navigate = useNavigate()
  const location = useLocation()

  const { user } = useUserContext() as UserContextType
  const { notificationCount } = useNotificationContext() as NotificationContextType
  const agencyPermissions = useAgencyPermissions()
  // B-C1 (B-A-06): gated items render only once permissions are loaded.
  // The old `!loaded || can(...)` showed every gated item on first open
  // and then made it vanish once the permissions resolved (layout shift).
  // The permission model itself is unchanged.
  const showInvoices = !!agencyPermissions?.loaded && agencyPermissions.can(AgencyPermission.ReadInvoices)
  const showAgents = !!agencyPermissions?.loaded && agencyPermissions.can(AgencyPermission.ReadAgents)
  const showReminders = !!agencyPermissions?.loaded && agencyPermissions.can(AgencyPermission.ReadReminders)
  const showImports = !!agencyPermissions?.loaded && (agencyPermissions.can(AgencyPermission.ManageFleet) || agencyPermissions.can(AgencyPermission.ManageClients) || agencyPermissions.can(AgencyPermission.ManageBookings))
  // GA-PAR-22: the trash tab needs a Manage* capability (Read* alone
  // must not see deleted records' reasons/actors — §6).
  const showTrash = !!agencyPermissions?.loaded && (agencyPermissions.can(AgencyPermission.ManageFleet) || agencyPermissions.can(AgencyPermission.ManageClients) || agencyPermissions.can(AgencyPermission.ManageBookings))
  // GH-07 — the admin-access audit page is platform-admin only (its
  // endpoint is authAdmin-only); hidden for everyone else.
  const showAuditLog = helper.admin(user)

  const [currentUser, setCurrentUser] = useState<bookcarsTypes.User>()
  const [lang, setLang] = useState(helper.getLanguage(env.DEFAULT_LANGUAGE))
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [langAnchorEl, setLangAnchorEl] = useState<HTMLElement | null>(null)
  const [mobileMoreAnchorEl, setMobileMoreAnchorEl] = useState<HTMLElement | null>(null)
  const [sideAnchorEl, setSideAnchorEl] = useState<HTMLElement | null>(null)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [bankDetails, setBankDetails] = useState<bookcarsTypes.BankDetails | null>(null)
  // B-C1 (B-A-13): mobile search row toggle.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  // B-C1 (B-A-08): in-drawer filter over the nav items.
  const [drawerFilter, setDrawerFilter] = useState('')
  // B-C1 (B-A-04): collapsed sections, remembered for the session.
  const [collapsedSections, setCollapsedSections] = useState<string[]>(() => {
    try {
      const saved = window.sessionStorage.getItem(DRAWER_COLLAPSED_KEY)
      return saved ? (JSON.parse(saved) as string[]) : []
    } catch {
      // Session storage unavailable — all sections start expanded.
      return []
    }
  })

  const isMenuOpen = Boolean(anchorEl)
  const isMobileMenuOpen = Boolean(mobileMoreAnchorEl)
  const isLangMenuOpen = Boolean(langAnchorEl)
  const isSideMenuOpen = Boolean(sideAnchorEl)

  const classes = {
    list: {
      width: 250,
    },
    formControl: {
      margin: 1,
      minWidth: 120,
    },
    selectEmpty: {
      marginTop: 2,
    },
    grow: {
      flexGrow: 1,
    },
    menuButton: {
      // B-C1 (B-A-34): logical margin so the gap stays on the correct
      // side of the hamburger in RTL.
      marginInlineEnd: 2,
    },
  }

  const handleAccountMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleMobileMenuClose = () => {
    setMobileMoreAnchorEl(null)
  }

  const handleLangMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setLangAnchorEl(event.currentTarget)
  }

  const refreshPage = () => {
    // const params = new URLSearchParams(window.location.search)

    // if (params.has('l')) {
    //   params.delete('l')
    //   // window.location.href = window.location.href.split('?')[0] + ([...params].length > 0 ? `?${params}` : '')
    //   window.location.replace(window.location.href.split('?')[0] + ([...params].length > 0 ? `?${params}` : ''))
    // } else {
    //   // window.location.reload()
    //   window.location.replace(window.location.href)
    // }
    navigate(0)
  }

  const handleLangMenuClose = async (event: React.MouseEvent<HTMLElement>) => {
    setLangAnchorEl(null)

    const { code } = event.currentTarget.dataset
    if (code) {
      setLang(helper.getLanguage(code))
      const currentLang = UserService.getLanguage()
      if (isSignedIn && user) {
        // Update user language
        const data: bookcarsTypes.UpdateLanguagePayload = {
          id: user._id as string,
          language: code,
        }
        const status = await UserService.updateLanguage(data)
        if (status === 200) {
          UserService.setLanguage(code)
          if (code && code !== currentLang) {
            // Refresh page
            refreshPage()
          }
        } else {
          toast(commonStrings.CHANGE_LANGUAGE_ERROR, { type: 'error' })
        }
      } else {
        UserService.setLanguage(code)
        if (code && code !== currentLang) {
          // Refresh page
          refreshPage()
        }
      }
    }
  }

  const handleMenuClose = () => {
    setAnchorEl(null)
    handleMobileMenuClose()
  }

  const handleSettingsClick = () => {
    handleMenuClose()
    navigate('/settings')
  }

  const handleSignout = async () => {
    handleMenuClose()
    await UserService.signout()
  }

  const handleMobileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMobileMoreAnchorEl(event.currentTarget)
  }

  const handleSideMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setSideAnchorEl(event.currentTarget)
  }

  const handleSideMenuClose = () => {
    setSideAnchorEl(null)
    setDrawerFilter('')
  }

  const toggleSection = (key: string) => {
    const next = collapsedSections.includes(key)
      ? collapsedSections.filter((k) => k !== key)
      : [...collapsedSections, key]
    setCollapsedSections(next)
    try {
      window.sessionStorage.setItem(DRAWER_COLLAPSED_KEY, JSON.stringify(next))
    } catch {
      // Session storage unavailable — the collapse still applies for
      // this drawer opening.
    }
  }

  const handleNotificationsClick = () => {
    navigate('/notifications')
  }

  useEffect(() => {
    const language = langHelper.getLanguage()
    setLang(helper.getLanguage(language))
    langHelper.setLanguage(strings, language)
  }, [])

  useEffect(() => {
    if (user) {
      setCurrentUser(user)
      setIsSignedIn(true)
    } else {
      setCurrentUser(undefined)
      setIsSignedIn(false)
    }
  }, [user])

  useEffect(() => {
    const init = async () => {
      if (!hidden) {
        if (currentUser) {
          // H-022 (hardening Wave 4): the backend serves bank details to
          // admin and supplier accounts only (authSupplier). Staff sessions
          // must not fire this request - it returned a 403 console error on
          // every admin page. The menu entry stays hidden for them, exactly
          // as the endpoint's gate intends.
          if (currentUser.type === bookcarsTypes.UserType.Admin || currentUser.type === bookcarsTypes.UserType.Supplier) {
            const _bankDetails = await BankDetailsService.getBankDetails()
            setBankDetails(_bankDetails)
          }

          setIsSignedIn(true)
          setIsLoaded(true)
        }
      }
    }

    init()
  }, [hidden, currentUser])

  // B-C1 (B-A-13): navigating from a mobile search hit closes the
  // mobile search row again.
  useEffect(() => {
    setMobileSearchOpen(false)
  }, [location.pathname])

  // B-C1 (B-A-01/02/04/05/07/09): the drawer is now data-driven —
  // ListItemButton items (keyboard-operable, with a `selected` active
  // state), grouped into collapsible sections, with distinct icons for
  // Imports (B-A-03) and Clients (B-A-05) and a Notifications entry
  // (B-A-09). About / ToS / Contact live inside the System section
  // (B-A-07). No navigation logic changed: every item still navigates
  // and then closes the drawer.
  const navSections: DrawerNavSection[] = [
    {
      key: 'operations',
      label: strings.SECTION_OPERATIONS,
      items: [
        { path: '/', label: strings.DASHBOARD, icon: <DashboardIcon />, visible: true },
        { path: '/calendar', label: strings.SCHEDULER, icon: <SchedulerIcon />, visible: true },
        { path: '/bookings', label: strings.BOOKINGS, icon: <BookingsIcon />, visible: true },
        { path: '/approbations', label: strings.APPROVALS, icon: <ApprovalsIcon />, visible: true },
        { path: '/reports', label: strings.REPORTS, icon: <ReportsIcon />, visible: true },
      ],
    },
    {
      key: 'finance',
      label: strings.SECTION_FINANCE,
      items: [
        { path: '/payments', label: strings.PAYMENTS, icon: <PaymentsIcon />, visible: true },
        { path: '/invoices', label: strings.INVOICES, icon: <InvoicesIcon />, visible: showInvoices },
        { path: '/caisse', label: strings.CASH_JOURNAL, icon: <CashJournalIcon />, visible: true },
        { path: '/pricing', label: strings.PRICING, icon: <PricingIcon />, visible: true },
        { path: '/bank-details', label: strings.BANK_DETAILS, icon: <BankDetailsIcon />, visible: !!bankDetails?.showBankDetailsPage },
      ],
    },
    {
      key: 'fleet',
      label: strings.SECTION_FLEET,
      items: [
        { path: '/cars', label: strings.CARS, icon: <CarsIcon />, visible: true },
        { path: '/suppliers', label: strings.COMPANIES, icon: <SuppliersIcon />, visible: true },
        { path: '/countries', label: strings.COUNTRIES, icon: <CountriesIcon />, visible: true },
        { path: '/locations', label: strings.LOCATIONS, icon: <LocationsIcon />, visible: true },
        { path: '/maintenance', label: strings.MAINTENANCE, icon: <MaintenanceIcon />, visible: true },
        { path: '/imports', label: strings.IMPORTS, icon: <ImportsIcon />, visible: showImports },
      ],
    },
    {
      key: 'people',
      label: strings.SECTION_PEOPLE,
      items: [
        { path: '/users', label: strings.USERS, icon: <UsersIcon />, visible: true },
        { path: '/clients', label: strings.CLIENTS, icon: <ClientsIcon />, visible: true },
        { path: '/agents', label: strings.AGENTS, icon: <AgentsIcon />, visible: showAgents },
        { path: '/team', label: strings.TEAM, icon: <TeamIcon />, visible: true },
        { path: '/reminders', label: strings.REMINDERS, icon: <RemindersIcon />, visible: showReminders },
      ],
    },
    {
      key: 'system',
      label: strings.SECTION_SYSTEM,
      items: [
        { path: '/notifications', label: strings.NOTIFICATIONS, icon: <NotificationsIcon />, visible: true, badge: notificationCount > 0 ? notificationCount : undefined },
        { path: '/trash', label: strings.TRASH, icon: <TrashIcon />, visible: showTrash },
        { path: '/admin-access-log', label: strings.ADMIN_ACCESS_LOG, icon: <AuditLogIcon />, visible: showAuditLog },
        { path: '/settings', label: strings.SETTINGS, icon: <SettingsIcon />, visible: true },
        { path: '/about', label: strings.ABOUT, icon: <AboutIcon />, visible: true },
        { path: '/tos', label: strings.TOS, icon: <TosIcon />, visible: true },
        { path: '/contact', label: strings.CONTACT, icon: <MailIcon />, visible: true },
      ],
    },
  ]

  const normalizedFilter = normalizeText(drawerFilter.trim())
  const isFiltering = normalizedFilter.length > 0
  const navItemMatches = (label: string) => !isFiltering || normalizeText(label).includes(normalizedFilter)

  const menuId = 'primary-account-menu'
  const renderMenu = (
    <Menu
      anchorEl={anchorEl}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      id={menuId}
      keepMounted
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      open={isMenuOpen}
      onClose={handleMenuClose}
      className="menu"
    >
      <MenuItem onClick={handleSettingsClick}>
        <SettingsIcon className="header-action" />
        <Typography>{strings.SETTINGS}</Typography>
      </MenuItem>
      <MenuItem onClick={handleSignout}>
        <SignoutIcon className="header-action" />
        <Typography>{strings.SIGN_OUT}</Typography>
      </MenuItem>
    </Menu>
  )

  const mobileMenuId = 'mobile-menu'
  const renderMobileMenu = (
    <Menu
      anchorEl={mobileMoreAnchorEl}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      id={mobileMenuId}
      keepMounted
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      open={isMobileMenuOpen}
      onClose={handleMobileMenuClose}
      className="menu"
    >
      <MenuItem onClick={handleSettingsClick}>
        <SettingsIcon className="header-action" />
        <p>{strings.SETTINGS}</p>
      </MenuItem>
      <MenuItem onClick={handleLangMenuOpen}>
        <LanguageIcon className="header-action" />
        <p>{strings.LANGUAGE}</p>
      </MenuItem>
      <MenuItem onClick={handleSignout}>
        <SignoutIcon className="header-action" />
        <p>{strings.SIGN_OUT}</p>
      </MenuItem>
    </Menu>
  )

  const languageMenuId = 'language-menu'
  const renderLanguageMenu = (
    <Menu
      anchorEl={langAnchorEl}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      id={languageMenuId}
      keepMounted
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      open={isLangMenuOpen}
      onClose={handleLangMenuClose}
      className="menu"
    >
      {
        env._LANGUAGES.map((language) => (
          <MenuItem onClick={handleLangMenuClose} data-code={language.code} key={language.code}>
            {language.label}
          </MenuItem>
        ))
      }
    </Menu>
  )

  return !hidden && (
    <div style={classes.grow} className="header">
      <AppBar position="fixed" sx={{ bgcolor: '#121212' }}>
        <Toolbar className="toolbar">
          {isLoaded && isSignedIn && (
            <IconButton edge="start" sx={classes.menuButton} color="inherit" aria-label={strings.OPEN_MENU} onClick={handleSideMenuOpen}>
              <MenuIcon />
            </IconButton>
          )}
          <>
            <Drawer open={isSideMenuOpen} onClose={handleSideMenuClose} className="menu  side-menu">
              <div className="drawer-panel" style={classes.list}>
                <div className="drawer-header">
                  <span className="drawer-brand">{env.WEBSITE_NAME}</span>
                  <IconButton aria-label={commonStrings.CLOSE} onClick={handleSideMenuClose} size="small" color="inherit">
                    <CloseIcon />
                  </IconButton>
                </div>
                {currentUser && (
                  <div className="drawer-identity">
                    <Avatar record={currentUser} type={currentUser.type} size="small" readonly />
                    <div className="drawer-identity-text">
                      <span className="drawer-identity-name">{currentUser.fullName}</span>
                      <span className="drawer-identity-email">{currentUser.email}</span>
                    </div>
                  </div>
                )}
                <div className="drawer-filter">
                  <TextField
                    size="small"
                    fullWidth
                    value={drawerFilter}
                    onChange={(event) => setDrawerFilter(event.target.value)}
                    placeholder={strings.FILTER_NAV}
                    aria-label={strings.FILTER_NAV}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon fontSize="small" />
                          </InputAdornment>
                        ),
                        endAdornment: drawerFilter ? (
                          <InputAdornment position="end">
                            <IconButton size="small" aria-label={commonStrings.CLEAR} onClick={() => setDrawerFilter('')}>
                              <ClearIcon fontSize="small" />
                            </IconButton>
                          </InputAdornment>
                        ) : undefined,
                      },
                    }}
                  />
                </div>
                <Divider />
                <List disablePadding>
                  {navSections.map((section) => {
                    const visibleItems = section.items.filter((item) => item.visible && navItemMatches(item.label))
                    if (visibleItems.length === 0) {
                      return null
                    }
                    // While filtering, every section with a match stays
                    // expanded so the match is visible.
                    const expanded = isFiltering || !collapsedSections.includes(section.key)
                    return (
                      <React.Fragment key={section.key}>
                        <ListItem disablePadding>
                          <ListItemButton onClick={() => toggleSection(section.key)} aria-expanded={expanded} className="drawer-section-header">
                            <ListItemText primary={section.label} />
                            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                          </ListItemButton>
                        </ListItem>
                        <Collapse in={expanded} timeout="auto" unmountOnExit>
                          <List disablePadding>
                            {visibleItems.map((item) => (
                              <ListItem disablePadding key={item.path}>
                                <ListItemButton
                                  selected={location.pathname === item.path}
                                  onClick={() => {
                                    navigate(item.path)
                                    handleSideMenuClose()
                                  }}
                                >
                                  <ListItemIcon>
                                    {item.badge ? (
                                      <Badge badgeContent={item.badge} color="error">
                                        {item.icon}
                                      </Badge>
                                    ) : item.icon}
                                  </ListItemIcon>
                                  <ListItemText primary={item.label} />
                                </ListItemButton>
                              </ListItem>
                            ))}
                          </List>
                        </Collapse>
                        <Divider />
                      </React.Fragment>
                    )
                  })}
                </List>
              </div>
            </Drawer>
          </>
          <div style={classes.grow} />
          <div className="header-desktop">
            {isSignedIn && (
              <GlobalSearch />
            )}
            {isSignedIn && (
              <QuickCreate />
            )}
            {isSignedIn && (
              <IconButton aria-label={notificationCount > 0 ? `${strings.NOTIFICATIONS} ${notificationCount}` : strings.NOTIFICATIONS} color="inherit" onClick={handleNotificationsClick}>
                <Badge badgeContent={notificationCount > 0 ? notificationCount : null} color="error">
                  <NotificationsIcon />
                </Badge>
              </IconButton>
            )}
            {isLoaded && (
              <Button variant="contained" startIcon={<LanguageIcon />} onClick={handleLangMenuOpen} disableElevation className="btn-primary">
                {lang?.label}
              </Button>
            )}
            {isSignedIn && user && (
              <IconButton edge="end" aria-label={strings.ACCOUNT} aria-controls={menuId} aria-haspopup="true" onClick={handleAccountMenuOpen} color="inherit">
                <Avatar record={user} type={user.type} size="small" readonly />
              </IconButton>
            )}
          </div>
          <div className="header-mobile">
            {!isSignedIn && (
              <Button variant="contained" startIcon={<LanguageIcon />} onClick={handleLangMenuOpen} disableElevation className="btn-primary">
                {lang?.label}
              </Button>
            )}
            {isSignedIn && (
              <IconButton aria-label={globalSearchStrings.SEARCH_LABEL} aria-expanded={mobileSearchOpen} aria-controls="header-mobile-search" color="inherit" onClick={() => setMobileSearchOpen((prev) => !prev)}>
                <SearchIcon />
              </IconButton>
            )}
            {isSignedIn && (
              <QuickCreate />
            )}
            {isSignedIn && (
              <IconButton aria-label={notificationCount > 0 ? `${strings.NOTIFICATIONS} ${notificationCount}` : strings.NOTIFICATIONS} color="inherit" onClick={handleNotificationsClick}>
                <Badge badgeContent={notificationCount > 0 ? notificationCount : null} color="error">
                  <NotificationsIcon />
                </Badge>
              </IconButton>
            )}
            {isSignedIn && (
              <IconButton aria-label={strings.SHOW_MORE} aria-controls={mobileMenuId} aria-haspopup="true" onClick={handleMobileMenuOpen} color="inherit">
                <MoreIcon />
              </IconButton>
            )}
          </div>
        </Toolbar>
        {isSignedIn && mobileSearchOpen && (
          <div className="header-mobile-search" id="header-mobile-search">
            <GlobalSearch />
          </div>
        )}
      </AppBar>

      {renderMobileMenu}
      {renderMenu}
      {renderLanguageMenu}
    </div>
  )
}

export default Header
