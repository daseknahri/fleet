import asyncFs from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import escapeStringRegexp from 'escape-string-regexp'
import mongoose from 'mongoose'
import { Request, Response } from 'express'
import * as nodemailer from 'nodemailer'
import type { SendMailOptions } from 'nodemailer'
import * as bookcarsTypes from ':bookcars-types'
import Booking from '../models/Booking'
import Car from '../models/Car'
import i18n from '../lang/i18n'
import * as env from '../config/env.config'
import * as helper from '../utils/helper'
import * as logger from '../utils/logger'
import { canDeleteOwnedTempFile } from '../utils/authorization'
import { contentMatchesExtension } from '../utils/fileContent'
import { BOOKING_RESERVATION_STATUSES } from '../utils/bookingReservationHelper'
import { deriveFleetStatus, emptyFleetStatusCounts, fleetStatusForList, isFleetStatus } from '../utils/fleetStatus'
import { agencySupplierId } from '../utils/agencyAuthorization'
import DateBasedPrice from '../models/DateBasedPrice'
import User from '../models/User'
import Notification from '../models/Notification'
import NotificationCounter from '../models/NotificationCounter'
import * as mailHelper from '../utils/mailHelper'
import Location from '../models/Location'
import { applyRestore, applyTrash, isValidTrashReason, trashedMessage } from '../utils/trash'

const canManageAgency = (user: { _id: mongoose.Types.ObjectId | string, type?: bookcarsTypes.UserType } | undefined, supplierId: string) =>
  !!user && (user.type === bookcarsTypes.UserType.Admin || (user.type === bookcarsTypes.UserType.Supplier && user._id.toString() === supplierId))


// GA-PAR-15: these car-create validators/normalisers are exported so the
// Excel importer creates cars through the SAME rules (no forked copy).
export const validateLocationsForSupplier = async (locations: string[], supplierId: string) => {
  if (!Array.isArray(locations) || locations.length === 0 || locations.some((location) => !mongoose.isValidObjectId(location))) {
    return false
  }

  const uniqueLocations = [...new Set(locations)]
  const records = await Location.find({ _id: { $in: uniqueLocations } }).select('supplier').lean()
  return records.length === uniqueLocations.length
    && records.every((location) => !location.supplier || location.supplier.toString() === supplierId)
}

// GA-PAR-08: field-level validation + normalisation for the financing
// block and the document expiry dates. Deliberately NO cross-field
// business rules (no remaining <= purchasePrice, no due-date ordering):
// only per-field shape — amounts are finite numbers >= 0, dates parse,
// the financing type is in its enum, lender is a string, autoDebit a
// boolean. null / '' means "clear" and is valid everywhere. Anything
// else malformed is rejected with a 400 naming the field, before any
// persistence; the schema's own enum/min/Date validators stay as the
// second line of defence (the PAR-06 tank-capacity precedent).
const FINANCING_AMOUNT_FIELDS = ['purchasePrice', 'instalmentAmount', 'downPayment', 'durationMonths', 'remainingAmount'] as const
const FINANCING_DATE_FIELDS = ['firstDueDate', 'nextDueDate'] as const
const CAR_DOCUMENT_DATE_FIELDS = ['insuranceExpiryDate', 'technicalInspectionExpiryDate', 'vignetteExpiryDate'] as const

const isClearValue = (value: unknown) => value === undefined || value === null || value === ''

const isValidDateValue = (value: unknown) => {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime())
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return !Number.isNaN(new Date(value).getTime())
  }
  return false
}

export const invalidFinancingOrDocumentField = (payload: {
  financing?: unknown
  insuranceExpiryDate?: unknown
  technicalInspectionExpiryDate?: unknown
  vignetteExpiryDate?: unknown
}): string | null => {
  for (const field of CAR_DOCUMENT_DATE_FIELDS) {
    const value = payload[field]
    if (!isClearValue(value) && !isValidDateValue(value)) {
      return field
    }
  }
  const { financing } = payload
  if (isClearValue(financing)) {
    return null
  }
  if (typeof financing !== 'object' || Array.isArray(financing)) {
    return 'financing'
  }
  const block = financing as Record<string, unknown>
  if (!isClearValue(block.type) && !(Object.values(bookcarsTypes.CarFinancingType) as string[]).includes(block.type as string)) {
    return 'financing.type'
  }
  for (const field of FINANCING_AMOUNT_FIELDS) {
    const value = block[field]
    if (isClearValue(value)) {
      continue
    }
    if (typeof value === 'boolean' || typeof value === 'object') {
      return `financing.${field}`
    }
    const amount = Number(value)
    if (!Number.isFinite(amount) || amount < 0) {
      return `financing.${field}`
    }
    if (field === 'durationMonths' && !Number.isInteger(amount)) {
      return `financing.${field}`
    }
  }
  if (!isClearValue(block.lender) && typeof block.lender !== 'string') {
    return 'financing.lender'
  }
  for (const field of FINANCING_DATE_FIELDS) {
    const value = block[field]
    if (!isClearValue(value) && !isValidDateValue(value)) {
      return `financing.${field}`
    }
  }
  if (!isClearValue(block.autoDebit) && typeof block.autoDebit !== 'boolean') {
    return 'financing.autoDebit'
  }
  return null
}

// Returns undefined when nothing should be stored (absent, null, or a
// block whose every field is cleared); otherwise an object holding only
// the set fields, with numbers and dates normalised.
export const normalizeFinancing = (financing: bookcarsTypes.CarFinancingPayload | null | undefined): bookcarsTypes.CarFinancing | undefined => {
  if (!financing) {
    return undefined
  }
  const normalized: bookcarsTypes.CarFinancing = {}
  if (!isClearValue(financing.type)) {
    normalized.type = financing.type as bookcarsTypes.CarFinancingType
  }
  for (const field of FINANCING_AMOUNT_FIELDS) {
    const value = financing[field]
    if (!isClearValue(value)) {
      normalized[field] = Number(value)
    }
  }
  if (!isClearValue(financing.lender)) {
    normalized.lender = financing.lender as string
  }
  for (const field of FINANCING_DATE_FIELDS) {
    const value = financing[field]
    if (!isClearValue(value)) {
      normalized[field] = new Date(value as string)
    }
  }
  if (!isClearValue(financing.autoDebit)) {
    normalized.autoDebit = financing.autoDebit as boolean
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

export const normalizeDocumentDate = (value: Date | string | null | undefined): Date | undefined => (isClearValue(value) ? undefined : new Date(value as string))

// Scorecard #17: garage block validation + normalisation, following the
// GA-PAR-08 financing discipline — per-field shape only, plus the one
// cross-field rule the scorecard states: expectedBack >= since when both
// are set. null / '' means "clear" and is valid everywhere. A
// whitespace-only name counts as cleared, not as a name. Anything else
// malformed is rejected with a 400 naming the field, before any
// persistence; the schema's own maxlength/Date validators stay as the
// second line of defence.
const GARAGE_NAME_MAX_LENGTH = 200

export const invalidGarageField = (payload: {
  garage?: unknown
}): string | null => {
  const { garage } = payload
  if (isClearValue(garage)) {
    return null
  }
  if (typeof garage !== 'object' || Array.isArray(garage)) {
    return 'garage'
  }
  const block = garage as Record<string, unknown>
  if (!isClearValue(block.garageName)) {
    if (typeof block.garageName !== 'string' || block.garageName.trim().length > GARAGE_NAME_MAX_LENGTH) {
      return 'garage.garageName'
    }
  }
  for (const field of ['since', 'expectedBack'] as const) {
    const value = block[field]
    if (!isClearValue(value) && !isValidDateValue(value)) {
      return `garage.${field}`
    }
  }
  const since = isClearValue(block.since) ? undefined : new Date(block.since as string)
  const expectedBack = isClearValue(block.expectedBack) ? undefined : new Date(block.expectedBack as string)
  if (since && expectedBack && expectedBack < since) {
    return 'garage.expectedBack'
  }
  return null
}

// Returns undefined when nothing should be stored (absent, null, or a
// block whose every field is cleared); otherwise an object holding only
// the set fields, name trimmed, dates normalised.
export const normalizeGarage = (garage: bookcarsTypes.CarGaragePayload | null | undefined): bookcarsTypes.CarGarage | undefined => {
  if (!garage) {
    return undefined
  }
  const normalized: bookcarsTypes.CarGarage = {}
  if (!isClearValue(garage.garageName) && typeof garage.garageName === 'string' && garage.garageName.trim().length > 0) {
    normalized.garageName = garage.garageName.trim()
  }
  if (!isClearValue(garage.since)) {
    normalized.since = new Date(garage.since as string)
  }
  if (!isClearValue(garage.expectedBack)) {
    normalized.expectedBack = new Date(garage.expectedBack as string)
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

// Scorecard #17: the expectedBack >= since rule is checked on the MERGED
// block in update — a payload that sets only expectedBack must still
// respect the stored since (and vice versa). Returns true when the merged
// pair violates the rule.
export const mergedGarageDateOrderInvalid = (
  stored: bookcarsTypes.CarGarage | undefined,
  patch: bookcarsTypes.CarGaragePayload | null | undefined,
): boolean => {
  if (!patch || typeof patch !== 'object') {
    return false
  }
  const since = patch.since !== undefined
    ? (isClearValue(patch.since) ? undefined : new Date(patch.since as string))
    : stored?.since
  const expectedBack = patch.expectedBack !== undefined
    ? (isClearValue(patch.expectedBack) ? undefined : new Date(patch.expectedBack as string))
    : stored?.expectedBack
  return !!since && !!expectedBack && expectedBack < since
}

// Scorecard #18: service-state validation + normalisation, following
// the GA-PAR-08 financing / #17 garage discipline — per-field shape
// only, plus the one cross-field rule the scorecard states: next >=
// last per pair (oil, filter) when both are set. null / '' means
// "clear" and is valid everywhere. Anything else malformed is rejected
// with a 400 naming the field, before any persistence; the schema's
// own min: 0 validators stay as the second line of defence.
const SERVICE_KM_FIELDS = ['lastOilChangeKm', 'lastFilterChangeKm', 'nextOilChangeKm', 'nextFilterChangeKm'] as const

export const invalidServiceField = (payload: {
  service?: unknown
}): string | null => {
  const { service } = payload
  if (isClearValue(service)) {
    return null
  }
  if (typeof service !== 'object' || Array.isArray(service)) {
    return 'service'
  }
  const block = service as Record<string, unknown>
  for (const field of SERVICE_KM_FIELDS) {
    const value = block[field]
    if (isClearValue(value)) {
      continue
    }
    if (typeof value === 'boolean' || typeof value === 'object') {
      return `service.${field}`
    }
    const km = Number(value)
    if (!Number.isFinite(km) || km < 0) {
      return `service.${field}`
    }
  }
  const lastOil = isClearValue(block.lastOilChangeKm) ? undefined : Number(block.lastOilChangeKm)
  const nextOil = isClearValue(block.nextOilChangeKm) ? undefined : Number(block.nextOilChangeKm)
  if (lastOil !== undefined && nextOil !== undefined && nextOil < lastOil) {
    return 'service.nextOilChangeKm'
  }
  const lastFilter = isClearValue(block.lastFilterChangeKm) ? undefined : Number(block.lastFilterChangeKm)
  const nextFilter = isClearValue(block.nextFilterChangeKm) ? undefined : Number(block.nextFilterChangeKm)
  if (lastFilter !== undefined && nextFilter !== undefined && nextFilter < lastFilter) {
    return 'service.nextFilterChangeKm'
  }
  return null
}

// Returns undefined when nothing should be stored (absent, null, or a
// block whose every field is cleared); otherwise an object holding only
// the set fields, normalised to numbers.
export const normalizeService = (service: bookcarsTypes.CarServicePayload | null | undefined): bookcarsTypes.CarService | undefined => {
  if (!service) {
    return undefined
  }
  const normalized: bookcarsTypes.CarService = {}
  for (const field of SERVICE_KM_FIELDS) {
    const value = service[field]
    if (!isClearValue(value)) {
      normalized[field] = Number(value)
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

// Scorecard #18: the next >= last rule is checked on the MERGED block
// in update — a payload that sets only nextOilChangeKm must still
// respect the stored lastOilChangeKm (and vice versa), per pair.
// Returns the offending next field, or null when the merged block is
// valid.
export const mergedServiceKmOrderInvalid = (
  stored: bookcarsTypes.CarService | undefined,
  patch: bookcarsTypes.CarServicePayload | null | undefined,
): string | null => {
  if (!patch || typeof patch !== 'object') {
    return null
  }
  for (const [lastField, nextField] of [['lastOilChangeKm', 'nextOilChangeKm'], ['lastFilterChangeKm', 'nextFilterChangeKm']] as const) {
    const last = patch[lastField] !== undefined
      ? (isClearValue(patch[lastField]) ? undefined : Number(patch[lastField]))
      : stored?.[lastField]
    const next = patch[nextField] !== undefined
      ? (isClearValue(patch[nextField]) ? undefined : Number(patch[nextField]))
      : stored?.[nextField]
    if (last !== undefined && next !== undefined && next < last) {
      return `service.${nextField}`
    }
  }
  return null
}

const validDateBasedPrices = (dateBasedPrices: bookcarsTypes.DateBasedPrice[] | undefined) =>
  (Array.isArray(dateBasedPrices) ? dateBasedPrices : []).filter((dbp) => {
    const start = new Date(dbp?.startDate || '')
    const end = new Date(dbp?.endDate || '')
    const daily = Number(dbp?.dailyPrice)
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
      && end >= start && Number.isFinite(daily) && daily > 0
  })
/**
 * Create a Car.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const create = async (req: Request, res: Response) => {
  const { body }: { body: bookcarsTypes.CreateCarPayload } = req

  try {
    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    if (!sessionUser) {
      res.status(403).send('Forbidden: You cannot create this car')
      return
    }
    const agencyId = agencySupplierId(req)
    const supplierId = sessionUser.type === bookcarsTypes.UserType.Admin
      ? body.supplier || ''
      : agencyId || ''
    if (!mongoose.isValidObjectId(supplierId) || !(await User.exists({ _id: supplierId, type: bookcarsTypes.UserType.Supplier }))) {
      res.status(400).send('Invalid supplier')
      return
    }
    if (!(await validateLocationsForSupplier(body.locations, supplierId))) {
      res.status(400).send('Invalid locations for supplier')
      return
    }

    const invalidField = invalidFinancingOrDocumentField(body)
    if (invalidField) {
      res.status(400).send(`Invalid ${invalidField}`)
      return
    }

    // Scorecard #17: garage block shape + date order.
    const invalidGarage = invalidGarageField(body)
    if (invalidGarage) {
      res.status(400).send(`Invalid ${invalidGarage}`)
      return
    }

    // Scorecard #18: service-state km shape + next >= last per pair.
    const invalidService = invalidServiceField(body)
    if (invalidService) {
      res.status(400).send(`Invalid ${invalidService}`)
      return
    }

    // Fleet statuses (scorecard #15): the operator status is one of the
    // three enum values when present; absent means inService (default).
    if (body.operationalStatus !== undefined && !Object.values(bookcarsTypes.CarOperationalStatus).includes(body.operationalStatus)) {
      res.status(400).send('Invalid operationalStatus')
      return
    }

    if (!body.image) {
      throw new Error('Image not found in payload')
    }

    // date based price
    const { dateBasedPrices, ...carFields } = body
    const dateBasedPriceIds: string[] = []
    if (body.isDateBasedPrice) {
      for (const dateBasePrice of validDateBasedPrices(dateBasedPrices)) {
        const dbp = new DateBasedPrice(dateBasePrice)
        await dbp.save()
        dateBasedPriceIds.push(dbp._id.toString())
      }
    }

    const car = new Car({
      ...carFields,
      supplier: supplierId,
      locations: body.locations,
      dateBasedPrices: dateBasedPriceIds,
      financing: normalizeFinancing(body.financing),
      insuranceExpiryDate: normalizeDocumentDate(body.insuranceExpiryDate),
      technicalInspectionExpiryDate: normalizeDocumentDate(body.technicalInspectionExpiryDate),
      vignetteExpiryDate: normalizeDocumentDate(body.vignetteExpiryDate),
      // Scorecard #17: garage block (absent when nothing is set).
      garage: normalizeGarage(body.garage),
      // Scorecard #18: service state (absent when nothing is set).
      service: normalizeService(body.service),
    })
    await car.save()

    // --------- image ---------
    // 1. Sanitize filename
    const safeImage = path.basename(body.image)

    // If basename modified it → traversal attempt
    if (safeImage !== body.image) {
      await Car.deleteOne({ _id: car._id })
      logger.warn(`[car.create] Directory traversal attempt (image): ${body.image}`)
      throw new Error('Invalid image filename')
    }

    const tempDir = path.resolve(env.CDN_TEMP_CARS)
    const carsDir = path.resolve(env.CDN_CARS)

    const sourcePath = path.resolve(tempDir, safeImage)

    // 2. Ensure source stays inside temp directory
    if (!sourcePath.startsWith(tempDir + path.sep)) {
      await Car.deleteOne({ _id: car._id })
      logger.warn(`[car.create] Source path escape attempt: ${sourcePath}`)
      throw new Error('Invalid image path')
    }

    if (await helper.pathExists(sourcePath)) {
      const ext = path.extname(safeImage).toLowerCase()

      // 3. Restrict allowed extensions
      if (!env.allowedImageExtensions.includes(ext)) {
        await Car.deleteOne({ _id: car._id })
        throw new Error('Invalid image type')
      }

      const filename = `${car._id}_${Date.now()}${ext}`
      const newPath = path.resolve(carsDir, filename)

      // 4. Ensure destination stays inside cars directory
      if (!newPath.startsWith(carsDir + path.sep)) {
        await Car.deleteOne({ _id: car._id })
        logger.warn(`[car.create] Destination path escape attempt: ${newPath}`)
        throw new Error('Invalid image destination')
      }

      await asyncFs.rename(sourcePath, newPath)

      car.image = filename
      await car.save()
    } else {
      await Car.deleteOne({ _id: car._id })
      throw new Error(`Image ${safeImage} not found`)
    }
    // --------- image ---------

    // notify admin if the car was created by a supplier
    if (body.loggedUser) {
      const loggedUser = await User.findById(body.loggedUser)

      if (loggedUser && loggedUser.type === bookcarsTypes.UserType.Supplier) {
        const supplier = await User.findById(body.supplier)

        if (supplier?.notifyAdminOnNewCar) {
          const admin = !!env.ADMIN_EMAIL && (await User.findOne({ email: env.ADMIN_EMAIL, type: bookcarsTypes.UserType.Admin }))
          if (admin) {
            i18n.locale = admin.language
            const message = i18n.t('NEW_CAR_NOTIFICATION_PART1') + supplier.fullName + i18n.t('NEW_CAR_NOTIFICATION_PART2')

            // notification
            const notification = new Notification({
              user: admin._id,
              message,
              car: car._id.toString(),
            })

            await notification.save()
            let counter = await NotificationCounter.findOne({ user: admin._id })
            if (counter && typeof counter.count !== 'undefined') {
              counter.count += 1
              await counter.save()
            } else {
              counter = new NotificationCounter({ user: admin._id, count: 1 })
              await counter.save()
            }

            // mail
            if (admin.enableEmailNotifications) {
              const mailOptions: SendMailOptions = {
                from: env.SMTP_FROM,
                to: admin.email,
                subject: message,
                html: `<p>
${i18n.t('HELLO')}${admin.fullName},<br><br>
${message}<br><br>
${helper.joinURL(env.ADMIN_HOST, `update-car?cr=${car._id.toString()}`)}<br><br>
${i18n.t('REGARDS')}<br>
</p>`,
              }

              await mailHelper.sendMail(mailOptions)
            }
          }
        }
      }
    }

    res.json(car)
  } catch (err) {
    logger.error(`[car.create] ${i18n.t('ERROR')} ${JSON.stringify(body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

const createDateBasedPrice = async (dateBasedPrice: bookcarsTypes.DateBasedPrice): Promise<string> => {
  const dbp = new DateBasedPrice({
    startDate: dateBasedPrice.startDate,
    endDate: dateBasedPrice.endDate,
    dailyPrice: dateBasedPrice.dailyPrice,
  })
  await dbp.save()
  return dbp._id.toString()
}

/**
 * Update a Car.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const update = async (req: Request, res: Response) => {
  const { body }: { body: bookcarsTypes.UpdateCarPayload } = req
  const { _id } = body

  try {
    if (!helper.isValidObjectId(_id)) {
      throw new Error('body._id is not valid')
    }
    const car = await Car.findById(_id)

    if (car) {
      // begin of security check
      const sessionUserId = req.user?._id
      const sessionUser = await User.findById(sessionUserId)
      const sessionAgencyId = agencySupplierId(req)
      const isAgencyUser = !!sessionUser && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
      if (!sessionUser || (isAgencyUser && car.supplier?.toString() !== sessionAgencyId)) {
        logger.error(`[car.update] Unauthorized attempt to update car ${car._id} by user ${sessionUserId}`)
        res.status(403).send('Forbidden: You cannot update this location')
        return
      }
      // end of security check

      // GA-PAR-22: a trashed car cannot be updated — restore it first.
      if (car.deletedAt) {
        res.status(409).send(trashedMessage('car'))
        return
      }

      const invalidField = invalidFinancingOrDocumentField(body)
      if (invalidField) {
        res.status(400).send(`Invalid ${invalidField}`)
        return
      }

      // Fleet statuses (scorecard #15): the operator status is one of the
      // three enum values when present.
      if (body.operationalStatus !== undefined && !Object.values(bookcarsTypes.CarOperationalStatus).includes(body.operationalStatus)) {
        res.status(400).send('Invalid operationalStatus')
        return
      }

      // Scorecard #17: garage block shape + date order, checked on the
      // payload first, then on the merged block (a payload that sets only
      // expectedBack must still respect the stored since).
      const invalidGarage = invalidGarageField(body)
      if (invalidGarage) {
        res.status(400).send(`Invalid ${invalidGarage}`)
        return
      }
      if (mergedGarageDateOrderInvalid(car.garage, body.garage)) {
        res.status(400).send('Invalid garage.expectedBack')
        return
      }

      // Scorecard #18: service-state km shape + next >= last per pair,
      // checked on the payload first, then on the merged block (a
      // payload that sets only nextOilChangeKm must still respect the
      // stored lastOilChangeKm, and vice versa, per pair).
      const invalidService = invalidServiceField(body)
      if (invalidService) {
        res.status(400).send(`Invalid ${invalidService}`)
        return
      }
      const mergedServiceInvalid = mergedServiceKmOrderInvalid(car.service, body.service)
      if (mergedServiceInvalid) {
        res.status(400).send(`Invalid ${mergedServiceInvalid}`)
        return
      }

      const {
        supplier,
        name,
        licensePlate,
        minimumAge,
        available,
        fullyBooked,
        comingSoon,
        operationalStatus,
        type,
        locations,
        dailyPrice,
        discountedDailyPrice,
        hourlyPrice,
        discountedHourlyPrice,
        biWeeklyPrice,
        discountedBiWeeklyPrice,
        weeklyPrice,
        discountedWeeklyPrice,
        monthlyPrice,
        discountedMonthlyPrice,
        deposit,
        seats,
        doors,
        aircon,
        gearbox,
        fuelPolicy,
        mileage,
        cancellation,
        amendments,
        theftProtection,
        collisionDamageWaiver,
        fullInsurance,
        additionalDriver,
        range,
        multimedia,
        rating,
        co2,
        tankCapacityLitres,
        financing,
        insuranceExpiryDate,
        technicalInspectionExpiryDate,
        vignetteExpiryDate,
        garage,
        service,
        isDateBasedPrice,
        dateBasedPrices,
        blockOnPay,
      } = body

      const targetSupplier = sessionUser.type === bookcarsTypes.UserType.Admin
        ? supplier
        : agencySupplierId(req)
      if (!targetSupplier || !mongoose.isValidObjectId(targetSupplier) || !(await User.exists({ _id: targetSupplier, type: bookcarsTypes.UserType.Supplier }))) {
        res.status(400).send('Invalid supplier')
        return
      }
      const validatedSupplierId = targetSupplier
      if (!(await validateLocationsForSupplier(locations, validatedSupplierId))) {
        res.status(400).send('Invalid locations for supplier')
        return
      }

      car.supplier = new mongoose.Types.ObjectId(targetSupplier)
      car.minimumAge = minimumAge
      car.locations = locations.map((l) => new mongoose.Types.ObjectId(l))
      car.name = name
      car.licensePlate = licensePlate
      car.available = available
      car.fullyBooked = fullyBooked
      car.comingSoon = comingSoon
      // Fleet statuses (scorecard #15): an absent status leaves the
      // stored value untouched (a legacy client never clears it).
      if (operationalStatus !== undefined) {
        car.operationalStatus = operationalStatus as bookcarsTypes.CarOperationalStatus
      }
      car.type = type as bookcarsTypes.CarType
      car.dailyPrice = dailyPrice
      car.discountedDailyPrice = discountedDailyPrice
      car.hourlyPrice = hourlyPrice
      car.discountedHourlyPrice = discountedHourlyPrice
      car.biWeeklyPrice = biWeeklyPrice
      car.discountedBiWeeklyPrice = discountedBiWeeklyPrice
      car.weeklyPrice = weeklyPrice
      car.discountedWeeklyPrice = discountedWeeklyPrice
      car.monthlyPrice = monthlyPrice
      car.discountedMonthlyPrice = discountedMonthlyPrice
      car.deposit = deposit
      car.seats = seats
      car.doors = doors
      car.aircon = aircon
      car.gearbox = gearbox as bookcarsTypes.GearboxType
      car.fuelPolicy = fuelPolicy as bookcarsTypes.FuelPolicy
      car.mileage = mileage
      car.cancellation = cancellation
      car.amendments = amendments
      car.theftProtection = theftProtection
      car.collisionDamageWaiver = collisionDamageWaiver
      car.fullInsurance = fullInsurance
      car.additionalDriver = additionalDriver
      car.range = range
      car.multimedia = multimedia
      car.rating = rating
      car.co2 = co2
      if (tankCapacityLitres !== undefined) {
        // Assign the raw value and let the schema's min: 0 validation
        // reject a negative capacity (400) instead of silently clearing.
        car.tankCapacityLitres = tankCapacityLitres === null ? undefined : Number(tankCapacityLitres)
      }
      // GA-PAR-08: financing block + document expiry dates, following the
      // tank-capacity discipline above — a field absent from the payload
      // (undefined) is left untouched, an explicit null/'' clears exactly
      // that field, any other value is assigned raw (normalised only for
      // numbers/dates) so the schema validators reject bad values (400).
      // The financing block merges field by field: an update carrying
      // only some financing fields preserves the rest.
      if (financing !== undefined) {
        if (financing === null) {
          car.financing = undefined
        } else {
          if (!car.financing) {
            car.financing = {}
          }
          if (financing.type !== undefined) {
            car.financing.type = isClearValue(financing.type) ? undefined : financing.type as bookcarsTypes.CarFinancingType
          }
          for (const field of FINANCING_AMOUNT_FIELDS) {
            if (financing[field] !== undefined) {
              car.financing[field] = isClearValue(financing[field]) ? undefined : Number(financing[field])
            }
          }
          if (financing.lender !== undefined) {
            car.financing.lender = isClearValue(financing.lender) ? undefined : financing.lender as string
          }
          for (const field of FINANCING_DATE_FIELDS) {
            if (financing[field] !== undefined) {
              car.financing[field] = isClearValue(financing[field]) ? undefined : new Date(financing[field] as string)
            }
          }
          if (financing.autoDebit !== undefined) {
            car.financing.autoDebit = isClearValue(financing.autoDebit) ? undefined : financing.autoDebit as boolean
          }
        }
      }
      if (insuranceExpiryDate !== undefined) {
        car.insuranceExpiryDate = normalizeDocumentDate(insuranceExpiryDate)
      }
      if (technicalInspectionExpiryDate !== undefined) {
        car.technicalInspectionExpiryDate = normalizeDocumentDate(technicalInspectionExpiryDate)
      }
      if (vignetteExpiryDate !== undefined) {
        car.vignetteExpiryDate = normalizeDocumentDate(vignetteExpiryDate)
      }
      // Scorecard #17: garage block, following the financing merge
      // discipline — absent leaves the stored block untouched, null clears
      // the whole block, an object merges field by field (null/'' clears
      // exactly that field). A merge that clears every field stores the
      // block as absent, never as an empty sub-document.
      if (garage !== undefined) {
        if (garage === null) {
          car.garage = undefined
        } else {
          if (!car.garage) {
            car.garage = {}
          }
          if (garage.garageName !== undefined) {
            car.garage.garageName = isClearValue(garage.garageName) || (typeof garage.garageName === 'string' && garage.garageName.trim().length === 0)
              ? undefined
              : (garage.garageName as string).trim()
          }
          if (garage.since !== undefined) {
            car.garage.since = isClearValue(garage.since) ? undefined : new Date(garage.since as string)
          }
          if (garage.expectedBack !== undefined) {
            car.garage.expectedBack = isClearValue(garage.expectedBack) ? undefined : new Date(garage.expectedBack as string)
          }
          if (!car.garage.garageName && !car.garage.since && !car.garage.expectedBack) {
            car.garage = undefined
          }
        }
      }
      // Scorecard #18: service state, following the garage merge
      // discipline — absent leaves the stored block untouched, null clears
      // the whole block, an object merges field by field (null/'' clears
      // exactly that field). A merge that clears every field stores the
      // block as absent, never as an empty sub-document. The merged
      // next >= last rule was already checked above, so the merge itself
      // cannot create an invalid pair.
      if (service !== undefined) {
        if (service === null) {
          car.service = undefined
        } else {
          if (!car.service) {
            car.service = {}
          }
          for (const field of SERVICE_KM_FIELDS) {
            if (service[field] !== undefined) {
              car.service[field] = isClearValue(service[field]) ? undefined : Number(service[field])
            }
          }
          if (car.service.lastOilChangeKm === undefined && car.service.lastFilterChangeKm === undefined
            && car.service.nextOilChangeKm === undefined && car.service.nextFilterChangeKm === undefined) {
            car.service = undefined
          }
        }
      }
      car.isDateBasedPrice = isDateBasedPrice
      car.blockOnPay = blockOnPay

      //
      // Date based prices
      //

      // Ignore incomplete draft rows from the admin editor. The form can submit an
      // empty row when a user starts adding a seasonal price but does not finish it.
      // Persisting that row makes DateBasedPrice schema validation fail and blocks
      // saving the otherwise valid vehicle.
      const normalizedDateBasedPrices = validDateBasedPrices(dateBasedPrices)

      // Remove all date based prices not in the valid body.dateBasedPrices rows.
      const dateBasedPriceIds = normalizedDateBasedPrices.filter((dbp) => !!dbp._id).map((dbp) => dbp._id)
      const dateBasedPriceIdsToDelete = car.dateBasedPrices.filter((id) => !dateBasedPriceIds.includes(id.toString()))
      if (dateBasedPriceIdsToDelete.length > 0) {
        for (const dbpId of dateBasedPriceIdsToDelete) {
          car.dateBasedPrices.splice(car.dateBasedPrices.indexOf(dbpId), 1)
        }

        await DateBasedPrice.deleteMany({ _id: { $in: dateBasedPriceIdsToDelete } })
      }

      // Add all new date based prices
      for (const dateBasedPrice of normalizedDateBasedPrices.filter((dbp) => dbp._id === undefined)) {
        const dbpId = await createDateBasedPrice(dateBasedPrice)
        car.dateBasedPrices.push(new mongoose.Types.ObjectId(dbpId))
      }

      // Update existing date based prices
      for (const dateBasedPrice of normalizedDateBasedPrices.filter((dbp) => !!dbp._id)) {
        const dbp = await DateBasedPrice.findById(dateBasedPrice._id)
        if (dbp) {
          dbp.startDate = new Date(dateBasedPrice.startDate!)
          dbp.endDate = new Date(dateBasedPrice.endDate!)
          dbp.dailyPrice = Number(dateBasedPrice.dailyPrice)

          await dbp.save()
        }
      }

      await car.save()

      res.json(car)
      return
    }

    logger.error('[car.update] Car not found:', _id)
    res.sendStatus(204)
  } catch (err) {
    logger.error(`[car.update] ${i18n.t('ERROR')} ${_id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Check if a Car is related to bookings.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const checkCar = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const _id = new mongoose.Types.ObjectId(id)
    if (req.user?.type !== bookcarsTypes.UserType.Admin) {
      // Scope the check to the caller's agency: without this, any agency
      // could probe whether another agency's car has bookings.
      const agencyId = agencySupplierId(req)
      const ownCar = agencyId
        ? await Car.findOne({ _id, supplier: new mongoose.Types.ObjectId(agencyId) }).select('_id').lean()
        : null
      if (!ownCar) {
        res.sendStatus(204)
        return
      }
    }
    const count = await Booking
      .find({ car: _id })
      .limit(1)
      .countDocuments()

    if (count === 1) {
      res.sendStatus(200)
      return
    }

    res.sendStatus(204)
  } catch (err) {
    logger.error(`[car.check] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Validate if a license plate is unique.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const validateLicensePlate = async (req: Request, res: Response) => {
  const { licensePlate } = req.params

  try {
    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    // GA-PAR-22: a trashed car is absent for plate validation, so a
    // new car can reuse its plate (200).
    const filter: Record<string, unknown> = { licensePlate, deletedAt: null }
    if (sessionUser?.type !== bookcarsTypes.UserType.Admin) {
      const supplierId = agencySupplierId(req)
      if (!supplierId) {
        res.status(403).send('Agency membership is required')
        return
      }
      filter.supplier = supplierId
    }
    const car = await Car.findOne(filter)
    if (car) {
      res.sendStatus(204)
    } else {
      res.sendStatus(200)
    }
  } catch (err) {
    logger.error(`[car.validateLicensePlate] ${i18n.t('ERROR')} ${licensePlate}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Validate if a license plate is unique for updating car.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const validateCarLicensePlate = async (req: Request, res: Response) => {
  const { id, licensePlate } = req.params

  try {
    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    // GA-PAR-22: a trashed car is absent for plate validation.
    const filter: Record<string, unknown> = { _id: { $ne: id }, licensePlate, deletedAt: null }
    if (sessionUser?.type !== bookcarsTypes.UserType.Admin) {
      const supplierId = agencySupplierId(req)
      if (!supplierId) {
        res.status(403).send('Agency membership is required')
        return
      }
      filter.supplier = supplierId
    }
    const car = await Car.findOne(filter)
    if (car) {
      res.sendStatus(204)
    } else {
      res.sendStatus(200)
    }
  } catch (err) {
    logger.error(`[car.validateLicensePlate] ${i18n.t('ERROR')} ${licensePlate}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Delete a Car by ID.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const deleteCar = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    // GA-PAR-22: hard delete is purge-from-trash ONLY (D-22.9). The
    // reason is required (3–1000 chars, D-22.4); a live car refuses
    // 409 NOT_TRASHED. The any-history 409 is UNCHANGED (it counts
    // all bookings, live and trashed — D-22.11), so a car with live
    // bookings is retired by trash and can essentially never be
    // purged. Called only from the Trash view.
    const reason = (req.body as { reason?: unknown } | undefined)?.reason
    if (!isValidTrashReason(reason)) {
      res.status(400).send('PURGE_REASON: Purging a trashed car requires a reason of 3 to 1000 characters.')
      return
    }
    const car = await Car.findById(id)
    if (car) {
      // begin of security check
      const sessionUserId = req.user?._id
      const sessionUser = await User.findById(sessionUserId)
      const sessionAgencyId = agencySupplierId(req)
      const isAgencyUser = !!sessionUser && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
      if (!sessionUser || (isAgencyUser && car.supplier?.toString() !== sessionAgencyId)) {
        logger.error(`[car.delete] Unauthorized attempt to delete car ${car._id} by user ${sessionUserId}`)
        res.status(403).send('Forbidden: You cannot delete this car')
        return
      }
      // end of security check

      if (!car.deletedAt) {
        res.status(409).send(`NOT_TRASHED: Car ${car._id.toString()} is not trashed. Trash it before purging.`)
        return
      }

      // Preserve contract and payment history. Vehicles with booking history are retired, not deleted.
      const bookingCount = await Booking.countDocuments({ car: car._id })
      if (bookingCount > 0) {
        res.status(409).send('Conflict: This car has booking history and cannot be deleted. Mark it unavailable instead.')
        return
      }

      await Car.deleteOne({ _id: id })
      // D-22.8: exactly one server-log line per purged id.
      logger.info(`[car.delete] Purged car ${car._id.toString()} by user ${sessionUserId} (reason: ${(reason as string).trim()})`)

      if (car.dateBasedPrices?.length > 0) {
        await DateBasedPrice.deleteMany({ _id: { $in: car.dateBasedPrices } })
      }

      if (car.image) {
        const image = path.join(env.CDN_CARS, car.image)
        if (await helper.pathExists(image)) {
          await asyncFs.unlink(image)
        }
      }
    } else {
      res.sendStatus(204)
      return
    }
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[car.delete] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Upload a Car image to temp folder.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const createImage = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      throw new Error('[car.createImage] req.file not found')
    }

    const filename = `${req.user?._id}_${helper.getFilenameWithoutExtension(req.file.originalname)}_${nanoid()}_${Date.now()}${path.extname(req.file.originalname)}`
    const filepath = path.join(env.CDN_TEMP_CARS, filename)

    // security check: restrict allowed extensions
    const ext = path.extname(filename)
    if (!env.allowedImageExtensions.includes(ext.toLowerCase())) {
      res.status(400).send('Invalid car image file type')
      return
    }

    if (!contentMatchesExtension(req.file.buffer, ext)) {
      res.status(400).send('Invalid car image file type')
      return
    }

    await asyncFs.writeFile(filepath, req.file.buffer)
    res.json(filename)
  } catch (err) {
    logger.error(`[car.createImage] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Update a Car image.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const updateImage = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    if (!req.file) {
      const msg = '[car.updateImage] req.file not found'
      logger.error(msg)
      res.status(400).send(msg)
      return
    }

    const { file } = req

    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    const car = await Car.findById(id)
    if (!car) {
      res.sendStatus(204)
      return
    }
    const sessionAgencyId = agencySupplierId(req)
    const canManage = !!sessionUser && (sessionUser.type === bookcarsTypes.UserType.Admin || car.supplier?.toString() === sessionAgencyId)
    if (!canManage) {
      res.status(403).send('Forbidden: You cannot update this car image')
      return
    }

    if (car) {
      // GA-PAR-22: a trashed car's image cannot change.
      if (car.deletedAt) {
        res.status(409).send(trashedMessage('car'))
        return
      }
      if (car.image) {
        const image = path.join(env.CDN_CARS, car.image)
        if (await helper.pathExists(image)) {
          await asyncFs.unlink(image)
        }
      }

      const filename = `${car._id}_${Date.now()}${path.extname(file.originalname)}`
      const filepath = path.join(env.CDN_CARS, filename)

      // security check: restrict allowed extensions
      const ext = path.extname(filename)
      if (!env.allowedImageExtensions.includes(ext.toLowerCase())) {
        res.status(400).send('Invalid car image file type')
        return
      }

      if (!contentMatchesExtension(file.buffer, ext)) {
        res.status(400).send('Invalid car image file type')
        return
      }

      await asyncFs.writeFile(filepath, file.buffer)
      car.image = filename
      await car.save()
      res.json(filename)
      return
    }

    logger.error('[car.updateImage] Car not found:', id)
    res.sendStatus(204)
  } catch (err) {
    logger.error(`[car.updateImage] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Delete a Car image.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const deleteImage = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const sessionUser = req.user?._id ? await User.findById(req.user._id).select('_id type') : null
    const car = await Car.findById(id)
    if (!car) {
      res.sendStatus(204)
      return
    }
    const sessionAgencyId = agencySupplierId(req)
    const canManage = !!sessionUser && (sessionUser.type === bookcarsTypes.UserType.Admin || car.supplier?.toString() === sessionAgencyId)
    if (!canManage) {
      res.status(403).send('Forbidden: You cannot delete this car image')
      return
    }

    if (car) {
      // GA-PAR-22: a trashed car's image cannot be deleted.
      if (car.deletedAt) {
        res.status(409).send(trashedMessage('car'))
        return
      }
      if (car.image) {
        const image = path.join(env.CDN_CARS, car.image)
        if (await helper.pathExists(image)) {
          await asyncFs.unlink(image)
        }
      }
      car.image = null

      await car.save()
      res.sendStatus(200)
      return
    }
    logger.error('[car.deleteImage] Car not found:', id)
    res.sendStatus(204)
  } catch (err) {
    logger.error(`[car.deleteImage] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Delete a temp Car image.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {*}
 */
export const deleteTempImage = async (req: Request, res: Response) => {
  const { image } = req.params

  try {
    // prevent null bytes
    if (image.includes('\0')) {
      res.status(400).send('Invalid filename')
      return
    }

    const sessionUser = req.user
    if (!sessionUser || !canDeleteOwnedTempFile(sessionUser, image)) {
      res.status(403).send('Forbidden')
      return
    }

    const baseDir = path.resolve(env.CDN_TEMP_CARS)
    const targetPath = path.resolve(baseDir, image)

    // critical security check: prevent directory traversal
    if (!targetPath.startsWith(baseDir + path.sep)) {
      logger.warn(`Directory traversal attempt: ${image}`)
      res.status(403).send('Forbidden')
      return
    }

    if (await helper.pathExists(targetPath)) {
      await asyncFs.unlink(targetPath)
    } else {
      throw new Error(`[car.deleteTempImage] temp image ${image} not found`)
    }

    res.sendStatus(200)
  } catch (err) {
    logger.error(`[car.deleteTempImage] ${i18n.t('ERROR')} ${image}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Get a Car by ID.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getCar = async (req: Request, res: Response) => {
  const { id, language } = req.params

  try {
    const car = await Car.findById(id)
      .populate<{ supplier: env.UserInfo }>('supplier')
      .populate<{ dateBasedPrices: env.DateBasedPrice[] }>('dateBasedPrices')
      .populate<{ locations: env.LocationInfo[] }>({
        path: 'locations',
        populate: {
          path: 'values',
          model: 'LocationValue',
        },
      })
      .lean()

    if (car) {
      // GA-PAR-22: `getCar` is public, so a trashed car is returned
      // only to the owning agency / platform admin; every other
      // caller (public, foreign agency) gets a silent 204. The route
      // carries `authJwt.verifyTokenOptional` so `req.user` is set
      // when a session exists and absent for public callers.
      const sessionUser = req.user
      const sessionAgencyId = agencySupplierId(req)
      const isAgencyCaller = !!sessionUser
        && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
        && car.supplier._id?.toString() === sessionAgencyId
      const isAdminCaller = sessionUser?.type === bookcarsTypes.UserType.Admin
      if (car.deletedAt && !isAgencyCaller && !isAdminCaller) {
        res.sendStatus(204)
        return
      }

      const {
        _id,
        fullName,
        avatar,
        payLater,
        licenseRequired,
        priceChangeRate,
      } = car.supplier
      car.supplier = {
        _id,
        fullName,
        avatar,
        payLater,
        licenseRequired,
        priceChangeRate,
      }

      for (const location of car.locations) {
        location.name = location.values.filter((value) => value.language === language)[0].value
      }

      res.json(car)
      return
    }
    logger.error('[car.getCar] Car not found:', id)
    res.sendStatus(204)
  } catch (err) {
    logger.error(`[car.getCar] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Get Cars.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getCars = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.GetCarsPayload } = req
    const page = Number.parseInt(req.params.page, 10)
    const size = Number.parseInt(req.params.size, 10)
    const agencyId = agencySupplierId(req)
    const suppliers = req.user?.type !== bookcarsTypes.UserType.Admin && agencyId
      ? [new mongoose.Types.ObjectId(agencyId)]
      : body.suppliers!.map((id) => new mongoose.Types.ObjectId(id))
    const {
      carType,
      gearbox,
      mileage,
      deposit,
      availability,
      fleetStatus,
      fuelPolicy,
      carSpecs,
      ranges,
      multimedia,
      rating,
      seats,
    } = body
    // Fleet statuses (scorecard #15): the status filter takes one of the
    // four derived statuses; anything else is a 400.
    if (fleetStatus !== undefined && !isFleetStatus(fleetStatus)) {
      res.status(400).send('Invalid fleet status')
      return
    }
    const keyword = escapeStringRegexp(String(req.query.s || ''))
    const options = 'i'

    const $match: mongoose.QueryFilter<bookcarsTypes.Car> = {
      $and: [
        { $or: [{ name: { $regex: keyword, $options: options } }, { licensePlate: { $regex: keyword, $options: options } }] },
        { supplier: { $in: suppliers } },
        // GA-PAR-22: live cars only — trashed cars never leak into the
        // live list (the trash view has its own endpoint).
        { deletedAt: null },
      ],
    }

    if (fuelPolicy) {
      $match.$and!.push({ fuelPolicy: { $in: fuelPolicy } })
    }

    if (carSpecs) {
      if (carSpecs.aircon) {
        $match.$and!.push({ aircon: true })
      }
      if (carSpecs.moreThanFourDoors) {
        $match.$and!.push({ doors: { $gt: 4 } })
      }
      if (carSpecs.moreThanFiveSeats) {
        $match.$and!.push({ seats: { $gt: 5 } })
      }
    }

    if (carType) {
      $match.$and!.push({ type: { $in: carType } })
    }

    if (gearbox) {
      $match.$and!.push({ gearbox: { $in: gearbox } })
    }

    if (mileage) {
      if (mileage.length === 1 && mileage[0] === bookcarsTypes.Mileage.Limited) {
        $match.$and!.push({ mileage: { $gt: -1 } })
      } else if (mileage.length === 1 && mileage[0] === bookcarsTypes.Mileage.Unlimited) {
        $match.$and!.push({ mileage: -1 })
      } else if (mileage.length === 0) {
        res.json([{ resultData: [], pageInfo: [], fleetStatusCounts: emptyFleetStatusCounts() }])
        return
      }
    }

    if (deposit && deposit > -1) {
      $match.$and!.push({ deposit: { $lte: deposit } })
    }

    if (Array.isArray(availability)) {
      if (availability.length === 1 && availability[0] === bookcarsTypes.Availablity.Available) {
        $match.$and!.push({ available: true })
      } else if (availability.length === 1
        && availability[0] === bookcarsTypes.Availablity.Unavailable) {
        $match.$and!.push({ available: false })
      } else if (availability.length === 0) {
        res.json([{ resultData: [], pageInfo: [], fleetStatusCounts: emptyFleetStatusCounts() }])
        return
      }
    }

    if (ranges) {
      $match.$and!.push({ range: { $in: ranges } })
    }

    if (multimedia && multimedia.length > 0) {
      for (const multimediaOption of multimedia) {
        $match.$and!.push({ multimedia: multimediaOption })
      }
    }

    if (rating && rating > -1) {
      $match.$and!.push({ rating: { $gte: rating } })
    }

    if (seats) {
      if (seats > -1) {
        if (seats === 6) {
          $match.$and!.push({ seats: { $gt: 5 } })
        } else {
          $match.$and!.push({ seats })
        }
      }
    }

    // Fleet statuses (scorecard #15): counts + rented set over the SAME
    // filtered set as the list, BEFORE the fleetStatus filter is applied
    // (so switching filters keeps the counts stable and the counts
    // always match the rows the list can show).
    const { counts: fleetStatusCounts, rentedCarIds } = await fleetStatusForList($match.$and || [], suppliers)

    if (fleetStatus) {
      if (fleetStatus === 'maintenance') {
        $match.$and!.push({ operationalStatus: bookcarsTypes.CarOperationalStatus.Maintenance })
      } else if (fleetStatus === 'stopped') {
        $match.$and!.push({ operationalStatus: bookcarsTypes.CarOperationalStatus.Stopped })
      } else if (fleetStatus === 'rented') {
        // Scorecard #15 FIX: aggregate $match does NOT cast strings to
        // ObjectId, so the rented ids must be ObjectIds here (the counts
        // path uses countDocuments, which casts, and stayed correct).
        $match.$and!.push({ operationalStatus: { $in: [bookcarsTypes.CarOperationalStatus.InService, null] }, _id: { $in: [...rentedCarIds].map((id) => new mongoose.Types.ObjectId(id)) } })
      } else {
        // 'available': in service, available, WITHOUT a live booking.
        $match.$and!.push({ operationalStatus: { $in: [bookcarsTypes.CarOperationalStatus.InService, null] }, available: true, _id: { $nin: [...rentedCarIds].map((id) => new mongoose.Types.ObjectId(id)) } })
      }
    }

    const data = await Car.aggregate(
      [
        { $match },
        {
          $lookup: {
            from: 'User',
            localField: 'supplier',
            foreignField: '_id',
            as: 'supplier',
          },
        },
        { $unwind: '$supplier' },
        // {
        //   $lookup: {
        //     from: 'Location',
        //     let: { locations: '$locations' },
        //     pipeline: [
        //       {
        //         $match: {
        //           $expr: { $in: ['$_id', '$$locations'] },
        //         },
        //       },
        //     ],
        //     as: 'locations',
        //   },
        // },
        {
          $facet: {
            resultData: [
              { $sort: { updatedAt: -1, _id: 1 } },
              { $skip: (page - 1) * size },
              { $limit: size },
            ],
            pageInfo: [
              {
                $group: {
                  _id: null,
                  totalRecords: { $sum: 1 },
                },
              },
            ],
          },
        },
      ],
      { collation: { locale: env.DEFAULT_LANGUAGE, strength: 2 } },
    )

    // const data = await Car.aggregate(
    //   [
    //     { $match },
    //     {
    //       $lookup: {
    //         from: 'User',
    //         let: { userId: '$supplier' },
    //         pipeline: [
    //           {
    //             $match: {
    //               $expr: { $eq: ['$_id', '$$userId'] },
    //             },
    //           },
    //         ],
    //         as: 'supplier',
    //       },
    //     },
    //     { $unwind: { path: '$supplier', preserveNullAndEmptyArrays: false } },
    //     // {
    //     //   $lookup: {
    //     //     from: 'Location',
    //     //     let: { locations: '$locations' },
    //     //     pipeline: [
    //     //       {
    //     //         $match: {
    //     //           $expr: { $in: ['$_id', '$$locations'] },
    //     //         },
    //     //       },
    //     //     ],
    //     //     as: 'locations',
    //     //   },
    //     // },
    //     {
    //       $facet: {
    //         resultData: [{ $sort: { updatedAt: -1, _id: 1 } }, { $skip: (page - 1) * size }, { $limit: size }],
    //         // resultData: [{ $sort: { dailyPrice: 1, _id: 1 } }, { $skip: (page - 1) * size }, { $limit: size }],
    //         pageInfo: [
    //           {
    //             $count: 'totalRecords',
    //           },
    //         ],
    //       },
    //     },
    //   ],
    //   { collation: { locale: env.DEFAULT_LANGUAGE, strength: 2 } },
    // )

    for (const car of data[0].resultData) {
      const { _id, fullName, avatar } = car.supplier
      car.supplier = { _id, fullName, avatar }
      // GA-PAR-22: lists carry the trash scalars but never the history (§3).
      delete (car as Record<string, unknown>).trashHistory
      // Fleet statuses (scorecard #15): derived display status of the
      // row (`unavailable` rows carry none — they belong to none of the
      // four counted statuses).
      const fleetStatusOfCar = deriveFleetStatus(car, rentedCarIds)
      if (fleetStatusOfCar !== 'unavailable') {
        car.fleetStatus = fleetStatusOfCar
      }
    }
    ;(data[0] as bookcarsTypes.ResultData<bookcarsTypes.Car>).fleetStatusCounts = fleetStatusCounts

    res.json(data)
  } catch (err) {
    logger.error(`[car.getCars] ${i18n.t('ERROR')} ${req.query.s}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Get Cars by Supplier and pick-up Location.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getBookingCars = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.GetBookingCarsPayload } = req
    const agencyId = agencySupplierId(req)
    const supplier = new mongoose.Types.ObjectId(req.user?.type !== bookcarsTypes.UserType.Admin && agencyId ? agencyId : body.supplier)
    const pickupLocation = new mongoose.Types.ObjectId(body.pickupLocation)
    const keyword = escapeStringRegexp(String(req.query.s || ''))
    const options = 'i'
    const page = Number.parseInt(req.params.page, 10)
    const size = Number.parseInt(req.params.size, 10)

    const cars = await Car.aggregate(
      [
        {
          $lookup: {
            from: 'User',
            let: { userId: '$supplier' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$_id', '$$userId'] },
                },
              },
            ],
            as: 'supplier',
          },
        },
        { $unwind: { path: '$supplier', preserveNullAndEmptyArrays: false } },
        {
          $match: {
            $and: [
              { 'supplier._id': supplier },
              { locations: pickupLocation },
              // GA-PAR-22: a trashed car cannot be selected for a booking.
              { deletedAt: null },
              { available: true },
              // Scorecard #15: maintenance/stopped cars are never offered
              // in the booking-create picker (legacy cars have no stored
              // status, so null stays bookable); the 403 refusal at submit
              // remains the enforcement backstop.
              { operationalStatus: { $in: [bookcarsTypes.CarOperationalStatus.InService, null] } },
              { name: { $regex: keyword, $options: options } },
            ],
          },
        },
        { $sort: { name: 1, _id: 1 } },
        { $skip: (page - 1) * size },
        { $limit: size },
      ],
      { collation: { locale: env.DEFAULT_LANGUAGE, strength: 2 } },
    )

    for (const car of cars) {
      const { _id, fullName, avatar, priceChangeRate } = car.supplier
      car.supplier = { _id, fullName, avatar, priceChangeRate }
    }

    res.json(cars)
  } catch (err) {
    logger.error(`[car.getBookingCars] ${i18n.t('ERROR')} ${req.query.s}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Get Cars available for rental.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getFrontendCars = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.GetCarsPayload } = req
    const page = Number.parseInt(req.params.page, 10)
    const size = Number.parseInt(req.params.size, 10)
    const suppliers = body.suppliers!.map((id) => new mongoose.Types.ObjectId(id))
    const pickupLocation = new mongoose.Types.ObjectId(body.pickupLocation)
    const {
      carType,
      gearbox,
      mileage,
      fuelPolicy,
      deposit,
      carSpecs,
      ranges,
      multimedia,
      rating,
      seats,
      from,
      to,
      includeAlreadyBookedCars,
      includeComingSoonCars,
    } = body

    if (!from) {
      throw new Error('from date is required')
    }

    if (!to) {
      throw new Error('to date is required')
    }

    // Include pickupLocation and child locations in search results
    const locIds = await Location.find({
      $or: [
        { _id: pickupLocation },
        { parentLocation: pickupLocation },
      ],
    }).select('_id').lean()

    const locationIds = locIds.map((loc) => loc._id)

    const $match: mongoose.QueryFilter<bookcarsTypes.Car> = {
      $and: [
        { supplier: { $in: suppliers } },
        // { locations: pickupLocation },
        { locations: { $in: locationIds } },
        { type: { $in: carType } },
        { gearbox: { $in: gearbox } },
        { available: true },
        { fullyBooked: { $in: [false, null] } },
        // Fleet statuses (scorecard #15): the public site never shows a
        // car in maintenance or stopped (absent = legacy inService).
        { operationalStatus: { $in: [bookcarsTypes.CarOperationalStatus.InService, null] } },
        // GA-PAR-22: the public site never shows a trashed car.
        { deletedAt: null },
      ],
    }

    if (!includeAlreadyBookedCars) {
      $match.$and!.push({ $or: [{ fullyBooked: false }, { fullyBooked: null }] })
    }

    if (!includeComingSoonCars) {
      $match.$and!.push({ $or: [{ comingSoon: false }, { comingSoon: null }] })
    }

    if (fuelPolicy) {
      $match.$and!.push({ fuelPolicy: { $in: fuelPolicy } })
    }

    if (carSpecs) {
      if (carSpecs.aircon) {
        $match.$and!.push({ aircon: true })
      }
      if (carSpecs.moreThanFourDoors) {
        $match.$and!.push({ doors: { $gt: 4 } })
      }
      if (carSpecs.moreThanFiveSeats) {
        $match.$and!.push({ seats: { $gt: 5 } })
      }
    }

    if (mileage) {
      if (mileage.length === 1 && mileage[0] === bookcarsTypes.Mileage.Limited) {
        $match.$and!.push({ mileage: { $gt: -1 } })
      } else if (mileage.length === 1 && mileage[0] === bookcarsTypes.Mileage.Unlimited) {
        $match.$and!.push({ mileage: -1 })
      } else if (mileage.length === 0) {
        res.json([{ resultData: [], pageInfo: [] }])
        return
      }
    }

    if (deposit && deposit > -1) {
      $match.$and!.push({ deposit: { $lte: deposit } })
    }

    if (ranges) {
      $match.$and!.push({ range: { $in: ranges } })
    }

    if (multimedia && multimedia.length > 0) {
      for (const multimediaOption of multimedia) {
        $match.$and!.push({ multimedia: multimediaOption })
      }
    }

    if (rating && rating > -1) {
      $match.$and!.push({ rating: { $gte: rating } })
    }

    if (seats) {
      if (seats > -1) {
        if (seats === 6) {
          $match.$and!.push({ seats: { $gt: 5 } })
        } else {
          $match.$and!.push({ seats })
        }
      }
    }

    let $supplierMatch: mongoose.QueryFilter<any> = {}
    const days = helper.days(from, to)
    if (days) {
      $supplierMatch = { $or: [{ 'supplier.minimumRentalDays': { $lte: days } }, { 'supplier.minimumRentalDays': null }] }
    }

    const data = await Car.aggregate(
      [
        { $match },
        {
          $lookup: {
            from: 'User',
            let: { userId: '$supplier' },
            pipeline: [
              {
                $match: {
                  // $expr: { $eq: ['$_id', '$$userId'] },
                  $and: [{ $expr: { $eq: ['$_id', '$$userId'] } }, { blacklisted: false }]
                },
              },
              {
                $project: {
                  _id: 1,
                  fullName: 1,
                  avatar: 1,
                  priceChangeRate: 1,
                },
              }
            ],
            as: 'supplier',
          },
        },
        { $unwind: { path: '$supplier', preserveNullAndEmptyArrays: false } },
        {
          $match: $supplierMatch,
        },
        {
          $lookup: {
            from: 'DateBasedPrice',
            let: { dateBasedPrices: '$dateBasedPrices' },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ['$_id', '$$dateBasedPrices'] },
                },
              },
            ],
            as: 'dateBasedPrices',
          },
        },
        // {
        //   $lookup: {
        //     from: 'Location',
        //     let: { locations: '$locations' },
        //     pipeline: [
        //       {
        //         $match: {
        //           $expr: { $in: ['$_id', '$$locations'] },
        //         },
        //       },
        //     ],
        //     as: 'locations',
        //   },
        // },

        // begining of booking overlap check -----------------------------------
        // if car.blockOnPay is true and (from, to) overlaps with paid, confirmed or deposit bookings of the car the car will
        // not be included in search results
        // ----------------------------------------------------------------------
        {
          $lookup: {
            from: 'Booking',
            let: { carId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$car', '$$carId'] },
                      {
                        // Match only bookings that overlap with the requested rental period
                        // (i.e., NOT completely before or after the requested time range)
                        $not: [
                          {
                            $or: [
                              // Booking ends before the requested rental period starts → no overlap
                              { $lt: ['$to', new Date(from)] },
                              // Booking starts after the requested rental period ends → no overlap
                              { $gt: ['$from', new Date(to)] }
                            ]
                          }
                        ]
                      },
                      {
                        $and: [
                          // Terminal lifecycles (completed/cancelled contracts)
                          // no longer reserve the car (GAQ12B1, mirrors the
                          // enforcement helper's lifecycle exclusion).
                          { $not: { $in: ['$lifecycle', [bookcarsTypes.ContractLifecycle.Completed, bookcarsTypes.ContractLifecycle.Cancelled]] } },
                          {
                            $or: [
                              { $in: ['$status', BOOKING_RESERVATION_STATUSES] },
                              {
                                $and: [
                                  { $eq: ['$status', bookcarsTypes.BookingStatus.Void] },
                                  { $gt: ['$expireAt', new Date()] },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ]
                  }
                }
              }
            ],
            as: 'overlappingBookings'
          }
        },
        {
          $match: {
            $expr: {
              $or: [
                { $eq: [{ $ifNull: ['$blockOnPay', false] }, false] },
                { $eq: [{ $size: '$overlappingBookings' }, 0] }
              ]
            }
          }
        },
        // end of booking overlap check -----------------------------------

        // begining of supplierCarLimit -----------------------------------
        {
          // Add the "supplierCarLimit" field from the supplier to limit the number of cars per supplier
          $addFields: {
            maxAllowedCars: { $ifNull: ['$supplier.supplierCarLimit', Number.MAX_SAFE_INTEGER] }, // Use a fallback if supplierCarLimit is undefined
          },
        },
        {
          // Add a custom stage to limit cars per supplier
          $group: {
            _id: '$supplier._id', // Group by supplier
            supplierData: { $first: '$supplier' },
            cars: { $push: '$$ROOT' }, // Push all cars of the supplier into an array
            maxAllowedCars: { $first: '$maxAllowedCars' }, // Retain maxAllowedCars for each supplier
          },
        },
        {
          // Limit cars based on maxAllowedCars for each supplier
          $project: {
            supplier: '$supplierData',
            cars: {
              $cond: {
                if: { $eq: ['$maxAllowedCars', 0] }, // If maxAllowedCars is 0
                then: [], // Return an empty array (no cars)
                else: { $slice: ['$cars', 0, { $min: [{ $size: '$cars' }, '$maxAllowedCars'] }] }, // Otherwise, limit normally
              },
            },
          },
        },
        {
          // Flatten the grouped result and apply sorting
          $unwind: '$cars',
        },
        {
          // Ensure unique cars by grouping by car ID
          $group: {
            _id: '$cars._id',
            car: { $first: '$cars' },
          },
        },
        {
          $replaceRoot: { newRoot: '$car' }, // Replace the root document with the unique car object
        },
        {
          // Sort the cars before pagination
          $sort: { dailyPrice: 1, _id: 1 },
        },
        {
          $facet: {
            resultData: [
              { $skip: (page - 1) * size }, // Skip results based on page
              { $limit: size }, // Limit to the page size
            ],
            pageInfo: [
              {
                $count: 'totalRecords', // Count total number of cars (before pagination)
              },
            ],
          },
        },
        // end of supplierCarLimit -----------------------------------

        // old query without supplierCarLimit
        // {
        //   $facet: {
        //     resultData: [
        //       {
        //         // $sort: { fullyBooked: 1, comingSoon: 1, dailyPrice: 1, _id: 1 },
        //         $sort: { dailyPrice: 1, _id: 1 },
        //       },
        //       { $skip: (page - 1) * size },
        //       { $limit: size },
        //     ],
        //     pageInfo: [
        //       {
        //         $count: 'totalRecords',
        //       },
        //     ],
        //   },
        // },
      ],
      { collation: { locale: env.DEFAULT_LANGUAGE, strength: 2 } },
    )

    res.json(data)
  } catch (err) {
    logger.error(`[car.getFrontendCars] ${i18n.t('ERROR')} ${req.query.s}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * GA-PAR-22 — Trash Car (scorecard #47, D-22.3/D-22.4).
 *
 * Single-id route (`POST /api/trash-car/:id`, same `pinAgencySelector`
 * shape as `delete-car`). A car with live bookings CAN be trashed —
 * trash IS the retirement the deleteCar 409 message has been
 * prescribing; its bookings stay live and keep reserving. No other
 * refusal besides already-trashed. Exactly the three scalar fields +
 * one history row are written (D-22.2).
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const trashCar = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const reason = (req.body as { reason?: unknown } | undefined)?.reason
    if (!isValidTrashReason(reason)) {
      res.status(400).send('TRASH_REASON: Trashing a car requires a reason of 3 to 1000 characters.')
      return
    }
    const car = await Car.findById(id)
    if (!car) {
      res.sendStatus(204)
      return
    }
    // begin of security check
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    const sessionAgencyId = agencySupplierId(req)
    const isAgencyUser = !!sessionUser && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
    if (!sessionUser || (isAgencyUser && car.supplier?.toString() !== sessionAgencyId)) {
      logger.error(`[car.trashCar] Unauthorized attempt to trash car ${car._id} by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot trash this car')
      return
    }
    // end of security check

    if (car.deletedAt) {
      res.status(409).send(`TRASHED: Car ${car._id.toString()} is already trashed.`)
      return
    }

    applyTrash(car, sessionUser._id.toString(), reason as string)
    await car.save()
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[car.trashCar] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * GA-PAR-22 — Restore Car (scorecard #47, D-22.6).
 *
 * Re-validation, in the design's order: (a) no other LIVE car of the
 * same agency with the same plate else 409 PLATE_IN_USE; (b)
 * `locations` non-empty and every Location still exists else 409
 * LOCATION_MISSING (accepted OQ-6 edge — recovery is
 * purge-and-recreate); (c) the supplier still exists else 409
 * SUPPLIER_MISSING. The reason is optional (≤1000).
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const restoreCar = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const reason = (req.body as { reason?: unknown } | undefined)?.reason
    if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length > 1000)) {
      res.status(400).send('RESTORE_REASON: A restore reason must be at most 1000 characters.')
      return
    }
    const car = await Car.findById(id)
    if (!car) {
      res.sendStatus(204)
      return
    }
    // begin of security check
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    const sessionAgencyId = agencySupplierId(req)
    const isAgencyUser = !!sessionUser && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
    if (!sessionUser || (isAgencyUser && car.supplier?.toString() !== sessionAgencyId)) {
      logger.error(`[car.restoreCar] Unauthorized attempt to restore car ${car._id} by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot restore this car')
      return
    }
    // end of security check

    if (!car.deletedAt) {
      res.status(409).send(`NOT_TRASHED: Car ${car._id.toString()} is not trashed.`)
      return
    }
    if (car.licensePlate) {
      const plateClash = await Car.findOne({
        _id: { $ne: car._id },
        supplier: car.supplier,
        licensePlate: car.licensePlate,
        deletedAt: null,
      }).select('_id').lean()
      if (plateClash) {
        res.status(409).send(`PLATE_IN_USE: Another live car of this agency already uses license plate ${car.licensePlate}.`)
        return
      }
    }
    if (!car.locations || car.locations.length === 0) {
      res.status(409).send(`LOCATION_MISSING: Car ${car._id.toString()} has no locations left to restore into.`)
      return
    }
    const locationCount = await Location.countDocuments({ _id: { $in: car.locations } })
    if (locationCount !== car.locations.length) {
      res.status(409).send(`LOCATION_MISSING: One or more locations of car ${car._id.toString()} no longer exist.`)
      return
    }
    const supplierExists = await User.exists({ _id: car.supplier, type: bookcarsTypes.UserType.Supplier })
    if (!supplierExists) {
      res.status(409).send(`SUPPLIER_MISSING: The supplier of car ${car._id.toString()} no longer exists.`)
      return
    }

    applyRestore(car, sessionUser._id.toString(), typeof reason === 'string' ? reason : undefined)
    await car.save()
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[car.restoreCar] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * GA-PAR-22 — Get Trashed Cars (scorecard #47, §5.2/§5.3).
 *
 * The trash view's read path is a separate dedicated endpoint — live
 * endpoints can never return trashed rows. Same response shape as
 * `getCars` (`{ resultData, pageInfo }` inside the aggregate-style
 * array), same keyword behaviour (name, license plate), sorted by
 * trashed-at descending. Rows carry the trash scalars and the
 * trashed-by name, never the history (§3).
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getTrashedCars = async (req: Request, res: Response) => {
  try {
    const page = Number.parseInt(req.params.page, 10)
    const size = Number.parseInt(req.params.size, 10)
    const agencyId = agencySupplierId(req)
    const suppliers = req.user?.type !== bookcarsTypes.UserType.Admin && agencyId
      ? [new mongoose.Types.ObjectId(agencyId)]
      : (req.body as bookcarsTypes.GetCarsPayload).suppliers!.map((id) => new mongoose.Types.ObjectId(id))
    const keyword = escapeStringRegexp(String(req.query.s || ''))
    const options = 'i'

    const $match: mongoose.QueryFilter<bookcarsTypes.Car> = {
      $and: [
        { $or: [{ name: { $regex: keyword, $options: options } }, { licensePlate: { $regex: keyword, $options: options } }] },
        { supplier: { $in: suppliers } },
        { deletedAt: { $ne: null } },
      ],
    }

    const data = await Car.aggregate(
      [
        { $match },
        {
          $lookup: {
            from: 'User',
            localField: 'supplier',
            foreignField: '_id',
            as: 'supplier',
          },
        },
        { $unwind: '$supplier' },
        {
          $facet: {
            resultData: [
              { $sort: { deletedAt: -1, _id: 1 } },
              { $skip: (page - 1) * size },
              { $limit: size },
            ],
            pageInfo: [
              {
                $group: {
                  _id: null,
                  totalRecords: { $sum: 1 },
                },
              },
            ],
          },
        },
      ],
      { collation: { locale: env.DEFAULT_LANGUAGE, strength: 2 } },
    )

    const rows = data[0].resultData as Record<string, unknown>[]
    if (rows.length > 0) {
      const byIds = rows
        .map((row) => row.deletedBy)
        .filter((id): id is mongoose.Types.ObjectId => !!id)
        .map((id) => id.toString())
      const actors = byIds.length > 0
        ? await User.find({ _id: { $in: byIds.map((id) => new mongoose.Types.ObjectId(id)) } }).select('_id fullName').lean()
        : []
      const names = new Map(actors.map((a) => [a._id.toString(), a.fullName]))
      for (const row of rows) {
        const { _id, fullName, avatar } = row.supplier as { _id: unknown, fullName: string, avatar: string }
        row.supplier = { _id, fullName, avatar }
        delete row.trashHistory
        row.deletedByName = row.deletedBy ? (names.get(String(row.deletedBy)) || '') : ''
      }
    }

    res.json(data)
  } catch (err) {
    logger.error(`[car.getTrashedCars] ${i18n.t('ERROR')} ${req.query.s}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * GA-PAR-22 — Car trash-warning figures (§5.7).
 *
 * Live counts behind the trash confirm dialog: bookings referencing
 * the car, split live / trashed (a trashed car keeps its bookings
 * live, and the purge stays blocked while ANY booking history exists).
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getCarTrashWarning = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const car = await Car.findById(id).select('_id supplier deletedAt').lean()
    if (!car) {
      res.sendStatus(204)
      return
    }
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    const sessionAgencyId = agencySupplierId(req)
    const isAgencyUser = !!sessionUser && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
    if (!sessionUser || (isAgencyUser && car.supplier?.toString() !== sessionAgencyId)) {
      logger.error(`[car.getCarTrashWarning] Forbidden access to car ${id} by user ${sessionUserId}`)
      res.status(403).send('Forbidden: Access denied')
      return
    }

    const [liveBookingsCount, trashedBookingsCount] = await Promise.all([
      Booking.countDocuments({ car: car._id, deletedAt: null }),
      Booking.countDocuments({ car: car._id, deletedAt: { $ne: null } }),
    ])
    const warning: bookcarsTypes.TrashWarning = {
      liveBookingsCount,
      trashedBookingsCount,
      bookingsCount: liveBookingsCount + trashedBookingsCount,
    }
    res.json(warning)
  } catch (err) {
    logger.error(`[car.getCarTrashWarning] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
