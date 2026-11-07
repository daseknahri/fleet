import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Booking from '../src/models/Booking'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import Invoice from '../src/models/Invoice'
import Approval from '../src/models/Approval'
import ContractCharge from '../src/models/ContractCharge'
import RentalPayment from '../src/models/RentalPayment'
import CashSession from '../src/models/CashSession'
import CashMovement from '../src/models/CashMovement'
import AgencyMembership from '../src/models/AgencyMembership'

// GA-P1-APPROVALS-PRODUCER-02 — end-to-end proof of the approvals producer
// wiring decided in GA-P10-DECISIONS-01 (2026-11-05, decision pack section
// 1, all defaults approved by the owner):
//   1.1 triggers: invoice issued + contract charge created
//   1.2 threshold: requests only at or above 10,000 MAD
//   1.3 deciders: Owner + Manager (existing DecideInvoices permission)
//   1.4 single decider; requester never decides their own request
//   1.5 blocking at/above threshold; counter-agent payment and cash
//       entries stay pending until an accountant or above confirms them
//   1.6 the Approval queue record is the single source of truth
// All fixtures are synthetic and removed by exact ID in afterAll
// (Approval records included — deleted through the model, as the API
// intentionally exposes no delete route).
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const ids = {
  users: [] as mongoose.Types.ObjectId[],
  memberships: [] as mongoose.Types.ObjectId[],
  cars: [] as mongoose.Types.ObjectId[],
  bookings: [] as mongoose.Types.ObjectId[],
  locations: [] as mongoose.Types.ObjectId[],
  locationValues: [] as mongoose.Types.ObjectId[],
  invoices: [] as mongoose.Types.ObjectId[],
  charges: [] as mongoose.Types.ObjectId[],
  payments: [] as mongoose.Types.ObjectId[],
  cashSessions: [] as mongoose.Types.ObjectId[],
  cashMovements: [] as mongoose.Types.ObjectId[],
}

let supplierA: any
let supplierB: any
let tokenA = ''
let tokenB = ''
let managerToken = ''
let accountantToken = ''
let counterToken = ''
let bookingBig: any
let bookingSmall: any
let bookingCashier: any

const makeUser = async (label: string, type: bookcarsTypes.UserType) => {
  const row = await new User({
    email: `ga-q10-${label}-${suffix}@test.bookcars.ma`,
    fullName: `GA Q10 ${label}`,
    language: 'en',
    type,
    active: true,
    verified: true,
    blacklisted: false,
    payLater: true,
  }).save()
  ids.users.push(row._id)
  return row
}

const makeStaff = async (label: string, role: bookcarsTypes.AgencyRole) => {
  const user = await makeUser(label, bookcarsTypes.UserType.Staff)
  const membership = await new AgencyMembership({
    supplier: supplierA._id,
    user: user._id,
    role,
    status: bookcarsTypes.AgencyMembershipStatus.Active,
  }).save()
  ids.memberships.push(membership._id)
  return user
}

const makeBooking = async (price: number, label: string) => {
  const value = await new LocationValue({ language: 'en', value: `GA Q10 ${label} ${suffix}` }).save()
  ids.locationValues.push(value._id)
  const location = await new Location({ country: new mongoose.Types.ObjectId(), values: [value._id] }).save()
  ids.locations.push(location._id)
  const car = await new Car({
    name: `GA Q10 Car ${label}`,
    supplier: supplierA._id,
    minimumAge: 21,
    locations: [location._id],
    dailyPrice: 100,
    deposit: 500,
    available: true,
    type: bookcarsTypes.CarType.Diesel,
    gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true,
    seats: 5,
    doors: 4,
    fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1,
    cancellation: 0,
    amendments: 0,
    theftProtection: 0,
    collisionDamageWaiver: 0,
    fullInsurance: 0,
    additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi,
    multimedia: [],
    rating: 5,
  }).save()
  ids.cars.push(car._id)
  const driver = await makeUser(`driver-${label}`, bookcarsTypes.UserType.User)
  const booking = await new Booking({
    supplier: supplierA._id,
    car: car._id,
    driver: driver._id,
    pickupLocation: location._id,
    dropOffLocation: location._id,
    from: new Date(Date.now() + 2 * 86400000),
    to: new Date(Date.now() + 4 * 86400000),
    status: bookcarsTypes.BookingStatus.Reserved,
    price,
    cancellation: false,
    amendments: false,
    theftProtection: false,
    collisionDamageWaiver: false,
    fullInsurance: false,
    additionalDriver: false,
  }).save()
  ids.bookings.push(booking._id)
  return booking
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplierA = await makeUser('agency-a', bookcarsTypes.UserType.Supplier)
  supplierB = await makeUser('agency-b', bookcarsTypes.UserType.Supplier)
  const manager = await makeStaff('manager', bookcarsTypes.AgencyRole.Manager)
  const accountant = await makeStaff('accountant', bookcarsTypes.AgencyRole.Accountant)
  const counter = await makeStaff('counter', bookcarsTypes.AgencyRole.CounterAgent)
  tokenA = await authHelper.encryptJWT({ id: supplierA._id.toString() })
  tokenB = await authHelper.encryptJWT({ id: supplierB._id.toString() })
  managerToken = await authHelper.encryptJWT({ id: manager._id.toString() })
  accountantToken = await authHelper.encryptJWT({ id: accountant._id.toString() })
  counterToken = await authHelper.encryptJWT({ id: counter._id.toString() })
  bookingBig = await makeBooking(20000, 'big')
  bookingSmall = await makeBooking(500, 'small')
  bookingCashier = await makeBooking(1000, 'cashier')
})

afterAll(async () => {
  await Approval.deleteMany({ supplier: supplierA._id })
  await ContractCharge.deleteMany({ _id: { $in: ids.charges } })
  await Invoice.deleteMany({ _id: { $in: ids.invoices } })
  await RentalPayment.deleteMany({ _id: { $in: ids.payments } })
  await CashMovement.deleteMany({ _id: { $in: ids.cashMovements } })
  await CashSession.deleteMany({ _id: { $in: ids.cashSessions } })
  await Booking.deleteMany({ _id: { $in: ids.bookings } })
  await Car.deleteMany({ _id: { $in: ids.cars } })
  await Location.deleteMany({ _id: { $in: ids.locations } })
  await LocationValue.deleteMany({ _id: { $in: ids.locationValues } })
  await AgencyMembership.deleteMany({ _id: { $in: ids.memberships } })
  await User.deleteMany({ _id: { $in: ids.users } })
  await databaseHelper.close()
})

const listApprovals = async (token: string) => {
  const res = await request(app).get('/api/approvals').set(env.X_ACCESS_TOKEN, token)
  expect(res.status).toBe(200)
  return res.body as any[]
}

describe('Approvals producer wiring (GA-P1-APPROVALS-PRODUCER-02)', () => {
  it('invoice issued at/above threshold produces a request; payments block until a non-requester approves', async () => {
    const created = await request(app).post('/api/invoices').set(env.X_ACCESS_TOKEN, tokenA)
      .send({ booking: bookingBig._id.toString() })
    expect(created.status).toBe(201)
    const invoiceId = created.body._id
    ids.invoices.push(invoiceId)
    expect(created.body.total).toBe(20000)

    const issued = await request(app).post(`/api/invoices/${invoiceId}/issue`).set(env.X_ACCESS_TOKEN, tokenA).send({})
    expect(issued.status).toBe(200)
    expect(issued.body.status).toBe(bookcarsTypes.InvoiceStatus.Issued)

    const list = await listApprovals(tokenA)
    const approval = list.find((row) => row.subject === invoiceId && row.subjectType === 'invoice')
    expect(approval).toBeTruthy()
    expect(approval.status).toBe(bookcarsTypes.ApprovalDecision.Pending)
    expect(approval.amount).toBe(20000)
    // Invoice.approvalDecision* stays unused (decision 1.6)
    const storedInvoice = await Invoice.findById(invoiceId)
    expect(storedInvoice?.approvalDecision).toBeFalsy()

    const payment = await request(app).post('/api/rental-payments').set(env.X_ACCESS_TOKEN, tokenA)
      .send({
        booking: bookingBig._id.toString(), date: new Date().toISOString(), amount: 15000,
        method: bookcarsTypes.RentalPaymentMethod.Cash, idempotencyKey: `ga-q10-inv-pay-${suffix}`,
      })
    expect(payment.status).toBe(201)
    ids.payments.push(payment.body._id)

    const blocked = await request(app).post(`/api/invoices/${invoiceId}/payments`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ payment: payment.body._id })
    expect(blocked.status).toBe(409)

    const selfDecide = await request(app).post(`/api/approvals/${approval._id}/decide`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ decision: 'approved', reason: 'self attempt' })
    expect(selfDecide.status).toBe(403)

    const foreignDecide = await request(app).post(`/api/approvals/${approval._id}/decide`).set(env.X_ACCESS_TOKEN, tokenB)
      .send({ decision: 'approved', reason: 'foreign attempt' })
    expect(foreignDecide.status).toBe(404)

    const decided = await request(app).post(`/api/approvals/${approval._id}/decide`).set(env.X_ACCESS_TOKEN, managerToken)
      .send({ decision: 'approved', reason: 'producer-02 approve' })
    expect(decided.status).toBe(200)
    expect(decided.body.status).toBe(bookcarsTypes.ApprovalDecision.Approved)
    expect(decided.body.decidedBy).toBeTruthy()
    expect(decided.body.decidedAt).toBeTruthy()

    const linked = await request(app).post(`/api/invoices/${invoiceId}/payments`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ payment: payment.body._id })
    expect(linked.status).toBe(200)
    expect(linked.body.paymentStatus).toBe('partial')
  })

  it('invoice below threshold produces no request and takes payments immediately', async () => {
    const created = await request(app).post('/api/invoices').set(env.X_ACCESS_TOKEN, tokenA)
      .send({ booking: bookingSmall._id.toString() })
    expect(created.status).toBe(201)
    const invoiceId = created.body._id
    ids.invoices.push(invoiceId)

    const issued = await request(app).post(`/api/invoices/${invoiceId}/issue`).set(env.X_ACCESS_TOKEN, tokenA).send({})
    expect(issued.status).toBe(200)

    const list = await listApprovals(tokenA)
    expect(list.some((row) => row.subject === invoiceId)).toBe(false)

    const payment = await request(app).post('/api/rental-payments').set(env.X_ACCESS_TOKEN, tokenA)
      .send({
        booking: bookingSmall._id.toString(), date: new Date().toISOString(), amount: 500,
        method: bookcarsTypes.RentalPaymentMethod.Cash, idempotencyKey: `ga-q10-small-pay-${suffix}`,
      })
    expect(payment.status).toBe(201)
    ids.payments.push(payment.body._id)

    const linked = await request(app).post(`/api/invoices/${invoiceId}/payments`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ payment: payment.body._id })
    expect(linked.status).toBe(200)
    expect(linked.body.paymentStatus).toBe('paid')
  })

  it('contract charge at/above threshold produces a request; decisions mirror both ways', async () => {
    const charge = await request(app).post(`/api/contract-operations/${bookingBig._id}/charges`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ type: bookcarsTypes.ContractChargeType.Damage, reason: 'GA Q10 producer charge one', amount: 12000, currency: 'MAD' })
    expect(charge.status).toBe(201)
    ids.charges.push(charge.body._id)

    const list = await listApprovals(tokenA)
    const approval = list.find((row) => row.subject === charge.body._id && row.subjectType === 'contract-charge')
    expect(approval).toBeTruthy()
    expect(approval.status).toBe(bookcarsTypes.ApprovalDecision.Pending)

    // Decide in the domain workflow -> queue record mirrors the decision
    const decidedCharge = await request(app).post(`/api/contract-operations/${bookingBig._id}/charges/${charge.body._id}/decide`)
      .set(env.X_ACCESS_TOKEN, managerToken).send({ decision: 'approved', note: 'domain decision' })
    expect(decidedCharge.status).toBe(200)
    const afterDomain = await listApprovals(tokenA)
    expect(afterDomain.find((row) => row._id === approval._id)?.status).toBe(bookcarsTypes.ApprovalDecision.Approved)

    // Decide in the queue -> domain record mirrors the decision
    const charge2 = await request(app).post(`/api/contract-operations/${bookingBig._id}/charges`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ type: bookcarsTypes.ContractChargeType.Fee, reason: 'GA Q10 producer charge two', amount: 13000, currency: 'MAD' })
    expect(charge2.status).toBe(201)
    ids.charges.push(charge2.body._id)
    const list2 = await listApprovals(tokenA)
    const approval2 = list2.find((row) => row.subject === charge2.body._id && row.subjectType === 'contract-charge')
    expect(approval2).toBeTruthy()
    const decidedQueue = await request(app).post(`/api/approvals/${approval2._id}/decide`).set(env.X_ACCESS_TOKEN, managerToken)
      .send({ decision: 'rejected', reason: 'queue decision' })
    expect(decidedQueue.status).toBe(200)
    const storedCharge = await ContractCharge.findById(charge2.body._id)
    expect(storedCharge?.status).toBe(bookcarsTypes.ApprovalDecision.Rejected)
    expect(storedCharge?.decidedBy).toBeTruthy()

    // Below-threshold charge produces no queue request
    const charge3 = await request(app).post(`/api/contract-operations/${bookingBig._id}/charges`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ type: bookcarsTypes.ContractChargeType.Fee, reason: 'GA Q10 small charge', amount: 250, currency: 'MAD' })
    expect(charge3.status).toBe(201)
    ids.charges.push(charge3.body._id)
    const list3 = await listApprovals(tokenA)
    expect(list3.some((row) => row.subject === charge3.body._id)).toBe(false)
  })

  it('counter-agent payment entries stay pending until an accountant confirms them', async () => {
    const pending = await request(app).post('/api/rental-payments').set(env.X_ACCESS_TOKEN, counterToken)
      .send({
        booking: bookingCashier._id.toString(), date: new Date().toISOString(), amount: 300,
        method: bookcarsTypes.RentalPaymentMethod.Cash, idempotencyKey: `ga-q10-counter-pay-${suffix}`,
      })
    expect(pending.status).toBe(201)
    expect(pending.body.status).toBe(bookcarsTypes.RentalPaymentStatus.Pending)
    ids.payments.push(pending.body._id)

    // Pending does not consume the balance: the full amount still posts
    const full = await request(app).post('/api/rental-payments').set(env.X_ACCESS_TOKEN, tokenA)
      .send({
        booking: bookingCashier._id.toString(), date: new Date().toISOString(), amount: 1000,
        method: bookcarsTypes.RentalPaymentMethod.Cash, idempotencyKey: `ga-q10-owner-pay-${suffix}`,
      })
    expect(full.status).toBe(201)
    expect(full.body.status).toBe(bookcarsTypes.RentalPaymentStatus.Posted)
    ids.payments.push(full.body._id)

    // Confirming now would overpay -> 409 (allowance re-validated)
    const overConfirm = await request(app).post(`/api/rental-payments/${pending.body._id}/confirm`).set(env.X_ACCESS_TOKEN, accountantToken).send({})
    expect(overConfirm.status).toBe(409)

    // Counter agents never confirm, not even other entries
    const selfConfirm = await request(app).post(`/api/rental-payments/${pending.body._id}/confirm`).set(env.X_ACCESS_TOKEN, counterToken).send({})
    expect(selfConfirm.status).toBe(403)

    // Free the balance by reversing the owner payment, then confirm works
    const reversal = await request(app).post(`/api/rental-payments/${full.body._id}/reverse`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ idempotencyKey: `ga-q10-owner-rev-${suffix}`, note: 'GA Q10 free balance' })
    expect(reversal.status).toBe(201)
    ids.payments.push(reversal.body._id)

    const confirmed = await request(app).post(`/api/rental-payments/${pending.body._id}/confirm`).set(env.X_ACCESS_TOKEN, accountantToken).send({})
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.status).toBe(bookcarsTypes.RentalPaymentStatus.Posted)
    expect(confirmed.body.confirmedBy).toBeTruthy()
    expect(confirmed.body.confirmedAt).toBeTruthy()

    const reconfirm = await request(app).post(`/api/rental-payments/${pending.body._id}/confirm`).set(env.X_ACCESS_TOKEN, accountantToken).send({})
    expect(reconfirm.status).toBe(409)
  })

  it('counter-agent cash entries stay pending and out of the balance until confirmed', async () => {
    const open = await request(app).post('/api/cash/sessions').set(env.X_ACCESS_TOKEN, tokenA)
      .send({ account: bookcarsTypes.CashAccountType.Cash, openingBalance: 1000 })
    expect(open.status).toBe(201)
    const sessionId = open.body._id
    ids.cashSessions.push(sessionId)

    const movement = await request(app).post(`/api/cash/sessions/${sessionId}/movements`).set(env.X_ACCESS_TOKEN, counterToken)
      .send({
        date: new Date().toISOString(), direction: bookcarsTypes.CashMovementDirection.In, amount: 500,
        source: bookcarsTypes.CashMovementSource.Manual, idempotencyKey: `ga-q10-counter-cash-${suffix}`, reference: 'GA Q10 counter cash',
      })
    expect(movement.status).toBe(201)
    expect(movement.body.status).toBe('pending')
    ids.cashMovements.push(movement.body._id)

    // Close before confirmation: pending entry excluded from the expected balance
    const closed = await request(app).post(`/api/cash/sessions/${sessionId}/close`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ countedClosingBalance: 1000 })
    expect(closed.status).toBe(200)
    expect(closed.body.expectedClosingBalance).toBe(1000)
    expect(closed.body.discrepancy).toBe(0)

    // Second session: confirm first, then the entry counts
    const open2 = await request(app).post('/api/cash/sessions').set(env.X_ACCESS_TOKEN, tokenA)
      .send({ account: bookcarsTypes.CashAccountType.Bank, openingBalance: 1000 })
    expect(open2.status).toBe(201)
    const session2Id = open2.body._id
    ids.cashSessions.push(session2Id)

    const movement2 = await request(app).post(`/api/cash/sessions/${session2Id}/movements`).set(env.X_ACCESS_TOKEN, counterToken)
      .send({
        date: new Date().toISOString(), direction: bookcarsTypes.CashMovementDirection.In, amount: 500,
        source: bookcarsTypes.CashMovementSource.Manual, idempotencyKey: `ga-q10-counter-cash2-${suffix}`, reference: 'GA Q10 counter cash 2',
      })
    expect(movement2.status).toBe(201)
    ids.cashMovements.push(movement2.body._id)

    const confirm = await request(app).post(`/api/cash/sessions/${session2Id}/movements/${movement2.body._id}/confirm`).set(env.X_ACCESS_TOKEN, managerToken).send({})
    expect(confirm.status).toBe(200)
    expect(confirm.body.status).toBe('confirmed')
    expect(confirm.body.confirmedBy).toBeTruthy()

    const closed2 = await request(app).post(`/api/cash/sessions/${session2Id}/close`).set(env.X_ACCESS_TOKEN, tokenA)
      .send({ countedClosingBalance: 1500 })
    expect(closed2.status).toBe(200)
    expect(closed2.body.expectedClosingBalance).toBe(1500)
    expect(closed2.body.discrepancy).toBe(0)
  })
})
