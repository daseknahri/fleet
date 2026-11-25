import 'dotenv/config'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import Booking from '../src/models/Booking'
import Invoice from '../src/models/Invoice'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// R2-A06 - customer-scoped invoice read: the driver sees their own
// invoice summary + PDF; another user gets 403; no invoice -> 204;
// a Draft invoice is visible but its PDF 409s. Handlers are called
// directly (no HTTP app is booted here, same as the B02 file); the
// 401-no-token case is the verifyToken middleware on the route, not
// the handler, so it is covered by construction, not asserted here.

const day = 86400000
const oid = () => new mongoose.Types.ObjectId()
const rand = () => Math.random().toString(36).slice(2)
const at = (days: number) => new Date(Date.now() + days * day)

const fixtureUserIds: mongoose.Types.ObjectId[] = []
const fixtureCarIds: mongoose.Types.ObjectId[] = []
const fixtureLocationIds: mongoose.Types.ObjectId[] = []
const fixtureLocationValueIds: mongoose.Types.ObjectId[] = []
const fixtureBookingIds: mongoose.Types.ObjectId[] = []
const fixtureInvoiceIds: mongoose.Types.ObjectId[] = []

let supplier: any
let driver: any
let other: any
let location: any
let car: any
let bookingIssued: any
let bookingDraft: any
let bookingNone: any
let invoiceIssued: any
let invoiceDraft: any
let getCustomerInvoiceByBooking: (req: any, res: any) => Promise<void>
let getCustomerInvoicePdf: (req: any, res: any) => Promise<void>

const mockRes = () => {
  let statusCode = 200
  let payload: any
  const headers: Record<string, string> = {}
  const res: any = {
    status: (c: number) => { statusCode = c; return res },
    send: (b: any) => { payload = b; return res },
    sendStatus: (c: number) => { statusCode = c; return res },
    json: (b: any) => { payload = b; return res },
    type: (t: string) => { headers['content-type'] = t; return res },
    set: (k: string, v: string) => { headers[k.toLowerCase()] = v; return res },
  }
  return { res, get: () => ({ statusCode, payload, headers }) }
}
const makeBooking = async () => {
  const booking = await Booking.create({
    supplier: supplier._id, car: car._id, driver: driver._id,
    pickupLocation: location._id, dropOffLocation: location._id,
    from: at(1), to: at(3),
    status: bookcarsTypes.BookingStatus.Paid,
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

beforeAll(async () => {
  ;({ getCustomerInvoiceByBooking, getCustomerInvoicePdf } = await import('../src/controllers/invoiceController'))
  await databaseHelper.connect(env.DB_URI, false, false)
  supplier = await User.create({
    email: `r2a06-supplier-${rand()}@test.bookcars.ma`, fullName: 'R2-A06 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplier._id)
  driver = await User.create({
    email: `r2a06-driver-${rand()}@test.bookcars.ma`, fullName: 'R2-A06 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  other = await User.create({
    email: `r2a06-other-${rand()}@test.bookcars.ma`, fullName: 'R2-A06 Other',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(other._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `R2-A06 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: oid(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'R2-A06 car', supplier: supplier._id, minimumAge: 21,
    locations: [location._id], dailyPrice: 100, deposit: 250, available: true,
    type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0,
    collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5, blockOnPay: true,
  } as any)
  fixtureCarIds.push(car._id)
  bookingIssued = await makeBooking()
  bookingDraft = await makeBooking()
  bookingNone = await makeBooking()
  invoiceIssued = await Invoice.create({
    supplier: supplier._id, booking: bookingIssued._id, number: `INV-R2A06-${rand()}`,
    status: bookcarsTypes.InvoiceStatus.Issued, currency: 'MAD',
    subtotal: 500, taxAmount: 100, total: 600, paidAmount: 600, paymentStatus: 'paid',
  } as any)
  fixtureInvoiceIds.push(invoiceIssued._id)
  invoiceDraft = await Invoice.create({
    supplier: supplier._id, booking: bookingDraft._id,
    status: bookcarsTypes.InvoiceStatus.Draft, currency: 'MAD',
    subtotal: 500, taxAmount: 100, total: 600, paidAmount: 0, paymentStatus: 'unpaid',
  } as any)
  fixtureInvoiceIds.push(invoiceDraft._id)
})

afterAll(async () => {
  await Invoice.deleteMany({ _id: { $in: fixtureInvoiceIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await databaseHelper.close()
})
describe('R2-A06 - customer invoice by booking', () => {
  it('driver: issued invoice -> 200 with the summary', async () => {
    const { res, get } = mockRes()
    await getCustomerInvoiceByBooking({ params: { bookingId: String(bookingIssued._id) }, user: { _id: driver._id } } as any, res)
    const { statusCode, payload } = get()
    expect(statusCode).toBe(200)
    expect(String(payload.id)).toBe(String(invoiceIssued._id))
    expect(payload.number).toBe(invoiceIssued.number)
    expect(payload.status).toBe(bookcarsTypes.InvoiceStatus.Issued)
    expect(payload.total).toBe(600)
    expect(payload.currency).toBe('MAD')
  })

  it('driver: draft invoice -> 200 with status Draft (no PDF link rendered)', async () => {
    const { res, get } = mockRes()
    await getCustomerInvoiceByBooking({ params: { bookingId: String(bookingDraft._id) }, user: { _id: driver._id } } as any, res)
    const { statusCode, payload } = get()
    expect(statusCode).toBe(200)
    expect(payload.status).toBe(bookcarsTypes.InvoiceStatus.Draft)
    expect(payload.number).toBeUndefined()
  })

  it('another user: 403', async () => {
    const { res, get } = mockRes()
    await getCustomerInvoiceByBooking({ params: { bookingId: String(bookingIssued._id) }, user: { _id: other._id } } as any, res)
    expect(get().statusCode).toBe(403)
  })

  it('no invoice for the booking: 204', async () => {
    const { res, get } = mockRes()
    await getCustomerInvoiceByBooking({ params: { bookingId: String(bookingNone._id) }, user: { _id: driver._id } } as any, res)
    expect(get().statusCode).toBe(204)
  })

  it('unknown booking: 204 (no oracle)', async () => {
    const { res, get } = mockRes()
    await getCustomerInvoiceByBooking({ params: { bookingId: String(oid()) }, user: { _id: driver._id } } as any, res)
    expect(get().statusCode).toBe(204)
  })
})
describe('R2-A06 - customer invoice PDF', () => {
  it('driver: issued invoice -> PDF with the right filename', async () => {
    const { res, get } = mockRes()
    await getCustomerInvoicePdf({ params: { id: String(invoiceIssued._id) }, user: { _id: driver._id } } as any, res)
    const { statusCode, payload, headers } = get()
    expect(statusCode).toBe(200)
    expect(headers['content-type']).toBe('application/pdf')
    expect(headers['content-disposition']).toContain(`invoice-${invoiceIssued.number}.pdf`)
    expect(Buffer.isBuffer(payload)).toBe(true)
    expect(payload.slice(0, 4).toString('ascii')).toBe('%PDF')
  })

  it('another user: 403', async () => {
    const { res, get } = mockRes()
    await getCustomerInvoicePdf({ params: { id: String(invoiceIssued._id) }, user: { _id: other._id } } as any, res)
    expect(get().statusCode).toBe(403)
  })

  it('draft invoice PDF: 409', async () => {
    const { res, get } = mockRes()
    await getCustomerInvoicePdf({ params: { id: String(invoiceDraft._id) }, user: { _id: driver._id } } as any, res)
    expect(get().statusCode).toBe(409)
  })

  it('unknown invoice: 404', async () => {
    const { res, get } = mockRes()
    await getCustomerInvoicePdf({ params: { id: String(oid()) }, user: { _id: driver._id } } as any, res)
    expect(get().statusCode).toBe(404)
  })
})
