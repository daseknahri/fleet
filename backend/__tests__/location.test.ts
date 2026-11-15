import 'dotenv/config'
import request from 'supertest'
import url from 'url'
import path from 'path'
import asyncFs from 'node:fs/promises'
import { nanoid } from 'nanoid'
import mongoose, { FlattenMaps } from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as testHelper from './testHelper'
import * as env from '../src/config/env.config'
import * as helper from '../src/utils/helper'
import LocationValue from '../src/models/LocationValue'
import Location from '../src/models/Location'
import Country from '../src/models/Country'
import Car from '../src/models/Car'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const IMAGE0 = 'location0.jpg'
const IMAGE0_PATH = path.join(__dirname, `./img/${IMAGE0}`)
const IMAGE1 = 'location1.jpg'
const IMAGE1_PATH = path.join(__dirname, `./img/${IMAGE1}`)
const IMAGE2 = 'location2.jpg'
const IMAGE2_PATH = path.join(__dirname, `./img/${IMAGE2}`)

let SUPPLIER_ID: string
let LOCATION_ID: string
let PARENT_LOCATION_ID: string

let LOCATION_NAMES: bookcarsTypes.LocationName[] = [
  {
    language: 'en',
    name: nanoid(),
  },
  {
    language: 'fr',
    name: nanoid(),
  },
]

let countryValue1Id = ''
let countryValue2Id = ''
let countryId = ''

//
// Connecting and initializing the database before running the test suite
//
beforeAll(async () => {
  testHelper.initializeLogger()

  await databaseHelper.connect(env.DB_URI, false, false)
  await testHelper.initialize()

  const supplierName = nanoid()
  SUPPLIER_ID = await testHelper.createSupplier(`${supplierName}@test.bookcars.ma`, supplierName)
  const countryValue1 = new LocationValue({ language: 'en', value: 'Country 1' })
  await countryValue1.save()
  countryValue1Id = countryValue1._id.toString()
  const countryValue2 = new LocationValue({ language: 'fr', value: 'Pays 1' })
  await countryValue2.save()
  countryValue2Id = countryValue2._id.toString()
  const country = new Country({ values: [countryValue1._id, countryValue2._id] })
  await country.save()
  countryId = country._id.toString()
  PARENT_LOCATION_ID = await testHelper.createLocation('parent-loc-name', 'parent-loc-fr', countryId)
})

//
// Closing and cleaning the database connection after running the test suite
//
afterAll(async () => {
  await testHelper.deleteSupplier(SUPPLIER_ID)
  await LocationValue.deleteMany({ _id: { $in: [countryValue1Id, countryValue2Id] } })
  await Country.deleteOne({ _id: countryId })
  await testHelper.deleteLocation(PARENT_LOCATION_ID)

  await testHelper.close()
  await databaseHelper.close()
})

//
// Unit tests
//

describe('POST /api/validate-location', () => {
  it('should validate a location', async () => {
    const token = await testHelper.signinAsAdmin()

    // test success (location found)
    const language = testHelper.LANGUAGE
    const name = nanoid()
    const locationValue = new LocationValue({ language, value: name })
    await locationValue.save()
    const location = new Location({ country: countryId, values: [locationValue._id] })
    await location.save()
    const payload: bookcarsTypes.ValidateLocationPayload = {
      language,
      name,
    }
    let res = await request(app)
      .post('/api/validate-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(204)

    // test success (location not found)
    payload.name = nanoid()
    res = await request(app)
      .post('/api/validate-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(200)
    await locationValue.deleteOne()
    await location.deleteOne()

    // test failure (wrong language)
    payload.language = 'unknown'
    res = await request(app)
      .post('/api/validate-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(400)

    // test failure (no payload)
    res = await request(app)
      .post('/api/validate-location')
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(500)

    await testHelper.signout(token)
  })
})

describe('POST /api/create-location', () => {
  it('should create a location', async () => {
    const token = await testHelper.signinAsAdmin()

    // test failure (image not found)
    const payload: bookcarsTypes.UpsertLocationPayload = {
      country: countryId,
      names: LOCATION_NAMES,
      latitude: 28.0268755,
      longitude: 1.6528399999999976,
      image: `${nanoid()}.jpg`,
      supplier: SUPPLIER_ID,
    }
    let res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(400)

    // test success (no image)
    payload.image = undefined
    res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(200)
    expect(res.body._id).toBeTruthy()
    const location = await Location.findByIdAndDelete(res.body._id)
    expect(location).toBeTruthy()
    expect((await LocationValue.find({ _id: { $in: location!.values } })).length).toBe(2)
    await LocationValue.deleteMany({ _id: { $in: location!.values } })

    // test success (image and parkingspots)
    payload.parkingSpots = [
      {
        latitude: 28.1268755,
        longitude: 1.752839999999997,
        values: [{ language: 'en', value: 'Parking spot 1' }, { language: 'fr', value: 'Parking 1' }, { language: 'es', value: 'Parking 1' }],
      },
      {
        latitude: 28.2268755,
        longitude: 1.8528399999999976,
        values: [{ language: 'en', value: 'Parking spot 2' }, { language: 'fr', value: 'Parking 2' }, { language: 'es', value: 'Parking 1' }],
      },
      {
        latitude: 27.2268755,
        longitude: 12.852839999999997,
      },
    ]
    const tempImage = path.join(env.CDN_TEMP_LOCATIONS, IMAGE0)
    if (!(await helper.pathExists(tempImage))) {
      await asyncFs.copyFile(IMAGE0_PATH, tempImage)
    }
    payload.image = IMAGE0
    res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(200)
    expect(res.body?.country).toBe(payload.country)
    expect(res.body?.values?.length).toBe(2)
    expect(res.body?.latitude).toBe(payload.latitude)
    expect(res.body?.longitude).toBe(payload.longitude)
    expect(res.body?.parkingSpots?.length).toBe(3)
    LOCATION_ID = res.body?._id

    // test failure (wrong payload)
    res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send({})
    expect(res.statusCode).toBe(400)

    // test failure (no payload)
    res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(500)

    await testHelper.signout(token)
  })
})

describe('PUT /api/update-location/:id', () => {
  it('should update a location', async () => {
    const token = await testHelper.signinAsAdmin()

    // test success
    LOCATION_NAMES = [
      {
        language: 'en',
        name: 'test-en',
      },
      {
        language: 'fr',
        name: nanoid(),
      },
      {
        language: 'es',
        name: nanoid(),
      },
    ]
    const location = await Location
      .findById(LOCATION_ID)
      .populate<{ parkingSpots: env.ParkingSpot[] }>({
        path: 'parkingSpots',
        populate: {
          path: 'values',
          model: 'LocationValue',
        },
      })
      .lean()
    expect(location?.parkingSpots.length).toBe(3)

    const parkingSpot2 = (location!.parkingSpots[1]) as unknown as FlattenMaps<bookcarsTypes.ParkingSpot>
    expect(parkingSpot2.values!.length).toBe(3)
    parkingSpot2.values![0].value = 'Parking spot 2 updated'
    parkingSpot2.values![3] = { language: 'pt', value: 'Parking spot 2 pt' }

    const payload: bookcarsTypes.UpsertLocationPayload = {
      country: countryId,
      names: LOCATION_NAMES,
      latitude: 29.0268755,
      longitude: 2.6528399999999976,
      parkingSpots: [
        parkingSpot2,
        {
          latitude: 28.1268755,
          longitude: 1.752839999999997,
          values: [{ language: 'en', value: 'Parking spot 3' }, { language: 'fr', value: 'Parking 3' }, { language: 'es', value: 'Parking 3' }],
        },
        {
          latitude: 28.2268755,
          longitude: 1.8528399999999976,
          values: [{ language: 'en', value: 'Parking spot 4' }, { language: 'fr', value: 'Parking 4' }, { language: 'es', value: 'Parking 3' }],
        },
      ],
    }

    let res = await request(app)
      .put(`/api/update-location/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(200)
    expect(res.body?.country).toBe(payload.country)
    expect(res.body.values?.length).toBe(3)
    expect(res.body?.latitude).toBe(payload.latitude)
    expect(res.body?.longitude).toBe(payload.longitude)
    expect(res.body?.parkingSpots.length).toBe(3)

    // test success (no parkingSpots)
    payload.parkingSpots = undefined
    payload.parentLocation = PARENT_LOCATION_ID
    res = await request(app)
      .put(`/api/update-location/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(200)
    expect(res.body?.country).toBe(payload.country)
    expect(res.body.values?.length).toBe(3)
    expect(res.body?.latitude).toBe(payload.latitude)
    expect(res.body?.longitude).toBe(payload.longitude)
    expect(res.body?.parkingSpots.length).toBe(0)

    // test success (update parkingSpots)
    payload.parentLocation = undefined
    const loc = await Location.findById(LOCATION_ID)
    loc!.parkingSpots = null
    await loc!.save()
    payload.parkingSpots = [
      {
        latitude: 28.1268755,
        longitude: 1.752839999999997,
        values: [{ language: 'en', value: 'Parking spot 1' }, { language: 'fr', value: 'Parking 1' }, { language: 'es', value: 'Parking 1' }],
      },
    ]
    res = await request(app)
      .put(`/api/update-location/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(200)
    expect(res.body?.country).toBe(payload.country)
    expect(res.body.values?.length).toBe(3)
    expect(res.body?.latitude).toBe(payload.latitude)
    expect(res.body?.longitude).toBe(payload.longitude)
    expect(res.body?.parkingSpots.length).toBe(1)

    // test success (location not found)
    res = await request(app)
      .put(`/api/update-location/${testHelper.GetRandromObjectIdAsString()}`)
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(204)

    // test failure (no payload)
    res = await request(app)
      .put(`/api/update-location/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(400)

    await testHelper.signout(token)
  })
})

describe('GET /api/location-id/:name/:language', () => {
  it('should get a location id', async () => {
    const language = 'en'
    const name = 'test-en'

    // test success (location found)
    let res = await request(app)
      .get(`/api/location-id/${name}/${language}`)
    expect(res.statusCode).toBe(200)
    expect(res.body).toBeDefined()

    // test success (location not found)
    res = await request(app)
      .get(`/api/location-id/unknown/${language}`)
    expect(res.statusCode).toBe(204)

    // test failure (wrong language)
    res = await request(app)
      .get('/api/location-id/unknown/english')
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/create-location-image', () => {
  it('should create a location image', async () => {
    const token = await testHelper.signinAsAdmin()

    // test success
    let res = await request(app)
      .post('/api/create-location-image')
      .set(env.X_ACCESS_TOKEN, token)
      .attach('image', IMAGE1_PATH)
    expect(res.statusCode).toBe(200)
    const filename = res.body as string
    const filePath = path.join(env.CDN_TEMP_LOCATIONS, filename)
    const imageExists = await helper.pathExists(filePath)
    expect(imageExists).toBeTruthy()
    await asyncFs.unlink(filePath)

    // test failure (no image attached)
    res = await request(app)
      .post('/api/create-location-image')
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(400)

    await testHelper.signout(token)
  })
})

describe('POST /api/update-location-image/:id', () => {
  it('should update a location image', async () => {
    const token = await testHelper.signinAsAdmin()

    // test success
    let res = await request(app)
      .post(`/api/update-location-image/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
      .attach('image', IMAGE2_PATH)
    expect(res.statusCode).toBe(200)
    const filename = res.body as string
    const imageFile = path.join(env.CDN_LOCATIONS, filename)
    const imageExists = await helper.pathExists(imageFile)
    expect(imageExists).toBeTruthy()
    const location = await Location.findById(LOCATION_ID)
    expect(location).not.toBeNull()
    expect(location?.image).toBe(filename)

    // test success (no initial image)
    await asyncFs.unlink(imageFile)
    location!.image = undefined
    await location?.save()
    res = await request(app)
      .post(`/api/update-location-image/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
      .attach('image', IMAGE2_PATH)
    expect(res.statusCode).toBe(200)

    // test success (initial image not found)
    location!.image = `${nanoid()}.jpg`
    await location?.save()
    res = await request(app)
      .post(`/api/update-location-image/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
      .attach('image', IMAGE2_PATH)
    expect(res.statusCode).toBe(200)
    location!.image = filename
    await location?.save()

    // test failure (no image attached)
    res = await request(app)
      .post(`/api/update-location-image/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(400)

    // test success (location not found)
    res = await request(app)
      .post(`/api/update-location-image/${testHelper.GetRandromObjectIdAsString()}`)
      .set(env.X_ACCESS_TOKEN, token)
      .attach('image', IMAGE1_PATH)
    expect(res.statusCode).toBe(204)

    // test success (location found)
    res = await request(app)
      .post(`/api/update-location-image/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
      .attach('image', IMAGE1_PATH)
    expect(res.statusCode).toBe(200)

    // test failure (wrong location id)
    res = await request(app)
      .post('/api/update-location-image/0')
      .set(env.X_ACCESS_TOKEN, token)
      .attach('image', IMAGE1_PATH)
    expect(res.statusCode).toBe(400)

    await testHelper.signout(token)
  })
})

describe('POST /api/delete-location-image/:id', () => {
  it('should delete a location image', async () => {
    const token = await testHelper.signinAsAdmin()

    // test success
    let location = await Location.findById(LOCATION_ID)
    expect(location).not.toBeNull()
    expect(location?.image).toBeDefined()
    const filename = location?.image as string
    let imageExists = await helper.pathExists(path.join(env.CDN_LOCATIONS, filename))
    expect(imageExists).toBeTruthy()
    let res = await request(app)
      .post(`/api/delete-location-image/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(200)
    imageExists = await helper.pathExists(path.join(env.CDN_LOCATIONS, filename))
    expect(imageExists).toBeFalsy()
    location = await Location.findById(LOCATION_ID)
    expect(location?.image).toBeNull()

    // test success (no image)
    res = await request(app)
      .post(`/api/delete-location-image/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(200)

    // test success (image not found)
    location = await Location.findById(LOCATION_ID)
    location!.image = `${nanoid()}.jpg`
    await location!.save()
    res = await request(app)
      .post(`/api/delete-location-image/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(200)

    // test success (location not found)
    res = await request(app)
      .post(`/api/delete-location-image/${testHelper.GetRandromObjectIdAsString()}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(204)

    // test failure (wrong location id)
    res = await request(app)
      .post('/api/delete-location-image/invalid-id')
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(400)

    await testHelper.signout(token)
  })
})

describe('POST /api/delete-temp-location-image/:image', () => {
  it('should delete a temporary location image', async () => {
    const token = await testHelper.signinAsAdmin()

    // test success
    const tempImage = path.join(env.CDN_TEMP_LOCATIONS, IMAGE1)
    if (!(await helper.pathExists(tempImage))) {
      await asyncFs.copyFile(IMAGE1_PATH, tempImage)
    }
    let res = await request(app)
      .post(`/api/delete-temp-location-image/${IMAGE1}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(200)
    const tempImageExists = await helper.pathExists(tempImage)
    expect(tempImageExists).toBeFalsy()

    // test success (image not found)
    res = await request(app)
      .post('/api/delete-temp-location-image/unknown.jpg')
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(200)

    // test success (wrong image filename)
    // res = await request(app)
    //   .post('/api/delete-temp-location-image/unknown')
    //   .set(env.X_ACCESS_TOKEN, token)
    // expect(res.statusCode).toBe(400)

    await testHelper.signout(token)
  })
})

describe('GET /api/location/:id/:language', () => {
  it('should get a location', async () => {
    const language = 'en'

    // test success (LOCATION_ID)
    let res = await request(app)
      .get(`/api/location/${LOCATION_ID}/${language}`)
    expect(res.statusCode).toBe(200)
    expect(res.body?.name).toBe(LOCATION_NAMES.filter((v) => v.language === language)[0].name)

    // test success (parent location)
    const loc = await Location.findById(LOCATION_ID)
    loc!.parentLocation = new mongoose.Types.ObjectId(PARENT_LOCATION_ID)
    await loc!.save()
    res = await request(app)
      .get(`/api/location/${LOCATION_ID}/${language}`)
    expect(res.statusCode).toBe(200)
    expect(res.body?.name).toBe(LOCATION_NAMES.filter((v) => v.language === language)[0].name)
    loc!.parentLocation = undefined
    await loc!.save()

    // test success (new location)
    const locationId = await testHelper.createLocation('loc1-en', 'loc1-fr')
    res = await request(app)
      .get(`/api/location/${locationId}/${language}`)
    expect(res.statusCode).toBe(200)
    expect(res.body?.name).toBe('loc1-en')
    const location = await Location.findByIdAndDelete(locationId)
    expect(location).toBeTruthy()
    await LocationValue.deleteMany({ _id: { $in: location!.values } })

    // test success (location not found)
    res = await request(app)
      .get(`/api/location/${testHelper.GetRandromObjectIdAsString()}/${language}`)
    expect(res.statusCode).toBe(204)

    // test failure (language not found)
    res = await request(app)
      .get(`/api/location/${LOCATION_ID}/zh`)
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/locations/:page/:size/:language', () => {
  it('should get locations', async () => {
    const language = 'en'

    // test success
    let res = await request(app)
      .get(`/api/locations/${testHelper.PAGE}/${testHelper.SIZE}/${language}?s=${LOCATION_NAMES[0].name}`)
    expect(res.statusCode).toBe(200)
    expect(res.body.length).toBe(1)

    // test failure (wrong page number)
    res = await request(app)
      .get(`/api/locations/unknown/${testHelper.SIZE}/${language}`)
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/locations-with-position/:language', () => {
  it('should get locations with position', async () => {
    const language = 'en'

    // test success (expect result)
    let res = await request(app)
      .get(`/api/locations-with-position/${language}`)
    expect(res.statusCode).toBe(200)
    expect(res.body.length).toBeGreaterThanOrEqual(1)

    // test success (expect no result)
    res = await request(app)
      .get('/api/locations-with-position/pt')
    expect(res.statusCode).toBe(200)
    expect(res.body.length).toBe(0)

    // test failure (wrong language)
    res = await request(app)
      .get('/api/locations-with-position/english')
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/check-location/:id', () => {
  it('should check a location', async () => {
    const token = await testHelper.signinAsAdmin()

    // test success (location related to a car)
    const supplierName = testHelper.getSupplierName()
    const supplierId = await testHelper.createSupplier(`${supplierName}@test.bookcars.ma`, supplierName)
    const car = new Car({
      name: 'BMW X1',
      supplier: supplierId,
      minimumAge: 21,
      locations: [LOCATION_ID],
      dailyPrice: 78,
      deposit: 950,
      available: false,
      type: bookcarsTypes.CarType.Diesel,
      gearbox: bookcarsTypes.GearboxType.Automatic,
      aircon: true,
      seats: 5,
      doors: 4,
      fuelPolicy: bookcarsTypes.FuelPolicy.FreeTank,
      mileage: -1,
      cancellation: 0,
      amendments: 0,
      theftProtection: 9,
      collisionDamageWaiver: 12,
      fullInsurance: 20,
      additionalDriver: 20,
      range: bookcarsTypes.CarRange.Midi,
    })
    await car.save()
    let res = await request(app)
      .get(`/api/check-location/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(200)

    // test success (location not related to a car)
    await Car.deleteOne({ _id: car._id })
    await testHelper.deleteSupplier(supplierId)
    res = await request(app)
      .get(`/api/check-location/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(204)

    // test success (location related to a child location)
    const childLocation = new Location({
      country: countryId,
      parentLocation: LOCATION_ID,
      values: [testHelper.GetRandromObjectIdAsString(), testHelper.GetRandromObjectIdAsString()]
    })
    await childLocation.save()
    res = await request(app)
      .get(`/api/check-location/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(200)
    await childLocation.deleteOne()

    // test failure (wrong location id)
    res = await request(app)
      .get(`/api/check-location/${nanoid()}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(400)

    await testHelper.signout(token)
  })
})

describe('DELETE /api/delete-location/:id', () => {
  it('should delete a location', async () => {
    const token = await testHelper.signinAsAdmin()

    // test success (LOCATION_ID)
    let location = await Location.findById(LOCATION_ID)
    expect(location).not.toBeNull()

    if (!location?.image) {
      const image = path.join(env.CDN_LOCATIONS, IMAGE0)
      if (!(await helper.pathExists(image))) {
        await asyncFs.copyFile(IMAGE0_PATH, image)
      }
      location!.image = IMAGE0
      await location!.save()
    }
    let res = await request(app)
      .delete(`/api/delete-location/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(200)
    location = await Location.findById(LOCATION_ID)
    expect(location).toBeNull()

    // test success (new location)
    let locationId = await testHelper.createLocation('loc1-en', 'loc1-fr')
    res = await request(app)
      .delete(`/api/delete-location/${locationId}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(200)

    // test success (image not found)
    locationId = await testHelper.createLocation('loc2-en', 'loc2-fr')
    location = await Location.findById(locationId)
    location!.image = `${nanoid()}.jpg`
    await location!.save()
    res = await request(app)
      .delete(`/api/delete-location/${locationId}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(200)

    // test success (location not found)
    res = await request(app)
      .delete(`/api/delete-location/${LOCATION_ID}`)
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(204)

    // test failure (wrong location id)
    res = await request(app)
      .delete('/api/delete-location/0')
      .set(env.X_ACCESS_TOKEN, token)
    expect(res.statusCode).toBe(400)

    await testHelper.signout(token)
  })
})

//
// H-043 regression (two-agency): a location's country must belong to the
// location's agency. A country with no supplier (legacy) is allowed.
// Admin creates for B on A's country -> 400, nothing persisted; owner B
// creates on A's country -> 400; own country -> 200; update re-pointing
// at a foreign country -> 400.
//
describe('H-043 country ownership (two-agency regression)', () => {
  let supplierAId: string
  let supplierBId: string
  let countryAId: string
  let countryBId: string
  let countryLegacyId: string
  let countryValueIds: string[] = []

  const createCountry = async (supplier?: string) => {
    const valueEn = new LocationValue({ language: 'en', value: `Country ${nanoid()}` })
    await valueEn.save()
    const valueFr = new LocationValue({ language: 'fr', value: `Pays ${nanoid()}` })
    await valueFr.save()
    countryValueIds.push(valueEn._id.toString(), valueFr._id.toString())
    const country = new Country({ values: [valueEn._id, valueFr._id], supplier })
    await country.save()
    return country._id.toString()
  }

  const deleteLocationAndValues = async (locationId: string) => {
    const location = await Location.findByIdAndDelete(locationId)
    if (location) {
      await LocationValue.deleteMany({ _id: { $in: location.values } })
    }
  }

  beforeAll(async () => {
    const nameA = testHelper.getSupplierName()
    supplierAId = await testHelper.createSupplier(`${nameA}@testA.bookcars.ma`, nameA)
    const nameB = testHelper.getSupplierName()
    supplierBId = await testHelper.createSupplier(`${nameB}@testB.bookcars.ma`, nameB)
    countryAId = await createCountry(supplierAId)
    countryBId = await createCountry(supplierBId)
    countryLegacyId = await createCountry()
  })

  afterAll(async () => {
    await Country.deleteMany({ _id: { $in: [countryAId, countryBId, countryLegacyId] } })
    await LocationValue.deleteMany({ _id: { $in: countryValueIds } })
    await testHelper.deleteSupplier(supplierAId)
    await testHelper.deleteSupplier(supplierBId)
  })

  it('should reject a country owned by another agency', async () => {
    const token = await testHelper.signinAsAdmin()
    const names: bookcarsTypes.LocationName[] = [
      { language: 'en', name: nanoid() },
      { language: 'fr', name: nanoid() },
    ]

    const locationsBefore = await Location.countDocuments()
    const valuesBefore = await LocationValue.countDocuments()

    // test failure (admin creates a location for agency B on agency A's country)
    let payload: bookcarsTypes.UpsertLocationPayload = {
      country: countryAId,
      names,
      latitude: 28.0268755,
      longitude: 1.6528399999999976,
      supplier: supplierBId,
    }
    let res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(400)
    // nothing persisted (no Location, no LocationValue, no ParkingSpot)
    expect(await Location.countDocuments()).toBe(locationsBefore)
    expect(await LocationValue.countDocuments()).toBe(valuesBefore)

    // test failure (owner B creates on agency A's country)
    const supplierBToken = await testHelper.generateToken(supplierBId)
    res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, supplierBToken)
      .send({ country: countryAId, names, latitude: 28.0268755, longitude: 1.6528399999999976 })
    expect(res.statusCode).toBe(400)
    expect(await Location.countDocuments()).toBe(locationsBefore)
    expect(await LocationValue.countDocuments()).toBe(valuesBefore)

    // test failure (malformed country id)
    payload = {
      country: 'not-a-country-id',
      names,
      latitude: 28.0268755,
      longitude: 1.6528399999999976,
      supplier: supplierAId,
    }
    res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(400)
    expect(await Location.countDocuments()).toBe(locationsBefore)

    // test success (legacy country with no supplier is allowed)
    payload = {
      country: countryLegacyId,
      names,
      latitude: 28.0268755,
      longitude: 1.6528399999999976,
      supplier: supplierBId,
    }
    res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(200)
    expect(res.body._id).toBeTruthy()
    await deleteLocationAndValues(res.body._id)

    // test success (own country) then update re-pointing at a foreign country
    payload = {
      country: countryAId,
      names,
      latitude: 28.0268755,
      longitude: 1.6528399999999976,
      supplier: supplierAId,
    }
    res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(payload)
    expect(res.statusCode).toBe(200)
    const locationId = res.body._id as string

    const updatePayload: bookcarsTypes.UpsertLocationPayload = {
      country: countryBId,
      names,
      latitude: 29.0268755,
      longitude: 2.6528399999999976,
    }
    res = await request(app)
      .put(`/api/update-location/${locationId}`)
      .set(env.X_ACCESS_TOKEN, token)
      .send(updatePayload)
    expect(res.statusCode).toBe(400)
    const unchanged = await Location.findById(locationId)
    expect(unchanged?.country.toString()).toBe(countryAId)

    // test success (update keeping the own country)
    updatePayload.country = countryAId
    res = await request(app)
      .put(`/api/update-location/${locationId}`)
      .set(env.X_ACCESS_TOKEN, token)
      .send(updatePayload)
    expect(res.statusCode).toBe(200)
    expect(res.body?.country).toBe(countryAId)

    await deleteLocationAndValues(locationId)

    await testHelper.signout(token)
  })
})

//
// F5b (W2-20) — coordinate range validation
//
describe('F5b (W2-20) coordinate range validation', () => {
  const freshNames = (): bookcarsTypes.LocationName[] => [
    { language: 'en', name: nanoid() },
    { language: 'fr', name: nanoid() },
  ]

  const buildCreatePayload = (overrides: Partial<bookcarsTypes.UpsertLocationPayload> = {}): bookcarsTypes.UpsertLocationPayload => ({
    country: countryId,
    names: freshNames(),
    latitude: 28.0268755,
    longitude: 1.6528,
    supplier: SUPPLIER_ID,
    ...overrides,
  })

  const deleteLocationAndValues = async (locationId: string) => {
    const location = await Location.findByIdAndDelete(locationId)
    if (location) {
      await LocationValue.deleteMany({ _id: { $in: location.values } })
    }
  }

  it('should reject a create with latitude above 90 and store nothing', async () => {
    const token = await testHelper.signinAsAdmin()
    const before = await Location.countDocuments()

    const res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(buildCreatePayload({ latitude: 91 }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toBe('Invalid latitude')
    expect(await Location.countDocuments()).toBe(before)

    await testHelper.signout(token)
  })

  it('should reject a create with longitude above 180 and store nothing', async () => {
    const token = await testHelper.signinAsAdmin()
    const before = await Location.countDocuments()

    const res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(buildCreatePayload({ longitude: 181 }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toBe('Invalid longitude')
    expect(await Location.countDocuments()).toBe(before)

    await testHelper.signout(token)
  })

  it('should accept a create at the latitude/longitude boundaries', async () => {
    const token = await testHelper.signinAsAdmin()

    const res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(buildCreatePayload({ latitude: -90, longitude: -180 }))
    expect(res.statusCode).toBe(200)
    expect(res.body?.latitude).toBe(-90)
    expect(res.body?.longitude).toBe(-180)

    await deleteLocationAndValues(res.body._id)

    await testHelper.signout(token)
  })

  it('should reject a create with a non-numeric latitude', async () => {
    const token = await testHelper.signinAsAdmin()
    const before = await Location.countDocuments()

    const res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(buildCreatePayload({ latitude: 'abc' as unknown as number }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toBe('Invalid latitude')
    expect(await Location.countDocuments()).toBe(before)

    await testHelper.signout(token)
  })

  it('should reject a create with an out-of-range parking-spot latitude and store nothing', async () => {
    const token = await testHelper.signinAsAdmin()
    const before = await Location.countDocuments()

    const res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(buildCreatePayload({
        parkingSpots: [{
          latitude: 100,
          longitude: 1.5,
          values: [{ language: 'en', value: 'Parking spot 1' }],
        }],
      }))
    expect(res.statusCode).toBe(400)
    expect(res.text).toBe('Invalid parking spot latitude at index 0')
    expect(await Location.countDocuments()).toBe(before)

    await testHelper.signout(token)
  })

  it('should accept a create with no coordinates', async () => {
    const token = await testHelper.signinAsAdmin()

    const res = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(buildCreatePayload({ latitude: undefined, longitude: undefined }))
    expect(res.statusCode).toBe(200)
    expect(res.body?._id).toBeTruthy()

    await deleteLocationAndValues(res.body._id)

    await testHelper.signout(token)
  })

  it('should reject an update with latitude above 90 and leave the stored value unchanged', async () => {
    const token = await testHelper.signinAsAdmin()

    const created = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(buildCreatePayload())
    expect(created.statusCode).toBe(200)
    const locationId = created.body._id as string

    const res = await request(app)
      .put(`/api/update-location/${locationId}`)
      .set(env.X_ACCESS_TOKEN, token)
      .send({
        country: countryId,
        names: freshNames(),
        latitude: 91,
        longitude: 1.6528,
      } as bookcarsTypes.UpsertLocationPayload)
    expect(res.statusCode).toBe(400)
    expect(res.text).toBe('Invalid latitude')
    const unchanged = await Location.findById(locationId)
    expect(unchanged?.latitude).toBe(28.0268755)

    await deleteLocationAndValues(locationId)

    await testHelper.signout(token)
  })

  it('should reject an update with an out-of-range parking-spot longitude', async () => {
    const token = await testHelper.signinAsAdmin()

    const created = await request(app)
      .post('/api/create-location')
      .set(env.X_ACCESS_TOKEN, token)
      .send(buildCreatePayload({
        parkingSpots: [{
          latitude: 28.1,
          longitude: 1.7,
          values: [{ language: 'en', value: 'Parking spot 1' }],
        }],
      }))
    expect(created.statusCode).toBe(200)
    const locationId = created.body._id as string
    const storedBefore = await Location.findById(locationId)
    expect(storedBefore?.parkingSpots.length).toBe(1)

    const res = await request(app)
      .put(`/api/update-location/${locationId}`)
      .set(env.X_ACCESS_TOKEN, token)
      .send({
        country: countryId,
        names: freshNames(),
        latitude: 28.0268755,
        longitude: 1.6528,
        parkingSpots: [{
          latitude: 28.1,
          longitude: 200,
          values: [{ language: 'en', value: 'Parking spot 1' }],
        }],
      } as bookcarsTypes.UpsertLocationPayload)
    expect(res.statusCode).toBe(400)
    expect(res.text).toBe('Invalid parking spot longitude at index 0')
    const unchanged = await Location.findById(locationId)
    expect(unchanged?.parkingSpots.length).toBe(1)

    await deleteLocationAndValues(locationId)

    await testHelper.signout(token)
  })
})
