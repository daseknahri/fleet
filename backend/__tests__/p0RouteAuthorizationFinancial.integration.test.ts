import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import Invoice from '../src/models/Invoice'
import CashSession from '../src/models/CashSession'
import CashMovement from '../src/models/CashMovement'
import ContractSnapshot from '../src/models/ContractSnapshot'

const createdIds = {
  users: [] as mongoose.Types.ObjectId[],
  cars: [] as mongoose.Types.ObjectId[],
  bookings: [] as mongoose.Types.ObjectId[],
  payments: [] as mongoose.Types.ObjectId[],
  locations: [] as mongoose.Types.ObjectId[],
  locationValues: [] as mongoose.Types.ObjectId[],
  invoices: [] as mongoose.Types.ObjectId[],
  cashSessions: [] as mongoose.Types.ObjectId[],
  cashMovements: [] as mongoose.Types.ObjectId[],
  snapshots: [] as mongoose.Types.ObjectId[],
}

let supplierA: env.User
let supplierB: env.User
let driver: env.User
let carA: env.Car
let carB: env.Car
let bookingA: env.Booking
let bookingB: env.Booking
let locationA: env.Location
let locationB: env.Location
let tokenA: string
let tokenB: string
let adminToken: string

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const makeSupplier = async (label: string) => {
  const user = await new User({
    email: `p0-${label}-${suffix}@test.bookcars.ma`,
    fullName: `P0 ${label}`,
    language: 'en',
    type: bookcarsTypes.UserType.Supplier,
    active: true,
    verified: true,
    blacklisted: false,
    payLater: true,
  }).save()
  createdIds.users.push(user._id)
  return user
}

const makeLocation = async (label: string) => {
  const value = await new LocationValue({ language: 'en', value: `P0 ${label}` }).save()
  createdIds.locationValues.push(value._id)
  const location = await new Location({
    country: new mongoose.Types.ObjectId(),
    values: [value._id],
  }).save()
  createdIds.locations.push(location._id)
  return location
}

const makeCar = async (supplier: env.User, location: env.Location, label: string) => {
  const car = await new Car({
    name: `P0 ${label}`,
    supplier: supplier._id,
    minimumAge: 21,
    locations: [location._id],
    dailyPrice: 100,
    deposit: 500,
    available: true,
    type: bookcarsTypes.CarType.Diesel,
    gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true,
    seats: 5,
    doors: 4,
    fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1,
    cancellation: 0,
    amendments: 0,
    theftProtection: 0,
    collisionDamageWaiver: 0,
    fullInsurance: 0,
    additionalDriver: 0,
    range: bookcarsTypes.CarRange.Midi,
    multimedia: [],
    rating: 5,
  }).save()
  createdIds.cars.push(car._id)
  return car
}

const makeBooking = async (supplier: env.User, car: env.Car, location: env.Location, label: string) => {
  const booking = await new Booking({
    supplier: supplier._id,
    car: car._id,
    driver: driver._id,
    pickupLocation: location._id,
    dropOffLocation: location._id,
    from: new Date(Date.now() + (label === 'A' ? 2 : 10) * 86400000),
    to: new Date(Date.now() + (label === 'A' ? 4 : 12) * 86400000),
    status: bookcarsTypes.BookingStatus.Reserved,
    price: 1000,
    cancellation: false,
    amendments: false,
    theftProtection: false,
    collisionDamageWaiver: false,
    fullInsurance: false,
    additionalDriver: false,
  }).save()
  createdIds.bookings.push(booking._id)
  return booking
}

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)

  supplierA = await makeSupplier('agency-a')
  supplierB = await makeSupplier('agency-b')
  const admin = await new User({
    email: `p0-admin-${suffix}@test.bookcars.ma`,
    fullName: 'P0 Platform Admin',
    language: 'en',
    type: bookcarsTypes.UserType.Admin,
    active: true,
    verified: true,
    blacklisted: false,
  }).save()
  createdIds.users.push(admin._id)
  driver = await new User({
    email: `p0-driver-${suffix}@test.bookcars.ma`,
    fullName: 'P0 Driver',
    language: 'en',
    type: bookcarsTypes.UserType.User,
    active: true,
    verified: true,
    blacklisted: false,
  }).save()
  createdIds.users.push(driver._id)

  locationA = await makeLocation('Location A')
  locationB = await makeLocation('Location B')
  carA = await makeCar(supplierA, locationA, 'Car A')
  carB = await makeCar(supplierB, locationB, 'Car B')
  bookingA = await makeBooking(supplierA, carA, locationA, 'A')
  bookingB = await makeBooking(supplierB, carB, locationB, 'B')

  tokenA = await authHelper.encryptJWT({ id: supplierA._id.toString() })
  tokenB = await authHelper.encryptJWT({ id: supplierB._id.toString() })
  adminToken = await authHelper.encryptJWT({ id: admin._id.toString() })
})

afterAll(async () => {
  await CashMovement.deleteMany({ _id: { $in: createdIds.cashMovements } })
  await ContractSnapshot.deleteMany({ _id: { $in: createdIds.snapshots } })
  await CashSession.deleteMany({ _id: { $in: createdIds.cashSessions } })
  await Invoice.deleteMany({ _id: { $in: createdIds.invoices } })
  await RentalPayment.deleteMany({ _id: { $in: createdIds.payments } })
  await Booking.deleteMany({ _id: { $in: createdIds.bookings } })
  await Car.deleteMany({ _id: { $in: createdIds.cars } })
  await Location.deleteMany({ _id: { $in: createdIds.locations } })
  await LocationValue.deleteMany({ _id: { $in: createdIds.locationValues } })
  await User.deleteMany({ _id: { $in: createdIds.users } })
  await databaseHelper.close()
})
describe('Mongo-backed P0 two-agency route authorization and financial integration', () => {
  it('keeps booking list reads isolated by authenticated supplier', async () => {
    const payload = {
      suppliers: [supplierB._id.toString()],
      statuses: [bookcarsTypes.BookingStatus.Reserved],
    }

    const response = await request(app)
      .post('/api/bookings/1/30/en')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send(payload)

    expect(response.status).toBe(200)
    expect(response.body[0].resultData).toHaveLength(1)
    expect(response.body[0].resultData[0].supplier._id).toBe(supplierA._id.toString())
  })

  it('denies cross-agency booking detail access', async () => {
    const response = await request(app)
      .get(`/api/booking/${bookingB._id.toString()}/en`)
      .set(env.X_ACCESS_TOKEN, tokenA)

    expect(response.status).toBe(403)
  })

  it('rejects cross-agency booking creation even when the body names another supplier', async () => {
    const response = await request(app)
      .post('/api/create-booking')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({
        booking: {
          supplier: supplierB._id.toString(),
          car: carB._id.toString(),
          driver: driver._id.toString(),
          pickupLocation: locationB._id.toString(),
          dropOffLocation: locationB._id.toString(),
          from: new Date(Date.now() + 20 * 86400000).toISOString(),
          to: new Date(Date.now() + 22 * 86400000).toISOString(),
          status: bookcarsTypes.BookingStatus.Reserved,
          price: 200,
        },
      })

    expect(response.status).toBe(400)
    expect(await Booking.countDocuments({ supplier: supplierA._id, price: 200 })).toBe(0)
  })

  it('denies cross-agency booking updates without changing the stored booking', async () => {
    const before = await Booking.findById(bookingB._id).lean()
    const response = await request(app)
      .put('/api/update-booking')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({
        booking: {
          ...before,
          _id: bookingB._id.toString(),
          supplier: supplierB._id.toString(),
          car: carB._id.toString(),
          driver: driver._id.toString(),
          pickupLocation: locationB._id.toString(),
          dropOffLocation: locationB._id.toString(),
          from: before!.from.toISOString(),
          to: before!.to.toISOString(),
        },
      })

    expect(response.status).toBe(403)
    const after = await Booking.findById(bookingB._id).lean()
    expect(after?.supplier.toString()).toBe(supplierB._id.toString())
    expect(after?.price).toBe(before?.price)
  })

  it('denies cross-agency payment posting and keeps the ledger unchanged', async () => {
    const key = `p0-cross-agency-${suffix}`
    const before = await RentalPayment.countDocuments({ booking: bookingB._id })
    const response = await request(app)
      .post('/api/rental-payments')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({
        booking: bookingB._id.toString(),
        date: new Date().toISOString(),
        amount: 100,
        currency: 'MAD',
        method: bookcarsTypes.RentalPaymentMethod.Cash,
        idempotencyKey: key,
      })

    expect(response.status).toBe(404)
    expect(await RentalPayment.countDocuments({ booking: bookingB._id })).toBe(before)
  })

  it('posts one agency-scoped payment and makes replay idempotent', async () => {
    bookingA = await makeBooking(supplierA, carA, locationA, 'A')
    createdIds.bookings.push(bookingA._id)
    const key = `p0-idempotent-${suffix}`
    const payload = {
      booking: bookingA._id.toString(),
      date: new Date().toISOString(),
      amount: 100,
      currency: 'MAD',
      method: bookcarsTypes.RentalPaymentMethod.Cash,
      idempotencyKey: key,
      reference: 'P0 integration fixture',
    }

    const first = await request(app)
      .post('/api/rental-payments')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send(payload)
    expect(first.status).toBe(201)
    expect(first.body.supplier._id.toString()).toBe(supplierA._id.toString())

    const replay = await request(app)
      .post('/api/rental-payments')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send(payload)
    expect(replay.status).toBe(201)
    expect(replay.body._id).toBe(first.body._id)
    expect(await RentalPayment.countDocuments({ booking: bookingA._id, idempotencyKey: key })).toBe(1)

    const payment = await RentalPayment.findOne({ booking: bookingA._id, idempotencyKey: key })
    expect(payment).toBeTruthy()
    if (payment) {
createdIds.payments.push(payment._id)
}
  })

  it('keeps the financial read route isolated by agency', async () => {
    const response = await request(app)
      .get('/api/rental-payments')
      .set(env.X_ACCESS_TOKEN, tokenB)

    expect(response.status).toBe(200)
    expect(response.body.some((payment: { booking: { _id?: string } }) => payment.booking?._id === bookingA._id.toString())).toBe(false)
  })
  it('allows completion with an outstanding rental balance and reports the refundable deposit separately', async () => {
    const completionBooking = await makeBooking(supplierA, carA, locationA, 'A')
    completionBooking.lifecycle = bookcarsTypes.ContractLifecycle.ReturnReview
    completionBooking.financialSnapshot = {
      version: 1,
      baseCurrency: 'MAD',
      paymentCurrency: 'MAD',
      mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
      rentalTotal: 1000,
      depositAmount: 500,
      amountDueNow: 500,
      amountDueNowInPaymentCurrency: 500,
      quotedAt: new Date(),
    }
    await completionBooking.save()
    createdIds.bookings.push(completionBooking._id)
    const completionSnapshot = await new ContractSnapshot({ supplier: supplierA._id, booking: completionBooking._id, version: 1, pdfFile: `p0-${suffix}.pdf`, contentHash: 'a'.repeat(64), generatedAt: new Date() }).save()
    createdIds.snapshots.push(completionSnapshot._id)

    const payment = await request(app)
      .post('/api/rental-payments')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({
        booking: completionBooking._id.toString(),
        date: new Date().toISOString(),
        amount: 100,
        currency: 'MAD',
        method: bookcarsTypes.RentalPaymentMethod.Cash,
        idempotencyKey: `p0-completion-${suffix}`,
      })
    expect(payment.status).toBe(201)
    createdIds.payments.push(payment.body._id)

    const response = await request(app)
      .post(`/api/contract-operations/${completionBooking._id.toString()}/complete`)
      .set(env.X_ACCESS_TOKEN, tokenA)

    expect(response.status).toBe(200)
    expect(response.body.booking.lifecycle).toBe(bookcarsTypes.ContractLifecycle.Completed)
    expect(response.body.receivable.currency).toBe('MAD')
    expect(response.body.receivable.rentalTotal).toBe(1000)
    expect(response.body.receivable.refundableDeposit).toBe(500)
    expect(response.body.receivable.postedPayments).toBe(100)
    expect(response.body.receivable.outstandingBalance).toBe(900)
    expect(response.body.receivable.overdue).toBe(true)
    expect(response.body.receivable.dueAt).toBeTruthy()
  })

  it('allocates rent and refundable deposit purposes independently and rejects deposit overpayment', async () => {
    const allocationBooking = await makeBooking(supplierA, carA, locationA, 'A')
    allocationBooking.financialSnapshot = {
      version: 1,
      baseCurrency: 'MAD',
      paymentCurrency: 'MAD',
      mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
      rentalTotal: 1000,
      depositAmount: 500,
      amountDueNow: 500,
      amountDueNowInPaymentCurrency: 500,
      quotedAt: new Date(),
    }
    await allocationBooking.save()
    createdIds.bookings.push(allocationBooking._id)

    const rent = await request(app)
      .post('/api/rental-payments').set(env.X_ACCESS_TOKEN, tokenA).send({
        booking: allocationBooking._id.toString(), date: new Date().toISOString(), amount: 1000,
        currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
        purpose: bookcarsTypes.RentalPaymentPurpose.Rent, idempotencyKey: `p0-rent-purpose-${suffix}`,
      })
    expect(rent.status).toBe(201)
    createdIds.payments.push(rent.body._id)

    const deposit = await request(app)
      .post('/api/rental-payments').set(env.X_ACCESS_TOKEN, tokenA).send({
        booking: allocationBooking._id.toString(), date: new Date().toISOString(), amount: 500,
        currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
        purpose: bookcarsTypes.RentalPaymentPurpose.Deposit, idempotencyKey: `p0-deposit-purpose-${suffix}`,
      })
    expect(deposit.status).toBe(201)
    expect(deposit.body.purpose).toBe(bookcarsTypes.RentalPaymentPurpose.Deposit)
    createdIds.payments.push(deposit.body._id)

    const overpayment = await request(app)
      .post('/api/rental-payments').set(env.X_ACCESS_TOKEN, tokenA).send({
        booking: allocationBooking._id.toString(), date: new Date().toISOString(), amount: 0.01,
        currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
        purpose: bookcarsTypes.RentalPaymentPurpose.Deposit, idempotencyKey: `p0-deposit-over-${suffix}`,
      })
    expect(overpayment.status).toBe(400)
    expect(await RentalPayment.countDocuments({ booking: allocationBooking._id })).toBe(2)
  })

  it('rejects an idempotency replay that changes payment purpose', async () => {
    const replayBooking = await makeBooking(supplierA, carA, locationA, 'A')
    replayBooking.financialSnapshot = {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD', mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
      rentalTotal: 1000, depositAmount: 500, amountDueNow: 500, amountDueNowInPaymentCurrency: 500, quotedAt: new Date(),
    }
    await replayBooking.save()
    createdIds.bookings.push(replayBooking._id)
    const key = `p0-purpose-replay-${suffix}`
    const payload = {
      booking: replayBooking._id.toString(), date: new Date().toISOString(), amount: 100,
      currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash, purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
      idempotencyKey: key,
    }
    const first = await request(app).post('/api/rental-payments').set(env.X_ACCESS_TOKEN, tokenA).send(payload)
    expect(first.status).toBe(201)
    createdIds.payments.push(first.body._id)
    const mismatch = await request(app).post('/api/rental-payments').set(env.X_ACCESS_TOKEN, tokenA).send({
      ...payload, purpose: bookcarsTypes.RentalPaymentPurpose.Deposit,
    })
    expect(mismatch.status).toBe(409)
    expect(await RentalPayment.countDocuments({ booking: replayBooking._id })).toBe(1)
  })

  it('reverses an agency-scoped payment idempotently', async () => {
    const reversalBooking = await makeBooking(supplierA, carA, locationA, 'A')
    createdIds.bookings.push(reversalBooking._id)
    reversalBooking.financialSnapshot = {
      version: 1, baseCurrency: 'MAD', paymentCurrency: 'MAD', mode: bookcarsTypes.CheckoutPaymentMode.Deposit,
      rentalTotal: 1000, depositAmount: 500, amountDueNow: 500, amountDueNowInPaymentCurrency: 500, quotedAt: new Date(),
    }
    await reversalBooking.save()
    const post = await request(app)
      .post('/api/rental-payments')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({
        booking: reversalBooking._id.toString(),
        date: new Date().toISOString(),
        amount: 100,
        currency: 'MAD',
        method: bookcarsTypes.RentalPaymentMethod.Cash,
        purpose: bookcarsTypes.RentalPaymentPurpose.Deposit,
        idempotencyKey: `p0-reversal-original-${suffix}`,
      })
    expect(post.status).toBe(201)
    createdIds.payments.push(post.body._id)

    const key = `p0-reversal-${suffix}`
    const payload = { idempotencyKey: key, note: 'P0 refundable deposit return fixture' }
    const first = await request(app)
      .post(`/api/rental-payments/${post.body._id}/reverse`)
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send(payload)
    expect(first.status).toBe(201)
    expect(first.body.direction).toBe(bookcarsTypes.RentalPaymentDirection.Debit)
    expect(first.body.purpose).toBe(bookcarsTypes.RentalPaymentPurpose.Deposit)
    expect(first.body.reversedFrom).toBe(post.body._id)
    createdIds.payments.push(first.body._id)

    const replay = await request(app)
      .post(`/api/rental-payments/${post.body._id}/reverse`)
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send(payload)
    expect(replay.status).toBe(201)
    expect(replay.body._id).toBe(first.body._id)
    expect(await RentalPayment.countDocuments({ idempotencyKey: key })).toBe(1)

    const original = await RentalPayment.findById(post.body._id)
    expect(original?.status).toBe(bookcarsTypes.RentalPaymentStatus.Reversed)
  })

  it('links partial and full invoice payments, rejects duplicates and cross-agency payments', async () => {
    const invoiceBooking = await makeBooking(supplierA, carA, locationA, 'A')
    createdIds.bookings.push(invoiceBooking._id)
    const created = await request(app)
      .post('/api/invoices')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({ booking: invoiceBooking._id.toString(), taxAmount: 0 })
    expect(created.status).toBe(201)
    createdIds.invoices.push(created.body._id)

    const issued = await request(app)
      .post(`/api/invoices/${created.body._id}/issue`)
      .set(env.X_ACCESS_TOKEN, tokenA)
    expect(issued.status).toBe(200)
    expect(issued.body.status).toBe(bookcarsTypes.InvoiceStatus.Issued)

    const partialPayment = await request(app)
      .post('/api/rental-payments')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({
        booking: invoiceBooking._id.toString(), date: new Date().toISOString(), amount: 400,
        currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
        purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
        idempotencyKey: `p0-invoice-partial-${suffix}`,
      })
    expect(partialPayment.status).toBe(201)
    createdIds.payments.push(partialPayment.body._id)

    const partial = await request(app)
      .post(`/api/invoices/${created.body._id}/payments`)
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({ payment: partialPayment.body._id })
    expect(partial.status).toBe(200)
    expect(partial.body.paidAmount).toBe(400)
    expect(partial.body.paymentStatus).toBe('partial')

    const duplicate = await request(app)
      .post(`/api/invoices/${created.body._id}/payments`)
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({ payment: partialPayment.body._id })
    expect(duplicate.status).toBe(409)

    const fullPayment = await request(app)
      .post('/api/rental-payments')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({
        booking: invoiceBooking._id.toString(), date: new Date().toISOString(), amount: 600,
        currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
        purpose: bookcarsTypes.RentalPaymentPurpose.Rent,
        idempotencyKey: `p0-invoice-full-${suffix}`,
      })
    expect(fullPayment.status).toBe(201)
    createdIds.payments.push(fullPayment.body._id)

    const paid = await request(app)
      .post(`/api/invoices/${created.body._id}/payments`)
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({ payment: fullPayment.body._id })
    expect(paid.status).toBe(200)
    expect(paid.body.paidAmount).toBe(1000)
    expect(paid.body.paymentStatus).toBe('paid')

    const reversed = await request(app)
      .post(`/api/rental-payments/${fullPayment.body._id}/reverse`)
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({ idempotencyKey: `p0-invoice-reversal-${suffix}`, note: 'P0 invoice reversal fixture' })
    expect(reversed.status).toBe(201)
    createdIds.payments.push(reversed.body._id)
    const invoicesAfterReversal = await request(app)
      .get('/api/invoices')
      .set(env.X_ACCESS_TOKEN, tokenA)
    expect(invoicesAfterReversal.status).toBe(200)
    const recalculated = invoicesAfterReversal.body.find((item: { _id: string }) => item._id === created.body._id)
    expect(recalculated.paidAmount).toBe(400)
    expect(recalculated.paymentStatus).toBe('partial')

    const crossAgencyPayment = await request(app)
      .post('/api/rental-payments')
      .set(env.X_ACCESS_TOKEN, tokenB)
      .send({
        booking: bookingB._id.toString(), date: new Date().toISOString(), amount: 100,
        currency: 'MAD', method: bookcarsTypes.RentalPaymentMethod.Cash,
        idempotencyKey: `p0-invoice-cross-${suffix}`,
      })
    expect(crossAgencyPayment.status).toBe(201)
    createdIds.payments.push(crossAgencyPayment.body._id)

    const crossAgencyLink = await request(app)
      .post(`/api/invoices/${created.body._id}/payments`)
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({ payment: crossAgencyPayment.body._id })
    expect(crossAgencyLink.status).toBe(404)
  })

  it('allows a platform admin to open a cash session only with an explicit agency selector', async () => {
    const missingSelector = await request(app)
      .post('/api/cash/sessions')
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ account: bookcarsTypes.CashAccountType.Cash, openingBalance: 25 })
    expect(missingSelector.status).toBe(403)

    const explicit = await request(app)
      .post('/api/cash/sessions')
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({
        supplier: supplierA._id.toString(),
        account: bookcarsTypes.CashAccountType.Cash,
        openingBalance: 25,
      })
    expect(explicit.status).toBe(201)
    expect(explicit.body.supplier).toBe(supplierA._id.toString())
    createdIds.cashSessions.push(explicit.body._id)

    const closed = await request(app)
      .post(`/api/cash/sessions/${explicit.body._id}/close`)
      .set(env.X_ACCESS_TOKEN, adminToken)
      .send({ supplier: supplierA._id.toString(), countedClosingBalance: 25 })
    expect(closed.status).toBe(200)
    expect(closed.body.status).toBe(bookcarsTypes.CashSessionStatus.Closed)
  })

  it('creates paired cash transfers, protects the source, replays idempotently and reconciles close', async () => {
    const source = await request(app)
      .post('/api/cash/sessions')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({ account: bookcarsTypes.CashAccountType.Cash, openingBalance: 100 })
    expect(source.status).toBe(201)
    createdIds.cashSessions.push(source.body._id)

    const destination = await request(app)
      .post('/api/cash/sessions')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({ account: bookcarsTypes.CashAccountType.Bank, openingBalance: 0 })
    expect(destination.status).toBe(201)
    createdIds.cashSessions.push(destination.body._id)

    const key = `p0-cash-transfer-${suffix}`
    const transferPayload = {
      fromSession: source.body._id,
      toSession: destination.body._id,
      amount: 40,
      date: new Date().toISOString(),
      idempotencyKey: key,
      reference: 'P0 transfer fixture',
    }
    const transfer = await request(app)
      .post('/api/cash/transfers')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send(transferPayload)
    expect(transfer.status).toBe(201)
    expect(transfer.body.from.direction).toBe(bookcarsTypes.CashMovementDirection.Out)
    expect(transfer.body.to.direction).toBe(bookcarsTypes.CashMovementDirection.In)
    expect(transfer.body.from.transferId).toBe(transfer.body.to._id)
    expect(transfer.body.to.transferId).toBe(transfer.body.from._id)
    createdIds.cashMovements.push(transfer.body.from._id, transfer.body.to._id)

    const sourceMovements = await request(app)
      .get(`/api/cash/sessions/${source.body._id}/movements`)
      .set(env.X_ACCESS_TOKEN, tokenA)
    const destinationMovements = await request(app)
      .get(`/api/cash/sessions/${destination.body._id}/movements`)
      .set(env.X_ACCESS_TOKEN, tokenA)
    expect(sourceMovements.status).toBe(200)
    expect(destinationMovements.status).toBe(200)
    expect(sourceMovements.body).toHaveLength(1)
    expect(destinationMovements.body).toHaveLength(1)
    expect(sourceMovements.body[0].amount).toBe(40)
    expect(destinationMovements.body[0].amount).toBe(40)

    const replay = await request(app)
      .post('/api/cash/transfers')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send(transferPayload)
    expect(replay.status).toBe(201)
    expect(replay.body.from._id).toBe(transfer.body.from._id)
    expect(replay.body.to._id).toBe(transfer.body.to._id)
    expect(await CashMovement.countDocuments({ idempotencyKey: key })).toBe(1)

    const insufficient = await request(app)
      .post('/api/cash/transfers')
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({ ...transferPayload, amount: 61, idempotencyKey: `p0-cash-over-${suffix}` })
    expect(insufficient.status).toBe(409)

    const crossAgency = await request(app)
      .post('/api/cash/transfers')
      .set(env.X_ACCESS_TOKEN, tokenB)
      .send({ ...transferPayload, idempotencyKey: `p0-cash-cross-${suffix}` })
    expect(crossAgency.status).toBe(404)

    const close = await request(app)
      .post(`/api/cash/sessions/${source.body._id}/close`)
      .set(env.X_ACCESS_TOKEN, tokenA)
      .send({ countedClosingBalance: 60, closingNote: 'P0 balanced close' })
    expect(close.status).toBe(200)
    expect(close.body.expectedClosingBalance).toBe(60)
    expect(close.body.countedClosingBalance).toBe(60)
    expect(close.body.discrepancy).toBe(0)
    expect(close.body.status).toBe(bookcarsTypes.CashSessionStatus.Closed)
  })
})

