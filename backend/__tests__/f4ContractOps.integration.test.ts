import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import ContractCharge from '../src/models/ContractCharge'
import ContractInspection from '../src/models/ContractInspection'
import ContractSnapshot from '../src/models/ContractSnapshot'
import AdditionalDriver from '../src/models/AdditionalDriver'
import Notification from '../src/models/Notification'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import { postRentalPayment } from '../src/utils/ledger'

// Workstream A, cluster F4 — contract corrections, late/no-show/dispute,
// snapshot + preview hardening (W1 #6, #7, #12, #14, #17). Same harness
// as F3's cancelRefundWorkflow: mocked providers against the real
// Mongo-backed app. Booking routes use the admin cookie (F3-proven);
// contract-operation routes use the supplier token header
// (contractEvidence-proven). The app is imported dynamically in
// beforeAll, AFTER the mocks below are registered.

const stripeRefundCreate: any = jest.fn()
const mailSendMock: any = jest.fn(async () => ({}))

jest.unstable_mockModule('../src/payment/stripe.js', () => ({
  default: {
    checkout: { sessions: { retrieve: jest.fn() } },
    paymentIntents: { retrieve: jest.fn() },
    refunds: { create: stripeRefundCreate },
  },
}))
jest.unstable_mockModule('../src/payment/paypal.js', () => ({
  getOrder: jest.fn(),
  refundCapture: jest.fn(async () => ({})),
}))
jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: mailSendMock,
}))

let app: any
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
const fixtureInspectionIds: mongoose.Types.ObjectId[] = []
const fixtureChargeIds: mongoose.Types.ObjectId[] = []
const fixtureSnapshotIds: mongoose.Types.ObjectId[] = []
const fixtureSnapshotFiles: string[] = []


type FixtureOpts = {
  status?: bookcarsTypes.BookingStatus
  lifecycle?: bookcarsTypes.ContractLifecycle
  rentalTotal?: number
  depositAmount?: number
  fromOffsetDays?: number
  toOffsetDays?: number
  secondLocation?: boolean
  optionRates?: { theftProtection?: number, additionalDriver?: number }
}

const makeFixture = async (label: string, opts: FixtureOpts = {}) => {
  const supplier = await User.create({
    email: `f4ops-supplier-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F4 Ops Supplier ${label}`,
    language: 'en', type: bookcarsTypes.UserType.Supplier,
    active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  const driver = await User.create({
    email: `f4ops-driver-${label}-${rand()}@test.bookcars.ma`,
    fullName: `F4 Ops Driver ${label}`,
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueA = await LocationValue.create({ language: 'en', value: `F4 Ops Airport A ${label}` })
  fixtureLocationValueIds.push(valueA._id)
  const locationA = await Location.create({ country: oid(), values: [valueA._id] })
  fixtureLocationIds.push(locationA._id)
  let locationB: any
  if (opts.secondLocation) {
    const valueB = await LocationValue.create({ language: 'en', value: `F4 Ops Airport B ${label}` })
    fixtureLocationValueIds.push(valueB._id)
    locationB = await Location.create({ country: oid(), values: [valueB._id] })
    fixtureLocationIds.push(locationB._id)
  }
  const locations = locationB ? [locationA._id, locationB._id] : [locationA._id]
  const car = await Car.create({
    name: `F4 ops car ${label}`, supplier: supplier._id, minimumAge: 21,
    locations, dailyPrice: 100, deposit: opts.depositAmount ?? 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: opts.optionRates?.theftProtection ?? 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: opts.optionRates?.additionalDriver ?? 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  const rentalTotal = opts.rentalTotal ?? 1000
  const depositAmount = opts.depositAmount ?? 250
  // One clock read for both ends: two Date.now() calls can straddle a
  // millisecond and make the window N days + 1ms, which the ceil day
  // rule counts as N+1 days.
  const now = Date.now()
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: locationA._id, dropOffLocation: locationA._id,
    from: new Date(now + (opts.fromOffsetDays ?? 1) * DAY),
    to: new Date(now + (opts.toOffsetDays ?? 3) * DAY),
    status: opts.status ?? bookcarsTypes.BookingStatus.Pending,
    lifecycle: opts.lifecycle ?? bookcarsTypes.ContractLifecycle.Draft,
    price: rentalTotal,
    cancellation: false, amendments: false, theftProtection: false,
    collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
      mode: bookcarsTypes.CheckoutPaymentMode.Full,
      rentalTotal, depositAmount,
      amountDueNow: rentalTotal, amountDueNowInPaymentCurrency: rentalTotal,
      quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
  // Next pass - inspections require a photo each: the contract files the
  // upload endpoint would store, pre-created on disk (the upload endpoint
  // itself is covered by contractEvidence). Real JFIF bytes, as in that
  // test, so any content sniffing sees a JPEG.
  const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9])
  for (const name of ['handover.jpg', 'return.jpg']) {
    const filename = `inspection_${booking._id}_${name}`
    await fs.writeFile(path.resolve(env.CDN_CONTRACTS, filename), photoBytes)
    fixtureSnapshotFiles.push(filename)
  }
  const supplierToken = await authHelper.encryptJWT({ id: supplier._id.toString() })
  return { supplier, driver, locationA, locationB, car, booking, supplierToken }
}

const makeSecondCar = async (fixture: any, label: string, dailyPrice = 150, deposit = 400) => {
  const car = await Car.create({
    name: `F4 ops second car ${label}`, supplier: fixture.supplier._id, minimumAge: 21,
    locations: [fixture.locationA._id, fixture.locationB._id], dailyPrice, deposit, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  return car
}

const amendAsAdmin = (bookingId: string, body: object) =>
  request(app).post(`/api/bookings/${bookingId}/amend`).set(env.X_ACCESS_TOKEN, adminToken).send(body)

const ops = (fixture: any) => {
  const base = `/api/contract-operations/${fixture.booking._id.toString()}`
  const header = { [env.X_ACCESS_TOKEN]: fixture.supplierToken }
  return {
    handover: (body: object = { occurredAt: new Date().toISOString(), odometer: 100, fuelLevel: 80, condition: 'Clean at handover', photoFiles: ['handover.jpg'] }) =>
      request(app).post(`${base}/handover`).set(header).send(body),
    return: (body: object = { occurredAt: new Date().toISOString(), odometer: 130, fuelLevel: 70, damageNote: 'Small bumper mark', photoFiles: ['return.jpg'] }) =>
      request(app).post(`${base}/return`).set(header).send(body),
    complete: () => request(app).post(`${base}/complete`).set(header),
    snapshot: () => request(app).post(`${base}/snapshots`).set(header),
    preview: () => request(app).get(`${base}/settlement-preview`).set(header),
    createCharge: (body: object) => request(app).post(`${base}/charges`).set(header).send(body),
    decideCharge: (chargeId: string, body: object) => request(app).post(`${base}/charges/${chargeId}/decide`).set(header).send(body),
    // The supplier requested the charge, so the supplier cannot decide
    // it (self-approval is forbidden) — the platform admin decides.
    decideChargeAsAdmin: (chargeId: string, body: object) => request(app).post(`${base}/charges/${chargeId}/decide`).set(env.X_ACCESS_TOKEN, adminToken).send(body),
    disputeCharge: (chargeId: string, body: object) => request(app).post(`${base}/charges/${chargeId}/dispute`).set(header).send(body),
    resolveChargeDispute: (chargeId: string, body: object) => request(app).post(`${base}/charges/${chargeId}/dispute/resolve`).set(header).send(body),
    disputeInspection: (inspectionId: string, body: object) => request(app).post(`${base}/inspections/${inspectionId}/dispute`).set(header).send(body),
    resolveInspectionDispute: (inspectionId: string, body: object) => request(app).post(`${base}/inspections/${inspectionId}/dispute/resolve`).set(header).send(body),
  }
}

// Wave 2 remainder — 2.2: handover is balance-based now, so a fixture
// that hands over must carry real money (status Paid alone no longer
// opens the gate). Rent + deposit at the fixture's snapshot amounts,
// via the counter (manual cash) path — same helper as wave2's payInFull.
const payInFull = async (fixture: any) => {
  const rentalTotal = fixture.booking.financialSnapshot?.rentalTotal ?? 1000
  const depositAmount = fixture.booking.financialSnapshot?.depositAmount ?? 250
  await postRentalPayment({
    bookingId: fixture.booking._id.toString(), date: new Date(), amount: rentalTotal,
    currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
    purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
    source: bookcarsTypes.RentalPaymentSource.Manual, actorId: adminId,
  })
  await postRentalPayment({
    bookingId: fixture.booking._id.toString(), date: new Date(), amount: depositAmount,
    currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
    purpose: bookcarsTypes.RentalPaymentPurpose.Deposit,
    source: bookcarsTypes.RentalPaymentSource.Manual, actorId: adminId,
  })
}

const insertInspection = async (fixture: any, type: bookcarsTypes.InspectionType, extra: Record<string, unknown> = {}) => {
  const inspection = await ContractInspection.create({
    supplier: fixture.supplier._id, booking: fixture.booking._id, car: fixture.car._id,
    type, occurredAt: new Date(), odometer: 100, fuelLevel: 80, ...extra,
  } as any)
  fixtureInspectionIds.push(inspection._id)
  return inspection
}

beforeAll(async () => {
  app = (await import('../src/app')).default
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'f4ops-admin', email: `f4ops-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })
  stripeRefundCreate.mockResolvedValue({ id: 're_f4ops_test' })
})

afterAll(async () => {
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

afterEach(async () => {
  for (const filename of fixtureSnapshotFiles) {
    await fs.unlink(path.resolve(env.CDN_CONTRACTS, filename)).catch(() => undefined)
  }
  fixtureSnapshotFiles.length = 0
  await ContractSnapshot.deleteMany({ _id: { $in: fixtureSnapshotIds } })
  await ContractCharge.deleteMany({ _id: { $in: fixtureChargeIds } })
  await ContractInspection.deleteMany({ _id: { $in: fixtureInspectionIds } })
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Notification.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  fixtureSnapshotIds.length = 0
  fixtureChargeIds.length = 0
  fixtureInspectionIds.length = 0
  fixtureBookingIds.length = 0
  fixtureCarIds.length = 0
  fixtureLocationIds.length = 0
  fixtureLocationValueIds.length = 0
  fixtureUserIds.length = 0
  jest.resetAllMocks()
  mailSendMock.mockResolvedValue({})
  stripeRefundCreate.mockResolvedValue({ id: 're_f4ops_test' })
})

describe('F4 / W1 #6 — correction workflow on snapshot bookings', () => {
  it('corrects the drop-off location without re-pricing and records the correction', async () => {
    const fixture = await makeFixture('correct-location', { secondLocation: true })
    const response = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'Wrong drop-off entered at booking',
      dropOffLocation: fixture.locationB._id.toString(),
    })
    expect(response.status).toBe(200)
    expect(response.body.dropOffLocation._id).toBe(fixture.locationB._id.toString())
    expect(response.body.price).toBe(1000)
    expect(response.body.financialSnapshot.version).toBe(2)
    const history = response.body.amendmentHistory as any[]
    const correction = history[history.length - 1].correction
    expect(correction.dropOffLocationBefore).toBe(fixture.locationA._id.toString())
    expect(correction.dropOffLocationAfter).toBe(fixture.locationB._id.toString())
  })

  it('corrects the vehicle and re-prices from the new car with the new deposit', async () => {
    const fixture = await makeFixture('correct-car', { secondLocation: true })
    const car2 = await makeSecondCar(fixture, 'correct-car', 150, 400)
    const response = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'First car went into maintenance',
      car: car2._id.toString(),
    })
    expect(response.status).toBe(200)
    expect(response.body.car._id).toBe(car2._id.toString())
    // 2 rental days at the new car's 150/day, no options.
    expect(response.body.price).toBe(300)
    expect(response.body.financialSnapshot.depositAmount).toBe(400)
    const history = response.body.amendmentHistory as any[]
    const correction = history[history.length - 1].correction
    expect(correction.carBefore).toBe(fixture.car._id.toString())
    expect(correction.carAfter).toBe(car2._id.toString())
  })

  it('corrects an add-on and prices only the changed option from the car rate', async () => {
    const fixture = await makeFixture('correct-option', { optionRates: { theftProtection: 10 } })
    const response = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'Customer added theft protection',
      theftProtection: true,
    })
    expect(response.status).toBe(200)
    expect(response.body.theftProtection).toBe(true)
    // Basis 1000 + 10/day x 2 days for the added option.
    expect(response.body.price).toBe(1020)
    const history = response.body.amendmentHistory as any[]
    const correction = history[history.length - 1].correction
    expect(correction.optionsBefore.theftProtection).toBe(false)
    expect(correction.optionsAfter.theftProtection).toBe(true)
  })

  it('refuses a correction after handover but still allows a date-only amendment', async () => {
    const fixture = await makeFixture('correct-after-handover', {
      secondLocation: true, status: bookcarsTypes.BookingStatus.Paid,
    })
    await payInFull(fixture)
    const handed = await ops(fixture).handover()
    expect(handed.status).toBe(201)
    const refused = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'Move the drop-off after handover',
      dropOffLocation: fixture.locationB._id.toString(),
    })
    expect(refused.status).toBe(409)
    expect(refused.text).toContain('AMENDMENT_CORRECTION_AFTER_HANDOVER')
    const extended = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'Customer keeps the car two more days',
      to: new Date(Date.now() + 5 * DAY).toISOString(),
    })
    expect(extended.status).toBe(200)
  })

  it('adds and removes the additional driver with its details row', async () => {
    const fixture = await makeFixture('correct-driver')
    const details = {
      fullName: 'F4 Extra Driver', email: `f4ops-extra-${rand()}@test.bookcars.ma`,
      phone: '+212611111111', birthDate: '1992-05-05',
    }
    const withoutDetails = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'Add a driver', additionalDriver: true,
    })
    expect(withoutDetails.status).toBe(400)
    expect(withoutDetails.text).toContain('AMENDMENT_ADDITIONAL_DRIVER')
    const added = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'Add a driver', additionalDriver: true, additionalDriverDetails: details,
    })
    expect(added.status).toBe(200)
    expect(added.body.additionalDriver).toBe(true)
    expect(await AdditionalDriver.findOne({ email: details.email })).not.toBeNull()
    const removed = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'Remove the driver', additionalDriver: false,
    })
    expect(removed.status).toBe(200)
    expect(removed.body.additionalDriver).toBe(false)
    expect(await AdditionalDriver.findOne({ email: details.email })).toBeNull()
  })
})

describe('F4 / W1 #17 — amend refuses a pickup date in the past', () => {
  it('400s a new from in the past on a Draft booking', async () => {
    const fixture = await makeFixture('past-from')
    const response = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'Move the pickup earlier',
      from: new Date(Date.now() - DAY).toISOString(),
    })
    expect(response.status).toBe(400)
    expect(response.text).toContain('AMENDMENT_PAST_FROM')
  })

  it('still allows extending the return of a Draft booking whose pickup already passed', async () => {
    const fixture = await makeFixture('past-from-extend', { fromOffsetDays: -1, toOffsetDays: 1 })
    const response = await amendAsAdmin(fixture.booking._id.toString(), {
      reason: 'Customer keeps the car longer',
      to: new Date(Date.now() + 3 * DAY).toISOString(),
    })
    expect(response.status).toBe(200)
  })
})

describe('F4 / W1 #7 — overdue list and no-show', () => {
  it('lists only Active bookings past their scheduled return, most overdue first', async () => {
    const fixture = await makeFixture('overdue-list', {
      status: bookcarsTypes.BookingStatus.Paid,
      lifecycle: bookcarsTypes.ContractLifecycle.Active,
      fromOffsetDays: -3, toOffsetDays: -1,
    })
    // Same agency, still within its rental: the `to` filter must exclude it.
    const currentBooking = await Booking.create({
      supplier: fixture.supplier._id, car: fixture.car._id, driver: fixture.driver._id,
      pickupLocation: fixture.locationA._id, dropOffLocation: fixture.locationA._id,
      from: new Date(Date.now() - DAY), to: new Date(Date.now() + 2 * DAY),
      status: bookcarsTypes.BookingStatus.Paid,
      lifecycle: bookcarsTypes.ContractLifecycle.Active,
      price: 1000,
      financialSnapshot: {
        version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
        mode: bookcarsTypes.CheckoutPaymentMode.Full,
        rentalTotal: 1000, depositAmount: 250,
        amountDueNow: 1000, amountDueNowInPaymentCurrency: 1000,
        quotedAt: new Date(),
      },
    } as any)
    fixtureBookingIds.push(currentBooking._id)
    const response = await request(app).post('/api/overdue-bookings/1/30/en')
      .set(env.X_ACCESS_TOKEN, adminToken).send({ suppliers: [fixture.supplier._id.toString()] })
    expect(response.status).toBe(200)
    const rows = response.body[0].resultData as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].booking._id).toBe(fixture.booking._id.toString())
    expect(rows[0].overdueHours).toBeGreaterThan(0)
    expect(new Date(rows[0].overdueSince).getTime()).toBe(new Date(fixture.booking.to).getTime())
    expect(rows.map((r: any) => r.booking._id)).not.toContain(currentBooking._id.toString())
  })

  it('marks a no-show, frees the car, and refuses repeats / early / handed-over markings', async () => {
    const fixture = await makeFixture('no-show', { fromOffsetDays: -1, toOffsetDays: 2 })
    const marked = await request(app).post(`/api/bookings/${fixture.booking._id.toString()}/mark-no-show`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(marked.status).toBe(200)
    expect(marked.body.status).toBe(bookcarsTypes.BookingStatus.Cancelled)
    expect(marked.body.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Cancelled)
    expect(marked.body.noShowAt).toBeTruthy()
    const again = await request(app).post(`/api/bookings/${fixture.booking._id.toString()}/mark-no-show`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(again.status).toBe(409)
    expect(again.text).toContain('ALREADY_CANCELLED')
    // The car is freed for the same dates.
    const rebook = await request(app).post('/api/create-booking').set(env.X_ACCESS_TOKEN, adminToken).send({
      booking: {
        supplier: fixture.supplier._id.toString(), car: fixture.car._id.toString(), driver: fixture.driver._id.toString(),
        pickupLocation: fixture.locationA._id.toString(), dropOffLocation: fixture.locationA._id.toString(),
        from: fixture.booking.from, to: fixture.booking.to,
        status: bookcarsTypes.BookingStatus.Pending, price: 200,
        cancellation: false, amendments: false, theftProtection: false,
        collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false,
      },
    })
    expect(rebook.status).toBe(200)
    fixtureBookingIds.push(rebook.body._id)

    const early = await makeFixture('no-show-early')
    const tooEarly = await request(app).post(`/api/bookings/${early.booking._id.toString()}/mark-no-show`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(tooEarly.status).toBe(409)
    expect(tooEarly.text).toContain('NO_SHOW_TOO_EARLY')

    const handed = await makeFixture('no-show-handed', {
      status: bookcarsTypes.BookingStatus.Paid,
      lifecycle: bookcarsTypes.ContractLifecycle.Active,
      fromOffsetDays: -1, toOffsetDays: 2,
    })
    const invalid = await request(app).post(`/api/bookings/${handed.booking._id.toString()}/mark-no-show`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(invalid.status).toBe(409)
    expect(invalid.text).toContain('NO_SHOW_INVALID_STATE')
  })

  it('refuses to mark a paid booking as a no-show and leaves it untouched', async () => {
    // Confirmed + Paid: the normal post-F4 state of a paid booking
    // awaiting pickup. The money disposition belongs to the staff
    // cancel workflow (explicit refund decision), not to no-show.
    const paid = await makeFixture('no-show-paid', {
      status: bookcarsTypes.BookingStatus.Paid,
      lifecycle: bookcarsTypes.ContractLifecycle.Confirmed,
      fromOffsetDays: -1, toOffsetDays: 2,
    })
    const refused = await request(app).post(`/api/bookings/${paid.booking._id.toString()}/mark-no-show`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(refused.status).toBe(409)
    expect(refused.text).toContain('NO_SHOW_PAID_BOOKING')
    const untouched = await Booking.findById(paid.booking._id).lean()
    expect(untouched!.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect(untouched!.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Confirmed)
    expect(untouched!.noShowAt).toBeFalsy()
    // `cancellationRecord` itself is always present: Mongoose materialises
    // the single-nested subdocument on every load, with the array default
    // `refundProviderReferences: []`. No cancellation was recorded, so the
    // meaningful fields stay unset.
    expect(untouched!.cancellationRecord?.cancelledAt).toBeFalsy()
    expect(untouched!.cancellationRecord?.refundDecision).toBeFalsy()
    // Legacy shape: Draft lifecycle with money already collected.
    const legacy = await makeFixture('no-show-paid-legacy', {
      status: bookcarsTypes.BookingStatus.Paid,
      lifecycle: bookcarsTypes.ContractLifecycle.Draft,
      fromOffsetDays: -1, toOffsetDays: 2,
    })
    const refusedLegacy = await request(app).post(`/api/bookings/${legacy.booking._id.toString()}/mark-no-show`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(refusedLegacy.status).toBe(409)
    expect(refusedLegacy.text).toContain('NO_SHOW_PAID_BOOKING')
  })
})

describe('F4 / W1 #7 — disputes block completion until resolved', () => {
  const settle = async (fixture: any) => {
    const api = ops(fixture)
    await payInFull(fixture)
    const handed = await api.handover()
    expect(handed.status).toBe(201)
    fixtureInspectionIds.push(handed.body.inspection._id)
    const returned = await api.return()
    expect(returned.status).toBe(201)
    fixtureInspectionIds.push(returned.body.inspection._id)
    return { api, handed, returned }
  }

  it('an open charge dispute blocks complete; resolving unblocks it', async () => {
    const fixture = await makeFixture('dispute-charge', { status: bookcarsTypes.BookingStatus.Paid })
    const { api } = await settle(fixture)
    const charge = await api.createCharge({ type: bookcarsTypes.ContractChargeType.Damage, amount: 150, currency: 'MAD', reason: 'Bumper mark review' })
    expect(charge.status).toBe(201)
    fixtureChargeIds.push(charge.body._id)
    const decided = await api.decideChargeAsAdmin(charge.body._id, { decision: bookcarsTypes.ApprovalDecision.Approved, note: 'Reviewed with return inspection' })
    expect(decided.status).toBe(200)
    const snapshot = await api.snapshot()
    expect(snapshot.status).toBe(201)
    fixtureSnapshotIds.push(snapshot.body._id)
    fixtureSnapshotFiles.push(snapshot.body.pdfFile)

    const badReason = await api.disputeCharge(charge.body._id, { reason: 'x' })
    expect(badReason.status).toBe(400)
    const raised = await api.disputeCharge(charge.body._id, { reason: 'The bumper mark was already there at handover' })
    expect(raised.status).toBe(201)
    expect(raised.body.dispute.reason).toBe('The bumper mark was already there at handover')
    expect(raised.body.dispute.raisedAt).toBeTruthy()
    const blocked = await api.complete()
    expect(blocked.status).toBe(409)
    expect(blocked.text).toContain('Unresolved contract disputes')
    const reRaise = await api.disputeCharge(charge.body._id, { reason: 'Still disputing it' })
    expect(reRaise.status).toBe(409)
    const resolved = await api.resolveChargeDispute(charge.body._id, { resolution: 'Handover photos reviewed — the mark was pre-existing, charge stands' })
    expect(resolved.status).toBe(200)
    expect(resolved.body.dispute.resolvedAt).toBeTruthy()
    expect(resolved.body.dispute.resolution).toContain('pre-existing')
    const resolveAgain = await api.resolveChargeDispute(charge.body._id, { resolution: 'Again' })
    expect(resolveAgain.status).toBe(409)
    // The charge stands (150 MAD owed): it is collected at the counter
    // before completion — the 2.2 balance gate blocks a close with an
    // unpaid approved charge unless a reason is recorded.
    await postRentalPayment({
      bookingId: fixture.booking._id.toString(), date: new Date(), amount: 150,
      currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
      purpose: bookcarsTypes.RentalPaymentPurpose.Charge,
      source: bookcarsTypes.RentalPaymentSource.Manual, actorId: adminId,
    })
    const completed = await api.complete()
    expect(completed.status).toBe(200)
    expect(completed.body.booking.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Completed)
  })

  it('an open inspection dispute blocks complete the same way', async () => {
    const fixture = await makeFixture('dispute-inspection', { status: bookcarsTypes.BookingStatus.Paid })
    const { api, returned } = await settle(fixture)
    const snapshot = await api.snapshot()
    expect(snapshot.status).toBe(201)
    fixtureSnapshotIds.push(snapshot.body._id)
    fixtureSnapshotFiles.push(snapshot.body.pdfFile)
    const raised = await api.disputeInspection(returned.body.inspection._id, { reason: 'The odometer reading looks wrong' })
    expect(raised.status).toBe(201)
    const blocked = await api.complete()
    expect(blocked.status).toBe(409)
    expect(blocked.text).toContain('Unresolved contract disputes')
    const resolved = await api.resolveInspectionDispute(returned.body.inspection._id, { resolution: 'Odometer photo checked — reading is correct' })
    expect(resolved.status).toBe(200)
    const completed = await api.complete()
    expect(completed.status).toBe(200)
    expect(completed.body.booking.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Completed)
  })

  it('the settlement preview reports a late return, and only when it is late', async () => {
    const late = await makeFixture('late-return', {
      status: bookcarsTypes.BookingStatus.Paid,
      fromOffsetDays: -3, toOffsetDays: -1,
    })
    const lateApi = ops(late)
    await payInFull(late)
    const lateHandover = await lateApi.handover()
    expect(lateHandover.status).toBe(201)
    fixtureInspectionIds.push(lateHandover.body.inspection._id)
    const lateReturn = await lateApi.return()
    expect(lateReturn.status).toBe(201)
    fixtureInspectionIds.push(lateReturn.body.inspection._id)
    const latePreview = await lateApi.preview()
    expect(latePreview.status).toBe(200)
    expect(latePreview.body.lateReturn).toBeDefined()
    expect(latePreview.body.lateReturn.lateHours).toBeGreaterThan(0)
    expect(new Date(latePreview.body.lateReturn.dueAt).getTime()).toBe(new Date(late.booking.to).getTime())

    const onTime = await makeFixture('on-time-return', { status: bookcarsTypes.BookingStatus.Paid })
    const onTimeApi = ops(onTime)
    await payInFull(onTime)
    const onTimeHandover = await onTimeApi.handover()
    expect(onTimeHandover.status).toBe(201)
    fixtureInspectionIds.push(onTimeHandover.body.inspection._id)
    const onTimeReturn = await onTimeApi.return()
    expect(onTimeReturn.status).toBe(201)
    fixtureInspectionIds.push(onTimeReturn.body.inspection._id)
    const onTimePreview = await onTimeApi.preview()
    expect(onTimePreview.status).toBe(200)
    expect(onTimePreview.body.lateReturn).toBeUndefined()
  })
})

describe('F4 / W1 #12 — a snapshot needs one handover AND one return inspection', () => {
  it('refuses two handovers with no return, accepts once a return exists', async () => {
    const fixture = await makeFixture('snapshot-12', { status: bookcarsTypes.BookingStatus.Paid })
    await insertInspection(fixture, bookcarsTypes.InspectionType.Handover)
    await insertInspection(fixture, bookcarsTypes.InspectionType.Handover, { occurredAt: new Date(Date.now() + 3600000) })
    const refused = await ops(fixture).snapshot()
    expect(refused.status).toBe(409)
    expect(refused.text).toContain('handover inspection')
    await insertInspection(fixture, bookcarsTypes.InspectionType.Return)
    const accepted = await ops(fixture).snapshot()
    expect(accepted.status).toBe(201)
    expect(accepted.body.version).toBe(1)
    fixtureSnapshotIds.push(accepted.body._id)
    fixtureSnapshotFiles.push(accepted.body.pdfFile)
  })
})

describe('F4 / W1 #14 — a missing wash checklist is an omission, not washed', () => {
  const washOmission = async (fixture: any, checklist: Record<string, unknown> | undefined) => {
    await insertInspection(fixture, bookcarsTypes.InspectionType.Handover)
    await insertInspection(fixture, bookcarsTypes.InspectionType.Return, checklist === undefined ? {} : { checklist })
    const preview = await ops(fixture).preview()
    expect(preview.status).toBe(200)
    return preview.body as { lines: any[], omissions: { kind: string, reason: string }[] }
  }

  it('reports no checklist as missingChecklist, never as washed', async () => {
    const fixture = await makeFixture('wash-missing', { status: bookcarsTypes.BookingStatus.Paid })
    const body = await washOmission(fixture, undefined)
    expect(body.omissions).toContainEqual({ kind: 'wash', reason: 'missingChecklist' })
    expect(body.omissions).not.toContainEqual(expect.objectContaining({ kind: 'wash', reason: 'washedAtReturn' }))
    expect(body.lines.find((line: any) => line.kind === 'wash')).toBeUndefined()
  })

  it('reports a washed checklist as washedAtReturn', async () => {
    const fixture = await makeFixture('wash-true', { status: bookcarsTypes.BookingStatus.Paid })
    const body = await washOmission(fixture, { washed: true })
    expect(body.omissions).toContainEqual({ kind: 'wash', reason: 'washedAtReturn' })
    expect(body.lines.find((line: any) => line.kind === 'wash')).toBeUndefined()
  })

  it('reports an unwashed checklist with no wash fee as missingWashFee', async () => {
    const fixture = await makeFixture('wash-false', { status: bookcarsTypes.BookingStatus.Paid })
    const body = await washOmission(fixture, { washed: false })
    expect(body.omissions).toContainEqual({ kind: 'wash', reason: 'missingWashFee' })
    expect(body.lines.find((line: any) => line.kind === 'wash')).toBeUndefined()
  })
})

describe('Next pass - early return re-prices the rent and frees the car', () => {
  it('re-prices a 14-day booking returned after 7 days to 7 days, stamps the record, and surfaces the overpayment', async () => {
    const fixture = await makeFixture('early-return', { rentalTotal: 1400, fromOffsetDays: -7, toOffsetDays: 7 })
    await payInFull(fixture)
    const api = ops(fixture)
    // Pin both inspections: the return to exactly 7 days after `from` (a
    // return "now" is 7 days + seconds, and the ceil day rule counts it as
    // 8 days), and the handover 1 hour earlier - a return cannot predate
    // its handover (C15), and the handover default "now" is seconds after
    // the pinned return time.
    const handed = await api.handover({ occurredAt: new Date(fixture.booking.from.getTime() + 7 * 86400000 - 3600000).toISOString(), odometer: 100, fuelLevel: 80, condition: 'Clean at handover', photoFiles: ['handover.jpg'] })
    expect(handed.status).toBe(201)
    const returned = await api.return({ occurredAt: new Date(fixture.booking.from.getTime() + 7 * 86400000).toISOString(), odometer: 130, fuelLevel: 70, damageNote: 'Small bumper mark', photoFiles: ['return.jpg'] })
    expect(returned.status).toBe(201)
    const booking = await Booking.findById(fixture.booking._id).lean() as any
    expect(booking.price).toBe(700)
    expect(new Date(booking.to).getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000)
    expect(booking.earlyReturn).toBeDefined()
    expect(booking.earlyReturn.scheduledDays).toBe(14)
    expect(booking.earlyReturn.actualDays).toBe(7)
    expect(booking.earlyReturn.basisDailyRate).toBe(100)
    expect(booking.earlyReturn.adjustedRentalTotal).toBe(700)
    expect(booking.earlyReturn.originalRentalTotal).toBe(1400)
    expect(booking.financialSnapshot.version).toBe(2)
    expect(booking.financialSnapshot.rentalTotal).toBe(700)
    const snap = await api.snapshot()
    expect(snap.status).toBe(201)
    const completed = await api.complete()
    expect(completed.status).toBe(200)
    expect(completed.body.receivable.outstandingBalance).toBe(0)
    expect(completed.body.receivable.overpaidAmount).toBe(700)
    expect(completed.body.receivable.rentalTotal).toBe(700)
  })

  it('does not adjust an on-time return', async () => {
    const fixture = await makeFixture('on-time-return', { rentalTotal: 1000, fromOffsetDays: -2, toOffsetDays: 0 })
    await payInFull(fixture)
    const api = ops(fixture)
    expect((await api.handover()).status).toBe(201)
    const returned = await api.return()
    expect(returned.status).toBe(201)
    const booking = await Booking.findById(fixture.booking._id).lean() as any
    expect(booking.earlyReturn).toBeUndefined()
    expect(booking.price).toBe(1000)
    expect(booking.financialSnapshot.rentalTotal).toBe(1000)
  })

  it('refuses a photo-less handover and a photo-less return, and a return without an odometer', async () => {
    const fixture = await makeFixture('photo-gate')
    await payInFull(fixture)
    const api = ops(fixture)
    const noPhotoHandover = await api.handover({ occurredAt: new Date().toISOString(), odometer: 100, fuelLevel: 80 })
    expect(noPhotoHandover.status).toBe(400)
    expect((await api.handover()).status).toBe(201)
    const noPhotoReturn = await api.return({ occurredAt: new Date().toISOString(), odometer: 130, fuelLevel: 70 })
    expect(noPhotoReturn.status).toBe(400)
    const noOdometerReturn = await api.return({ occurredAt: new Date().toISOString(), fuelLevel: 70, photoFiles: ['return.jpg'] })
    expect(noOdometerReturn.status).toBe(400)
    expect((await api.return()).status).toBe(201)
  })

  it('refuses completion when the return inspection has no odometer (legacy backstop)', async () => {
    const fixture = await makeFixture('complete-no-odometer')
    await payInFull(fixture)
    await insertInspection(fixture, bookcarsTypes.InspectionType.Handover, { photoFiles: ['handover.jpg'] })
    await insertInspection(fixture, bookcarsTypes.InspectionType.Return, { odometer: undefined, photoFiles: ['return.jpg'] })
    await Booking.updateOne({ _id: fixture.booking._id }, { lifecycle: bookcarsTypes.ContractLifecycle.ReturnReview })
    const api = ops(fixture)
    const snap = await api.snapshot()
    expect(snap.status).toBe(201)
    const completed = await api.complete()
    expect(completed.status).toBe(409)
    expect(completed.text).toContain('odometer')
  })
})