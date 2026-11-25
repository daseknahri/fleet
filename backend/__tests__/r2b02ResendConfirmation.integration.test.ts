import 'dotenv/config'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import Booking from '../src/models/Booking'
import NotificationDelivery from '../src/models/NotificationDelivery'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// R2-B02 - paid-booking confirmation email: confirm() through the
// delivery log + the resend handler. The handlers are called directly
// (no HTTP app is booted here, same as the Wave32 file); the mailer is
// mocked so the send path is exercised without SMTP. The pack's case (1)
// (finalise a paid checkout) is covered by calling confirm() directly on
// a Paid booking - finalizePaidCheckoutBooking delegates to confirm()
// for the send, and no Stripe session fixture exists in this file.

const mailSendMock: any = jest.fn(async () => ({ messageId: 'r2b02-test-message-id' }))

jest.unstable_mockModule('../src/utils/mailHelper.js', () => ({
  sendMail: mailSendMock,
}))

const day = 86400000
const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const at = (days: number) => new Date(Date.now() + days * day)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []

let supplier: any
let driver: any
let location: any
let car: any
let confirm: (user: any, supplier: any, booking: any, payLater: boolean, opts?: { dedupeKey?: string }) => Promise<boolean>
let resendConfirmation: (req: any, res: any) => Promise<void>

const makeBooking = async (label: string, status: bookcarsTypes.BookingStatus) => {
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: at(1), to: at(3),
    status,
    lifecycle: bookcarsTypes.ContractLifecycle.Confirmed,
    price: 500,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
      mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
      rentalTotal: 500, depositAmount: 0,
      amountDueNow: 500, amountDueNowInPaymentCurrency: 500, quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
  return booking
}

const deliveries = (filter: Record<string, unknown>) =>
  NotificationDelivery.find({ supplier: supplier._id, ...filter }).lean()

const callResend = async (id: string) => {
  const req = { params: { id } } as any
  let statusCode = 200
  let payload: any
  const res = {
    status: (c: number) => { statusCode = c; return res },
    send: (b: any) => { payload = b; return res },
    sendStatus: (c: number) => { statusCode = c; return res },
    json: (b: any) => { payload = b; return res },
  } as any
  await resendConfirmation(req, res)
  return { statusCode, payload }
}

beforeAll(async () => {
  ;({ confirm, resendConfirmation } = await import('../src/controllers/bookingController'))
  await databaseHelper.connect(env.DB_URI, false, false)
  supplier = await User.create({
    email: `r2b02-supplier-${rand()}@test.bookcars.ma`, fullName: 'R2-B02 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `r2b02-driver-${rand()}@test.bookcars.ma`, fullName: 'R2-B02 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `R2-B02 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'R2-B02 car', supplier: supplier._id, minimumAge: 21,
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
  await NotificationDelivery.deleteMany({ supplier: supplier._id })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  fixtureBookingIds.length = 0
  jest.resetAllMocks()
  mailSendMock.mockResolvedValue({ messageId: 'r2b02-test-message-id' })
})

afterAll(async () => {
  await NotificationDelivery.deleteMany({ supplier: supplier._id })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})

describe('R2-B02 - confirmation email resend', () => {
  it('failing mailer: confirm() returns false, booking stays Paid, no sent row; resend then succeeds', async () => {
    const booking = await makeBooking('b02-paid', bookcarsTypes.BookingStatus.Paid)
    mailSendMock.mockRejectedValue(new Error('smtp down'))
    try {
      expect(await confirm(driver, supplier, booking, false)).toBe(false)
    } finally {
      mailSendMock.mockResolvedValue({ messageId: 'r2b02-test-message-id' })
    }
    expect((await Booking.findById(booking._id))?.status).toBe(bookcarsTypes.BookingStatus.Paid)
    expect((await deliveries({ templateKey: 'booking.confirmation', subjectId: String(booking._id), status: 'sent' })).length).toBe(0)
    // The failure is visible in the log as a failed row (not silently lost).
    expect((await deliveries({ templateKey: 'booking.confirmation', subjectId: String(booking._id), status: 'failed' })).length).toBeGreaterThanOrEqual(1)
    // Mailer back: the resend delivers, exactly one sent row, resend key.
    const { statusCode, payload } = await callResend(String(booking._id))
    expect(statusCode).toBe(200)
    expect(payload).toEqual({ sent: true })
    const rows = await deliveries({ templateKey: 'booking.confirmation', subjectId: String(booking._id), status: 'sent' })
    expect(rows.length).toBe(1)
    expect(rows[0].dedupeKey).toMatch(/^confirmation-resend:/)
  })

  it('a second resend is a second sent row, not a silent no-op', async () => {
    const booking = await makeBooking('b02-resend2', bookcarsTypes.BookingStatus.Paid)
    expect((await callResend(String(booking._id))).statusCode).toBe(200)
    expect((await callResend(String(booking._id))).statusCode).toBe(200)
    const rows = await deliveries({ templateKey: 'booking.confirmation', subjectId: String(booking._id), status: 'sent' })
    expect(rows.length).toBe(2)
    expect(new Set(rows.map((r: any) => r.dedupeKey)).size).toBe(2)
  })

  it('resend on a Cancelled booking: 409, no sent row', async () => {
    const booking = await makeBooking('b02-cancelled', bookcarsTypes.BookingStatus.Cancelled)
    const { statusCode } = await callResend(String(booking._id))
    expect(statusCode).toBe(409)
    expect((await deliveries({ templateKey: 'booking.confirmation', subjectId: String(booking._id), status: 'sent' })).length).toBe(0)
  })

  it('resend with the mailer down: 502, no sent row', async () => {
    const booking = await makeBooking('b02-mailer-down', bookcarsTypes.BookingStatus.Paid)
    mailSendMock.mockRejectedValue(new Error('smtp down'))
    try {
      const { statusCode } = await callResend(String(booking._id))
      expect(statusCode).toBe(502)
    } finally {
      mailSendMock.mockResolvedValue({ messageId: 'r2b02-test-message-id' })
    }
    expect((await deliveries({ templateKey: 'booking.confirmation', subjectId: String(booking._id), status: 'sent' })).length).toBe(0)
  })
})
