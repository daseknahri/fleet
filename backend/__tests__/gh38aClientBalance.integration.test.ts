import 'dotenv/config'
import mongoose from 'mongoose'
import request from 'supertest'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import app from '../src/app'
import Booking from '../src/models/Booking'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import AgencyMembership from '../src/models/AgencyMembership'

// GH-38a — the balance endpoint 403'd every customer: the route carried
// requireAgencyPermission(ReadClients) and the middleware lets a
// UserType.User through only for ReadBookings. The route now carries
// verifyToken only; the controller re-checks every caller class
// (admin / self / owning supplier / staff with ReadClients).
// verifyToken itself populates req.agency for staff (authJwt.ts:78-101),
// so the controller's staff check works without the middleware.
//
// Deviation from the pack's test list: a MISSING token returns 403
// ('No token provided!', authJwt.ts:42), not 401 — 401 is for an
// invalid token. Both are asserted.

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const day = 86400000

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixtureMembershipIds: mongoose.Types.ObjectId[] = []

let admin: any
let supplier: any
let customerA: any
let customerB: any
let staffManager: any
let staffMechanic: any

const tokenFor = async (user: any) => authHelper.encryptJWT({ id: user._id.toString() })

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  admin = await User.create({
    fullName: 'gh38a-admin', email: `gh38a-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(admin._id)
  supplier = await User.create({
    email: `gh38a-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-38a Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  customerA = await User.create({
    email: `gh38a-a-${rand()}@test.bookcars.ma`, fullName: 'GH-38a Customer A',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
    supplier: supplier._id,
  })
  fixtureUserIds.push(customerA._id)
  customerB = await User.create({
    email: `gh38a-b-${rand()}@test.bookcars.ma`, fullName: 'GH-38a Customer B',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
    supplier: supplier._id,
  })
  fixtureUserIds.push(customerB._id)
  const makeStaff = async (role: bookcarsTypes.AgencyRole) => {
    const staff = await User.create({
      email: `gh38a-staff-${role}-${rand()}@test.bookcars.ma`, fullName: `GH-38a Staff ${role}`,
      language: 'en', type: bookcarsTypes.UserType.Staff, active: true, verified: true, blacklisted: false,
      password: passwordHash,
    })
    fixtureUserIds.push(staff._id)
    const membership = await AgencyMembership.create({
      supplier: supplier._id, user: staff._id, role,
      status: bookcarsTypes.AgencyMembershipStatus.Active, activatedAt: new Date(),
    })
    fixtureMembershipIds.push(membership._id)
    return staff
  }
  staffManager = await makeStaff(bookcarsTypes.AgencyRole.Manager)
  staffMechanic = await makeStaff(bookcarsTypes.AgencyRole.Mechanic)

  const valueEn = await LocationValue.create({ language: 'en', value: `GH-38a Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  const location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  const car = await Car.create({
    name: 'GH-38a car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  // Customer A owes 300 on one unpaid booking; customer B owes nothing.
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: customerA._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(Date.now() + day), to: new Date(Date.now() + 3 * day),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: 300,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
      mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
      rentalTotal: 300, depositAmount: 0,
      amountDueNow: 300, amountDueNowInPaymentCurrency: 300, quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
})

afterAll(async () => {
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await AgencyMembership.deleteMany({ _id: { $in: fixtureMembershipIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})

describe('GH-38a — client balance endpoint access', () => {
  it('customer reads their own balance (200, five fields, real figures)', async () => {
    const res = await request(app)
      .get(`/api/users/${customerA._id}/balance`)
      .set(env.X_ACCESS_TOKEN, await tokenFor(customerA))
    expect(res.status).toBe(200)
    expect(res.body.currency).toBe('MAD')
    expect(res.body.outstanding).toBe(300)
    expect(res.body.overdue).toBe(0)
    expect(res.body.depositHeld).toBe(0)
    expect(res.body.bookings).toBe(1)
  })

  it('customer reading another client is refused (403)', async () => {
    const res = await request(app)
      .get(`/api/users/${customerB._id}/balance`)
      .set(env.X_ACCESS_TOKEN, await tokenFor(customerA))
    expect(res.status).toBe(403)
  })

  it('no token is refused (403 No token provided) and a garbage token is 401', async () => {
    const noToken = await request(app).get(`/api/users/${customerA._id}/balance`)
    expect(noToken.status).toBe(403)
    const garbage = await request(app)
      .get(`/api/users/${customerA._id}/balance`)
      .set(env.X_ACCESS_TOKEN, 'not-a-token')
    expect(garbage.status).toBe(401)
  })

  it('platform admin reads any client (200)', async () => {
    const res = await request(app)
      .get(`/api/users/${customerA._id}/balance`)
      .set(env.X_ACCESS_TOKEN, await tokenFor(admin))
    expect(res.status).toBe(200)
    expect(res.body.outstanding).toBe(300)
  })

  it('owning supplier reads their client (200)', async () => {
    const res = await request(app)
      .get(`/api/users/${customerA._id}/balance`)
      .set(env.X_ACCESS_TOKEN, await tokenFor(supplier))
    expect(res.status).toBe(200)
    expect(res.body.outstanding).toBe(300)
  })

  it('agency staff with ReadClients reads the client (200); without it is refused (403)', async () => {
    const manager = await request(app)
      .get(`/api/users/${customerA._id}/balance`)
      .set(env.X_ACCESS_TOKEN, await tokenFor(staffManager))
    expect(manager.status).toBe(200)
    expect(manager.body.outstanding).toBe(300)
    const mechanic = await request(app)
      .get(`/api/users/${customerA._id}/balance`)
      .set(env.X_ACCESS_TOKEN, await tokenFor(staffMechanic))
    expect(mechanic.status).toBe(403)
  })
})
