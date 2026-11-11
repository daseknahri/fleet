import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FormControl,
  FormControlLabel,
  Switch,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormHelperText,
  InputLabel,
  Input,
  MenuItem,
  Select,
  TextField
} from '@mui/material'
import {
  Info as InfoIcon,
  Person as DriverIcon
} from '@mui/icons-material'
import { DateTimeValidationError } from '@mui/x-date-pickers'
import { Control, FieldErrors, useForm, UseFormClearErrors, UseFormRegister, UseFormSetValue, UseFormTrigger, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import env from '@/config/env.config'
import { strings as commonStrings } from '@/lang/common'
import { strings as blStrings } from '@/lang/booking-list'
import { strings as bfStrings } from '@/lang/booking-filter'
import { strings as csStrings } from '@/lang/cars'
import { strings } from '@/lang/booking'
import { visuallyHidden } from '@mui/utils'
import * as helper from '@/utils/helper'
import Layout from '@/components/Layout'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import AccessDenied from '@/components/AccessDenied'
import * as UserService from '@/services/UserService'
import * as BookingService from '@/services/BookingService'
import * as AgentService from '@/services/AgentService'
import { strings as agentStrings } from '@/lang/agents'
import * as CarService from '@/services/CarService'
import Backdrop from '@/components/SimpleBackdrop'
import NoMatch from './NoMatch'
import Error from './Error'
import CarList from '@/components/CarList'
import ContractOperations from '@/components/ContractOperations'
import SupplierSelectList from '@/components/SupplierSelectList'
import UserSelectList from '@/components/UserSelectList'
import LocationSelectList from '@/components/LocationSelectList'
import CarSelectList from '@/components/CarSelectList'
import StatusList from '@/components/StatusList'
import DateTimePicker from '@/components/DateTimePicker'
import DatePicker from '@/components/DatePicker'
import { Option } from '@/models/common'
import { schema, FormFields } from '@/models/BookingForm'

import '@/assets/css/booking.css'

// Create a separate component to avoid re-renders
interface AdditionalDriverFormProps {
  control: Control<FormFields>
  register: UseFormRegister<FormFields>
  errors: FieldErrors<FormFields>
  clearErrors: UseFormClearErrors<FormFields>
  trigger: UseFormTrigger<FormFields>
  setValue: UseFormSetValue<FormFields>
  language: string
}

const AdditionalDriverForm = ({ control, register, errors, clearErrors, trigger, setValue, language }: AdditionalDriverFormProps) => {
  // Only watch the fields needed in this component
  const additionalDriverBirthDate = useWatch({ control, name: 'additionalDriverBirthDate' })
  const additionalEmail = useWatch({ control, name: 'additionalDriverEmail' })
  const additionalDriverPhone = useWatch({ control, name: 'additionalDriverPhone' })

  return (
    <>
      <div className="info">
        <DriverIcon />
        <span>{csStrings.ADDITIONAL_DRIVER}</span>
      </div>
      <FormControl fullWidth margin="dense">
        <InputLabel className="required">{commonStrings.FULL_NAME}</InputLabel>
        <Input
          {...register('additionalDriverFullName')}
          type="text"
          required
          autoComplete="off"
        />
        {errors.additionalDriverFullName && <FormHelperText error>{commonStrings.REQUIRED}</FormHelperText>}
      </FormControl>

      <FormControl fullWidth margin="dense">
        <InputLabel className="required">{commonStrings.EMAIL}</InputLabel>
        <Input
          value={additionalEmail || ''}
          onChange={(e) => {
            if (errors.additionalDriverEmail) {
              clearErrors('additionalDriverEmail')
            }

            setValue('additionalDriverEmail', e.target.value)
          }}
          onBlur={() => {
            trigger('additionalDriverEmail')
          }}
          type="text"
          error={!!errors.additionalDriverEmail}
          required
          autoComplete="off"
        />
        {errors.additionalDriverEmail && <FormHelperText error>{errors.additionalDriverEmail.message}</FormHelperText>}
      </FormControl>

      <FormControl fullWidth margin="dense">
        <InputLabel className="required">{commonStrings.PHONE}</InputLabel>
        <Input
          value={additionalDriverPhone || ''}
          type="text"
          error={!!errors.additionalDriverPhone}
          required
          autoComplete="off"
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
        {errors.additionalDriverPhone && <FormHelperText error>{errors.additionalDriverPhone.message}</FormHelperText>}
      </FormControl>
      <FormControl fullWidth margin="dense">
        <DatePicker
          label={commonStrings.BIRTH_DATE}
          value={additionalDriverBirthDate}
          required
          onChange={(birthDate) => {
            if (birthDate) {
              if (errors.additionalDriverBirthDate) {
                clearErrors('additionalDriverBirthDate')
              }
              setValue('additionalDriverBirthDate', birthDate)
              trigger('additionalDriverBirthDate')
            }
          }}
          language={language}
        />
        {errors.additionalDriverBirthDate && (
          <FormHelperText error>
            {helper.getBirthDateError(env.MINIMUM_AGE)}
          </FormHelperText>
        )}
      </FormControl>
    </>
  )
}

const UpdateBooking = () => {
  const navigate = useNavigate()
  const agencyPermissions = useAgencyPermissions()
  const accessDenied = !!agencyPermissions?.loaded && !agencyPermissions.can(AgencyPermission.ManageBookings)

  const [user, setUser] = useState<bookcarsTypes.User>()
  const [loading, setLoading] = useState(false)
  const [noMatch, setNoMatch] = useState(false)
  const [formError, setFormError] = useState(false)
  const [booking, setBooking] = useState<bookcarsTypes.Booking>()
  const [visible, setVisible] = useState(false)
  const [carObj, setCarObj] = useState<bookcarsTypes.Car>()
  const [isSupplier, setIsSupplier] = useState(false)
  const [minDate, setMinDate] = useState<Date>()
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false)
  const [language, setLanguage] = useState(env.DEFAULT_LANGUAGE)
  const [fromError, setFromError] = useState(false)
  const [toError, setToError] = useState(false)
  const [price, setPrice] = useState<number>()
  // GA-PAR-07: apporteur picker + per-contract override (blank mode/value
  // means "keep the stored snapshot terms" — see the backend update rule).
  const [agents, setAgents] = useState<bookcarsTypes.Agent[]>([])
  const [agentId, setAgentId] = useState('')
  const [agentMode, setAgentMode] = useState<bookcarsTypes.CommissionMode | ''>('')
  const [agentValue, setAgentValue] = useState('')
  // GA-PAR-10: 409-retry overlap exception — hidden until a conflict
  // response reveals it, and only ever offered to Owner/Manager.
  const canOverlapException = agencyPermissions?.role === bookcarsTypes.AgencyRole.Owner
    || agencyPermissions?.role === bookcarsTypes.AgencyRole.Manager
  const [overlapConflict, setOverlapConflict] = useState(false)
  const [overlapReason, setOverlapReason] = useState('')
  // GA-PAR-11: contract amendment / extension dialog. Dates are edited
  // as datetime-local strings; the preview mirrors the backend basis
  // (original snapshot rental total / original days x new days).
  const [openAmendDialog, setOpenAmendDialog] = useState(false)
  const [amendFrom, setAmendFrom] = useState('')
  const [amendTo, setAmendTo] = useState('')
  const [amendReason, setAmendReason] = useState('')
  const [amendExceptionReason, setAmendExceptionReason] = useState('')
  const [amendBusy, setAmendBusy] = useState(false)
  // GA-PAR-12: online signing panel. The issued link is held only in
  // this component's state (it is the sole live copy of the capability
  // token); booking payloads carry only the derived signed state.
  const [signingLink, setSigningLink] = useState('')
  const [signingBusy, setSigningBusy] = useState(false)

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
    clearErrors,
    trigger,
  } = useForm<FormFields>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    defaultValues: {
      supplier: undefined,
      driver: undefined,
      pickupLocation: undefined,
      dropOffLocation: undefined,
      car: undefined,
      status: undefined,
      cancellation: false,
      amendments: false,
      theftProtection: false,
      collisionDamageWaiver: false,
      fullInsurance: false,
      additionalDriver: false,
      additionalDriverFullName: '',
      additionalDriverEmail: '',
      additionalDriverPhone: '',
    }
  })

  const supplier = useWatch({ control, name: 'supplier' })
  const pickupLocation = useWatch({ control, name: 'pickupLocation' })
  const dropOffLocation = useWatch({ control, name: 'dropOffLocation' })
  const driver = useWatch({ control, name: 'driver' })
  const from = useWatch({ control, name: 'from' })
  const to = useWatch({ control, name: 'to' })
  const status = useWatch({ control, name: 'status' })
  const cancellation = useWatch({ control, name: 'cancellation' })
  const amendments = useWatch({ control, name: 'amendments' })
  const theftProtection = useWatch({ control, name: 'theftProtection' })
  const collisionDamageWaiver = useWatch({ control, name: 'collisionDamageWaiver' })
  const fullInsurance = useWatch({ control, name: 'fullInsurance' })
  const additionalDriver = useWatch({ control, name: 'additionalDriver' })

  const toastErr = (err?: unknown, hideLoading?: boolean): void => {
    helper.error(err)
    if (hideLoading) {
      setLoading(false)
    }
  }

  const handleDelete = () => {
    setOpenDeleteDialog(true)
  }

  const handleCancelDelete = () => {
    setOpenDeleteDialog(false)
  }

  const handleConfirmDelete = async () => {
    if (booking && booking._id) {
      try {
        setOpenDeleteDialog(false)

        const _status = await BookingService.deleteBookings([booking._id])

        if (_status === 200) {
          navigate('/')
        } else {
          toastErr(true)
        }
      } catch (err) {
        helper.error(err, helper.getErrorMessage(err))
      }
    } else {
      helper.error()
    }
  }

  const toLocalInput = (d: Date | string) => {
    const x = new Date(d)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`
  }

  const handleOpenAmend = () => {
    if (!booking) {
      return
    }
    setAmendFrom(toLocalInput(booking.from))
    setAmendTo(toLocalInput(booking.to))
    setAmendReason('')
    setAmendExceptionReason('')
    setOpenAmendDialog(true)
  }

  const handleConfirmAmend = async () => {
    if (!booking?._id) {
      return
    }
    if (amendReason.trim().length < 3 || amendReason.trim().length > 1000 || !amendFrom || !amendTo) {
      helper.error()
      return
    }
    setAmendBusy(true)
    try {
      const payload: bookcarsTypes.AmendBookingPayload = {
        from: new Date(amendFrom),
        to: new Date(amendTo),
        reason: amendReason.trim(),
      }
      // GA-PAR-11 x PAR-10: an exception composes only when the operator
      // separately supplies one here (Owner/Manager; the backend gate
      // refuses everyone else and stamps only a real bypass).
      if (canOverlapException && amendExceptionReason.trim()) {
        payload.overlapException = { reason: amendExceptionReason.trim() }
      }
      const amended = await BookingService.amend(booking._id, payload)
      setBooking(amended)
      setPrice(amended.price)
      setOpenAmendDialog(false)
      helper.info(commonStrings.UPDATED)
    } catch (err) {
      helper.error(err, helper.getErrorMessage(err))
    } finally {
      setAmendBusy(false)
    }
  }

  const handleIssueSigningLink = async () => {
    if (!booking?._id) {
      return
    }
    setSigningBusy(true)
    try {
      const link = await BookingService.issueSigningLink(booking._id)
      setSigningLink(link.url)
    } catch (err) {
      helper.error(err, helper.getErrorMessage(err))
    } finally {
      setSigningBusy(false)
    }
  }

  const handleCopySigningLink = async () => {
    if (!signingLink) {
      return
    }
    try {
      await navigator.clipboard.writeText(signingLink)
      helper.info(strings.SIGNING_COPIED)
    } catch {
      helper.error()
    }
  }

  const handleRevokeSigningLink = async () => {
    if (!booking?._id) {
      return
    }
    setSigningBusy(true)
    try {
      const status = await BookingService.revokeSigningLink(booking._id)
      if (status === 200) {
        setSigningLink('')
        helper.info(strings.SIGNING_REVOKED)
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err, helper.getErrorMessage(err))
    } finally {
      setSigningBusy(false)
    }
  }

  const onSubmit = async (data: FormFields) => {
    try {
      const additionalDriverSet = helper.carOptionAvailable(carObj, 'additionalDriver') && data.additionalDriver

      if (!booking) {
        helper.error()
        return
      }

      if (fromError || toError) {
        return
      }

      const _booking: bookcarsTypes.Booking = {
        _id: booking._id,
        supplier: data.supplier?._id!,
        car: data.car?._id!,
        driver: data.driver?._id,
        pickupLocation: data.pickupLocation?._id!,
        dropOffLocation: data.dropOffLocation?._id!,
        from: data.from!,
        to: data.to!,
        status: data.status as bookcarsTypes.BookingStatus,
        cancellation: data.cancellation,
        amendments: data.amendments,
        theftProtection: data.theftProtection,
        collisionDamageWaiver: data.collisionDamageWaiver,
        fullInsurance: data.fullInsurance,
        additionalDriver: additionalDriverSet,
        price,
        isDeposit: booking.isDeposit,
        isPayedInFull: booking.isPayedInFull,
      }

      // GA-PAR-07: apporteur payload — no agent selected means an explicit
      // clear (null); a selected agent sends only the fields the operator
      // actually set, so an untouched picker preserves the stored snapshot
      // under the backend update rule (no silent re-rating).
      if (!agentId) {
        ;(_booking as { agent?: unknown }).agent = null
      } else {
        const agentPayload: { agent: string, mode?: bookcarsTypes.CommissionMode, value?: number } = { agent: agentId }
        if (agentMode) {
          agentPayload.mode = agentMode
        }
        if (agentValue !== '' && Number.isFinite(Number(agentValue))) {
          agentPayload.value = Number(agentValue)
        }
        ;(_booking as { agent?: unknown }).agent = agentPayload
      }

      // GA-PAR-10: on the retry after a revealed conflict, resubmit the
      // same payload with the exception reason attached (the backend
      // re-checks the role and stamps author/time server-side). Without
      // a retry, no overlapException key is sent and a stored exception
      // record simply continues on the booking.
      if (overlapConflict) {
        if (!canOverlapException || overlapReason.trim().length < 3 || overlapReason.trim().length > 1000) {
          helper.error()
          return
        }
        _booking.overlapException = { reason: overlapReason }
      }

      let payload: bookcarsTypes.UpsertBookingPayload
      let _additionalDriver: bookcarsTypes.AdditionalDriver
      if (additionalDriverSet) {
        _additionalDriver = {
          fullName: data.additionalDriverFullName!,
          email: data.additionalDriverEmail!,
          phone: data.additionalDriverPhone!,
          birthDate: data.additionalDriverBirthDate!,
        }

        payload = {
          booking: _booking,
          additionalDriver: _additionalDriver,
        }
      } else {
        payload = { booking: _booking }
      }

      const _status = await BookingService.update(payload)

      if (_status === 200) {
        if (!additionalDriverSet) {
          setValue('additionalDriverFullName', '')
          setValue('additionalDriverEmail', '')
          setValue('additionalDriverPhone', '')
          setValue('additionalDriverBirthDate', undefined)
        }
        helper.info(commonStrings.UPDATED)
      } else {
        toastErr()
      }
    } catch (err) {
      // GA-PAR-10: a 409 conflict reveals the exception offer to
      // Owner/Manager only; everyone else keeps the plain error.
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 409 && canOverlapException && !overlapConflict) {
        setOverlapConflict(true)
        setLoading(false)
        return
      }
      helper.error(err, helper.getErrorMessage(err))
    }
  }

  const onLoad = async (_user?: bookcarsTypes.User) => {
    if (_user) {
      setUser(_user)
      setLanguage(UserService.getLanguage())
      setLoading(true)

      const params = new URLSearchParams(window.location.search)
      if (params.has('b')) {
        const id = params.get('b')
        if (id && id !== '') {
          try {
            const _booking = await BookingService.getBooking(id)

            if (_booking) {
              if (!helper.admin(_user) && (_booking.supplier as bookcarsTypes.User)._id !== _user._id) {
                setLoading(false)
                setNoMatch(true)
                return
              }

              if (!_booking.driver) {
                setLoading(false)
                setNoMatch(true)
                return
              }

              setBooking(_booking)
              setPrice(_booking.price)
              // GA-PAR-07: initialise the apporteur picker from the stored
              // snapshot and load the agency's active agents.
              setAgentId(_booking.agent?.agent
                ? (typeof _booking.agent.agent === 'string' ? _booking.agent.agent : (_booking.agent.agent as unknown as { _id?: string })._id || '')
                : '')
              setAgentMode('')
              setAgentValue('')
              AgentService.list((_booking.supplier as bookcarsTypes.User)._id as string)
                .then((list) => setAgents(list.filter((agent) => agent.active)))
                .catch(() => setAgents([]))
              setLoading(false)
              setVisible(true)
              setIsSupplier(_user.type === bookcarsTypes.RecordType.Supplier)
              const cmp = _booking.supplier as bookcarsTypes.User
              setValue('supplier', {
                _id: cmp._id as string,
                name: cmp.fullName,
                image: cmp.avatar,
              })
              setValue('car', _booking.car as bookcarsTypes.Car)
              setCarObj(_booking.car as bookcarsTypes.Car)
              const drv = _booking.driver as bookcarsTypes.User
              setValue('driver', {
                _id: drv._id as string,
                name: drv.fullName,
                image: drv.avatar,
              })
              const pul = _booking.pickupLocation as bookcarsTypes.Location
              setValue('pickupLocation', {
                _id: pul._id,
                name: pul.name || '',
              })
              const dol = _booking.dropOffLocation as bookcarsTypes.Location
              setValue('dropOffLocation', {
                _id: dol._id,
                name: dol.name || '',
              })
              setValue('from', new Date(_booking.from))
              const _minDate = new Date(_booking.from)
              _minDate.setDate(_minDate.getDate() + 1)
              setMinDate(_minDate)
              setValue('to', new Date(_booking.to))

              setValue('status', _booking.status)
              setValue('cancellation', _booking.cancellation || false)
              setValue('amendments', _booking.amendments || false)
              setValue('theftProtection', _booking.theftProtection || false)
              setValue('collisionDamageWaiver', _booking.collisionDamageWaiver || false)
              setValue('fullInsurance', _booking.fullInsurance || false)
              setValue('additionalDriver', (_booking.additionalDriver && !!_booking._additionalDriver) || false)
              if (_booking.additionalDriver && _booking._additionalDriver) {
                const _additionalDriver = _booking._additionalDriver as bookcarsTypes.AdditionalDriver
                setValue('additionalDriverFullName', _additionalDriver.fullName)
                setValue('additionalDriverEmail', _additionalDriver.email)
                setValue('additionalDriverPhone', _additionalDriver.phone)
                setValue('additionalDriverBirthDate', new Date(_additionalDriver.birthDate))
              }
            } else {
              setLoading(false)
              setNoMatch(true)
            }
          } catch {
            setLoading(false)
            setFormError(true)
            setVisible(false)
          }
        } else {
          setLoading(false)
          setNoMatch(true)
        }
      } else {
        setLoading(false)
        setNoMatch(true)
      }
    }
  }

  const days = bookcarsHelper.days(from, to)


  if (accessDenied) {
    return (
      <Layout onLoad={onLoad} strict>
        <AccessDenied />
      </Layout>
    )
  }

  return (
    <Layout onLoad={onLoad} strict>
      {visible && booking && (
        <div className="booking">
          <h1 style={visuallyHidden}>{strings.UPDATE_BOOKING_HEADING}</h1>
          <div className="booking-reference">
            {`${blStrings.REFERENCE} : ${booking.reference || (booking._id || '').slice(-8).toUpperCase()}`}
          </div>
          {booking.overlapException && (
            <div className="overlap-exception-record">
              <span>{strings.OVERLAP_EXCEPTION_RECORDED}</span>
              {': '}
              <span>{booking.overlapException.reason}</span>
              {booking.overlapException.authorisedAt && (
                <span>{` — ${new Date(booking.overlapException.authorisedAt).toLocaleString()}`}</span>
              )}
            </div>
          )}
          {booking.onlineSignature?.signedAt && (
            <div className="signed-online-notice">
              <span>{strings.CLIENT_SIGNED_ONLINE}</span>
              <span>{` — ${new Date(booking.onlineSignature.signedAt).toLocaleString()}`}</span>
            </div>
          )}
          <div className="col-1">
            <form onSubmit={handleSubmit(onSubmit)}>
              {!isSupplier && (
                <FormControl fullWidth margin="dense">
                  <SupplierSelectList
                    label={blStrings.SUPPLIER}
                    required
                    variant="standard"
                    onChange={(values) => {
                      const supplier = values.length > 0 ? values[0] as Option : undefined
                      setValue('supplier', supplier)
                      setValue('car', undefined)
                      setCarObj(undefined)
                    }}
                    value={supplier}
                  />
                </FormControl>
              )}

              <UserSelectList
                label={blStrings.DRIVER}
                required
                variant="standard"
                onChange={(values) => setValue('driver', values.length > 0 ? values[0] as Option : undefined)}
                value={driver}
              />

              <FormControl fullWidth margin="dense">
                <LocationSelectList
                  label={bfStrings.PICK_UP_LOCATION}
                  required
                  variant="standard"
                  onChange={(values) => setValue('pickupLocation', values.length > 0 ? values[0] as Option : undefined)}
                  value={pickupLocation}
                />
              </FormControl>

              <FormControl fullWidth margin="dense">
                <LocationSelectList
                  label={bfStrings.DROP_OFF_LOCATION}
                  required
                  variant="standard"
                  onChange={(values) => setValue('dropOffLocation', values.length > 0 ? values[0] as Option : undefined)}
                  value={dropOffLocation}
                />
              </FormControl>

              <CarSelectList
                label={blStrings.CAR}
                supplier={supplier?._id!}
                pickupLocation={pickupLocation?._id!}
                value={carObj}
                onChange={async (values) => {
                  try {
                    const newCar = values.length > 0 ? values[0] : undefined

                    if ((!carObj && newCar) || (carObj && newCar && carObj._id !== newCar._id)) {
                      // car changed
                      const _car = await CarService.getCar(newCar._id)

                      if (_car && from && to) {
                        const _booking = bookcarsHelper.clone(booking)
                        _booking.car = _car

                        const options: bookcarsTypes.CarOptions = {
                          cancellation,
                          amendments,
                          theftProtection,
                          collisionDamageWaiver,
                          fullInsurance,
                          additionalDriver,
                        }

                        const _price = await bookcarsHelper.calculateTotalPrice(_car, from, to, _car.supplier.priceChangeRate || 0, options)
                        setPrice(_price)

                        setBooking(_booking)
                        setCarObj(newCar)
                        setValue('car', newCar)
                      } else {
                        helper.error()
                      }
                    } else if (!newCar) {
                      setPrice(0)
                      setCarObj(newCar)
                      setValue('car', newCar)
                    } else {
                      setCarObj(newCar)
                      setValue('car', newCar)
                    }
                  } catch (err) {
                    helper.error(err)
                  }
                }}
                required
              />

              <FormControl fullWidth margin="dense">
                <DateTimePicker
                  label={commonStrings.FROM}
                  value={from}
                  showClear
                  required
                  onChange={async (date) => {
                    if (date) {
                      const _booking = bookcarsHelper.clone(booking) as bookcarsTypes.Booking
                      _booking.from = date

                      const options: bookcarsTypes.CarOptions = {
                        cancellation,
                        amendments,
                        theftProtection,
                        collisionDamageWaiver,
                        fullInsurance,
                        additionalDriver,
                      }

                      const _price = await bookcarsHelper.calculateTotalPrice(carObj!, date, to!, carObj!.supplier.priceChangeRate || 0, options)
                      setBooking(_booking)
                      setPrice(_price)
                      setValue('from', date)

                      const _minDate = new Date(date)
                      _minDate.setDate(_minDate.getDate() + 1)
                      setMinDate(_minDate)
                      setFromError(false)

                      if (to && date > to) {
                        setValue('to', undefined)
                      }
                    } else {
                      setValue('from', undefined)
                      setMinDate(undefined)
                    }
                  }}
                  onError={(err: DateTimeValidationError) => {
                    if (err) {
                      setFromError(true)
                    } else {
                      setFromError(false)
                    }
                  }}
                  language={UserService.getLanguage()}
                />
              </FormControl>

              <FormControl fullWidth margin="dense">
                <DateTimePicker
                  label={commonStrings.TO}
                  value={to}
                  minDate={minDate}
                  showClear
                  required
                  onChange={async (date) => {
                    if (date) {
                      const _booking = bookcarsHelper.clone(booking) as bookcarsTypes.Booking
                      _booking.to = date

                      const options: bookcarsTypes.CarOptions = {
                        cancellation,
                        amendments,
                        theftProtection,
                        collisionDamageWaiver,
                        fullInsurance,
                        additionalDriver,
                      }

                      const _price = await bookcarsHelper.calculateTotalPrice(carObj!, from!, date, carObj!.supplier.priceChangeRate || 0, options)
                      setBooking(_booking)
                      setPrice(_price)
                      setValue('to', date)

                      const _maxDate = new Date(date)
                      _maxDate.setDate(_maxDate.getDate() - 1)
                      setToError(false)
                    } else {
                      setValue('to', undefined)
                    }
                  }}
                  onError={(err: DateTimeValidationError) => {
                    if (err) {
                      setToError(true)
                    } else {
                      setToError(false)
                    }
                  }}
                  language={UserService.getLanguage()}
                />
              </FormControl>

              <FormControl fullWidth margin="dense">
                <StatusList
                  disablePaymentStatuses
                  label={blStrings.STATUS}
                  value={status}
                  onChange={(value) => {
                    if (status !== value) {
                      setValue('status', value)
                    }
                  }}
                  required
                />
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel>{strings.AGENT}</InputLabel>
                <Select
                  label={strings.AGENT}
                  value={agentId}
                  onChange={(e) => {
                    setAgentId(e.target.value)
                    setAgentMode('')
                    setAgentValue('')
                  }}
                >
                  <MenuItem value="">{strings.AGENT_NONE}</MenuItem>
                  {agents.map((agent) => (
                    <MenuItem key={agent._id} value={agent._id}>
                      {agent.name}
                      {' — '}
                      {agent.commissionMode === bookcarsTypes.CommissionMode.Percent
                        ? `${agent.commissionValue} %`
                        : `${agent.commissionValue}${agent.commissionMode === bookcarsTypes.CommissionMode.PerDay ? ` / ${agentStrings.MODE_PER_DAY.toLowerCase()}` : ''}`}
                    </MenuItem>
                  ))}
                </Select>
                {booking?.agent && (
                  <FormHelperText>
                    {strings.AGENT_SNAPSHOT}
                    {': '}
                    {booking.agent.mode === bookcarsTypes.CommissionMode.Percent
                      ? agentStrings.MODE_PERCENT
                      : booking.agent.mode === bookcarsTypes.CommissionMode.PerDay ? agentStrings.MODE_PER_DAY : agentStrings.MODE_FIXED}
                    {' · '}
                    {booking.agent.value}
                    {' → '}
                    {booking.agent.amount}
                    {' MAD'}
                  </FormHelperText>
                )}
              </FormControl>

              {agentId && (
                <>
                  <FormControl fullWidth margin="dense">
                    <InputLabel>{strings.AGENT_MODE}</InputLabel>
                    <Select
                      label={strings.AGENT_MODE}
                      value={agentMode}
                      onChange={(e) => setAgentMode(e.target.value as bookcarsTypes.CommissionMode | '')}
                    >
                      <MenuItem value="">
                        {agentStrings.COMMISSION}
                        {': '}
                        {booking?.agent && agentId === (typeof booking.agent.agent === 'string' ? booking.agent.agent : '')
                          ? (booking.agent.mode === bookcarsTypes.CommissionMode.Percent
                            ? agentStrings.MODE_PERCENT
                            : booking.agent.mode === bookcarsTypes.CommissionMode.PerDay ? agentStrings.MODE_PER_DAY : agentStrings.MODE_FIXED)
                          : (agents.find((agent) => agent._id === agentId)?.commissionMode === bookcarsTypes.CommissionMode.Percent
                            ? agentStrings.MODE_PERCENT
                            : agents.find((agent) => agent._id === agentId)?.commissionMode === bookcarsTypes.CommissionMode.PerDay
                              ? agentStrings.MODE_PER_DAY : agentStrings.MODE_FIXED)}
                      </MenuItem>
                      {Object.values(bookcarsTypes.CommissionMode).map((mode) => (
                        <MenuItem key={mode} value={mode}>
                          {mode === bookcarsTypes.CommissionMode.Percent
                            ? agentStrings.MODE_PERCENT
                            : mode === bookcarsTypes.CommissionMode.PerDay ? agentStrings.MODE_PER_DAY : agentStrings.MODE_FIXED}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth margin="dense">
                    <TextField
                      label={strings.AGENT_VALUE}
                      type="number"
                      value={agentValue}
                      onChange={(e) => setAgentValue(e.target.value)}
                      placeholder={String(
                        (booking?.agent && agentId === (typeof booking.agent.agent === 'string' ? booking.agent.agent : ''))
                          ? booking.agent.value
                          : agents.find((agent) => agent._id === agentId)?.commissionValue ?? '',
                      )}
                      inputProps={{ min: 0, step: 'any' }}
                    />
                  </FormControl>
                </>
              )}

              <div className="info">
                <InfoIcon />
                <span>{commonStrings.OPTIONAL}</span>
              </div>

              <FormControl fullWidth margin="dense" className="checkbox-fc">
                <FormControlLabel
                  control={
                    <Switch
                      // {...register('cancellation')}
                      checked={cancellation}
                      color="primary"
                      disabled={!carObj || !helper.carOptionAvailable(carObj, 'cancellation')}
                      onChange={async (e) => {
                        if (booking && carObj && from && to) {
                          const _booking = bookcarsHelper.clone(booking) as bookcarsTypes.Booking
                          _booking.cancellation = e.target.checked

                          const options: bookcarsTypes.CarOptions = {
                            cancellation: _booking.cancellation,
                            amendments,
                            theftProtection,
                            collisionDamageWaiver,
                            fullInsurance,
                            additionalDriver,
                          }

                          const _price = await bookcarsHelper.calculateTotalPrice(carObj, from, to, carObj.supplier.priceChangeRate || 0, options)
                          setBooking(_booking)
                          setPrice(_price)
                          setValue('cancellation', _booking.cancellation || false)
                        }
                      }}
                    />
                  }
                  label={csStrings.CANCELLATION}
                  className="checkbox-fcl"
                />
              </FormControl>

              <FormControl fullWidth margin="dense" className="checkbox-fc">
                <FormControlLabel
                  control={
                    <Switch
                      // {...register('amendments')}
                      checked={amendments}
                      color="primary"
                      disabled={!carObj || !helper.carOptionAvailable(carObj, 'amendments')}
                      onChange={async (e) => {
                        if (booking && carObj && from && to) {
                          const _booking = bookcarsHelper.clone(booking) as bookcarsTypes.Booking
                          _booking.amendments = e.target.checked

                          const options: bookcarsTypes.CarOptions = {
                            cancellation,
                            amendments: _booking.amendments,
                            theftProtection,
                            collisionDamageWaiver,
                            fullInsurance,
                            additionalDriver,
                          }

                          const _price = await bookcarsHelper.calculateTotalPrice(carObj, from, to, carObj.supplier.priceChangeRate || 0, options)
                          setBooking(_booking)
                          setPrice(_price)
                          setValue('amendments', _booking.amendments || false)
                        }
                      }}
                    />
                  }
                  label={csStrings.AMENDMENTS}
                  className="checkbox-fcl"
                />
              </FormControl>

              <FormControl fullWidth margin="dense" className="checkbox-fc">
                <FormControlLabel
                  control={
                    <Switch
                      // {...register('theftProtection')}
                      checked={theftProtection}
                      color="primary"
                      disabled={!carObj || !helper.carOptionAvailable(carObj, 'theftProtection')}
                      onChange={async (e) => {
                        if (booking && carObj && from && to) {
                          const _booking = bookcarsHelper.clone(booking) as bookcarsTypes.Booking
                          _booking.theftProtection = e.target.checked

                          const options: bookcarsTypes.CarOptions = {
                            cancellation,
                            amendments,
                            theftProtection: _booking.theftProtection,
                            collisionDamageWaiver,
                            fullInsurance,
                            additionalDriver,
                          }

                          const _price = await bookcarsHelper.calculateTotalPrice(carObj, from, to, carObj.supplier.priceChangeRate || 0, options)
                          setBooking(_booking)
                          setPrice(_price)
                          setValue('theftProtection', _booking.theftProtection || false)
                        }
                      }}
                    />
                  }
                  label={csStrings.THEFT_PROTECTION}
                  className="checkbox-fcl"
                />
              </FormControl>

              <FormControl fullWidth margin="dense" className="checkbox-fc">
                <FormControlLabel
                  control={
                    <Switch
                      // {...register('collisionDamageWaiver')}
                      checked={collisionDamageWaiver}
                      color="primary"
                      disabled={!carObj || !helper.carOptionAvailable(carObj, 'collisionDamageWaiver')}
                      onChange={async (e) => {
                        if (booking && carObj && from && to) {
                          const _booking = bookcarsHelper.clone(booking) as bookcarsTypes.Booking
                          _booking.collisionDamageWaiver = e.target.checked

                          const options: bookcarsTypes.CarOptions = {
                            cancellation,
                            amendments,
                            theftProtection,
                            collisionDamageWaiver: _booking.collisionDamageWaiver,
                            fullInsurance,
                            additionalDriver,
                          }

                          const _price = await bookcarsHelper.calculateTotalPrice(carObj, from, to, carObj.supplier.priceChangeRate || 0, options)
                          setBooking(_booking)
                          setPrice(_price)
                          setValue('collisionDamageWaiver', _booking.collisionDamageWaiver || false)
                        }
                      }}
                    />
                  }
                  label={csStrings.COLLISION_DAMAGE_WAVER}
                  className="checkbox-fcl"
                />
              </FormControl>

              <FormControl fullWidth margin="dense" className="checkbox-fc">
                <FormControlLabel
                  control={
                    <Switch
                      // {...register('fullInsurance')}
                      checked={fullInsurance}
                      color="primary"
                      disabled={!carObj || !helper.carOptionAvailable(carObj, 'fullInsurance')}
                      onChange={async (e) => {
                        if (booking && carObj && from && to) {
                          const _booking = bookcarsHelper.clone(booking) as bookcarsTypes.Booking
                          _booking.fullInsurance = e.target.checked

                          const options: bookcarsTypes.CarOptions = {
                            cancellation,
                            amendments,
                            theftProtection,
                            collisionDamageWaiver,
                            fullInsurance: _booking.fullInsurance,
                            additionalDriver,
                          }

                          const _price = await bookcarsHelper.calculateTotalPrice(carObj, from, to, carObj.supplier.priceChangeRate || 0, options)
                          setBooking(_booking)
                          setPrice(_price)
                          setValue('fullInsurance', _booking.fullInsurance || false)
                        }
                      }}
                    />
                  }
                  label={csStrings.FULL_INSURANCE}
                  className="checkbox-fcl"
                />
              </FormControl>

              <FormControl fullWidth margin="dense" className="checkbox-fc">
                <FormControlLabel
                  control={
                    <Switch
                      // {...register('additionalDriver')}
                      checked={additionalDriver}
                      color="primary"
                      disabled={!carObj || !helper.carOptionAvailable(carObj, 'additionalDriver')}
                      onChange={async (e) => {
                        if (booking && carObj && from && to) {
                          const _booking = bookcarsHelper.clone(booking) as bookcarsTypes.Booking
                          _booking.additionalDriver = e.target.checked

                          const options: bookcarsTypes.CarOptions = {
                            cancellation,
                            amendments,
                            theftProtection,
                            collisionDamageWaiver,
                            fullInsurance,
                            additionalDriver: _booking.additionalDriver,
                          }

                          const _price = await bookcarsHelper.calculateTotalPrice(carObj, from, to, carObj.supplier.priceChangeRate || 0, options)
                          setBooking(_booking)
                          setPrice(_price)
                          setValue('additionalDriver', _booking.additionalDriver || false)
                        }
                      }}
                    />
                  }
                  label={csStrings.ADDITIONAL_DRIVER}
                  className="checkbox-fcl"
                />
              </FormControl>

              {carObj && helper.carOptionAvailable(carObj, 'additionalDriver') && additionalDriver && (
                <AdditionalDriverForm
                  control={control}
                  register={register}
                  errors={errors}
                  clearErrors={clearErrors}
                  trigger={trigger}
                  setValue={setValue}
                  language={language}
                />
              )}

              {overlapConflict && canOverlapException && (
                <div className="overlap-exception">
                  <div className="info">
                    <InfoIcon />
                    <span>{strings.OVERLAP_EXCEPTION_TITLE}</span>
                  </div>
                  <p>{strings.OVERLAP_EXCEPTION_TEXT}</p>
                  <FormControl fullWidth margin="dense">
                    <TextField
                      label={strings.OVERLAP_REASON}
                      multiline
                      minRows={2}
                      required
                      value={overlapReason}
                      onChange={(e) => setOverlapReason(e.target.value)}
                      inputProps={{ maxLength: 1000 }}
                    />
                  </FormControl>
                </div>
              )}

              <div>
                <div className="buttons">
                  <Button variant="contained" className="btn-primary btn-margin-bottom" size="small" type="submit" disabled={isSubmitting}>
                    {commonStrings.SAVE}
                  </Button>
                  <Button variant="contained" className="btn-margin-bottom" color="error" size="small" onClick={handleDelete}>
                    {commonStrings.DELETE}
                  </Button>
                  <Button variant="contained" className="btn-secondary btn-margin-bottom" size="small" onClick={handleOpenAmend}>
                    {strings.AMEND_BOOKING}
                  </Button>
                  <Button variant="contained" className="btn-secondary btn-margin-bottom" size="small" onClick={() => navigate('/')}>
                    {commonStrings.CANCEL}
                  </Button>
                </div>
              </div>
            </form>
          </div>
          {agencyPermissions?.can(AgencyPermission.ManageBookings) && (
            <div className="col-1">
              <div className="signing-panel">
                <h3>{strings.SIGNING_TITLE}</h3>
                {booking.onlineSignature?.signedAt ? (
                  <p>{`${strings.SIGNING_SIGNED} — ${new Date(booking.onlineSignature.signedAt).toLocaleString()}`}</p>
                ) : (
                  <>
                    <p>{strings.SIGNING_UNSIGNED}</p>
                    {signingLink && (
                      <FormControl fullWidth margin="dense">
                        <TextField
                          label={strings.SIGNING_LINK_LABEL}
                          value={signingLink}
                          slotProps={{ input: { readOnly: true } }}
                          onFocus={(e) => e.target.select()}
                        />
                      </FormControl>
                    )}
                    <div className="buttons">
                      <Button variant="contained" className="btn-primary btn-margin-bottom" size="small" onClick={handleIssueSigningLink} disabled={signingBusy}>
                        {strings.SIGNING_ISSUE}
                      </Button>
                      {signingLink && (
                        <Button variant="contained" className="btn-secondary btn-margin-bottom" size="small" onClick={handleCopySigningLink} disabled={signingBusy}>
                          {strings.SIGNING_COPY}
                        </Button>
                      )}
                      <Button variant="contained" className="btn-margin-bottom" color="error" size="small" onClick={handleRevokeSigningLink} disabled={signingBusy}>
                        {strings.SIGNING_REVOKE}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="col-1">
            <ContractOperations bookingId={booking._id!} supplierId={typeof booking.supplier === 'string' ? booking.supplier : booking.supplier?._id} lifecycle={booking.lifecycle} depositAmount={booking.financialSnapshot?.depositAmount} amendmentHistory={booking.amendmentHistory} onCompleted={() => setBooking({ ...booking, lifecycle: bookcarsTypes.ContractLifecycle.Completed })} />
          </div>
          <div className="col-2">
            {
              days > 0 && (
                <div className="col-2-header">
                  <div className="price">
                    <span className="price-days">{helper.getDays(days)}</span>
                    <span className="price-main">{bookcarsHelper.formatPrice(price as number, commonStrings.CURRENCY, language)}</span>
                    <span className="price-day">{`${csStrings.PRICE_PER_DAY} ${bookcarsHelper.formatPrice((price as number) / days, commonStrings.CURRENCY, language)}`}</span>
                  </div>
                </div>
              )
            }
            <CarList
              className="car"
              user={user}
              booking={booking}
              cars={((carObj && [booking.car]) as bookcarsTypes.Car[]) || []}
              language={language}
              hidePrice
            />
          </div>

          <Dialog maxWidth="sm" fullWidth open={openAmendDialog} onClose={() => setOpenAmendDialog(false)}>
            <DialogTitle className="dialog-header">{strings.AMEND_TITLE}</DialogTitle>
            <DialogContent>
              {(() => {
                const oldDays = bookcarsHelper.days(booking.from, booking.to)
                const basisTotal = booking.financialSnapshot?.rentalTotal ?? booking.price ?? 0
                const newDays = amendFrom && amendTo ? bookcarsHelper.days(new Date(amendFrom), new Date(amendTo)) : 0
                const newTotal = oldDays > 0 && newDays > 0 ? (basisTotal / oldDays) * newDays : basisTotal
                return (
                  <>
                    <TextField label={strings.AMEND_NEW_FROM} type="datetime-local" fullWidth margin="dense" InputLabelProps={{ shrink: true }} value={amendFrom} onChange={(e) => setAmendFrom(e.target.value)} />
                    <TextField label={strings.AMEND_NEW_TO} type="datetime-local" fullWidth margin="dense" InputLabelProps={{ shrink: true }} value={amendTo} onChange={(e) => setAmendTo(e.target.value)} />
                    <TextField label={strings.AMEND_REASON} multiline minRows={2} fullWidth margin="dense" required inputProps={{ maxLength: 1000 }} value={amendReason} onChange={(e) => setAmendReason(e.target.value)} />
                    {canOverlapException && (
                      <TextField label={strings.OVERLAP_REASON} multiline minRows={2} fullWidth margin="dense" inputProps={{ maxLength: 1000 }} value={amendExceptionReason} onChange={(e) => setAmendExceptionReason(e.target.value)} />
                    )}
                    <div style={{ marginTop: 8 }}>
                      <div>{`${strings.AMEND_OLD_TOTAL} ${bookcarsHelper.formatPrice(basisTotal, commonStrings.CURRENCY, language)}`}</div>
                      <div>{`${strings.AMEND_DAYS} ${newDays - oldDays > 0 ? '+' : ''}${newDays - oldDays}`}</div>
                      <div>{`${strings.AMEND_PRICE_DELTA} ${bookcarsHelper.formatPrice(newTotal - basisTotal, commonStrings.CURRENCY, language)}`}</div>
                      <div>{`${strings.AMEND_NEW_TOTAL} ${bookcarsHelper.formatPrice(newTotal, commonStrings.CURRENCY, language)}`}</div>
                    </div>
                  </>
                )
              })()}
            </DialogContent>
            <DialogActions className="dialog-actions">
              <Button onClick={() => setOpenAmendDialog(false)} variant="contained" className="btn-secondary">
                {commonStrings.CANCEL}
              </Button>
              <Button onClick={handleConfirmAmend} variant="contained" disabled={amendBusy}>
                {strings.AMEND_SUBMIT}
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog disableEscapeKeyDown maxWidth="xs" open={openDeleteDialog}>
            <DialogTitle className="dialog-header">{commonStrings.CONFIRM_TITLE}</DialogTitle>
            <DialogContent>{strings.DELETE_BOOKING}</DialogContent>
            <DialogActions className="dialog-actions">
              <Button onClick={handleCancelDelete} variant="contained" className="btn-secondary">
                {commonStrings.CANCEL}
              </Button>
              <Button onClick={handleConfirmDelete} variant="contained" color="error">
                {commonStrings.DELETE}
              </Button>
            </DialogActions>
          </Dialog>
        </div>
      )}

      {loading && <Backdrop text={commonStrings.PLEASE_WAIT} />}
      {noMatch && <NoMatch hideHeader />}
      {formError && <Error />}
    </Layout>
  )
}

export default UpdateBooking

