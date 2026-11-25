import 'dotenv/config'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import { postRentalPayment } from '../src/utils/ledger'

// GH-38b — the confirmation email stated no money at all. confirm()
// now renders an amount block from getContractReceivable: rent total
// (incl. VAT), deposit held, already paid, amount due at pickup (or the
// nothing-due line), plus — pay-later only — the hold deadline and the
// cash-or-wire line. Amounts come from the ledger, never from
// booking.price; deposits are never netted against rent.

const mailSendMock: any = jest.fn(async () => ({ messageId: 'gh38b-test-message-id' }))

jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: mailSendMock,
}))

let confirmFn: (user: any, supplier: any, booking: any, payLater: boolean) => Promise<unknown>

const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const day = 86400000

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

let supplier: any
let driver: any
let location: any
let car: any
let adminId: string

const snapshot = (rentalTotal: number, depositAmount: number, mode: bookcarsTypes.CheckoutPaymentMode) => ({
  version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
  mode,
  rentalTotal, depositAmount,
  amountDueNow: rentalTotal, amountDueNowInPaymentCurrency: rentalTotal, quotedAt: new Date(),
})

const makeBooking = async (label: string, opts: { price: number, deposit: number, mode: bookcarsTypes.CheckoutPaymentMode, expireAt?: Date }) => {
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: new Date(Date.now() + day), to: new Date(Date.now() + 3 * day),
    status: bookcarsTypes.BookingStatus.Pending,
    lifecycle: bookcarsTypes.ContractLifecycle.Draft,
    price: opts.price,
    financialSnapshot: snapshot(opts.price, opts.deposit, opts.mode),
    ...(opts.expireAt ? { expireAt: opts.expireAt } : {}),
  } as any)
  fixtureBookingIds.push(booking._id)
  return booking
}

const postPayment = async (bookingId: mongoose.Types.ObjectId, amount: number, purpose: bookcarsTypes.RentalPaymentPurpose) =>
  postRentalPayment({
    bookingId: bookingId.toString(),
    date: new Date(),
    amount,
    currency: 'MAD',
    method: bookcarsTypes.RentalPaymentMethod.Card,
    purpose,
    source: bookcarsTypes.RentalPaymentSource.Stripe,
    providerReference: `pi_gh38b_${rand()}`,
    actorId: adminId,
  })

beforeAll(async () => {
  ;({ confirm: confirmFn } = await import('../src/controllers/bookingController'))
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh38b-admin', email: `gh38b-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(admin._id)
  adminId = admin._id.toString()
  supplier = await User.create({
    email: `gh38b-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-38b Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `gh38b-driver-${rand()}@test.bookcars.ma`, fullName: 'GH-38b Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `GH-38b Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'GH-38b car', supplier: supplier._id, minimumAge: 21,
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
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  fixtureBookingIds.length = 0
  jest.resetAllMocks()
  mailSendMock.mockResolvedValue({ messageId: 'gh38b-test-message-id' })
})

afterAll(async () => {
  await RentalPayment.deleteMany({ booking: { $in: fixtureBookingIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})

describe('GH-38b — confirmation email amount block', () => {
  it('paid booking: rent total + deposit + already-paid + nothing-due; no hold, no cash-or-wire', async () => {
    const booking = await makeBooking('paid', { price: 300, deposit: 50, mode: bookcarsTypes.CheckoutPaymentMode.Deposit })
    await postPayment(booking._id, 300, bookcarsTypes.RentalPaymentPurpose.Rent)
    await postPayment(booking._id, 50, bookcarsTypes.RentalPaymentPurpose.Deposit)
    const fresh = await Booking.findById(booking._id)
    await confirmFn(driver, supplier, fresh, false)
    expect(mailSendMock).toHaveBeenCalledTimes(1)
    const html = String(mailSendMock.mock.calls[0][0].html)
    expect(html).toMatch(/Rent total \(incl\. VAT\): 300 MAD/)
    expect(html).toMatch(/Deposit held: 50 MAD/)
    expect(html).toMatch(/Already paid: 350 MAD/)
    expect(html).toMatch(/Nothing due at pickup/)
    expect(html).not.toMatch(/pay-later hold expires/)
    expect(html).not.toMatch(/pay cash or by wire/)
    expect(html).not.toMatch(/Amount due at pickup/)
  })

  it('pay-later booking: due amount + hold deadline + cash-or-wire; no nothing-due', async () => {
    const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const booking = await makeBooking('paylater', { price: 300, deposit: 50, mode: bookcarsTypes.CheckoutPaymentMode.PayLater, expireAt })
    const fresh = await Booking.findById(booking._id)
    await confirmFn(driver, supplier, fresh, true)
    expect(mailSendMock).toHaveBeenCalledTimes(1)
    const html = String(mailSendMock.mock.calls[0][0].html)
    expect(html).toMatch(/Rent total \(incl\. VAT\): 300 MAD/)
    expect(html).toMatch(/Deposit held: 50 MAD/)
    expect(html).toMatch(/Already paid: 0 MAD/)
    expect(html).toMatch(/Amount due at pickup: 300 MAD/)
    expect(html).toMatch(/Your pay-later hold expires on /)
    expect(html).toMatch(/Please pay cash or by wire transfer at pickup/)
    expect(html).not.toMatch(/Nothing due at pickup/)
  })
})
