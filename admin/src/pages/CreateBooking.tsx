import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FormControl,
  Button,
  Paper,
  FormControlLabel,
  Switch,
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
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import Layout from '@/components/Layout'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import AccessDenied from '@/components/AccessDenied'
import env from '@/config/env.config'
import { strings as commonStrings } from '@/lang/common'
import { strings as blStrings } from '@/lang/booking-list'
import { strings as bfStrings } from '@/lang/booking-filter'
import { strings as csStrings } from '@/lang/cars'
import { strings } from '@/lang/create-booking'
import * as UserService from '@/services/UserService'
import * as BookingService from '@/services/BookingService'
import * as AgentService from '@/services/AgentService'
import { strings as agentStrings } from '@/lang/agents'
import * as helper from '@/utils/helper'
import SupplierSelectList from '@/components/SupplierSelectList'
import UserSelectList from '@/components/UserSelectList'
import LocationSelectList from '@/components/LocationSelectList'
import CarSelectList from '@/components/CarSelectList'
import StatusList from '@/components/StatusList'
import DateTimePicker from '@/components/DateTimePicker'
import DatePicker from '@/components/DatePicker'
import { Option, Supplier } from '@/models/common'
import { schema, FormFields } from '@/models/BookingForm'

import '@/assets/css/create-booking.css'

const CreateBooking = () => {
  const navigate = useNavigate()
  const agencyPermissions = useAgencyPermissions()
  const accessDenied = !!agencyPermissions?.loaded && !agencyPermissions.can(AgencyPermission.ManageBookings)

  const [isSupplier, setIsSupplier] = useState(false)
  const [visible, setVisible] = useState(false)
  const [carObj, setCarObj] = useState<bookcarsTypes.Car>()
  const [minDate, setMinDate] = useState<Date>()
  const [fromError, setFromError] = useState(false)
  const [toError, setToError] = useState(false)
  // GA-PAR-07: apporteur picker (active agents of the booking's agency) +
  // optional per-contract commission override.
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

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
    clearErrors,
    getValues,
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
  const supplierId = supplier?._id as string | undefined

  // GA-PAR-07: load the agency's active agents for the picker whenever the
  // booking's supplier is known (the backend re-scopes to the caller's
  // agency; the picker is gated by ReadAgents on the backend route).
  useEffect(() => {
    let cancelled = false
    if (!supplierId) {
      setAgents([])
      return undefined
    }
    AgentService.list(supplierId)
      .then((list) => {
        if (!cancelled) {
          setAgents(list.filter((agent) => agent.active))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgents([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [supplierId])

  const pickupLocation = useWatch({ control, name: 'pickupLocation' })
  const from = useWatch({ control, name: 'from' })
  const to = useWatch({ control, name: 'to' })
  const additionalDriverEnabled = useWatch({ control, name: 'additionalDriver' })

  useEffect(() => {
    if (from) {
      const _minDate = new Date(from)
      _minDate.setDate(_minDate.getDate() + 1)
      setMinDate(_minDate)
    } else {
      setMinDate(undefined)
    }
  }, [from])

  const onSubmit = async (data: FormFields) => {
    if (!carObj || fromError || toError) {
      helper.error()
      return
    }

    const additionalDriverSet = helper.carOptionAvailable(carObj, 'additionalDriver') && data.additionalDriver

    const booking: bookcarsTypes.Booking = {
      supplier: data.supplier?._id!,
      car: carObj._id,
      driver: data.driver?._id,
      pickupLocation: data.pickupLocation!._id,
      dropOffLocation: data.dropOffLocation!._id,
      from: data.from!,
      to: data.to!,
      status: data.status as bookcarsTypes.BookingStatus,
      cancellation: data.cancellation,
      amendments: data.amendments,
      theftProtection: data.theftProtection,
      collisionDamageWaiver: data.collisionDamageWaiver,
      fullInsurance: data.fullInsurance,
      additionalDriver: additionalDriverSet,
    }

    // GA-PAR-07: attach the apporteur; mode/value are sent only when the
    // operator overrode them — the server applies the agent default
    // otherwise and always computes the snapshot amount itself.
    if (agentId) {
      const agentPayload: { agent: string, mode?: bookcarsTypes.CommissionMode, value?: number } = { agent: agentId }
      if (agentMode) {
        agentPayload.mode = agentMode
      }
      if (agentValue !== '' && Number.isFinite(Number(agentValue))) {
        agentPayload.value = Number(agentValue)
      }
      booking.agent = agentPayload as bookcarsTypes.BookingAgentSnapshot
    }

    let _additionalDriver: bookcarsTypes.AdditionalDriver | undefined = undefined
    if (additionalDriverSet) {
      _additionalDriver = {
        fullName: data.additionalDriverFullName!,
        email: data.additionalDriverEmail!,
        phone: data.additionalDriverPhone!,
        birthDate: data.additionalDriverBirthDate!,
      }
    }

    const options: bookcarsTypes.CarOptions = {
      cancellation: data.cancellation,
      amendments: data.amendments,
      theftProtection: data.theftProtection,
      collisionDamageWaiver: data.collisionDamageWaiver,
      fullInsurance: data.fullInsurance,
      additionalDriver: additionalDriverSet,
    }

    // GA-PAR-10: on the retry after a revealed conflict, the same
    // payload is resubmitted with the exception reason attached; the
    // backend re-checks the role and stamps author/time server-side.
    if (overlapConflict) {
      if (!canOverlapException || overlapReason.trim().length < 3 || overlapReason.trim().length > 1000) {
        helper.error()
        return
      }
      booking.overlapException = { reason: overlapReason }
    }

    try {
      // use bookcarsHelper.calculatePrice
      const price = await bookcarsHelper.calculateTotalPrice(carObj, from!, to!, carObj.supplier.priceChangeRate || 0, options)
      booking.price = price

      const _booking = await BookingService.create({
        booking,
        additionalDriver: _additionalDriver,
      })

      if (_booking && _booking._id) {
        navigate('/')
      } else {
        helper.error()
      }
    } catch (err) {
      // GA-PAR-10: a 409 conflict reveals the exception offer to
      // Owner/Manager only; everyone else keeps the plain error.
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 409 && canOverlapException && !overlapConflict) {
        setOverlapConflict(true)
        return
      }
      helper.error(err)
    }
  }

  const onLoad = (user?: bookcarsTypes.User) => {
    if (user) {
      setVisible(true)

      if (user.type === bookcarsTypes.RecordType.Supplier) {
        setValue('supplier', { _id: user._id, name: user.fullName, image: user.avatar } as Supplier)
        setIsSupplier(true)
      }
    }
  }


  if (accessDenied) {
    return (
      <Layout onLoad={onLoad} strict>
        <AccessDenied />
      </Layout>
    )
  }

  return (
    <Layout onLoad={onLoad} strict>
      <div className="create-booking">
        <Paper className="booking-form booking-form-wrapper" elevation={10} style={visible ? {} : { display: 'none' }}>
          <h1 className="booking-form-title">{strings.NEW_BOOKING_HEADING}</h1>
          <form onSubmit={handleSubmit(onSubmit)}>
            {!isSupplier && (
              <FormControl fullWidth margin="dense">
                <SupplierSelectList
                  label={blStrings.SUPPLIER}
                  required
                  variant="standard"
                  onChange={(values) => setValue('supplier', values.length > 0 ? values[0] as Option : undefined)}
                />
              </FormControl>
            )}

            <UserSelectList
              label={blStrings.DRIVER}
              required
              variant="standard"
              onChange={(values) => setValue('driver', values.length > 0 ? values[0] as Option : undefined)}
            />

            <FormControl fullWidth margin="dense">
              <LocationSelectList
                label={bfStrings.PICK_UP_LOCATION}
                required
                variant="standard"
                onChange={(values) => setValue('pickupLocation', values.length > 0 ? values[0] as Option : undefined)}
              />
            </FormControl>

            <FormControl fullWidth margin="dense">
              <LocationSelectList
                label={bfStrings.DROP_OFF_LOCATION}
                required
                variant="standard"
                onChange={(values) => setValue('dropOffLocation', values.length > 0 ? values[0] as Option : undefined)}
              />
            </FormControl>

            <CarSelectList
              label={blStrings.CAR}
              supplier={supplier?._id!}
              pickupLocation={pickupLocation?._id!}
              onChange={(values) => {
                const _car = values.length > 0 ? values[0] as bookcarsTypes.Car : undefined
                setValue('car', _car)
                setCarObj(_car)
              }}
              required
            />

            <FormControl fullWidth margin="dense">
              <DateTimePicker
                label={commonStrings.FROM}
                value={from}
                showClear
                required
                onChange={(date) => {
                  setValue('from', date || undefined)

                  if (date && to && date > to) {
                    setValue('to', undefined)
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
                onChange={(date) => {
                  setValue('to', date || undefined)
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
                onChange={(value) => {
                  const currentValue = getValues('status')
                  if (currentValue !== value) {
                    setValue('status', value)
                  }
                }}
                required
              />
              {errors.status && <FormHelperText error>{commonStrings.REQUIRED}</FormHelperText>}
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
                      {agents.find((agent) => agent._id === agentId)?.commissionMode === bookcarsTypes.CommissionMode.Percent
                        ? agentStrings.MODE_PERCENT
                        : agents.find((agent) => agent._id === agentId)?.commissionMode === bookcarsTypes.CommissionMode.PerDay
                          ? agentStrings.MODE_PER_DAY : agentStrings.MODE_FIXED}
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
                    placeholder={String(agents.find((agent) => agent._id === agentId)?.commissionValue ?? '')}
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
                    {...register('cancellation')}
                    color="primary"
                    disabled={!carObj || !helper.carOptionAvailable(carObj, 'cancellation')}
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
                    {...register('amendments')}
                    color="primary"
                    disabled={!carObj || !helper.carOptionAvailable(carObj, 'amendments')}
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
                    {...register('theftProtection')}
                    color="primary"
                    disabled={!carObj || !helper.carOptionAvailable(carObj, 'theftProtection')}
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
                    {...register('collisionDamageWaiver')}
                    color="primary"
                    disabled={!carObj || !helper.carOptionAvailable(carObj, 'collisionDamageWaiver')}
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
                    {...register('fullInsurance')}
                    color="primary"
                    disabled={!carObj || !helper.carOptionAvailable(carObj, 'fullInsurance')}
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
                    {...register('additionalDriver')}
                    color="primary"
                    disabled={!carObj || !helper.carOptionAvailable(carObj, 'additionalDriver')}
                  />
                }
                label={csStrings.ADDITIONAL_DRIVER}
                className="checkbox-fcl"
              />
            </FormControl>

            {carObj && helper.carOptionAvailable(carObj, 'additionalDriver') && additionalDriverEnabled && (
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
                    {...register('additionalDriverEmail')}
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
                    {...register('additionalDriverPhone')}
                    type="text"
                    error={!!errors.additionalDriverPhone}
                    required
                    autoComplete="off"
                  />
                  {errors.additionalDriverPhone && <FormHelperText error>{errors.additionalDriverPhone.message}</FormHelperText>}
                </FormControl>
                <FormControl fullWidth margin="dense">
                  <DatePicker
                    label={commonStrings.BIRTH_DATE}
                    required
                    onChange={(birthDate) => {
                      if (birthDate) {
                        if (errors.additionalDriverBirthDate) {
                          clearErrors('additionalDriverBirthDate')
                        }
                        setValue('additionalDriverBirthDate', birthDate, { shouldValidate: true })
                      }
                    }}
                    language={UserService.getLanguage()}
                  />
                  {errors.additionalDriverBirthDate && (
                    <FormHelperText error>
                      {helper.getBirthDateError(env.MINIMUM_AGE)}
                    </FormHelperText>
                  )}
                </FormControl>
              </>
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
                <Button type="submit" variant="contained" className="btn-primary btn-margin-bottom" size="small" disabled={isSubmitting}>
                  {commonStrings.CREATE}
                </Button>
                <Button variant="contained" className="btn-secondary btn-margin-bottom" size="small" onClick={() => navigate('/')}>
                  {commonStrings.CANCEL}
                </Button>
              </div>
            </div>
          </form>
        </Paper>
      </div>
    </Layout>
  )
}

export default CreateBooking
