import 'dotenv/config'
import request from 'supertest'
import zlib from 'zlib'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import app from '../src/app'
import Booking from '../src/models/Booking'
import Invoice from '../src/models/Invoice'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

// GH-25 — invoices carry no Moroccan fiscal identity: the snapshot is
// taken at issue time, the PDF reads the snapshot first, and the list/get
// JSON exposes the supplier's fiscal fields.

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
let supplierBare: any
let driver: any
let location: any
let car: any

const fiscal = {
  ice: '001234567000001',
  registreCommerce: 'RC-CASA-123456',
  identifiantFiscal: 'IF-987654',
  patente: 'PAT-555',
  rib: '0077800001234567890123456',
  fiscalAddress: '12 Rue Moussa Bnou Noussair, Casablanca',
  city: 'Casablanca',
}

const makeBooking = async (supplierId: mongoose.Types.ObjectId, price: number) => {
  const booking = await Booking.create({
    supplier: supplierId, car: car._id, driver: driver._id,
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

const makeDraftInvoice = async (supplierId: mongoose.Types.ObjectId, bookingId: mongoose.Types.ObjectId, total: number) => {
  const invoice = await Invoice.create({
    supplier: supplierId, booking: bookingId,
    currency: 'MAD', subtotal: total, taxAmount: 0, total,
    status: bookcarsTypes.InvoiceStatus.Draft,
  })
  fixtureInvoiceIds.push(invoice._id)
  return invoice
}

const issueInvoice = async (invoiceId: mongoose.Types.ObjectId) => {
  const res = await request(app)
    .post(`/api/invoices/${invoiceId.toString()}/issue`)
    .set(env.X_ACCESS_TOKEN, adminToken)
    .send({})
  expect(res.status).toBe(200)
  return res
}

// supertest/superagent does not buffer a PDF body by default, so fetch it
// as a raw Buffer; pdf-lib Flate-compresses content streams, so search the
// inflated streams too.
const fetchPdf = async (invoiceId: mongoose.Types.ObjectId) => {
  const res = await request(app)
    .get(`/api/invoices/${invoiceId.toString()}/pdf`)
    .set(env.X_ACCESS_TOKEN, adminToken)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => callback(null, Buffer.concat(chunks)))
    })
  expect(res.status).toBe(200)
  return res.body as Buffer
}

const pdfContains = (pdf: Buffer, needle: string): boolean => {
  const target = Buffer.from(needle)
  if (pdf.includes(target)) return true
  // pdf-lib writes drawn text as hex strings inside the (Flate-compressed)
  // content stream, so search the hex form in the inflated streams too.
  const hex = Buffer.from(needle).toString('hex').toUpperCase()
  const text = pdf.toString('latin1')
  if (text.includes(hex)) return true
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let match: RegExpExecArray | null
  while ((match = streamRe.exec(text)) !== null) {
    const raw = Buffer.from(match[1], 'latin1')
    try {
      if (zlib.inflateSync(raw).toString('latin1').includes(hex)) return true
    } catch { /* not a Flate stream */ }
  }
  return false
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh25-admin', email: `gh25-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  supplier = await User.create({
    email: `gh25-supplier-${rand()}@test.bookcars.ma`, fullName: 'GH-25 Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
    ...fiscal,
  })
  fixtureUserIds.push(supplier._id)
  supplierBare = await User.create({
    email: `gh25-supplier-bare-${rand()}@test.bookcars.ma`, fullName: 'GH-25 Bare Supplier',
    language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true,
  })
  fixtureUserIds.push(supplierBare._id)
  driver = await User.create({
    email: `gh25-driver-${rand()}@test.bookcars.ma`, fullName: 'GH-25 Driver',
    language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(driver._id)
  const valueEn = await LocationValue.create({ language: 'en', value: `GH-25 Casablanca Airport ${rand()}` })
  fixtureLocationValueIds.push(valueEn._id)
  location = await Location.create({ country: new mongoose.Types.ObjectId(), values: [valueEn._id] })
  fixtureLocationIds.push(location._id)
  car = await Car.create({
    name: 'GH-25 car', supplier: supplier._id, minimumAge: 21,
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
  await Invoice.deleteMany({ _id: { $in: fixtureInvoiceIds } })
  await Booking.deleteMany({ _id: { $in: fixtureBookingIds } })
  await Car.deleteMany({ _id: { $in: fixtureCarIds } })
  await Location.deleteMany({ _id: { $in: fixtureLocationIds } })
  await LocationValue.deleteMany({ _id: { $in: fixtureLocationValueIds } })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-25 fiscal identity snapshot', () => {
  test('issue snapshots the supplier fiscal identity onto the invoice JSON', async () => {
    const booking = await makeBooking(supplier._id, 1350)
    const invoice = await makeDraftInvoice(supplier._id, booking._id, 1350)
    const res = await issueInvoice(invoice._id)
    expect(res.body.status).toBe(bookcarsTypes.InvoiceStatus.Issued)
    expect(res.body.fiscalIdentity).toMatchObject(fiscal)
    // The list JSON exposes the supplier fiscal fields via populate too.
    const listed = await request(app).get('/api/invoices').set(env.X_ACCESS_TOKEN, adminToken)
    expect(listed.status).toBe(200)
    const row = (listed.body as any[]).find((item) => item._id === invoice._id.toString())
    expect(row).toBeTruthy()
    expect(row.fiscalIdentity).toMatchObject(fiscal)
    expect(row.supplier.ice).toBe(fiscal.ice)
    expect(row.supplier.registreCommerce).toBe(fiscal.registreCommerce)
  })

  test('editing the supplier ICE later leaves the snapshot and the PDF on the old ICE', async () => {
    const booking = await makeBooking(supplier._id, 1350)
    const invoice = await makeDraftInvoice(supplier._id, booking._id, 1350)
    await issueInvoice(invoice._id)

    const newIce = '009998887776665'
    await User.updateOne({ _id: supplier._id }, { ice: newIce })
    const fresh = await Invoice.findById(invoice._id).lean()
    expect(fresh?.fiscalIdentity?.ice).toBe(fiscal.ice)

    const bytes = await fetchPdf(invoice._id)
    expect(pdfContains(bytes, `ICE: ${fiscal.ice}`)).toBe(true)
    expect(pdfContains(bytes, `ICE: ${newIce}`)).toBe(false)

    // Restore the supplier record for the other tests.
    await User.updateOne({ _id: supplier._id }, { ice: fiscal.ice })
  })

  test('supplier with no fiscal fields issues fine with an empty snapshot and no ICE line in the PDF', async () => {
    const booking = await makeBooking(supplierBare._id, 1350)
    const invoice = await makeDraftInvoice(supplierBare._id, booking._id, 1350)
    const res = await issueInvoice(invoice._id)
    const snapshot = res.body.fiscalIdentity
    expect(!snapshot || Object.keys(snapshot).length === 0).toBe(true)

    const bytes = await fetchPdf(invoice._id)
    expect(pdfContains(bytes, 'ICE:')).toBe(false)
  })
})
