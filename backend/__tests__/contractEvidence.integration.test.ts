import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as types from ':bookcars-types'
import app from '../src/app'
import * as db from '../src/utils/databaseHelper'
import * as auth from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Booking from '../src/models/Booking'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import ContractInspection from '../src/models/ContractInspection'
import ContractCharge from '../src/models/ContractCharge'
import ContractSnapshot from '../src/models/ContractSnapshot'

const ids: Record<string, mongoose.Types.ObjectId[]> = { users: [], cars: [], bookings: [], locations: [], values: [], inspections: [], charges: [], snapshots: [] }
const ownedFiles: string[] = []
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
let supplier: env.User; let otherSupplier: env.User; let driver: env.User; let booking: env.Booking; let token: string; let otherToken: string

beforeAll(async () => {
  await db.connect(env.DB_URI, false, false)
  supplier = await new User({ email: `contract-supplier-${suffix}@test.bookcars.ma`, fullName: 'Contract supplier', type: types.UserType.Supplier, active: true, verified: true, language: 'en' }).save(); ids.users.push(supplier._id)
  otherSupplier = await new User({ email: `contract-other-${suffix}@test.bookcars.ma`, fullName: 'Other supplier', type: types.UserType.Supplier, active: true, verified: true, language: 'en' }).save(); ids.users.push(otherSupplier._id)
  driver = await new User({ email: `contract-driver-${suffix}@test.bookcars.ma`, fullName: 'Contract driver', type: types.UserType.User, active: true, verified: true, language: 'en' }).save(); ids.users.push(driver._id)
  const value = await new LocationValue({ language: 'en', value: `Evidence ${suffix}` }).save(); ids.values.push(value._id)
  const location = await new Location({ country: new mongoose.Types.ObjectId(), values: [value._id] }).save(); ids.locations.push(location._id)
  const car = await new Car({ name: `Evidence car ${suffix}`, supplier: supplier._id, minimumAge: 21, locations: [location._id], dailyPrice: 100, deposit: 300, available: true, type: types.CarType.Diesel, gearbox: types.GearboxType.Automatic, aircon: true, seats: 5, doors: 4, fuelPolicy: types.FuelPolicy.FreeTank, mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0, collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0, range: types.CarRange.Midi, multimedia: [], rating: 5 }).save(); ids.cars.push(car._id)
  booking = await new Booking({ supplier: supplier._id, car: car._id, driver: driver._id, pickupLocation: location._id, dropOffLocation: location._id, from: new Date(Date.now() + 86400000), to: new Date(Date.now() + 3 * 86400000), status: types.BookingStatus.Reserved, lifecycle: types.ContractLifecycle.Draft, price: 300, cancellation: false, amendments: false, theftProtection: false, collisionDamageWaiver: false, fullInsurance: false, additionalDriver: false }).save(); ids.bookings.push(booking._id)
  token = await auth.encryptJWT({ id: supplier._id.toString() })
  otherToken = await auth.encryptJWT({ id: otherSupplier._id.toString() })
})

afterAll(async () => {
 for (const filename of ownedFiles) {
   const target = path.resolve(env.CDN_CONTRACTS, `inspection_${booking?._id}_${filename}`)
   if (await fs.stat(target).then(() => true).catch(() => false)) await fs.unlink(target)
 }
 await ContractSnapshot.deleteMany({ _id: { $in: ids.snapshots } }); await ContractCharge.deleteMany({ _id: { $in: ids.charges } }); await ContractInspection.deleteMany({ _id: { $in: ids.inspections } }); await Booking.deleteMany({ _id: { $in: ids.bookings } }); await Car.deleteMany({ _id: { $in: ids.cars } }); await Location.deleteMany({ _id: { $in: ids.locations } }); await LocationValue.deleteMany({ _id: { $in: ids.values } }); await User.deleteMany({ _id: { $in: ids.users } }); await db.close() 
})

test('persists inspections, reviews charges, and creates a versioned PDF snapshot', async () => {
  const base = `/api/contract-operations/${booking._id}`
  const upload = await request(app).post(`${base}/files`).set(env.X_ACCESS_TOKEN, token)
    .attach('file', Buffer.from('synthetic-photo'), { filename: 'handover.jpg', contentType: 'image/jpeg' })
  expect(upload.status).toBe(201); expect(upload.body.kind).toBe('photo'); ownedFiles.push(upload.body.filename)
  const fetched = await request(app).get(`${base}/files/${upload.body.filename}`).set(env.X_ACCESS_TOKEN, token)
  expect(fetched.status).toBe(200); expect(fetched.body.toString()).toBe('synthetic-photo')
  const otherDenied = await request(app).get(`${base}/files/${upload.body.filename}`).set(env.X_ACCESS_TOKEN, otherToken)
  expect(otherDenied.status).toBe(404)
  const deleted = await request(app).delete(`${base}/files/${upload.body.filename}`).set(env.X_ACCESS_TOKEN, token)
  expect(deleted.status).toBe(200); ownedFiles.pop()
  const handover = await request(app).post(`${base}/handover`).set(env.X_ACCESS_TOKEN, token).send({ occurredAt: new Date().toISOString(), odometer: 100, fuelLevel: 80, condition: 'Clean at handover' })
  expect(handover.status).toBe(201); ids.inspections.push(handover.body.inspection._id)
  const returned = await request(app).post(`${base}/return`).set(env.X_ACCESS_TOKEN, token).send({ occurredAt: new Date().toISOString(), odometer: 130, fuelLevel: 70, damageNote: 'Small bumper mark' })
  expect(returned.status).toBe(201); ids.inspections.push(returned.body.inspection._id); expect(returned.body.booking.lifecycle).toBe(types.ContractLifecycle.ReturnReview)
  const charge = await request(app).post(`${base}/charges`).set(env.X_ACCESS_TOKEN, token).send({ type: types.ContractChargeType.Damage, amount: 150, currency: 'MAD', reason: 'Bumper mark review' })
  expect(charge.status).toBe(201); ids.charges.push(charge.body._id)
  const decision = await request(app).post(`${base}/charges/${charge.body._id}/decide`).set(env.X_ACCESS_TOKEN, token).send({ decision: types.ApprovalDecision.Approved, note: 'Reviewed with return inspection' })
  expect(decision.status).toBe(200); expect(decision.body.status).toBe(types.ApprovalDecision.Approved)
  const snapshot = await request(app).post(`${base}/snapshots`).set(env.X_ACCESS_TOKEN, token)
  expect(snapshot.status).toBe(201); ids.snapshots.push(snapshot.body._id); expect(snapshot.body.version).toBe(1); expect(snapshot.body.pdfFile).toMatch(/\.pdf$/); expect(snapshot.body.contentHash).toHaveLength(64)
  const pdf = await request(app).get(`${base}/snapshots/${snapshot.body.pdfFile}`).set(env.X_ACCESS_TOKEN, token)
  expect(pdf.status).toBe(200); expect(pdf.headers['content-type']).toContain('application/pdf'); expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF')
  const pending = await request(app).post(`${base}/charges`).set(env.X_ACCESS_TOKEN, token).send({ type: types.ContractChargeType.Fee, amount: 25, currency: 'MAD', reason: 'Pending admin review' })
  expect(pending.status).toBe(201); ids.charges.push(pending.body._id)
  const blocked = await request(app).post(`${base}/complete`).set(env.X_ACCESS_TOKEN, token)
  expect(blocked.status).toBe(409)
  const rejected = await request(app).post(`${base}/charges/${pending.body._id}/decide`).set(env.X_ACCESS_TOKEN, token).send({ decision: types.ApprovalDecision.Rejected, note: 'Not chargeable' })
  expect(rejected.status).toBe(200)
  const completed = await request(app).post(`${base}/complete`).set(env.X_ACCESS_TOKEN, token)
  expect(completed.status).toBe(200); expect(completed.body.booking.lifecycle).toBe(types.ContractLifecycle.Completed)
})



