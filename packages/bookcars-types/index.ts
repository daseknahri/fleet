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

/** F5b (W2-06): verification state of one client document. New uploads
 * are `pending`; an operator with document-management rights marks them
 * `verified` or `rejected` through the verify endpoint. */
export enum ClientDocumentStatus {
  Pending = 'pending',
  Verified = 'verified',
  Rejected = 'rejected',
}

/** F5b (W2-14): kinds of privately stored car documents. */
export enum CarDocumentKind {
  Insurance = 'insurance',
  TechnicalInspection = 'technicalInspection',
  Vignette = 'vignette',
  Other = 'other',
}

/** GA-PAR-04: one privately stored client document (identity pack). */
export interface ClientDocument {
  kind: ClientDocumentKind | string
  file: string
  originalName?: string
  uploadedAt?: Date
  /** F5b (W2-06): verification state (default `pending`); `verifiedBy` /
   * `verifiedAt` record who decided it and when (the decision instant
   * for both `verified` and `rejected`). There is no separate "expired"
   * state — expiry is derived in the UI from the linked identity date
   * (kind cin → cinExpiry, passport → passportExpiry, license →
   * licenseExpiry). */
  status?: ClientDocumentStatus | string
  verifiedBy?: string
  verifiedAt?: Date
}

/** F5b (W2-14): one privately stored car document. `expiryDate` is the
 * document's own expiry (e.g. the insurance policy's end date) and is
 * independent of the car's `insuranceExpiryDate` field — the operator
 * may store the file without re-typing the date, or the other way
 * round. The file itself lives in the private car-documents store;
 * only the owning agency / admin can download it. */
export interface CarDocument {
  kind: CarDocumentKind | string
  file: string
  originalName?: string
  expiryDate?: Date
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
  // F6 / W3 C-7 — a movement created automatically from a ledger cash
  // payment (RentalPayment with method cash), linked to that payment.
  RentalPayment = 'rentalPayment',
  // F7 / W3 M-2 — a movement created automatically from a cash expense
  // payment (MaintenanceExpensePayment with method cash), linked to
  // that payment. Same confirmed-Out pattern as RentalPayment.
  ExpensePayment = 'expensePayment',
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

/**
 * Scorecard #17 (garage block) — where the car physically is while it is
 * off the road. A car-level informational block, deliberately separate
 * from MaintenanceWorkOrder (a scheduled-work record with its own
 * vendor/window/status, backend-only, no admin UI): a work order existing
 * does not mean the car is at the garage, and a car can be at the garage
 * with no work order on file. All fields optional; a block with no set
 * field is stored as absent, never as an empty object. The block is
 * INFORMATIONAL only — it never changes booking behaviour; the booking
 * refusal rides solely on operationalStatus (scorecard #15).
 */
export interface CarGarage {
  garageName?: string
  since?: Date
  expectedBack?: Date
}

/** Scorecard #17 — create/update payload shape: every field may be nulled to clear it. */
export interface CarGaragePayload {
  garageName?: string | null
  since?: Date | string | null
  expectedBack?: Date | string | null
}

/**
 * Scorecard #18 (service state) — oil/filter change km tracking, stored
 * verbatim on the car. All fields optional, nullable numbers, km >= 0;
 * next >= last per pair when both are set (enforced server-side, see
 * carController.invalidServiceField). No computation is derived from the
 * generic MaintenanceSchedule intervals (intervalKm / nextDueMileage):
 * those are per-type schedule rows, not a car-level oil/filter state, and
 * no expense of category `oil` ever moves these fields — an oil expense
 * is a ledger row, this block is the operator-recorded service state.
 * The block is INFORMATIONAL only — it never changes booking behaviour.
 */
export interface CarService {
  lastOilChangeKm?: number
  lastFilterChangeKm?: number
  nextOilChangeKm?: number
  nextFilterChangeKm?: number
}

/** Scorecard #18 — create/update payload shape: every field may be nulled to clear it. */
export interface CarServicePayload {
  lastOilChangeKm?: number | string | null
  lastFilterChangeKm?: number | string | null
  nextOilChangeKm?: number | string | null
  nextFilterChangeKm?: number | string | null
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

// Fleet statuses (scorecard #15): the operator-set state of a car.
// `rented` is NOT stored — it stays derived from live bookings (see
// backend/src/utils/fleetStatus.ts). A car with no stored value (legacy
// docs) reads as inService everywhere.
export enum CarOperationalStatus {
  InService = 'inService',
  Maintenance = 'maintenance',
  Stopped = 'stopped',
}

// Derived fleet status shown on the car list: the operator status wins;
// otherwise a car with a live booking covering now is `rented`, else it
// follows the `available` flag. `unavailable` (in service, not rented,
// available=false) is NOT one of the four counted statuses.
export type CarFleetStatus = 'available' | 'rented' | 'maintenance' | 'stopped'

export interface FleetStatusCounts {
  available: number
  rented: number
  maintenance: number
  stopped: number
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
  // F8 / W5 T4 — optional initial status: Active (default) or Pending
  // ("created but not yet activated"). No invitation email is ever sent.
  status?: AgencyMembershipStatus
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
  /** F4 / W1 #7 — dispute flag (open while resolvedAt is absent). */
  dispute?: ContractDispute
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
  /** F4 / W1 #7 — late return, informational only (no amount, no fee:
   * any late fee is ADR-001-gated). Present only when the return
   * inspection's occurredAt is past the booking's scheduled `to`. */
  lateReturn?: {
    returnedAt: Date
    dueAt: Date
    lateHours: number
  }
}

/** GA-PAR-22 — one trash-history row (append-only, per document). */
export interface TrashHistoryRow {
  at: Date
  by?: string
  action: 'trashed' | 'restored'
  reason: string
  /** Booking rows only: whether the trash money-warning fired (§2.5). */
  hadPayments?: boolean
  hadInvoices?: boolean
}

/** GA-PAR-22 — trash / restore / purge request body (bulk endpoints). */
export interface TrashRequestPayload {
  ids: string[]
  /** Required (3–1000 chars) on trash and purge; optional on restore. */
  reason?: string
}

/** GA-PAR-22 — live counts behind a trash confirm dialog (§5.7). */
export interface TrashWarning {
  /** Bookings: posted payments on the booking + their collected total. */
  paymentsCount?: number
  paymentsCollected?: number
  /** Bookings: invoices on the booking (issued count among them). */
  invoicesCount?: number
  invoicesIssuedCount?: number
  /** Bookings: pending contract charges on the booking. */
  pendingChargesCount?: number
  /** Clients: live bookings of the client + posted payments on them. */
  bookingsCount?: number
  /** Cars: bookings referencing the car (live / trashed split). */
  liveBookingsCount?: number
  trashedBookingsCount?: number
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
  /** F4 / W1 #7 — computed read-model flag (lifecycle Active + past
   * `to`); never stored, set by getBooking / list endpoints. */
  overdue?: boolean
  cancellation?: boolean
  amendments?: boolean
  theftProtection?: boolean
  collisionDamageWaiver?: boolean
  fullInsurance?: boolean
  additionalDriver?: boolean
  _additionalDriver?: string | AdditionalDriver
  cancelRequest?: boolean
  /** F3 / W1 #9 — when the customer filed the cancel request (server-stamped). */
  cancelRequestAt?: Date
  /** F3 / W1 #9 — who filed the cancel request (server-stamped). */
  cancelRequestBy?: string | User
  /** F4 / W1 #7 — server-stamped no-show record (mark-no-show). */
  noShowAt?: Date
  /** F4 / W1 #7 — who marked the booking as a no-show. */
  noShowBy?: string | User
  /** F3 / W1 #1 — staff cancellation record (reason, refund decision, amounts at stake). */
  cancellationRecord?: BookingCancellationRecord
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
  /** GA-PAR-22: trash / restore (see backend models/Booking.ts). */
  deletedAt?: Date | null
  deletedBy?: string | User
  deletedByName?: string
  deleteReason?: string
  trashHistory?: TrashHistoryRow[]
  /** GA-PAR-22: trash-view display flags, flattened from the last
   * trashHistory row (the history itself never leaves the server in
   * list responses — §3). */
  hadPayments?: boolean
  hadInvoices?: boolean
}

/**
 * F3 / W1 #1 + #9 — the staff cancellation record written by the cancel
 * workflow (never client-supplied). The refund amount is NEVER auto-decided
 * by the code: `refundDecision` is the staff member's explicit choice at
 * approval time (ADR-001 deposit release/retain/refund rules are an open
 * owner decision — see GAPS.md §5). `full` reverses every posted payment
 * (provider refund first, via the F1 reversal path); `none` keeps the money
 * collected; `manual` cancels now and leaves the refund to staff in the
 * provider dashboard (`refundStatus: 'pending'`). `rentPaid` /
 * `depositPaid` are the computed amounts at stake at cancel time, so staff
 * can see exactly what the decision covers. A partial refund is NOT
 * executed by this workflow — it stays a `manual` (pending) step.
 */
export type CancelRefundDecision = 'full' | 'none' | 'manual'

export type CancelRefundStatus = 'none' | 'refunded' | 'pending'

export interface BookingCancellationRecord {
  reason: string
  cancelledBy: string
  cancelledAt: Date
  refundDecision: CancelRefundDecision
  refundStatus: CancelRefundStatus
  /** Posted rent collected at cancel time (base currency). */
  rentPaid: number
  /** Posted deposit collected at cancel time (base currency). */
  depositPaid: number
  /** Rent actually reversed (0 unless the decision executed a refund). */
  refundedRent: number
  /** Deposit actually reversed (0 unless the decision executed a refund). */
  refundedDeposit: number
  /** Provider refund references returned by executed reversals, if any. */
  refundProviderReferences?: string[]
  refundedAt?: Date
  /** Who filed the customer cancel request this cancellation answers, if any. */
  requestedBy?: string
  requestedAt?: Date
}

/** F3 / W1 #1 — staff cancel payload (POST /api/bookings/:id/cancel). */
export interface CancelBookingPayload {
  reason: string
  refundDecision: CancelRefundDecision
}

/** F3 / W1 #9 — cancel-request decision payload. */
export interface DecideCancelRequestPayload {
  decision: 'approve' | 'deny'
  reason: string
  /** Required when approving; ignored when denying. */
  refundDecision?: CancelRefundDecision
}

/** F3 / W1 #3 — staff manual payment-confirmation payload. */
export interface ConfirmManualPaymentPayload {
  /** Cash (or other method) amount just collected. Omit to confirm from already-posted payments only. */
  amount?: number
  method?: RentalPaymentMethod
  /** Purpose of a collected amount (default Rent — the amount due now is rent + approved charges). */
  purpose?: RentalPaymentPurpose
  currency?: string
  note?: string
  reference?: string
}

/** F3 / W1 #9 — one row of the cancel-request queue. */
export interface CancelRequestRow {
  booking: Booking
  currency: string
  /** Posted rent collected so far (base currency). */
  rentPaid: number
  /** Posted deposit collected so far (base currency). */
  depositPaid: number
  /** Rent + approved charges still outstanding (base currency). */
  outstandingBalance: number
  requestedAt?: Date
}

/** F4 / W1 #7 — one row of the overdue (late-return) list. */
export interface OverdueBookingRow {
  booking: Booking
  currency: string
  /** The scheduled return time the booking is overdue since. */
  overdueSince: Date
  /** Whole hours past the scheduled return (ceiled, helper.hours). */
  overdueHours: number
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

/** F4 / W1 #6 — the correction an amendment recorded (only the fields
 * that actually changed are present). */
export interface BookingAmendmentCorrection {
  pickupLocationBefore?: string
  pickupLocationAfter?: string
  dropOffLocationBefore?: string
  dropOffLocationAfter?: string
  carBefore?: string
  carAfter?: string
  optionsBefore?: CarOptions
  optionsAfter?: CarOptions
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
  /** F4 / W1 #6 — the correction this amendment recorded, if any. */
  correction?: BookingAmendmentCorrection
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

  /** F4 / W1 #6 — correction inputs (see bookingAmendmentController):
   * new pickup/drop-off locations, a replacement vehicle, add-on
   * option corrections (present + boolean only), and the additional
   * driver details (required when turning that option on). */
  pickupLocation?: string
  dropOffLocation?: string
  car?: string
  cancellation?: boolean
  amendments?: boolean
  theftProtection?: boolean
  collisionDamageWaiver?: boolean
  fullInsurance?: boolean
  additionalDriver?: boolean
  additionalDriverDetails?: { fullName: string, email: string, phone: string, birthDate: string | Date }
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
  /**
   * F2 / W4 GAP-10 — FX rate behind `amountDueNowInPaymentCurrency`:
   * payment-currency units per 1 base-currency unit (1 when the
   * currencies match). Optional: snapshots written before this field
   * existed carry no rate, and the ledger derives the ratio from the
   * two stored amounts instead. Never `required` (F1 lesson: a required
   * field would break legacy snapshot-less rows).
   */
  fxRate?: number
  /**
   * F2 / W4 GAP-10 — where `fxRate` came from: `'easy-currencies'` for
   * a live conversion, `'identity'` when `paymentCurrency` is the base
   * currency and no conversion happened.
   */
  fxSource?: string
  /** F2 / W4 GAP-10 — when the rate was captured (== `quotedAt`). */
  fxAt?: Date
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
  /** GA-Q4-1: per-agency editable contract terms (FR + AR). */
  contractTermsFr?: string
  contractTermsAr?: string
}

export interface CreateCarPayload {
  loggedUser: string
  name: string
  licensePlate?: string
  supplier: string
  minimumAge: number
  locations: string[]
  // F5b (W2-12/W2-13/W2-19): vehicle identity + odometer + insurance
  // policy (all optional; the gallery and the car documents are
  // managed through their own endpoints, never through this payload).
  make?: string | null
  model?: string | null
  year?: number | null
  odometerKm?: number | null
  insuranceProvider?: string | null
  insurancePolicyNumber?: string | null

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
  operationalStatus?: CarOperationalStatus
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
  // Scorecard #17: garage block (all optional); null clears it on update.
  garage?: CarGaragePayload | null
  // Scorecard #18: service state (all optional); null clears it on update.
  service?: CarServicePayload | null
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
  // Fleet statuses (scorecard #15): one of the four derived statuses;
  // absent means no status filter (all cars).
  fleetStatus?: CarFleetStatus
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
  /** F5b (W2-18): company-client fields (clientType=Company only;
   * `companyName` is required for company clients). */
  companyName?: string
  companyRegistration?: string
  companyContactName?: string
  /** F5b (W2-05): consent. `consentAt` is server-derived (see
   * clientIdentity.consentAtForTransition) and is never accepted from
   * a payload — it is deliberately absent from this interface. */
  consentGiven?: boolean
  consentScope?: string[]
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
  /** GA-PAR-14: agency stamp filename in the private contracts store. */
  stampFile?: string
  /** GA-Q4-1: per-agency editable contract terms (FR + AR). */
  contractTermsFr?: string
  contractTermsAr?: string
  cinNumber?: string
  cinExpiry?: Date
  passportNumber?: string
  passportExpiry?: Date
  licenseNumber?: string
  licenseExpiry?: Date
  clientType?: ClientType | string
  clientStatus?: ClientStatus | string
  companyName?: string
  companyRegistration?: string
  companyContactName?: string
  consentGiven?: boolean
  consentAt?: Date | null
  consentScope?: string[]
  clientDocuments?: ClientDocument[]
  clientDocumentsCount?: number
  balanceDue?: number
  /** F5b (W2-04): per-row document flags (customer rows only). */
  documentsMissing?: boolean
  documentsExpired?: boolean
  /** GA-PAR-22: trash / restore (client rows only — see backend models/User.ts). */
  deletedAt?: Date | null
  deletedBy?: string | User
  deletedByName?: string
  deleteReason?: string
  trashHistory?: TrashHistoryRow[]
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
  // F5b (W2-12/W2-13/W2-19): vehicle identity + odometer + insurance
  // policy (all optional). `odometerKm` is the car's current odometer
  // reading — NOT `mileage`, which is the km/day rental allowance.
  make?: string
  model?: string
  year?: number
  odometerKm?: number
  insuranceProvider?: string
  insurancePolicyNumber?: string
  // F5b (W2-14): additional gallery photos beyond the cover `image`
  // (the cover stays `image` for backwards compatibility) and the
  // privately stored car documents.
  images?: string[]
  documents?: CarDocument[]

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
  // Fleet statuses (scorecard #15): operator-set state; absent on legacy
  // docs (reads as inService). `fleetStatus` is the server-derived
  // display status attached by getCars (never stored).
  operationalStatus?: CarOperationalStatus
  fleetStatus?: CarFleetStatus
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
  // Scorecard #17: garage block (all optional, informational only — see
  // CarGarage above; never drives booking behaviour).
  garage?: CarGarage
  // Scorecard #18: service state — oil/filter change km (all optional,
  // informational only — see CarService above; never drives booking
  // behaviour). A due badge in the admin list is a pure display
  // comparison of these fields against the car's current mileage.
  service?: CarService
  /** GA-PAR-22: trash / restore (see backend models/Car.ts). */
  deletedAt?: Date | null
  deletedBy?: string | User
  deletedByName?: string
  deleteReason?: string
  trashHistory?: TrashHistoryRow[]
  [propKey: string]: any
}

/**
 * F4 / W1 #7 — a dispute raised against a contract charge or inspection
 * record (roadmap §3). A metadata flag only: it never edits the
 * record's evidence. Open while `resolvedAt` is absent; resolving
 * stamps who/when and the resolution. An open dispute blocks
 * `complete`.
 */
export interface ContractDispute {
  reason: string
  raisedBy?: string | User
  raisedAt: Date
  resolvedAt?: Date
  resolvedBy?: string | User
  resolution?: string
}

/** F4 / W1 #7 — raise a dispute on a charge/inspection record. */
export interface DisputeContractRecordPayload {
  reason: string
}

/** F4 / W1 #7 — resolve an open dispute. */
export interface ResolveContractDisputePayload {
  resolution: string
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
  /** F4 / W1 #7 — dispute flag (open while resolvedAt is absent). */
  dispute?: ContractDispute
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
  /** GA-PAR-14: the snapshot was generated with the agency stamp requested. */
  withStamp?: boolean
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
  /** F7 / W3 B-3 — true when the tax was set by an explicit override
   * (manual taxAmount, or a quote's verbatim tax) rather than computed
   * from the supplier's configured VAT rate. The HT-vs-TTC basis is
   * still an open ADR-001 decision; the flag only records provenance. */
  taxOverride?: boolean
  total: number
  paidAmount?: number
  paymentStatus?: 'unpaid' | 'partial' | 'paid'
  payments?: string[]
  // F7 / W3 B-2 — what the invoice looked like when it was voided.
  // Voiding clears paidAmount / paymentStatus / payments (see
  // voidInvoice); the snapshot keeps the record of what was paid
  // before the void, so a voided invoice never shows a stale paid
  // status and the money is never silently forgotten.
  voidedPaidAmount?: number
  voidedPaymentStatus?: 'unpaid' | 'partial' | 'paid'
  // F7 / W3 B-4 — delivery log (status tracking ONLY: no sending is
  // built — SMTP/Resend is owner-decision pending, SMS/WhatsApp
  // adapters are gated). One entry per recorded delivery.
  deliveries?: Array<{ channel: InvoiceDeliveryChannel, at: Date, by?: string | User }>
  // F7 / W3 B-5 — log of payments unlinked from this invoice.
  unlinkLog?: Array<{ payment: string, reason: string, at: Date, by?: string | User }>
  issuedAt?: Date
  issuedBy?: string | User
  voidedAt?: Date
  voidedBy?: string | User
  voidReason?: string
  createdAt?: Date
  updatedAt?: Date
}

/** F7 / W3 B-4 — invoice delivery channels (tracking only, no sending). */
export enum InvoiceDeliveryChannel {
  Print = 'print',
  Email = 'email',
  Whatsapp = 'whatsapp',
}

export interface RecordInvoiceDeliveryPayload { channel: InvoiceDeliveryChannel }
export interface UnlinkInvoicePaymentPayload { payment: string, reason: string }

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
  // F7 / W3 R-5 — the cash/bank channel scope this view was saved
  // with; applying the view restores it (it used to force scope All).
  scope?: ReportScope
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

/** GA-PAR-14 — one reports-builder result row.
 * F7 / W3 R-7 — `net` is CASH-basis (collected − paidExpenses);
 * `netAccrued` is the accrual figure (collected − expenses). */
export interface ReportBuilderRow {
  key: string
  carId?: string
  contractAmount: number
  collected: number
  remaining: number
  expenses: number
  /** F7 / W3 R-7 — Σ MaintenanceExpense.paidAmount for the row. */
  paidExpenses: number
  net: number
  netAccrued: number
  bookingsCount: number
  occupancyPct?: number
}

export interface ReportBuilderTotals {
  contractAmount: number
  collected: number
  remaining: number
  expenses: number
  /** F7 / W3 R-7 — Σ MaintenanceExpense.paidAmount for the period. */
  paidExpenses: number
  net: number
  netAccrued: number
  /** F7 / W3 R-7 — expenses whose paidAmount is null (untracked). */
  untrackedExpenses: number
  untrackedExpenseAmount: number
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
  // F7 / W3 R-5 — the scope the drill-down was computed under.
  scope: ReportScope
  limit: number
  bookings: Array<{ id: string, reference: string | null, carId: string, from: string, to: string, contractAmount: number, collected: number, remaining: number }>
  payments: Array<{ id: string, bookingId: string, date: string, amount: number }>
  expenses: Array<{ id: string, carId: string, date: string, amount: number }>
  truncated: { bookings: boolean, payments: boolean, expenses: boolean }
}

/** GA-PAR-09 Phase B / GA-PAR-14 — dashboard period aggregate. */
/** GA-PAR-17 — payments collections summary (dictionary v2026-11-15.1). */
export interface CollectionsSummary {
  metricDictionaryVersion: string
  currency: string
  contractAmount: number
  collected: number
  remaining: number
  collectionRatePct: number | null
  bookingsCount: number
  // F6 / W3 X-1 — net posted payments (rent + deposits, debits
  // negative), agency-wide. The Payments page's TOTAL card used to
  // sum this client-side from the full payment list; the list is
  // server-paginated now, so the server computes it.
  postedNetTotal: number
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
  // F8 / W5 D3 + D4 — server-side fleet counts, exact at any scale:
  // total live cars, cars available right now (flag + in service and
  // NOT out on a live booking overlapping now), and cars on rent.
  fleet: { total: number, available: number, onRent: number }
  // F8 / W5 D4 — server-side count of expiring documents (same rule
  // as the documents widget): exact total, while the widget's list
  // stays capped at 10 rows.
  documentsExpiring: number
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
  // F6 / W3 C-1 — the previous closed session's counted balance this
  // opening was chained from (undefined on a first session), and the
  // operator's recorded reason when the opening differs from it.
  previousClosingBalance?: number
  openingDifferenceReason?: string
  // F6 / W3 C-4 — pending entries explicitly carried through a close
  // (counts/totals at close time + the recorded carry reason), and the
  // discrepancy approval (tolerance is zero: any discrepancy needs an
  // explicit approval + reason recorded here).
  pendingCarriedCount?: number
  pendingCarriedIn?: number
  pendingCarriedOut?: number
  pendingCarryReason?: string
  discrepancyReason?: string
  discrepancyApprovedBy?: string | User
  discrepancyApprovedAt?: Date
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
  // F6 / W3 C-4 — counter-agent entries stay 'pending' until confirmed
  // (owner decision 1.5); movements written before the status field
  // existed carry no status and count as confirmed.
  status?: 'pending' | 'confirmed'
  confirmedBy?: string | User
  confirmedAt?: Date
  // F6 / W3 C-7 — the ledger cash payment this movement was created
  // from (cash-method RentalPayment), and that payment's purpose: a
  // deposit-purpose movement is drawer cash held as a liability, never
  // income. Manual movements carry no purpose.
  rentalPayment?: string | RentalPayment
  purpose?: RentalPaymentPurpose
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
  // F6 / W3 C-1 — optional: omitted means "chain from the previous
  // closed session's counted balance". An explicit value that differs
  // from the chained balance requires openingDifferenceReason.
  openingBalance?: number
  openingDifferenceReason?: string
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
  // F6 / W3 C-4 — closing with pending entries requires an explicit
  // acknowledgement + carry reason (they are carried, never silently
  // ignored); any nonzero discrepancy requires an explicit approval +
  // reason (tolerance is zero).
  acknowledgePending?: boolean
  pendingCarryReason?: string
  discrepancyApproved?: boolean
  discrepancyReason?: string
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
  // F7 / W3 M-5 — server-computed from linked expenses (list only):
  // the total amount and count of expenses linked to this work order.
  expenseTotal?: number
  expenseCount?: number
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
  // F7 / W3 M-5 — the work order this expense belongs to, if any.
  workOrder?: string | MaintenanceWorkOrder | null
  date: Date
  type: MaintenanceExpenseType
  amount: number
  // GA-PAR-16: null = untracked/legacy (no payment state recorded).
  // F7 / W3 M-2: once payment records exist, paidAmount is the SUM of
  // those records, recomputed server-side — never typed in by hand.
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
  // F7 / W3 M-5: omit = leave unchanged on update / unlinked on
  // create; null = unlink; an id must exist, belong to the expense's
  // agency, and (when the expense has a car) to that same car.
  workOrder?: string | null
  date: Date | string
  type: MaintenanceExpenseType
  amount: number
  // GA-PAR-16: omit = leave unchanged on update / untracked on create;
  // null = untracked; a number must satisfy 0 <= paidAmount <= amount.
  // F7 / W3 M-2: a NUMBER is rejected by the server (400) — paid
  // amounts are recorded only via the payment endpoint, backed by a
  // MaintenanceExpensePayment record.
  paidAmount?: number | null
  mileage?: number
  vendor?: string
  note?: string
  receipt?: string | null
}

/**
 * F7 / W3 M-2 — one payment record against a maintenance expense.
 * Append-only: payments are never edited or deleted, so `paidAmount`
 * on the expense always traces to these records (and, for cash, to a
 * CashMovement in the open cash session).
 */
export interface MaintenanceExpensePayment {
  _id?: string
  supplier: string | User
  expense: string | MaintenanceExpense
  date: Date
  amount: number
  currency: string
  method: RentalPaymentMethod
  reference?: string
  note?: string
  // F7 / W3 M-2 — the confirmed cash-session Out created from this
  // payment when method is cash (null when no open session in the
  // same currency existed; the payment still records, unlinked).
  cashMovement?: string | null
  actor?: string | User
  createdAt?: Date
  updatedAt?: Date
}

export interface CreateMaintenanceExpensePaymentPayload {
  date: Date | string
  amount: number
  method: RentalPaymentMethod
  reference?: string
  note?: string
}

/**
 * F7 / W3 M-7 — append-only audit trail for maintenance expenses,
 * following the RentalPayment pattern (the payment ledger is
 * append-only; expenses now get the same treatment). The `expense`
 * id is kept after the expense is deleted, so the trail survives
 * a hard delete.
 */
export enum MaintenanceExpenseAuditAction {
  Created = 'created',
  Updated = 'updated',
  Deleted = 'deleted',
}

export interface MaintenanceExpenseAudit {
  _id?: string
  supplier: string | User
  expense: string
  action: MaintenanceExpenseAuditAction
  actor?: string | User
  reason?: string
  changes?: Array<{ field: string, before?: string | number | null, after?: string | number | null }>
  createdAt?: Date
  updatedAt?: Date
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
  nextDueDate?: Date
  nextDueMileage?: number
  status: MaintenanceScheduleStatus
  // F7 / W3 M-4 — live-computed by the server (present()): whether the
  // schedule is overdue by mileage, and the effective next-due mileage
  // (stored nextDueMileage, else lastServiceMileage + intervalKm).
  dueByMileage?: boolean
  effectiveNextDueMileage?: number | null
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

// GAP-MAINT-P0-2 — "Complete service": close the work order, record
// the service date/odometer, complete the schedule, roll the next
// interval forward, update the car's odometer — in one call.
export interface CompleteServicePayload {
  workOrderId?: string
  serviceDate?: Date | string
  odometerKm?: number
  note?: string
}

export interface CompleteServiceResult {
  schedule: MaintenanceSchedule
  nextSchedule: MaintenanceSchedule | null
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
  // F6 / W3 C-7 — the cash session this cash-method payment was linked
  // into (the drawer movement created for it, if any). Unset when no
  // open cash session existed at posting/confirmation time; the payment
  // is then listed as unlinked by the journal reconciliation until an
  // operator links it.
  cashSession?: string | CashSession
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
  // F6 / W3 P-8 — an explicit 'debit' records a manual debit /
  // standalone refund entry (ledger only, source forced to Adjustment,
  // accountant-or-above only, reason required). Omitted means credit.
  direction?: RentalPaymentDirection
  reason?: string
  idempotencyKey?: string
  providerReference?: string
  reference?: string
  note?: string
}

// F6 / W3 P-8 — edit of a stuck Pending ledger entry (never-posted
// money only): the fields an operator may correct before the entry can
// confirm. Posted/Reversed entries are append-only and cannot be edited.
export interface UpdateRentalPaymentPayload {
  date?: Date
  amount?: number
  method?: RentalPaymentMethod
  purpose?: RentalPaymentPurpose
  reference?: string
  note?: string
}

// F6 / W3 X-1 — server-side pagination envelope for the finance list
// endpoints (payments, invoices, expenses, cash sessions/movements).
// `total` is the full filtered count, not the page size.
export interface PagedResult<T> {
  rows: T[]
  total: number
  page: number
  size: number
}

// F6 / W3 C-5 — one cash-journal row: a session movement (confirmed or
// pending), enriched with its linked ledger payment when the movement
// was created from one (C-7). Deposits are identified by `purpose`, so
// the journal can keep them out of income.
export interface CashJournalRow {
  id: string
  date: Date
  direction: CashMovementDirection
  source: CashMovementSource
  status: 'pending' | 'confirmed'
  purpose?: RentalPaymentPurpose
  reference?: string
  note?: string
  amount: number
  rentalPayment?: string
  bookingReference?: string
}

// F6 / W3 C-5 — journal headline figures, all computed server-side from
// the session's movements under one scope. Only settled/confirmed
// movements count: pending entries are reported separately and never in
// income/expenses; deposit-purpose cash is held as a liability, never
// income; net = income − expenses (deposits excluded). expectedBalance
// is the drawer's expected close (opening + income + deposits −
// expenses) under the same confirmed-only rule close() uses.
export interface CashJournalTotals {
  openingBalance: number
  income: number
  expenses: number
  deposits: number
  net: number
  pendingIn: number
  pendingOut: number
  expectedBalance: number
  currency: string
}

// F6 / W3 C-7 — a cash-method ledger payment with no drawer movement
// (posted while no cash session was open, or before the linkage
// existed). Listed by the journal reconciliation so the two books'
// difference is visible, never silently dropped.
export interface UnlinkedCashPaymentRow {
  id: string
  date: Date
  bookingReference?: string
  purpose: RentalPaymentPurpose
  direction: RentalPaymentDirection
  status: RentalPaymentStatus
  amount: number
  currency: string
}

export interface CashJournalResponse {
  session: CashSession
  rows: CashJournalRow[]
  totals: CashJournalTotals
  unlinkedCashPayments: UnlinkedCashPaymentRow[]
  unlinkedCashTotal: number
  total: number
  page: number
  size: number
}

// F6 / W3 P-3 — one row of the shared outstanding/receivable table:
// the same definition every surface uses (see
// utils/contractReceivable.ts): outstanding = max(0, rentalTotal +
// APPROVED charges − posted rent), overdue only once the due date
// (rental end) has passed. Deposits are held, never netted.
export interface OverdueReceivableRow {
  booking: Booking
  outstandingBalance: number
  depositHeld: number
  dueAt?: Date
  overdue: boolean
  currency: string
}

export interface OverdueReceivableResponse {
  metricDictionaryVersion: string
  rows: OverdueReceivableRow[]
  outstandingTotal: number
  overdueTotal: number
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

// F8 / W5 N3 — notification templates + delivery log. One template key
// per notification kind; the delivery log records every send attempt
// (in-app, email, push) per recipient so a failed send can be retried.
export type NotificationTemplateKey =
  | 'auto.pickup'
  | 'auto.return'
  | 'auto.overdue'
  | 'auto.expiry'
  | 'weekly.recap'
  | 'reminder.manual'
  | 'contract.signed'

export type NotificationDeliveryChannel = 'inApp' | 'email' | 'push'

export type NotificationDeliveryStatus = 'queued' | 'sent' | 'failed'

export interface NotificationDelivery {
  _id?: string
  supplier: string | User
  templateKey: NotificationTemplateKey
  subjectType?: string
  subjectId?: string
  // Exactly-once key for the event (e.g. `pickup:<bookingId>:2026-11-17`);
  // the unique index covers templateKey + subjectType + subjectId +
  // dedupeKey + channel + recipient.
  dedupeKey: string
  channel: NotificationDeliveryChannel
  recipient: string | User
  subject?: string
  body: string
  status: NotificationDeliveryStatus
  attempts: number
  lastError?: string
  providerId?: string
  sentAt?: Date | string
  createdAt?: Date
  updatedAt?: Date
}

export interface ResultData<T> {
  pageInfo: { totalRecords: number }
  resultData: T[]
  // Fleet statuses (scorecard #15): per-status counts over the same
  // filtered set as the list (before the fleetStatus filter itself).
  fleetStatusCounts?: FleetStatusCounts
}

export type Result<T> = [ResultData<T>] | [] | undefined | null

/** F5b (W2-04): client-list filters (Clients page toolbar). */
export interface ClientListFilters {
  clientStatus?: ClientStatus | string
  clientType?: ClientType | string
  missingDocs?: boolean
  hasContracts?: boolean
}

export interface GetUsersBody {
  user: string
  types: UserType[]
  filters?: ClientListFilters
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
  recaptchaToken?: string
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

// F8 / W5 S1 — connections status for /settings: booleans only, no
// secrets. `true` means the credential is present in the environment.
export interface SettingsConnections {
  stripe: boolean
  paypal: boolean
  smtp: boolean
  push: boolean
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
 * F5b (W2-15): `rolledBack` is true when a commit-phase failure
 * stopped the run and the rows created so far were rolled back.
 */
export interface ImportReport {
  entity: ImportEntity
  dryRun: boolean
  totalRows: number
  validRows: number
  invalidRows: number
  created: number
  errors: ImportRowError[]
  rolledBack?: boolean
}

/**
 * GA-Q4-2 (#52) — agency-scoped global search (admin top bar).
 * One keyword across bookings (reference / client name), cars (name /
 * license plate) and clients (name / email / CIN). Read-only; the
 * server pins the agency scope, so the payload never widens it.
 * `suppliers` is used by platform-admin callers only (exactly as the
 * list endpoints accept it); agency callers omit it — the server
 * resolves their agency from the authenticated identity.
 */
export const GLOBAL_SEARCH_PER_GROUP_LIMIT = 6
export const GLOBAL_SEARCH_MAX_KEYWORD_LENGTH = 100

export interface GlobalSearchPayload {
  keyword: string
  suppliers?: string[]
}

export interface GlobalSearchHit {
  id: string
  label: string
  subtitle: string
  link: string
}

export interface GlobalSearchResult {
  bookings: GlobalSearchHit[]
  cars: GlobalSearchHit[]
  clients: GlobalSearchHit[]
}
