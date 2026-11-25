import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as types from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import AgencyMembership from '../src/models/AgencyMembership'
import Car from '../src/models/Car'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import ContractCharge from '../src/models/ContractCharge'
import MaintenanceExpense from '../src/models/MaintenanceExpense'
import CashSession from '../src/models/CashSession'
import CashMovement from '../src/models/CashMovement'

// F6 — CASH & LEDGER BOOKS (W3 C-2, C-5, P-3, P-7, C-1, C-4, C-7, P-8,
// X-1). Mongo-backed, one supplier agency; the supplier user acts as
// Owner (all agency permissions), the staff user as CounterAgent
// (RecordPayments + RecordCash only — pending entries, never confirm
// or close). Fixtures are synthetic and removed by exact ID /
// idempotency-key prefix in afterAll. Tests run in file order and
// share the fixture bookings; later tests use fresh bookings of their
// own so the P-3 figures (asserted first) stay exact.
//
// One open session per (supplier, account) is enforced by the API, and
// C-1 chains each opening from the previous counted close, so an
// afterEach closes any session a test left open (counted = expected,
// pending carried with a reason) to keep the tests independent.

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let keyCounter = 0
const key = (prefix: string) => `f6-${prefix}-${suffix}-${keyCounter++}`

let supplier: env.User
let ownerToken: string
let counterToken: string
let carDeposit: env.Car
let carNoDeposit: env.Car
let booking1: env.Booking
let bookingOverdue: env.Booking
let bookingCharges: env.Booking
let bookingLegacy: env.Booking
let bookingLegacyNoDeposit: env.Booking
const ids: mongoose.Types.ObjectId[] = []
const membershipIds: mongoose.Types.ObjectId[] = []

const get = (token: string, url: string) => request(app).get(url).set(env.X_ACCESS_TOKEN, token)
const post = (token: string, url: string, body: unknown) => request(app).post(url).set(env.X_ACCESS_TOKEN, token).send(body as object)
const patch = (token: string, url: string, body: unknown) => request(app).patch(url).set(env.X_ACCESS_TOKEN, token).send(body as object)
const del = (token: string, url: string) => request(app).delete(url).set(env.X_ACCESS_TOKEN, token)

const snapshot = (rentalTotal: number, depositAmount: number) => ({
  version: 1,
  baseCurrency: env.BASE_CURRENCY,
  paymentCurrency: env.BASE_CURRENCY,
  mode: types.CheckoutPaymentMode.Deposit,
  rentalTotal,
  depositAmount,
  amountDueNow: rentalTotal,
  amountDueNowInPaymentCurrency: rentalTotal,
  quotedAt: new Date(),
})

const makeCar = async (label: string, deposit: number) => {
  const car = await new Car({
    name: `F6 ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [new mongoose.Types.ObjectId()], dailyPrice: 100, deposit,
    available: true, type: types.CarType.Diesel, gearbox: types.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: types.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: types.CarRange.Midi, multimedia: [], rating: 5,
  }).save()
  ids.push(car._id)
  return car
}

const makeBooking = async (car: env.Car, price: number, snap: ReturnType<typeof snapshot> | null, to: Date) => {
  const booking = await new Booking({
    supplier: supplier._id, car: car._id, driver: new mongoose.Types.ObjectId(),
    pickupLocation: new mongoose.Types.ObjectId(), dropOffLocation: new mongoose.Types.ObjectId(),
    from: new Date(Date.now() - 86400000), to, status: types.BookingStatus.Reserved,
    price, lifecycle: types.ContractLifecycle.Confirmed,
    cancellation: false, amendments: false, theftProtection: false,
    collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
    ...(snap ? { financialSnapshot: snap } : {}),
  }).save()
  ids.push(booking._id)
  return booking
}

const makePostedPayment = async (booking: env.Booking, amount: number, purpose: types.RentalPaymentPurpose, prefix: string) => {
  const payment = await new RentalPayment({
    supplier: supplier._id, booking: booking._id, date: new Date(), amount,
    currency: env.BASE_CURRENCY, method: types.RentalPaymentMethod.Cash,
    purpose, direction: types.RentalPaymentDirection.Credit,
    source: types.RentalPaymentSource.Manual, status: types.RentalPaymentStatus.Posted,
    idempotencyKey: key(prefix),
  }).save()
  ids.push(payment._id)
  return payment
}

// Open a Cash session. An explicit opening that differs from the
// chained previous close needs a reason (C-1), so one is always sent.
const openSession = async (openingBalance?: number) => {
  const body: Record<string, unknown> = { account: types.CashAccountType.Cash }
  if (openingBalance !== undefined) {
    body.openingBalance = openingBalance
    body.openingDifferenceReason = 'F6 fixture'
  }
  const res = await post(ownerToken, '/api/cash/sessions', body)
  expect(res.status).toBe(201)
  return res.body as { _id: string, openingBalance: number, expectedClosingBalance?: number }
}

const addMovement = async (sessionId: string, body: Record<string, unknown>, token = ownerToken) => {
  const res = await post(token, `/api/cash/sessions/${sessionId}/movements`, { date: new Date().toISOString(), ...body })
  return res
}

const closeSession = async (sessionId: string, body: Record<string, unknown>) => {
  const res = await post(ownerToken, `/api/cash/sessions/${sessionId}/close`, body)
  return res
}

const journal = async (sessionId: string) => {
  const res = await get(ownerToken, `/api/cash/journal?sessionId=${sessionId}`)
  expect(res.status).toBe(200)
  return res.body as {
    totals: { openingBalance: number, income: number, expenses: number, deposits: number, net: number, pendingIn: number, pendingOut: number, expectedBalance: number, currency: string },
    rows: Array<{ id: string, direction: string, source: string, status: string, purpose?: string, amount: number, rentalPayment?: string }>,
    unlinkedCashPayments: Array<{ id: string, amount: number }>,
    unlinkedCashTotal: number,
  }
}

const createPayment = async (body: Record<string, unknown>, token = ownerToken) => {
  const res = await post(token, '/api/rental-payments', { date: new Date().toISOString(), currency: env.BASE_CURRENCY, method: types.RentalPaymentMethod.Cash, idempotencyKey: key('pay'), ...body })
  return res
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplier = await new User({
    email: `f6-${suffix}@test.bookcars.ma`, fullName: 'F6 Fixture', language: 'en',
    type: types.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  }).save()
  ids.push(supplier._id)
  ownerToken = await authHelper.encryptJWT({ id: supplier._id.toString() })
  const counter = await new User({
    email: `f6-counter-${suffix}@test.bookcars.ma`, fullName: 'F6 Counter', language: 'en',
    type: types.UserType.Staff, active: true, verified: true, blacklisted: false, payLater: true,
  }).save()
  ids.push(counter._id)
  counterToken = await authHelper.encryptJWT({ id: counter._id.toString() })
  const membership = await new AgencyMembership({
    supplier: supplier._id, user: counter._id,
    role: types.AgencyRole.CounterAgent, status: types.AgencyMembershipStatus.Active,
  }).save()
  membershipIds.push(membership._id)

  carDeposit = await makeCar('deposit car', 200)
  carNoDeposit = await makeCar('no-deposit car', 0)
  const tomorrow = new Date(Date.now() + 86400000)
  const yesterday = new Date(Date.now() - 86400000)
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000)
  // booking1: rent 500, deposit 200; 300 rent + 100 deposit posted.
  // Outstanding 200, due tomorrow -> in the receivables table, not overdue.
  booking1 = await makeBooking(carDeposit, 500, snapshot(500, 200), tomorrow)
  await makePostedPayment(booking1, 300, types.RentalPaymentPurpose.Rent, 'fixture-rent')
  await makePostedPayment(booking1, 100, types.RentalPaymentPurpose.Deposit, 'fixture-deposit')
  // Overdue, no payments: outstanding 400, overdue.
  bookingOverdue = await makeBooking(carDeposit, 400, snapshot(400, 0), twoDaysAgo)
  // Charges included: 300 rent + 50 approved charge - 100 posted = 250 overdue.
  bookingCharges = await makeBooking(carDeposit, 300, snapshot(300, 0), yesterday)
  await makePostedPayment(bookingCharges, 100, types.RentalPaymentPurpose.Rent, 'fixture-charges-rent')
  await new ContractCharge({
    supplier: supplier._id, booking: bookingCharges._id, type: types.ContractChargeType.Fee,
    reason: 'F6 test charge', amount: 50, currency: env.BASE_CURRENCY,
    status: types.ApprovalDecision.Approved,
  }).save()
  // Snapshot-less legacy bookings: the deposit cap is the car's deposit.
  bookingLegacy = await makeBooking(carDeposit, 600, null, tomorrow)
  bookingLegacyNoDeposit = await makeBooking(carNoDeposit, 600, null, tomorrow)
})

afterEach(async () => {
  // Close any session a test left open so the next test starts clean
  // (one open session per account; C-1 chains the next opening from
  // this close, which is exactly the state the C-1 tests rely on).
  const current = await get(ownerToken, '/api/cash/sessions/current?account=cash')
  if (current.status === 200 && current.body) {
    const j = await journal(current.body._id)
    await closeSession(current.body._id, {
      countedClosingBalance: j.totals.expectedBalance,
      closingNote: 'F6 test cleanup',
      acknowledgePending: true,
      pendingCarryReason: 'F6 test cleanup',
    })
  }
})

afterAll(async () => {
  await RentalPayment.deleteMany({ idempotencyKey: { $regex: `^f6-.*-${suffix}` } })
  await ContractCharge.deleteMany({ supplier: supplier._id })
  await MaintenanceExpense.deleteMany({ supplier: supplier._id })
  await CashMovement.deleteMany({ supplier: supplier._id })
  await CashSession.deleteMany({ supplier: supplier._id })
  await Booking.deleteMany({ _id: { $in: ids } })
  await Car.deleteMany({ _id: { $in: ids } })
  await AgencyMembership.deleteMany({ _id: { $in: membershipIds } })
  await User.deleteMany({ _id: { $in: ids } })
  await databaseHelper.close()
})

describe('F6 / W3 C-2 — manual cash Out balance check', () => {
  it('refuses a manual Out that would drive the expected balance negative, naming the balance', async () => {
    const session = await openSession(100)
    const inRes = await addMovement(session._id, { direction: 'in', amount: 50, source: 'manual', note: 'F6 in' })
    expect(inRes.status).toBe(201)
    // Expected balance is 150; an Out of 200 must refuse 409.
    const outRes = await addMovement(session._id, { direction: 'out', amount: 200, source: 'manual', note: 'F6 overdraw' })
    expect(outRes.status).toBe(409)
    expect(String(outRes.text)).toContain('150.00')
    // The session is NOT bricked: it still closes at the true balance.
    const closed = await closeSession(session._id, { countedClosingBalance: 150, closingNote: 'F6 C-2' })
    expect(closed.status).toBe(200)
    expect(closed.body.expectedClosingBalance).toBe(150)
  })

  it('allows a manual Out equal to the expected balance', async () => {
    const session = await openSession(150)
    const outRes = await addMovement(session._id, { direction: 'out', amount: 150, source: 'manual', note: 'F6 exact' })
    expect(outRes.status).toBe(201)
    const closed = await closeSession(session._id, { countedClosingBalance: 0, closingNote: 'F6 C-2 exact' })
    expect(closed.status).toBe(200)
    expect(closed.body.expectedClosingBalance).toBe(0)
  })

  it('a pending Out stays pending when its confirmation would drive the balance negative', async () => {
    const session = await openSession(100)
    const pending = await addMovement(session._id, { direction: 'out', amount: 150, source: 'manual', note: 'F6 pending overdraw' }, counterToken)
    expect(pending.status).toBe(201)
    expect(pending.body.status).toBe('pending')
    const confirm = await post(ownerToken, `/api/cash/sessions/${session._id}/movements/${pending.body._id}/confirm`, {})
    expect(confirm.status).toBe(409)
    expect(String(confirm.text)).toContain('100.00')
    const movements = await get(ownerToken, `/api/cash/sessions/${session._id}/movements`)
    expect(movements.status).toBe(200)
    expect(movements.body.find((m: { _id: string }) => m._id === pending.body._id)?.status).toBe('pending')
    // The session still closes with the entry explicitly carried.
    const closed = await closeSession(session._id, { countedClosingBalance: 100, closingNote: 'F6 C-2 pending', acknowledgePending: true, pendingCarryReason: 'F6 pending overdraw carried' })
    expect(closed.status).toBe(200)
  })

  it('refuses a movement dated before the session opened', async () => {
    const session = await openSession(100)
    const res = await addMovement(session._id, { direction: 'in', amount: 10, source: 'manual', date: new Date(Date.now() - 86400000).toISOString() })
    expect(res.status).toBe(400)
    await closeSession(session._id, { countedClosingBalance: 100, closingNote: 'F6 C-2 date' })
  })
})

describe('F6 / W3 C-5 — server-side cash journal', () => {
  it('journal totals count confirmed income/expenses only; deposits held, pending listed never counted', async () => {
    const session = await openSession(1000)
    // Manual income 200, manual expense 50.
    expect((await addMovement(session._id, { direction: 'in', amount: 200, source: 'manual', note: 'F6 manual in' })).status).toBe(201)
    expect((await addMovement(session._id, { direction: 'out', amount: 50, source: 'manual', note: 'F6 manual out' })).status).toBe(201)
    // Pending expense 30 (counter agent): listed, never counted.
    const pending = await addMovement(session._id, { direction: 'out', amount: 30, source: 'manual', note: 'F6 pending out' }, counterToken)
    expect(pending.status).toBe(201)
    expect(pending.body.status).toBe('pending')
    // A rent collection 80 (linked In, income) and a deposit 100
    // (linked In, held — never income) on a fresh booking.
    const fresh = await makeBooking(carDeposit, 300, snapshot(300, 100), new Date(Date.now() + 86400000))
    const rent = await createPayment({ booking: fresh._id.toString(), amount: 80, purpose: 'rent' })
    expect(rent.status).toBe(201)
    const deposit = await createPayment({ booking: fresh._id.toString(), amount: 100, purpose: 'deposit' })
    expect(deposit.status).toBe(201)
    // Reversing the rent creates a compensating Out 80 (expense), so
    // the drawer nets the annulled pair exactly like the ledger.
    const reversal = await post(ownerToken, `/api/rental-payments/${rent.body._id}/reverse`, { idempotencyKey: key('rev'), note: 'F6 reversal' })
    expect(reversal.status).toBe(201)
    const j = await journal(session._id)
    expect(j.totals.income).toBe(280)
    expect(j.totals.expenses).toBe(130)
    expect(j.totals.deposits).toBe(100)
    expect(j.totals.net).toBe(150)
    expect(j.totals.pendingIn).toBe(0)
    expect(j.totals.pendingOut).toBe(30)
    expect(j.totals.expectedBalance).toBe(1250)
    const linkedRent = j.rows.find((row) => row.rentalPayment === rent.body._id)
    expect(linkedRent?.direction).toBe('in')
    expect(linkedRent?.amount).toBe(80)
    const compensating = j.rows.find((row) => row.rentalPayment === reversal.body._id)
    expect(compensating?.direction).toBe('out')
    expect(compensating?.amount).toBe(80)
    // Clean up the fresh booking so its outstanding never leaks into
    // the P-3 figures asserted below (the reversal nets its rent to 0,
    // but the booking itself would still list as outstanding 300).
    await RentalPayment.deleteMany({ booking: fresh._id })
    await Booking.deleteOne({ _id: fresh._id })
    await closeSession(session._id, { countedClosingBalance: 1250, closingNote: 'F6 C-5', acknowledgePending: true, pendingCarryReason: 'F6 C-5 pending carried' })
  })

  it('journal CSV carries the summary lines', async () => {
    const session = await openSession(500)
    expect((await addMovement(session._id, { direction: 'in', amount: 25, source: 'manual', note: 'F6 csv in' })).status).toBe(201)
    const csv = await get(ownerToken, `/api/cash/journal.csv?sessionId=${session._id}`)
    expect(csv.status).toBe(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.text).toContain('date,direction,source,status,purpose,reference,note,amount,currency,linkedPayment,bookingReference')
    // The CSV follows the exportPaymentsCsv escaping pattern (every
    // field quoted) with the currency on the summary lines — F6-REPORT
    // C-5 — so the summary lines are the quoted 4-field form, not the
    // unquoted 3-field form.
    expect(csv.text).toContain(`"summary","income","25.00","${env.BASE_CURRENCY}"`)
    expect(csv.text).toContain(`"summary","expectedBalance","525.00","${env.BASE_CURRENCY}"`)
    await closeSession(session._id, { countedClosingBalance: 525, closingNote: 'F6 C-5 csv' })
  })

  it('a cash payment posted with no open session is listed as unlinked in the next session journal', async () => {
    // No session is open here (afterEach closed the previous one).
    const current = await get(ownerToken, '/api/cash/sessions/current?account=cash')
    expect(current.body).toBeNull()
    const fresh = await makeBooking(carDeposit, 200, snapshot(200, 0), new Date(Date.now() + 86400000))
    const payment = await createPayment({ booking: fresh._id.toString(), amount: 50, purpose: 'rent' })
    expect(payment.status).toBe(201)
    expect(payment.body.cashSession).toBeUndefined()
    const session = await openSession()
    const j = await journal(session._id)
    expect(j.unlinkedCashPayments.some((row) => row.id === payment.body._id)).toBe(true)
    expect(j.unlinkedCashTotal).toBeGreaterThanOrEqual(50)
    await RentalPayment.deleteMany({ booking: fresh._id })
    await Booking.deleteOne({ _id: fresh._id })
  })
})

describe('F6 / W3 P-3 — one shared outstanding / receivable definition', () => {
  it('overdue endpoint uses the shared charges-included definition', async () => {
    const res = await get(ownerToken, '/api/rental-payments/overdue')
    expect(res.status).toBe(200)
    expect(res.body.metricDictionaryVersion).toBe('2026-11-25.1')
    // F7 — the pin tracks the dictionary version (bumped for the shared
    // receivable + cash-basis net). The outstanding figures below are
    // unchanged.
    const rows = res.body.rows as Array<{ booking: { _id: string }, outstandingBalance: number, depositDue: number, dueAt?: string, overdue: boolean }>
    const byId = new Map(rows.map((row) => [row.booking._id, row]))
    // booking1: 500 - 300 posted rent = 200 outstanding, due tomorrow.
    expect(byId.get(booking1._id.toString())?.outstandingBalance).toBe(200)
    expect(byId.get(booking1._id.toString())?.overdue).toBe(false)
    expect(byId.get(booking1._id.toString())?.depositDue).toBe(100)
    // bookingOverdue: 400 outstanding, overdue.
    expect(byId.get(bookingOverdue._id.toString())?.outstandingBalance).toBe(400)
    expect(byId.get(bookingOverdue._id.toString())?.overdue).toBe(true)
    // bookingCharges: 300 + 50 approved charge - 100 posted = 250 overdue.
    // The old Payments table omitted the charge and would have said 200.
    expect(byId.get(bookingCharges._id.toString())?.outstandingBalance).toBe(250)
    expect(byId.get(bookingCharges._id.toString())?.overdue).toBe(true)
    // Snapshot-less legacy bookings: 600 each, due tomorrow, not overdue.
    expect(byId.get(bookingLegacy._id.toString())?.outstandingBalance).toBe(600)
    expect(byId.get(bookingLegacy._id.toString())?.overdue).toBe(false)
    expect(byId.get(bookingLegacyNoDeposit._id.toString())?.outstandingBalance).toBe(600)
    expect(rows.length).toBe(5)
    expect(res.body.outstandingTotal).toBe(2050)
    expect(res.body.overdueTotal).toBe(650)
  })
})

describe('F6 / W3 P-7 — deposit on snapshot-less legacy bookings', () => {
  it('records a deposit up to the car deposit', async () => {
    const res = await createPayment({ booking: bookingLegacy._id.toString(), amount: 150, purpose: 'deposit' })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('posted')
  })

  it('refuses a deposit on a snapshot-less booking with no car deposit, naming the absence', async () => {
    const res = await createPayment({ booking: bookingLegacyNoDeposit._id.toString(), amount: 50, purpose: 'deposit' })
    expect(res.status).toBe(400)
    expect(String(res.text)).toContain('No refundable deposit is recorded for this booking')
  })

  it('refuses a deposit above the car deposit', async () => {
    // 150 already recorded above; the car cap is 200, so 100 more overpays.
    const res = await createPayment({ booking: bookingLegacy._id.toString(), amount: 100, purpose: 'deposit' })
    expect(res.status).toBe(400)
    expect(String(res.text)).toContain('refundable deposit allowance')
  })
})

describe('F6 / W3 C-1 — chained opening balance', () => {
  it('chains the opening from the previous counted close; an unexplained difference is refused, a reasoned one is stored', async () => {
    const a = await openSession(500)
    expect((await addMovement(a._id, { direction: 'in', amount: 100, source: 'manual', note: 'F6 chain in' })).status).toBe(201)
    const closedA = await closeSession(a._id, { countedClosingBalance: 600, closingNote: 'F6 chain A' })
    expect(closedA.status).toBe(200)
    expect(closedA.body.countedClosingBalance).toBe(600)
    const prev = await get(ownerToken, '/api/cash/sessions/previous-close?account=cash')
    expect(prev.status).toBe(200)
    expect(prev.body.countedClosingBalance).toBe(600)
    // Omitted opening chains to 600.
    const bRes = await post(ownerToken, '/api/cash/sessions', { account: 'cash' })
    expect(bRes.status).toBe(201)
    expect(bRes.body.openingBalance).toBe(600)
    expect(bRes.body.previousClosingBalance).toBe(600)
    const closedB = await closeSession(bRes.body._id, { countedClosingBalance: 600, closingNote: 'F6 chain B' })
    expect(closedB.status).toBe(200)
    // An explicit 550 that differs from the 600 chain needs a reason.
    const cNoReason = await post(ownerToken, '/api/cash/sessions', { account: 'cash', openingBalance: 550 })
    expect(cNoReason.status).toBe(400)
    const c = await post(ownerToken, '/api/cash/sessions', { account: 'cash', openingBalance: 550, openingDifferenceReason: 'F6 test correction' })
    expect(c.status).toBe(201)
    expect(c.body.openingBalance).toBe(550)
    expect(c.body.previousClosingBalance).toBe(600)
    expect(c.body.openingDifferenceReason).toBe('F6 test correction')
    await closeSession(c.body._id, { countedClosingBalance: 550, closingNote: 'F6 chain C' })
  })
})

describe('F6 / W3 C-4 — close surfaces pending entries and discrepancies', () => {
  it('close with pending entries is refused until they are carried with a reason; a post-close confirmation restamps the stored figures', async () => {
    const session = await openSession(500)
    const pending = await addMovement(session._id, { direction: 'out', amount: 10, source: 'manual', note: 'F6 carry me' }, counterToken)
    expect(pending.status).toBe(201)
    const refused = await closeSession(session._id, { countedClosingBalance: 500, closingNote: 'F6 carry refused' })
    expect(refused.status).toBe(409)
    expect(String(refused.text)).toContain('pending entries')
    const carried = await closeSession(session._id, {
      countedClosingBalance: 500, closingNote: 'F6 carry accepted',
      acknowledgePending: true, pendingCarryReason: 'F6 test carry',
    })
    expect(carried.status).toBe(200)
    expect(carried.body.pendingCarriedCount).toBe(1)
    expect(carried.body.pendingCarriedIn).toBe(0)
    expect(carried.body.pendingCarriedOut).toBe(10)
    expect(carried.body.pendingCarryReason).toBe('F6 test carry')
    // Confirming the carried entry after close restamps expected (490)
    // and discrepancy (500 - 490 = 10); the counted balance stands.
    const confirm = await post(ownerToken, `/api/cash/sessions/${session._id}/movements/${pending.body._id}/confirm`, {})
    expect(confirm.status).toBe(200)
    const sessions = await get(ownerToken, '/api/cash/sessions?status=closed')
    expect(sessions.status).toBe(200)
    const stored = (sessions.body as Array<{ _id: string, expectedClosingBalance: number, countedClosingBalance: number, discrepancy: number }>).find((s) => s._id === session._id)
    expect(stored?.expectedClosingBalance).toBe(490)
    expect(stored?.countedClosingBalance).toBe(500)
    expect(stored?.discrepancy).toBe(10)
  })

  it('a nonzero discrepancy needs an approved reason (tolerance is zero)', async () => {
    const session = await openSession(100)
    const refused = await closeSession(session._id, { countedClosingBalance: 90, closingNote: 'F6 shortage' })
    expect(refused.status).toBe(409)
    expect(String(refused.text)).toContain('requires approval')
    const approved = await closeSession(session._id, {
      countedClosingBalance: 90, closingNote: 'F6 shortage approved',
      discrepancyApproved: true, discrepancyReason: 'F6 test shortage',
    })
    expect(approved.status).toBe(200)
    expect(approved.body.discrepancy).toBe(-10)
    expect(approved.body.discrepancyReason).toBe('F6 test shortage')
    expect(String(approved.body.discrepancyApprovedBy)).toBe(supplier._id.toString())
    expect(approved.body.discrepancyApprovedAt).toBeTruthy()
  })
})

describe('F6 / W3 C-7 — ledger cash payments link to their cash session', () => {
  it('a posted cash payment creates a linked drawer movement', async () => {
    const session = await openSession(0)
    const fresh = await makeBooking(carDeposit, 300, snapshot(300, 0), new Date(Date.now() + 86400000))
    const payment = await createPayment({ booking: fresh._id.toString(), amount: 120, purpose: 'rent' })
    expect(payment.status).toBe(201)
    expect(payment.body.cashSession).toBe(session._id)
    const j = await journal(session._id)
    const row = j.rows.find((r) => r.rentalPayment === payment.body._id)
    expect(row?.direction).toBe('in')
    expect(row?.amount).toBe(120)
    expect(row?.purpose).toBe('rent')
    expect(row?.status).toBe('confirmed')
    expect(j.totals.expectedBalance).toBe(session.openingBalance + 120)
    await RentalPayment.deleteMany({ booking: fresh._id })
    await Booking.deleteOne({ _id: fresh._id })
  })

  it('an unlinked payment links on demand; a second link, a non-cash payment and a closed session are refused', async () => {
    const current = await get(ownerToken, '/api/cash/sessions/current?account=cash')
    expect(current.body).toBeNull()
    const fresh = await makeBooking(carDeposit, 200, snapshot(200, 0), new Date(Date.now() + 86400000))
    const payment = await createPayment({ booking: fresh._id.toString(), amount: 50, purpose: 'rent' })
    expect(payment.status).toBe(201)
    const session = await openSession()
    const linked = await post(ownerToken, `/api/rental-payments/${payment.body._id}/link-cash-session`, { cashSessionId: session._id })
    expect(linked.status).toBe(200)
    expect(linked.body.movement.session).toBe(session._id)
    const again = await post(ownerToken, `/api/rental-payments/${payment.body._id}/link-cash-session`, { cashSessionId: session._id })
    expect(again.status).toBe(409)
    const bankPayment = await createPayment({ booking: fresh._id.toString(), amount: 10, purpose: 'rent', method: 'bankTransfer' })
    expect(bankPayment.status).toBe(201)
    const bankLink = await post(ownerToken, `/api/rental-payments/${bankPayment.body._id}/link-cash-session`, { cashSessionId: session._id })
    expect(bankLink.status).toBe(409)
    const j = await journal(session._id)
    expect(j.unlinkedCashPayments.some((row) => row.id === payment.body._id)).toBe(false)
    await closeSession(session._id, { countedClosingBalance: j.totals.expectedBalance, closingNote: 'F6 C-7 link' })
    const fresh2 = await makeBooking(carDeposit, 200, snapshot(200, 0), new Date(Date.now() + 86400000))
    const payment2 = await createPayment({ booking: fresh2._id.toString(), amount: 20, purpose: 'rent' })
    expect(payment2.status).toBe(201)
    const closedLink = await post(ownerToken, `/api/rental-payments/${payment2.body._id}/link-cash-session`, { cashSessionId: session._id })
    expect(closedLink.status).toBe(404)
    await RentalPayment.deleteMany({ booking: { $in: [fresh._id, fresh2._id] } })
    await Booking.deleteMany({ _id: { $in: [fresh._id, fresh2._id] } })
  })

  it('a cash reversal creates a compensating Out movement', async () => {
    const session = await openSession(0)
    const fresh = await makeBooking(carDeposit, 300, snapshot(300, 0), new Date(Date.now() + 86400000))
    const payment = await createPayment({ booking: fresh._id.toString(), amount: 80, purpose: 'rent' })
    expect(payment.status).toBe(201)
    const reversal = await post(ownerToken, `/api/rental-payments/${payment.body._id}/reverse`, { idempotencyKey: key('rev2'), note: 'F6 cash reversal' })
    expect(reversal.status).toBe(201)
    expect(reversal.body.cashSession).toBe(session._id)
    const j = await journal(session._id)
    const out = j.rows.find((row) => row.rentalPayment === reversal.body._id)
    expect(out?.direction).toBe('out')
    expect(out?.amount).toBe(80)
    expect(j.totals.income).toBe(80)
    expect(j.totals.expenses).toBe(80)
    expect(j.totals.net).toBe(0)
    expect(j.totals.expectedBalance).toBe(session.openingBalance)
    await RentalPayment.deleteMany({ booking: fresh._id })
    await Booking.deleteOne({ _id: fresh._id })
  })

  // Audit-fix 2026-11-24 (F-01) — the original payment posted while no
  // session was open, so it has no linked movement (unlinked). Its
  // reversal must still post the compensating Out movement into the
  // open session, or the drawer stays overstated by the refund.
  it('a cash reversal of an unlinked payment creates a compensating Out movement in the open session', async () => {
    const current = await get(ownerToken, '/api/cash/sessions/current?account=cash')
    expect(current.body).toBeNull()
    const fresh = await makeBooking(carDeposit, 300, snapshot(300, 0), new Date(Date.now() + 86400000))
    const payment = await createPayment({ booking: fresh._id.toString(), amount: 80, purpose: 'rent' })
    expect(payment.status).toBe(201)
    const session = await openSession(100)
    const before = await journal(session._id)
    expect(before.unlinkedCashPayments.some((row) => row.id === payment.body._id)).toBe(true)
    const reversal = await post(ownerToken, `/api/rental-payments/${payment.body._id}/reverse`, { idempotencyKey: key('rev-unlinked'), note: 'F-01 cash reversal of unlinked payment' })
    expect(reversal.status).toBe(201)
    expect(reversal.body.cashSession).toBe(session._id)
    const j = await journal(session._id)
    const out = j.rows.find((row) => row.rentalPayment === reversal.body._id)
    expect(out?.direction).toBe('out')
    expect(out?.amount).toBe(80)
    expect(j.totals.income).toBe(0)
    expect(j.totals.expenses).toBe(80)
    expect(j.totals.expectedBalance).toBe(20)
    await RentalPayment.deleteMany({ booking: fresh._id })
    await Booking.deleteOne({ _id: fresh._id })
  })

  it('a wire reversal of an unlinked payment creates a compensating Out movement in the open bank session', async () => {
    const current = await get(ownerToken, '/api/cash/sessions/current?account=bank')
    expect(current.body).toBeNull()
    const fresh = await makeBooking(carDeposit, 300, snapshot(300, 0), new Date(Date.now() + 86400000))
    const payment = await createPayment({ booking: fresh._id.toString(), amount: 60, purpose: 'rent', method: types.RentalPaymentMethod.BankTransfer })
    expect(payment.status).toBe(201)
    const opened = await post(ownerToken, '/api/cash/sessions', { account: types.CashAccountType.Bank, openingBalance: 100, openingDifferenceReason: 'F-01 fixture' })
    expect(opened.status).toBe(201)
    const session = opened.body as { _id: string, openingBalance: number }
    const reversal = await post(ownerToken, `/api/rental-payments/${payment.body._id}/reverse`, { idempotencyKey: key('rev-unlinked-bank'), note: 'F-01 bank reversal of unlinked payment' })
    expect(reversal.status).toBe(201)
    expect(reversal.body.bankSession).toBe(session._id)
    const j = await journal(session._id)
    const out = j.rows.find((row) => row.rentalPayment === reversal.body._id)
    expect(out?.direction).toBe('out')
    expect(out?.amount).toBe(60)
    expect(j.totals.expectedBalance).toBe(40)
    await closeSession(session._id, { countedClosingBalance: j.totals.expectedBalance, closingNote: 'F-01 bank cleanup' })
    await RentalPayment.deleteMany({ booking: fresh._id })
    await Booking.deleteOne({ _id: fresh._id })
  })
})

describe('F6 / W3 P-8 — manual debit and pending entry edit / delete', () => {
  it('records a manual debit against the recorded total, ledger-only, and links a cash debit as an Out movement', async () => {
    const session = await openSession(0)
    const fresh = await makeBooking(carDeposit, 500, snapshot(500, 0), new Date(Date.now() + 86400000))
    const rent = await createPayment({ booking: fresh._id.toString(), amount: 200, purpose: 'rent' })
    expect(rent.status).toBe(201)
    const debit = await createPayment({
      booking: fresh._id.toString(), amount: 50, purpose: 'rent',
      direction: 'debit', reason: 'F6 test refund',
    })
    expect(debit.status).toBe(201)
    expect(debit.body.direction).toBe('debit')
    expect(debit.body.source).toBe('adjustment')
    expect(debit.body.status).toBe('posted')
    const j = await journal(session._id)
    const out = j.rows.find((row) => row.rentalPayment === debit.body._id)
    expect(out?.direction).toBe('out')
    expect(out?.amount).toBe(50)
    expect(j.totals.income).toBe(200)
    expect(j.totals.expenses).toBe(50)
    // A debit above the recorded total (200 rent - 50 debit = 150 net) is refused.
    const over = await createPayment({
      booking: fresh._id.toString(), amount: 200, purpose: 'rent',
      direction: 'debit', reason: 'F6 over-debit',
    })
    expect(over.status).toBe(400)
    expect(String(over.text)).toContain('Debit exceeds the recorded rental total')
    // No reason, no debit.
    const noReason = await createPayment({
      booking: fresh._id.toString(), amount: 10, purpose: 'rent', direction: 'debit',
    })
    expect(noReason.status).toBe(400)
    expect(String(noReason.text)).toContain('A reason is required for a debit entry')
    // Counter agents record credits pending only.
    const counterDebit = await createPayment({
      booking: fresh._id.toString(), amount: 10, purpose: 'rent',
      direction: 'debit', reason: 'F6 counter debit',
    }, counterToken)
    expect(counterDebit.status).toBe(403)
    await RentalPayment.deleteMany({ booking: fresh._id })
    await Booking.deleteOne({ _id: fresh._id })
  })

  it('edits and deletes a stuck Pending entry; Posted entries are append-only', async () => {
    // Q15 (owner decision 2026-11-21): the four-eyes rule is dropped, so
    // a counter agent's credit now posts at once. The only Pending
    // rental payment left is an approval-gated refund (a manual debit
    // at or above 10,000 MAD), which is what this test now edits.
    const fresh = await makeBooking(carDeposit, 20000, snapshot(20000, 0), new Date(Date.now() + 86400000))
    const posted = await createPayment({ booking: fresh._id.toString(), amount: 15000, purpose: 'rent' })
    expect(posted.status).toBe(201)
    expect(posted.body.status).toBe('posted')
    const pending = await createPayment({
      booking: fresh._id.toString(), amount: 12000, purpose: 'rent',
      direction: 'debit', reason: 'F6 big refund',
    })
    expect(pending.status).toBe(201)
    expect(pending.body.status).toBe('pending')
    const edited = await patch(ownerToken, `/api/rental-payments/${pending.body._id}`, { amount: 11000 })
    expect(edited.status).toBe(200)
    expect(edited.body.amount).toBe(11000)
    const overCap = await patch(ownerToken, `/api/rental-payments/${pending.body._id}`, { amount: 99999 })
    expect(overCap.status).toBe(409)
    const editPosted = await patch(ownerToken, `/api/rental-payments/${posted.body._id}`, { amount: 90 })
    expect(editPosted.status).toBe(409)
    const deletePosted = await del(ownerToken, `/api/rental-payments/${posted.body._id}`)
    expect(deletePosted.status).toBe(409)
    const deleted = await del(ownerToken, `/api/rental-payments/${pending.body._id}`)
    expect(deleted.status).toBe(204)
    const list = await get(ownerToken, `/api/rental-payments?booking=${fresh._id.toString()}`)
    expect(list.status).toBe(200)
    expect((list.body as Array<{ _id: string }>).some((row) => row._id === pending.body._id)).toBe(false)
    expect((list.body as Array<{ _id: string }>).some((row) => row._id === posted.body._id)).toBe(true)
    await RentalPayment.deleteMany({ booking: fresh._id })
    await Booking.deleteOne({ _id: fresh._id })
  })
})

describe('F6 / W3 X-1 — server-side pagination on the finance lists', () => {
  it('payments list paginates with filters and rejects invalid page/size', async () => {
    const fresh = await makeBooking(carDeposit, 500, snapshot(500, 0), new Date(Date.now() + 86400000))
    // Dates in the near future, newest first: the three fresh payments
    // are then the three newest rows overall, so the page order is
    // deterministic regardless of what earlier tests recorded.
    const now = Date.now()
    const amounts = [33, 22, 11]
    for (let i = 0; i < amounts.length; i++) {
      const res = await createPayment({
        booking: fresh._id.toString(), amount: amounts[i], purpose: 'rent',
        date: new Date(now + (3 - i) * 3600000).toISOString(),
      })
      expect(res.status).toBe(201)
    }
    const page1 = await get(ownerToken, '/api/rental-payments?page=1&size=2')
    expect(page1.status).toBe(200)
    expect(page1.body.rows.length).toBe(2)
    expect(page1.body.total).toBeGreaterThanOrEqual(3)
    expect(page1.body.page).toBe(1)
    expect(page1.body.size).toBe(2)
    expect(page1.body.rows[0].amount).toBe(33)
    expect(page1.body.rows[1].amount).toBe(22)
    const page2 = await get(ownerToken, '/api/rental-payments?page=2&size=2')
    expect(page2.status).toBe(200)
    expect(page2.body.rows[0].amount).toBe(11)
    // Filters: only posted rows; an unknown status is a 400, not a silent empty page.
    const posted = await get(ownerToken, '/api/rental-payments?page=1&size=100&status=posted')
    expect(posted.status).toBe(200)
    expect(posted.body.rows.every((row: { status: string }) => row.status === 'posted')).toBe(true)
    expect((await get(ownerToken, '/api/rental-payments?status=bogus')).status).toBe(400)
    expect((await get(ownerToken, '/api/rental-payments?page=0')).status).toBe(400)
    expect((await get(ownerToken, '/api/rental-payments?size=200')).status).toBe(400)
    expect((await get(ownerToken, '/api/rental-payments?page=abc')).status).toBe(400)
    // No params keeps the legacy full-array response.
    const legacy = await get(ownerToken, '/api/rental-payments')
    expect(legacy.status).toBe(200)
    expect(Array.isArray(legacy.body)).toBe(true)
    await RentalPayment.deleteMany({ booking: fresh._id })
    await Booking.deleteOne({ _id: fresh._id })
  })

  it('invoices and expenses lists paginate', async () => {
    const invoices = await get(ownerToken, '/api/invoices?page=1&size=1')
    expect(invoices.status).toBe(200)
    expect(Array.isArray(invoices.body.rows)).toBe(true)
    expect(typeof invoices.body.total).toBe('number')
    expect(invoices.body.page).toBe(1)
    expect((await get(ownerToken, '/api/invoices?page=0')).status).toBe(400)
    await new MaintenanceExpense({
      supplier: supplier._id, car: carDeposit._id, date: new Date(),
      type: types.MaintenanceExpenseType.Repair, amount: 40, vendor: 'F6',
    }).save()
    await new MaintenanceExpense({
      supplier: supplier._id, car: carDeposit._id, date: new Date(),
      type: types.MaintenanceExpenseType.Fuel, amount: 30, vendor: 'F6',
    }).save()
    const expenses = await get(ownerToken, '/api/maintenance-expenses?page=1&size=1')
    expect(expenses.status).toBe(200)
    expect(expenses.body.rows.length).toBe(1)
    expect(expenses.body.total).toBeGreaterThanOrEqual(2)
    const fuel = await get(ownerToken, '/api/maintenance-expenses?type=fuel')
    expect(fuel.status).toBe(200)
    expect((fuel.body as Array<{ type: string }>).every((row) => row.type === 'fuel')).toBe(true)
  })

  it('cash sessions and movements paginate', async () => {
    const session = await openSession(100)
    expect((await addMovement(session._id, { direction: 'in', amount: 10, source: 'manual', note: 'F6 page 1' })).status).toBe(201)
    expect((await addMovement(session._id, { direction: 'in', amount: 20, source: 'manual', note: 'F6 page 2' })).status).toBe(201)
    const movements = await get(ownerToken, `/api/cash/sessions/${session._id}/movements?page=1&size=1`)
    expect(movements.status).toBe(200)
    expect(movements.body.rows.length).toBe(1)
    expect(movements.body.total).toBe(2)
    const sessions = await get(ownerToken, '/api/cash/sessions?page=1&size=1')
    expect(sessions.status).toBe(200)
    expect(sessions.body.rows.length).toBe(1)
    expect(sessions.body.total).toBeGreaterThanOrEqual(1)
    expect((await get(ownerToken, `/api/cash/sessions/${session._id}/movements?page=0`)).status).toBe(400)
    await closeSession(session._id, { countedClosingBalance: 130, closingNote: 'F6 X-1' })
  })
})
