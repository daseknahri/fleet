export enum UserType {
  Admin = 'admin',
  Supplier = 'supplier',
  User = 'user',
  Staff = 'staff',
}

/** GA-PAR-04: customer (client) classification — User records with type=User only. */
export enum ClientType {
  Individual = 'individual',
  Company = 'company',
}

/**
 * GA-PAR-04: client workflow status. This is a NEW, separate field: it is
 * display/workflow only and never writes or derives from the existing
 * `blacklisted` / `active` flags; auth semantics are unchanged.
 */
export enum ClientStatus {
  Active = 'active',
  UnderReview = 'underReview',
  Blocked = 'blocked',
}

export enum ClientDocumentKind {
  Cin = 'cin',
  Passport = 'passport',
  License = 'license',
  Other = 'other',
}

/** GA-PAR-04: one privately stored client document (identity pack). */
export interface ClientDocument {
  kind: ClientDocumentKind | string
  file: string
  originalName?: string
  uploadedAt?: Date
}

/** GA-PAR-04: per-client balance, computed with contractReceivable semantics. */
export interface ClientBalance {
  currency: string
  outstanding: number
  overdue: number
  depositHeld: number
  bookings: number
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

export enum QuoteStatus {
  Draft = 'draft',
  Sent = 'sent',
  Accepted = 'accepted',
  Expired = 'expired',
  Converted = 'converted',
}

/** GA-PAR-07 — apporteur (business referrer) kinds, per the parity target. */
export enum AgentType {
  Riad = 'riad',
  Hotel = 'hotel',
  Taxi = 'taxi',
  Guide = 'guide',
  Agency = 'agency',
  Other = 'other',
}

/** GA-PAR-07 — how an agent's commission is computed. */
export enum CommissionMode {
  Percent = 'percent',
  Fixed = 'fixed',
  PerDay = 'perDay',
}

/** GA-PAR-08 — how a car was financed (parity financing block). */
export enum CarFinancingType {
  Credit = 'credit',
  Cash = 'cash',
  Instalments = 'instalments',
  Leasing = 'leasing',
}

/**
 * GA-PAR-08 — the financing block stored on a car. All fields optional;
 * no cross-field business rules are enforced (e.g. remaining vs price is
 * the operator's data, not a validated invariant). GA-PAR-09's dashboard
 * credit-due card composes client-side from these raw fields
 * (`nextDueDate` + `remainingAmount`); there is no server-derived field.
 */
export interface CarFinancing {
  type?: CarFinancingType
  purchasePrice?: number
  lender?: string
  instalmentAmount?: number
  downPayment?: number
  durationMonths?: number
  firstDueDate?: Date
  nextDueDate?: Date
  remainingAmount?: number
  autoDebit?: boolean
}

/** GA-PAR-08 — create/update payload shape: every field may be nulled to clear it. */
export interface CarFinancingPayload {
  type?: CarFinancingType | string | null
  purchasePrice?: number | null
  lender?: string | null
  instalmentAmount?: number | null
  downPayment?: number | null
  durationMonths?: number | null
  firstDueDate?: Date | string | null
  nextDueDate?: Date | string | null
  remainingAmount?: number | null
  autoDebit?: boolean | null
}

/** GA-PAR-07 — payment methods accepted when settling an agent. */
export enum AgentSettlementMethod {
  Cash = 'cash',
  BankTransfer = 'bankTransfer',
  Card = 'card',
  Other = 'other',
}

export enum ApprovalDecision {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

export enum ContractChargeType {
  Damage = 'damage',
  Fee = 'fee',
  ExtraKm = 'extraKm',
  Fuel = 'fuel',
  Wash = 'wash',
}

export enum InspectionPhotoSlot {
  Front = 'front',
  Rear = 'rear',
  Right = 'right',
  Left = 'left',
  Dashboard = 'dashboard',
  Interior = 'interior',
  Extra = 'extra',
}

export interface InspectionChecklist {
  spareWheelAndTools?: boolean
  radio?: boolean
  washed?: boolean
}

export interface InspectionPhoto {
  slot: InspectionPhotoSlot
  file: string
}

export enum MaintenanceExpenseType {
  Maintenance = 'maintenance',
  Repair = 'repair',
  Cleaning = 'cleaning',
  Fuel = 'fuel',
  Insurance = 'insurance',
  Other = 'other',
  // GA-PAR-16 — widened ONLY to the competitor's 24-category ledger
  // (REA-DASHBOARD /maintenance). The six legacy keys above keep their
  // exact values so existing rows stay valid. This enum is shared by
  // MaintenanceExpense, MaintenanceSchedule and MaintenanceWorkOrder,
  // so the widened set is a superset for schedules and work orders.
  Oil = 'oil',
  Tyres = 'tyres',
  Battery = 'battery',
  Vignette = 'vignette',
  VisiteTechnique = 'visiteTechnique',
  AdBlue = 'adBlue',
  Fines = 'fines',
  LoanPayment = 'loanPayment',
  Rent = 'rent',
  Salaries = 'salaries',
  Agents = 'agents',
  Accounting = 'accounting',
  BankFees = 'bankFees',
  Bodywork = 'bodywork',
  Glass = 'glass',
  Electrical = 'electrical',
  AirConditioning = 'airConditioning',
  Exhaust = 'exhaust',
}

/**
 * GA-PAR-16 — derived expense payment status. NEVER stored: computed
 * from `paidAmount` vs `amount` in expense payloads (paid when
 * paidAmount >= amount, partial when 0 < paidAmount < amount, unpaid
 * when paidAmount is 0 or null/untracked).
 */
export enum MaintenanceExpensePaymentStatus {
  Unpaid = 'unpaid',
  Partial = 'partial',
  Paid = 'paid',
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
  checklist?: InspectionChecklist
  photos?: InspectionPhoto[]
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
  checklist?: InspectionChecklist
  photos?: InspectionPhoto[]
  signatureFile?: string
}

export interface DepositSettlement {
  heldAmount: number
  keptAmount: number
  returnedAmount: number
  method?: string
  note?: string
  recordedBy?: string | User
  recordedAt?: Date
}

export interface AgencyReturnSettings {
  _id?: string
  supplier: string | User
  includedKmPerDay?: number
  extraKmPrice?: number
  fuelPricePerLitre?: number
  washFee?: number
  defaultDeposit?: number
  createdAt?: Date
  updatedAt?: Date
}

export interface UpdateAgencyReturnSettingsPayload {
  supplier?: string
  includedKmPerDay?: number | null
  extraKmPrice?: number | null
  fuelPricePerLitre?: number | null
  washFee?: number | null
  defaultDeposit?: number | null
}

export interface SettlementPreviewLine {
  kind: ContractChargeType
  amount: number
  inputs: Record<string, number>
}

export interface SettlementPreviewOmission {
  kind: string
  reason: string
}

export interface SettlementPreview {
  booking: string
  currency: string
  rentalDays: number
  rates: {
    includedKmPerDay?: number | null
    extraKmPrice?: number | null
    fuelPricePerLitre?: number | null
    washFee?: number | null
    defaultDeposit?: number | null
    tankCapacityLitres?: number | null
  }
  lines: SettlementPreviewLine[]
  unavailable: SettlementPreviewOmission[]
  omissions: SettlementPreviewOmission[]
}

export interface Booking {
  _id?: string
  reference?: string
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
  depositSettlement?: DepositSettlement
  /** GA-PAR-07: apporteur commission snapshot captured at booking time. */
  agent?: BookingAgentSnapshot
  /** GA-PAR-10: recorded overlap exception (see OverlapException). */
  overlapException?: OverlapException
  /** GA-PAR-11: contract amendment history (see BookingAmendment). */
  amendmentHistory?: BookingAmendment[]
  /**
   * GA-PAR-12: online client signature record (see OnlineSignature).
   * API payloads only ever carry `{ signedAt }` — the stored file name
   * and content hash stay server-side (private contracts store).
   */
  onlineSignature?: OnlineSignature
  /**
   * GA-PAR-12: per-booking signing nonce, server-only. It is stored
   * with Mongoose `select: false`, stripped from list aggregations, and
   * must NEVER be serialized into any API response: issue/revoke rotate
   * it, a successful signing consumes it (rotates it), and signing
   * links are HMAC capability tokens over its current value.
   */
  signingNonce?: string
}

/**
 * GA-PAR-12 — the recorded online client signature on a booking.
 * `file` is the stored PNG name inside the private contracts store
 * (served only through authenticated routes); `contentHash` is the
 * SHA-256 of the stored image bytes; `signedAt` is server-stamped.
 */
export interface OnlineSignature {
  file: string
  signedAt: Date
  contentHash: string
}

/** GA-PAR-12 — response of the staff issue-link endpoint. */
export interface SigningLinkResponse {
  url: string
  expiresAt: Date
}

/**
 * GA-PAR-12 — the display-safe summary the public signing page receives
 * for exactly one booking. Nothing else is exposed: no other bookings,
 * no staff data, no client contact details beyond the name.
 */
export interface SigningSummary {
  agencyName: string
  reference?: string
  carName: string
  carPlate?: string
  from: Date
  to: Date
  clientName: string
  rentalTotal: number
  depositAmount: number
  currency: string
}

/** GA-PAR-12 — payload of the public signing submit endpoint. */
export interface SignBookingPayload {
  signaturePngBase64: string
}

/**
 * GA-PAR-11 — one recorded contract amendment (POST /api/bookings/:id/amend).
 * `by`/`at` are stamped server-side; `reason` is the only operator text.
 * The re-price basis is the ORIGINAL snapshot's rate basis: the snapshot
 * stores no daily rate, so basisDailyRate = rentalTotalBefore / basisDays
 * (the original rental day count) — never today's car prices.
 */
export interface BookingAmendment {
  at: Date
  by?: string | User
  reason: string
  fromBefore: Date
  toBefore: Date
  fromAfter: Date
  toAfter: Date
  rentalTotalBefore: number
  rentalTotalAfter: number
  priceDelta: number
  basisDailyRate?: number
  basisDays?: number
}

/** GA-PAR-11 — payload for POST /api/bookings/:id/amend. */
export interface AmendBookingPayload {
  from?: Date | string
  to?: Date | string
  reason: string
  /** Optional PAR-10 composition: only honoured with a valid reason
   * from an agency Owner/Manager, and only stamped when a conflict
   * was actually bypassed. Maintenance conflicts are never bypassed. */
  overlapException?: { reason: string }
}

/**
 * GA-PAR-10 — a recorded exception to the hard overlap block. The hard
 * block stays the default: an agency Owner/Manager may confirm one
 * specific booking-vs-booking overlap by supplying `{ reason }` on
 * create/update; the server stamps `authorisedBy`/`authorisedAt` and
 * records the conflicting booking when identifiable. Client payloads
 * carry only `reason` — the other fields are server-stamped and any
 * client-supplied values are ignored. Maintenance work-order conflicts
 * can never be excepted. The record lives on the booking itself.
 */
export interface OverlapException {
  reason: string
  authorisedBy?: string | User
  authorisedAt?: Date
  conflictingBooking?: string
}

/**
 * GA-PAR-07 — the commission snapshot stored on a booking. `mode`/`value`
 * are the agent default or the per-contract override in force when the
 * snapshot was taken; `amount` is computed server-side from them. Later
 * edits to the agent's default never rewrite an existing snapshot.
 */
export interface BookingAgentSnapshot {
  agent: string
  mode: CommissionMode
  value: number
  amount: number
}

export enum CheckoutPaymentMode {
  PayLater = 'payLater',
  Deposit = 'deposit',
  Rental = 'rental',
  Full = 'full',
}

/** Server-calculated booking terms captured at checkout time. */
export interface BookingFinancialSnapshot {
  /** 1 at checkout creation; GA-PAR-11 amendments bump it by 1. */
  version: number
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
  ice?: string
  registreCommerce?: string
  identifiantFiscal?: string
  patente?: string
  rib?: string
  fiscalAddress?: string
  city?: string
  vatEnabled?: boolean
  vatRate?: number
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
  tankCapacityLitres?: number
  blockOnPay?: boolean
  // GA-PAR-08: financing block + document expiry dates (all optional)
  financing?: CarFinancingPayload | null
  insuranceExpiryDate?: Date | string | null
  technicalInspectionExpiryDate?: Date | string | null
  vignetteExpiryDate?: Date | string | null
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
  ice?: string
  registreCommerce?: string
  identifiantFiscal?: string
  patente?: string
  rib?: string
  fiscalAddress?: string
  city?: string
  vatEnabled?: boolean
  vatRate?: number
  cinNumber?: string
  cinExpiry?: string | Date | null
  passportNumber?: string
  passportExpiry?: string | Date | null
  licenseNumber?: string
  licenseExpiry?: string | Date | null
  clientType?: ClientType | string
  clientStatus?: ClientStatus | string
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
  // GA-PAR-13: both fields are partial-PUT — an omitted field keeps its
  // stored value (the pre-PAR-13 payload always carried the master, and
  // that behaviour is unchanged for callers that send it).
  enableEmailNotifications?: boolean
  emailNotificationCategories?: EmailNotificationCategories
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
  emailNotificationCategories?: EmailNotificationCategories
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
  ice?: string
  registreCommerce?: string
  identifiantFiscal?: string
  patente?: string
  rib?: string
  fiscalAddress?: string
  city?: string
  vatEnabled?: boolean
  vatRate?: number
  cinNumber?: string
  cinExpiry?: Date
  passportNumber?: string
  passportExpiry?: Date
  licenseNumber?: string
  licenseExpiry?: Date
  clientType?: ClientType | string
  clientStatus?: ClientStatus | string
  clientDocuments?: ClientDocument[]
  clientDocumentsCount?: number
  balanceDue?: number
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
  tankCapacityLitres?: number
  blockOnPay?: boolean
  // GA-PAR-08: financing block + document expiry dates (all optional).
  // GA-PAR-09 reads financing.nextDueDate / financing.remainingAmount for
  // the credit-due card and the three expiry dates for the
  // expiring-documents card, straight from this payload shape.
  financing?: CarFinancing
  insuranceExpiryDate?: Date
  technicalInspectionExpiryDate?: Date
  vignetteExpiryDate?: Date
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
  taxRate?: number | null
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

export interface QuoteClientSnapshot {
  name?: string
  phone?: string
  cinNumber?: string
}

export interface Quote {
  _id?: string
  supplier: string | User
  number?: string
  status: QuoteStatus
  currency: string
  subtotal: number
  taxAmount: number
  taxRate?: number | null
  total: number
  booking?: string | Booking
  client?: string | User
  clientSnapshot?: QuoteClientSnapshot
  car?: string | Car
  carLabel?: string
  days?: number
  dailyRate?: number
  convertedInvoice?: string | Invoice
  createdBy?: string | User
  issuedBy?: string | User
  createdAt?: Date
  updatedAt?: Date
}

export interface CreateQuotePayload {
  supplier?: string
  booking?: string
  client?: string
  clientSnapshot?: QuoteClientSnapshot
  car?: string
  carLabel?: string
  days?: number
  dailyRate?: number
  subtotal?: number
  taxAmount?: number
  currency?: string
}

export interface UpdateQuotePayload {
  booking?: string | null
  client?: string | null
  clientSnapshot?: QuoteClientSnapshot
  car?: string | null
  carLabel?: string
  days?: number
  dailyRate?: number
  subtotal?: number
  taxAmount?: number
  currency?: string
}

export interface ConvertQuotePayload {
  booking?: string
}

export interface ConvertQuoteResult {
  quote: Quote
  invoice: Invoice
}

/** GA-PAR-07 — apporteur (business referrer) record. */
export interface Agent {
  _id?: string
  supplier: string | User
  name: string
  phone?: string
  type: AgentType
  commissionMode: CommissionMode
  commissionValue: number
  active: boolean
  notes?: string
  /** Server-computed Σ snapshot commissions − Σ settlements (list/get enrichment). */
  due?: number
  /** Server-computed Σ rental totals of the bookings carrying this agent. */
  rentalBrought?: number
  createdAt?: Date
  updatedAt?: Date
}

export interface CreateAgentPayload {
  supplier?: string
  name: string
  phone?: string
  type?: AgentType
  commissionMode?: CommissionMode
  commissionValue?: number
  active?: boolean
  notes?: string
}

export interface UpdateAgentPayload {
  name?: string
  phone?: string
  type?: AgentType
  commissionMode?: CommissionMode
  commissionValue?: number
  active?: boolean
  notes?: string
}

/** GA-PAR-07 — one settlement payment recorded against an agent. */
export interface AgentSettlement {
  _id?: string
  supplier: string | User
  agent: string | Agent
  amount: number
  method: AgentSettlementMethod
  confirmedBy?: string | User
  confirmedAt?: Date
  note?: string
  bookingRefs?: string[]
  createdAt?: Date
  updatedAt?: Date
}

export interface SettleAgentPayload {
  amount: number
  method: AgentSettlementMethod
  note?: string
}

export interface SettleAgentResult {
  settlement: AgentSettlement
  due: number
}

/** GA-PAR-13 — reminder template-chip categories (scorecard #30). */
export enum ReminderCategory {
  Rent = 'rent',
  OilChange = 'oilChange',
  Insurance = 'insurance',
  Visite = 'visite',
  CallClient = 'callClient',
  Custom = 'custom',
}

/** GA-PAR-13 — what a reminder is linked to (agency-scoped, validated). */
export enum ReminderLinkType {
  None = 'none',
  Car = 'car',
  Client = 'client',
}

/** GA-PAR-13 — recurrence kinds; `custom` carries `intervalDays >= 1`. */
export enum ReminderRecurrenceKind {
  Once = 'once',
  Weekly = 'weekly',
  Monthly = 'monthly',
  Yearly = 'yearly',
  Custom = 'custom',
}

export interface ReminderRecurrence {
  kind: ReminderRecurrenceKind
  intervalDays?: number
}

export interface ReminderChannels {
  inApp: boolean
  email: boolean
  push: boolean
}

/** GA-PAR-13 — agency reminder (scorecard #30). */
export interface Reminder {
  _id?: string
  supplier: string | User
  title: string
  note?: string
  category: ReminderCategory
  linkType: ReminderLinkType
  car?: string | Car
  client?: string | User
  recurrence: ReminderRecurrence
  firstDueAt: Date | string
  notifyAheadHours: number[]
  channels: ReminderChannels
  active: boolean
  nextDueAt?: Date | string
  lastFiredAt?: Date | string
  createdBy?: string | User
  createdAt?: Date
  updatedAt?: Date
}

export interface CreateReminderPayload {
  supplier?: string
  title: string
  note?: string
  category?: ReminderCategory
  linkType?: ReminderLinkType
  car?: string | null
  client?: string | null
  recurrence?: ReminderRecurrence
  firstDueAt: Date | string
  notifyAheadHours?: number[]
  channels?: Partial<ReminderChannels>
  active?: boolean
}

export interface UpdateReminderPayload {
  title?: string
  note?: string
  category?: ReminderCategory
  linkType?: ReminderLinkType
  car?: string | null
  client?: string | null
  recurrence?: ReminderRecurrence
  firstDueAt?: Date | string
  notifyAheadHours?: number[]
  channels?: Partial<ReminderChannels>
  active?: boolean
}

/** GA-PAR-13 — one claimed firing of an occurrence at one offset. */
export interface ReminderFiring {
  _id?: string
  supplier: string | User
  reminder: string | Reminder
  occurrenceAt: Date | string
  offsetHours: number
  firedAt: Date | string
  inAppCount?: number
  emailCount?: number
  pushCount?: number
  createdAt?: Date
  updatedAt?: Date
}

/** GA-PAR-17 — reports channel scope (dictionary v2026-11-11.2):
 * cash = method cash; bank = methods bankTransfer + card; other /
 * method-less payments belong to neither scope. */
export enum ReportScope {
  All = 'all',
  Cash = 'cash',
  Bank = 'bank',
}

/** GA-PAR-14 — reports builder grouping (scorecard #40). */
export enum ReportGroupBy {
  Day = 'day',
  Week = 'week',
  Month = 'month',
  Car = 'car',
}

/** GA-PAR-14 — saved reports-builder view config. */
export interface ReportViewConfig {
  from?: string
  to?: string
  periodPreset?: string
  carId?: string
  groupBy: ReportGroupBy
  compare: boolean
}

/** GA-PAR-14 — saved reports-builder view (owned by one user). */
export interface ReportView {
  _id?: string
  supplier: string | User
  user: string | User
  name: string
  config: ReportViewConfig
  createdAt?: Date
  updatedAt?: Date
}

export interface CreateReportViewPayload {
  supplier?: string
  name: string
  config: ReportViewConfig
}

export interface UpdateReportViewPayload {
  supplier?: string
  name?: string
  config?: ReportViewConfig
}

/** GA-PAR-14 — one reports-builder result row. */
export interface ReportBuilderRow {
  key: string
  carId?: string
  contractAmount: number
  collected: number
  remaining: number
  expenses: number
  net: number
  bookingsCount: number
  occupancyPct?: number
}

export interface ReportBuilderTotals {
  contractAmount: number
  collected: number
  remaining: number
  expenses: number
  net: number
  bookingsCount: number
  occupancyPct?: number
}

export interface ReportDelta {
  current: number
  previous: number
  delta: number
  deltaPct: number | null
}

/** GA-PAR-14 — reports builder result (dictionary v2026-11-11.1). */
export interface ReportBuilderResult {
  metricDictionaryVersion: string
  currency: string
  timezone: string
  from: string
  to: string
  groupBy: ReportGroupBy
  scope: ReportScope
  carId?: string
  rows: ReportBuilderRow[]
  totals: ReportBuilderTotals
  comparison?: {
    previousFrom: string
    previousTo: string
    previousTotals: ReportBuilderTotals
    deltas: Record<string, ReportDelta>
  }
}

/** GA-PAR-14 — drill-down contributing records for one builder scope. */
export interface ReportDrilldownResult {
  metricDictionaryVersion: string
  currency: string
  timezone: string
  from: string
  to: string
  groupBy: ReportGroupBy
  carId?: string
  bucket?: string
  limit: number
  bookings: Array<{ id: string, reference: string | null, carId: string, from: string, to: string, contractAmount: number, collected: number, remaining: number }>
  payments: Array<{ id: string, bookingId: string, date: string, amount: number }>
  expenses: Array<{ id: string, carId: string, date: string, amount: number }>
  truncated: { bookings: boolean, payments: boolean, expenses: boolean }
}

/** GA-PAR-09 Phase B / GA-PAR-14 — dashboard period aggregate. */
/** GA-PAR-17 — payments collections summary (dictionary v2026-11-11.2). */
export interface CollectionsSummary {
  metricDictionaryVersion: string
  currency: string
  contractAmount: number
  collected: number
  remaining: number
  collectionRatePct: number | null
  bookingsCount: number
}

export interface DashboardSummary {
  metricDictionaryVersion: string
  currency: string
  timezone: string
  from: string
  to: string
  scope: ReportScope
  contractAmount: number
  collected: number
  remaining: number
  contracts: number
}

/**
 * GA-PAR-13 — per-category email toggles on the supplier user
 * (scorecard #43). All default true. Stored + shown for every key;
 * the categories with a sender in this item are `carDueDates`
 * (reminder emails for oilChange/insurance/visite) and
 * `signedContracts` (the GA-PAR-12 online-signing email). The master
 * `enableEmailNotifications` boolean gates all email.
 */
export interface EmailNotificationCategories {
  returnsDue?: boolean
  carDueDates?: boolean
  signedContracts?: boolean
  weeklyRecap?: boolean
  tips?: boolean
  news?: boolean
}

/** GA-PAR-07 — KPI strip for the Agents page (one agency scope). */
export interface AgentKpis {
  totalDue: number
  commissionsThisMonth: number
  rentalBrought: number
  activeAgents: number
}

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
  // GA-PAR-16: car is OPTIONAL — a general expense is tied to no car.
  car?: string | Car | null
  date: Date
  type: MaintenanceExpenseType
  amount: number
  // GA-PAR-16: null = untracked/legacy (no payment state recorded).
  paidAmount?: number | null
  // GA-PAR-16: derived by the backend in every payload, never stored.
  paymentStatus?: MaintenanceExpensePaymentStatus
  mileage?: number
  vendor?: string
  note?: string
  receipt?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface UpsertMaintenanceExpensePayload {
  // GA-PAR-16: optional — omit/null for a general (car-less) expense.
  car?: string | null
  date: Date | string
  type: MaintenanceExpenseType
  amount: number
  // GA-PAR-16: omit = leave unchanged on update / untracked on create;
  // null = untracked; a number must satisfy 0 <= paidAmount <= amount.
  paidAmount?: number | null
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





/** GA-PAR-15 — Excel import entities (scorecard #5). GA-PAR-16 adds expenses. */
export enum ImportEntity {
  Cars = 'cars',
  Clients = 'clients',
  Bookings = 'bookings',
  Expenses = 'expenses',
}

/** GA-PAR-15 — one row-level import error; `row` is the 1-based spreadsheet row (header = row 1). */
export interface ImportRowError {
  row: number
  field?: string
  message: string
}

/**
 * GA-PAR-15 — import report, identical in shape for dry-run and commit.
 * `created` is 0 on a dry run (a dry run persists nothing).
 */
export interface ImportReport {
  entity: ImportEntity
  dryRun: boolean
  totalRows: number
  validRows: number
  invalidRows: number
  created: number
  errors: ImportRowError[]
}
