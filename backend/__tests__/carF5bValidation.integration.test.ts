import 'dotenv/config'
import request from 'supertest'
import url from 'url'
import path from 'path'
import asyncFs from 'node:fs/promises'
import { nanoid } from 'nanoid'
import * as bookcarsTypes from ':bookcars-types'
import * as databaseHelper from '../src/utils/databaseHelper'
import app from '../src/app'
import * as env from '../src/config/env.config'
import * as testHelper from './testHelper'
import * as helper from '../src/utils/helper'
import Car from '../src/models/Car'
import DateBasedPrice from '../src/models/DateBasedPrice'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const IMAGE1 = 'bmw-x1.jpg'
const IMAGE1_PATH = path.join(__dirname, `./img/${IMAGE1}`)

let SUPPLIER1_ID: string
let SUPPLIER2_ID: string
let LOCATION1_ID: string
let TOKEN: string

const createdCarIds: string[] = []
const createdRowIds: string[] = []
const createdImages: string[] = []

const uniquePlate = () => `F5B-${nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`

const addDays = (date: Date, days: number) => {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

const seasonalRow = (startOffset: number, endOffset: number, dailyPrice: number, id?: string): bookcarsTypes.DateBasedPrice => {
  const row: bookcarsTypes.DateBasedPrice = {
    startDate: addDays(new Date(), startOffset),
    endDate: addDays(new Date(), endOffset),
    dailyPrice,
  }
  if (id) {
    row._id = id
  }
  return row
}

const buildCreatePayload = (supplierId: string, licensePlate: string, overrides: Partial<bookcarsTypes.CreateCarPayload> = {}): bookcarsTypes.CreateCarPayload => ({
  loggedUser: testHelper.GetRandromObjectIdAsString(),
  name: 'F5B Test Car',
  licensePlate,
  supplier: supplierId,
  minimumAge: 21,
  locations: [LOCATION1_ID],
  dailyPrice: 78,
  discountedDailyPrice: 70,
  hourlyPrice: 10,
  discountedHourlyPrice: 9,
  biWeeklyPrice: 210,
  discountedBiWeeklyPrice: 200,
  weeklyPrice: 490,
  discountedWeeklyPrice: 470,
  monthlyPrice: 2100,
  discountedMonthlyPrice: 2000,
  deposit: 950,
  available: true,
  type: bookcarsTypes.CarType.Diesel,
  gearbox: bookcarsTypes.GearboxType.Automatic,
  aircon: true,
  image: IMAGE1,
  seats: 5,
  doors: 4,
  fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
  mileage: 30000,
  cancellation: 0,
  amendments: 0,
  theftProtection: 9,
  collisionDamageWaiver: 12,
  fullInsurance: 20,
  additionalDriver: 20,
  range: bookcarsTypes.CarRange.Mini,
  multimedia: [bookcarsTypes.CarMultimedia.Bluetooth],
  rating: 3,
  comingSoon: false,
  fullyBooked: false,
  isDateBasedPrice: false,
  dateBasedPrices: [],
  ...overrides,
})

const buildUpdatePayload = (
  carId: string,
  createPayload: bookcarsTypes.CreateCarPayload,
  dateBasedPrices: bookcarsTypes.DateBasedPrice[],
  overrides: Partial<bookcarsTypes.UpdateCarPayload> = {},
): bookcarsTypes.UpdateCarPayload => ({
  ...createPayload,
  _id: carId,
  dateBasedPrices,
  blockOnPay: true,
  ...overrides,
})

const stageImage = async () => {
  const tempImage = path.join(env.CDN_TEMP_CARS, IMAGE1)
  if (!(await helper.pathExists(tempImage))) {
    await asyncFs.copyFile(IMAGE1_PATH, tempImage)
  }
}

// Seed a car straight through the model (bypasses the controller): the
// only way to create states the API now refuses (a maintenance car with
// available:true, a case-variant plate for the restore race). The
// caller owns cleanup via createdCarIds.
const seedCarDirectly = async (supplierId: string, licensePlate: string, overrides: {
  available?: boolean
  operationalStatus?: bookcarsTypes.CarOperationalStatus
} = {}) => {
  const seeded = await new Car({
    name: 'F5B Seeded Car',
    licensePlate,
    supplier: supplierId,
    minimumAge: 21,
    locations: [LOCATION1_ID],
    dailyPrice: 78,
    deposit: 950,
    available: true,
    type: bookcarsTypes.CarType.Diesel,
    gearbox: bookcarsTypes.GearboxType.Automatic,
    aircon: true,
    seats: 5,
    doors: 4,
    fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
    mileage: -1,
    cancellation: -1,
    amendments: -1,
    theftProtection: -1,
    collisionDamageWaiver: -1,
    fullInsurance: -1,
    additionalDriver: -1,
    range: bookcarsTypes.CarRange.Mini,
    ...overrides,
  }).save()
  createdCarIds.push(seeded._id.toString())
  return seeded
}

const createCar = async (payload: bookcarsTypes.CreateCarPayload) => {
  await stageImage()
  const res = await request(app)
    .post('/api/create-car')
    .set(env.X_ACCESS_TOKEN, TOKEN)
    .send(payload)
  if (res.statusCode === 200 && res.body?._id) {
    createdCarIds.push(res.body._id as string)
    if (Array.isArray(res.body.dateBasedPrices)) {
      createdRowIds.push(...(res.body.dateBasedPrices as string[]))
    }
    if (typeof res.body.image === 'string' && res.body.image) {
      createdImages.push(res.body.image as string)
    }
  }
  return res
}

const updateCar = async (payload: bookcarsTypes.UpdateCarPayload) => request(app)
  .put('/api/update-car')
  .set(env.X_ACCESS_TOKEN, TOKEN)
  .send(payload)

//
// Connecting and initializing the database before running the test suite
//
beforeAll(async () => {
  testHelper.initializeLogger()

  await databaseHelper.connect(env.DB_URI, false, false)

  await testHelper.initialize()

  // create two suppliers
  const supplierName1 = testHelper.getSupplierName()
  SUPPLIER1_ID = await testHelper.createSupplier(`${supplierName1}@test.bookcars.ma`, supplierName1)
  const supplierName2 = testHelper.getSupplierName()
  SUPPLIER2_ID = await testHelper.createSupplier(`${supplierName2}@test.bookcars.ma`, supplierName2)

  // create one location (locations carry no supplier, so either agency can use it)
  LOCATION1_ID = await testHelper.createLocation('F5B Location 1 EN', 'F5B Location 1 FR')

  await Car.createIndexes()

  TOKEN = await testHelper.signinAsAdmin()
})

//
// Closing and cleaning the database connection after running the test suite
//
afterAll(async () => {
  await testHelper.signout(TOKEN)

  await DateBasedPrice.deleteMany({ _id: { $in: createdRowIds } })
  await Car.deleteMany({ _id: { $in: createdCarIds } })
  for (const image of createdImages) {
    const filePath = path.join(env.CDN_CARS, image)
    if (await helper.pathExists(filePath)) {
      await asyncFs.unlink(filePath)
    }
  }

  await testHelper.deleteSupplier(SUPPLIER1_ID)
  await testHelper.deleteSupplier(SUPPLIER2_ID)
  await testHelper.deleteLocation(LOCATION1_ID)

  await testHelper.close()
  await databaseHelper.close()
})

//
// W2-09 — price sanity validation via API
//
describe('W2-09 create: price sanity', () => {
  it('rejects a negative dailyPrice', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { dailyPrice: -10 }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dailyPrice')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('rejects a negative deposit', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { deposit: -1 }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('deposit')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('rejects a discounted daily price above its base price', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { dailyPrice: 50, discountedDailyPrice: 60 }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('discountedDailyPrice')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('rejects a discounted hourly price above its base price', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { hourlyPrice: 10, discountedHourlyPrice: 11 }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('discountedHourlyPrice')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('accepts a discounted price equal to its base price', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { dailyPrice: 50, discountedDailyPrice: 50 }))
    expect(res.statusCode).toBe(200)
  })
})

describe('W2-09 update: price sanity', () => {
  it('rejects a negative dailyPrice on update and leaves the stored price unchanged', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string
    const payload = buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), [], { dailyPrice: -5 })
    const res = await updateCar(payload)
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dailyPrice')
    const stored = await Car.findById(carId).lean()
    expect(stored?.dailyPrice).toBe(78)
  })
})

//
// W2-08 — available:true + maintenance/stopped, and the legacy filter
//
describe('W2-08 create/update: contradictory availability', () => {
  it('rejects available:true with operationalStatus maintenance on create', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      available: true,
      operationalStatus: bookcarsTypes.CarOperationalStatus.Maintenance,
    }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('available')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('rejects available:true with operationalStatus stopped on create', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      available: true,
      operationalStatus: bookcarsTypes.CarOperationalStatus.Stopped,
    }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('available')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('accepts maintenance with available:false on create', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      available: false,
      operationalStatus: bookcarsTypes.CarOperationalStatus.Maintenance,
    }))
    expect(res.statusCode).toBe(200)
  })

  it('rejects a status-only edit to maintenance while the car stays available', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { available: true }))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string
    const payload = buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), [], {
      operationalStatus: bookcarsTypes.CarOperationalStatus.Maintenance,
    })
    const res = await updateCar(payload)
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('available')
    const stored = await Car.findById(carId).lean()
    expect(stored?.operationalStatus).toBe(bookcarsTypes.CarOperationalStatus.InService)
    expect(stored?.available).toBe(true)
  })

  it('accepts maintenance together with available:false on update', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { available: true }))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string
    const payload = buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), [], {
      available: false,
      operationalStatus: bookcarsTypes.CarOperationalStatus.Maintenance,
    })
    const res = await updateCar(payload)
    expect(res.statusCode).toBe(200)
  })
})

describe('W2-08 getCars: legacy Available filter excludes maintenance/stopped', () => {
  it('does not list a maintenance car with available:true under availability=Available', async () => {
    // Seeded directly through the model: the API can no longer create
    // this contradictory state, but legacy rows may still hold it.
    const plate = uniquePlate()
    await seedCarDirectly(SUPPLIER1_ID, plate, {
      available: true,
      operationalStatus: bookcarsTypes.CarOperationalStatus.Maintenance,
    })
    const controlPlate = uniquePlate()
    const control = await createCar(buildCreatePayload(SUPPLIER1_ID, controlPlate, { available: true }))
    expect(control.statusCode).toBe(200)

    const res = await request(app)
      .post('/api/cars/1/50/?s=')
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .send({ suppliers: [SUPPLIER1_ID], availability: [bookcarsTypes.Availablity.Available] })
    expect(res.statusCode).toBe(200)
    const rows = res.body?.[0]?.resultData as bookcarsTypes.Car[]
    const plates = rows.map((row) => row.licensePlate)
    expect(plates).toContain(controlPlate)
    expect(plates).not.toContain(plate)
  })
})

//
// W2-10 — seasonal ranges: overlap + empty set
//
describe('W2-10 seasonal ranges', () => {
  it('rejects overlapping ranges on create', async () => {
    const plate = uniquePlate()
    const rows = [seasonalRow(10, 20, 50), seasonalRow(15, 25, 60)]
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: rows,
    }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices[1].startDate')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('accepts back-to-back ranges (next start the day after previous end)', async () => {
    const plate = uniquePlate()
    const rows = [seasonalRow(10, 20, 50), seasonalRow(21, 30, 60)]
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: rows,
    }))
    expect(res.statusCode).toBe(200)
    expect((res.body.dateBasedPrices as string[]).length).toBe(2)
  })

  it('rejects isDateBasedPrice:true with zero rows on create', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: [],
    }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('rejects isDateBasedPrice:true with only blank draft rows on create', async () => {
    const plate = uniquePlate()
    const draft = { startDate: '', endDate: '', dailyPrice: '' } as unknown as bookcarsTypes.DateBasedPrice
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: [draft],
    }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('rejects an overlapping edit on update and leaves stored rows unchanged', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(10, 20, 50), seasonalRow(30, 40, 60)],
    }))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string
    const rowIds = created.body.dateBasedPrices as string[]
    const edited = [
      seasonalRow(10, 20, 50, rowIds[0]),
      seasonalRow(15, 25, 60, rowIds[1]),
    ]
    const payload = buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), edited, { isDateBasedPrice: true })
    const res = await updateCar(payload)
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices[1].startDate')
    const row1 = await DateBasedPrice.findById(rowIds[0]).lean()
    const row2 = await DateBasedPrice.findById(rowIds[1]).lean()
    expect(row1?.dailyPrice).toBe(50)
    expect(row2?.dailyPrice).toBe(60)
  })
})

//
// W2-11 — seasonal-price row ownership on update
//
describe('W2-11 seasonal row ownership', () => {
  it('rejects an update carrying another car\'s row id and leaves that row unchanged', async () => {
    const plateA = uniquePlate()
    const carA = await createCar(buildCreatePayload(SUPPLIER1_ID, plateA, {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(10, 20, 50)],
    }))
    expect(carA.statusCode).toBe(200)
    const foreignRowId = (carA.body.dateBasedPrices as string[])[0]

    const plateB = uniquePlate()
    const carB = await createCar(buildCreatePayload(SUPPLIER1_ID, plateB, {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(30, 40, 60)],
    }))
    expect(carB.statusCode).toBe(200)
    const carBId = carB.body._id as string
    const ownRowId = (carB.body.dateBasedPrices as string[])[0]

    // Foreign row smuggled in at index 1, priced to overwrite it.
    const rows = [
      seasonalRow(30, 40, 60, ownRowId),
      seasonalRow(10, 20, 999, foreignRowId),
    ]
    const payload = buildUpdatePayload(carBId, buildCreatePayload(SUPPLIER1_ID, plateB), rows, { isDateBasedPrice: true })
    const res = await updateCar(payload)
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices[1]._id')
    const foreign = await DateBasedPrice.findById(foreignRowId).lean()
    expect(foreign?.dailyPrice).toBe(50)
    const own = await DateBasedPrice.findById(ownRowId).lean()
    expect(own?.dailyPrice).toBe(60)
  })
})

//
// F5a §7 edge — omitted dateBasedPrices on update preserves stored rows
//
describe('F5a §7 edge: omitted dateBasedPrices on update', () => {
  it('preserves stored rows and the flag when the array is omitted', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(10, 20, 50), seasonalRow(30, 40, 60)],
    }))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string
    const rowIds = created.body.dateBasedPrices as string[]

    const payload = buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), [], { isDateBasedPrice: true })
    delete (payload as Partial<bookcarsTypes.UpdateCarPayload>).dateBasedPrices
    const res = await updateCar(payload)
    expect(res.statusCode).toBe(200)
    const stored = await Car.findById(carId).lean()
    expect(stored?.isDateBasedPrice).toBe(true)
    expect((stored?.dateBasedPrices || []).map((id) => id.toString()).sort()).toEqual([...rowIds].sort())
    for (const rowId of rowIds) {
      expect(await DateBasedPrice.exists({ _id: rowId })).not.toBeNull()
    }
  })

  it('still clears all rows on an explicit empty array, and normalises the flag off', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(10, 20, 50)],
    }))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string
    const rowId = (created.body.dateBasedPrices as string[])[0]
    const payload = buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), [], { isDateBasedPrice: true })
    const res = await updateCar(payload)
    expect(res.statusCode).toBe(200)
    const stored = await Car.findById(carId).lean()
    expect(stored?.dateBasedPrices.length).toBe(0)
    // An explicit clear removes seasonal pricing outright — the flag
    // follows the rows, so the car can never sit at "flag on, zero rows".
    expect(stored?.isDateBasedPrice).toBe(false)
    expect(await DateBasedPrice.exists({ _id: rowId })).toBeNull()
  })

  it('rejects a flag-on update carrying only blank draft rows', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(10, 20, 50)],
    }))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string
    const rowId = (created.body.dateBasedPrices as string[])[0]
    const draft = { startDate: '', endDate: '', dailyPrice: '' } as unknown as bookcarsTypes.DateBasedPrice
    const payload = buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), [draft], { isDateBasedPrice: true })
    const res = await updateCar(payload)
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices')
    expect(await DateBasedPrice.exists({ _id: rowId })).not.toBeNull()
    const stored = await Car.findById(carId).lean()
    expect((stored?.dateBasedPrices || []).map((id) => id.toString())).toEqual([rowId])
  })
})

//
// F5a QA observation (a) — race-path orphan rows
//
describe('F5a QA (a): orphan seasonal rows on failed save', () => {
  it('leaves no orphan row behind when create fails at save (case-variant plate race)', async () => {
    const plate = uniquePlate()
    const first = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(first.statusCode).toBe(200)
    // Case variant slips past the exact-match check and fails on the
    // strength-2 unique index at save() — after its row was written.
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate.toLowerCase(), {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(10, 20, 777)],
    }))
    expect(res.statusCode).toBe(409)
    expect(res.text).toContain('PLATE_IN_USE')
    expect(await DateBasedPrice.countDocuments({ dailyPrice: 777 })).toBe(0)
    expect(await Car.countDocuments({ licensePlate: plate.toLowerCase() })).toBe(0)
  })

  it('rolls back seasonal mutations when update fails at save (case-variant plate race)', async () => {
    const plateA = uniquePlate()
    const carA = await createCar(buildCreatePayload(SUPPLIER1_ID, plateA))
    expect(carA.statusCode).toBe(200)

    const plateB = uniquePlate()
    const carB = await createCar(buildCreatePayload(SUPPLIER1_ID, plateB, {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(10, 20, 50)],
    }))
    expect(carB.statusCode).toBe(200)
    const carBId = carB.body._id as string
    const rowId = (carB.body.dateBasedPrices as string[])[0]

    // Edit the stored row (50 -> 99), add a new row, and take car A's
    // plate as a case variant — the explicit check misses it, the
    // seasonal loop mutates, then save() throws E11000.
    const rows = [
      seasonalRow(10, 20, 99, rowId),
      seasonalRow(30, 40, 888),
    ]
    const payload = buildUpdatePayload(carBId, buildCreatePayload(SUPPLIER1_ID, plateB.toLowerCase()), rows, {
      isDateBasedPrice: true,
      licensePlate: plateA.toLowerCase(),
    })
    const res = await updateCar(payload)
    expect(res.statusCode).toBe(409)
    expect(res.text).toContain('PLATE_IN_USE')
    const storedRow = await DateBasedPrice.findById(rowId).lean()
    expect(storedRow?.dailyPrice).toBe(50)
    expect(await DateBasedPrice.countDocuments({ dailyPrice: 888 })).toBe(0)
    const storedCar = await Car.findById(carBId).lean()
    expect(storedCar?.licensePlate).toBe(plateB)
    expect((storedCar?.dateBasedPrices || []).map((id) => id.toString())).toEqual([rowId])
  })
})

//
// F5a QA observation (b) — restoreCar E11000 mapping
//
describe('F5a QA (b): restoreCar case-variant plate clash', () => {
  it('answers 409 PLATE_IN_USE when the live plate differs only by case', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string
    const trash = await request(app)
      .post(`/api/trash-car/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .send({ reason: 'F5B test trash' })
    expect(trash.statusCode).toBe(200)

    // Live car, same agency, same plate in another case — seeded
    // through the model (the API would 409 on the exact plate, and the
    // case variant is exactly the path under test).
    await seedCarDirectly(SUPPLIER1_ID, plate.toLowerCase())

    const res = await request(app)
      .post(`/api/restore-car/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .send({ reason: 'F5B test restore' })
    expect(res.statusCode).toBe(409)
    expect(res.text).toContain('PLATE_IN_USE')
  })
})

//
// F5a §7 edge — admin pre-flight global vs server per-agency
//
describe('F5a §7 edge: plate pre-flight scoping', () => {
  it('warns globally without a supplier, and stays silent for another agency with one', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)

    const global = await request(app)
      .get(`/api/validate-license-plate/${encodeURIComponent(plate)}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
    expect(global.statusCode).toBe(204)

    const scoped = await request(app)
      .get(`/api/validate-license-plate/${encodeURIComponent(plate)}?supplier=${SUPPLIER2_ID}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
    expect(scoped.statusCode).toBe(200)

    const scopedOwn = await request(app)
      .get(`/api/validate-license-plate/${encodeURIComponent(plate)}?supplier=${SUPPLIER1_ID}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
    expect(scopedOwn.statusCode).toBe(204)
  })
})
