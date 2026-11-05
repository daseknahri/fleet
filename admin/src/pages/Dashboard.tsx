import React, { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import DirectionsCarRoundedIcon from '@mui/icons-material/DirectionsCarRounded'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import KeyRoundedIcon from '@mui/icons-material/KeyRounded'
import { Booking, BookingStatus, Car, User } from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import Layout from '@/components/Layout'
import * as BookingService from '@/services/BookingService'
import * as CarService from '@/services/CarService'
import * as SupplierService from '@/services/SupplierService'
import * as UserService from '@/services/UserService'
import * as helper from '@/utils/helper'
import { strings } from '@/lang/dashboard'

import '@/assets/css/dashboard.css'

interface DashboardData {
  bookings: Booking[]
  cars: Car[]
}

const statuses = Object.values(BookingStatus)

const getBookingDate = (booking: Booking, field: 'from' | 'to') => new Date(booking[field]).getTime()

const getCarName = (booking: Booking) => {
  if (typeof booking.car === 'object' && booking.car) {
    return booking.car.name
  }
  return 'Véhicule'
}

const getCustomerName = (booking: Booking) => {
  if (typeof booking.driver === 'object' && booking.driver) {
    return booking.driver.fullName || booking.driver.email || 'Client'
  }
  return 'Client'
}

const formatDate = (value: Date) => new Intl.DateTimeFormat(
  UserService.getLanguage() === 'ar' ? 'ar-MA' : UserService.getLanguage() === 'fr' ? 'fr-MA' : UserService.getLanguage() === 'es' ? 'es-ES' : 'en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value))

const Dashboard = () => {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData>({ bookings: [], cars: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const onLoad = useCallback(async (user?: User) => {
    if (!user) {
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(false)

    try {
      const supplierIds = helper.admin(user)
        ? bookcarsHelper.flattenSuppliers(await SupplierService.getAllSuppliers())
        : [user._id || '']

      const [bookingResult, carResult] = await Promise.all([
        BookingService.getBookings({ suppliers: supplierIds, statuses }, 1, 1000),
        CarService.getCars('', {
          suppliers: supplierIds,
          includeAlreadyBookedCars: true,
          includeComingSoonCars: true,
        }, 1, 1000),
      ])

      setData({
        bookings: bookingResult?.[0]?.resultData || [],
        cars: carResult?.[0]?.resultData || [],
      })
    } catch (error) {
      setLoadError(true)
      helper.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  const now = Date.now()
  const activeBookings = useMemo(
    () => data.bookings.filter((booking) => (
      booking.status !== BookingStatus.Cancelled
      && booking.status !== BookingStatus.Void
      && getBookingDate(booking, 'from') <= now
      && getBookingDate(booking, 'to') >= now
    )),
    [data.bookings, now],
  )
  const upcomingBookings = useMemo(
    () => data.bookings.filter((booking) => (
      booking.status !== BookingStatus.Cancelled
      && booking.status !== BookingStatus.Void
      && getBookingDate(booking, 'from') > now
    )),
    [data.bookings, now],
  )
  const availableCars = data.cars.filter((car) => car.available).length
  const latestBookings = data.bookings
    .filter((booking) => (
      booking.status !== BookingStatus.Cancelled
      && booking.status !== BookingStatus.Void
      && getBookingDate(booking, 'to') >= now
    ))
    .sort((a, b) => getBookingDate(a, 'from') - getBookingDate(b, 'from'))
    .slice(0, 5)

  return (
    <Layout strict onLoad={onLoad}>
      <main className="agency-dashboard">
        <Box className="agency-dashboard__heading">
          <div>
            <Typography component="p" className="agency-dashboard__eyebrow">{strings.EYEBROW}</Typography>
            <Typography component="h1" className="agency-dashboard__title">{strings.TITLE}</Typography>
            <Typography className="agency-dashboard__subtitle">
              {strings.SUBTITLE}
            </Typography>
          </div>
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            onClick={() => navigate('/create-booking')}
            className="agency-dashboard__primary-action"
          >
            {strings.NEW_BOOKING}
          </Button>
        </Box>

        {loadError && (
          <Alert severity="error" className="agency-dashboard__alert">
            {strings.LOAD_ERROR}
          </Alert>
        )}

        <Box className="agency-dashboard__metrics">
          <MetricCard
            label={strings.AVAILABLE_CARS}
            value={loading ? '—' : `${availableCars} / ${data.cars.length}`}
            detail={strings.READY_TO_RENT}
            icon={<DirectionsCarRoundedIcon />}
            color="mint"
          />
          <MetricCard
            label={strings.ON_RENT}
            value={loading ? '—' : String(activeBookings.length)}
            detail={strings.ACTIVE_RESERVATIONS}
            icon={<KeyRoundedIcon />}
            color="blue"
          />
          <MetricCard
            label={strings.UPCOMING}
            value={loading ? '—' : String(upcomingBookings.length)}
            detail={strings.UPCOMING_RESERVATIONS}
            icon={<EventAvailableRoundedIcon />}
            color="amber"
          />
          <MetricCard
            label={strings.TOTAL_BOOKINGS}
            value={loading ? '—' : String(data.bookings.length)}
            detail={strings.BOOKING_HISTORY}
            icon={<CalendarMonthRoundedIcon />}
            color="violet"
          />
        </Box>

        <Box className="agency-dashboard__content">
          <Card className="agency-dashboard__panel agency-dashboard__activity">
            <CardContent>
              <div className="agency-dashboard__panel-heading">
                <div>
                  <Typography component="h2" className="agency-dashboard__panel-title">{strings.FOLLOW_UP}</Typography>
                  <Typography className="agency-dashboard__panel-copy">{strings.FOLLOW_UP_COPY}</Typography>
                </div>
                <Button endIcon={<ArrowForwardRoundedIcon />} onClick={() => navigate('/bookings')}>
                  {strings.VIEW_ALL}
                </Button>
              </div>

              {loading ? (
                <div className="agency-dashboard__loading"><CircularProgress size={24} /></div>
              ) : latestBookings.length === 0 ? (
                <div className="agency-dashboard__empty">
                  <EventAvailableRoundedIcon />
                  <Typography>{strings.EMPTY_BOOKINGS}</Typography>
                  <Button onClick={() => navigate('/create-booking')}>{strings.CREATE_BOOKING}</Button>
                </div>
              ) : (
                <div className="agency-dashboard__booking-list">
                  {latestBookings.map((booking) => (
                    <button
                      type="button"
                      className="agency-dashboard__booking-row"
                      key={booking._id}
                      onClick={() => navigate(`/update-booking?b=${booking._id}`)}
                    >
                      <span className="agency-dashboard__booking-car"><DirectionsCarRoundedIcon /></span>
                      <span className="agency-dashboard__booking-info">
                        <strong>{getCarName(booking)}</strong>
                        <span>{getCustomerName(booking)}</span>
                      </span>
                      <span className="agency-dashboard__booking-date">
                        <span>{strings.DEPARTURE}</span>
                        <strong>{formatDate(booking.from)}</strong>
                      </span>
                      <Chip
                        size="small"
                        label={booking.status === BookingStatus.Cancelled ? strings.CANCELLED : strings.BOOKING}
                        className={booking.status === BookingStatus.Cancelled ? 'agency-dashboard__status agency-dashboard__status--muted' : 'agency-dashboard__status'}
                      />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="agency-dashboard__panel agency-dashboard__shortcuts">
            <CardContent>
              <Typography component="h2" className="agency-dashboard__panel-title">{strings.QUICK_ACCESS}</Typography>
              <Typography className="agency-dashboard__panel-copy">{strings.DAILY_TOOLS}</Typography>
              <Stack spacing={1.25} className="agency-dashboard__shortcut-list">
                <Shortcut label={strings.PLANNING} detail={strings.CHECK_AVAILABILITY} onClick={() => navigate('/calendar')} />
                <Shortcut label={strings.FLEET} detail={strings.MANAGE_VEHICLES} onClick={() => navigate('/cars')} />
                <Shortcut label={strings.CLIENTS} detail={strings.MANAGE_CLIENTS} onClick={() => navigate('/clients')} />
                <Shortcut label={strings.MAINTENANCE} detail={strings.MANAGE_MAINTENANCE} onClick={() => navigate('/maintenance')} />
                <Shortcut label={strings.PAYMENTS} detail={strings.MANAGE_PAYMENTS} onClick={() => navigate('/payments')} />
                <Shortcut label={strings.CASH_JOURNAL} detail={strings.REVIEW_CASH} onClick={() => navigate('/caisse')} />
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </main>
    </Layout>
  )
}

interface MetricCardProps {
  label: string
  value: string
  detail: string
  icon: React.ReactNode
  color: string
}

const MetricCard = ({ label, value, detail, icon, color }: MetricCardProps) => (
  <Card className={`agency-dashboard__metric agency-dashboard__metric--${color}`}>
    <CardContent>
      <span className="agency-dashboard__metric-icon">{icon}</span>
      <Typography className="agency-dashboard__metric-label">{label}</Typography>
      <Typography component="p" className="agency-dashboard__metric-value">{value}</Typography>
      <Typography className="agency-dashboard__metric-detail">{detail}</Typography>
    </CardContent>
  </Card>
)

interface ShortcutProps {
  label: string
  detail: string
  onClick: () => void
}

const Shortcut = ({ label, detail, onClick }: ShortcutProps) => (
  <button type="button" className="agency-dashboard__shortcut" onClick={onClick}>
    <span><strong>{label}</strong><small>{detail}</small></span>
    <ArrowForwardRoundedIcon />
  </button>
)

export default Dashboard
