export enum UserType {
  Admin = 'admin',
  Supplier = 'supplier',
  User = 'user',
  Staff = 'staff',
}

/** Staff roles are agency-scoped and are resolved from AgencyMembership. */
export enum AgencyRole {
  Owner = 'owner',
  Manager = 'manager',
  CounterAgent = 'counterAgent',
  Accountant = 'accountant',
  Mechanic = 'mechanic',
  ReadOnly = 'readOnly',
}

export enum AgencyMembershipStatus {
  Pending = 'pending',
  Active = 'active',
  Suspended = 'suspended',
}

export enum AppType {
  Admin = 'admin',
  Frontend = 'frontend',
}

export enum CarType {
  Diesel = 'diesel',
  Gasoline = 'gasoline',
  Electric = 'electric',
  Hybrid = 'hybrid',
  PlugInHybrid = 'plugInHybrid',
  Unknown = 'unknown',
}

export enum CarRange {
  Mini = 'mini', // car
  Midi = 'midi', // suv
  Maxi = 'maxi', // van
  Scooter = 'scooter',
  Bus = 'bus',
  Truck = 'truck',
  Caravan = 'caravan',
}

export enum CarMultimedia {
  Touchscreen = 'touchscreen',
  Bluetooth = 'bluetooth',
  AndroidAuto = 'androidAuto',
  AppleCarPlay = 'appleCarPlay',
}

export enum GearboxType {
  Manual = 'manual',
  Automatic = 'automatic',
}

export enum FuelPolicy {
  LikeForLike = 'likeForlike',
  FreeTank = 'freeTank',
  FullToFull = 'fullToFull',
  FullToEmpty = 'FullToEmpty',
}

export enum ContractLifecycle {
  Draft = 'draft',
  Confirmed = 'confirmed',
  Active = 'active',
  ReturnReview = 'returnReview',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

export enum InspectionType {
  Handover = 'handover',
  Return = 'return',
}

export enum BookingStatus {
  Void = 'void',
  Pending = 'pending',
  Deposit = 'deposit',
  Paid = 'paid',
  PaidInFull = 'paidInFull',
  Reserved = 'reserved',
  Cancelled = 'cancelled',
}

export enum CashAccountType {
  Cash = 'cash',
  Bank = 'bank',
}

export enum CashSessionStatus {
  Open = 'open',
  Closed = 'closed',
}

export enum CashMovementDirection {
  In = 'in',
  Out = 'out',
}

export enum CashMovementSource {
  Manual = 'manual',
  Transfer = 'transfer',
  Adjustment = 'adjustment',
}

export enum InvoiceStatus {
  Draft = 'draft',
  Issued = 'issued',
  Voided = 'voided',
}

export enum ApprovalDecision {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

export enum ContractChargeType {
  Damage = 'damage',
  Fee = 'fee',
}

export enum MaintenanceExpenseType {
  Maintenance = 'maintenance',
  Repair = 'repair',
  Cleaning = 'cleaning',
  Fuel = 'fuel',
  Insurance = 'insurance',
  Other = 'other',
}

export enum WorkOrderStatus {
  Scheduled = "scheduled",
  InProgress = "inProgress",
  Completed = "completed",
  Cancelled = "cancelled",
}

export enum MaintenanceScheduleStatus {
  Upcoming = 'upcoming',
  Due = 'due',
  Overdue = 'overdue',
  Completed = 'completed',
}

export enum Mileage {
  Limited = 'limited',
  Unlimited = 'unlimited',
}

export enum Availablity {
  Available = 'available',
  Unavailable = 'unavailable',
}

export enum RecordType {
  Admin = 'admin',
  Supplier = 'supplier',
  User = 'user',
  Car = 'car',
  Location = 'location',
  Country = 'country',
}

export enum PaymentGateway {
  PayPal = 'payPal',
  Stripe = 'stripe',
}

export interface AgencyMembership {
  _id?: string
  supplier: string
  user: string | User
  role: AgencyRole
  status: AgencyMembershipStatus
  invitedBy?: string
  activatedAt?: Date
  suspendedAt?: Date
  createdAt?: Date
  updatedAt?: Date
}

export interface CreateAgencyMembershipPayload {
  supplier?: string
  user?: string
  email?: string
  fullName?: string
  password?: string
  role: AgencyRole
}

export interface UpdateAgencyMembershipPayload {
  role?: AgencyRole
  status?: AgencyMembershipStatus
}

export interface ContractInspection {
  _id?: string
  supplier: string | User
  booking: string | Booking
  car: string | Car
  type: InspectionType
  occurredAt: Date
  odometer?: number
  fuelLevel?: number
  condition?: string
  damageNote?: string
  photoFiles?: string[]
  signatureFile?: string
  acknowledgedBy?: string | User
  actor?: string | User
  createdAt?: Date
}

export interface CreateContractInspectionPayload {
  occurredAt?: Date | string
  odometer?: number
  fuelLevel?: number
  condition?: string
  damageNote?: string
  photoFiles?: string[]
  signatureFile?: string
}

export interface Booking {
  _id?: string
  supplier: string | User
  car: string | Car
  driver?: string | User
  pickupLocation: string | Location
  dropOffLocation: string | Location
  from: Date
  to: Date
  status: BookingStatus
  lifecycle?: ContractLifecycle
  cancellation?: boolean
  amendments?: boolean
  theftProtection?: boolean
  collisionDamageWaiver?: boolean
  fullInsurance?: boolean
  additionalDriver?: boolean
  _additionalDriver?: string | AdditionalDriver
  cancelRequest?: boolean
  price?: number
  sessionId?: string
  paymentIntentId?: string
  customerId?: string
  expireAt?: Date
  isDeposit?: boolean
  isPayedInFull?: boolean
  ledgerVersion?: number
  paypalOrderId?: string
  financialSnapshot?: BookingFinancialSnapshot
}

export enum CheckoutPaymentMode {
  PayLater = 'payLater',
  Deposit = 'deposit',
  Rental = 'rental',
  Full = 'full',
}

/** Server-calculated booking terms captured at checkout time. */
export interface BookingFinancialSnapshot {
  version: 1
  baseCurrency: string
  paymentCurrency: string
  mode: CheckoutPaymentMode
  rentalTotal: number
  depositAmount: number
  amountDueNow: number
  amountDueNowInPaymentCurrency: number
  quotedAt: Date
}

export interface CheckoutPayload {
  driver?: User
  booking?: Booking
  additionalDriver?: AdditionalDriver
  paymentMode?: CheckoutPaymentMode
  currency?: string
  paymentGateway?: PaymentGateway
  paymentFlow?: 'embedded' | 'paymentSheet'
  /** @deprecated Ignored by the server. Retained for older client source compatibility. */
  payLater?: boolean
  /** @deprecated Provider references are generated or verified by the server. */
  paymentIntentId?: string
  customerId?: string
  sessionId?: string
  payPal?: boolean
}

export interface CheckoutResult {
  bookingId: string
  sessionId?: string
  customerId?: string
  clientSecret?: string | null
  paymentIntentId?: string
  financialSnapshot?: BookingFinancialSnapshot
}

export interface Filter {
  from?: Date
  dateBetween?: Date
  to?: Date
  keyword?: string
  pickupLocation?: string
  dropOffLocation?: string
}

export interface GetBookingsPayload {
  suppliers: string[]
  statuses: string[]
  user?: string
  car?: string
  filter?: Filter
}

export interface AdditionalDriver {
  fullName: string
  email: string
  phone: string
  birthDate: Date
}

export interface UpsertBookingPayload {
  booking: Booking
  additionalDriver?: AdditionalDriver
}

export interface LocationName {
  language: string
  name: string
}

export interface CountryName {
  language: string
  name: string
}

export interface UpsertLocationPayload {
  country: string
  longitude?: number
  latitude?: number
  names: LocationName[]
  image?: string | null
  parkingSpots?: ParkingSpot[]
  supplier?: string
  parentLocation?: string
}

export interface UpdateSupplierPayload {
  _id: string
  fullName: string
  phone: string
  location: string
  bio: string
  payLater: boolean
  licenseRequired: boolean
  minimumRentalDays?: number
  priceChangeRate?: number
  supplierCarLimit?: number
  notifyAdminOnNewCar?: boolean
  blacklisted?: boolean
}

export interface CreateCarPayload {
  loggedUser: string
  name: string
  licensePlate?: string
  supplier: string
  minimumAge: number
  locations: string[]

  // price fields
  hourlyPrice: number | null
  discountedHourlyPrice: number | null
  dailyPrice: number
  discountedDailyPrice: number | null
  biWeeklyPrice: number | null
  discountedBiWeeklyPrice: number | null
  weeklyPrice: number | null
  discountedWeeklyPrice: number | null
  monthlyPrice: number | null
  discountedMonthlyPrice: number | null
  // date based price
  isDateBasedPrice: boolean
  dateBasedPrices: DateBasedPrice[]

  deposit: number
  available: boolean
  fullyBooked?: boolean
  comingSoon?: boolean
  type: string
  gearbox: string
  aircon: boolean
  image?: string
  seats: number
  doors: number
  fuelPolicy: string
  mileage: number
  cancellation: number
  amendments: number
  theftProtection: number
  collisionDamageWaiver: number
  fullInsurance: number
  additionalDriver: number
  range: string
  multimedia: string[]
  rating?: number
  co2?: number
  blockOnPay?: boolean
}

export interface UpdateCarPayload extends CreateCarPayload {
  _id: string
}

export interface CarSpecs {
  aircon?: boolean,
  moreThanFourDoors?: boolean,
  moreThanFiveSeats?: boolean,
}

export interface GetCarsPayload {
  suppliers?: string[]
  carSpecs?: CarSpecs
  carType?: string[]
  gearbox?: string[]
  mileage?: string[]
  fuelPolicy?: string[]
  deposit?: number
  availability?: string[]
  pickupLocation?: string
  ranges?: string[]
  multimedia?: string[]
  rating?: number
  seats?: number
  includeAlreadyBookedCars?: boolean
  includeComingSoonCars?: boolean
  from?: Date
  to?: Date
}

export interface SignUpPayload {
  email: string
  password: string
  fullName: string
  phone?: string
  language: string
  active?: boolean
  verified?: boolean
  blacklisted?: boolean
  type?: string
  avatar?: string
  birthDate?: number | Date
}

export type Contract = { language: string, file: string | null }

export interface CreateUserPayload {
  email?: string
  phone: string
  location: string
  bio: string
  fullName: string
  type?: string
  avatar?: string
  birthDate?: number | Date
  language?: string
  password?: string
  verified?: boolean
  blacklisted?: boolean
  payLater?: boolean
  supplier?: string
  contracts?: Contract[]
  licenseRequired?: boolean
  minimumRentalDays?: number
  license?: string
  priceChangeRate?: number
  supplierCarLimit?: number
  notifyAdminOnNewCar?: boolean
}

export interface UpdateUserPayload extends CreateUserPayload {
  _id: string
  enableEmailNotifications?: boolean
}

export interface ChangePasswordPayload {
  _id: string
  password: string
  newPassword: string
  strict: boolean
}

export interface ActivatePayload {
  userId: string
  token: string
  password: string
}

export interface ValidateEmailPayload {
  email: string
  appType?: AppType
}

export enum SocialSignInType {
  Facebook = 'facebook',
  Apple = 'apple',
  Google = 'google'
}

export interface SignInPayload {
  email?: string
  password?: string
  stayConnected?: boolean
  mobile?: boolean
  fullName?: string
  avatar?: string
  accessToken?: string
  socialSignInType?: SocialSignInType
}

export interface ResendLinkPayload {
  email?: string
}

export interface UpdateEmailNotificationsPayload {
  _id: string
  enableEmailNotifications: boolean
}

export interface UpdateLanguagePayload {
  id: string
  language: string
}

export interface ValidateSupplierPayload {
  fullName: string
}

export interface ValidateLocationPayload {
  language: string
  name: string
}

export interface ValidateCountryPayload {
  language: string
  name: string
}

export interface UpdateStatusPayload {
  ids: string[]
  status: string
}

export interface User {
  _id?: string
  supplier?: User | string
  fullName: string
  email?: string
  phone?: string
  password?: string
  birthDate?: Date
  verified?: boolean
  verifiedAt?: Date
  active?: boolean
  language?: string
  enableEmailNotifications?: boolean
  avatar?: string
  bio?: string
  location?: string
  type?: string
  blacklisted?: boolean
  payLater?: boolean
  accessToken?: string
  checked?: boolean
  customerId?: string
  carCount?: number
  contracts?: Contract[]
  licenseRequired?: boolean
  license?: string | null
  minimumRentalDays?: number
  priceChangeRate?: number
  supplierCarLimit?: number
  notifyAdminOnNewCar?: boolean
  isSocial?: boolean
}

export interface Option {
  _id: string
  name?: string
  image?: string
}

export interface LocationValue {
  _id?: string
  language: string
  value?: string
}

export interface ParkingSpot {
  _id?: string
  longitude: number | string
  latitude: number | string
  name?: string
  values?: LocationValue[]
}

export interface Location {
  _id: string
  country?: Country
  longitude?: number
  latitude?: number
  name?: string
  values?: LocationValue[]
  image?: string
  parkingSpots?: ParkingSpot[]
  supplier?: User
  parentLocation?: Location
}

export interface Country {
  _id: string
  name?: string
  values?: LocationValue[]
  supplier?: User
}

export interface CountryInfo extends Country {
  locations?: Location[]
}

export interface UpsertCountryPayload {
  names: CountryName[]
  supplier?: string
}

export interface DateBasedPrice {
  _id?: string
  startDate: Date | null
  endDate: Date | null
  dailyPrice: number | string
}

export interface Car {
  _id: string
  name: string
  licensePlate?: string
  supplier: User
  minimumAge: number
  locations: Location[]

  // price fields
  dailyPrice: number
  discountedDailyPrice: number | null
  hourlyPrice: number | null
  discountedHourlyPrice: number | null
  biWeeklyPrice: number | null
  discountedBiWeeklyPrice: number | null
  weeklyPrice: number | null
  discountedWeeklyPrice: number | null
  monthlyPrice: number | null
  discountedMonthlyPrice: number | null

  // date based price fields
  isDateBasedPrice: boolean
  dateBasedPrices: DateBasedPrice[]

  deposit: number
  available: boolean
  fullyBooked?: boolean
  comingSoon?: boolean
  type: CarType
  gearbox: GearboxType
  aircon: boolean
  image?: string
  seats: number
  doors: number
  fuelPolicy: FuelPolicy
  mileage: number
  cancellation: number
  amendments: number
  theftProtection: number
  collisionDamageWaiver: number
  fullInsurance: number
  additionalDriver: number
  range: string
  multimedia: CarMultimedia[] | undefined
  rating?: number
  trips: number
  co2?: number
  blockOnPay?: boolean
  [propKey: string]: any
}

export interface ContractCharge {
  _id?: string
  supplier: string | User
  booking: string | Booking
  inspection?: string | ContractInspection
  type: ContractChargeType
  reason: string
  amount: number
  currency: string
  status: ApprovalDecision
  requestedBy?: string | User
  decidedBy?: string | User
  decidedAt?: Date
  decisionNote?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface ContractSnapshot {
  _id?: string
  supplier: string | User
  booking: string | Booking
  version: number
  pdfFile: string
  contentHash: string
  generatedAt: Date
  createdAt?: Date
}

export interface Invoice {
  _id?: string
  supplier: string | User
  booking: string | Booking
  number?: string
  status: InvoiceStatus
  currency: string
  subtotal: number
  taxAmount: number
  total: number
  paidAmount?: number
  paymentStatus?: 'unpaid' | 'partial' | 'paid'
  payments?: string[]
  issuedAt?: Date
  issuedBy?: string | User
  voidedAt?: Date
  voidedBy?: string | User
  voidReason?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface CreateInvoicePayload { booking: string; taxAmount?: number }
export interface VoidInvoicePayload { reason: string }

export interface CashSession {
  _id?: string
  supplier: string | User
  account: CashAccountType
  currency: string
  openedAt: Date
  openedBy?: string | User
  openingBalance: number
  status: CashSessionStatus
  closedAt?: Date
  closedBy?: string | User
  expectedClosingBalance?: number
  countedClosingBalance?: number
  discrepancy?: number
  closingNote?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface CashMovement {
  _id?: string
  supplier: string | User
  session: string | CashSession
  account: CashAccountType
  currency: string
  date: Date
  direction: CashMovementDirection
  amount: number
  source: CashMovementSource
  idempotencyKey?: string
  transferId?: string
  reference?: string
  note?: string
  actor?: string | User
  createdAt?: Date
}

export interface OpenCashSessionPayload {
  supplier?: string
  account: CashAccountType
  currency?: string
  openingBalance: number
}

export interface CreateCashMovementPayload {
  account?: CashAccountType
  date: Date | string
  direction: CashMovementDirection
  amount: number
  source?: CashMovementSource
  idempotencyKey?: string
  reference?: string
  note?: string
}

export interface CloseCashSessionPayload {
  countedClosingBalance: number
  closingNote?: string
}

export interface CreateCashTransferPayload {
  supplier?: string
  fromSession: string
  toSession: string
  amount: number
  date?: Date | string
  idempotencyKey?: string
  reference?: string
  note?: string
}

export interface MaintenanceWorkOrder {
  _id?: string
  supplier: string | User
  car: string | Car
  title: string
  type: MaintenanceExpenseType
  status: WorkOrderStatus
  scheduledStart: Date
  scheduledEnd: Date
  completedAt?: Date
  odometer?: number
  vendor?: string
  note?: string
  expense?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface UpsertMaintenanceWorkOrderPayload {
  car: string
  title: string
  type: MaintenanceExpenseType
  status?: WorkOrderStatus
  scheduledStart: Date | string
  scheduledEnd: Date | string
  odometer?: number
  vendor?: string
  note?: string
  expense?: string
}

export interface MaintenanceExpense {
  _id?: string
  supplier: string | User
  car: string | Car
  date: Date
  type: MaintenanceExpenseType
  amount: number
  mileage?: number
  vendor?: string
  note?: string
  receipt?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface UpsertMaintenanceExpensePayload {
  car: string
  date: Date | string
  type: MaintenanceExpenseType
  amount: number
  mileage?: number
  vendor?: string
  note?: string
  receipt?: string | null
}

export interface MaintenanceSchedule {
  _id?: string
  supplier: string | User
  car: string | Car
  type: MaintenanceExpenseType
  title: string
  intervalDays?: number
  intervalKm?: number
  lastServiceDate?: Date
  lastServiceMileage?: number
  nextDueDate: Date
  nextDueMileage?: number
  status: MaintenanceScheduleStatus
  note?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface UpsertMaintenanceSchedulePayload {
  car: string
  type: MaintenanceExpenseType
  title: string
  intervalDays?: number
  intervalKm?: number
  lastServiceDate?: Date | string
  lastServiceMileage?: number
  nextDueDate?: Date | string
  nextDueMileage?: number
  status?: MaintenanceScheduleStatus
  note?: string
}

export enum RentalPaymentMethod {
  Cash = 'cash',
  BankTransfer = 'bankTransfer',
  Card = 'card',
  Other = 'other',
}

export enum RentalPaymentPurpose {
  Rent = 'rent',
  Deposit = 'deposit',
}

export enum RentalPaymentSource {
  Manual = 'manual',
  Stripe = 'stripe',
  PayPal = 'paypal',
  Adjustment = 'adjustment',
}

export enum RentalPaymentDirection {
  Credit = 'credit',
  Debit = 'debit',
}

export enum RentalPaymentStatus {
  Pending = 'pending',
  Posted = 'posted',
  Reversed = 'reversed',
}

export interface RentalPayment {
  _id?: string
  supplier: string | User
  booking: string | Booking
  date: Date
  amount: number
  currency?: string
  method: RentalPaymentMethod
  purpose?: RentalPaymentPurpose
  direction?: RentalPaymentDirection
  source?: RentalPaymentSource
  status?: RentalPaymentStatus
  idempotencyKey?: string
  providerReference?: string
  actor?: string | User
  reversedFrom?: string | RentalPayment
  settledAt?: Date
  reference?: string
  note?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface CreateRentalPaymentPayload {
  booking: string
  date: Date
  amount: number
  currency?: string
  method: RentalPaymentMethod
  purpose?: RentalPaymentPurpose
  idempotencyKey?: string
  providerReference?: string
  reference?: string
  note?: string
}

export interface Data<T> {
  rows: T[]
  rowCount: number
}

export interface GetBookingCarsPayload {
  supplier: string
  pickupLocation: string
}

export interface Notification {
  _id: string
  user: string
  message: string
  booking?: string
  car?: string
  isRead?: boolean
  checked?: boolean
  createdAt?: Date
}

export interface NotificationCounter {
  _id: string
  user: string
  count: number
}

export interface ResultData<T> {
  pageInfo: { totalRecords: number }
  resultData: T[]
}

export type Result<T> = [ResultData<T>] | [] | undefined | null

export interface GetUsersBody {
  user: string
  types: UserType[]
}

export interface CreatePaymentPayload {
  amount: number
  /**
   * Three-letter ISO currency code, in lowercase.
   * Must be a supported currency: https://docs.stripe.com/currencies
   *
   * @type {string}
   */
  currency: string
  /**
   * The IETF language tag of the locale Checkout is displayed in. If blank or auto, the browser's locale is used.
   *
   * @type {string}
   */
  locale: string
  receiptEmail: string
  customerName: string
  name: string
  description?: string
}

export interface CreatePayPalOrderPayload {
  bookingId: string
  /** @deprecated Ignored; charge comes from the saved booking snapshot. */
  amount?: number
  /** @deprecated Ignored; currency comes from the saved booking snapshot. */
  currency?: string
  name: string
  description: string
}

export interface PaymentResult {
  sessionId?: string
  paymentIntentId?: string
  customerId: string
  clientSecret: string | null
}

export interface SendEmailPayload {
  from: string
  to: string
  subject: string
  message: string
  isContactForm: boolean
}

export interface Response<T> {
  status: number
  data: T
}

export interface BankDetails {
  _id: string
  accountHolder: string
  bankName: string
  iban: string
  swiftBic: string
  showBankDetailsPage: boolean
}

export interface UpsertBankDetailsPayload {
  _id?: string
  accountHolder: string
  bankName: string
  iban: string
  swiftBic: string
  showBankDetailsPage: boolean
}

export interface Setting {
  _id: string
  minPickupHours: number
  minRentalHours: number
  minPickupDropoffHour: number
  maxPickupDropoffHour: number
}

export interface UpdateSettingsPayload {
  minPickupHours: number
  minRentalHours: number
  minPickupDropoffHour: number
  maxPickupDropoffHour: number
}

// 
// React types
//
export type DataEvent<T> = (data?: Data<T>) => void

export interface StatusFilterItem {
  label: string
  value: BookingStatus
  checked?: boolean
}

export interface CarFilter {
  pickupLocation: Location
  dropOffLocation: Location
  from: Date
  to: Date
}

export type CarFilterSubmitEvent = (filter: CarFilter) => void

export interface CarOptions {
  cancellation?: boolean
  amendments?: boolean
  theftProtection?: boolean
  collisionDamageWaiver?: boolean
  fullInsurance?: boolean
  additionalDriver?: boolean
}




