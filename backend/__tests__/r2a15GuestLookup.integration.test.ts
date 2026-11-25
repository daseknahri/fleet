import 'dotenv/config'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import Booking from '../src/models/Booking'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// R2-A15 - guest booking lookup by reference + email. No oracle: a
// wrong reference OR a wrong email answers the same generic 404.
// Handlers are called directly (no HTTP app is booted here, same as
// the B02/A06 files); the rate limiter on the route is not asserted.

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
let booking: any
let reference: string
let sessionId: string
let lookupGuestBooking: (req: any, res: any) => Promise<void>

const mockRes = () => {
  let statusCode = 200
  let payload: any
  const res: any = {
    status: (c: number) => { statusCode = c; return res },
    send: (b: any) => { payload = b; return res },
    sendStatus: (c: number) => { statusCode = c; return res },
    json: (b: any) => { payload = b; return res },
  }
  return { res, get: () => ({ statusCode, payload }) }
}
beforeAll(async () => {
  ;({ lookupGuestBooking } = await import('../src/controllers/bookingController'))
  await databaseHelper.connect(env.DB_URI, false, false)
  supplier = await User.create({
    email: `r2a15-supplier-${rand()}@test.bookcars.ma`, fullName: 'R2-A15 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `r2a15-driver-${rand()}@test.bookcars.ma`, fullName: 'R2-A15 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: false, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `R2-A15 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'R2-A15 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  reference = `R2A15-${rand().toUpperCase()}`
  sessionId = `sess-r2a15-${rand()}`
  booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: at(1), to: at(3),
    status: bookcarsTypes.BookingStatus.Paid,
    lifecycle: bookcarsTypes.ContractLifecycle.Confirmed,
    price: 500, reference, sessionId,
    financialSnapshot: {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD',
      mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
      rentalTotal: 500, depositAmount: 0,
      amountDueNow: 500, amountDueNowInPaymentCurrency: 500, quotedAt: new Date(),
    },
  } as any)
  fixtureBookingIds.push(booking._id)
})

afterAll(async () => {
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})
describe('R2-A15 - guest booking lookup', () => {
  it('correct reference + email -> 200 with bookingId + sessionId', async () => {
    const { res, get } = mockRes()
    await lookupGuestBooking({ body: { reference, email: driver.email } } as any, res)
    const { statusCode, payload } = get()
    expect(statusCode).toBe(200)
    expect(String(payload.bookingId)).toBe(String(booking._id))
    expect(payload.sessionId).toBe(sessionId)
  })

  it('email match is case-insensitive', async () => {
    const { res, get } = mockRes()
    await lookupGuestBooking({ body: { reference, email: String(driver.email).toUpperCase() } } as any, res)
    expect(get().statusCode).toBe(200)
  })

  it('wrong email -> 404 generic', async () => {
    const { res, get } = mockRes()
    await lookupGuestBooking({ body: { reference, email: `wrong-${rand()}@test.bookcars.ma` } } as any, res)
    const { statusCode, payload } = get()
    expect(statusCode).toBe(404)
    expect(payload).toBe('No booking found for this reference and email')
  })

  it('wrong reference -> 404 with the identical body (no oracle)', async () => {
    const { res, get } = mockRes()
    await lookupGuestBooking({ body: { reference: `R2A15-${rand().toUpperCase()}`, email: driver.email } } as any, res)
    const { statusCode, payload } = get()
    expect(statusCode).toBe(404)
    expect(payload).toBe('No booking found for this reference and email')
  })

  it('missing fields -> 400', async () => {
    const { res, get } = mockRes()
    await lookupGuestBooking({ body: { reference } } as any, res)
    expect(get().statusCode).toBe(400)
    const second = mockRes()
    await lookupGuestBooking({ body: {} } as any, second.res)
    expect(second.get().statusCode).toBe(400)
  })
})
