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
const createdDocFiles: string[] = []

const nextYearPlusOne = new Date().getFullYear() + 1

const uniquePlate = () => `F5B-${nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`

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
  overrides: Partial<bookcarsTypes.UpdateCarPayload> = {},
): bookcarsTypes.UpdateCarPayload => ({
  ...createPayload,
  _id: carId,
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
  for (const file of createdDocFiles) {
    const filePath = path.join(env.CDN_CAR_DOCUMENTS, file)
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
// W2-12 — make/model/year
//
describe('W2-12 make/model/year', () => {
  it('stores trimmed make/model and year on create', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      make: '  Dacia  ',
      model: 'Logan',
      year: 2021,
    }))
    expect(res.statusCode).toBe(200)
    const stored = await Car.findById(res.body._id as string).lean()
    expect(stored?.make).toBe('Dacia')
    expect(stored?.model).toBe('Logan')
    expect(stored?.year).toBe(2021)
  })

  it('rejects a year before 1900', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { year: 1800 }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('year')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('rejects a year beyond next year', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { year: nextYearPlusOne + 1 }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('year')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('rejects a non-numeric year', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { year: 'abc' as unknown as number }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('year')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('rejects a make over 100 characters', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { make: 'x'.repeat(101) }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('make')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('updates the identity fields, clears make with an empty string, and rejects a bad year on update', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { make: 'Dacia', model: 'Logan', year: 2021 }))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const updated = await updateCar(buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), {
      make: '',
      model: 'Sandero',
      year: 2023,
    }))
    expect(updated.statusCode).toBe(200)
    const stored = await Car.findById(carId).lean()
    expect(stored?.make).toBeUndefined()
    expect(stored?.model).toBe('Sandero')
    expect(stored?.year).toBe(2023)

    const bad = await updateCar(buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), { year: 1800 }))
    expect(bad.statusCode).toBe(400)
    expect(bad.text).toContain('year')
    const storedAfterBad = await Car.findById(carId).lean()
    expect(storedAfterBad?.year).toBe(2023)
  })

  it('preserves stored identity fields when they are omitted from the update', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { make: 'Dacia', model: 'Logan', year: 2021 }))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string
    const payload = buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate))
    delete (payload as Partial<bookcarsTypes.UpdateCarPayload>).make
    delete (payload as Partial<bookcarsTypes.UpdateCarPayload>).model
    delete (payload as Partial<bookcarsTypes.UpdateCarPayload>).year
    const res = await updateCar(payload)
    expect(res.statusCode).toBe(200)
    const stored = await Car.findById(carId).lean()
    expect(stored?.make).toBe('Dacia')
    expect(stored?.model).toBe('Logan')
    expect(stored?.year).toBe(2021)
  })
})

//
// W2-13 — odometer
//
describe('W2-13 odometer', () => {
  it('stores the odometer reading and keeps it distinct from the mileage allowance', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { odometerKm: 45200 }))
    expect(res.statusCode).toBe(200)
    const stored = await Car.findById(res.body._id as string).lean()
    expect(stored?.odometerKm).toBe(45200)
    expect(stored?.mileage).toBe(30000)
  })

  it('rejects a negative odometer reading', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { odometerKm: -5 }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('odometerKm')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('updates the odometer and clears it with null', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { odometerKm: 45200 }))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const updated = await updateCar(buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), { odometerKm: 46000 }))
    expect(updated.statusCode).toBe(200)
    expect((await Car.findById(carId).lean())?.odometerKm).toBe(46000)

    const cleared = await updateCar(buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), { odometerKm: null }))
    expect(cleared.statusCode).toBe(200)
    expect((await Car.findById(carId).lean())?.odometerKm).toBeUndefined()
  })
})

//
// W2-19 — insurance policy data
//
describe('W2-19 insurance policy', () => {
  it('stores trimmed provider and policy number on create', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      insuranceProvider: '  AtlantaSanad  ',
      insurancePolicyNumber: 'POL-2026-001',
    }))
    expect(res.statusCode).toBe(200)
    const stored = await Car.findById(res.body._id as string).lean()
    expect(stored?.insuranceProvider).toBe('AtlantaSanad')
    expect(stored?.insurancePolicyNumber).toBe('POL-2026-001')
  })

  it('rejects an over-long provider name', async () => {
    const plate = uniquePlate()
    const res = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, { insuranceProvider: 'x'.repeat(201) }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('insuranceProvider')
    expect(await Car.countDocuments({ licensePlate: plate })).toBe(0)
  })

  it('updates the provider and clears the policy number with an empty string', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate, {
      insuranceProvider: 'AtlantaSanad',
      insurancePolicyNumber: 'POL-2026-001',
    }))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const updated = await updateCar(buildUpdatePayload(carId, buildCreatePayload(SUPPLIER1_ID, plate), {
      insuranceProvider: 'AXA',
      insurancePolicyNumber: '',
    }))
    expect(updated.statusCode).toBe(200)
    const stored = await Car.findById(carId).lean()
    expect(stored?.insuranceProvider).toBe('AXA')
    expect(stored?.insurancePolicyNumber).toBeUndefined()
  })
})

//
// W2-14 — gallery + car documents
//
describe('W2-14 gallery', () => {
  it('uploads a gallery image, stores it, and serves the file from the cars store', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const res = await request(app)
      .post(`/api/upload-car-image/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .attach('image', IMAGE1_PATH)
    expect(res.statusCode).toBe(200)
    const filename = res.body as string
    expect(typeof filename).toBe('string')
    createdImages.push(filename)

    const stored = await Car.findById(carId).lean()
    expect(stored?.images).toContain(filename)
    expect(await helper.pathExists(path.join(env.CDN_CARS, filename))).toBe(true)
    // The cover is untouched by the gallery upload.
    expect(stored?.image).toBe(created.body.image)
  })

  it('caps the gallery at 8 images', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    for (let i = 0; i < 8; i += 1) {
      const res = await request(app)
        .post(`/api/upload-car-image/${carId}`)
        .set(env.X_ACCESS_TOKEN, TOKEN)
        .attach('image', IMAGE1_PATH)
      expect(res.statusCode).toBe(200)
      createdImages.push(res.body as string)
    }
    const ninth = await request(app)
      .post(`/api/upload-car-image/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .attach('image', IMAGE1_PATH)
    expect(ninth.statusCode).toBe(400)
    expect(ninth.text).toContain('Maximum 8 gallery images')
    expect((await Car.findById(carId).lean())?.images?.length).toBe(8)
  })

  it('rejects a non-image gallery upload', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const res = await request(app)
      .post(`/api/upload-car-image/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .attach('image', Buffer.from('not an image'), 'notes.txt')
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('Invalid car image file type')
    expect((await Car.findById(carId).lean())?.images?.length || 0).toBe(0)
  })

  it('deletes a gallery image (record + file) and answers 404 the second time', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const uploaded = await request(app)
      .post(`/api/upload-car-image/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .attach('image', IMAGE1_PATH)
    expect(uploaded.statusCode).toBe(200)
    const filename = uploaded.body as string
    createdImages.push(filename)

    const deleted = await request(app)
      .post(`/api/delete-car-gallery-image/${carId}/${encodeURIComponent(filename)}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
    expect(deleted.statusCode).toBe(200)
    expect((await Car.findById(carId).lean())?.images || []).not.toContain(filename)
    expect(await helper.pathExists(path.join(env.CDN_CARS, filename))).toBe(false)

    const again = await request(app)
      .post(`/api/delete-car-gallery-image/${carId}/${encodeURIComponent(filename)}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
    expect(again.statusCode).toBe(404)
  })

  it('cannot delete the cover image through the gallery endpoint', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string
    const cover = created.body.image as string

    const res = await request(app)
      .post(`/api/delete-car-gallery-image/${carId}/${encodeURIComponent(cover)}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
    expect(res.statusCode).toBe(404)
    expect((await Car.findById(carId).lean())?.image).toBe(cover)
  })

  it('refuses a gallery upload on a trashed car', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string
    const trash = await request(app)
      .post(`/api/trash-car/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .send({ reason: 'F5B test trash' })
    expect(trash.statusCode).toBe(200)

    const res = await request(app)
      .post(`/api/upload-car-image/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .attach('image', IMAGE1_PATH)
    expect(res.statusCode).toBe(409)
  })
})

describe('W2-14 car documents', () => {
  it('uploads a document with kind + expiry, stores it, and downloads it back', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const res = await request(app)
      .post(`/api/upload-car-document/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .attach('file', IMAGE1_PATH)
      .field('kind', bookcarsTypes.CarDocumentKind.Insurance)
      .field('expiryDate', '2027-01-31')
    expect(res.statusCode).toBe(200)
    const doc = res.body as bookcarsTypes.CarDocument
    expect(doc.kind).toBe(bookcarsTypes.CarDocumentKind.Insurance)
    expect(doc.file).toBeTruthy()
    createdDocFiles.push(doc.file)
    expect(new Date(doc.expiryDate as Date).toISOString().slice(0, 10)).toBe('2027-01-31')

    const stored = await Car.findById(carId).lean()
    expect(stored?.documents?.map((d) => d.file)).toContain(doc.file)
    expect(await helper.pathExists(path.join(env.CDN_CAR_DOCUMENTS, doc.file))).toBe(true)

    const download = await request(app)
      .get(`/api/car-document/${carId}/${encodeURIComponent(doc.file)}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
    expect(download.statusCode).toBe(200)
    expect(download.headers['content-type']).toContain('image/jpeg')
  })

  it('defaults an unknown kind to other and accepts a document without an expiry', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const res = await request(app)
      .post(`/api/upload-car-document/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .attach('file', IMAGE1_PATH)
      .field('kind', 'not-a-kind')
    expect(res.statusCode).toBe(200)
    const doc = res.body as bookcarsTypes.CarDocument
    expect(doc.kind).toBe(bookcarsTypes.CarDocumentKind.Other)
    expect(doc.expiryDate).toBeUndefined()
    createdDocFiles.push(doc.file)
  })

  it('rejects a document with an unparsable expiry date', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const res = await request(app)
      .post(`/api/upload-car-document/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .attach('file', IMAGE1_PATH)
      .field('kind', bookcarsTypes.CarDocumentKind.Insurance)
      .field('expiryDate', 'not-a-date')
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('Invalid expiryDate')
    expect((await Car.findById(carId).lean())?.documents?.length || 0).toBe(0)
  })

  it('rejects a disallowed document extension', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const res = await request(app)
      .post(`/api/upload-car-document/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .attach('file', Buffer.from('MZ...'), 'malware.exe')
      .field('kind', bookcarsTypes.CarDocumentKind.Other)
    expect(res.statusCode).toBe(400)
    expect(res.text).toContain('Invalid car document file type')
  })

  it('deletes a document (record + file) and answers 404 the second time', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const uploaded = await request(app)
      .post(`/api/upload-car-document/${carId}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
      .attach('file', IMAGE1_PATH)
      .field('kind', bookcarsTypes.CarDocumentKind.Vignette)
    expect(uploaded.statusCode).toBe(200)
    const doc = uploaded.body as bookcarsTypes.CarDocument
    createdDocFiles.push(doc.file)

    const deleted = await request(app)
      .delete(`/api/delete-car-document/${carId}/${encodeURIComponent(doc.file)}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
    expect(deleted.statusCode).toBe(200)
    expect((await Car.findById(carId).lean())?.documents || []).not.toContainEqual(expect.objectContaining({ file: doc.file }))
    expect(await helper.pathExists(path.join(env.CDN_CAR_DOCUMENTS, doc.file))).toBe(false)

    const again = await request(app)
      .delete(`/api/delete-car-document/${carId}/${encodeURIComponent(doc.file)}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
    expect(again.statusCode).toBe(404)
  })

  it('answers 404 for a download of a filename that is not recorded on the car', async () => {
    const plate = uniquePlate()
    const created = await createCar(buildCreatePayload(SUPPLIER1_ID, plate))
    expect(created.statusCode).toBe(200)
    const carId = created.body._id as string

    const res = await request(app)
      .get(`/api/car-document/${carId}/${encodeURIComponent('cardoc_nope.jpg')}`)
      .set(env.X_ACCESS_TOKEN, TOKEN)
    expect(res.statusCode).toBe(404)
  })
})

//
// W2-14 guard — the create/update payload cannot forge gallery or
// document entries (they are endpoint-managed only).
//
describe('W2-14 payload guard', () => {
  it('ignores images/documents carried in the create payload', async () => {
    const plate = uniquePlate()
    const payload = buildCreatePayload(SUPPLIER1_ID, plate) as unknown as Record<string, unknown>
    payload.images = ['forged.jpg']
    payload.documents = [{ kind: 'insurance', file: 'forged.pdf' }]
    const res = await createCar(payload as unknown as bookcarsTypes.CreateCarPayload)
    expect(res.statusCode).toBe(200)
    const stored = await Car.findById(res.body._id as string).lean()
    expect(stored?.images || []).toEqual([])
    expect(stored?.documents || []).toEqual([])
  })
})
