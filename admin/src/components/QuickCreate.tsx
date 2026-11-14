import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, FormHelperText, IconButton, InputLabel,
  Menu, MenuItem, Select, Switch, TextField,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import {
  DirectionsCar as CarsIcon,
  People as UsersIcon,
  EventNote as BookingsIcon,
  Build as MaintenanceIcon,
  SupportAgent as AgentsIcon,
  Groups as TeamIcon,
} from '@mui/icons-material'
import { DateTimeValidationError } from '@mui/x-date-pickers'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import env from '@/config/env.config'
import { strings } from '@/lang/quick-create'
import { strings as carStrings } from '@/lang/create-car'
import { strings as csStrings } from '@/lang/cars'
import { strings as commonStrings } from '@/lang/common'
import { strings as createUserStrings } from '@/lang/create-user'
import { strings as createBookingStrings } from '@/lang/create-booking'
import { strings as blStrings } from '@/lang/booking-list'
import { strings as bfStrings } from '@/lang/booking-filter'
import { strings as agentStrings } from '@/lang/agents'
import { strings as maintenanceStrings } from '@/lang/maintenance'
import { strings as teamStrings } from '@/lang/team'
import * as helper from '@/utils/helper'
import * as langHelper from '@/utils/langHelper'
import * as UserService from '@/services/UserService'
import * as CarService from '@/services/CarService'
import * as BookingService from '@/services/BookingService'
import * as AgentService from '@/services/AgentService'
import * as MaintenanceExpenseService from '@/services/MaintenanceExpenseService'
import * as AgencyMembershipService from '@/services/AgencyMembershipService'
import * as SupplierService from '@/services/SupplierService'
import { useUserContext, UserContextType } from '@/context/UserContext'
import { useAgencyPermissions, AgencyPermission } from '@/context/AgencyPermissionContext'
import Avatar from './Avatar'
import SupplierSelectList from './SupplierSelectList'
import LocationSelectList from './LocationSelectList'
import UserSelectList from './UserSelectList'
import CarSelectList from './CarSelectList'
import StatusList from './StatusList'
import DatePicker from './DatePicker'
import DateTimePicker from './DateTimePicker'
import CarTypeList from './CarTypeList'
import GearboxList from './GearboxList'
import SeatsList from './SeatsList'
import DoorsList from './DoorsList'
import FuelPolicyList from './FuelPolicyList'
import CarRangeList from './CarRangeList'
import { schema as carSchema } from '@/models/CarForm'
import { schema as userSchema } from '@/models/UserForm'
import { schema as bookingSchema } from '@/models/BookingForm'
import { Option } from '@/models/common'

import '@/assets/css/header.css'

type QuickKind = 'car' | 'client' | 'booking' | 'expense' | 'agent' | 'invite'

// GA-Q4-3 (#53) — quick-create "+" menu in the admin top bar.
//
// Six shortcut dialogs (car / client / booking / expense / agent /
// invite) that wrap the EXISTING create handlers — the same services,
// the same payload builders, the same validation and the same permission
// gates as the full create pages / dialogs (CreateCar, CreateUser,
// CreateBooking, Maintenance expense dialog, Agents dialog, Team
// dialog). No new create path: every submit below calls the service
// function the corresponding page calls, with the payload the page
// builds. Full create pages stay as they are.
//
// On success the dialog closes and the user lands on the created record
// (update page for car / client / booking; list page for expense /
// agent / invite, where the new row sits on top — exactly where the
// source page leaves the user). On validation failure the dialog shows
// the same errors the create page shows: the page zod schema for the
// car / client / booking forms, the dialog's own manual checks for
// agent / expense / invite, and the backend's message via helper.error
// in every case.
const extraToNumber = (extra: string) => (extra === '' ? -1 : Number(extra))
const getPrice = (price: string) => (price && Number(price)) || null

const zodFieldErrors = (error: { issues: Array<{ path: Array<string | number | symbol>, message: string }> }): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const issue of error.issues || []) {
    const key = String(issue.path[0] ?? '')
    if (key && !out[key]) {
      out[key] = issue.message || commonStrings.FIELD_NOT_VALID
    }
  }
  return out
}

// Maintenance dialog's server-error detail extractor, verbatim.
const apiErrorMessage = (error: unknown): string => {
  const detail = (error as { response?: { data?: unknown } })?.response?.data
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim()
  }
  if (detail && typeof detail === 'object') {
    const message = (detail as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) {
      return message.trim()
    }
  }
  return ''
}

const agentTypeLabel = (type: bookcarsTypes.AgentType) => (
  type === bookcarsTypes.AgentType.Riad ? agentStrings.TYPE_RIAD
    : type === bookcarsTypes.AgentType.Hotel ? agentStrings.TYPE_HOTEL
      : type === bookcarsTypes.AgentType.Taxi ? agentStrings.TYPE_TAXI
        : type === bookcarsTypes.AgentType.Guide ? agentStrings.TYPE_GUIDE
          : type === bookcarsTypes.AgentType.Agency ? agentStrings.TYPE_AGENCY : agentStrings.TYPE_OTHER
)
const agentModeLabel = (mode: bookcarsTypes.CommissionMode) => (
  mode === bookcarsTypes.CommissionMode.Percent ? agentStrings.MODE_PERCENT
    : mode === bookcarsTypes.CommissionMode.PerDay ? agentStrings.MODE_PER_DAY : agentStrings.MODE_FIXED
)
const teamRoleLabel = (role: bookcarsTypes.AgencyRole) => {
  switch (role) {
    case bookcarsTypes.AgencyRole.Manager: return teamStrings.MANAGER
    case bookcarsTypes.AgencyRole.CounterAgent: return teamStrings.COUNTER_AGENT
    case bookcarsTypes.AgencyRole.Accountant: return teamStrings.ACCOUNTANT
    case bookcarsTypes.AgencyRole.Mechanic: return teamStrings.MECHANIC
    case bookcarsTypes.AgencyRole.ReadOnly: return teamStrings.READ_ONLY
    default: return role
  }
}
const expenseTypeLabel = (type: bookcarsTypes.MaintenanceExpenseType) => {
  switch (type) {
    case bookcarsTypes.MaintenanceExpenseType.Maintenance: return maintenanceStrings.MAINTENANCE
    case bookcarsTypes.MaintenanceExpenseType.Repair: return maintenanceStrings.REPAIR
    case bookcarsTypes.MaintenanceExpenseType.Cleaning: return maintenanceStrings.CLEANING
    case bookcarsTypes.MaintenanceExpenseType.Fuel: return maintenanceStrings.FUEL
    case bookcarsTypes.MaintenanceExpenseType.Insurance: return maintenanceStrings.INSURANCE
    case bookcarsTypes.MaintenanceExpenseType.Oil: return maintenanceStrings.OIL
    case bookcarsTypes.MaintenanceExpenseType.Tyres: return maintenanceStrings.TYRES
    case bookcarsTypes.MaintenanceExpenseType.Battery: return maintenanceStrings.BATTERY
    case bookcarsTypes.MaintenanceExpenseType.Vignette: return maintenanceStrings.VIGNETTE
    case bookcarsTypes.MaintenanceExpenseType.VisiteTechnique: return maintenanceStrings.VISITE_TECHNIQUE
    case bookcarsTypes.MaintenanceExpenseType.AdBlue: return maintenanceStrings.ADBLUE
    case bookcarsTypes.MaintenanceExpenseType.Fines: return maintenanceStrings.FINES
    case bookcarsTypes.MaintenanceExpenseType.LoanPayment: return maintenanceStrings.LOAN_PAYMENT
    case bookcarsTypes.MaintenanceExpenseType.Rent: return maintenanceStrings.RENT
    case bookcarsTypes.MaintenanceExpenseType.Salaries: return maintenanceStrings.SALARIES
    case bookcarsTypes.MaintenanceExpenseType.Agents: return maintenanceStrings.AGENTS
    case bookcarsTypes.MaintenanceExpenseType.Accounting: return maintenanceStrings.ACCOUNTING
    case bookcarsTypes.MaintenanceExpenseType.BankFees: return maintenanceStrings.BANK_FEES
    case bookcarsTypes.MaintenanceExpenseType.Bodywork: return maintenanceStrings.BODYWORK
    case bookcarsTypes.MaintenanceExpenseType.Glass: return maintenanceStrings.GLASS
    case bookcarsTypes.MaintenanceExpenseType.Electrical: return maintenanceStrings.ELECTRICAL
    case bookcarsTypes.MaintenanceExpenseType.AirConditioning: return maintenanceStrings.AIR_CONDITIONING
    case bookcarsTypes.MaintenanceExpenseType.Exhaust: return maintenanceStrings.EXHAUST
    default: return maintenanceStrings.OTHER
  }
}

const numberRegex = /^\d+(\.\d+)?$/

const QuickCreate = () => {
  const navigate = useNavigate()
  const { user } = useUserContext() as UserContextType
  const agencyPermissions = useAgencyPermissions()
  const isAdmin = helper.admin(user)
  const isAgencyOwner = user?.type === bookcarsTypes.UserType.Supplier
  // Agency scope: platform admins pick an agency inside each modal
  // (SupplierSelectList, exactly like CreateBooking / CreateCar);
  // agency owners act for themselves; staff act for their membership
  // agency, which the backend re-scopes server-side anyway.
  const agencyScopeId = isAgencyOwner ? user?._id : agencyPermissions?.supplier || undefined

  // Menu entries follow the Header's own gating pattern (visible while
  // permissions are loading, hidden once loaded without the
  // capability). Invite has no Manage* permission — like the Team page,
  // only platform admins and agency owners may invite (the backend
  // create route requires agency ownership).
  const canCar = !agencyPermissions?.loaded || agencyPermissions.can(AgencyPermission.ManageFleet)
  const canClient = !agencyPermissions?.loaded || agencyPermissions.can(AgencyPermission.ManageClients)
  const canBooking = !agencyPermissions?.loaded || agencyPermissions.can(AgencyPermission.ManageBookings)
  const canExpense = !agencyPermissions?.loaded || agencyPermissions.can(AgencyPermission.ManageExpenses)
  const canAgent = !agencyPermissions?.loaded || agencyPermissions.can(AgencyPermission.ManageAgents)
  const canInvite = isAdmin || isAgencyOwner
  const anyVisible = canCar || canClient || canBooking || canExpense || canAgent || canInvite

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [kind, setKind] = useState<QuickKind | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const language = langHelper.getLanguage()
    langHelper.setLanguage(strings, language)
  }, [])

  const closeAll = () => {
    setKind(null)
    setMenuAnchor(null)
  }

  const openKind = (next: QuickKind) => {
    setMenuAnchor(null)
    setKind(next)
  }

  // ---- car (CreateCar) ----
  const [carImage, setCarImage] = useState('')
  const [carImageError, setCarImageError] = useState(false)
  const [carImageSizeError, setCarImageSizeError] = useState(false)
  const [carImageLoading, setCarImageLoading] = useState(false)
  const [carName, setCarName] = useState('')
  const [carPlate, setCarPlate] = useState('')
  const [carSupplier, setCarSupplier] = useState<Option | undefined>(undefined)
  const [carLocations, setCarLocations] = useState<Option[]>([])
  const [carDailyPrice, setCarDailyPrice] = useState('')
  const [carDeposit, setCarDeposit] = useState('')
  const [carMinimumAge, setCarMinimumAge] = useState(String(env.MINIMUM_AGE))
  const [carType, setCarType] = useState('')
  const [carGearbox, setCarGearbox] = useState('')
  const [carSeats, setCarSeats] = useState('')
  const [carDoors, setCarDoors] = useState('')
  const [carFuelPolicy, setCarFuelPolicy] = useState('')
  const [carRange, setCarRange] = useState('')
  const [carAircon, setCarAircon] = useState(false)
  const [carMileage, setCarMileage] = useState('')
  const [carCancellation, setCarCancellation] = useState('')
  const [carAmendments, setCarAmendments] = useState('')
  const [carTheftProtection, setCarTheftProtection] = useState('')
  const [carCollisionDamageWaiver, setCarCollisionDamageWaiver] = useState('')
  const [carFullInsurance, setCarFullInsurance] = useState('')
  const [carAdditionalDriver, setCarAdditionalDriver] = useState('')
  const [carErrors, setCarErrors] = useState<Record<string, string>>({})

  const resetCar = () => {
    setCarImage('')
    setCarImageError(false)
    setCarImageSizeError(false)
    setCarName('')
    setCarPlate('')
    setCarSupplier(undefined)
    setCarLocations([])
    setCarDailyPrice('')
    setCarDeposit('')
    setCarMinimumAge(String(env.MINIMUM_AGE))
    setCarType('')
    setCarGearbox('')
    setCarSeats('')
    setCarDoors('')
    setCarFuelPolicy('')
    setCarRange('')
    setCarAircon(false)
    setCarMileage('')
    setCarCancellation('')
    setCarAmendments('')
    setCarTheftProtection('')
    setCarCollisionDamageWaiver('')
    setCarFullInsurance('')
    setCarAdditionalDriver('')
    setCarErrors({})
  }

  const submitCar = async () => {
    // The page's own required checks (RHF `required` + the image /
    // supplier guards in onSubmit), then the page zod schema — the same
    // validation the full form runs, so the same errors surface.
    const errors: Record<string, string> = {}
    if (isAdmin && !carSupplier?._id) {
      errors.supplier = commonStrings.REQUIRED
    }
    if (!carImage) {
      setCarImageError(true)
      setCarImageSizeError(false)
      errors.image = commonStrings.REQUIRED
    }
    if (!carName.trim()) {
      errors.name = commonStrings.REQUIRED
    }
    if (carLocations.length === 0) {
      errors.locations = commonStrings.REQUIRED
    }
    if (!carDailyPrice || !numberRegex.test(carDailyPrice)) {
      errors.dailyPrice = commonStrings.FIELD_NOT_VALID
    }
    if (!carDeposit || !numberRegex.test(carDeposit)) {
      errors.deposit = commonStrings.FIELD_NOT_VALID
    }
    if (!carType) {
      errors.type = commonStrings.REQUIRED
    }
    if (!carGearbox) {
      errors.gearbox = commonStrings.REQUIRED
    }
    if (!carSeats) {
      errors.seats = commonStrings.REQUIRED
    }
    if (!carDoors) {
      errors.doors = commonStrings.REQUIRED
    }
    if (!carFuelPolicy) {
      errors.fuelPolicy = commonStrings.REQUIRED
    }
    if (!carRange) {
      errors.range = commonStrings.REQUIRED
    }
    const parsed = carSchema.safeParse({
      name: carName,
      licensePlate: carPlate,
      supplier: carSupplier,
      minimumAge: carMinimumAge,
      locations: carLocations,
      dailyPrice: carDailyPrice,
      discountedDailyPrice: '',
      hourlyPrice: '',
      discountedHourlyPrice: '',
      biWeeklyPrice: '',
      discountedBiWeeklyPrice: '',
      weeklyPrice: '',
      discountedWeeklyPrice: '',
      monthlyPrice: '',
      discountedMonthlyPrice: '',
      deposit: carDeposit,
      available: true,
      fullyBooked: false,
      comingSoon: false,
      operationalStatus: bookcarsTypes.CarOperationalStatus.InService,
      blockOnPay: true,
      type: carType,
      gearbox: carGearbox,
      seats: carSeats,
      doors: carDoors,
      aircon: carAircon,
      mileage: carMileage,
      fuelPolicy: carFuelPolicy,
      cancellation: carCancellation,
      amendments: carAmendments,
      theftProtection: carTheftProtection,
      collisionDamageWaiver: carCollisionDamageWaiver,
      fullInsurance: carFullInsurance,
      additionalDriver: carAdditionalDriver,
      range: carRange,
      multimedia: [],
      rating: '',
      co2: '',
      tankCapacityLitres: '',
      isDateBasedPrice: false,
      dateBasedPrices: [],
    })
    if (!parsed.success) {
      Object.assign(errors, zodFieldErrors(parsed.error))
    }
    setCarErrors(errors)
    if (Object.keys(errors).length > 0) {
      return
    }

    // The page's own license-plate duplicate guard, before the create.
    if (carPlate) {
      const res = await CarService.validateLicensePlate(carPlate)
      if (res === 204) {
        helper.error(null, carStrings.LICENSE_PLATE_ALREADY_EXISTS)
        return
      }
    }

    // The payload is built exactly like CreateCar.onSubmit — same
    // defaults, same empty-means--1 option encoding.
    const supplierId = isAdmin ? carSupplier?._id : agencyScopeId
    const payload: bookcarsTypes.CreateCarPayload = {
      loggedUser: user!._id!,
      name: carName,
      licensePlate: carPlate || '',
      supplier: supplierId!,
      minimumAge: Number.parseInt(carMinimumAge, 10),
      locations: carLocations.map((l) => l._id),
      dailyPrice: Number(carDailyPrice),
      discountedDailyPrice: getPrice(''),
      hourlyPrice: getPrice(''),
      discountedHourlyPrice: getPrice(''),
      biWeeklyPrice: getPrice(''),
      discountedBiWeeklyPrice: getPrice(''),
      weeklyPrice: getPrice(''),
      discountedWeeklyPrice: getPrice(''),
      monthlyPrice: getPrice(''),
      discountedMonthlyPrice: getPrice(''),
      deposit: Number(carDeposit),
      available: true,
      operationalStatus: bookcarsTypes.CarOperationalStatus.InService,
      fullyBooked: false,
      comingSoon: false,
      blockOnPay: true,
      type: carType,
      gearbox: carGearbox,
      aircon: carAircon,
      image: carImage,
      seats: Number.parseInt(carSeats, 10),
      doors: Number.parseInt(carDoors, 10),
      fuelPolicy: carFuelPolicy,
      mileage: extraToNumber(carMileage),
      cancellation: extraToNumber(carCancellation),
      amendments: extraToNumber(carAmendments),
      theftProtection: extraToNumber(carTheftProtection),
      collisionDamageWaiver: extraToNumber(carCollisionDamageWaiver),
      fullInsurance: extraToNumber(carFullInsurance),
      additionalDriver: extraToNumber(carAdditionalDriver),
      range: carRange,
      multimedia: [],
      isDateBasedPrice: false,
      dateBasedPrices: [],
    }

    setSaving(true)
    try {
      const car = await CarService.create(payload)
      if (car && car._id) {
        resetCar()
        closeAll()
        navigate(`/update-car?cr=${car._id}`)
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    } finally {
      setSaving(false)
    }
  }

  // ---- client (CreateUser, client flow) ----
  const [clientFullName, setClientFullName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientBirthDate, setClientBirthDate] = useState<Date | undefined>(undefined)
  const [clientCin, setClientCin] = useState('')
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
  const [clientFormError, setClientFormError] = useState(false)

  const resetClient = () => {
    setClientFullName('')
    setClientEmail('')
    setClientPhone('')
    setClientBirthDate(undefined)
    setClientCin('')
    setClientErrors({})
    setClientFormError(false)
  }

  const submitClient = async () => {
    if (!user) {
      helper.error()
      return
    }
    // The page zod schema (UserForm) is the validation the full form
    // runs; birth date is additionally required here because the page
    // marks it required for drivers.
    const parsed = userSchema.safeParse({
      fullName: clientFullName,
      email: clientEmail,
      phone: clientPhone,
      type: bookcarsTypes.UserType.User,
      birthDate: clientBirthDate,
      cinNumber: clientCin,
    })
    const errors: Record<string, string> = parsed.success ? {} : zodFieldErrors(parsed.error)
    if (!clientFullName.trim()) {
      errors.fullName = commonStrings.REQUIRED
    }
    if (!clientEmail.trim()) {
      errors.email = commonStrings.REQUIRED
    }
    if (!clientBirthDate) {
      errors.birthDate = commonStrings.REQUIRED
    }
    setClientErrors(errors)
    if (Object.keys(errors).length > 0) {
      return
    }

    // The payload is built like CreateUser.onSubmit for a client. One
    // deliberate alignment: the page sends `supplier: user._id` for every
    // non-admin caller, which the backend refuses for staff (a staff id
    // is not the agency id — 403 'cannot assign users to another
    // supplier'); the modal sends the caller's agency id instead, which
    // is the same value for agency owners and the backend-accepted value
    // for staff. Platform admins send no supplier, like the page.
    const payload: bookcarsTypes.CreateUserPayload = {
      email: clientEmail,
      phone: clientPhone || '',
      location: '',
      bio: '',
      fullName: clientFullName,
      type: bookcarsTypes.UserType.User,
      avatar: undefined,
      birthDate: clientBirthDate,
      language: UserService.getLanguage(),
      supplier: isAdmin ? undefined : agencyScopeId,
      license: undefined,
      cinNumber: clientCin || undefined,
    }

    setSaving(true)
    try {
      const formStatus = await UserService.create(payload)
      if (formStatus === 200) {
        resetClient()
        closeAll()
        // UserService.create returns a status, not the created record,
        // so — like the page — the user lands on the clients list.
        navigate('/clients')
      } else {
        setClientFormError(true)
      }
    } catch (err) {
      helper.error(err)
    } finally {
      setSaving(false)
    }
  }

  // ---- booking (CreateBooking) ----
  const [bookingSupplier, setBookingSupplier] = useState<Option | undefined>(undefined)
  const [bookingDriver, setBookingDriver] = useState<Option | undefined>(undefined)
  const [bookingPickup, setBookingPickup] = useState<Option | undefined>(undefined)
  const [bookingDropOff, setBookingDropOff] = useState<Option | undefined>(undefined)
  const [bookingCar, setBookingCar] = useState<bookcarsTypes.Car | undefined>(undefined)
  const [bookingFrom, setBookingFrom] = useState<Date | undefined>(undefined)
  const [bookingTo, setBookingTo] = useState<Date | undefined>(undefined)
  const [bookingFromError, setBookingFromError] = useState(false)
  const [bookingToError, setBookingToError] = useState(false)
  const [bookingStatus, setBookingStatus] = useState<bookcarsTypes.BookingStatus | undefined>(undefined)
  const [bookingMinDate, setBookingMinDate] = useState<Date | undefined>(undefined)
  const [bookingErrors, setBookingErrors] = useState<Record<string, string>>({})

  const resetBooking = () => {
    setBookingSupplier(undefined)
    setBookingDriver(undefined)
    setBookingPickup(undefined)
    setBookingDropOff(undefined)
    setBookingCar(undefined)
    setBookingFrom(undefined)
    setBookingTo(undefined)
    setBookingFromError(false)
    setBookingToError(false)
    setBookingStatus(undefined)
    setBookingMinDate(undefined)
    setBookingErrors({})
  }

  useEffect(() => {
    if (bookingFrom) {
      const minDate = new Date(bookingFrom)
      minDate.setDate(minDate.getDate() + 1)
      setBookingMinDate(minDate)
    } else {
      setBookingMinDate(undefined)
    }
  }, [bookingFrom])

  const submitBooking = async () => {
    if (!bookingCar || bookingFromError || bookingToError) {
      helper.error()
      return
    }
    // The page zod schema (BookingForm) plus the page's own required
    // checks — the same validation the full form runs.
    const parsed = bookingSchema.safeParse({
      supplier: bookingSupplier,
      driver: bookingDriver,
      pickupLocation: bookingPickup,
      dropOffLocation: bookingDropOff,
      car: bookingCar ? { _id: bookingCar._id, name: bookingCar.name } : undefined,
      from: bookingFrom,
      to: bookingTo,
      status: bookingStatus,
      cancellation: false,
      amendments: false,
      theftProtection: false,
      collisionDamageWaiver: false,
      fullInsurance: false,
      additionalDriver: false,
      additionalDriverFullName: '',
      additionalDriverEmail: '',
      additionalDriverPhone: '',
    })
    const errors: Record<string, string> = parsed.success ? {} : zodFieldErrors(parsed.error)
    if (isAdmin && !bookingSupplier?._id) {
      errors.supplier = commonStrings.REQUIRED
    }
    if (!bookingDriver) {
      errors.driver = commonStrings.REQUIRED
    }
    if (!bookingPickup) {
      errors.pickupLocation = commonStrings.REQUIRED
    }
    if (!bookingDropOff) {
      errors.dropOffLocation = commonStrings.REQUIRED
    }
    if (!bookingCar) {
      errors.car = commonStrings.REQUIRED
    }
    if (!bookingFrom) {
      errors.from = commonStrings.REQUIRED
    }
    if (!bookingTo) {
      errors.to = commonStrings.REQUIRED
    }
    if (!bookingStatus) {
      errors.status = commonStrings.REQUIRED
    }
    setBookingErrors(errors)
    if (Object.keys(errors).length > 0) {
      return
    }

    // The payload is built like CreateBooking.onSubmit — same fields,
    // same price computation, no agent (the page sends none unless the
    // operator picks one) and no additional driver.
    const supplierId = isAdmin ? bookingSupplier?._id : agencyScopeId
    const booking: bookcarsTypes.Booking = {
      supplier: supplierId!,
      car: bookingCar!._id,
      driver: bookingDriver!._id,
      pickupLocation: bookingPickup!._id,
      dropOffLocation: bookingDropOff!._id,
      from: bookingFrom!,
      to: bookingTo!,
      status: bookingStatus as bookcarsTypes.BookingStatus,
      cancellation: false,
      amendments: false,
      theftProtection: false,
      collisionDamageWaiver: false,
      fullInsurance: false,
      additionalDriver: false,
    }
    const options: bookcarsTypes.CarOptions = {
      cancellation: false,
      amendments: false,
      theftProtection: false,
      collisionDamageWaiver: false,
      fullInsurance: false,
      additionalDriver: false,
    }

    setSaving(true)
    try {
      const price = await bookcarsHelper.calculateTotalPrice(
        bookingCar!,
        bookingFrom!,
        bookingTo!,
        (bookingCar!.supplier as bookcarsTypes.User)?.priceChangeRate || 0,
        options,
      )
      booking.price = price
      const created = await BookingService.create({ booking, additionalDriver: undefined })
      if (created && created._id) {
        resetBooking()
        closeAll()
        navigate(`/update-booking?b=${created._id}`)
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    } finally {
      setSaving(false)
    }
  }

  // ---- expense (Maintenance expense dialog) ----
  const [expenseCars, setExpenseCars] = useState<bookcarsTypes.Car[]>([])
  const [expenseCar, setExpenseCar] = useState('')
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10))
  const [expenseType, setExpenseType] = useState<bookcarsTypes.MaintenanceExpenseType>(bookcarsTypes.MaintenanceExpenseType.Maintenance)
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expensePaidAmount, setExpensePaidAmount] = useState('')
  const [expenseMileage, setExpenseMileage] = useState('')
  const [expenseVendor, setExpenseVendor] = useState('')
  const [expenseNote, setExpenseNote] = useState('')
  const [expenseReceiptFile, setExpenseReceiptFile] = useState<File | null>(null)
  const [expenseFormError, setExpenseFormError] = useState(false)
  const [expenseFormErrorMessage, setExpenseFormErrorMessage] = useState('')

  const resetExpense = () => {
    setExpenseCar('')
    setExpenseDate(new Date().toISOString().slice(0, 10))
    setExpenseType(bookcarsTypes.MaintenanceExpenseType.Maintenance)
    setExpenseAmount('')
    setExpensePaidAmount('')
    setExpenseMileage('')
    setExpenseVendor('')
    setExpenseNote('')
    setExpenseReceiptFile(null)
    setExpenseFormError(false)
    setExpenseFormErrorMessage('')
  }

  // The Maintenance page's own car list (same supplier scope, same
  // page size), loaded when the expense dialog opens.
  useEffect(() => {
    if (kind !== 'expense') {
      return undefined
    }
    let cancelled = false
    const loadCars = async () => {
      try {
        const supplierIds = isAdmin
          ? bookcarsHelper.flattenSuppliers(await SupplierService.getAllSuppliers())
          : [user?._id || '']
        const carResult = await CarService.getCars('', { suppliers: supplierIds, includeAlreadyBookedCars: true, includeComingSoonCars: true }, 1, 1000)
        if (!cancelled) {
          setExpenseCars(carResult?.[0]?.resultData || [])
        }
      } catch {
        if (!cancelled) {
          setExpenseCars([])
        }
      }
    }
    void loadCars()
    return () => {
      cancelled = true
    }
  }, [kind, isAdmin, user?._id])

  const submitExpense = async () => {
    // The Maintenance dialog's own checks, verbatim.
    const amount = Number(expenseAmount)
    const mileage = expenseMileage.trim() ? Number(expenseMileage) : undefined
    const paidAmount = expensePaidAmount.trim() ? Number(expensePaidAmount) : null
    if (!expenseDate || !Number.isFinite(amount) || amount <= 0
      || (paidAmount !== null && (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > amount))
      || (mileage !== undefined && (!Number.isFinite(mileage) || mileage < 0))) {
      setExpenseFormError(true)
      return
    }

    setSaving(true)
    setExpenseFormError(false)
    try {
      let receipt: string | undefined
      if (expenseReceiptFile) {
        receipt = (await MaintenanceExpenseService.uploadReceipt(expenseReceiptFile)).filename
      }
      const payload: bookcarsTypes.UpsertMaintenanceExpensePayload = {
        car: expenseCar || undefined,
        date: new Date(`${expenseDate}T12:00:00`),
        type: expenseType,
        amount,
        paidAmount,
        mileage,
        vendor: expenseVendor.trim(),
        note: expenseNote.trim(),
        receipt,
      }
      const created = await MaintenanceExpenseService.create(payload)
      if (created && created._id) {
        resetExpense()
        closeAll()
        navigate('/maintenance')
      } else {
        helper.error()
      }
    } catch (error) {
      const detail = apiErrorMessage(error)
      helper.error(error, detail || undefined)
      setExpenseFormError(true)
      setExpenseFormErrorMessage(detail)
    } finally {
      setSaving(false)
    }
  }

  // ---- agent (Agents dialog) ----
  const [agentName, setAgentName] = useState('')
  const [agentPhone, setAgentPhone] = useState('')
  const [agentType, setAgentType] = useState<bookcarsTypes.AgentType>(bookcarsTypes.AgentType.Other)
  const [agentMode, setAgentMode] = useState<bookcarsTypes.CommissionMode>(bookcarsTypes.CommissionMode.Percent)
  const [agentValue, setAgentValue] = useState('')
  const [agentActive, setAgentActive] = useState(true)
  const [agentNotes, setAgentNotes] = useState('')
  const [agentSupplier, setAgentSupplier] = useState<Option | undefined>(undefined)
  const [agentActionError, setAgentActionError] = useState('')

  const resetAgent = () => {
    setAgentName('')
    setAgentPhone('')
    setAgentType(bookcarsTypes.AgentType.Other)
    setAgentMode(bookcarsTypes.CommissionMode.Percent)
    setAgentValue('')
    setAgentActive(true)
    setAgentNotes('')
    setAgentSupplier(undefined)
    setAgentActionError('')
  }

  const submitAgent = async () => {
    // The Agents dialog's payload, verbatim. One alignment: the page
    // sends `supplier: supplierScope`, which is undefined for a platform
    // admin — and the backend refuses an admin create without a supplier
    // (400 'Invalid agent'). The modal lets an admin pick the agency
    // (SupplierSelectList, like the car / booking modals); agency
    // callers send their own scope, exactly like the page.
    const supplierId = isAdmin ? agentSupplier?._id : agencyScopeId
    const payload: bookcarsTypes.CreateAgentPayload = {
      supplier: supplierId,
      name: agentName.trim(),
      phone: agentPhone.trim() || undefined,
      type: agentType,
      commissionMode: agentMode,
      commissionValue: Number(agentValue),
      active: agentActive,
      notes: agentNotes.trim() || undefined,
    }
    setSaving(true)
    setAgentActionError('')
    try {
      const created = await AgentService.create(payload)
      if (created && created._id) {
        resetAgent()
        closeAll()
        navigate('/agents')
      } else {
        helper.error()
      }
    } catch (err) {
      setAgentActionError(helper.getErrorMessage(err, agentStrings.ACTION_ERROR))
    } finally {
      setSaving(false)
    }
  }

  // ---- invite (Team dialog: create a staff account + membership) ----
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteRole, setInviteRole] = useState<bookcarsTypes.AgencyRole>(bookcarsTypes.AgencyRole.CounterAgent)
  const [inviteSupplier, setInviteSupplier] = useState<Option | undefined>(undefined)
  const [inviteFormError, setInviteFormError] = useState(false)

  const resetInvite = () => {
    setInviteFullName('')
    setInviteEmail('')
    setInvitePassword('')
    setInviteRole(bookcarsTypes.AgencyRole.CounterAgent)
    setInviteSupplier(undefined)
    setInviteFormError(false)
  }

  const submitInvite = async () => {
    // The Team dialog's own checks, verbatim.
    if (!inviteEmail || !inviteFullName || !invitePassword || !inviteRole) {
      setInviteFormError(true)
      return
    }
    const supplierId = isAdmin ? inviteSupplier?._id : agencyScopeId
    if (!supplierId) {
      setInviteFormError(true)
      return
    }
    setSaving(true)
    setInviteFormError(false)
    try {
      await AgencyMembershipService.create(supplierId, {
        email: inviteEmail.trim().toLowerCase(),
        fullName: inviteFullName.trim(),
        password: invitePassword,
        role: inviteRole,
      })
      resetInvite()
      closeAll()
      navigate('/team')
    } catch (error) {
      helper.error(error, teamStrings.CREATE_ERROR)
      setInviteFormError(true)
    } finally {
      setSaving(false)
    }
  }

  if (!anyVisible) {
    return null
  }

  return (
    <div className="quick-create">
      <IconButton
        aria-label={strings.MENU_TITLE}
        aria-controls="quick-create-menu"
        aria-haspopup="true"
        onClick={(event) => setMenuAnchor(event.currentTarget)}
        color="inherit"
      >
        <AddRoundedIcon />
      </IconButton>
      <Menu
        id="quick-create-menu"
        anchorEl={menuAnchor}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        keepMounted
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        className="menu"
      >
        {canCar && (
          <MenuItem onClick={() => { resetCar(); openKind('car') }}>
            <CarsIcon className="header-action" />
            {carStrings.NEW_CAR_HEADING}
          </MenuItem>
        )}
        {canClient && (
          <MenuItem onClick={() => { resetClient(); openKind('client') }}>
            <UsersIcon className="header-action" />
            {createUserStrings.CREATE_CLIENT_HEADING}
          </MenuItem>
        )}
        {canBooking && (
          <MenuItem onClick={() => { resetBooking(); openKind('booking') }}>
            <BookingsIcon className="header-action" />
            {createBookingStrings.NEW_BOOKING_HEADING}
          </MenuItem>
        )}
        {canExpense && (
          <MenuItem onClick={() => { resetExpense(); openKind('expense') }}>
            <MaintenanceIcon className="header-action" />
            {maintenanceStrings.NEW}
          </MenuItem>
        )}
        {canAgent && (
          <MenuItem onClick={() => { resetAgent(); openKind('agent') }}>
            <AgentsIcon className="header-action" />
            {agentStrings.CREATE}
          </MenuItem>
        )}
        {canInvite && (
          <MenuItem onClick={() => { resetInvite(); openKind('invite') }}>
            <TeamIcon className="header-action" />
            {teamStrings.ADD_MEMBER}
          </MenuItem>
        )}
      </Menu>

      {/* ---- car ---- */}
      <Dialog open={kind === 'car'} onClose={() => !saving && !carImageLoading && closeAll()} fullWidth maxWidth="sm">
        <DialogTitle>{carStrings.NEW_CAR_HEADING}</DialogTitle>
        <DialogContent className="quick-create__form">
          <Avatar
            type={bookcarsTypes.RecordType.Car}
            mode="create"
            record={null}
            size="large"
            readonly={false}
            onBeforeUpload={() => setCarImageLoading(true)}
            onChange={(_image: bookcarsTypes.Car | string | null) => {
              setCarImageLoading(false)
              setCarImage(_image as string)
              if (_image !== null) {
                setCarImageError(false)
              }
            }}
            onValidate={(valid: boolean) => {
              if (!valid) {
                setCarImageSizeError(true)
                setCarImageError(false)
                setCarImageLoading(false)
              } else {
                setCarImageSizeError(false)
                setCarImageError(false)
              }
            }}
            color="disabled"
            className="avatar-ctn"
          />
          {carImageError && <Alert severity="error">{commonStrings.REQUIRED}</Alert>}
          {carImageSizeError && <Alert severity="error">{carStrings.CAR_IMAGE_SIZE_ERROR}</Alert>}
          {isAdmin && (
            <FormControl fullWidth margin="dense">
              <SupplierSelectList
                label={blStrings.SUPPLIER}
                required
                variant="standard"
                onChange={(values) => setCarSupplier(values.length > 0 ? values[0] as Option : undefined)}
              />
              {carErrors.supplier && <FormHelperText error>{carErrors.supplier}</FormHelperText>}
            </FormControl>
          )}
          <TextField fullWidth required label={carStrings.NAME} value={carName} onChange={(e) => setCarName(e.target.value)} error={!!carErrors.name} helperText={carErrors.name || ''} />
          <TextField fullWidth label={carStrings.LICENSE_PLATE} value={carPlate} onChange={(e) => setCarPlate(e.target.value)} />
          <FormControl fullWidth margin="dense">
            <LocationSelectList
              label={carStrings.LOCATIONS}
              multiple
              required
              variant="standard"
              onChange={(values) => setCarLocations(values as Option[])}
            />
            {carErrors.locations && <FormHelperText error>{carErrors.locations}</FormHelperText>}
          </FormControl>
          <TextField fullWidth required type="number" label={carStrings.DAILY_PRICE} value={carDailyPrice} onChange={(e) => setCarDailyPrice(e.target.value)} error={!!carErrors.dailyPrice} helperText={carErrors.dailyPrice || ''} inputProps={{ min: 0, step: 'any' }} />
          <TextField fullWidth required type="number" label={csStrings.DEPOSIT} value={carDeposit} onChange={(e) => setCarDeposit(e.target.value)} error={!!carErrors.deposit} helperText={carErrors.deposit || ''} inputProps={{ min: 0, step: 'any' }} />
          <TextField fullWidth label={carStrings.MINIMUM_AGE} value={carMinimumAge} onChange={(e) => setCarMinimumAge(e.target.value)} error={!!carErrors.minimumAge} helperText={carErrors.minimumAge || ''} />
          <FormControl fullWidth margin="dense">
            <CarTypeList label={carStrings.CAR_TYPE} variant="standard" required value={carType} onChange={(value) => setCarType(value)} />
            {carErrors.type && <FormHelperText error>{carErrors.type}</FormHelperText>}
          </FormControl>
          <FormControl fullWidth margin="dense">
            <GearboxList label={carStrings.GEARBOX} variant="standard" required value={carGearbox} onChange={(value) => setCarGearbox(value)} />
            {carErrors.gearbox && <FormHelperText error>{carErrors.gearbox}</FormHelperText>}
          </FormControl>
          <FormControl fullWidth margin="dense">
            <SeatsList label={carStrings.SEATS} variant="standard" required value={carSeats} onChange={(value) => setCarSeats(value.toString())} />
            {carErrors.seats && <FormHelperText error>{carErrors.seats}</FormHelperText>}
          </FormControl>
          <FormControl fullWidth margin="dense">
            <DoorsList label={carStrings.DOORS} variant="standard" required value={carDoors} onChange={(value) => setCarDoors(value.toString())} />
            {carErrors.doors && <FormHelperText error>{carErrors.doors}</FormHelperText>}
          </FormControl>
          <FormControl fullWidth margin="dense">
            <FuelPolicyList label={csStrings.FUEL_POLICY} variant="standard" required value={carFuelPolicy} onChange={(value) => setCarFuelPolicy(value)} />
            {carErrors.fuelPolicy && <FormHelperText error>{carErrors.fuelPolicy}</FormHelperText>}
          </FormControl>
          <FormControl fullWidth margin="dense">
            <CarRangeList label={carStrings.CAR_RANGE} variant="standard" required value={carRange} onChange={(value) => setCarRange(value)} />
            {carErrors.range && <FormHelperText error>{carErrors.range}</FormHelperText>}
          </FormControl>
          <FormControlLabel control={<Switch checked={carAircon} onChange={(e) => setCarAircon(e.target.checked)} />} label={carStrings.AIRCON} />
          <TextField fullWidth type="number" label={`${csStrings.MILEAGE} (${csStrings.MILEAGE_UNIT})`} value={carMileage} onChange={(e) => setCarMileage(e.target.value)} error={!!carErrors.mileage} helperText={carErrors.mileage || ''} inputProps={{ min: -1, step: 'any' }} />
          <TextField fullWidth type="number" label={`${csStrings.CANCELLATION} (${commonStrings.CURRENCY})`} value={carCancellation} onChange={(e) => setCarCancellation(e.target.value)} error={!!carErrors.cancellation} helperText={carErrors.cancellation || ''} inputProps={{ min: 0, step: 'any' }} />
          <TextField fullWidth type="number" label={`${csStrings.AMENDMENTS} (${commonStrings.CURRENCY})`} value={carAmendments} onChange={(e) => setCarAmendments(e.target.value)} error={!!carErrors.amendments} helperText={carErrors.amendments || ''} inputProps={{ min: 0, step: 'any' }} />
          <TextField fullWidth type="number" label={`${csStrings.THEFT_PROTECTION} (${csStrings.CAR_CURRENCY})`} value={carTheftProtection} onChange={(e) => setCarTheftProtection(e.target.value)} error={!!carErrors.theftProtection} helperText={carErrors.theftProtection || ''} inputProps={{ min: 0, step: 'any' }} />
          <TextField fullWidth type="number" label={`${csStrings.COLLISION_DAMAGE_WAIVER} (${csStrings.CAR_CURRENCY})`} value={carCollisionDamageWaiver} onChange={(e) => setCarCollisionDamageWaiver(e.target.value)} error={!!carErrors.collisionDamageWaiver} helperText={carErrors.collisionDamageWaiver || ''} inputProps={{ min: 0, step: 'any' }} />
          <TextField fullWidth type="number" label={`${csStrings.FULL_INSURANCE} (${csStrings.CAR_CURRENCY})`} value={carFullInsurance} onChange={(e) => setCarFullInsurance(e.target.value)} error={!!carErrors.fullInsurance} helperText={carErrors.fullInsurance || ''} inputProps={{ min: 0, step: 'any' }} />
          <TextField fullWidth type="number" label={`${csStrings.ADDITIONAL_DRIVER} (${csStrings.CAR_CURRENCY})`} value={carAdditionalDriver} onChange={(e) => setCarAdditionalDriver(e.target.value)} error={!!carErrors.additionalDriver} helperText={carErrors.additionalDriver || ''} inputProps={{ min: 0, step: 'any' }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAll} disabled={saving || carImageLoading}>{commonStrings.CANCEL}</Button>
          <Button variant="contained" onClick={submitCar} disabled={saving || carImageLoading}>{commonStrings.CREATE}</Button>
        </DialogActions>
      </Dialog>

      {/* ---- client ---- */}
      <Dialog open={kind === 'client'} onClose={() => !saving && closeAll()} fullWidth maxWidth="sm">
        <DialogTitle>{createUserStrings.CREATE_CLIENT_HEADING}</DialogTitle>
        <DialogContent className="quick-create__form">
          {clientFormError && <Alert severity="error">{commonStrings.GENERIC_ERROR}</Alert>}
          <TextField fullWidth required label={commonStrings.FULL_NAME} value={clientFullName} onChange={(e) => setClientFullName(e.target.value)} error={!!clientErrors.fullName} helperText={clientErrors.fullName || ''} />
          <TextField fullWidth required type="email" label={commonStrings.EMAIL} value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} error={!!clientErrors.email} helperText={clientErrors.email || ''} />
          <TextField fullWidth label={commonStrings.PHONE} value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} error={!!clientErrors.phone} helperText={clientErrors.phone || ''} />
          <FormControl fullWidth margin="dense">
            <DatePicker
              label={commonStrings.BIRTH_DATE}
              variant="standard"
              required
              onChange={(birthDate) => {
                if (birthDate) {
                  setClientBirthDate(birthDate)
                }
              }}
              language={UserService.getLanguage()}
            />
            {clientErrors.birthDate && <FormHelperText error>{clientErrors.birthDate}</FormHelperText>}
          </FormControl>
          <TextField fullWidth label={commonStrings.CIN_NUMBER} value={clientCin} onChange={(e) => setClientCin(e.target.value)} error={!!clientErrors.cinNumber} helperText={clientErrors.cinNumber || ''} />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAll} disabled={saving}>{commonStrings.CANCEL}</Button>
          <Button variant="contained" onClick={submitClient} disabled={saving}>{commonStrings.CREATE}</Button>
        </DialogActions>
      </Dialog>

      {/* ---- booking ---- */}
      <Dialog open={kind === 'booking'} onClose={() => !saving && closeAll()} fullWidth maxWidth="sm">
        <DialogTitle>{createBookingStrings.NEW_BOOKING_HEADING}</DialogTitle>
        <DialogContent className="quick-create__form">
          {isAdmin && (
            <FormControl fullWidth margin="dense">
              <SupplierSelectList
                label={blStrings.SUPPLIER}
                required
                variant="standard"
                onChange={(values) => setBookingSupplier(values.length > 0 ? values[0] as Option : undefined)}
              />
              {bookingErrors.supplier && <FormHelperText error>{bookingErrors.supplier}</FormHelperText>}
            </FormControl>
          )}
          <UserSelectList
            label={blStrings.DRIVER}
            required
            variant="standard"
            onChange={(values) => setBookingDriver(values.length > 0 ? values[0] as Option : undefined)}
          />
          {bookingErrors.driver && <FormHelperText error>{bookingErrors.driver}</FormHelperText>}
          <FormControl fullWidth margin="dense">
            <LocationSelectList
              label={bfStrings.PICK_UP_LOCATION}
              required
              variant="standard"
              onChange={(values) => setBookingPickup(values.length > 0 ? values[0] as Option : undefined)}
            />
            {bookingErrors.pickupLocation && <FormHelperText error>{bookingErrors.pickupLocation}</FormHelperText>}
          </FormControl>
          <FormControl fullWidth margin="dense">
            <LocationSelectList
              label={bfStrings.DROP_OFF_LOCATION}
              required
              variant="standard"
              onChange={(values) => setBookingDropOff(values.length > 0 ? values[0] as Option : undefined)}
            />
            {bookingErrors.dropOffLocation && <FormHelperText error>{bookingErrors.dropOffLocation}</FormHelperText>}
          </FormControl>
          <CarSelectList
            label={blStrings.CAR}
            supplier={(isAdmin ? bookingSupplier?._id : isAgencyOwner ? user?._id : undefined)!}
            pickupLocation={bookingPickup?._id!}
            onChange={(values) => {
              const car = values.length > 0 ? values[0] as bookcarsTypes.Car : undefined
              setBookingCar(car)
            }}
            required
          />
          {bookingErrors.car && <FormHelperText error>{bookingErrors.car}</FormHelperText>}
          <FormControl fullWidth margin="dense">
            <DateTimePicker
              label={commonStrings.FROM}
              value={bookingFrom}
              showClear
              required
              onChange={(date) => {
                setBookingFrom(date || undefined)
                if (date && bookingTo && date > bookingTo) {
                  setBookingTo(undefined)
                }
              }}
              onError={(err: DateTimeValidationError) => {
                setBookingFromError(!!err)
              }}
              language={UserService.getLanguage()}
            />
            {bookingErrors.from && <FormHelperText error>{bookingErrors.from}</FormHelperText>}
          </FormControl>
          <FormControl fullWidth margin="dense">
            <DateTimePicker
              label={commonStrings.TO}
              value={bookingTo}
              minDate={bookingMinDate}
              showClear
              required
              onChange={(date) => {
                setBookingTo(date || undefined)
              }}
              onError={(err: DateTimeValidationError) => {
                setBookingToError(!!err)
              }}
              language={UserService.getLanguage()}
            />
            {bookingErrors.to && <FormHelperText error>{bookingErrors.to}</FormHelperText>}
          </FormControl>
          <FormControl fullWidth margin="dense">
            <StatusList
              disablePaymentStatuses
              label={blStrings.STATUS}
              onChange={(value) => {
                setBookingStatus(value)
              }}
              required
            />
            {bookingErrors.status && <FormHelperText error>{bookingErrors.status}</FormHelperText>}
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAll} disabled={saving}>{commonStrings.CANCEL}</Button>
          <Button variant="contained" onClick={submitBooking} disabled={saving}>{commonStrings.CREATE}</Button>
        </DialogActions>
      </Dialog>

      {/* ---- expense ---- */}
      <Dialog open={kind === 'expense'} onClose={() => !saving && closeAll()} fullWidth maxWidth="sm">
        <DialogTitle>{maintenanceStrings.NEW}</DialogTitle>
        <DialogContent className="quick-create__form">
          {expenseFormError && <Alert severity="error">{expenseFormErrorMessage || maintenanceStrings.SAVE_ERROR}</Alert>}
          <TextField select fullWidth label={maintenanceStrings.VEHICLE} value={expenseCar} onChange={(e) => setExpenseCar(e.target.value)}>
            <MenuItem value="">{maintenanceStrings.GENERAL_EXPENSE}</MenuItem>
            {expenseCars.map((car) => <MenuItem value={car._id} key={car._id}>{car.name}{car.licensePlate ? ` · ${car.licensePlate}` : ''}</MenuItem>)}
          </TextField>
          <TextField select fullWidth required label={maintenanceStrings.TYPE} value={expenseType} onChange={(e) => setExpenseType(e.target.value as bookcarsTypes.MaintenanceExpenseType)}>
            {Object.values(bookcarsTypes.MaintenanceExpenseType).map((type) => <MenuItem value={type} key={type}>{expenseTypeLabel(type)}</MenuItem>)}
          </TextField>
          <TextField fullWidth required type="date" label={maintenanceStrings.DATE} value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField fullWidth required type="number" label={maintenanceStrings.AMOUNT} value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} inputProps={{ min: 0.01, step: 0.01 }} />
          <TextField fullWidth type="number" label={maintenanceStrings.PAID_AMOUNT} value={expensePaidAmount} onChange={(e) => setExpensePaidAmount(e.target.value)} inputProps={{ min: 0, step: 0.01 }} />
          <TextField fullWidth type="number" label={maintenanceStrings.MILEAGE} value={expenseMileage} onChange={(e) => setExpenseMileage(e.target.value)} inputProps={{ min: 0, step: 1 }} />
          <TextField fullWidth label={maintenanceStrings.VENDOR} value={expenseVendor} onChange={(e) => setExpenseVendor(e.target.value)} inputProps={{ maxLength: 160 }} />
          <input aria-label={maintenanceStrings.RECEIPT} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setExpenseReceiptFile(event.target.files?.[0] || null)} />
          <TextField fullWidth multiline minRows={3} label={maintenanceStrings.NOTE} value={expenseNote} onChange={(e) => setExpenseNote(e.target.value)} inputProps={{ maxLength: 1000 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAll} disabled={saving}>{maintenanceStrings.CANCEL}</Button>
          <Button variant="contained" onClick={submitExpense} disabled={saving}>{maintenanceStrings.SAVE}</Button>
        </DialogActions>
      </Dialog>

      {/* ---- agent ---- */}
      <Dialog open={kind === 'agent'} onClose={() => !saving && closeAll()} fullWidth maxWidth="sm">
        <DialogTitle>{agentStrings.CREATE_TITLE}</DialogTitle>
        <DialogContent className="quick-create__form">
          {agentActionError && <Alert severity="error">{agentActionError}</Alert>}
          {isAdmin && (
            <FormControl fullWidth margin="dense">
              <SupplierSelectList
                label={blStrings.SUPPLIER}
                required
                variant="standard"
                onChange={(values) => setAgentSupplier(values.length > 0 ? values[0] as Option : undefined)}
              />
            </FormControl>
          )}
          <TextField label={agentStrings.NAME} value={agentName} onChange={(e) => setAgentName(e.target.value)} required fullWidth />
          <TextField label={agentStrings.PHONE} value={agentPhone} onChange={(e) => setAgentPhone(e.target.value)} fullWidth />
          <FormControl fullWidth>
            <InputLabel>{agentStrings.TYPE}</InputLabel>
            <Select label={agentStrings.TYPE} value={agentType} onChange={(e) => setAgentType(e.target.value as bookcarsTypes.AgentType)}>
              {Object.values(bookcarsTypes.AgentType).map((type) => (
                <MenuItem key={type} value={type}>{agentTypeLabel(type)}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>{agentStrings.COMMISSION_MODE}</InputLabel>
            <Select label={agentStrings.COMMISSION_MODE} value={agentMode} onChange={(e) => setAgentMode(e.target.value as bookcarsTypes.CommissionMode)}>
              {Object.values(bookcarsTypes.CommissionMode).map((mode) => (
                <MenuItem key={mode} value={mode}>{agentModeLabel(mode)}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label={agentStrings.COMMISSION_VALUE}
            type="number"
            value={agentValue}
            onChange={(e) => setAgentValue(e.target.value)}
            required
            fullWidth
            inputProps={{ min: 0, step: 'any' }}
          />
          <FormControlLabel control={<Switch checked={agentActive} onChange={(e) => setAgentActive(e.target.checked)} />} label={agentStrings.ACTIVE} />
          <TextField label={agentStrings.NOTES} value={agentNotes} onChange={(e) => setAgentNotes(e.target.value)} fullWidth multiline minRows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAll} disabled={saving}>{agentStrings.CANCEL}</Button>
          <Button
            variant="contained"
            onClick={submitAgent}
            disabled={saving || !agentName.trim() || agentValue === '' || !Number.isFinite(Number(agentValue)) || Number(agentValue) < 0}
          >
            {agentStrings.SAVE}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- invite ---- */}
      <Dialog open={kind === 'invite'} onClose={() => !saving && closeAll()} fullWidth maxWidth="sm">
        <DialogTitle>{teamStrings.CREATE}</DialogTitle>
        <DialogContent className="quick-create__form">
          {inviteFormError && <Alert severity="error">{teamStrings.FORM_ERROR}</Alert>}
          {isAdmin && (
            <FormControl fullWidth margin="dense">
              <SupplierSelectList
                label={blStrings.SUPPLIER}
                required
                variant="standard"
                onChange={(values) => setInviteSupplier(values.length > 0 ? values[0] as Option : undefined)}
              />
            </FormControl>
          )}
          <TextField
            autoFocus
            fullWidth
            required
            label={teamStrings.FULL_NAME}
            value={inviteFullName}
            onChange={(event) => setInviteFullName(event.target.value)}
          />
          <TextField
            fullWidth
            required
            type="email"
            label={teamStrings.EMAIL}
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
          />
          <TextField
            fullWidth
            required
            type="password"
            label={teamStrings.PASSWORD}
            value={invitePassword}
            onChange={(event) => setInvitePassword(event.target.value)}
            inputProps={{ maxLength: 128 }}
          />
          <TextField
            select
            fullWidth
            required
            label={teamStrings.ROLE}
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as bookcarsTypes.AgencyRole)}
          >
            {[bookcarsTypes.AgencyRole.Manager, bookcarsTypes.AgencyRole.CounterAgent,
              bookcarsTypes.AgencyRole.Accountant, bookcarsTypes.AgencyRole.Mechanic,
              bookcarsTypes.AgencyRole.ReadOnly].map((role) => (
              <MenuItem key={role} value={role}>{teamRoleLabel(role)}</MenuItem>
            ))}
          </TextField>
          <FormHelperText>{teamStrings.PASSWORD_HINT}</FormHelperText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAll} disabled={saving}>{teamStrings.CANCEL}</Button>
          <Button variant="contained" onClick={submitInvite} disabled={saving}>{teamStrings.SAVE}</Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

export default QuickCreate
