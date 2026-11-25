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
import Approval from '../src/models/Approval'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import { postRentalPayment } from '../src/utils/ledger'

// GH-29 — above-threshold invoices read unpaid while rent is in hand:
// the auto-link guard refuses the link, so the issue/list responses must
// expose the held rent as a computed field instead of a stored one.

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

const makeBooking = async (price: number) => {
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: at(1), to: at(3),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
      mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
      rentalTotal: price, depositAmount: 0,
      amountDueNow: price, amountDueNowInPaymentCurrency: price, quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
  return booking
}

const postRent = async (bookingId: mongoose.Types.ObjectId, amount: number) => {
  await postRentalPayment({
    bookingId: bookingId.toString(), date: new Date(), amount, currency: 'MAD',
    method: bookcarsTypes.RentalPaymentMethod.Card,
    purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
    source: bookcarsTypes.RentalPaymentSource.Stripe,
    providerReference: `pi_gh29_${rand()}`,
    actorId: adminId,
  })
  const payment = await RentalPayment.findOne({ booking: bookingId, purpose: bookcarsTypes.RentalPaymentPurpose.Rent }).lean()
  expect(payment).toBeTruthy()
  return payment!
}

const makeDraftInvoice = async (bookingId: mongoose.Types.ObjectId, total: number) => {
  const invoice = await Invoice.create({
    supplier: supplier._id, booking: bookingId,
    currency: 'MAD', subtotal: total, taxAmount: 0, total,
    status: bookcarsTypes.InvoiceStatus.Draft,
  })
  fixtureInvoiceIds.push(invoice._id)
  return invoice
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh29-admin', email: `gh29-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  supplier = await User.create({
    email: `gh29-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-29 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `gh29-driver-${rand()}@test.bookcars.ma`, fullName: 'GH-29 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `GH-29 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'GH-29 car', supplier: supplier._id, minimumAge: 21,
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
  await Approval.deleteMany({ supplier: supplier?._id })
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

describe('GH-29 held rent on invoices', () => {
  test('above-threshold issue reads paidAmount 0 with heldRentAmount 10,500; manual link clears it', async () => {
    const booking = await makeBooking(10500)
    const payment = await postRent(booking._id, 10500)
    const invoice = await makeDraftInvoice(booking._id, 10500)

    const issued = await request(app)
      .post(`/api/invoices/${invoice._id.toString()}/issue`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({})
    expect(issued.status).toBe(200)
    expect(issued.body.status).toBe(bookcarsTypes.InvoiceStatus.Issued)
    expect(issued.body.paidAmount).toBe(0)
    expect(issued.body.paymentStatus).toBe('unpaid')
    expect(issued.body.heldRentAmount).toBe(10500)

    // The issue produced a pending approval gate; the decide endpoint
    // refuses self-approval (decision 1.4) and the test admin is the
    // requester, so the approval is granted by the same state change
    // decide() would persist — the gate under test is recordPayment's.
    const approval = await Approval.findOne({ subject: invoice._id.toString() })
    expect(approval).toBeTruthy()
    expect(approval?.status).toBe(bookcarsTypes.ApprovalDecision.Pending)
    await Approval.updateOne({ _id: approval!._id }, { status: bookcarsTypes.ApprovalDecision.Approved })

    const linked = await request(app)
      .post(`/api/invoices/${invoice._id.toString()}/payments`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ payment: payment._id.toString() })
    expect(linked.status).toBe(200)
    expect(linked.body.paidAmount).toBe(10500)
    expect(linked.body.paymentStatus).toBe('paid')
    expect(linked.body.heldRentAmount).toBe(0)
  })

  test('below-threshold issue auto-links: heldRentAmount 0, paidAmount 1350, list carries it too', async () => {
    const booking = await makeBooking(1350)
    await postRent(booking._id, 1350)
    const invoice = await makeDraftInvoice(booking._id, 1350)

    const issued = await request(app)
      .post(`/api/invoices/${invoice._id.toString()}/issue`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({})
    expect(issued.status).toBe(200)
    expect(issued.body.paidAmount).toBe(1350)
    expect(issued.body.paymentStatus).toBe('paid')
    expect(issued.body.heldRentAmount).toBe(0)

    const listed = await request(app)
      .get('/api/invoices')
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(listed.status).toBe(200)
    const row = (listed.body as any[]).find((item) => item._id === invoice._id.toString())
    expect(row).toBeTruthy()
    expect(row.heldRentAmount).toBe(0)
  })
})
