import 'dotenv/config'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import { createSigningToken, newSigningNonce } from '../src/utils/bookingSigning'

// R2-A12 - getSigningSummary returns ledger-derived paidAmount /
// balanceDue / pickupLocation. The handler is called directly (no HTTP
// app is booted here, same as the Wave32 / B02 files); the token is a
// real HMAC token minted over the booking's signingNonce.

const day = 86400000
const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const at = (days: number) => new Date(Date.now() + days * day)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixturePaymentIds: mongoose.Types.ObjectId[] = []

let supplier: any
let driver: any
let location: any
let locationValueName: string
let car: any
let getSigningSummary: (req: any, res: any) => Promise<void>

const makeBooking = async (opts: {
  status: bookcarsTypes.BookingStatus, mode: bookcarsTypes.CheckoutPaymentMode,
  price?: number, deposit?: number,
}) => {
  const nonce = newSigningNonce()
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: at(1), to: at(3),
    status: opts.status,
    lifecycle: bookcarsTypes.ContractLifecycle.Confirmed,
    price: opts.price ?? 500,
    signingNonce: nonce,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
      mode: opts.mode,
      rentalTotal: opts.price ?? 500, depositAmount: opts.deposit ?? 250,
      amountDueNow: opts.price ?? 500, amountDueNowInPaymentCurrency: opts.price ?? 500, quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
  return { booking, nonce }
}

const makePayment = async (bookingId: mongoose.Types.ObjectId, purpose: bookcarsTypes.RentalPaymentPurpose, amount: number) => {
  const p = await RentalPayment.create({
    supplier: supplier._id, booking: bookingId, date: new Date(),
    amount, currency: 'MAD',
    method: bookcarsTypes.RentalPaymentMethod.Cash,
    purpose, direction: bookcarsTypes.RentalPaymentDirection.Credit,
    source: bookcarsTypes.RentalPaymentSource.Manual,
    status: bookcarsTypes.RentalPaymentStatus.Posted,
  })
  fixturePaymentIds.push(p._id)
  return p
}

const callSummary = async (token: string) => {
  const req = { params: { token }, method: 'GET', path: `/api/sign/${token}` } as any
  let statusCode = 200
  let payload: any
  const res = {
    headersSent: false,
    setHeader: () => res,
    set: () => res,
    status: (c: number) => { statusCode = c; return res },
    send: (b: any) => { payload = b; return res },
    sendStatus: (c: number) => { statusCode = c; return res },
    json: (b: any) => { payload = b; return res },
  } as any
  await getSigningSummary(req, res)
  return { statusCode, payload }
}

beforeAll(async () => {
  ;({ getSigningSummary } = await import('../src/controllers/signingController'))
  await databaseHelper.connect(env.DB_URI, false, false)
  supplier = await User.create({
    email: `r2a12-supplier-${rand()}@test.bookcars.ma`, fullName: 'R2-A12 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `r2a12-driver-${rand()}@test.bookcars.ma`, fullName: 'R2-A12 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  locationValueName = `R2-A12 Casablanca Airport ${rand()}`
  const valueEn = await LocationValue.create({ language: 'en', value: locationValueName })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'R2-A12 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
})

afterEach(async () => {
  await RentalPayment.deleteMany({ _id: { $in: fixturePaymentIds } })
  fixturePaymentIds.length = 0
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  fixtureBookingIds.length = 0
})

afterAll(async () => {
  await RentalPayment.deleteMany({ _id: { $in: fixturePaymentIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})

describe('R2-A12 - signing summary paid / due / pickup location', () => {
  it('paid-in-full: paidAmount is rental + deposit, balanceDue is 0', async () => {
    const { booking, nonce } = await makeBooking({ status: bookcarsTypes.BookingStatus.Paid, mode: bookcarsTypes.CheckoutPaymentMode.Deposit })
    await makePayment(booking._id, bookcarsTypes.RentalPaymentPurpose.Rent, 500)
    await makePayment(booking._id, bookcarsTypes.RentalPaymentPurpose.Deposit, 250)
    const { token } = createSigningToken(String(booking._id), nonce)
    const { statusCode, payload } = await callSummary(token)
    expect(statusCode).toBe(200)
    expect(payload.paidAmount).toBe(750)
    expect(payload.balanceDue).toBe(0)
    expect(payload.pickupLocation).toBe(locationValueName)
    expect(payload.rentalTotal).toBe(500)
    expect(payload.depositAmount).toBe(250)
  })

  it('pay-later (Confirmed, no payments): paidAmount 0, balanceDue rental + deposit', async () => {
    const { booking, nonce } = await makeBooking({ status: bookcarsTypes.BookingStatus.Pending, mode: bookcarsTypes.CheckoutPaymentMode.PayLater })
    const { token } = createSigningToken(String(booking._id), nonce)
    const { statusCode, payload } = await callSummary(token)
    expect(statusCode).toBe(200)
    expect(payload.paidAmount).toBe(0)
    expect(payload.balanceDue).toBe(750)
    expect(payload.pickupLocation).toBe(locationValueName)
  })

  it('partial (deposit paid, rent unpaid): paidAmount is the deposit, balanceDue is the rental total', async () => {
    const { booking, nonce } = await makeBooking({ status: bookcarsTypes.BookingStatus.Deposit, mode: bookcarsTypes.CheckoutPaymentMode.Deposit })
    await makePayment(booking._id, bookcarsTypes.RentalPaymentPurpose.Deposit, 250)
    const { token } = createSigningToken(String(booking._id), nonce)
    const { statusCode, payload } = await callSummary(token)
    expect(statusCode).toBe(200)
    expect(payload.paidAmount).toBe(250)
    expect(payload.balanceDue).toBe(500)
    expect(payload.pickupLocation).toBe(locationValueName)
  })

  it('a forged token answers the generic invalid-link 400', async () => {
    const { booking, nonce } = await makeBooking({ status: bookcarsTypes.BookingStatus.Paid, mode: bookcarsTypes.CheckoutPaymentMode.Deposit })
    const { token } = createSigningToken(String(booking._id), nonce)
    const forged = `${token.slice(0, -4)}aaaa`
    const { statusCode, payload } = await callSummary(forged)
    expect(statusCode).toBe(400)
    expect(payload.message).toBe('SIGN_LINK_INVALID')
  })
})
