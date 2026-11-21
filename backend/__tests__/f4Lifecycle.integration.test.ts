import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import Notification from '../src/models/Notification'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import AdditionalDriver from '../src/models/AdditionalDriver'
import Token from '../src/models/Token'

// Workstream A, cluster F4 — lifecycle + hardening (W1 #4, #5, #8, #10,
// #15, #16). Same harness as F3's cancelRefundWorkflow: mocked providers
// (no Stripe/PayPal credentials, no live money) against the real
// Mongo-backed app. The app is imported dynamically in beforeAll, AFTER
// the provider/mail/redis mocks below are registered.

jest.unstable_mockModule('../src/payment/stripe.js', () => ({
  default: {
    checkout: { sessions: { retrieve: jest.fn() } },
    paymentIntents: { retrieve: jest.fn() },
    refunds: { create: jest.fn(async () => ({ id: 're_f4_test' })) },
  },
}))
jest.unstable_mockModule('../src/payment/paypal.js', () => ({
  getOrder: jest.fn(),
  refundCapture: jest.fn(async () => ({})),
}))
jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: jest.fn(async () => ({})),
}))

// F4 / W1 #8 — the rate limiter reads Redis through this module. The
// real client would fail fast in the test env (lazyConnect +
// maxRetriesPerRequest 0) and the limiter would fail open, so the burst
// test replaces it with an in-memory token bucket implementing the same
// Lua semantics (capacity, refill per interval, per-key state). The
// fake also carries the lifecycle methods setupTests.ts calls on the
// real client (quit/disconnect) and no-op cache reads, so no other
// importer of the module breaks.
// ORDERING (L4d): this mock only reaches the limiter because
// setupTests.ts imports redis lazily inside afterAll. A static redis
// import in setupTests would load the real client before this file
// evaluates, and jest.unstable_mockModule cannot replace an
// already-loaded ESM module - the limiter would keep the real client,
// fail open against the unreachable host-side Redis, and the burst
// would see 0x429. Do not re-add a top-level redis import to setupTests.
const mockBuckets = new Map<string, { tokens: number, lastTime: number }>()
const mockRedis = {
  eval: async (_script: string, _numKeys: number, key: string, capacity: number, refillRateMs: number, now: number) => {
    let bucket = mockBuckets.get(key)
    if (!bucket) {
      bucket = { tokens: capacity, lastTime: now }
      mockBuckets.set(key, bucket)
    } else {
      const passed = now - bucket.lastTime
      const add = Math.floor(passed / refillRateMs)
      if (add > 0) {
        bucket.tokens = Math.min(capacity, bucket.tokens + add)
        bucket.lastTime += add * refillRateMs
      }
    }
    if (bucket.tokens > 0) {
      bucket.tokens -= 1
      return [1, bucket.tokens]
    }
    return [0, bucket.tokens]
  },
  on: () => undefined,
  quit: async () => undefined,
  disconnect: () => undefined,
  get: async () => null,
  set: async () => 'OK',
  del: async () => 0,
  expire: async () => 0,
  hgetall: async () => ({}),
  hmget: async () => [],
  hmset: async () => 'OK',
  exists: async () => 0,
  keys: async () => [],
}
jest.unstable_mockModule('../src/config/redis.js', () => ({
  default: mockRedis,
  redis: mockRedis,
}))

let app: any
let finalizePaidCheckoutBooking: (
  booking: any,
  provider: 'stripe' | 'paypal',
  reference: string,
) => Promise<boolean>
let adminToken: string
let adminId: string

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const DAY = 86400000

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []


const makeFixture = async (label: string, opts: { payLater?: boolean } = {}) => {
  const supplier = await User.create({
    email: `f4-supplier-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F4 Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: opts.payLater ?? true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `f4-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F4 Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `F4 Airport ${label}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: `F4 car ${label}`, supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  return { supplier, driver, location, car }
}

const makeBooking = async (fixture: any, overrides: Record<string, unknown> = {}) => {
  const booking = await Booking.create({
    supplier: fixture.supplier._id, car: fixture.car._id, driver: fixture.driver._id,
    pickupLocation: fixture.location._id, dropOffLocation: fixture.location._id,
    from: new Date(Date.now() + DAY), to: new Date(Date.now() + 3 * DAY),
    status: bookcarsTypes.BookingStatus.Reserved,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: 200,
    ...overrides,
  } as any)
  fixtureBookingIds.push(booking._id)
  return booking
}

beforeAll(async () => {
  app = (await import('../src/app')).default
  // GUARD (L5): the burst tests below only mean something if this
  // file's redis mock actually reached the limiter. If anything
  // pre-loads the real client (e.g. a static redis import added to
  // setupTests.ts), the mock cannot replace it, the limiter fails
  // open against the unreachable host-side Redis, and the burst
  // would report 0x429 with no diagnosis. Fail fast here instead.
  expect((await import('../src/config/redis.js')).default).toBe(mockRedis)
  finalizePaidCheckoutBooking = (await import('../src/controllers/bookingController')).finalizePaidCheckoutBooking
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'f4-admin', email: `f4-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })
})

afterAll(async () => {
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

afterEach(async () => {
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Notification.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  fixtureBookingIds.length = 0
  fixtureCarIds.length = 0
  fixtureLocationIds.length = 0
  fixtureLocationValueIds.length = 0
  fixtureUserIds.length = 0
  mockBuckets.clear()
  jest.resetAllMocks()
})

describe('F4 / W1 #4 — back-to-back rentals do not conflict', () => {
  it('allows a pickup exactly at the previous return, refuses a real overlap', async () => {
    const fixture = await makeFixture('touching')
    const aFrom = new Date(Date.now() + DAY)
    const aTo = new Date(Date.now() + 3 * DAY)
    await makeBooking(fixture, { from: aFrom, to: aTo })
    // Wave 2.5 — a reserving booking via staff create() is gone
    // (Reserved closed); the boundary test now books through the public
    // checkout pay-later hold (Pending + 48h expireAt reserves the car).
    const payload = (from: Date, to: Date) => ({
      booking: {
        supplier: fixture.supplier._id.toString(), car: fixture.car._id.toString(), driver: fixture.driver._id.toString(),
        pickupLocation: fixture.location._id.toString(), dropOffLocation: fixture.location._id.toString(),
        from: from.toISOString(), to: to.toISOString(),
        status: bookcarsTypes.BookingStatus.Pending, price: 200,
        cancellation: false, amendments: false, theftProtection: false,
        collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
      },
      paymentMode: bookcarsTypes.CheckoutPaymentMode.PayLater,
      currency: 'MAD',
      paymentGateway: bookcarsTypes.PaymentGateway.Stripe,
      payLater: true,
    })
    // Touching: pickup exactly at the previous return (same-day turnaround).
    const touching = await request(app).post('/api/checkout').send(payload(aTo, new Date(Date.now() + 5 * DAY)))
    expect(touching.status).toBe(200)
    fixtureBookingIds.push(touching.body.bookingId)
    // Real overlap: pickup one hour before the previous return.
    const overlapping = await request(app).post('/api/checkout')
      .send(payload(new Date(aTo.getTime() - 3600000), new Date(Date.now() + 5 * DAY)))
    expect(overlapping.status).toBe(409)
  })

  it('still lists the car in search for a pickup exactly at the previous return, and hides it for a real overlap', async () => {
    const fixture = await makeFixture('search-touching')
    const aFrom = new Date(Date.now() + DAY)
    const aTo = new Date(Date.now() + 3 * DAY)
    await makeBooking(fixture, { from: aFrom, to: aTo })
    // getFrontendCars is a public POST; the car is blockOnPay, so the
    // search $lookup is what decides whether it is listed.
    const search = (from: Date, to: Date) => request(app).post('/api/frontend-cars/1/10').send({
      suppliers: [fixture.supplier._id.toString()],
      pickupLocation: fixture.location._id.toString(),
      carType: [bookcarsTypes.CarType.Diesel],
      gearbox: [bookcarsTypes.GearboxType.Automatic],
      from: from.toISOString(), to: to.toISOString(),
    })
    const listedIds = (res: any) => ((res.body[0]?.resultData ?? []) as any[]).map((c: any) => c._id.toString())
    // Touching: pickup exactly at the previous return (same-day turnaround).
    const touching = await search(aTo, new Date(Date.now() + 5 * DAY))
    expect(touching.status).toBe(200)
    expect(listedIds(touching)).toContain(fixture.car._id.toString())
    // Real overlap: pickup one hour before the previous return.
    const overlapping = await search(new Date(aTo.getTime() - 3600000), new Date(Date.now() + 5 * DAY))
    expect(overlapping.status).toBe(200)
    expect(listedIds(overlapping)).not.toContain(fixture.car._id.toString())
  })
})

describe('F4 / W1 #5 — the lifecycle middle has a producer', () => {
  it('provider finalisation confirms a Draft booking (lifecycle Confirmed)', async () => {
    const fixture = await makeFixture('finalize-confirmed')
    const booking = await Booking.create({
      supplier: fixture.supplier._id, car: fixture.car._id, driver: fixture.driver._id,
      pickupLocation: fixture.location._id, dropOffLocation: fixture.location._id,
      from: new Date(Date.now() + DAY), to: new Date(Date.now() + 3 * DAY),
      status: bookcarsTypes.BookingStatus.Void, price: 1000,
      sessionId: `cs-f4-finalize-${rand()}`,
      expireAt: new Date(Date.now() + 3600000),
      financialSnapshot: {
        version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
        mode: bookcarsTypes.CheckoutPaymentMode.Full,
        rentalTotal: 1000, depositAmount: 250,
        amountDueNow: 1250, amountDueNowInPaymentCurrency: 1250,
        quotedAt: new Date(),
      },
    } as any)
    fixtureBookingIds.push(booking._id)
    const finalized = await finalizePaidCheckoutBooking(booking, 'stripe', `pi_f4_finalize_${rand()}`)
    expect(finalized).toBe(true)
    const saved = await Booking.findById(booking._id).lean()
    expect(saved?.status).toBe(bookcarsTypes.BookingStatus.PaidInFull)
    expect(saved?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Confirmed)
    const payments = await RentalPayment.find({ booking: booking._id }).lean()
    expect(payments).toHaveLength(2)
  })

  it('a cash posting on the Payments page confirms a Pending pay-later booking (lifecycle Confirmed)', async () => {
    const fixture = await makeFixture('refresh-confirmed')
    const booking = await Booking.create({
      supplier: fixture.supplier._id, car: fixture.car._id, driver: fixture.driver._id,
      pickupLocation: fixture.location._id, dropOffLocation: fixture.location._id,
      from: new Date(Date.now() + DAY), to: new Date(Date.now() + 3 * DAY),
      status: bookcarsTypes.BookingStatus.Pending,
      lifecycle: bookcarsTypes.ContractLifecycle.Draft,
      price: 1000,
      financialSnapshot: {
        version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
        mode: bookcarsTypes.CheckoutPaymentMode.Full,
        rentalTotal: 1000, depositAmount: 250,
        amountDueNow: 1000, amountDueNowInPaymentCurrency: 1000,
        quotedAt: new Date(),
      },
    } as any)
    fixtureBookingIds.push(booking._id)
    const response = await request(app).post('/api/rental-payments')
      .set(env.X_ACCESS_TOKEN, adminToken).send({
        booking: booking._id.toString(), date: new Date(), amount: 1000,
        method: bookcarsTypes.RentalPaymentMethod.Cash, purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
        idempotencyKey: `w1-f4-${Math.random().toString(36).slice(2)}`,
      })
    expect(response.status).toBe(201)
    const saved = await Booking.findById(booking._id).lean()
    expect(saved?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect(saved?.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Confirmed)
  })
})

describe('F4 / W1 #8 — the public checkout surface is rate-limited', () => {
  // The limiter is keyed on IP only. The burst fires past the
  // CONFIGURED bucket (env.RATE_LIMIT_CAPACITY, 1 token per 2 s):
  // the first `capacity` requests pass the limiter (and 400 on the
  // invalid body) and at least two of the rest are 429. The count —
  // not an exact split — is asserted so a slow CI runner refilling
  // one token mid-burst cannot flake it. Without the limiter wired,
  // zero requests would be 429.
  // L5: the burst MUST scale with the configured capacity. The old
  // hardcoded burst of 15 assumed capacity 10 (the code default and
  // the .env.docker.example value), but the shipped .env.docker sets
  // BC_RATE_LIMIT_CAPACITY=100 — and the live test env demonstrably
  // loads .env.docker values (BC_REDIS_URL=redis://redis:6379 and
  // BC_SMTP_HOST=mailpit both surface as ENOTFOUND hostnames in the
  // logs). A burst of 15 against a capacity-100 bucket can never
  // 429, which is exactly the L34 result (0x429, first 10 are 400)
  // with the L4d mock fix already in place. No product or env change:
  // the test reads the budget the limiter itself was built with.
  const burst = async (url: string) => {
    const capacity = env.RATE_LIMIT_CAPACITY
    const statuses: number[] = []
    for (let i = 0; i < capacity + 5; i++) {
      const res = await request(app).post(url).set('x-test-rate-limit', '1').send({})
      statuses.push(res.status)
    }
    return { statuses, capacity }
  }

  it('429s a burst of invalid checkouts once the bucket is empty', async () => {
    const { statuses, capacity } = await burst('/api/checkout')
    expect(statuses.slice(0, capacity).every((s) => s === 400)).toBe(true)
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2)
  })

  it('429s a burst of invalid payment-intent confirmations the same way', async () => {
    const { statuses, capacity } = await burst('/api/confirm-payment-intent')
    expect(statuses.slice(0, capacity).every((s) => s === 400)).toBe(true)
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2)
  })

  // NOTE: no "without the header" bypass test — the bypass only applies
  // when BC_CI is set (rateLimiter `isTest`), and the F1 runner does not
  // set it, so in the QA run the limiter applies to every request and a
  // headerless burst would 429 the same way. The header is sent here so
  // the test also exercises the limiter when BC_CI *is* set.
})

describe('F4 / W1 #10 — a checkout conflict leaves no orphan guest', () => {
  it('removes the just-created guest user, its token and its additional-driver row', async () => {
    const fixture = await makeFixture('conflict-cleanup')
    await makeBooking(fixture, { status: bookcarsTypes.BookingStatus.Reserved })
    const guestEmail = `f4-guest-${rand()}@test.bookcars.ma`
    const extraDriverEmail = `f4-extra-${rand()}@test.bookcars.ma`
    const tokensBefore = await Token.countDocuments()
    const response = await request(app).post('/api/checkout').send({
      driver: { fullName: 'F4 Guest Driver', email: guestEmail, phone: '+212600000000', birthDate: '1990-01-01' },
      booking: {
        car: fixture.car._id.toString(),
        pickupLocation: fixture.location._id.toString(), dropOffLocation: fixture.location._id.toString(),
        from: new Date(Date.now() + DAY).toISOString(), to: new Date(Date.now() + 3 * DAY).toISOString(),
        cancellation: false, amendments: false, theftProtection: false,
        collisionDamageWaiver: false, fullInsurance: false, additionalDriver: true,
      },
      additionalDriver: { fullName: 'F4 Extra Driver', email: extraDriverEmail, phone: '+212611111111', birthDate: '1992-05-05' },
      paymentMode: bookcarsTypes.CheckoutPaymentMode.Full,
      currency: 'MAD',
      paymentGateway: bookcarsTypes.PaymentGateway.PayPal,
    })
    expect(response.status).toBe(409)
    expect(await User.findOne({ email: guestEmail })).toBeNull()
    expect(await AdditionalDriver.findOne({ email: extraDriverEmail })).toBeNull()
    expect(await Token.countDocuments()).toBe(tokensBefore)
    // The conflicting booking itself was never saved: only the
    // pre-existing Reserved booking remains on the car.
    expect(await Booking.countDocuments({ car: fixture.car._id })).toBe(1)
  })
})

describe('F4 / W1 #15 — paymentIntentId is a sparse-unique backstop', () => {
  it('builds the sparse-unique index, refuses a duplicate intent, allows many without one', async () => {
    await Booking.createIndexes()
    // getIndexes() is Mongoose's alias for indexInformation() with no
    // options, i.e. the COMPACT form { name: [[field, direction]] } -
    // it has no key/unique/sparse members. The full form comes from
    // indexes() (full: true by default).
    const compact = await Booking.collection.getIndexes()
    expect(compact.paymentIntentId_1).toEqual([['paymentIntentId', 1]])
    const full = await Booking.collection.indexes()
    const index = full.find((idx) => idx.name === 'paymentIntentId_1')
    expect(index).toBeDefined()
    expect(index?.key?.paymentIntentId).toBe(1)
    expect(index?.unique).toBe(true)
    expect(index?.sparse).toBe(true)

    const fixture = await makeFixture('payment-intent-index')
    const first = await makeBooking(fixture, { paymentIntentId: `pi_f4_dup_${rand()}` })
    await expect(makeBooking(fixture, { paymentIntentId: first.paymentIntentId }))
      .rejects.toThrow(/E11000|duplicate key/)
    // Sparse: bookings without an intent never collide.
    await makeBooking(fixture, { from: new Date(Date.now() + 5 * DAY), to: new Date(Date.now() + 7 * DAY) })
    await makeBooking(fixture, { from: new Date(Date.now() + 8 * DAY), to: new Date(Date.now() + 10 * DAY) })
  })
})

describe('F4 / W1 #16 — getBooking falls back when a language value is missing', () => {
  it('returns the English location name for an Arabic read of an English-only location', async () => {
    const fixture = await makeFixture('location-fallback')
    const booking = await makeBooking(fixture)
    const response = await request(app).get(`/api/booking/${booking._id.toString()}/ar`).set(env.X_ACCESS_TOKEN, adminToken)
    expect(response.status).toBe(200)
    expect(response.body.pickupLocation.name).toBe('F4 Airport location-fallback')
    expect(response.body.dropOffLocation.name).toBe('F4 Airport location-fallback')
    // F4 / W1 #7 — the same read carries the computed overdue flag.
    expect(response.body.overdue).toBe(false)
  })
})
