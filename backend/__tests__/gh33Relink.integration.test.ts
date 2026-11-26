import 'dotenv/config'
import request from 'supertest'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import CashSession from '../src/models/CashSession'
import CashMovement from '../src/models/CashMovement'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// GH-33 — the reversal fallback lands money in the latest open session:
// the unlinked-payments lists + link endpoints are the true repair path,
// and the fallback must log loudly when it fires.
//
// The fallback warning is asserted on the logger call itself, not on a
// stdout/stderr spy: winston's Console transport writes via console._stdout,
// which jest's worker console replaces — spying on process.stdout works
// standalone but captures nothing in the full suite (verified across three
// full runs). The mock logger makes the assertion synchronous and
// deterministic in both modes. app + ledger are imported dynamically in
// beforeAll, AFTER the mock registration (mailHelper pattern).
const loggerWarnMock: any = jest.fn()
const loggerErrorMock: any = jest.fn()
const loggerInfoMock: any = jest.fn()

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  info: loggerInfoMock,
  warn: loggerWarnMock,
  error: loggerErrorMock,
  enableLogging: jest.fn(),
  disableLogging: jest.fn(),
  enableErrorLogging: jest.fn(),
  disableErrorLogging: jest.fn(),
}))

let app: any
let postRentalPayment: (input: any) => Promise<any>
let reverseRentalPayment: (input: any) => Promise<any>

const day = 86400000
const rand = () => Math.random().toString(36).slice(2)
const at = (days: number) => new Date(Date.now() + days * day)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixtureSessionIds: mongoose.Types.ObjectId[] = []
const fixturePaymentIds: mongoose.Types.ObjectId[] = []

let adminToken: string
let adminId: string
let location: any

const makeAgency = async (tag: string) => {
  const supplier = await User.create({
    email: `gh33-supplier-${tag}-${rand()}@test.bookcars.ma`, fullName: `GH-33 Supplier ${tag}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `gh33-driver-${tag}-${rand()}@test.bookcars.ma`, fullName: `GH-33 Driver ${tag}`,
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const car = await Car.create({
    name: `GH-33 car ${tag}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: at(1), to: at(3),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: 1000,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
      mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
      rentalTotal: 1000, depositAmount: 0,
      amountDueNow: 1000, amountDueNowInPaymentCurrency: 1000, quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
  return { supplier, driver, car, booking }
}

const postRent = async (bookingId: mongoose.Types.ObjectId, amount: number, method: bookcarsTypes.RentalPaymentMethod) => {
  const payment = await postRentalPayment({
    bookingId: bookingId.toString(), date: new Date(), amount, currency: 'MAD',
    method,
    purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
    source: bookcarsTypes.RentalPaymentSource.Manual,
    actorId: adminId,
  })
  fixturePaymentIds.push(payment._id)
  return payment
}

const openSession = async (supplierId: mongoose.Types.ObjectId, account: bookcarsTypes.CashAccountType) => {
  const session = await CashSession.create({
    supplier: supplierId, account, currency: 'MAD',
    openedAt: new Date(), openedBy: adminId, openingBalance: 0,
    status: bookcarsTypes.CashSessionStatus.Open,
  })
  fixtureSessionIds.push(session._id)
  return session
}

const getJournal = async (sessionId: mongoose.Types.ObjectId) => {
  const res = await request(app)
    .get('/api/cash/journal')
    .query({ sessionId: sessionId.toString() })
    .set(env.X_ACCESS_TOKEN, adminToken)
  expect(res.status).toBe(200)
  return res.body
}

beforeAll(async () => {
  ;({ default: app } = await import('../src/app'))
  ;({ postRentalPayment, reverseRentalPayment } = await import('../src/utils/ledger'))
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh33-admin', email: `gh33-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })
  const valueEn = await LocationValue.create({ language: 'en', value: `GH-33 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
})

afterAll(async () => {
  await CashMovement.deleteMany({ supplier: { $in: fixtureUserIds } })
  await CashSession.deleteMany({ _id: { $in: fixtureSessionIds } })
  await RentalPayment.deleteMany({ _id: { $in: fixturePaymentIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-33 relink + reversal fallback', () => {
  test('cash: unlinked payment lists, links into the named session, reversal lands in THAT session', async () => {
    const { supplier, booking } = await makeAgency('cash')
    const payment = await postRent(booking._id, 500, bookcarsTypes.RentalPaymentMethod.Cash)
    expect(payment.status).toBe(bookcarsTypes.RentalPaymentStatus.Posted)

    const session = await openSession(supplier._id, bookcarsTypes.CashAccountType.Cash)
    const before = await getJournal(session._id)
    expect(before.unlinkedCashPayments.map((row: any) => row.id)).toContain(payment._id.toString())
    expect(before.unlinkedCashTotal).toBe(500)
    expect(before.totals.expectedBalance).toBe(0)

    const linked = await request(app)
      .post(`/api/rental-payments/${payment._id.toString()}/link-cash-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ cashSessionId: session._id.toString() })
    expect(linked.status).toBe(200)
    expect(linked.body.movement.session.toString()).toBe(session._id.toString())
    expect(linked.body.payment.cashSession.toString()).toBe(session._id.toString())

    const after = await getJournal(session._id)
    expect(after.unlinkedCashPayments.map((row: any) => row.id)).not.toContain(payment._id.toString())
    expect(after.unlinkedCashTotal).toBe(0)
    expect(after.totals.expectedBalance).toBe(500)
    expect(after.totals.income).toBe(500)

    const reversal = await reverseRentalPayment({
      paymentId: payment._id, actorId: adminId, idempotencyKey: `gh33-rev-cash-${rand()}`,
    })
    expect(reversal.reversedFrom?.toString()).toBe(payment._id.toString())
    const movement = await CashMovement.findOne({ rentalPayment: reversal._id }).lean()
    expect(movement).toBeTruthy()
    expect(movement?.session.toString()).toBe(session._id.toString())
    expect(movement?.direction).toBe(bookcarsTypes.CashMovementDirection.Out)
    expect(movement?.amount).toBe(500)
  })

  test('bank: unlinked wire lists, links into the named Bank session, reversal lands there', async () => {
    const { supplier, booking } = await makeAgency('bank')
    const payment = await postRent(booking._id, 700, bookcarsTypes.RentalPaymentMethod.BankTransfer)

    const session = await openSession(supplier._id, bookcarsTypes.CashAccountType.Bank)
    const before = await getJournal(session._id)
    expect(before.unlinkedBankPayments.map((row: any) => row.id)).toContain(payment._id.toString())
    expect(before.unlinkedBankTotal).toBe(700)
    expect(before.unlinkedCashPayments.map((row: any) => row.id)).not.toContain(payment._id.toString())

    const linked = await request(app)
      .post(`/api/rental-payments/${payment._id.toString()}/link-bank-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ bankSessionId: session._id.toString() })
    expect(linked.status).toBe(200)
    expect(linked.body.movement.session.toString()).toBe(session._id.toString())

    const after = await getJournal(session._id)
    expect(after.unlinkedBankPayments.map((row: any) => row.id)).not.toContain(payment._id.toString())
    expect(after.unlinkedBankTotal).toBe(0)
    expect(after.totals.expectedBalance).toBe(700)

    const reversal = await reverseRentalPayment({
      paymentId: payment._id, actorId: adminId, idempotencyKey: `gh33-rev-bank-${rand()}`,
    })
    const movement = await CashMovement.findOne({ rentalPayment: reversal._id }).lean()
    expect(movement).toBeTruthy()
    expect(movement?.session.toString()).toBe(session._id.toString())
    expect(movement?.direction).toBe(bookcarsTypes.CashMovementDirection.Out)
  })

  test('never-linked reversal with two sessions falls back to the latest open one and logs the warning', async () => {
    const { supplier, booking } = await makeAgency('fallback')
    const older = await openSession(supplier._id, bookcarsTypes.CashAccountType.Cash)
    await CashSession.updateOne({ _id: older._id }, { status: bookcarsTypes.CashSessionStatus.Closed, closedAt: new Date() })

    const payment = await postRent(booking._id, 300, bookcarsTypes.RentalPaymentMethod.Cash)
    const latest = await openSession(supplier._id, bookcarsTypes.CashAccountType.Cash)

    // The fallback warning is asserted on the logger call (see the file
    // header): no stream spy, no flush race.
    loggerWarnMock.mockClear()
    const reversal = await reverseRentalPayment({
      paymentId: payment._id, actorId: adminId, idempotencyKey: `gh33-rev-fallback-${rand()}`,
    })
    const movement = await CashMovement.findOne({ rentalPayment: reversal._id }).lean()
    expect(movement).toBeTruthy()
    expect(movement?.session.toString()).toBe(latest._id.toString())
    expect(movement?.session.toString()).not.toBe(older._id.toString())
    expect(loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining('[ledger.linkReversalCashMovement]'))
  })

  test('linking the same payment twice is refused with 409', async () => {
    const { supplier, booking } = await makeAgency('twice')
    const payment = await postRent(booking._id, 100, bookcarsTypes.RentalPaymentMethod.Cash)
    const session = await openSession(supplier._id, bookcarsTypes.CashAccountType.Cash)
    const first = await request(app)
      .post(`/api/rental-payments/${payment._id.toString()}/link-cash-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ cashSessionId: session._id.toString() })
    expect(first.status).toBe(200)
    const second = await request(app)
      .post(`/api/rental-payments/${payment._id.toString()}/link-cash-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ cashSessionId: session._id.toString() })
    expect(second.status).toBe(409)
  })
})

describe('R3-08 unlinked totals net + true count', () => {
  // A debit Posted row, seeded by direct model insert: the posting
  // paths normally create credits; the debit is the GH-33 fallback
  // shape (a reversal whose compensating movement could not be made).
  const seedUnlinked = async (supplierId: mongoose.Types.ObjectId, bookingId: mongoose.Types.ObjectId, amount: number, method: bookcarsTypes.RentalPaymentMethod, direction: bookcarsTypes.RentalPaymentDirection) => {
    const payment = await RentalPayment.create({
      supplier: supplierId, booking: bookingId, date: new Date(), amount, currency: 'MAD',
      method, purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
      direction, source: bookcarsTypes.RentalPaymentSource.Manual,
      status: bookcarsTypes.RentalPaymentStatus.Posted,
    } as any)
    fixturePaymentIds.push(payment._id)
    return payment
  }

  test('cash: a 1000 credit and a 400 debit net to 600, count is 2', async () => {
    const { supplier, booking } = await makeAgency('r308-cash')
    const credit = await postRent(booking._id, 1000, bookcarsTypes.RentalPaymentMethod.Cash)
    const debit = await seedUnlinked(supplier._id, booking._id, 400, bookcarsTypes.RentalPaymentMethod.Cash, bookcarsTypes.RentalPaymentDirection.Debit)
    const session = await openSession(supplier._id, bookcarsTypes.CashAccountType.Cash)
    const journal = await getJournal(session._id)
    expect(journal.unlinkedCashTotal).toBe(600)
    expect(journal.unlinkedCashCount).toBe(2)
    expect(journal.unlinkedCashPayments).toHaveLength(2)
    const rows = journal.unlinkedCashPayments as any[]
    expect(rows.find((r) => r.id === credit._id.toString())?.direction).toBe(bookcarsTypes.RentalPaymentDirection.Credit)
    expect(rows.find((r) => r.id === debit._id.toString())?.direction).toBe(bookcarsTypes.RentalPaymentDirection.Debit)
  })

  test('cash: 101 unlinked rows list 100, count is 101, total covers all 101', async () => {
    const { supplier, booking } = await makeAgency('r308-cap')
    const docs = Array.from({ length: 101 }, () => ({
      supplier: supplier._id, booking: booking._id, date: new Date(), amount: 10, currency: 'MAD',
      method: bookcarsTypes.RentalPaymentMethod.Cash, purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
      direction: bookcarsTypes.RentalPaymentDirection.Credit, source: bookcarsTypes.RentalPaymentSource.Manual,
      status: bookcarsTypes.RentalPaymentStatus.Posted,
    }))
    const inserted = await RentalPayment.insertMany(docs)
    for (const row of inserted) {
      fixturePaymentIds.push(row._id)
    }
    const session = await openSession(supplier._id, bookcarsTypes.CashAccountType.Cash)
    const journal = await getJournal(session._id)
    expect(journal.unlinkedCashPayments).toHaveLength(100)
    expect(journal.unlinkedCashCount).toBe(101)
    expect(journal.unlinkedCashTotal).toBe(1010)
  })

  test('bank: a 1000 credit and a 400 debit net to 600, count is 2', async () => {
    const { supplier, booking } = await makeAgency('r308-bank')
    const credit = await postRent(booking._id, 1000, bookcarsTypes.RentalPaymentMethod.BankTransfer)
    const debit = await seedUnlinked(supplier._id, booking._id, 400, bookcarsTypes.RentalPaymentMethod.BankTransfer, bookcarsTypes.RentalPaymentDirection.Debit)
    const session = await openSession(supplier._id, bookcarsTypes.CashAccountType.Bank)
    const journal = await getJournal(session._id)
    expect(journal.unlinkedBankTotal).toBe(600)
    expect(journal.unlinkedBankCount).toBe(2)
    expect(journal.unlinkedBankPayments).toHaveLength(2)
    const rows = journal.unlinkedBankPayments as any[]
    expect(rows.find((r) => r.id === credit._id.toString())?.direction).toBe(bookcarsTypes.RentalPaymentDirection.Credit)
    expect(rows.find((r) => r.id === debit._id.toString())?.direction).toBe(bookcarsTypes.RentalPaymentDirection.Debit)
  })
  // R3-12 — concurrent double-link on a rental payment: both requests
  // must 200 with the SAME movement, and exactly one movement exists.
  // (The sequential second link still 409s — locked by the existing
  // 'linking the same payment twice is refused with 409' case.)
  test('R3-12 rental concurrent double-link, key-less payment: both 200, same movement, one movement', async () => {
    const { supplier, booking } = await makeAgency('r312-keyless')
    const payment = await postRent(booking._id, 500, bookcarsTypes.RentalPaymentMethod.Cash)
    expect(payment.idempotencyKey).toBeFalsy()
    const session = await openSession(supplier._id, bookcarsTypes.CashAccountType.Cash)
    const link = () => request(app)
      .post(`/api/rental-payments/${payment._id.toString()}/link-cash-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ cashSessionId: session._id.toString() })
    const [first, second] = await Promise.all([link(), link()])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.movement).toBeDefined()
    expect(second.body.movement).toBeDefined()
    expect(second.body.movement._id).toBe(first.body.movement._id)
    expect(await CashMovement.countDocuments({ rentalPayment: payment._id })).toBe(1)
    const movement = await CashMovement.findOne({ rentalPayment: payment._id }).lean()
    expect(movement?.idempotencyKey).toBe(`cash-rental-${payment._id.toString()}`)
  })

  test('R3-12 rental concurrent double-link, key-carrying payment: both 200, same movement, one movement', async () => {
    const { supplier, booking } = await makeAgency('r312-keyed')
    const payment = await postRentalPayment({
      bookingId: booking._id.toString(), date: new Date(), amount: 500, currency: 'MAD',
      method: bookcarsTypes.RentalPaymentMethod.Cash,
      purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
      source: bookcarsTypes.RentalPaymentSource.Manual,
      actorId: adminId, idempotencyKey: `r312-key-${rand()}`,
    })
    fixturePaymentIds.push(payment._id)
    const session = await openSession(supplier._id, bookcarsTypes.CashAccountType.Cash)
    const link = () => request(app)
      .post(`/api/rental-payments/${payment._id.toString()}/link-cash-session`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ cashSessionId: session._id.toString() })
    const [first, second] = await Promise.all([link(), link()])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.movement).toBeDefined()
    expect(second.body.movement).toBeDefined()
    expect(second.body.movement._id).toBe(first.body.movement._id)
    expect(await CashMovement.countDocuments({ rentalPayment: payment._id })).toBe(1)
  })
})
