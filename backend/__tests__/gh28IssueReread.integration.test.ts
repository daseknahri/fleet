import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import app from '../src/app'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import Invoice from '../src/models/Invoice'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import { postRentalPayment } from '../src/utils/ledger'

// GH-28 — the issue response renders paidAmount before the link lands:
// the issue-time rent linking saves a different in-memory copy, so the
// response must be re-read before it is sent.

const day = 86400000
const rand = () => Math.random().toString(36).slice(2)
const at = (days: number) => new Date(Date.now() + days * day)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixtureInvoiceIds: mongoose.Types.ObjectId[] = []

let adminToken: string
let adminId: string
let supplier: any
let driver: any
let location: any
let car: any

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh28-admin', email: `gh28-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  supplier = await User.create({
    email: `gh28-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-28 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `gh28-driver-${rand()}@test.bookcars.ma`, fullName: 'GH-28 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `GH-28 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'GH-28 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
})

afterAll(async () => {
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Invoice.deleteMany({ _id: { $in: fixtureInvoiceIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-28 issue response re-read', () => {
  test('POST issue returns the linked paidAmount, matching a fresh read', async () => {
    const booking = await Booking.create({
      supplier: supplier._id, car: car._id, driver: driver._id,
      pickupLocation: location._id, dropOffLocation: location._id,
      from: at(1), to: at(3),
      status: bookcarsTypes.BookingStatus.Pending,
      lifecycle: bookcarsTypes.ContractLifecycle.Draft,
      price: 1350,
      financialSnapshot: {
        version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
        mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
        rentalTotal: 1350, depositAmount: 0,
        amountDueNow: 1350, amountDueNowInPaymentCurrency: 1350, quotedAt: new Date(),
      },
    } as any)
    fixtureBookingIds.push(booking._id)

    // Rent posted while the invoice is still Draft: no link target yet.
    await postRentalPayment({
      bookingId: booking._id.toString(), date: new Date(), amount: 1350, currency: 'MAD',
      method: bookcarsTypes.RentalPaymentMethod.Card,
      purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
      source: bookcarsTypes.RentalPaymentSource.Stripe,
      providerReference: `pi_gh28_${rand()}`,
      actorId: adminId,
    })

    // Below-threshold (10,000 MAD) draft invoice for the full rent.
    const invoice = await Invoice.create({
      supplier: supplier._id, booking: booking._id,
      currency: 'MAD', subtotal: 1350, taxAmount: 0, total: 1350,
      status: bookcarsTypes.InvoiceStatus.Draft,
    })
    fixtureInvoiceIds.push(invoice._id)
    expect(invoice.paidAmount).toBe(0)

    const res = await request(app)
      .post(`/api/invoices/${invoice._id.toString()}/issue`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.status).toBe(bookcarsTypes.InvoiceStatus.Issued)
    expect(res.body.paidAmount).toBe(1350)
    expect(res.body.paymentStatus).toBe('paid')
    expect(res.body.payments).toHaveLength(1)

    // The response equals a fresh read of the same invoice.
    const fresh = await Invoice.findById(invoice._id).lean()
    expect(fresh?.paidAmount).toBe(res.body.paidAmount)
    expect(fresh?.paymentStatus).toBe(res.body.paymentStatus)
    expect(fresh?.payments?.map((id: mongoose.Types.ObjectId) => id.toString()).sort())
      .toEqual((res.body.payments as Array<{ _id?: string } | string>).map((p) => (typeof p === 'string' ? p : p._id)).sort())
  })
})
