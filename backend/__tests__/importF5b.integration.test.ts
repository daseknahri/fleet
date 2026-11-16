import 'dotenv/config'
import ExcelJS from 'exceljs'
import { nanoid } from 'nanoid'
import * as bookcarsTypes from ':bookcars-types'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as env from '../src/config/env.config'
import * as testHelper from './testHelper'
import { parseImportWorkbook, runImport, ImportFileError } from '../src/utils/importWorkbook'
import Car from '../src/models/Car'
import User from '../src/models/User'
import Token from '../src/models/Token'
import Location from '../src/models/Location'
import LocationValue from '../src/models/LocationValue'

let SUPPLIER_ID: string
let LOCATION_ID: string
let LOCATION_NAME_EN: string

const createdCarIds: string[] = []
const createdClientIds: string[] = []

const uniqueEmail = () => `f5b-import-${nanoid(8)}@test.bookcars.ma`
const uniquePlate = () => `IMP-${nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`
const uniquePassport = () => `P${nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`

// The actor runImport passes through to the handlers: the admin user
// (loaded from the DB by the handlers) plus the agency the import
// runs under — the same pair importController passes in production.
const actor = () => ({
  user: { _id: testHelper.getAdminUserId(), type: bookcarsTypes.UserType.Admin },
  agency: { supplierId: SUPPLIER_ID, role: 'admin' },
})

const buildWorkbook = async (headers: string[], rows: unknown[][]): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Data')
  sheet.addRow(headers)
  for (const row of rows) {
    sheet.addRow(row)
  }
  const out = await workbook.xlsx.writeBuffer()
  return Buffer.from(out as unknown as ArrayBuffer)
}

//
// Connecting and initializing the database before running the test suite
//
beforeAll(async () => {
  testHelper.initializeLogger()

  await databaseHelper.connect(env.DB_URI, false, false)

  await testHelper.initialize()

  const supplierName = testHelper.getSupplierName()
  SUPPLIER_ID = await testHelper.createSupplier(`${supplierName}@test.bookcars.ma`, supplierName)

  LOCATION_NAME_EN = `F5B Import Loc ${nanoid(6)}`
  LOCATION_ID = await testHelper.createLocation(LOCATION_NAME_EN, `F5B Import Loc FR ${nanoid(6)}`)
})

//
// Closing and cleaning the database connection after running the test suite
//
afterAll(async () => {
  await Car.deleteMany({ _id: { $in: createdCarIds } })
  await Token.deleteMany({ user: { $in: createdClientIds } })
  await User.deleteMany({ _id: { $in: createdClientIds } })

  const location = await Location.findByIdAndDelete(LOCATION_ID)
  if (location) {
    await LocationValue.deleteMany({ _id: { $in: location.values } })
  }

  await testHelper.deleteSupplier(SUPPLIER_ID)

  await testHelper.close()
  await databaseHelper.close()
})

//
// W2-21 — header alias resolution (pure parseImportWorkbook)
//
describe('W2-21 header aliases', () => {
  it('resolves aliased car headers to the canonical columns', async () => {
    const buffer = await buildWorkbook(
      ['Name', 'License Plate', 'Locations', 'Daily Price', 'Deposit', 'Odometer', 'Insurance Provider'],
      [['Dacia Logan', 'ALIAS-001', LOCATION_NAME_EN, '300', '5000', '45200', 'AtlantaSanad']],
    )
    const rows = await parseImportWorkbook(buffer, 'cars')
    expect(rows.length).toBe(1)
    expect(rows[0].values.name).toBe('Dacia Logan')
    expect(rows[0].values.licensePlate).toBe('ALIAS-001')
    expect(rows[0].values.locations).toBe(LOCATION_NAME_EN)
    expect(rows[0].values.dailyPrice).toBe('300')
    expect(rows[0].values.deposit).toBe('5000')
    expect(rows[0].values.odometerKm).toBe('45200')
    expect(rows[0].values.insuranceProvider).toBe('AtlantaSanad')
  })

  it('resolves aliased client headers to the canonical columns', async () => {
    const buffer = await buildWorkbook(
      ['Full Name', 'E-mail', 'CIN', 'Date of Birth', 'Consent'],
      [['Sara Bennani', 'sara@example.invalid', 'AB123456', '1990-05-17', 'yes']],
    )
    const rows = await parseImportWorkbook(buffer, 'clients')
    expect(rows.length).toBe(1)
    expect(rows[0].values.fullName).toBe('Sara Bennani')
    expect(rows[0].values.email).toBe('sara@example.invalid')
    expect(rows[0].values.cinNumber).toBe('AB123456')
    expect(rows[0].values.birthDate).toBe('1990-05-17')
    expect(rows[0].values.consentGiven).toBe('yes')
  })

  it('resolves aliased booking headers to the canonical columns', async () => {
    const buffer = await buildWorkbook(
      ['Car Plate', 'Client Email', 'Start Date', 'Return Date', 'Total'],
      [['ALIAS-001', 'sara@example.invalid', '2026-12-01', '2026-12-04', '900']],
    )
    const rows = await parseImportWorkbook(buffer, 'bookings')
    expect(rows.length).toBe(1)
    expect(rows[0].values.carPlate).toBe('ALIAS-001')
    expect(rows[0].values.clientEmail).toBe('sara@example.invalid')
    expect(rows[0].values.from).toBe('2026-12-01')
    expect(rows[0].values.to).toBe('2026-12-04')
    expect(rows[0].values.price).toBe('900')
  })

  it('resolves aliased expense headers to the canonical columns', async () => {
    const buffer = await buildWorkbook(
      ['Expense Date', 'Plate', 'Type', 'Total', 'Paid', 'Supplier'],
      [['2026-12-01', 'ALIAS-001', 'fuel', '500', '500', 'Example Fuel Station']],
    )
    const rows = await parseImportWorkbook(buffer, 'expenses')
    expect(rows.length).toBe(1)
    expect(rows[0].values.date).toBe('2026-12-01')
    expect(rows[0].values.carPlate).toBe('ALIAS-001')
    expect(rows[0].values.category).toBe('fuel')
    expect(rows[0].values.amount).toBe('500')
    expect(rows[0].values.paidAmount).toBe('500')
    expect(rows[0].values.vendor).toBe('Example Fuel Station')
  })

  it('still accepts the canonical template headers', async () => {
    const buffer = await buildWorkbook(
      ['name', 'licensePlate', 'locations', 'dailyPrice', 'deposit'],
      [['Dacia Logan', 'CANON-001', LOCATION_NAME_EN, '300', '5000']],
    )
    const rows = await parseImportWorkbook(buffer, 'cars')
    expect(rows.length).toBe(1)
    expect(rows[0].values.licensePlate).toBe('CANON-001')
  })

  it('lists the headers actually found when a required column is missing', async () => {
    const buffer = await buildWorkbook(
      ['Name', 'Locations', 'Daily Price', 'Deposit'],
      [['Dacia Logan', LOCATION_NAME_EN, '300', '5000']],
    )
    await expect(parseImportWorkbook(buffer, 'cars')).rejects.toThrow(ImportFileError)
    await expect(parseImportWorkbook(buffer, 'cars')).rejects.toThrow(
      'Missing required column: licensePlate (columns found: Name, Locations, Daily Price, Deposit)',
    )
  })

  it('ignores unknown headers and lets the first duplicate win', async () => {
    const buffer = await buildWorkbook(
      ['name', 'licensePlate', 'License Plate', 'Random Column', 'locations', 'dailyPrice', 'deposit'],
      [['Dacia Logan', 'FIRST-001', 'SECOND-001', 'ignored', LOCATION_NAME_EN, '300', '5000']],
    )
    const rows = await parseImportWorkbook(buffer, 'cars')
    expect(rows.length).toBe(1)
    expect(rows[0].values.licensePlate).toBe('FIRST-001')
    expect(rows[0].values.randomcolumn).toBeUndefined()
  })
})

//
// W2-21 — aliased headers end to end (car import incl. the F5b-2 columns)
// W2-15 — rollback on a commit-phase failure
//
describe('W2-21 + W2-15 runImport', () => {
  it('imports cars through aliased headers with the F5b-2 columns, and does not roll back a clean commit', async () => {
    const plate1 = uniquePlate()
    const plate2 = uniquePlate()
    const buffer = await buildWorkbook(
      ['Name', 'License Plate', 'Locations', 'Daily Price', 'Deposit', 'Make', 'Model', 'Year', 'Odometer', 'Insurance Provider', 'Insurance Policy Number'],
      [
        ['Dacia Logan', plate1, LOCATION_NAME_EN, '300', '5000', 'Dacia', 'Logan', '2021', '45200', 'AtlantaSanad', 'POL-2026-001'],
        ['Renault Clio', plate2, LOCATION_NAME_EN, '280', '4000', 'Renault', 'Clio', '2022', '30100', 'AtlantaSanad', 'POL-2026-002'],
      ],
    )

    const dry = await runImport('cars', buffer, true, SUPPLIER_ID, actor())
    expect(dry.dryRun).toBe(true)
    expect(dry.totalRows).toBe(2)
    expect(dry.validRows).toBe(2)
    expect(dry.created).toBe(0)
    expect(dry.rolledBack).toBeFalsy()
    expect(await Car.countDocuments({ supplier: SUPPLIER_ID, licensePlate: { $in: [plate1, plate2] } })).toBe(0)

    const report = await runImport('cars', buffer, false, SUPPLIER_ID, actor())
    expect(report.dryRun).toBe(false)
    expect(report.totalRows).toBe(2)
    expect(report.validRows).toBe(2)
    expect(report.invalidRows).toBe(0)
    expect(report.created).toBe(2)
    expect(report.rolledBack).toBeFalsy()
    expect(report.errors).toEqual([])

    const cars = await Car.find({ supplier: SUPPLIER_ID, licensePlate: { $in: [plate1, plate2] } }).lean()
    expect(cars.length).toBe(2)
    const logan = cars.find((c) => c.licensePlate === plate1)!
    expect(logan.make).toBe('Dacia')
    expect(logan.model).toBe('Logan')
    expect(logan.year).toBe(2021)
    expect(logan.odometerKm).toBe(45200)
    expect(logan.insuranceProvider).toBe('AtlantaSanad')
    expect(logan.insurancePolicyNumber).toBe('POL-2026-001')
    for (const car of cars) {
      createdCarIds.push(car._id.toString())
    }
  })

  it('imports clients through aliased headers and scopes them to the agency', async () => {
    const email = uniqueEmail()
    const buffer = await buildWorkbook(
      ['Full Name', 'E-mail', 'Phone', 'Company', 'Consent'],
      [['Sara Bennani', email, '0600000000', '', 'yes']],
    )
    const report = await runImport('clients', buffer, false, SUPPLIER_ID, actor())
    expect(report.created).toBe(1)
    expect(report.rolledBack).toBeFalsy()
    expect(report.errors).toEqual([])

    const stored = await User.findOne({ email }).lean()
    expect(stored).toBeTruthy()
    expect(stored?.supplier?.toString()).toBe(SUPPLIER_ID)
    expect(stored?.consentGiven).toBe(true)
    if (stored?._id) {
      createdClientIds.push(stored._id.toString())
    }
  })

  it('rolls back a client import when a later row fails at commit (duplicate passport)', async () => {
    const email1 = uniqueEmail()
    const email2 = uniqueEmail()
    const passport = uniquePassport()
    const buffer = await buildWorkbook(
      ['fullName', 'email', 'passportNumber'],
      [
        ['First Client', email1, passport],
        ['Second Client', email2, passport],
      ],
    )
    // Both rows pass validation — validateClients checks email + CIN
    // duplicates only, not passport — so the failure surfaces at
    // commit time, inside userController.create (W2-07).
    const dry = await runImport('clients', buffer, true, SUPPLIER_ID, actor())
    expect(dry.validRows).toBe(2)
    expect(dry.created).toBe(0)
    expect(dry.rolledBack).toBeFalsy()

    const tokensBefore = await Token.countDocuments()
    const report = await runImport('clients', buffer, false, SUPPLIER_ID, actor())
    expect(report.rolledBack).toBe(true)
    expect(report.created).toBe(0)
    expect(report.validRows).toBe(0)
    expect(report.invalidRows).toBe(2)
    expect(report.errors.some((e) => e.row === 3 && /passport/i.test(e.message))).toBe(true)
    expect(report.errors.some((e) => /rolled back/i.test(e.message))).toBe(true)

    // Nothing from the file was kept: the first row's client is gone…
    expect(await User.findOne({ email: email1 }).lean()).toBeNull()
    expect(await User.findOne({ email: email2 }).lean()).toBeNull()
    // …and its activation Token went with it.
    expect(await Token.countDocuments()).toBe(tokensBefore)
  })

  it('does not roll back when every row fails validation (nothing was created)', async () => {
    const buffer = await buildWorkbook(
      ['fullName', 'email'],
      [
        ['', 'not-an-email'],
        ['', 'also-not-an-email'],
      ],
    )
    const report = await runImport('clients', buffer, false, SUPPLIER_ID, actor())
    expect(report.created).toBe(0)
    expect(report.validRows).toBe(0)
    expect(report.invalidRows).toBe(2)
    expect(report.rolledBack).toBeFalsy()
    expect(report.errors.length).toBeGreaterThan(0)
  })
})
