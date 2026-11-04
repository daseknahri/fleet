import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as types from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'
import MaintenanceExpense from '../src/models/MaintenanceExpense'

let supplier: env.User
let token: string
const ids: mongoose.Types.ObjectId[] = []
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplier = await new User({ email: `report-${suffix}@test.bookcars.ma`, fullName: 'Report Fixture', language: 'en', type: types.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true }).save()
  ids.push(supplier._id)
  token = await authHelper.encryptJWT({ id: supplier._id.toString() })
  const car = await new Car({ name: 'Report Fixture Car', supplier: supplier._id, minimumAge: 21, locations: [new mongoose.Types.ObjectId()], dailyPrice: 100, deposit: 200, available: true, type: types.CarType.Diesel, gearbox: types.GearboxType.Automatic, aircon: true, seats: 5, doors: 4, fuelPolicy: types.FuelPolicy.FreeTank, mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0, collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0, range: types.CarRange.Midi, multimedia: [], rating: 5 }).save()
  ids.push(car._id)
  const from = new Date(Date.now() - 86400000)
  const to = new Date(Date.now() + 86400000)
  const booking = await new Booking({ supplier: supplier._id, car: car._id, driver: new mongoose.Types.ObjectId(), pickupLocation: new mongoose.Types.ObjectId(), dropOffLocation: new mongoose.Types.ObjectId(), from, to, status: types.BookingStatus.Reserved, price: 500, lifecycle: types.ContractLifecycle.Confirmed, cancellation: false, amendments: false, theftProtection: false, collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false }).save()
  ids.push(booking._id)
  await new RentalPayment({ supplier: supplier._id, booking: booking._id, date: new Date(), amount: 300, currency: env.BASE_CURRENCY, method: types.RentalPaymentMethod.Cash, purpose: types.RentalPaymentPurpose.Rent, direction: types.RentalPaymentDirection.Credit, source: types.RentalPaymentSource.Manual, status: types.RentalPaymentStatus.Posted, idempotencyKey: `report-rent-${suffix}` }).save()
  await new RentalPayment({ supplier: supplier._id, booking: booking._id, date: new Date(), amount: 100, currency: env.BASE_CURRENCY, method: types.RentalPaymentMethod.Cash, purpose: types.RentalPaymentPurpose.Deposit, direction: types.RentalPaymentDirection.Credit, source: types.RentalPaymentSource.Manual, status: types.RentalPaymentStatus.Posted, idempotencyKey: `report-deposit-${suffix}` }).save()
  await new MaintenanceExpense({ supplier: supplier._id, car: car._id, date: new Date(), type: types.MaintenanceExpenseType.Repair, amount: 50, vendor: 'Fixture' }).save()
})
afterAll(async () => {
 await RentalPayment.deleteMany({ idempotencyKey: { $regex: `^report-(rent|deposit)-${suffix}` } }); await MaintenanceExpense.deleteMany({ supplier: supplier._id }); await Booking.deleteMany({ _id: { $in: ids } }); await Car.deleteMany({ _id: { $in: ids } }); await User.deleteMany({ _id: { $in: ids } }); await databaseHelper.close() 
})
describe('Mongo-backed report reconciliation and export', () => {
  it('reconciles aggregate metrics to the synthetic ledger and expense fixture', async () => {
    const response = await request(app).get('/api/reports/summary').set(env.X_ACCESS_TOKEN, token)
    expect(response.status).toBe(200)
    expect(response.body.currency).toBe(env.BASE_CURRENCY.toUpperCase())
    expect(response.body.timezone).toBe(env.TIMEZONE)
    expect(response.body.metrics.contracts).toBe(1)
    expect(response.body.metrics.revenueCollected).toBe(300)
    expect(response.body.metrics.depositsCollected).toBe(100)
    expect(response.body.metrics.expenses).toBe(50)
    expect(response.body.metrics.receivable).toBe(200)
    expect(response.body.metrics.estimatedMargin).toBe(250)
  })
  it('exports the selected aggregate metrics without identity fields', async () => {
    const response = await request(app).get('/api/reports/summary.csv').set(env.X_ACCESS_TOKEN, token)
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/csv')
    expect(response.text).toContain('metric,value,currency,timezone')
    expect(response.text).toContain('revenueCollected')
    expect(response.text).not.toContain(supplier.email)
  })
})

