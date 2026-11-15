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

const uniquePlate = () => `F5A-${nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`

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
  name: 'F5A Test Car',
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
  LOCATION1_ID = await testHelper.createLocation('F5A Location 1 EN', 'F5A Location 1 FR')

  // The case-variant test below depends on the unique index: make sure
  // it exists before any test runs, and fail loudly if it does not.
  await Car.createIndexes()
  const indexes = await Car.collection.indexes()
  const plateIndex = (indexes as unknown as Array<{ key?: Record<string, unknown>, unique?: boolean, collation?: { strength?: number } }>).find(
    (index) => index.key?.supplier === 1 && index.key?.licensePlate === 1,
  )
  expect(plateIndex).toBeDefined()
  expect(plateIndex?.unique).toBe(true)
  expect(plateIndex?.collation?.strength).toBe(2)

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
// F5a (W2-01) — license-plate uniqueness on create
//
describe('POST /api/create-car — license plate uniqueness (W2-01)', () => {
  it('should reject a duplicate plate under the same agency with 409', async () => {
    const plate = uniquePlate()
    const carCountBefore = await Car.countDocuments({ supplier: SUPPLIER1_ID })
    const rowCountBefore = await DateBasedPrice.countDocuments()

    // first car, with a valid seasonal row
    const payloadA = buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(1, 2, 50)],
    })
    const resA = await createCar(payloadA)
    expect(resA.statusCode).toBe(200)

    // second car, same plate, same agency — also carrying a valid row,
    // which must not leak into the database either
    const payloadB = buildCreatePayload(SUPPLIER1_ID, plate, {
      name: 'F5A Test Car B',
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(3, 4, 60)],
    })
    const resB = await createCar(payloadB)
    expect(resB.statusCode).toBe(409)
    expect(resB.text).toContain('PLATE_IN_USE')
    expect(resB.text).toContain(plate)

    expect(await Car.countDocuments({ supplier: SUPPLIER1_ID })).toBe(carCountBefore + 1)
    expect(await DateBasedPrice.countDocuments()).toBe(rowCountBefore + 1)
  })

  it('should accept the same plate under another agency', async () => {
    const plate = uniquePlate()
    const resA = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(resA.statusCode).toBe(200)
    const resB = await createCar(buildCreatePayload(SUPPLIER2_ID, plate, { name: 'F5A Test Car B' }))
    expect(resB.statusCode).toBe(200)
    expect(resB.body._id).toBeDefined()
  })

  it('should reject the same plate in another case under the same agency', async () => {
    const plate = uniquePlate()
    const resA = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(resA.statusCode).toBe(200)
    // The explicit check is an exact match, so this reaches the save
    // and fails on the case-insensitive unique index instead (same 409).
    const resB = await createCar(buildCreatePayload(SUPPLIER1_ID, plate.toLowerCase(), { name: 'F5A Test Car B' }))
    expect(resB.statusCode).toBe(409)
    expect(resB.text).toContain('PLATE_IN_USE')
    expect(await Car.countDocuments({ supplier: SUPPLIER1_ID, licensePlate: plate })).toBe(1)
  })
})

//
// F5a (W2-02) — license plate required on create
//
describe('POST /api/create-car — license plate required (W2-02)', () => {
  it('should reject an empty plate with 400', async () => {
    const countBefore = await Car.countDocuments({ supplier: SUPPLIER1_ID })
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, ''))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('licensePlate')
    expect(await Car.countDocuments({ supplier: SUPPLIER1_ID })).toBe(countBefore)
  })

  it('should reject a missing plate with 400', async () => {
    const countBefore = await Car.countDocuments({ supplier: SUPPLIER1_ID })
    const payload = buildCreatePayload(SUPPLIER1_ID, uniquePlate())
    delete payload.licensePlate
    const res = await createCar(payload)
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('licensePlate')
    expect(await Car.countDocuments({ supplier: SUPPLIER1_ID })).toBe(countBefore)
  })

  it('should reject a whitespace-only plate with 400', async () => {
    const countBefore = await Car.countDocuments({ supplier: SUPPLIER1_ID })
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, '   '))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('licensePlate')
    expect(await Car.countDocuments({ supplier: SUPPLIER1_ID })).toBe(countBefore)
  })
})

//
// F5a (W2-03) — seasonal prices on create
//
describe('POST /api/create-car — seasonal prices (W2-03)', () => {
  it('should reject a row with a non-positive price, naming the row and field', async () => {
    const plate = uniquePlate()
    const countBefore = await Car.countDocuments({ supplier: SUPPLIER1_ID })
    const rowsBefore = await DateBasedPrice.countDocuments()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(1, 2, 0)],
    }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices[0].dailyPrice')
    expect(await Car.countDocuments({ supplier: SUPPLIER1_ID })).toBe(countBefore)
    expect(await DateBasedPrice.countDocuments()).toBe(rowsBefore)
  })

  it('should reject a row whose end is before its start, naming the row and field', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(1, 2, 50), seasonalRow(5, 4, 60)],
    }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices[1].endDate')
    expect(await Car.countDocuments({ supplier: SUPPLIER1_ID, licensePlate: plate })).toBe(0)
  })

  it('should reject a row with an unparseable start date', async () => {
    const plate = uniquePlate()
    const badRow = { startDate: 'not-a-date', endDate: addDays(new Date(), 2), dailyPrice: 50 } as unknown as bookcarsTypes.DateBasedPrice
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: [badRow],
    }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices[0].startDate')
  })

  it('should still ignore an entirely-blank draft row', async () => {
    const plate = uniquePlate()
    const draftRow = { startDate: '', endDate: '', dailyPrice: '' } as unknown as bookcarsTypes.DateBasedPrice
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: [seasonalRow(1, 2, 50), draftRow],
    }))
    expect(res.statusCode).toBe(200)
    expect(res.body.dateBasedPrices.length).toBe(1)
    const stored = await DateBasedPrice.findById(res.body.dateBasedPrices[0])
    expect(stored).toBeTruthy()
    expect(stored?.dailyPrice).toBe(50)
  })

  it('should ignore seasonal rows entirely when the flag is off', async () => {
    const plate = uniquePlate()
    const rowsBefore = await DateBasedPrice.countDocuments()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: false,
      dateBasedPrices: [seasonalRow(1, 2, 0)],
    }))
    expect(res.statusCode).toBe(200)
    expect(res.body.dateBasedPrices.length).toBe(0)
    expect(await DateBasedPrice.countDocuments()).toBe(rowsBefore)
  })
})

//
// F5a (W2-01/W2-02) — license plate on update
//
describe('PUT /api/update-car — license plate (W2-01/W2-02)', () => {
  const createTwoCars = async () => {
    const payloadA = buildCreatePayload(SUPPLIER1_ID, uniquePlate())
    const resA = await createCar(payloadA)
    expect(resA.statusCode).toBe(200)
    const payloadB = buildCreatePayload(SUPPLIER1_ID, uniquePlate(), { name: 'F5A Test Car B' })
    const resB = await createCar(payloadB)
    expect(resB.statusCode).toBe(200)
    return {
      carA: { id: resA.body._id as string, payload: payloadA },
      carB: { id: resB.body._id as string, payload: payloadB },
    }
  }

  it('should reject taking another car’s plate with 409 and leave the car unchanged', async () => {
    const { carA, carB } = await createTwoCars()
    const res = await updateCar(buildUpdatePayload(carB.id, carB.payload, [], { licensePlate: carA.payload.licensePlate }))
    expect(res.statusCode).toBe(409)
    expect(res.text).toContain('PLATE_IN_USE')
    const storedB = await Car.findById(carB.id)
    expect(storedB?.licensePlate).toBe(carB.payload.licensePlate)
  })

  it('should reject an empty plate with 400 and leave the stored plate unchanged', async () => {
    const { carB } = await createTwoCars()
    const res = await updateCar(buildUpdatePayload(carB.id, carB.payload, [], { licensePlate: '' }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('licensePlate')
    const storedB = await Car.findById(carB.id)
    expect(storedB?.licensePlate).toBe(carB.payload.licensePlate)
  })

  it('should reject a missing plate with 400 and leave the stored plate unchanged', async () => {
    const { carB } = await createTwoCars()
    const payload = buildUpdatePayload(carB.id, carB.payload, [])
    delete payload.licensePlate
    const res = await updateCar(payload)
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('licensePlate')
    const storedB = await Car.findById(carB.id)
    expect(storedB?.licensePlate).toBe(carB.payload.licensePlate)
  })

  it('should accept keeping its own plate', async () => {
    const { carB } = await createTwoCars()
    const res = await updateCar(buildUpdatePayload(carB.id, carB.payload, [], { name: 'F5A Test Car B Renamed' }))
    expect(res.statusCode).toBe(200)
    expect(res.body.licensePlate).toBe(carB.payload.licensePlate)
    expect(res.body.name).toBe('F5A Test Car B Renamed')
  })
})

//
// F5a (W2-03) — seasonal prices on update
//
describe('PUT /api/update-car — seasonal prices (W2-03)', () => {
  const createCarWithRows = async () => {
    const plate = uniquePlate()
    const rows = [seasonalRow(1, 2, 50), seasonalRow(3, 4, 60)]
    const payload = buildCreatePayload(SUPPLIER1_ID, plate, {
      isDateBasedPrice: true,
      dateBasedPrices: rows,
    })
    const res = await createCar(payload)
    expect(res.statusCode).toBe(200)
    expect(res.body.dateBasedPrices.length).toBe(2)
    const rowIds = res.body.dateBasedPrices as string[]
    return { id: res.body._id as string, payload, rowIds }
  }

  const storedRows = async (rowIds: string[]) => DateBasedPrice.find({ _id: { $in: rowIds } }).sort({ startDate: 1 })

  it('should reject an invalid edit to a stored row and preserve the row', async () => {
    const { id, payload, rowIds } = await createCarWithRows()
    const rows = [
      { _id: rowIds[0], startDate: addDays(new Date(), 1), endDate: addDays(new Date(), 2), dailyPrice: 0 },
      { _id: rowIds[1], startDate: addDays(new Date(), 3), endDate: addDays(new Date(), 4), dailyPrice: 60 },
    ]
    const res = await updateCar(buildUpdatePayload(id, payload, rows))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices[0].dailyPrice')
    const stored = await storedRows(rowIds)
    expect(stored.length).toBe(2)
    expect(stored[0].dailyPrice).toBe(50)
    const car = await Car.findById(id)
    expect((car?.dateBasedPrices || []).map((rowId) => rowId.toString())).toContain(rowIds[0])
  })

  it('should reject blanking out a stored row and preserve it', async () => {
    const { id, payload, rowIds } = await createCarWithRows()
    const blankRow = { _id: rowIds[0], startDate: '', endDate: '', dailyPrice: '' } as unknown as bookcarsTypes.DateBasedPrice
    const rows = [
      blankRow,
      { _id: rowIds[1], startDate: addDays(new Date(), 3), endDate: addDays(new Date(), 4), dailyPrice: 60 },
    ]
    const res = await updateCar(buildUpdatePayload(id, payload, rows))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices[0]')
    const stored = await storedRows(rowIds)
    expect(stored.length).toBe(2)
    expect(stored[0].dailyPrice).toBe(50)
  })

  it('should reject an invalid new row and leave the stored rows untouched', async () => {
    const { id, payload, rowIds } = await createCarWithRows()
    const rows = [
      { _id: rowIds[0], startDate: addDays(new Date(), 1), endDate: addDays(new Date(), 2), dailyPrice: 50 },
      { _id: rowIds[1], startDate: addDays(new Date(), 3), endDate: addDays(new Date(), 4), dailyPrice: 60 },
      { startDate: addDays(new Date(), 5), endDate: addDays(new Date(), 6), dailyPrice: -10 },
    ]
    const rowsBefore = await DateBasedPrice.countDocuments()
    const res = await updateCar(buildUpdatePayload(id, payload, rows))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('dateBasedPrices[2].dailyPrice')
    expect(await DateBasedPrice.countDocuments()).toBe(rowsBefore)
    const stored = await storedRows(rowIds)
    expect(stored.length).toBe(2)
  })

  it('should still allow a valid edit, add and removal in one update', async () => {
    const { id, payload, rowIds } = await createCarWithRows()
    const rows = [
      { _id: rowIds[0], startDate: addDays(new Date(), 1), endDate: addDays(new Date(), 2), dailyPrice: 99 },
      { startDate: addDays(new Date(), 5), endDate: addDays(new Date(), 6), dailyPrice: 70 },
    ]
    const res = await updateCar(buildUpdatePayload(id, payload, rows))
    expect(res.statusCode).toBe(200)
    expect(res.body.dateBasedPrices.length).toBe(2)
    const edited = await DateBasedPrice.findById(rowIds[0])
    expect(edited?.dailyPrice).toBe(99)
    // the removed row is deleted, the new row is created
    expect(await DateBasedPrice.findById(rowIds[1])).toBeNull()
    const newRowId = (res.body.dateBasedPrices as string[]).find((rowId) => rowId !== rowIds[0])
    expect(newRowId).toBeDefined()
    const created = await DateBasedPrice.findById(newRowId)
    expect(created?.dailyPrice).toBe(70)
    if (newRowId) {
      createdRowIds.push(newRowId)
    }
  })
})
