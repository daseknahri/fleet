import ExcelJS from 'exceljs'
import mongoose from 'mongoose'
import path from 'node:path'
import asyncFs from 'node:fs/promises'
import validator from 'validator'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Car from '../models/Car'
import User from '../models/User'
import Token from '../models/Token'
import Booking from '../models/Booking'
import Invoice from '../models/Invoice'
import Location from '../models/Location'
import MaintenanceWorkOrder from '../models/MaintenanceWorkOrder'
import { BOOKING_RESERVATION_STATUSES } from './bookingReservationHelper'
import { normalizeClientIdentityFields } from './clientIdentity'
import {
  validateLocationsForSupplier,
  invalidFinancingOrDocumentField,
  invalidCarIdentityField,
  normalizeFinancing,
  normalizeDocumentDate,
} from '../controllers/carController'
import * as bookingController from '../controllers/bookingController'
import * as userController from '../controllers/userController'
import * as maintenanceExpenseController from '../controllers/maintenanceExpenseController'
import MaintenanceExpense from '../models/MaintenanceExpense'

/**
 * GA-PAR-15 — Excel (.xlsx) imports for cars, clients and bookings
 * (scorecard row #5).
 *
 * Discipline (repo migration rules): dry-run first. A dry run validates
 * EVERYTHING and persists NOTHING. A commit re-validates from scratch
 * (no dry-run token is trusted) and persists only the valid rows;
 * invalid rows are skipped and reported with their spreadsheet row
 * number (1-based, header = row 1, first data row = row 2).
 * F5b (W2-15): a commit is all-or-nothing — the loop stops at the
 * first commit-phase failure and every row created so far in the run
 * is removed by compensating deletes (rollback), so a failed import
 * leaves nothing behind. Rows that fail validation are still skipped
 * and reported without touching the database.
 *
 * Creation paths — NO raw inserts and no forked rules:
 * - bookings are created by literally invoking bookingController.create
 *   with a captured req/res, so the PAR-04 blocked-client guard, the
 *   PAR-02 reference allocation (atomic Counter), the reservation
 *   helper's availability check and the PAR-05 auto-draft invoice hook
 *   all fire exactly as for a UI-created booking. Imports never supply
 *   an overlapException: a conflicting row is an error row, full stop.
 * - clients are created by literally invoking userController.create the
 *   same way (PAR-04 identity normalisation, supplier scoping and the
 *   verified/blacklisted defaults all come from the handler itself).
 * - expenses (GA-PAR-16, the 4th entity) are created by literally
 *   invoking maintenanceExpenseController.create the same way, so the
 *   shared enum validation, the paidAmount bounds (0 <= paidAmount <=
 *   amount), the optional-car/general-expense rule and the agency
 *   scoping all come from the handler itself. N11: importing an
 *   `agents`-category expense is a MANUAL category entry only — agent
 *   settlements (PAR-07) never flow into expenses and nothing here
 *   creates expenses automatically from settlements.
 * - cars cannot use carController.create (it is file-shaped: it demands
 *   an uploaded temp image, which an import row does not have), so the
 *   importer builds the Car through the SAME exported validators and
 *   normalisers the controller uses (validateLocationsForSupplier,
 *   invalidFinancingOrDocumentField, normalizeFinancing,
 *   normalizeDocumentDate) plus the Car model's own schema validation.
 *   Imported cars carry no image — `image` is optional in the schema;
 *   only the UI create flow requires one.
 *
 * Agency scope ALWAYS comes from the authenticated session (the agency
 * context resolved by the permission middleware), never from the file.
 */

export const IMPORT_MAX_ROWS = 1000
export const IMPORT_MAX_FILE_SIZE = 5 * 1024 * 1024

export type ImportEntity = 'cars' | 'clients' | 'bookings' | 'expenses'

export interface ImportRowError {
  row: number
  field?: string
  message: string
}

export interface ImportReport {
  entity: ImportEntity
  dryRun: boolean
  totalRows: number
  validRows: number
  invalidRows: number
  created: number
  errors: ImportRowError[]
  /** F5b (W2-15): true when a commit-phase failure stopped the run and the rows created so far were rolled back (created is then 0, unless a rollback delete failed — see the report errors). */
  rolledBack?: boolean
}

export class ImportFileError extends Error {}

// ---------------------------------------------------------------------------
// Column specifications — the template headers are EXACTLY these names.
// ---------------------------------------------------------------------------

export interface ColumnSpec {
  name: string
  required?: boolean
}

export const IMPORT_COLUMNS: Record<ImportEntity, ColumnSpec[]> = {
  cars: [
    { name: 'name', required: true },
    { name: 'licensePlate', required: true },
    { name: 'locations', required: true },
    { name: 'dailyPrice', required: true },
    { name: 'deposit', required: true },
    { name: 'minimumAge' },
    { name: 'type' },
    { name: 'gearbox' },
    { name: 'seats' },
    { name: 'doors' },
    { name: 'fuelPolicy' },
    { name: 'range' },
    { name: 'aircon' },
    { name: 'mileage' },
    { name: 'cancellation' },
    { name: 'amendments' },
    { name: 'theftProtection' },
    { name: 'collisionDamageWaiver' },
    { name: 'fullInsurance' },
    { name: 'additionalDriver' },
    { name: 'tankCapacityLitres' },
    { name: 'insuranceExpiryDate' },
    { name: 'technicalInspectionExpiryDate' },
    { name: 'vignetteExpiryDate' },
    // F5b (W2-12/W2-13/W2-19): vehicle identity + odometer + insurance
    // policy (all optional).
    { name: 'make' },
    { name: 'model' },
    { name: 'year' },
    { name: 'odometerKm' },
    { name: 'insuranceProvider' },
    { name: 'insurancePolicyNumber' },
  ],
  clients: [
    { name: 'fullName', required: true },
    { name: 'email', required: true },
    { name: 'phone' },
    { name: 'birthDate' },
    { name: 'cinNumber' },
    { name: 'cinExpiry' },
    { name: 'passportNumber' },
    { name: 'passportExpiry' },
    { name: 'licenseNumber' },
    { name: 'licenseExpiry' },
    { name: 'clientType' },
    { name: 'clientStatus' },
    { name: 'companyName' },
    { name: 'companyRegistration' },
    { name: 'companyContactName' },
    { name: 'consentGiven' },
    { name: 'consentScope' },
  ],
  bookings: [
    { name: 'carPlate', required: true },
    { name: 'clientEmail', required: true },
    { name: 'from', required: true },
    { name: 'to', required: true },
    { name: 'price', required: true },
    { name: 'status' },
  ],
  // GA-PAR-16 — expense import columns (task spec order).
  expenses: [
    { name: 'date', required: true },
    { name: 'carPlate' },
    { name: 'category', required: true },
    { name: 'amount', required: true },
    { name: 'paidAmount' },
    { name: 'vendor' },
    { name: 'note' },
    { name: 'mileage' },
  ],
}

const EXAMPLES: Record<ImportEntity, Record<string, string>> = {
  cars: {
    name: 'EXAMPLE — Dacia Logan (delete or ignore: examples live on this sheet only)',
    licensePlate: 'EXAMPLE-001',
    locations: 'Casablanca Airport',
    dailyPrice: '300',
    deposit: '5000',
    minimumAge: '21',
    type: 'diesel',
    gearbox: 'manual',
    seats: '5',
    doors: '4',
    fuelPolicy: 'likeForlike',
    range: 'mini',
    aircon: 'true',
    mileage: '-1',
    cancellation: '-1',
    amendments: '-1',
    theftProtection: '-1',
    collisionDamageWaiver: '-1',
    fullInsurance: '-1',
    additionalDriver: '-1',
    tankCapacityLitres: '50',
    insuranceExpiryDate: '2027-01-31',
    technicalInspectionExpiryDate: '2026-12-31',
    vignetteExpiryDate: '2027-01-31',
    make: 'Dacia',
    model: 'Logan',
    year: '2021',
    odometerKm: '45200',
    insuranceProvider: 'AtlantaSanad',
    insurancePolicyNumber: 'POL-2026-001',
  },
  clients: {
    fullName: 'EXAMPLE — Sara Bennani (examples live on this sheet only)',
    email: 'example.client@example.invalid',
    phone: '+212600000000',
    birthDate: '1990-05-17',
    cinNumber: 'AB123456',
    cinExpiry: '2030-01-01',
    passportNumber: 'P1234567',
    passportExpiry: '2031-06-30',
    licenseNumber: 'LIC-12345',
    licenseExpiry: '2032-03-15',
    clientType: 'individual',
    clientStatus: 'active',
    companyName: '',
    companyRegistration: '',
    companyContactName: '',
    consentGiven: 'yes',
    consentScope: 'marketing',
  },
  bookings: {
    carPlate: 'EXAMPLE-001',
    clientEmail: 'example.client@example.invalid',
    from: '2026-12-01',
    to: '2026-12-04',
    price: '900',
    status: 'reserved',
  },
  expenses: {
    date: '2026-12-01',
    carPlate: 'EXAMPLE-001',
    category: 'fuel',
    amount: '500',
    paidAmount: '500',
    vendor: 'Example Fuel Station',
    note: 'Example expense (examples live on this sheet only)',
    mileage: '120000',
  },
}

const NOTES: Record<ImportEntity, string[]> = {
  cars: [
    'Fill the "Data" sheet only — this "Example" sheet is never imported.',
    'Required columns: name, licensePlate, locations, dailyPrice, deposit.',
    'locations: one or more location names of this agency, separated by semicolons (;). An unknown or ambiguous name is a row error.',
    'licensePlate must be unique within this agency (the same plate under another agency is fine). Duplicates inside the file are row errors.',
    'Defaults when a cell is empty: minimumAge 21, type diesel, gearbox automatic, seats 5, doors 4, fuelPolicy likeForlike, range midi, aircon true, mileage/cancellation/amendments/theftProtection/collisionDamageWaiver/fullInsurance/additionalDriver -1 (unlimited / included as in the car form).',
    'type: diesel | gasoline | electric | hybrid | plugInHybrid | unknown. gearbox: manual | automatic. fuelPolicy: likeForlike | freeTank | fullToFull | FullToEmpty. range: mini | midi | maxi | scooter | bus | truck | caravan.',
    'Dates use YYYY-MM-DD. Maximum 1000 data rows per file.',
  ],
  clients: [
    'Fill the "Data" sheet only — this "Example" sheet is never imported.',
    'Required columns: fullName, email.',
    'email and cinNumber (when provided) must be unique within this agency; duplicates — in the agency or inside the file — are row errors. Rows are never merged or updated.',
    'clientType: individual | company. clientStatus: active | underReview | blocked.',
    'Company clients (clientType: company) need companyName. consentGiven: yes | no; consentScope: marketing, processing (comma-separated).',
    'Dates (birthDate and the identity expiry dates) use YYYY-MM-DD. Maximum 1000 data rows per file.',
    'Imported clients are created exactly like back-office clients (unverified, no password): they can be activated / given access later from the Clients page.',
  ],
  bookings: [
    'Fill the "Data" sheet only — this "Example" sheet is never imported.',
    'Required columns: carPlate, clientEmail, from, to, price.',
    'carPlate and clientEmail are resolved within THIS agency only. An unknown plate or email is a row error; a client that belongs to another agency is reported as unknown and is never linked.',
    'from / to: YYYY-MM-DD (09:00 Africa/Casablanca), YYYY-MM-DD HH:mm (Africa/Casablanca wall-clock), a full ISO datetime, or an Excel date cell. price is the total rental price in MAD.',
    'status: reserved | pending (default reserved). Payment statuses cannot be imported.',
    'Pickup and drop-off locations are the car\'s first location. Blocked clients and date conflicts are row errors — imports never apply an overlap exception. Maximum 1000 data rows per file.',
  ],
  expenses: [
    'Fill the "Data" sheet only — this "Example" sheet is never imported.',
    'Required columns: date, category, amount. carPlate may be left blank for a general expense (not tied to a car).',
    'carPlate is resolved within THIS agency only; an unknown plate is a row error.',
    'category is one of the expense category keys: maintenance, repair, cleaning, fuel, insurance, other, oil, tyres, battery, vignette, visiteTechnique, adBlue, fines, loanPayment, rent, salaries, agents, accounting, bankFees, bodywork, glass, electrical, airConditioning, exhaust.',
    'amount must be > 0. paidAmount may be left blank (untracked); when given it must satisfy 0 <= paidAmount <= amount.',
    'Duplicate control: a row identical in (date, car-or-general, category, amount) to an existing expense of this agency or to an earlier row of this file is reported as a possible duplicate and is not imported.',
    'Dates use YYYY-MM-DD. Maximum 1000 data rows per file.',
  ],
}

// ---------------------------------------------------------------------------
// Workbook parsing / template generation
// ---------------------------------------------------------------------------

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'object') {
    const obj = value as { richText?: { text: string }[], text?: string, result?: unknown }
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((part) => part.text || '').join('')
    }
    if (typeof obj.text === 'string') {
      return obj.text
    }
    if (obj.result !== undefined) {
      return cellText(obj.result)
    }
    return ''
  }
  return String(value).trim()
}

export interface ParsedRow {
  row: number
  values: Record<string, unknown>
}

/**
 * F5b (W2-21): header normalisation — lower-case, separators
 * (spaces, underscores, hyphens) stripped, so "License Plate",
 * "license_plate" and "licensePlate" all normalise to "licenseplate".
 */
const normalizeHeader = (name: string): string => name.trim().toLowerCase().replace(/[\s_-]+/g, '')

/**
 * F5b (W2-21): per-entity header aliases, in normalised form (see
 * normalizeHeader). A header matches a spec column when it equals the
 * canonical name or one of its aliases after normalisation.
 * Canonical names win over aliases and the first alias wins: the
 * resolver checks canonicals first, then aliases in spec order.
 * Unknown headers are still ignored — only spec columns are read.
 */
const HEADER_ALIASES: Record<ImportEntity, Record<string, string[]>> = {
  cars: {
    licensePlate: ['plate', 'platenumber', 'registration', 'registrationplate', 'registrationnumber'],
    name: ['carname', 'vehiclename'],
    locations: ['location', 'locationname', 'locationnames'],
    dailyPrice: ['priceperday', 'dayprice'],
    deposit: ['caution'],
    minimumAge: ['minimumage', 'minage'],
    type: ['cartype', 'vehicletype'],
    gearbox: ['transmission'],
    seats: ['seat'],
    doors: ['door'],
    aircon: ['airconditioning', 'ac'],
    mileage: ['mileageallowance', 'kmperday', 'dailymileage'],
    tankCapacityLitres: ['tankcapacity', 'tank'],
    make: ['brand', 'marque'],
    odometerKm: ['odometer', 'mileagekm', 'km', 'kilometrage'],
    insuranceProvider: ['insurer', 'insurancecompany'],
    insurancePolicyNumber: ['policynumber', 'policy'],
    insuranceExpiryDate: ['insuranceexpiry', 'insuranceexpiration'],
    technicalInspectionExpiryDate: ['technicalinspectionexpiry', 'inspectionexpiry'],
    vignetteExpiryDate: ['vignetteexpiry'],
  },
  clients: {
    fullName: ['fullname', 'name', 'customername', 'clientname', 'customer'],
    email: ['mail', 'emailaddress'],
    phone: ['telephone', 'tel', 'mobile', 'phonenumber'],
    birthDate: ['birthdate', 'dateofbirth', 'dob'],
    cinNumber: ['cin', 'idnumber', 'nationalid'],
    cinExpiry: ['cinexpiry', 'cinexpiration'],
    passportNumber: ['passport', 'passportno'],
    passportExpiry: ['passportexpiry', 'passportexpiration'],
    licenseNumber: ['license', 'licenseno', 'drivinglicense', 'driverlicense', 'permit'],
    licenseExpiry: ['licenseexpiry', 'licenseexpiration'],
    clientType: ['type', 'customertype'],
    clientStatus: ['status'],
    companyName: ['company', 'businessname'],
    companyRegistration: ['registrationnumber', 'rc'],
    companyContactName: ['companycontact', 'contactname'],
    consentGiven: ['consent', 'gdprconsent'],
    consentScope: ['consentpurposes'],
  },
  bookings: {
    carPlate: ['plate', 'licenseplate', 'vehicle'],
    clientEmail: ['email', 'customeremail'],
    from: ['start', 'startdate', 'pickupdate', 'fromdate', 'departure'],
    to: ['end', 'enddate', 'returndate', 'todate'],
    price: ['totalprice', 'total', 'amount', 'rentalprice'],
    status: ['bookingstatus'],
  },
  expenses: {
    date: ['expensedate'],
    carPlate: ['plate', 'licenseplate', 'vehicle'],
    category: ['type', 'expensecategory', 'expensetype'],
    amount: ['total', 'totalamount', 'cost'],
    paidAmount: ['paid', 'amountpaid'],
    vendor: ['supplier', 'merchant', 'garage', 'provider'],
    note: ['notes', 'description', 'comment', 'details'],
    mileage: ['odometer', 'km'],
  },
}

/** Resolve one header cell to its canonical spec column name, or null. */
export const resolveImportHeader = (entity: ImportEntity, header: string): string | null => {
  const key = normalizeHeader(header)
  if (!key) {
    return null
  }
  const spec = IMPORT_COLUMNS[entity]
  const canonical = spec.find((col) => normalizeHeader(col.name) === key)
  if (canonical) {
    return canonical.name
  }
  const aliases = HEADER_ALIASES[entity]
  for (const col of spec) {
    if ((aliases[col.name] || []).includes(key)) {
      return col.name
    }
  }
  return null
}

export const parseImportWorkbook = async (buffer: Buffer, entity: ImportEntity): Promise<ParsedRow[]> => {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  } catch {
    throw new ImportFileError('The uploaded file is not a valid .xlsx workbook')
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) {
    throw new ImportFileError('The workbook has no worksheet')
  }
  const spec = IMPORT_COLUMNS[entity]
  const headerRow = sheet.getRow(1)
  const columnIndex = new Map<string, number>()
  const foundHeaders: string[] = []
  headerRow.eachCell((cell, colNumber) => {
    const name = cellText(cell.value)
    if (!name) {
      return
    }
    foundHeaders.push(name)
    // F5b (W2-21): a header matches by canonical name or alias.
    // First match wins: a duplicated/aliased header later in the row
    // does not displace the template column.
    const resolved = resolveImportHeader(entity, name)
    if (resolved && !columnIndex.has(resolved)) {
      columnIndex.set(resolved, colNumber)
    }
  })
  for (const col of spec) {
    if (col.required && !columnIndex.has(col.name)) {
      // F5b (W2-21): the missing-column error lists the headers that
      // were actually found, so a typo'd header is diagnosable.
      throw new ImportFileError(`Missing required column: ${col.name} (columns found: ${foundHeaders.join(', ') || '(none)'})`)
    }
  }
  const rows: ParsedRow[] = []
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r)
    const values: Record<string, unknown> = {}
    let empty = true
    for (const col of spec) {
      const idx = columnIndex.get(col.name)
      if (!idx) {
        continue
      }
      const raw = row.getCell(idx).value as unknown
      if (raw instanceof Date) {
        values[col.name] = raw
      } else {
        const text = cellText(raw)
        values[col.name] = text === '' ? undefined : (typeof raw === 'number' || typeof raw === 'boolean' ? raw : text)
      }
      if (values[col.name] !== undefined && values[col.name] !== '') {
        empty = false
      }
    }
    if (!empty) {
      rows.push({ row: r, values })
    }
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new ImportFileError(`File exceeds the maximum of ${IMPORT_MAX_ROWS} data rows (found ${rows.length}); nothing was processed`)
  }
  return rows
}

export const buildTemplateWorkbook = async (entity: ImportEntity): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook()
  const spec = IMPORT_COLUMNS[entity]
  const headers = spec.map((col) => col.name)
  const data = workbook.addWorksheet('Data')
  data.addRow(headers)
  data.getRow(1).font = { bold: true }
  const example = workbook.addWorksheet('Example')
  example.addRow(headers)
  example.getRow(1).font = { bold: true }
  example.addRow(headers.map((h) => EXAMPLES[entity][h] || ''))
  example.addRow([])
  for (const note of NOTES[entity]) {
    example.addRow([note])
  }
  const out = await workbook.xlsx.writeBuffer()
  return Buffer.from(out as unknown as ArrayBuffer)
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

const asText = (value: unknown): string => (value === undefined || value === null ? '' : String(value).trim())

const asNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value === 'number') {
    return value
  }
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : Number.NaN
}

const asBool = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value === 'boolean') {
    return value
  }
  const t = String(value).trim().toLowerCase()
  if (['true', 'yes', 'oui', '1'].includes(t)) {
    return true
  }
  if (['false', 'no', 'non', '0'].includes(t)) {
    return false
  }
  return undefined
}

const TZ = 'Africa/Casablanca'

const tzOffsetMs = (date: Date): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const p: Record<string, string> = {}
  for (const part of parts) {
    p[part.type] = part.value
  }
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second))
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** Africa/Casablanca wall-clock → UTC instant (the codebase's date basis). */
const casablancaWallToUtc = (y: number, mo: number, d: number, h: number, mi: number): Date => {
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  let utc = guess - tzOffsetMs(new Date(guess))
  const second = guess - tzOffsetMs(new Date(utc))
  if (second !== utc) {
    utc = second
  }
  return new Date(utc)
}

/**
 * Booking date cell: Excel Date (instant, as-is), ISO datetime (instant),
 * 'YYYY-MM-DD HH:mm' (Casablanca wall-clock) or 'YYYY-MM-DD' (09:00
 * Casablanca). Anything else is invalid.
 */
const parseBookingDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const t = asText(value)
  if (!t) {
    return null
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (m) {
    return casablancaWallToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 9, 0)
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t)
  if (m) {
    return casablancaWallToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]))
  }
  const parsed = new Date(t)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Date-only cell for identity / document dates (stored like the forms do). */
const parseDateOnly = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const t = asText(value)
  if (!t) {
    return null
  }
  const parsed = new Date(t)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// ---------------------------------------------------------------------------
// Captured handler invocation (bookings + clients creation-path reuse)
// ---------------------------------------------------------------------------

interface CapturedResult {
  status: number
  body: unknown
}

const invokeHandler = async (
  handler: (req: never, res: never) => Promise<void>,
  reqLike: Record<string, unknown>,
): Promise<CapturedResult> => {
  const captured: CapturedResult = { status: 200, body: undefined }
  const resLike = {
    status(code: number) {
      captured.status = code
      return this
    },
    send(body: unknown) {
      captured.body = body
      return this
    },
    json(body: unknown) {
      captured.body = body
      return this
    },
    // userController.create answers success with res.sendStatus(200) —
    // without this the handler saves, then throws into its own catch.
    sendStatus(code: number) {
      captured.status = code
      return this
    },
    setHeader() {
      return this
    },
    set() {
      return this
    },
    end() {
      return this
    },
  }
  await handler(reqLike as never, resLike as never)
  return captured
}

const handlerErrorMessage = (result: CapturedResult, fallback: string): string => {
  if (typeof result.body === 'string' && result.body.trim()) {
    return result.body.trim()
  }
  return fallback
}

// ---------------------------------------------------------------------------
// CARS
// ---------------------------------------------------------------------------

interface CarCandidate {
  row: number
  payload: Record<string, unknown>
  plateKey: string
}

const validateCars = async (
  rows: ParsedRow[],
  supplierId: string,
): Promise<{ candidates: CarCandidate[], errors: ImportRowError[] }> => {
  const errors: ImportRowError[] = []
  const candidates: CarCandidate[] = []
  const seenPlates = new Map<string, number>()

  // Agency-visible locations by name (supplier-owned or shared/global —
  // the same visibility rule validateLocationsForSupplier enforces).
  const locations = await Location.find({
    $or: [{ supplier: supplierId }, { supplier: null }, { supplier: { $exists: false } }],
  }).populate<{ values: { value: string }[] }>('values').lean()
  const locationByName = new Map<string, string[]>()
  for (const loc of locations) {
    for (const v of loc.values || []) {
      const key = String(v.value || '').trim().toLowerCase()
      if (!key) {
        continue
      }
      const list = locationByName.get(key) || []
      list.push(loc._id.toString())
      locationByName.set(key, list)
    }
  }

  const existingPlates = new Set(
    // GA-PAR-22: a trashed car's plate is free for reuse.
    (await Car.find({ supplier: supplierId, deletedAt: null }).select('licensePlate').lean())
      .map((c) => String(c.licensePlate || '').trim().toLowerCase())
      .filter(Boolean),
  )

  const enumCheck = (
    row: ParsedRow, field: string, allowed: readonly string[], errorsOut: ImportRowError[],
  ): string | undefined => {
    const raw = asText(row.values[field])
    if (!raw) {
      return undefined
    }
    if (!allowed.includes(raw)) {
      errorsOut.push({ row: row.row, field, message: `Invalid ${field}: "${raw}" (allowed: ${allowed.join(', ')})` })
      return undefined
    }
    return raw
  }

  for (const row of rows) {
    const rowErrors: ImportRowError[] = []
    const v = row.values
    const name = asText(v.name)
    const plate = asText(v.licensePlate)
    if (!name) {
      rowErrors.push({ row: row.row, field: 'name', message: 'Missing required field: name' })
    }
    if (!plate) {
      rowErrors.push({ row: row.row, field: 'licensePlate', message: 'Missing required field: licensePlate' })
    }
    const dailyPrice = asNumber(v.dailyPrice)
    if (v.dailyPrice === undefined) {
      rowErrors.push({ row: row.row, field: 'dailyPrice', message: 'Missing required field: dailyPrice' })
    } else if (dailyPrice === undefined || Number.isNaN(dailyPrice) || dailyPrice < 0) {
      rowErrors.push({ row: row.row, field: 'dailyPrice', message: `Invalid dailyPrice: "${asText(v.dailyPrice)}"` })
    }
    const deposit = asNumber(v.deposit)
    if (v.deposit === undefined) {
      rowErrors.push({ row: row.row, field: 'deposit', message: 'Missing required field: deposit' })
    } else if (deposit === undefined || Number.isNaN(deposit) || deposit < 0) {
      rowErrors.push({ row: row.row, field: 'deposit', message: `Invalid deposit: "${asText(v.deposit)}"` })
    }

    // locations: semicolon-separated names resolved within the agency
    const locationIds: string[] = []
    const locationNames = asText(v.locations).split(';').map((s) => s.trim()).filter(Boolean)
    if (locationNames.length === 0) {
      rowErrors.push({ row: row.row, field: 'locations', message: 'Missing required field: locations' })
    } else {
      for (const locName of locationNames) {
        const matches = [...new Set(locationByName.get(locName.toLowerCase()) || [])]
        if (matches.length === 0) {
          rowErrors.push({ row: row.row, field: 'locations', message: `Unknown location for this agency: "${locName}"` })
        } else if (matches.length > 1) {
          rowErrors.push({ row: row.row, field: 'locations', message: `Ambiguous location name for this agency: "${locName}"` })
        } else if (!locationIds.includes(matches[0])) {
          locationIds.push(matches[0])
        }
      }
    }

    const plateKey = plate.toLowerCase()
    if (plate) {
      if (existingPlates.has(plateKey)) {
        rowErrors.push({ row: row.row, field: 'licensePlate', message: `Plate already exists for this agency: "${plate}"` })
      } else if (seenPlates.has(plateKey)) {
        rowErrors.push({ row: row.row, field: 'licensePlate', message: `Duplicate plate in file: "${plate}" (first seen at row ${seenPlates.get(plateKey)})` })
      } else {
        seenPlates.set(plateKey, row.row)
      }
    }

    const type = enumCheck(row, 'type', Object.values(bookcarsTypes.CarType), rowErrors)
    const gearbox = enumCheck(row, 'gearbox', Object.values(bookcarsTypes.GearboxType), rowErrors)
    const fuelPolicy = enumCheck(row, 'fuelPolicy', Object.values(bookcarsTypes.FuelPolicy), rowErrors)
    const range = enumCheck(row, 'range', Object.values(bookcarsTypes.CarRange), rowErrors)

    const numeric = (field: string, opts: { integer?: boolean, min?: number } = {}): number | undefined => {
      if (v[field] === undefined) {
        return undefined
      }
      const n = asNumber(v[field])
      if (n === undefined || Number.isNaN(n) || (opts.integer && !Number.isInteger(n)) || (opts.min !== undefined && n < opts.min)) {
        rowErrors.push({ row: row.row, field, message: `Invalid ${field}: "${asText(v[field])}"` })
        return undefined
      }
      return n
    }
    const minimumAge = numeric('minimumAge', { integer: true })
    if (minimumAge !== undefined && (minimumAge < 18 || minimumAge > 99)) {
      rowErrors.push({ row: row.row, field: 'minimumAge', message: `Invalid minimumAge: ${minimumAge} (must be between 18 and 99)` })
    }
    const seats = numeric('seats', { integer: true })
    const doors = numeric('doors', { integer: true })
    const mileage = numeric('mileage')
    const cancellation = numeric('cancellation')
    const amendments = numeric('amendments')
    const theftProtection = numeric('theftProtection')
    const collisionDamageWaiver = numeric('collisionDamageWaiver')
    const fullInsurance = numeric('fullInsurance')
    const additionalDriverPrice = numeric('additionalDriver')
    const tankCapacityLitres = numeric('tankCapacityLitres', { min: 0 })
    // F5b (W2-12/W2-13/W2-19): vehicle identity + odometer + insurance
    // policy (all optional; same bounds as invalidCarIdentityField).
    const year = numeric('year', { integer: true })
    if (year !== undefined && (year < 1900 || year > new Date().getFullYear() + 1)) {
      rowErrors.push({ row: row.row, field: 'year', message: `Invalid year: ${year} (must be between 1900 and ${new Date().getFullYear() + 1})` })
    }
    const odometerKm = numeric('odometerKm', { min: 0 })
    for (const [field, max] of [['make', 100], ['model', 100], ['insuranceProvider', 200], ['insurancePolicyNumber', 100]] as const) {
      if (asText(v[field]).length > max) {
        rowErrors.push({ row: row.row, field, message: `Invalid ${field}: exceeds ${max} characters` })
      }
    }
    const aircon = v.aircon === undefined ? undefined : asBool(v.aircon)
    if (v.aircon !== undefined && aircon === undefined) {
      rowErrors.push({ row: row.row, field: 'aircon', message: `Invalid aircon: "${asText(v.aircon)}" (expected true/false)` })
    }
    for (const field of ['insuranceExpiryDate', 'technicalInspectionExpiryDate', 'vignetteExpiryDate'] as const) {
      if (v[field] !== undefined && !parseDateOnly(v[field])) {
        rowErrors.push({ row: row.row, field, message: `Invalid date for ${field}: "${asText(v[field])}" (expected YYYY-MM-DD)` })
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      continue
    }
    candidates.push({
      row: row.row,
      plateKey,
      payload: {
        name,
        licensePlate: plate,
        locations: locationIds,
        dailyPrice,
        deposit,
        minimumAge: minimumAge ?? 21,
        type: type ?? bookcarsTypes.CarType.Diesel,
        gearbox: gearbox ?? bookcarsTypes.GearboxType.Automatic,
        seats: seats ?? 5,
        doors: doors ?? 4,
        fuelPolicy: fuelPolicy ?? bookcarsTypes.FuelPolicy.LikeForLike,
        range: range ?? bookcarsTypes.CarRange.Midi,
        aircon: aircon ?? true,
        mileage: mileage ?? -1,
        cancellation: cancellation ?? -1,
        amendments: amendments ?? -1,
        theftProtection: theftProtection ?? -1,
        collisionDamageWaiver: collisionDamageWaiver ?? -1,
        fullInsurance: fullInsurance ?? -1,
        additionalDriver: additionalDriverPrice ?? -1,
        available: true,
        fullyBooked: false,
        comingSoon: false,
        isDateBasedPrice: false,
        dateBasedPrices: [],
        blockOnPay: true,
        ...(tankCapacityLitres !== undefined ? { tankCapacityLitres } : {}),
        // F5b (W2-12/W2-13/W2-19): identity + odometer + insurance
        // policy pass straight through to the Car document.
        ...(asText(v.make) ? { make: asText(v.make) } : {}),
        ...(asText(v.model) ? { model: asText(v.model) } : {}),
        ...(year !== undefined ? { year } : {}),
        ...(odometerKm !== undefined ? { odometerKm } : {}),
        ...(asText(v.insuranceProvider) ? { insuranceProvider: asText(v.insuranceProvider) } : {}),
        ...(asText(v.insurancePolicyNumber) ? { insurancePolicyNumber: asText(v.insurancePolicyNumber) } : {}),
        ...(v.insuranceExpiryDate !== undefined ? { insuranceExpiryDate: asText(v.insuranceExpiryDate) || v.insuranceExpiryDate } : {}),
        ...(v.technicalInspectionExpiryDate !== undefined ? { technicalInspectionExpiryDate: asText(v.technicalInspectionExpiryDate) || v.technicalInspectionExpiryDate } : {}),
        ...(v.vignetteExpiryDate !== undefined ? { vignetteExpiryDate: asText(v.vignetteExpiryDate) || v.vignetteExpiryDate } : {}),
      },
    })
  }
  return { candidates, errors }
}

/**
 * F5b (W2-15): on success returns the created car id (the rollback
 * record); on failure returns the row error, as before.
 */
const createCarFromImport = async (candidate: CarCandidate, supplierId: string): Promise<string | ImportRowError> => {
  const { payload } = candidate
  if (!(await validateLocationsForSupplier(payload.locations as string[], supplierId))) {
    return { row: candidate.row, field: 'locations', message: 'Invalid locations for supplier' }
  }
  const invalidField = invalidFinancingOrDocumentField(payload as never)
  if (invalidField) {
    return { row: candidate.row, field: invalidField, message: `Invalid ${invalidField}` }
  }
  // F5b (W2-12/W2-13/W2-19): identity + odometer + insurance policy
  // backstop (validateCars already checked them row by row).
  const invalidIdentity = invalidCarIdentityField(payload as unknown as Record<string, unknown>)
  if (invalidIdentity) {
    return { row: candidate.row, field: invalidIdentity, message: `Invalid ${invalidIdentity}` }
  }
  try {
    const car = new Car({
      ...payload,
      supplier: supplierId,
      financing: normalizeFinancing(undefined),
      insuranceExpiryDate: normalizeDocumentDate(payload.insuranceExpiryDate as string | undefined),
      technicalInspectionExpiryDate: normalizeDocumentDate(payload.technicalInspectionExpiryDate as string | undefined),
      vignetteExpiryDate: normalizeDocumentDate(payload.vignetteExpiryDate as string | undefined),
    })
    await car.save()
    return car._id.toString()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Car could not be created'
    return { row: candidate.row, message: `Car could not be created: ${message}`.slice(0, 300) }
  }
}

// ---------------------------------------------------------------------------
// CLIENTS
// ---------------------------------------------------------------------------

interface ClientCandidate {
  row: number
  body: Record<string, unknown>
}

const CLIENT_STRING_FIELDS = ['fullName', 'email', 'phone', 'cinNumber', 'passportNumber', 'licenseNumber', 'companyName', 'companyRegistration', 'companyContactName'] as const
const CLIENT_DATE_FIELDS = ['birthDate', 'cinExpiry', 'passportExpiry', 'licenseExpiry'] as const

const validateClients = async (
  rows: ParsedRow[],
  supplierId: string,
): Promise<{ candidates: ClientCandidate[], errors: ImportRowError[] }> => {
  const errors: ImportRowError[] = []
  const candidates: ClientCandidate[] = []
  const seenEmails = new Map<string, number>()
  const seenCins = new Map<string, number>()

  const agencyClients = await User.find({ supplier: supplierId, type: bookcarsTypes.UserType.User })
    .select('email cinNumber').lean()
  const existingEmails = new Set(agencyClients.map((c) => String(c.email || '').trim().toLowerCase()).filter(Boolean))
  const existingCins = new Set(agencyClients.map((c) => String(c.cinNumber || '').trim().toLowerCase()).filter(Boolean))

  for (const row of rows) {
    const rowErrors: ImportRowError[] = []
    const v = row.values
    const fullName = asText(v.fullName)
    const email = asText(v.email)
    if (!fullName) {
      rowErrors.push({ row: row.row, field: 'fullName', message: 'Missing required field: fullName' })
    }
    if (!email) {
      rowErrors.push({ row: row.row, field: 'email', message: 'Missing required field: email' })
    } else if (!validator.isEmail(email)) {
      rowErrors.push({ row: row.row, field: 'email', message: `Invalid email: "${email}"` })
    }
    const emailKey = email.toLowerCase()
    if (email) {
      if (existingEmails.has(emailKey)) {
        rowErrors.push({ row: row.row, field: 'email', message: `Client email already exists for this agency: "${email}"` })
      } else if (seenEmails.has(emailKey)) {
        rowErrors.push({ row: row.row, field: 'email', message: `Duplicate email in file: "${email}" (first seen at row ${seenEmails.get(emailKey)})` })
      } else {
        seenEmails.set(emailKey, row.row)
      }
    }
    const cin = asText(v.cinNumber)
    if (cin) {
      const cinKey = cin.toLowerCase()
      if (existingCins.has(cinKey)) {
        rowErrors.push({ row: row.row, field: 'cinNumber', message: `CIN already exists for this agency: "${cin}"` })
      } else if (seenCins.has(cinKey)) {
        rowErrors.push({ row: row.row, field: 'cinNumber', message: `Duplicate CIN in file: "${cin}" (first seen at row ${seenCins.get(cinKey)})` })
      } else {
        seenCins.set(cinKey, row.row)
      }
    }
    for (const field of CLIENT_DATE_FIELDS) {
      if (v[field] !== undefined && !parseDateOnly(v[field])) {
        rowErrors.push({ row: row.row, field, message: `Invalid date for ${field}: "${asText(v[field])}" (expected YYYY-MM-DD)` })
      }
    }
    // PAR-04 identity validation is reused verbatim (enums, lengths, dates).
    // F5b (W2-18 / W2-05): company + consent fields go through the same
    // normaliser (consentGiven accepts yes/no; consentScope a
    // comma-separated list).
    const identityProbe: Record<string, unknown> = {}
    for (const key of ['cinNumber', 'cinExpiry', 'passportNumber', 'passportExpiry', 'licenseNumber', 'licenseExpiry', 'clientType', 'clientStatus', 'companyName', 'companyRegistration', 'companyContactName', 'consentGiven', 'consentScope']) {
      if (v[key] !== undefined) {
        identityProbe[key] = v[key] instanceof Date ? (v[key] as Date).toISOString() : asText(v[key])
      }
    }
    const identity = normalizeClientIdentityFields(identityProbe)
    if (!identity.ok) {
      rowErrors.push({ row: row.row, field: identity.field, message: identity.error })
    }
    // F5b (W2-18): a company row needs a company name.
    if (asText(v.clientType).toLowerCase() === bookcarsTypes.ClientType.Company && !asText(v.companyName)) {
      rowErrors.push({ row: row.row, field: 'companyName', message: 'Company name is required for company clients' })
    }
    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      continue
    }
    const body: Record<string, unknown> = {
      type: bookcarsTypes.UserType.User,
      language: 'fr',
      fullName,
      email,
    }
    for (const field of CLIENT_STRING_FIELDS) {
      if (field !== 'fullName' && field !== 'email' && v[field] !== undefined) {
        body[field] = asText(v[field])
      }
    }
    for (const field of CLIENT_DATE_FIELDS) {
      if (v[field] !== undefined) {
        body[field] = (parseDateOnly(v[field]) as Date).toISOString()
      }
    }
    for (const key of ['clientType', 'clientStatus']) {
      if (v[key] !== undefined) {
        body[key] = asText(v[key])
      }
    }
    // F5b (W2-05): consent passes through as raw text — userController
    // .create normalises it (yes/no, comma-separated scope) and stamps
    // consentAt server-side; consentAt itself is never a column.
    for (const key of ['consentGiven', 'consentScope']) {
      if (v[key] !== undefined) {
        body[key] = asText(v[key])
      }
    }
    candidates.push({ row: row.row, body })
  }
  return { candidates, errors }
}

// ---------------------------------------------------------------------------
// BOOKINGS
// ---------------------------------------------------------------------------

interface BookingCandidate {
  row: number
  carId: string
  driverId: string
  pickupLocation: string
  dropOffLocation: string
  from: Date
  to: Date
  price: number
  status: bookcarsTypes.BookingStatus
}

const BOOKING_IMPORT_STATUSES = [bookcarsTypes.BookingStatus.Reserved, bookcarsTypes.BookingStatus.Pending] as const

const validateBookings = async (
  rows: ParsedRow[],
  supplierId: string,
): Promise<{ candidates: BookingCandidate[], errors: ImportRowError[] }> => {
  const errors: ImportRowError[] = []
  const candidates: BookingCandidate[] = []
  const inFileBookings: { carId: string, from: Date, to: Date, row: number }[] = []

  for (const row of rows) {
    const rowErrors: ImportRowError[] = []
    const v = row.values
    const plate = asText(v.carPlate)
    const email = asText(v.clientEmail)
    if (!plate) {
      rowErrors.push({ row: row.row, field: 'carPlate', message: 'Missing required field: carPlate' })
    }
    if (!email) {
      rowErrors.push({ row: row.row, field: 'clientEmail', message: 'Missing required field: clientEmail' })
    } else if (!validator.isEmail(email)) {
      rowErrors.push({ row: row.row, field: 'clientEmail', message: `Invalid client email: "${email}"` })
    }
    const from = v.from === undefined ? null : parseBookingDate(v.from)
    const to = v.to === undefined ? null : parseBookingDate(v.to)
    if (v.from === undefined) {
      rowErrors.push({ row: row.row, field: 'from', message: 'Missing required field: from' })
    } else if (!from) {
      rowErrors.push({ row: row.row, field: 'from', message: `Invalid date for from: "${asText(v.from)}"` })
    }
    if (v.to === undefined) {
      rowErrors.push({ row: row.row, field: 'to', message: 'Missing required field: to' })
    } else if (!to) {
      rowErrors.push({ row: row.row, field: 'to', message: `Invalid date for to: "${asText(v.to)}"` })
    }
    if (from && to && from >= to) {
      rowErrors.push({ row: row.row, field: 'to', message: 'Invalid rental dates: "to" must be after "from"' })
    }
    const price = asNumber(v.price)
    if (v.price === undefined) {
      rowErrors.push({ row: row.row, field: 'price', message: 'Missing required field: price' })
    } else if (price === undefined || Number.isNaN(price) || price < 0) {
      rowErrors.push({ row: row.row, field: 'price', message: `Invalid price: "${asText(v.price)}"` })
    }
    let status: bookcarsTypes.BookingStatus = bookcarsTypes.BookingStatus.Reserved
    const rawStatus = asText(v.status)
    if (rawStatus) {
      if ((BOOKING_IMPORT_STATUSES as readonly string[]).includes(rawStatus)) {
        status = rawStatus as bookcarsTypes.BookingStatus
      } else {
        rowErrors.push({ row: row.row, field: 'status', message: `Invalid status for import: "${rawStatus}" (allowed: reserved, pending — payment statuses cannot be imported)` })
      }
    }

    let car: { _id: mongoose.Types.ObjectId, locations?: mongoose.Types.ObjectId[] } | null = null
    if (plate) {
      // GA-PAR-22: a trashed car cannot be booked by an import.
      car = await Car.findOne({ supplier: supplierId, licensePlate: plate, deletedAt: null }).select('_id locations').lean()
      if (!car) {
        // Case-insensitive fallback so a differently-cased plate in the
        // sheet still resolves — but only ever within this agency.
        const all = await Car.find({ supplier: supplierId, deletedAt: null }).select('_id locations licensePlate').lean()
        car = all.find((c) => String(c.licensePlate || '').trim().toLowerCase() === plate.toLowerCase()) || null
      }
      if (!car) {
        rowErrors.push({ row: row.row, field: 'carPlate', message: `Unknown car plate for this agency: "${plate}"` })
      }
    }
    let driver: { _id: mongoose.Types.ObjectId, clientStatus?: string, blacklisted?: boolean, deletedAt?: Date | null } | null = null
    if (email && validator.isEmail(email)) {
      // Agency-scoped resolution ONLY: a client of another agency is
      // "unknown" here and is never linked (and nothing about that other
      // agency's record leaks into this message).
      driver = await User.findOne({ supplier: supplierId, type: bookcarsTypes.UserType.User, email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
        .select('_id clientStatus blacklisted deletedAt').lean()
      if (!driver) {
        rowErrors.push({ row: row.row, field: 'clientEmail', message: `Unknown client email for this agency: "${email}"` })
      } else if (driver.deletedAt) {
        // GA-PAR-22: a trashed client cannot be booked (CLIENT_TRASHED).
        rowErrors.push({ row: row.row, field: 'clientEmail', message: 'Client is trashed and cannot be booked (CLIENT_TRASHED)' })
      } else if (driver.clientStatus === bookcarsTypes.ClientStatus.Blocked || driver.blacklisted === true) {
        rowErrors.push({ row: row.row, field: 'clientEmail', message: 'Client is blocked and cannot be booked (CLIENT_BLOCKED)' })
      }
    }

    if (rowErrors.length === 0 && car && driver && from && to && status === bookcarsTypes.BookingStatus.Reserved) {
      // Read-only availability pre-check mirroring the reservation
      // helper's conflict definition (the authoritative check runs
      // again inside bookingController.create at commit time).
      const now = new Date()
      const conflict = await Booking.findOne({
        car: car._id,
        // GA-PAR-22: a trashed booking does not reserve its car.
        deletedAt: null,
        from: { $lte: to },
        to: { $gte: from },
        $or: [
          { status: { $in: BOOKING_RESERVATION_STATUSES } },
          { status: bookcarsTypes.BookingStatus.Void, expireAt: { $gt: now } },
        ],
        lifecycle: { $nin: [bookcarsTypes.ContractLifecycle.Completed, bookcarsTypes.ContractLifecycle.Cancelled] },
      }).select('_id').lean()
      if (conflict) {
        rowErrors.push({ row: row.row, field: 'from', message: 'Car unavailable for these dates: conflicts with an existing booking' })
      } else {
        const downtime = await MaintenanceWorkOrder.findOne({
          supplier: supplierId,
          car: car._id,
          status: { $in: [bookcarsTypes.WorkOrderStatus.Scheduled, bookcarsTypes.WorkOrderStatus.InProgress] },
          scheduledStart: { $lt: to },
          scheduledEnd: { $gt: from },
        }).select('_id').lean()
        if (downtime) {
          rowErrors.push({ row: row.row, field: 'from', message: 'Car unavailable for these dates: maintenance block' })
        }
      }
      if (rowErrors.length === 0) {
        const inFile = inFileBookings.find((b) => b.carId === car!._id.toString() && b.from <= to && b.to >= from)
        if (inFile) {
          rowErrors.push({ row: row.row, field: 'from', message: `Car unavailable for these dates: conflicts with row ${inFile.row} of this file` })
        }
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      continue
    }
    const carId = (car as { _id: mongoose.Types.ObjectId })._id.toString()
    const firstLocation = ((car as { locations?: mongoose.Types.ObjectId[] }).locations || [])[0]
    if (!firstLocation) {
      errors.push({ row: row.row, field: 'carPlate', message: `Car "${plate}" has no location; a booking cannot be created` })
      continue
    }
    candidates.push({
      row: row.row,
      carId,
      driverId: (driver as { _id: mongoose.Types.ObjectId })._id.toString(),
      pickupLocation: firstLocation.toString(),
      dropOffLocation: firstLocation.toString(),
      from: from as Date,
      to: to as Date,
      price: price as number,
      status,
    })
    if (status === bookcarsTypes.BookingStatus.Reserved) {
      inFileBookings.push({ carId, from: from as Date, to: to as Date, row: row.row })
    }
  }
  return { candidates, errors }
}


// ---------------------------------------------------------------------------
// EXPENSES (GA-PAR-16 — the 4th import entity)
// ---------------------------------------------------------------------------

interface ExpenseCandidate {
  row: number
  body: Record<string, unknown>
}

const validateExpenses = async (
  rows: ParsedRow[],
  supplierId: string,
): Promise<{ candidates: ExpenseCandidate[], errors: ImportRowError[] }> => {
  const errors: ImportRowError[] = []
  const candidates: ExpenseCandidate[] = []

  // Duplicate control set: existing agency expenses keyed by
  // (date, car-or-general, category, amount) — the task's identity.
  const dupKey = (date: Date, carKey: string, category: string, amount: number): string => (
    `${date.toISOString().slice(0, 10)}|${carKey}|${category}|${amount.toFixed(2)}`
  )
  const seen = new Map<string, string>()
  const existing = await MaintenanceExpense.find({ supplier: supplierId }).select('car date type amount').lean()
  for (const e of existing) {
    seen.set(dupKey(new Date(e.date), e.car ? e.car.toString() : 'general', String(e.type), Number(e.amount || 0)), 'existing')
  }

  // Agency cars by plate (exact, then case-insensitive fallback — the
  // bookings importer's agency-only resolution rule).
  // GA-PAR-22: trashed cars are absent from the plate map.
  const agencyCars = await Car.find({ supplier: supplierId, deletedAt: null }).select('_id licensePlate').lean()
  const carByPlate = new Map<string, string>()
  for (const c of agencyCars) {
    const plate = String(c.licensePlate || '').trim()
    if (plate) {
      carByPlate.set(plate, c._id.toString())
      const lower = plate.toLowerCase()
      if (!carByPlate.has(lower)) {
        carByPlate.set(lower, c._id.toString())
      }
    }
  }

  for (const row of rows) {
    const rowErrors: ImportRowError[] = []
    const v = row.values

    const date = v.date === undefined ? null : parseDateOnly(v.date)
    if (v.date === undefined) {
      rowErrors.push({ row: row.row, field: 'date', message: 'Missing required field: date' })
    } else if (!date) {
      rowErrors.push({ row: row.row, field: 'date', message: `Invalid date: "${asText(v.date)}" (expected YYYY-MM-DD)` })
    }

    const plate = asText(v.carPlate)
    let carId: string | undefined
    if (plate) {
      carId = carByPlate.get(plate) || carByPlate.get(plate.toLowerCase())
      if (!carId) {
        rowErrors.push({ row: row.row, field: 'carPlate', message: `Unknown car plate for this agency: "${plate}"` })
      }
    }

    const category = asText(v.category)
    if (!category) {
      rowErrors.push({ row: row.row, field: 'category', message: 'Missing required field: category' })
    } else if (!(Object.values(bookcarsTypes.MaintenanceExpenseType) as string[]).includes(category)) {
      rowErrors.push({ row: row.row, field: 'category', message: `Invalid category: "${category}"` })
    }

    const amount = asNumber(v.amount)
    if (v.amount === undefined) {
      rowErrors.push({ row: row.row, field: 'amount', message: 'Missing required field: amount' })
    } else if (amount === undefined || Number.isNaN(amount) || amount <= 0) {
      rowErrors.push({ row: row.row, field: 'amount', message: `Invalid amount: "${asText(v.amount)}" (must be > 0)` })
    }

    let paidAmount: number | null = null
    if (v.paidAmount !== undefined) {
      const parsedPaid = asNumber(v.paidAmount)
      if (parsedPaid === undefined || Number.isNaN(parsedPaid) || parsedPaid < 0) {
        rowErrors.push({ row: row.row, field: 'paidAmount', message: `Invalid paidAmount: "${asText(v.paidAmount)}" (must be >= 0)` })
      } else if (amount !== undefined && !Number.isNaN(amount) && parsedPaid > amount) {
        rowErrors.push({ row: row.row, field: 'paidAmount', message: `paidAmount (${parsedPaid}) exceeds amount (${amount})` })
      } else {
        paidAmount = parsedPaid
      }
    }

    let mileage: number | undefined
    if (v.mileage !== undefined) {
      const parsedMileage = asNumber(v.mileage)
      if (parsedMileage === undefined || Number.isNaN(parsedMileage) || parsedMileage < 0) {
        rowErrors.push({ row: row.row, field: 'mileage', message: `Invalid mileage: "${asText(v.mileage)}"` })
      } else {
        mileage = parsedMileage
      }
    }

    const vendor = asText(v.vendor)
    if (vendor.length > 160) {
      rowErrors.push({ row: row.row, field: 'vendor', message: 'Vendor is too long (max 160 characters)' })
    }
    const note = asText(v.note)
    if (note.length > 1000) {
      rowErrors.push({ row: row.row, field: 'note', message: 'Note is too long (max 1000 characters)' })
    }

    // Duplicate control (existing expense or earlier file row).
    if (rowErrors.length === 0 && date && amount !== undefined && !Number.isNaN(amount)) {
      const key = dupKey(date, carId || 'general', category, amount)
      if (seen.has(key)) {
        rowErrors.push({ row: row.row, message: 'Possible duplicate: an expense with the same date, car (or general), category and amount already exists' })
      } else {
        seen.set(key, `row ${row.row}`)
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      continue
    }
    candidates.push({
      row: row.row,
      body: {
        ...(carId ? { car: carId } : {}),
        date: (date as Date).toISOString(),
        type: category,
        amount: amount as number,
        paidAmount,
        ...(vendor ? { vendor } : {}),
        ...(note ? { note } : {}),
        ...(mileage !== undefined ? { mileage } : {}),
      },
    })
  }
  return { candidates, errors }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

interface CreatedImportRef {
  row: number
  id: string
}

/**
 * F5b (W2-15): compensating deletes for a rolled-back import run.
 * Per entity: cars by created _id; clients by _id plus their Token
 * rows (the activation email already sent cannot be unsent);
 * expenses by _id plus a best-effort receipt-file unlink (imported
 * expenses never carry a receipt — the import body has no receipt
 * column — but the handler path supports one, so the unlink is kept
 * as a backstop); bookings by _id plus their Draft invoices (status
 * Draft only — an issued invoice is never deleted). Booking
 * reference numbers consumed by the atomic Counter are NOT reclaimed.
 * Best-effort per row: a failed delete is reported, never thrown,
 * so one stuck row cannot hide the rest. No MongoDB transactions:
 * the handlers do not accept sessions.
 */
const rollbackCreatedImportRows = async (
  entity: ImportEntity,
  created: CreatedImportRef[],
  supplierId: string,
): Promise<{ removed: number, failures: string[] }> => {
  let removed = 0
  const failures: string[] = []
  for (const ref of created) {
    try {
      if (!ref.id) {
        failures.push(`row ${ref.row}: created row could not be identified for rollback`)
        continue
      }
      if (entity === 'cars') {
        await Car.deleteOne({ _id: ref.id })
      } else if (entity === 'clients') {
        await User.deleteOne({ _id: ref.id })
        await Token.deleteMany({ user: ref.id })
      } else if (entity === 'expenses') {
        const expense = await MaintenanceExpense.findById(ref.id).select('receipt').lean()
        const receipt = (expense as { receipt?: string } | null)?.receipt
        if (receipt && receipt === path.basename(receipt)) {
          const base = path.resolve(env.CDN_MAINTENANCE)
          const target = path.resolve(base, receipt)
          if (target.startsWith(`${base}${path.sep}`)) {
            await asyncFs.unlink(target).catch(() => undefined)
          }
        }
        await MaintenanceExpense.deleteOne({ _id: ref.id })
      } else {
        await Booking.deleteOne({ _id: ref.id })
        await Invoice.deleteMany({ booking: ref.id, supplier: supplierId, status: bookcarsTypes.InvoiceStatus.Draft })
      }
      removed += 1
    } catch (err) {
      failures.push(`row ${ref.row}: ${err instanceof Error ? err.message : 'rollback failed'}`)
    }
  }
  return { removed, failures }
}

export interface ImportActor {
  user: unknown
  agency?: { supplierId: string, role: string }
}

export const runImport = async (
  entity: ImportEntity,
  buffer: Buffer,
  dryRun: boolean,
  supplierId: string,
  actor: ImportActor,
): Promise<ImportReport> => {
  const rows = await parseImportWorkbook(buffer, entity)
  const report: ImportReport = {
    entity,
    dryRun,
    totalRows: rows.length,
    validRows: 0,
    invalidRows: 0,
    created: 0,
    errors: [],
  }
  const validRowNumbers = new Set<number>()

  // F5b (W2-15): rollback state. A commit stops at the first
  // commit-phase failure; every row created so far in the run is
  // recorded here (row + created id) for the compensating deletes.
  const createdRefs: CreatedImportRef[] = []
  let commitFailureRow: number | null = null
  const recordCreated = (row: number, id: string | undefined) => {
    createdRefs.push({ row, id: id || '' })
    validRowNumbers.add(row)
    report.created += 1
  }

  if (entity === 'cars') {
    const { candidates, errors } = await validateCars(rows, supplierId)
    report.errors.push(...errors)
    for (const candidate of candidates) {
      if (dryRun) {
        validRowNumbers.add(candidate.row)
      } else {
        const result = await createCarFromImport(candidate, supplierId)
        if (typeof result === 'string') {
          recordCreated(candidate.row, result)
        } else {
          report.errors.push(result)
          commitFailureRow = candidate.row
          break
        }
      }
    }
  } else if (entity === 'clients') {
    const { candidates, errors } = await validateClients(rows, supplierId)
    report.errors.push(...errors)
    for (const candidate of candidates) {
      if (dryRun) {
        validRowNumbers.add(candidate.row)
      } else {
        const result = await invokeHandler(userController.create as never, {
          user: actor.user,
          agency: actor.agency,
          // F5b (W2-15): the agency scope is this import's supplier.
          // userController.create only forces the supplier for
          // Supplier/Staff callers, so without this an admin import
          // would create supplier-less clients despite the
          // agency-scoped validation above — and the rollback lookup
          // below could not find them. (Bookings already pass the
          // supplier explicitly; cars get it in createCarFromImport;
          // expenses resolve it from the agency/car in the handler.)
          body: { ...candidate.body, supplier: supplierId },
        })
        if (result.status === 200) {
          // F5b (W2-15): userController.create returns no body, so the
          // created client is resolved by its agency-unique email for
          // the rollback record.
          const stored = await User.findOne({
            supplier: supplierId,
            type: bookcarsTypes.UserType.User,
            email: candidate.body.email as string,
          }).select('_id').lean()
          recordCreated(candidate.row, stored?._id.toString())
        } else {
          report.errors.push({ row: candidate.row, message: handlerErrorMessage(result, `Client could not be created (status ${result.status})`) })
          commitFailureRow = candidate.row
          break
        }
      }
    }
  } else if (entity === 'expenses') {
    const { candidates, errors } = await validateExpenses(rows, supplierId)
    report.errors.push(...errors)
    for (const candidate of candidates) {
      if (dryRun) {
        validRowNumbers.add(candidate.row)
      } else {
        // Creation goes through the SAME handler the UI uses — no raw
        // inserts, no forked validation (see the header note).
        const result = await invokeHandler(maintenanceExpenseController.create as never, {
          user: actor.user,
          agency: actor.agency,
          body: { ...candidate.body },
        })
        if (result.status === 201) {
          // F5b (W2-15): the 201 body is the expense doc (with _id).
          const id = (result.body as { _id?: unknown } | undefined)?._id
          recordCreated(candidate.row, id ? String(id) : undefined)
        } else {
          report.errors.push({ row: candidate.row, message: handlerErrorMessage(result, `Expense could not be created (status ${result.status})`) })
          commitFailureRow = candidate.row
          break
        }
      }
    }
  } else {
    const { candidates, errors } = await validateBookings(rows, supplierId)
    report.errors.push(...errors)
    for (const candidate of candidates) {
      if (dryRun) {
        validRowNumbers.add(candidate.row)
      } else {
        const result = await invokeHandler(bookingController.create as never, {
          user: actor.user,
          agency: actor.agency,
          body: {
            booking: {
              supplier: supplierId,
              car: candidate.carId,
              driver: candidate.driverId,
              pickupLocation: candidate.pickupLocation,
              dropOffLocation: candidate.dropOffLocation,
              from: candidate.from.toISOString(),
              to: candidate.to.toISOString(),
              status: candidate.status,
              price: candidate.price,
            },
          },
        })
        if (result.status === 200) {
          // F5b (W2-15): the 200 body is the booking doc (with _id).
          const id = (result.body as { _id?: unknown } | undefined)?._id
          recordCreated(candidate.row, id ? String(id) : undefined)
        } else {
          report.errors.push({
            row: candidate.row,
            message: result.status === 409
              ? 'Car unavailable for these dates: conflicts with an existing booking'
              : handlerErrorMessage(result, `Booking could not be created (status ${result.status})`),
          })
          commitFailureRow = candidate.row
          break
        }
      }
    }
  }

  // F5b (W2-15): a commit-phase failure rolls the whole run back —
  // dry runs never create, so there is nothing to roll back. The
  // created rows are removed, created drops to 0 (unless a rollback
  // delete failed — then the remainder stays and is reported), and
  // the run reports as fully invalid: nothing from this file was kept.
  if (!dryRun && commitFailureRow !== null) {
    const { removed, failures } = await rollbackCreatedImportRows(entity, createdRefs, supplierId)
    report.rolledBack = true
    report.created = createdRefs.length - removed
    validRowNumbers.clear()
    report.errors.push({
      row: commitFailureRow,
      message: `Import rolled back after a failure at row ${commitFailureRow}: ${removed} created row(s) removed — nothing from this file was kept`,
    })
    for (const failure of failures) {
      report.errors.push({ row: 0, message: `Rollback incomplete: ${failure}` })
    }
  }

  report.errors.sort((a, b) => a.row - b.row)
  report.validRows = validRowNumbers.size
  report.invalidRows = report.totalRows - report.validRows
  return report
}
