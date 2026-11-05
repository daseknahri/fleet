import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'
import Car from '../src/models/Car'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'
import Booking from '../src/models/Booking'
import MaintenanceWorkOrder from '../src/models/MaintenanceWorkOrder'
import Notification from '../src/models/Notification'

/**
 * GA-P0-EVIDENCE-AVAILABILITY-01 - fixture-isolated proof of roadmap section 10 item 7:
 * a maintenance downtime block (work order, status scheduled/inProgress) removes the
 * vehicle from availability for the blocked window; completed/cancelled work orders
 * and work-order removal restore it. Standalone suite (not in the P0 gate list),
 * same precedent as fileContentUploads / approvalsEndToEnd.
 *
 * Documented semantics under test (GESTIONAUTO-ROADMAP.md phase design +
 * backend/src/utils/bookingReservationHelper.ts):
 * - saveBookingsWithAvailability() rejects a reserving booking (statuses
 *   deposit/paid/paidInFull/reserved, or void with a live expireAt hold) when a
 *   MaintenanceWorkOrder for the same supplier+car is scheduled or inProgress and
 *   scheduledStart < booking.to && scheduledEnd > booking.from (strict overlap:
 *   a booking ending exactly when downtime starts is NOT blocked).
 * - The same guard re-runs on checkout finalization and status transitions
 *   (bookingController finalize/update/updateStatus), so the block cannot be
 *   bypassed by creating a non-reserving booking and reserving it later.
 */

const D1 = { from: '2027-03-10T00:00:00.000Z', to: '2027-03-12T00:00:00.000Z' } // WO1 window
const W_OVERLAP = { from: '2027-03-10T12:00:00.000Z', to: '2027-03-11T12:00:00.000Z' } // inside D1
const W_AFTER = { from: '2027-03-13T10:00:00.000Z', to: '2027-03-15T10:00:00.000Z' } // after D1
const W_BOUNDARY = { from: '2027-03-08T10:00:00.000Z', to: '2027-03-10T00:00:00.000Z' } // ends exactly at D1 start
const W_CANCEL = { from: '2027-03-11T13:00:00.000Z', to: '2027-03-11T23:00:00.000Z' } // inside D1, disjoint from W_OVERLAP
const D2 = { from: '2027-04-10T00:00:00.000Z', to: '2027-04-12T00:00:00.000Z' } // WO2 window
const W2 = { from: '2027-04-10T12:00:00.000Z', to: '2027-04-11T12:00:00.000Z' } // inside D2

const ids = {
  users: [] as mongoose.Types.ObjectId[],
  cars: [] as mongoose.Types.ObjectId[],
  locations: [] as mongoose.Types.ObjectId[],
  values: [] as mongoose.Types.ObjectId[],
  bookings: [] as mongoose.Types.ObjectId[],
  workOrders: [] as mongoose.Types.ObjectId[],
}
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let supplier: any
let driver: any
let car: any
let location: any
let token = ''
let wo1: any
let wo2: any

const evidence: any = {
  slice: 'GA-P0-EVIDENCE-AVAILABILITY-01',
  requirement: 'Roadmap section 10 item 7: maintenance work orders and downtime affect availability correctly (downtime-to-availability leg; receipt lifecycle already evidenced by GA-P0-MAINTENANCE-BROWSER-02).',
  semantics: 'Work orders with status scheduled or inProgress block overlapping reserving bookings (strict overlap scheduledStart < booking.to && scheduledEnd > booking.from); completed/cancelled do not block; deletion removes the block. Guard: backend/src/utils/bookingReservationHelper.ts saveBookingsWithAvailability, invoked by booking create/checkout-finalize/update/updateStatus.',
  windows: { D1, W_OVERLAP, W_AFTER, W_BOUNDARY, W_CANCEL, D2, W2 },
  steps: [] as any[],
  fixtures: {} as Record<string, string>,
  cleanup: {} as any,
}
const record = (step: string, data: any) => { evidence.steps.push({ step, ...data }) }

const tryBooking = (from: string, to: string, status: string = bookcarsTypes.BookingStatus.Reserved) => request(app)
  .post('/api/create-booking')
  .set(env.X_ACCESS_TOKEN, token)
  .send({
    booking: {
      supplier: supplier._id.toString(),
      car: car._id.toString(),
      driver: driver._id.toString(),
      pickupLocation: location._id.toString(),
      dropOffLocation: location._id.toString(),
      from,
      to,
      status,
      price: 200,
    },
  })

const workOrderPayload = (window: { from: string, to: string }, status: string) => ({
  car: car._id.toString(),
  title: `GA-P0-EVIDENCE-AVAILABILITY-01 fixture ${suffix}`,
  type: bookcarsTypes.MaintenanceExpenseType.Maintenance,
  status,
  scheduledStart: window.from,
  scheduledEnd: window.to,
})

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  supplier = await new User({ email: `avail-supplier-${suffix}@test.bookcars.ma`, fullName: 'Availability Supplier', language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true }).save()
  ids.users.push(supplier._id)
  driver = await new User({ email: `avail-driver-${suffix}@test.bookcars.ma`, fullName: 'Availability Driver', language: 'en', type: bookcarsTypes.UserType.User, active: true, verified: true, blacklisted: false }).save()
  ids.users.push(driver._id)
  const value = await new LocationValue({ language: 'en', value: `Availability location ${suffix}` }).save()
  ids.values.push(value._id)
  location = await new Location({ country: new mongoose.Types.ObjectId(), values: [value._id] }).save()
  ids.locations.push(location._id)
  car = await new Car({ name: `Availability car ${suffix}`, supplier: supplier._id, minimumAge: 21, locations: [location._id], dailyPrice: 100, deposit: 500, available: true, type: bookcarsTypes.CarType.Diesel, gearbox: bookcarsTypes.GearboxType.Automatic, aircon: true, seats: 5, doors: 4, fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank, mileage: -1, cancellation: 0, amendments: 0, theftProtection: 0, collisionDamageWaiver: 0, fullInsurance: 0, additionalDriver: 0, range: bookcarsTypes.CarRange.Midi, multimedia: [], rating: 5 }).save()
  ids.cars.push(car._id)
  token = await authHelper.encryptJWT({ id: supplier._id.toString() })
  evidence.fixtures = {
    supplier: supplier._id.toString(),
    driver: driver._id.toString(),
    car: car._id.toString(),
    location: location._id.toString(),
  }
}, 60000)

afterAll(async () => {
  // Cleanup by exact IDs, then read-back verification of absence.
  await Notification.deleteMany({ booking: { $in: ids.bookings } })
  const delBookings = await Booking.deleteMany({ _id: { $in: ids.bookings } })
  const delWorkOrders = await MaintenanceWorkOrder.deleteMany({ _id: { $in: ids.workOrders } })
  const delCars = await Car.deleteMany({ _id: { $in: ids.cars } })
  const delLocations = await Location.deleteMany({ _id: { $in: ids.locations } })
  const delValues = await LocationValue.deleteMany({ _id: { $in: ids.values } })
  const delUsers = await User.deleteMany({ _id: { $in: ids.users } })
  const remaining = {
    bookings: await Booking.countDocuments({ _id: { $in: ids.bookings } }),
    bookingsForFixtureCar: await Booking.countDocuments({ car: { $in: ids.cars } }),
    workOrders: await MaintenanceWorkOrder.countDocuments({ _id: { $in: ids.workOrders } }),
    workOrdersForFixtureCar: await MaintenanceWorkOrder.countDocuments({ car: { $in: ids.cars } }),
    cars: await Car.countDocuments({ _id: { $in: ids.cars } }),
    locations: await Location.countDocuments({ _id: { $in: ids.locations } }),
    values: await LocationValue.countDocuments({ _id: { $in: ids.values } }),
    users: await User.countDocuments({ _id: { $in: ids.users } }),
  }
  evidence.cleanup = {
    deleted: {
      bookings: delBookings.deletedCount,
      workOrders: delWorkOrders.deletedCount,
      cars: delCars.deletedCount,
      locations: delLocations.deletedCount,
      values: delValues.deletedCount,
      users: delUsers.deletedCount,
    },
    remaining,
  }
  const artifactPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'artifacts', 'downtime-availability-evidence-01.json')
  fs.writeFileSync(artifactPath, JSON.stringify(evidence, null, 2))
  await databaseHelper.close()
}, 60000)

describe('GA-P0-EVIDENCE-AVAILABILITY-01 - maintenance downtime blocks availability (fixture-isolated)', () => {
  it('creates the scheduled downtime work order through the real API', async () => {
    const res = await request(app).post('/api/maintenance-work-orders').set(env.X_ACCESS_TOKEN, token).send(workOrderPayload(D1, bookcarsTypes.WorkOrderStatus.Scheduled))
    record('create-work-order-scheduled', { status: res.status, workOrder: res.body?._id, window: D1, workOrderStatus: res.body?.status })
    expect(res.status).toBe(201)
    wo1 = res.body
    ids.workOrders.push(new mongoose.Types.ObjectId(wo1._id))
    evidence.fixtures.workOrder1 = wo1._id
  }, 30000)

  it('(a) denies a reserving booking that overlaps the downtime window and persists nothing', async () => {
    const res = await tryBooking(W_OVERLAP.from, W_OVERLAP.to)
    const persisted = await Booking.countDocuments({ car: car._id, from: new Date(W_OVERLAP.from), to: new Date(W_OVERLAP.to) })
    record('a-overlap-denied', { status: res.status, bodyExcerpt: String(res.text || '').slice(0, 200), window: W_OVERLAP, persistedBookingsForWindow: persisted })
    expect(res.status).toBe(400)
    expect(String(res.text || '')).toContain('no longer available')
    expect(persisted).toBe(0)
  }, 30000)

  it('(a-note) a non-reserving pending booking over the same window is created but holds no car', async () => {
    const res = await tryBooking(W_OVERLAP.from, W_OVERLAP.to, bookcarsTypes.BookingStatus.Pending)
    record('a-note-pending-not-reserving', { status: res.status, booking: res.body?._id, bookingStatus: res.body?.status, note: 'Pending is not a reserving status, so the guard does not engage at create; the same guard re-runs when a booking transitions into a reserving status (finalize/update/updateStatus), so the block cannot be bypassed through this path.' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe(bookcarsTypes.BookingStatus.Pending)
    ids.bookings.push(new mongoose.Types.ObjectId(res.body._id))
  }, 30000)

  it('(b) allows a reserving booking entirely after the downtime window', async () => {
    const res = await tryBooking(W_AFTER.from, W_AFTER.to)
    record('b-non-overlap-after-allowed', { status: res.status, booking: res.body?._id, window: W_AFTER })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe(bookcarsTypes.BookingStatus.Reserved)
    ids.bookings.push(new mongoose.Types.ObjectId(res.body._id))
  }, 30000)

  it('(b-boundary) allows a reserving booking ending exactly when downtime starts (strict overlap)', async () => {
    const res = await tryBooking(W_BOUNDARY.from, W_BOUNDARY.to)
    record('b-boundary-end-at-downtime-start-allowed', { status: res.status, booking: res.body?._id, window: W_BOUNDARY })
    expect(res.status).toBe(200)
    ids.bookings.push(new mongoose.Types.ObjectId(res.body._id))
  }, 30000)

  it('(c) completing the work order restores availability for the previously denied window', async () => {
    const put = await request(app).put(`/api/maintenance-work-orders/${wo1._id}`).set(env.X_ACCESS_TOKEN, token).send(workOrderPayload(D1, bookcarsTypes.WorkOrderStatus.Completed))
    record('c-complete-work-order', { status: put.status, workOrderStatus: put.body?.status })
    expect(put.status).toBe(200)
    expect(put.body.status).toBe(bookcarsTypes.WorkOrderStatus.Completed)
    const res = await tryBooking(W_OVERLAP.from, W_OVERLAP.to)
    record('c-overlap-allowed-after-completion', { status: res.status, booking: res.body?._id, window: W_OVERLAP })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe(bookcarsTypes.BookingStatus.Reserved)
    ids.bookings.push(new mongoose.Types.ObjectId(res.body._id))
  }, 30000)

  it('(c-cancelled) a cancelled work order does not block an overlapping booking', async () => {
    const put = await request(app).put(`/api/maintenance-work-orders/${wo1._id}`).set(env.X_ACCESS_TOKEN, token).send(workOrderPayload(D1, bookcarsTypes.WorkOrderStatus.Cancelled))
    record('c-cancel-work-order', { status: put.status, workOrderStatus: put.body?.status })
    expect(put.status).toBe(200)
    expect(put.body.status).toBe(bookcarsTypes.WorkOrderStatus.Cancelled)
    const res = await tryBooking(W_CANCEL.from, W_CANCEL.to)
    record('c-overlap-allowed-when-cancelled', { status: res.status, booking: res.body?._id, window: W_CANCEL })
    expect(res.status).toBe(200)
    ids.bookings.push(new mongoose.Types.ObjectId(res.body._id))
  }, 30000)

  it('(c-removal) an in-progress work order blocks, and deleting it restores availability', async () => {
    const created = await request(app).post('/api/maintenance-work-orders').set(env.X_ACCESS_TOKEN, token).send(workOrderPayload(D2, bookcarsTypes.WorkOrderStatus.InProgress))
    record('c-create-work-order-inprogress', { status: created.status, workOrder: created.body?._id, window: D2 })
    expect(created.status).toBe(201)
    wo2 = created.body
    ids.workOrders.push(new mongoose.Types.ObjectId(wo2._id))
    evidence.fixtures.workOrder2 = wo2._id
    const denied = await tryBooking(W2.from, W2.to)
    const persisted = await Booking.countDocuments({ car: car._id, from: new Date(W2.from), to: new Date(W2.to) })
    record('c-inprogress-overlap-denied', { status: denied.status, bodyExcerpt: String(denied.text || '').slice(0, 200), window: W2, persistedBookingsForWindow: persisted })
    expect(denied.status).toBe(400)
    expect(persisted).toBe(0)
    const removed = await request(app).delete(`/api/maintenance-work-orders/${wo2._id}`).set(env.X_ACCESS_TOKEN, token)
    record('c-delete-work-order', { status: removed.status })
    expect(removed.status).toBe(200)
    const res = await tryBooking(W2.from, W2.to)
    record('c-overlap-allowed-after-removal', { status: res.status, booking: res.body?._id, window: W2 })
    expect(res.status).toBe(200)
    ids.bookings.push(new mongoose.Types.ObjectId(res.body._id))
  }, 30000)

  it('deletes the remaining work order through the API and reads back an empty list for the fixture car', async () => {
    const removed = await request(app).delete(`/api/maintenance-work-orders/${wo1._id}`).set(env.X_ACCESS_TOKEN, token)
    expect(removed.status).toBe(200)
    const list = await request(app).get('/api/maintenance-work-orders').set(env.X_ACCESS_TOKEN, token)
    const forCar = (list.body as any[]).filter((row) => (row.car?._id || row.car) === car._id.toString())
    record('delete-wo1-and-list-readback', { deleteStatus: removed.status, listStatus: list.status, workOrdersForFixtureCar: forCar.length })
    expect(list.status).toBe(200)
    expect(forCar.length).toBe(0)
  }, 30000)
})
