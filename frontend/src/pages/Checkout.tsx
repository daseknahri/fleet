import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  OutlinedInput,
  InputLabel,
  FormControl,
  FormHelperText,
  Button,
  Paper,
  Checkbox,
  Link,
  FormControlLabel,
  RadioGroup,
  Radio,
  CircularProgress,
} from '@mui/material'
import {
  DirectionsCar as CarIcon,
  Person as DriverIcon,
  Settings as PaymentOptionsIcon,
  Payment as LicenseIcon,
  AssignmentTurnedIn as ChecklistIcon,
} from '@mui/icons-material'
import { formatDateTimeCasablanca } from '@/utils/dateHelper'
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { PayPalButtons } from '@paypal/react-paypal-js'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import isEmail from 'validator/es/lib/isEmail'
import isMobilePhone from 'validator/es/lib/isMobilePhone'
import { createSchema, FormFields } from '@/models/CheckoutForm'
import CarList from '@/components/CarList'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import SafeImage from '@/components/SafeImage'
import env from '@/config/env.config'
import * as BookingService from '@/services/BookingService'
import { strings as commonStrings } from '@/lang/common'
import { strings as csStrings } from '@/lang/cars'
import { strings } from '@/lang/checkout'
import * as helper from '@/utils/helper'
import * as UserService from '@/services/UserService'
import * as CarService from '@/services/CarService'
import * as LocationService from '@/services/LocationService'
import * as PaymentService from '@/services/PaymentService'
import * as PayPalService from '@/services/PayPalService'
import { useRecaptchaContext, RecaptchaContextType } from '@/context/RecaptchaContext'
import Layout from '@/components/Layout'
import Error from '@/components/Error'
import DatePicker from '@/components/DatePicker'
import SocialLogin from '@/components/SocialLogin'
import Map from '@/components/Map'
import DriverLicense from '@/components/DriverLicense'
import Progress from '@/components/Progress'
import CheckoutStatus from '@/components/CheckoutStatus'
import NoMatch from './NoMatch'
import CheckoutOptions from '@/components/CheckoutOptions'
import Footer from '@/components/Footer'
import ViewOnMapButton from '@/components/ViewOnMapButton'
import MapDialog from '@/components/MapDialog'
import Backdrop from '@/components/SimpleBackdrop'
import Unauthorized from '@/components/Unauthorized'

import '@/assets/css/checkout.css'

//
// Make sure to call `loadStripe` outside of a component’s render to avoid
// recreating the `Stripe` object on every render.
//
const stripePromise = env.PAYMENT_GATEWAY === bookcarsTypes.PaymentGateway.Stripe ? loadStripe(env.STRIPE_PUBLISHABLE_KEY) : null

const Checkout = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { reCaptchaLoaded, generateReCaptchaToken } = useRecaptchaContext() as RecaptchaContextType

  const [user, setUser] = useState<bookcarsTypes.User>()
  const [car, setCar] = useState<bookcarsTypes.Car>()
  const [pickupLocation, setPickupLocation] = useState<bookcarsTypes.Location>()
  const [dropOffLocation, setDropOffLocation] = useState<bookcarsTypes.Location>()
  const [from, setFrom] = useState<Date>()
  const [to, setTo] = useState<Date>()
  const [visible, setVisible] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [language, setLanguage] = useState(env.DEFAULT_LANGUAGE)
  const [noMatch, setNoMatch] = useState(false)
  const [emailInfo, setEmailInfo] = useState(true)
  const [phoneInfo, setPhoneInfo] = useState(true)
  const [price, setPrice] = useState(0)
  const [depositPrice, setDepositPrice] = useState(0)
  const [amountDueNow, setAmountDueNow] = useState<number>()
  const [success, setSuccess] = useState(false)
  const [loadingPage, setLoadingPage] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [recaptchaError, setRecaptchaError] = useState(false)
  const adRequired = true
  const [adManuallyChecked, setAdManuallyChecked] = useState(false)
  const [paymentFailed, setPaymentFailed] = useState(false)
  // R2-A05 - what the PayPal failure means for the customer's money:
  // 'not-charged' / 'cancelled' / 'error' / 'order-failed' = nothing
  // was kept (safe to retry); 'refunded' = taken then returned (safe
  // to retry); 'support-review' = money state needs a human (no retry).
  const [payPalFailure, setPayPalFailure] = useState<{ kind: 'not-charged' | 'refunded' | 'support-review' | 'cancelled' | 'error' | 'order-failed', backendMessage?: string } | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [bookingId, setBookingId] = useState<string>()
  const [sessionId, setSessionId] = useState<string>()
  // const [distance, setDistance] = useState('')
  const [licenseRequired, setLicenseRequired] = useState(false)
  const [license, setLicense] = useState<string | null>(null)
  const [openMapDialog, setOpenMapDialog] = useState(false)
  const [payPalLoaded, setPayPalLoaded] = useState(false)
  const [payPalInit, setPayPalInit] = useState(false)
  const [payPalProcessing, setPayPalProcessing] = useState(false)

  const birthDateRef = useRef<HTMLInputElement | null>(null)
  const additionalDriverBirthDateRef = useRef<HTMLInputElement | null>(null)
  const additionalDriverEmailRef = useRef<HTMLInputElement | null>(null)
  const additionalDriverPhoneRef = useRef<HTMLInputElement | null>(null)
  const lastPayloadRef = useRef<bookcarsTypes.CheckoutPayload | null>(null)

  const bookingDetailHeight = env.SUPPLIER_IMAGE_HEIGHT + 10
  const days = bookcarsHelper.days(from, to)
  const daysLabel = from && to && `${helper.getDaysShort(days)} (${formatDateTimeCasablanca(from)} (${commonStrings.TIMEZONE_MOROCCO}) - ${formatDateTimeCasablanca(to)} (${commonStrings.TIMEZONE_MOROCCO}))`

  const schema = createSchema(car, !authenticated)

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
    clearErrors,
    setFocus,
    trigger,
    reset,
  } = useForm<FormFields>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    shouldUnregister: false,
    defaultValues: {
      additionalDriverEmail: '',
      additionalDriverPhone: '',
    }
  })

  const additionalDriverEmail = useWatch({ control, name: 'additionalDriverEmail' })
  const additionalDriverPhone = useWatch({ control, name: 'additionalDriverPhone' })

  const additionalDriver = useWatch({ control, name: 'additionalDriver' })

  const formValues = useWatch({ control })

  // R2-A03 - keep a tab-scoped draft of the filled form so a refresh
  // restores it. Driver PII (email/phone/birthDate) lives in
  // sessionStorage only, never the URL or localStorage. Written
  // debounced while the form is visible; the licence file is separate
  // state and is never stored.
  useEffect(() => {
    if (!visible) {
      return undefined
    }
    const timer = setTimeout(() => {
      try {
        const draft = {
          ...formValues,
          birthDate: formValues.birthDate ? new Date(formValues.birthDate).toISOString() : undefined,
          additionalDriverBirthDate: formValues.additionalDriverBirthDate ? new Date(formValues.additionalDriverBirthDate).toISOString() : undefined,
        }
        sessionStorage.setItem('bc-checkout-form', JSON.stringify(draft))
      } catch {
        // Storage unavailable - the draft is best-effort.
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [formValues, visible])

  // R2-A03 - the checkout backup (params + form draft) is single-use:
  // a finished or cancelled checkout must not restore into the next one.
  const clearCheckoutStorage = () => {
    sessionStorage.removeItem('bc-checkout-state')
    sessionStorage.removeItem('bc-checkout-form')
  }

  const payLater = useWatch({ control, name: 'payLater' })
  const payDeposit = useWatch({ control, name: 'payDeposit' })
  const payInFull = useWatch({ control, name: 'payInFull' })

  const validatePhone = (phone: string) => {
    return isMobilePhone(phone)
  }

  // R2-A04 - the checkout success branch, shared by the first submit
  // and the retry path: a fresh temp booking + fresh clientSecret; the
  // previous unpaid Void booking is left to the TTL sweeper (the same as
  // cancelling and starting over today, minus the form loss).
  const handleCheckoutResult = (result: Awaited<ReturnType<typeof BookingService.checkout>>, opts: { payLater?: boolean, payDeposit?: boolean, payInFull?: boolean }) => {
    if (result.status === 200) {
      if (result.financialSnapshot) {
        setAmountDueNow(result.financialSnapshot.amountDueNowInPaymentCurrency)
      }
      if (opts.payLater) {
        clearCheckoutStorage()
        setVisible(false)
        setSuccess(true)
      }
      setBookingId(result.bookingId)
      setSessionId(result.sessionId)
      if (!opts.payLater && env.PAYMENT_GATEWAY === bookcarsTypes.PaymentGateway.Stripe) {
        setClientSecret(result.clientSecret || null)
      } else if (!opts.payLater) {
        setPayPalLoaded(true)
      }
    } else {
      helper.error()
    }
  }

  // R2-A04 - in-place retry after a payment failure: re-run the same
  // checkout call with the saved payload and the same success branch.
  // Resetting clientSecret re-enables the radios/switches and brings
  // back the BOOK button. Only rendered when paymentFailed is true,
  // i.e. no money was taken - never offered after a success.
  const retryPayment = async () => {
    if (!lastPayloadRef.current) {
      return
    }
    setPaymentFailed(false)
    setClientSecret(null)
    setPayPalLoaded(false)
    try {
      const result = await BookingService.checkout(lastPayloadRef.current)
      handleCheckoutResult(result, { payLater, payDeposit, payInFull })
    } catch (err) {
      const status = (err as { status?: number, response?: { status?: number, data?: unknown } })?.status
        ?? (err as { response?: { status?: number } })?.response?.status
      const body = (err as { response?: { data?: unknown } })?.response?.data
      const message = typeof body === 'string' ? body : ''
      // R2-A09 - the backend's plain-string body names the problem; map it.
      // Never claim "email already registered" unless the body says so (it
      // never does on this funnel - the guest branch reuses an existing user).
      if (status === 503 && /currency conversion/i.test(message)) {
        helper.error(err, strings.CHECKOUT_CURRENCY_UNAVAILABLE)
      } else if (status === 400) {
        if (/already registered/i.test(message)) helper.error(err, strings.INVALID_REQUEST)
        else if (/invalid driver information/i.test(message)) helper.error(err, strings.CHECKOUT_INVALID_DRIVER)
        else if (/minimum age/i.test(message)) helper.error(err, strings.CHECKOUT_MINIMUM_AGE)
        else if (/deposit payment is not available/i.test(message)) helper.error(err, strings.CHECKOUT_DEPOSIT_UNAVAILABLE)
        else if (/greater than zero/i.test(message)) helper.error(err, strings.CHECKOUT_AMOUNT_INVALID)
        else if (/invalid rental dates/i.test(message)) helper.error(err, strings.CHECKOUT_INVALID_DATES)
        else if (/pick-up and drop-off locations/i.test(message)) helper.error(err, strings.CHECKOUT_LOCATIONS_INVALID)
        else helper.error(err, strings.CHECKOUT_VALIDATION_ERROR)
      } else {
        helper.error(err)
      }
    }
  }

  const onSubmit = async (data: FormFields) => {
    setPayPalFailure(null)
    try {
      if (!car || !pickupLocation || !dropOffLocation || !from || !to) {
        helper.error()
        return
      }

      let recaptchaToken = ''
      if (reCaptchaLoaded) {
        recaptchaToken = await generateReCaptchaToken()
        if (!(await helper.verifyReCaptcha(recaptchaToken))) {
          recaptchaToken = ''
        }
      }

      if (env.RECAPTCHA_ENABLED && !recaptchaToken) {
        setRecaptchaError(true)
        return
      }

      if (car.supplier.licenseRequired && !license) {
        setLicenseRequired(true)
        return
      }

      setPaymentFailed(false)

      let driver: bookcarsTypes.User | undefined
      let _additionalDriver: bookcarsTypes.AdditionalDriver | undefined

      if (!authenticated) {
        driver = {
          email: data.email,
          phone: data.phone,
          fullName: data.fullName!,
          birthDate: data.birthDate,
          language: UserService.getLanguage(),
          license: license || undefined,
        }
      }

      const booking: bookcarsTypes.Booking = {
        supplier: car.supplier._id as string,
        car: car._id,
        driver: authenticated ? user?._id : undefined,
        pickupLocation: pickupLocation._id,
        dropOffLocation: dropOffLocation._id,
        from,
        to,
        status: bookcarsTypes.BookingStatus.Pending,
        cancellation: data.cancellation,
        amendments: data.amendments,
        theftProtection: data.theftProtection,
        collisionDamageWaiver: data.collisionDamageWaiver,
        fullInsurance: data.fullInsurance,
        additionalDriver,
        price: 0,
      }

      if (adRequired && additionalDriver && data.additionalDriverBirthDate) {
        _additionalDriver = {
          fullName: data.additionalDriverFullName!,
          email: data.additionalDriverEmail!,
          phone: data.additionalDriverPhone!,
          birthDate: data.additionalDriverBirthDate,
        }
      }

      const paymentMode = payLater ? bookcarsTypes.CheckoutPaymentMode.PayLater
        : payDeposit ? bookcarsTypes.CheckoutPaymentMode.Deposit
          : payInFull ? bookcarsTypes.CheckoutPaymentMode.Full
            : bookcarsTypes.CheckoutPaymentMode.Rental
      const payload: bookcarsTypes.CheckoutPayload = {
        driver,
        booking,
        additionalDriver: _additionalDriver,
        paymentMode,
        currency: PaymentService.getCurrency(),
        paymentGateway: env.PAYMENT_GATEWAY,
      }

      lastPayloadRef.current = payload
      const result = await BookingService.checkout(payload)
      handleCheckoutResult(result, { payLater, payDeposit, payInFull })
    } catch (err) {
      const status = (err as { status?: number, response?: { status?: number, data?: unknown } })?.status
        ?? (err as { response?: { status?: number } })?.response?.status
      const body = (err as { response?: { data?: unknown } })?.response?.data
      const message = typeof body === 'string' ? body : ''
      // R2-A09 - the backend's plain-string body names the problem; map it.
      // Never claim "email already registered" unless the body says so (it
      // never does on this funnel - the guest branch reuses an existing user).
      if (status === 503 && /currency conversion/i.test(message)) {
        helper.error(err, strings.CHECKOUT_CURRENCY_UNAVAILABLE)
      } else if (status === 400) {
        if (/already registered/i.test(message)) helper.error(err, strings.INVALID_REQUEST)
        else if (/invalid driver information/i.test(message)) helper.error(err, strings.CHECKOUT_INVALID_DRIVER)
        else if (/minimum age/i.test(message)) helper.error(err, strings.CHECKOUT_MINIMUM_AGE)
        else if (/deposit payment is not available/i.test(message)) helper.error(err, strings.CHECKOUT_DEPOSIT_UNAVAILABLE)
        else if (/greater than zero/i.test(message)) helper.error(err, strings.CHECKOUT_AMOUNT_INVALID)
        else if (/invalid rental dates/i.test(message)) helper.error(err, strings.CHECKOUT_INVALID_DATES)
        else if (/pick-up and drop-off locations/i.test(message)) helper.error(err, strings.CHECKOUT_LOCATIONS_INVALID)
        else helper.error(err, strings.CHECKOUT_VALIDATION_ERROR)
      } else {
        helper.error(err)
      }
    }
  }

  const onError = () => {
    const firstErrorField = Object.keys(errors)[0] as keyof FormFields
    if (firstErrorField) {
      if (firstErrorField === 'birthDate' && birthDateRef.current) {
        birthDateRef.current.focus()
      }
      if (firstErrorField === 'additionalDriverBirthDate' && additionalDriverBirthDateRef.current) {
        additionalDriverBirthDateRef.current.focus()
      } else if (firstErrorField === 'additionalDriverEmail' && additionalDriverEmailRef.current) {
        additionalDriverEmailRef.current.focus()
      } else if (firstErrorField === 'additionalDriverPhone' && additionalDriverPhoneRef.current) {
        additionalDriverPhoneRef.current.focus()
      } else {
        setFocus(firstErrorField)
      }
    }
  }

  const onLoad = async (_user?: bookcarsTypes.User) => {
    setUser(_user)
    setAuthenticated(_user !== undefined)
    setLanguage(UserService.getLanguage())

    // R2-A03 - resolve the checkout inputs: router state first, then
    // the sessionStorage backup written by Car.tsx (refresh-proof).
    const resolved = (() => {
      const { state } = location
      if (state?.carId && state?.pickupLocationId && state?.dropOffLocationId && state?.from && state?.to) {
        return {
          carId: state.carId,
          pickupLocationId: state.pickupLocationId,
          dropOffLocationId: state.dropOffLocationId,
          from: state.from instanceof Date ? state.from : new Date(state.from),
          to: state.to instanceof Date ? state.to : new Date(state.to),
        }
      }
      try {
        const stored = sessionStorage.getItem('bc-checkout-state')
        if (stored) {
          const parsed = JSON.parse(stored)
          if (parsed?.carId && parsed?.pickupLocationId && parsed?.dropOffLocationId && parsed?.from && parsed?.to) {
            const from = new Date(parsed.from)
            const to = new Date(parsed.to)
            if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
              return { carId: parsed.carId, pickupLocationId: parsed.pickupLocationId, dropOffLocationId: parsed.dropOffLocationId, from, to }
            }
          }
        }
      } catch {
        // Corrupted storage counts as missing - the NoMatch branch below.
      }
      return null
    })()
    if (!resolved) {
      setNoMatch(true)
      return
    }

    const { carId, pickupLocationId, dropOffLocationId, from: _from, to: _to } = resolved

    let _car
    let _pickupLocation
    let _dropOffLocation

    try {
      _car = await CarService.getCar(carId)
      if (!_car) {
        setNoMatch(true)
        return
      }

      _pickupLocation = await LocationService.getLocation(pickupLocationId)

      if (!_pickupLocation) {
        setNoMatch(true)
        return
      }

      // if (_pickupLocation.latitude && _pickupLocation.longitude) {
      //   const l = await helper.getLocation()
      //   if (l) {
      //     const d = bookcarsHelper.distance(_pickupLocation.latitude, _pickupLocation.longitude, l[0], l[1], 'K')
      //     setDistance(bookcarsHelper.formatDistance(d, UserService.getLanguage()))
      //   }
      // }

      if (dropOffLocationId !== pickupLocationId) {
        _dropOffLocation = await LocationService.getLocation(dropOffLocationId)
      } else {
        _dropOffLocation = _pickupLocation
      }

      if (!_dropOffLocation) {
        setNoMatch(true)
        return
      }

      const priceChangeRate = _car.supplier.priceChangeRate || 0
      const _price = await PaymentService.convertPrice(bookcarsHelper.calculateTotalPrice(_car, _from, _to, priceChangeRate))
      let _depositPrice = _car.deposit > 0 ? await PaymentService.convertPrice(_car.deposit) : 0
      _depositPrice += _depositPrice * (priceChangeRate / 100)

      const included = (val: number) => val === 0

      setCar(_car)
      setPrice(_price)
      setDepositPrice(_depositPrice)
      setPickupLocation(_pickupLocation)
      setDropOffLocation(_dropOffLocation)
      setFrom(_from)
      setTo(_to)
      setValue('cancellation', included(_car.cancellation))
      setValue('amendments', included(_car.amendments))
      setValue('theftProtection', included(_car.theftProtection))
      setValue('collisionDamageWaiver', included(_car.collisionDamageWaiver))
      setValue('fullInsurance', included(_car.fullInsurance))
      setLicense(_user?.license || null)
      // R2-A03 - restore the saved form draft, but only when it belongs
      // to this same car: a draft from an earlier booking must not leak
      // its option choices into a different car's form.
      try {
        const storedState = sessionStorage.getItem('bc-checkout-state')
        const draftRaw = sessionStorage.getItem('bc-checkout-form')
        if (storedState && draftRaw && JSON.parse(storedState).carId === carId) {
          const draft = JSON.parse(draftRaw)
          reset({
            ...draft,
            birthDate: draft.birthDate ? new Date(draft.birthDate) : undefined,
            additionalDriverBirthDate: draft.additionalDriverBirthDate ? new Date(draft.additionalDriverBirthDate) : undefined,
          })
        }
      } catch {
        // Corrupted storage counts as no draft.
      }
      setVisible(true)
    } catch (err) {
      helper.error(err)
      setLoadingPage(false)
      setLoadError(true)
    }
  }

  return (
    <>
      <Layout onLoad={onLoad} strict={false}>
        {!user?.blacklisted && visible && car && from && to && pickupLocation && dropOffLocation && (
          <>
            <div className="checkout">
              <Paper className="checkout-form" elevation={10}>
                <h1 className="checkout-form-title">{strings.BOOKING_HEADING}</h1>
                <form onSubmit={handleSubmit(onSubmit, onError)} noValidate>
                  <div>
                    {(
                      (pickupLocation.latitude && pickupLocation.longitude)
                      || (pickupLocation.parkingSpots && pickupLocation.parkingSpots.length > 0)
                    ) && (
                        <Map
                          position={[pickupLocation.latitude || Number(pickupLocation.parkingSpots![0].latitude), pickupLocation.longitude || Number(pickupLocation.parkingSpots![0].longitude)]}
                          initialZoom={10}
                          parkingSpots={pickupLocation.parkingSpots}
                          locations={[pickupLocation]}
                          className="map"
                        >
                          <ViewOnMapButton onClick={() => setOpenMapDialog(true)} />
                        </Map>
                      )}

                    <CarList
                      cars={[car]}
                      // pickupLocationName={pickupLocation.name}
                      // distance={distance}
                      hidePrice
                      sizeAuto
                      onLoad={() => setLoadingPage(false)}
                      hideSupplier={env.HIDE_SUPPLIERS}
                    />

                    <CheckoutOptions
                      car={car}
                      from={from}
                      to={to}
                      language={language}
                      clientSecret={clientSecret}
                      payPalLoaded={payPalLoaded}
                      onPriceChange={(value) => setPrice(value)}
                      onAdManuallyCheckedChange={(value) => setAdManuallyChecked(value)}
                      onCancellationChange={(value) => setValue('cancellation', value)}
                      onAmendmentsChange={(value) => setValue('amendments', value)}
                      onTheftProtectionChange={(value) => setValue('theftProtection', value)}
                      onCollisionDamageWaiverChange={(value) => setValue('collisionDamageWaiver', value)}
                      onFullInsuranceChange={(value) => setValue('fullInsurance', value)}
                      onAdditionalDriverChange={(value) => setValue('additionalDriver', value)}
                    />

                    <div className="checkout-details-container">
                      <div className="checkout-info">
                        <CarIcon />
                        <span>{strings.BOOKING_DETAILS}</span>
                      </div>
                      <div className="checkout-details">
                        <div className="checkout-detail" style={{ height: bookingDetailHeight }}>
                          <span className="checkout-detail-title">{strings.DAYS}</span>
                          <div className="checkout-detail-value">
                            {daysLabel}
                          </div>
                        </div>
                        <div className="checkout-detail" style={{ height: bookingDetailHeight }}>
                          <span className="checkout-detail-title">{commonStrings.PICK_UP_LOCATION}</span>
                          <div className="checkout-detail-value">{pickupLocation.name}</div>
                        </div>
                        <div className="checkout-detail" style={{ height: bookingDetailHeight }}>
                          <span className="checkout-detail-title">{commonStrings.DROP_OFF_LOCATION}</span>
                          <div className="checkout-detail-value">{dropOffLocation.name}</div>
                        </div>
                        <div className="checkout-detail" style={{ height: bookingDetailHeight }}>
                          <span className="checkout-detail-title">{strings.CAR}</span>
                          <div className="checkout-detail-value">{`${car.name} (${bookcarsHelper.formatPrice(price / days, commonStrings.CURRENCY, language)}${commonStrings.DAILY})`}</div>
                        </div>
                        {!env.HIDE_SUPPLIERS && (
                          <div className="checkout-detail" style={{ height: bookingDetailHeight }}>
                            <span className="checkout-detail-title">{commonStrings.SUPPLIER}</span>
                            <div className="checkout-detail-value">
                              <div className="car-supplier">
                                <SafeImage src={bookcarsHelper.joinURL(env.CDN_USERS, car.supplier.avatar)} alt={car.supplier.fullName} style={{ height: env.SUPPLIER_IMAGE_HEIGHT }} />
                                <span className="car-supplier-name">{car.supplier.fullName}</span>
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="checkout-detail" style={{ height: bookingDetailHeight }}>
                          <span className="checkout-detail-title">{strings.COST}</span>
                          <div className="checkout-detail-value booking-price">{bookcarsHelper.formatPrice(price, commonStrings.CURRENCY, language)}</div>
                        </div>
                      </div>
                    </div>

                    {!authenticated && (
                      <div className="driver-details">
                        <div className="checkout-info">
                          <DriverIcon />
                          <span>{strings.DRIVER_DETAILS}</span>
                        </div>
                        <div className="driver-details-form">
                          <FormControl fullWidth margin="dense">
                            <InputLabel className="required" htmlFor="checkout-fullName">{commonStrings.FULL_NAME}</InputLabel>
                            <OutlinedInput id="checkout-fullName"
                              {...register('fullName')}
                              type="text"
                              label={commonStrings.FULL_NAME}
                              required
                              error={!!errors.fullName}
                              autoComplete="name"
                            />
                          </FormControl>
                          <FormControl fullWidth margin="dense">
                            <InputLabel className="required" htmlFor="checkout-email">{commonStrings.EMAIL}</InputLabel>
                            <OutlinedInput id="checkout-email"
                              // {...register('email')}
                              type="email"
                              label={commonStrings.EMAIL}
                              error={!!errors.email}
                              required
                              autoComplete="email"
                              onChange={(e) => {
                                if (errors.email) {
                                  clearErrors('email')
                                }
                                setEmailInfo(false)
                                setValue('email', e.target.value)
                              }}
                              onBlur={(e) => {
                                trigger('email')
                                setEmailInfo(isEmail(e.target.value))
                              }}
                            />
                            <FormHelperText error={!!errors.email}>
                              {(errors.email && errors.email.message) || ''}
                              {(emailInfo && !errors.email && strings.EMAIL_INFO) || ''}
                            </FormHelperText>
                          </FormControl>
                          <FormControl fullWidth margin="dense">
                            <InputLabel className="required" htmlFor="checkout-phone">{commonStrings.PHONE}</InputLabel>
                            <OutlinedInput id="checkout-phone"
                              // {...register('phone')}
                              type="tel"
                              label={commonStrings.PHONE}
                              error={!!errors.phone}
                              required
                              autoComplete="tel"
                              onChange={(e) => {
                                if (errors.phone) {
                                  clearErrors('phone')
                                }
                                setPhoneInfo(false)
                                setValue('phone', e.target.value)
                              }}
                              onBlur={(e) => {
                                trigger('phone')
                                setPhoneInfo(validatePhone(e.target.value))
                              }}
                            />
                            <FormHelperText error={!!errors.phone}>
                              {(errors.phone && errors.phone.message) || ''}
                              {(phoneInfo && strings.PHONE_INFO) || ''}
                            </FormHelperText>
                          </FormControl>
                          <FormControl fullWidth margin="dense">
                            <DatePicker
                              {...register('birthDate')}
                              ref={birthDateRef}
                              label={commonStrings.BIRTH_DATE}
                              variant="outlined"
                              required
                              onChange={(_birthDate) => {
                                if (errors.birthDate) {
                                  clearErrors('birthDate')
                                }
                                if (_birthDate) {
                                  setValue('birthDate', _birthDate, { shouldValidate: true })
                                } else {
                                  setValue('birthDate', undefined, { shouldValidate: true })
                                }
                              }}
                              language={language}
                            />
                            <FormHelperText error={!!errors.birthDate}>
                              {(errors.birthDate && errors.birthDate.message) || ''}
                            </FormHelperText>
                          </FormControl>

                          <div className="checkout-tos">
                            <FormControlLabel
                              control={(
                                <Checkbox
                                  {...register('tos')}
                                  onChange={(e) => {
                                    if (e.target.checked && errors.tos) {
                                      clearErrors('tos')
                                    }
                                  }}
                                  color="primary"
                                  inputProps={{ 'aria-label': commonStrings.TOS }}
                                />
                              )}
                              label={(
                                <Link href="/tos" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                                  {commonStrings.TOS}
                                </Link>
                              )}
                            />
                            <FormHelperText error={!!errors.tos}>{errors.tos?.message || ''}</FormHelperText>
                          </div>

                          <SocialLogin reloadPage />
                        </div>
                      </div>
                    )}

                    {car.supplier.licenseRequired && (
                      <div className="driver-details">
                        <div className="checkout-info">
                          <LicenseIcon />
                          <span>{commonStrings.DRIVER_LICENSE}</span>
                        </div>
                        <div className="driver-details-form">
                          <DriverLicense
                            user={user}
                            variant="outlined"
                            onUpload={(filename) => {
                              if (filename) {
                                setLicenseRequired(false)
                              } else {
                                setLicenseRequired(true)
                              }
                              setLicense(filename)
                            }}
                            onDelete={() => {
                              setLicenseRequired(false)
                              setLicense(null)
                            }}
                            hideDelete={!!clientSecret || payPalLoaded}
                          />
                        </div>
                      </div>
                    )}

                    {(adManuallyChecked && additionalDriver) && (
                      <div className="driver-details">
                        <div className="checkout-info">
                          <DriverIcon />
                          <span>{csStrings.ADDITIONAL_DRIVER}</span>
                        </div>
                        <div className="driver-details-form">
                          <FormControl fullWidth margin="dense">
                            <InputLabel className="required" htmlFor="checkout-additionalDriverFullName">{commonStrings.FULL_NAME}</InputLabel>
                            <OutlinedInput id="checkout-additionalDriverFullName"
                              {...register('additionalDriverFullName')}
                              type="text"
                              label={commonStrings.FULL_NAME}
                              required={adRequired}
                              autoComplete="name"
                            />
                          </FormControl>
                          <FormControl fullWidth margin="dense">
                            <InputLabel className="required" htmlFor="checkout-additionalDriverEmail">{commonStrings.EMAIL}</InputLabel>
                            <OutlinedInput id="checkout-additionalDriverEmail"
                              // {...register('additionalDriverEmail')}
                              inputRef={additionalDriverEmailRef}
                              value={additionalDriverEmail}
                              type="email"
                              label={commonStrings.EMAIL}
                              error={!!errors.additionalDriverEmail}
                              required={adRequired}
                              autoComplete="email"
                              onChange={(e) => {
                                if (errors.additionalDriverEmail) {
                                  clearErrors('additionalDriverEmail')
                                }
                                setValue('additionalDriverEmail', e.target.value)
                              }}
                              onBlur={() => {
                                trigger('additionalDriverEmail')
                              }}
                            />
                            <FormHelperText error={!!errors.additionalDriverEmail}>
                              {(errors.additionalDriverEmail && errors.additionalDriverEmail.message) || ''}
                            </FormHelperText>
                          </FormControl>
                          <FormControl fullWidth margin="dense">
                            <InputLabel className="required" htmlFor="checkout-additionalDriverPhone">{commonStrings.PHONE}</InputLabel>
                            <OutlinedInput id="checkout-additionalDriverPhone"
                              // {...register('additionalDriverPhone')}
                              inputRef={additionalDriverPhoneRef}
                              value={additionalDriverPhone}
                              type="tel"
                              label={commonStrings.PHONE}
                              error={!!errors.additionalDriverPhone}
                              required={adRequired}
                              autoComplete="tel"
                              onChange={(e) => {
                                if (errors.additionalDriverPhone) {
                                  clearErrors('additionalDriverPhone')
                                }
                                setValue('additionalDriverPhone', e.target.value)
                              }}
                              onBlur={() => {
                                trigger('additionalDriverPhone')
                              }}
                            />
                            <FormHelperText error={!!errors.additionalDriverPhone}>
                              {(errors.additionalDriverPhone && errors.additionalDriverPhone.message) || ''}
                            </FormHelperText>
                          </FormControl>
                          <FormControl fullWidth margin="dense">
                            <DatePicker
                              {...register('additionalDriverBirthDate')}
                              ref={additionalDriverBirthDateRef}
                              label={commonStrings.BIRTH_DATE}
                              variant="outlined"
                              required={adRequired}
                              onChange={(_birthDate) => {
                                if (_birthDate) {
                                  setValue('additionalDriverBirthDate', _birthDate, { shouldValidate: true })
                                } else {
                                  setValue('additionalDriverBirthDate', undefined, { shouldValidate: true })
                                }
                              }}
                              language={language}
                            />
                            <FormHelperText error={!!errors.additionalDriverBirthDate}>
                              {(errors.additionalDriverBirthDate && errors.additionalDriverBirthDate.message) || ''}
                            </FormHelperText>
                          </FormControl>
                        </div>
                      </div>
                    )}

                    {/* Payment options */}

                    <div className="payment-options-container">
                      <div className="checkout-info">
                        <PaymentOptionsIcon />
                        <span>{strings.PAYMENT_OPTIONS}</span>
                      </div>
                      <div className="payment-options">
                        <FormControl>
                          <RadioGroup
                            defaultValue={depositPrice > 0 ? 'payOnline' : 'payInFull'}
                            onChange={(e) => {
                              setValue('payLater', e.target.value === 'payLater')
                              setValue('payDeposit', e.target.value === 'payDeposit')
                              setValue('payInFull', e.target.value === 'payInFull')
                            }}
                          >
                            {car.supplier.payLater && (
                              <FormControlLabel
                                value="payLater"
                                control={<Radio />}
                                disabled={!!clientSecret || payPalLoaded}
                                className={clientSecret || payPalLoaded ? 'payment-radio-disabled' : ''}
                                label={(
                                  <span className="payment-button">
                                    <span>{strings.PAY_LATER}</span>
                                    <span className="payment-info">{strings.PAY_LATER_INFO}</span>
                                  </span>
                                )}
                              />
                            )}
                            {
                              car.deposit > 0 && (
                                <FormControlLabel
                                  value="payDeposit"
                                  control={<Radio />}
                                  disabled={!!clientSecret || payPalLoaded}
                                  className={clientSecret || payPalLoaded ? 'payment-radio-disabled' : ''}
                                  label={(
                                    <span className="payment-button">
                                      <span>{strings.PAY_DEPOSIT}</span>
                                      <span className="payment-info">{strings.PAY_DEPOSIT_INFO}</span>
                                    </span>
                                  )}
                                />
                              )
                            }
                            {
                              depositPrice > 0 && (
                                <FormControlLabel
                                  value="payOnline"
                                  control={<Radio />}
                                  disabled={!!clientSecret || payPalLoaded}
                                  className={clientSecret || payPalLoaded ? 'payment-radio-disabled' : ''}
                                  label={(
                                    <span className="payment-button">
                                      <span>{strings.PAY_ONLINE}</span>
                                      <span className="payment-info">{strings.PAY_ONLINE_INFO}</span>
                                      {depositPrice > 0 && (
                                        <span className="payment-info">{strings.PAY_ONLINE_DEPOSIT_DUE.replace('{amount}', bookcarsHelper.formatPrice(depositPrice, commonStrings.CURRENCY, language))}</span>
                                      )}
                                    </span>
                                  )}
                                />
                              )
                            }
                            <FormControlLabel
                              value="payInFull"
                              control={<Radio />}
                              disabled={!!clientSecret || payPalLoaded}
                              className={clientSecret || payPalLoaded ? 'payment-radio-disabled' : ''}
                              label={(
                                <span className="payment-button">
                                  <span>{strings.PAY_IN_FULL}</span>
                                  <span className="payment-info">{strings.PAY_IN_FULL_INFO}</span>
                                </span>
                              )}
                            />
                          </RadioGroup>
                        </FormControl>
                      </div>
                    </div>

                    {/* Checkout checklist */}

                    <div className="checkout-details-container">
                      <div className="checkout-info">
                        <ChecklistIcon />
                        <span>{strings.PICK_UP_CHECKLIST_TITLE}</span>
                      </div>
                      <div className="checkout-details">
                        <div className="checkout-detail" style={{ height: bookingDetailHeight }}>
                          <span className="checkout-detail-title">{strings.PICK_UP_CHECKLIST_ARRIVE_ON_TIME_TITLE}</span>
                          <div className="checkout-detail-value checklist-content">
                            {strings.PICK_UP_CHECKLIST_ARRIVE_ON_TIME_CONTENT}
                          </div>
                        </div>
                        <div className="checkout-detail" style={{ height: bookingDetailHeight }}>
                          <span className="checkout-detail-title">{strings.PICK_UP_CHECKLIST_DOCUMENTS_TITLE}</span>
                          <div className="checkout-detail-value checklist-content">
                            {strings.PICK_UP_CHECKLIST_DOCUMENTS_CONTENT}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Total price */}

                    <div className="payment-info">
                      <div className="payment-info-title">
                        {
                          payDeposit ? strings.DEPOSIT : `${strings.PRICE_FOR} ${days} ${days > 1 ? strings.DAYS : strings.DAY}`
                        }
                      </div>
                      <div className="payment-info-price">
                        {
                          bookcarsHelper.formatPrice(
                            payLater ? price : amountDueNow ?? (
                              payDeposit ? depositPrice : payInFull ? price + depositPrice : price
                            ),
                            commonStrings.CURRENCY,
                            language,
                          )
                        }
                    {depositPrice > 0 && !payDeposit && !payInFull && (
                      <div className="payment-info">
                        <div className="payment-info-title">{strings.DEPOSIT_DUE_AT_PICKUP}</div>
                        <div className="payment-info-price">
                          {bookcarsHelper.formatPrice(depositPrice, commonStrings.CURRENCY, language)}
                        </div>
                      </div>
                    )}

                      </div>
                    </div>

                    {(!car.supplier.payLater || !payLater) && (
                      env.PAYMENT_GATEWAY === bookcarsTypes.PaymentGateway.Stripe
                        ? (
                          clientSecret && (
                            <div className="payment-options-container">
                              <EmbeddedCheckoutProvider
                                stripe={stripePromise}
                                options={{ clientSecret }}
                              >
                                <EmbeddedCheckout />
                              </EmbeddedCheckoutProvider>
                            </div>
                          )
                        )
                        : payPalLoaded ? (
                          <div className="payment-options-container">
                            <PayPalButtons
                              createOrder={async () => {
                                try {
                                  if (!bookingId) {
                                    console.error('Missing bookingId before PayPal order creation')
                                    return ''
                                  }
                                  const name = bookcarsHelper.truncateString(car.name, PayPalService.ORDER_NAME_MAX_LENGTH)
                                  const _description = `${car.name} - ${daysLabel} - ${pickupLocation._id === dropOffLocation._id ? pickupLocation.name : `${pickupLocation.name} - ${dropOffLocation.name}`}`
                                  const description = bookcarsHelper.truncateString(_description, PayPalService.ORDER_DESCRIPTION_MAX_LENGTH)
                                  const orderId = await PayPalService.createOrder(bookingId!, name, description)
                                  return orderId || ''
                                } catch (err) {
                                  setPaymentFailed(true)
                                  setPayPalFailure({ kind: 'order-failed' })
                                  helper.error(err)
                                  return ''
                                }
                              }}
                              onApprove={async (data, actions) => {
                                try {
                                  setPayPalProcessing(true)
                                  await actions.order?.capture()
                                  const { orderID } = data
                                  const { status } = await PayPalService.checkOrder(bookingId!, orderID)
                                  if (status === 200) {
                                    clearCheckoutStorage()
                                    setVisible(false)
                                    setSuccess(true)
                                  } else {
                                    setPaymentFailed(true)
                                    setPayPalFailure({ kind: 'not-charged' }) // non-200 via checkOrder resolve is unreachable in practice (axios rejects); kept for safety
                                  }
                                } catch (err) {
                                  const status = (err as any)?.response?.status as number | undefined
                                  const message = (err as any)?.response?.data as string | undefined
                                  setPaymentFailed(true)
                                  // 204 / 400 -> nothing was kept by the backend (no capture, or the
                                  // capture was refunded before answering): safe to retry (item 5).
                                  // 409 with 'was refunded' -> money taken then returned: retry allowed.
                                  // 409 'no verified capture' / 500 / 503 -> money state needs a human:
                                  // no in-place retry, show the support-review message.
                                  if (status === 204 || status === 400) setPayPalFailure({ kind: 'not-charged' })
                                  else if (status === 409 && /was refunded/i.test(message || '')) setPayPalFailure({ kind: 'refunded' })
                                  else setPayPalFailure({ kind: 'support-review', backendMessage: message })
                                  helper.error(err) // keep the existing toast; the inline message below carries the meaning
                                } finally {
                                  setPayPalProcessing(false)
                                }
                              }}
                              onInit={() => {
                                setPayPalInit(true)
                              }}
                              onCancel={() => {
                                setPayPalProcessing(false)
                                setPaymentFailed(true)
                                setPayPalFailure({ kind: 'cancelled' })
                              }}
                              onError={() => {
                                setPayPalProcessing(false)
                                setPaymentFailed(true)
                                setPayPalFailure({ kind: 'error' })
                              }}
                            />
                          </div>
                        ) : null
                    )}
                    <div className="checkout-buttons">
                      {(
                        (env.PAYMENT_GATEWAY === bookcarsTypes.PaymentGateway.Stripe && !clientSecret)
                        || (env.PAYMENT_GATEWAY === bookcarsTypes.PaymentGateway.PayPal && !payPalInit)
                        || payLater) && (
                          <Button
                            type="submit"
                            variant="contained"
                            className="btn-checkout btn-margin-bottom"
                            disabled={isSubmitting || (payPalLoaded && !payPalInit)}
                          >
                            {
                              (isSubmitting || (payPalLoaded && !payPalInit))
                                ? <CircularProgress color="inherit" size={24} />
                                : strings.BOOK
                            }
                          </Button>
                        )}
                      <Button
                        variant="outlined"
                        color="primary"
                        className="btn-cancel btn-margin-bottom"
                        onClick={async () => {
                          try {
                            if (bookingId && sessionId) {
                              //
                              // Delete temporary booking on cancel.
                              // Otherwise, temporary bookings are
                              // automatically deleted through a TTL index.
                              //
                              await BookingService.deleteTempBooking(bookingId, sessionId)
                            }
                            if (!authenticated && license) {
                              await UserService.deleteTempLicense(license)
                            }
                          } catch (err) {
                            helper.error(err)
                          } finally {
                            clearCheckoutStorage()
                            navigate('/')
                          }
                        }}
                      >
                        {commonStrings.CANCEL}
                      </Button>
                    </div>
                  </div>
                  <div className="form-error">
                    {paymentFailed && !payPalFailure && <Error message={strings.PAYMENT_FAILED} />}
                    {paymentFailed && payPalFailure?.kind === 'not-charged' && <Error message={strings.PAYPAL_NOT_CHARGED} />}
                    {paymentFailed && payPalFailure?.kind === 'refunded' && <Error message={strings.PAYPAL_REFUNDED} />}
                    {paymentFailed && payPalFailure?.kind === 'support-review' && <Error message={strings.PAYPAL_SUPPORT_REVIEW} />}
                    {paymentFailed && payPalFailure?.kind === 'cancelled' && <Error message={strings.PAYPAL_CANCELLED} />}
                    {paymentFailed && payPalFailure?.kind === 'error' && <Error message={strings.PAYPAL_ERROR} />}
                    {paymentFailed && payPalFailure?.kind === 'order-failed' && <Error message={strings.PAYPAL_ORDER_FAILED} />}
                    {paymentFailed && (!payPalFailure || payPalFailure.kind !== 'support-review') && <Button variant="outlined" onClick={retryPayment}>{strings.TRY_AGAIN}</Button>}
                    {recaptchaError && <Error message={commonStrings.RECAPTCHA_ERROR} />}
                    {licenseRequired && <Error message={strings.LICENSE_REQUIRED} />}
                  </div>
                </form>
              </Paper>
            </div>

            <Footer />
          </>
        )}

        {user?.blacklisted && <Unauthorized />}

        {noMatch && <NoMatch hideHeader variant="lost-search" />}

        {loadError && <Error message={commonStrings.GENERIC_ERROR} />}

        {success && bookingId && (
          <CheckoutStatus
            bookingId={bookingId}
            language={language}
            payLater={payLater}
            sessionId={sessionId}
            status="success"
            className="status"
          />
        )}

        {payPalProcessing && <Backdrop text={strings.CHECKING} />}

        <MapDialog
          pickupLocation={pickupLocation}
          openMapDialog={openMapDialog}
          onClose={() => setOpenMapDialog(false)}
        />
      </Layout>

      {loadingPage && !noMatch && <Progress />}
    </>
  )
}

export default Checkout