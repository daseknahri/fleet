import mongoose from 'mongoose'
import { Request, Response } from 'express'
import * as bookcarsTypes from ':bookcars-types'
import i18n from '../lang/i18n'
import Booking from '../models/Booking'
import User from '../models/User'
import Invoice from '../models/Invoice'
import Car from '../models/Car'
import AdditionalDriver from '../models/AdditionalDriver'
import * as bookcarsHelper from ':bookcars-helper'
import * as helper from '../utils/helper'
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import { agencySupplierId } from '../utils/agencyAuthorization'
import { BookingConflictError, saveBookingWithAvailability } from '../utils/bookingReservationHelper'
import { refreshBookingPaymentStatus } from '../utils/ledger'
import { currencyExponent, toMinorUnits } from '../utils/paymentAmount'
import { findActiveInvoice, refreshDraftInvoiceAfterAmendment } from '../utils/invoiceCreation'
import { populateBookingForDetail, resolveOverlapExceptionGate } from './bookingController'
import { trashedMessage } from '../utils/trash'

/**
 * GA-PAR-11 — contract amendment / extension workflow.
 *
 * POST /api/bookings/:id/amend { from?, to?, reason, overlapException? }
 *
 * This is the ONLY door for changing the dates of a snapshot booking:
 * bookingController.update keeps its 409 "use a contract amendment
 * workflow" lock for direct term edits, unchanged.
 *
 * Rules (PLANNING-SLICES §2.4 + PAR11 builder brief):
 * - agency-scoped load; the caller must be agency staff of the booking's
 *   agency (or a platform Admin, mirroring bookingController.update);
 * - terminal contracts cannot be amended: lifecycle Completed/Cancelled,
 *   status Void/Cancelled, and unfinalised checkout placeholders
 *   (expireAt set) are refused 409;
 * - `reason` is required, 3–1000 chars (house pattern) → 400;
 * - re-pricing uses the ORIGINAL snapshot's rate basis. The financial
 *   snapshot stores NO daily rate (verified: version, currencies, mode,
 *   rentalTotal, depositAmount, amountDueNow(+payment-currency twin),
 *   quotedAt), so the basis daily rate is rentalTotal / original rental
 *   days (helper.days, the price logic's own day count) and is recorded
 *   on the amendment row. Today's car prices are never consulted. For a
 *   snapshot-less booking (admin-created) the booking `price` — the
 *   figure contractReceivable falls back to — is the basis total and a
 *   version-1 snapshot is created on success so later amendments bump
 *   from it;
 * - availability is re-checked through saveBookingWithAvailability
 *   (own id already excluded); a conflict is 409 unless the payload
 *   SEPARATELY carries a valid PAR-10 overlapException AND the caller
 *   is Owner/Manager (the PAR-10 gate is reused verbatim — a stored
 *   exception from an earlier flow never silently carries over, and
 *   maintenance conflicts are never bypassed). The exception record is
 *   stamped only when a conflict was actually bypassed;
 * - on success the financial snapshot is bumped (version + 1,
 *   rentalTotal = new total, quotedAt = now; deposit unchanged),
 *   booking.price mirrors the new rental total, and exactly one
 *   amendmentHistory row is appended. The booking reference (PAR-02)
 *   never changes and the apporteur snapshot is NOT re-rated;
 * - invoice interplay (N10): an Issued invoice refuses the amendment
 *   409 with a message naming its number; a Draft invoice has its
 *   subtotal/total refreshed from the new snapshot in the same request
 *   (tax recomputed by PAR-01's rule via invoiceCreation);
 * - the ledger is untouched: contractReceivable reads the new snapshot
 *   total and floors outstanding at 0, so shortening below posted
 *   payments surfaces as overpayment on the existing surfaces.
 *
 * F4 / W1 #6 — the same endpoint also corrects locations / vehicle /
 * add-ons: reason required, no correction past handover, the (new)
 * vehicle must belong to the agency and serve both locations, re-price
 * from the snapshot basis for add-ons (a vehicle change re-prices
 * fully from the new car's current pricing), draft-invoice refresh,
 * issued-invoice refusal, one history row with the correction recorded.
 * F4 / W1 #17 — a new `from` in the past is refused on contracts that
 * have not started (Draft/Confirmed) when `from` actually moves.
 */
export const amend = async (req: Request, res: Response) => {
  // F4 / W1 #6 — the catch removes an additional-driver row created
  // for this amendment when the availability save conflicts, so the
  // id must live outside the try (the catch cannot see its `let`s).
  let createdAdditionalDriverId: string | undefined
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      res.sendStatus(404)
      return
    }
    const booking = await Booking.findById(id)
    if (!booking) {
      res.sendStatus(404)
      return
    }

    // Agency scope (mirrors bookingController.update's security check).
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    const sessionAgencyId = agencySupplierId(req)
    const isAgencyUser = !!sessionUser && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
    if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User || (isAgencyUser && sessionAgencyId !== booking.supplier?.toString())) {
      logger.error(`[booking.amend] Unauthorized attempt to amend booking ${booking._id.toString()} by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot amend booking information')
      return
    }

    const body = (req.body || {}) as bookcarsTypes.AmendBookingPayload

    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 3 || reason.length > 1000) {
      res.status(400).send('AMENDMENT_REASON: A contract amendment requires a reason of 3 to 1000 characters.')
      return
    }

    // GA-PAR-22: a trashed booking cannot be amended — restore it first.
    if (booking.deletedAt) {
      res.status(409).send(trashedMessage('booking'))
      return
    }

    // Terminal / placeholder contracts cannot be amended.
    const lifecycle = booking.lifecycle || bookcarsTypes.ContractLifecycle.Draft
    if (lifecycle === bookcarsTypes.ContractLifecycle.Completed
      || lifecycle === bookcarsTypes.ContractLifecycle.Cancelled
      || booking.status === bookcarsTypes.BookingStatus.Void
      || booking.status === bookcarsTypes.BookingStatus.Cancelled
      || !!booking.expireAt) {
      res.status(409).send('AMENDMENT_TERMINAL: A void, cancelled, completed or unfinalised booking cannot be amended.')
      return
    }

    // F4 / W1 #6 — correction inputs (locations / vehicle / add-ons).
    // An id may arrive as a bare string or as `{ _id }` (the admin
    // form's shape); anything else is ignored. An option is only a
    // correction when the key is present AND boolean — any other type
    // is a 400, never a silent coercion.
    const idInput = (value: unknown): string | undefined => {
      if (typeof value === 'string') {
        return value.trim() || undefined
      }
      if (value && typeof value === 'object' && '_id' in value && typeof (value as { _id?: unknown })._id === 'string') {
        return ((value as { _id: string })._id || '').trim() || undefined
      }
      return undefined
    }
    const newPickupLocationId = idInput(body.pickupLocation) || booking.pickupLocation.toString()
    const newDropOffLocationId = idInput(body.dropOffLocation) || booking.dropOffLocation.toString()
    const newCarId = idInput(body.car) || booking.car.toString()
    const OPTION_KEYS = ['cancellation', 'amendments', 'theftProtection', 'collisionDamageWaiver', 'fullInsurance', 'additionalDriver'] as const
    type OptionKey = typeof OPTION_KEYS[number]
    const oldOptions: Record<OptionKey, boolean> = {
      cancellation: !!booking.cancellation,
      amendments: !!booking.amendments,
      theftProtection: !!booking.theftProtection,
      collisionDamageWaiver: !!booking.collisionDamageWaiver,
      fullInsurance: !!booking.fullInsurance,
      additionalDriver: !!booking.additionalDriver,
    }
    const providedOptions: Partial<Record<OptionKey, boolean>> = {}
    for (const key of OPTION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        const value = (body as unknown as Record<string, unknown>)[key]
        if (typeof value !== 'boolean') {
          res.status(400).send('AMENDMENT_CORRECTION: Contract option corrections must be true or false.')
          return
        }
        providedOptions[key] = value
      }
    }
    const newOptions: Record<OptionKey, boolean> = { ...oldOptions, ...providedOptions }
    // Additional-driver details (required when turning the option on,
    // forbidden when the resulting option is off).
    const rawDriverDetails = (body as unknown as Record<string, unknown>).additionalDriverDetails
    const driverDetailsProvided = rawDriverDetails !== undefined && rawDriverDetails !== null
    let additionalDriverDetails: { fullName: string, email: string, phone: string, birthDate: Date } | undefined
    if (driverDetailsProvided) {
      const d = rawDriverDetails as Record<string, unknown>
      const birthDate = d.birthDate instanceof Date ? d.birthDate : new Date(d.birthDate as string)
      if (typeof d.fullName !== 'string' || !d.fullName.trim()
        || typeof d.email !== 'string' || !helper.isValidEmail(d.email.trim())
        || typeof d.phone !== 'string' || !d.phone.trim()
        || Number.isNaN(birthDate.getTime())) {
        res.status(400).send('AMENDMENT_ADDITIONAL_DRIVER: Additional driver details need a full name, a valid email, a phone number and a birth date.')
        return
      }
      additionalDriverDetails = { fullName: d.fullName.trim(), email: d.email.trim(), phone: d.phone.trim(), birthDate }
    }
    if (providedOptions.additionalDriver === true && !oldOptions.additionalDriver && !additionalDriverDetails) {
      res.status(400).send('AMENDMENT_ADDITIONAL_DRIVER: Adding an additional driver requires the driver details.')
      return
    }
    if (driverDetailsProvided && newOptions.additionalDriver === false) {
      res.status(400).send('AMENDMENT_ADDITIONAL_DRIVER: Additional driver details cannot be sent while the additional driver option is off.')
      return
    }

    const newFrom = body.from ? new Date(body.from) : new Date(booking.from)
    const newTo = body.to ? new Date(body.to) : new Date(booking.to)
    if (Number.isNaN(newFrom.getTime()) || Number.isNaN(newTo.getTime()) || newFrom >= newTo) {
      res.status(400).send('Invalid rental dates')
      return
    }
    const datesChanged = newFrom.getTime() !== new Date(booking.from).getTime() || newTo.getTime() !== new Date(booking.to).getTime()
    const locationsChanged = newPickupLocationId !== booking.pickupLocation.toString() || newDropOffLocationId !== booking.dropOffLocation.toString()
    const carChanged = newCarId !== booking.car.toString()
    const optionsChanged = OPTION_KEYS.some((key) => providedOptions[key] !== undefined && providedOptions[key] !== oldOptions[key])
    // Details sent for a driver option that stays on are applied to the
    // stored row, so they count as a change even when the flag does not move.
    const driverDetailsChanged = driverDetailsProvided && newOptions.additionalDriver === true
    const correctionsChanged = locationsChanged || carChanged || optionsChanged || driverDetailsChanged
    if (!datesChanged && !correctionsChanged) {
      res.status(400).send('AMENDMENT_NO_CHANGE: The amendment does not change the rental dates or any contract term.')
      return
    }

    // F4 / W1 #17 — a new pickup date in the past is refused on a
    // contract that has not started (Draft/Confirmed). The guard only
    // fires when `from` actually moves: extending the return of a
    // booking whose pickup already passed keeps its (past) `from`
    // untouched. An Active/ReturnReview contract's `from` is history by
    // definition, so the guard does not apply there. "Today" is the
    // server-local start of day.
    const fromChanged = newFrom.getTime() !== new Date(booking.from).getTime()
    if (fromChanged) {
      const amendLifecycle = booking.lifecycle || bookcarsTypes.ContractLifecycle.Draft
      if (amendLifecycle === bookcarsTypes.ContractLifecycle.Draft || amendLifecycle === bookcarsTypes.ContractLifecycle.Confirmed) {
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        if (newFrom < todayStart) {
          res.status(400).send('AMENDMENT_PAST_FROM: The new pickup date cannot be in the past.')
          return
        }
      }
    }

    // F4 / W1 #6 — no correction past handover: locations, vehicle and
    // add-ons are contract terms that are settled at handover. Date-only
    // amendments keep their existing rule (allowed on Active); a
    // correction on an Active/ReturnReview contract is refused.
    if (correctionsChanged) {
      const correctionLifecycle = booking.lifecycle || bookcarsTypes.ContractLifecycle.Draft
      if (correctionLifecycle === bookcarsTypes.ContractLifecycle.Active
        || correctionLifecycle === bookcarsTypes.ContractLifecycle.ReturnReview
        || correctionLifecycle === bookcarsTypes.ContractLifecycle.Completed) {
        res.status(409).send('AMENDMENT_CORRECTION_AFTER_HANDOVER: Locations, vehicle and add-ons cannot be corrected after handover. Settle the contract through the return flow.')
        return
      }
    }

    // GH-01 / gap-hunt 2026-11-24 — date changes are refused on
    // ReturnReview: `from`/`to` must not move after the return
    // inspection. The early-return stamp (actualDays, `to` moved to
    // the return moment) stays frozen, so a post-return date change
    // would rewrite the settlement basis (extra-km allowance, rental
    // days) after the car is back. Date-only amendments remain allowed
    // on Active (the previous rule); Completed is already refused by
    // the terminal guard above.
    if (datesChanged) {
      const dateLifecycle = booking.lifecycle || bookcarsTypes.ContractLifecycle.Draft
      if (dateLifecycle === bookcarsTypes.ContractLifecycle.ReturnReview) {
        res.status(409).send('AMENDMENT_DATE_AFTER_RETURN: Rental dates cannot be changed after the return inspection. Settle the contract through the return flow.')
        return
      }
    }

    // F4 / W1 #6 — the corrected vehicle must belong to the agency and
    // serve both (possibly corrected) locations; a NEW vehicle must also
    // be bookable (not maintenance/stopped), mirroring create. The
    // same-car case skips the bookability refusal: the car was already
    // booked, only its locations are being fixed.
    let targetCar: env.Car | null = null
    if (carChanged || locationsChanged || optionsChanged) {
      if (!mongoose.isValidObjectId(newCarId) || !mongoose.isValidObjectId(newPickupLocationId) || !mongoose.isValidObjectId(newDropOffLocationId)) {
        res.status(400).send('AMENDMENT_CORRECTION: The corrected vehicle or locations are invalid.')
        return
      }
      targetCar = await Car.findById(carChanged ? newCarId : booking.car).populate('dateBasedPrices')
      if (!targetCar || targetCar.supplier?.toString() !== booking.supplier.toString() || targetCar.deletedAt) {
        res.status(400).send('AMENDMENT_CORRECTION: The corrected vehicle must belong to the booking agency.')
        return
      }
      if (carChanged) {
        if (targetCar.operationalStatus === bookcarsTypes.CarOperationalStatus.Maintenance) {
          res.status(403).send('CAR_NOT_BOOKABLE: This car is in maintenance and cannot be booked.')
          return
        }
        if (targetCar.operationalStatus === bookcarsTypes.CarOperationalStatus.Stopped) {
          res.status(403).send('CAR_NOT_BOOKABLE: This car is stopped and cannot be booked.')
          return
        }
      }
      const targetLocationIds = (targetCar.locations || []).map((locationId) => locationId.toString())
      if (!targetLocationIds.includes(newPickupLocationId) || !targetLocationIds.includes(newDropOffLocationId)) {
        res.status(400).send('AMENDMENT_CORRECTION: Pick-up and drop-off locations must be available for the corrected vehicle.')
        return
      }
    }

    // PAR-10 composition: only a payload-carried exception, gated
    // exactly as on create/update, can bypass a booking conflict.
    const overlapGate = await resolveOverlapExceptionGate(
      req,
      { _id: sessionUser._id.toString(), type: sessionUser.type },
      booking.supplier.toString(),
      body.overlapException,
    )
    if (!overlapGate.ok) {
      res.status(overlapGate.status).send(overlapGate.message)
      return
    }

    // N10 invoice interplay, pre-flight: an issued invoice is a fiscal
    // document and never mutates — refuse before anything persists.
    const activeInvoice = await findActiveInvoice(booking._id, booking.supplier)
    if (activeInvoice && activeInvoice.status === bookcarsTypes.InvoiceStatus.Issued) {
      res.status(409).send(`AMENDMENT_ISSUED_INVOICE: Contract amendment refused because invoice ${activeInvoice.number} is already issued. Void the invoice to amend.`)
      return
    }

    // Re-price from the ORIGINAL snapshot's rate basis.
    const snapshot = booking.financialSnapshot
    const hasRealSnapshot = !!snapshot && typeof snapshot.rentalTotal === 'number'
    const basisTotal = hasRealSnapshot ? Number(snapshot.rentalTotal) : Number(booking.price || 0)
    const currency = String((hasRealSnapshot ? snapshot.baseCurrency : undefined) || env.BASE_CURRENCY).toUpperCase()
    const exponent = currencyExponent(currency)
    const originalDays = helper.daysOrZero(booking.from, booking.to)
    const newDays = helper.daysOrZero(newFrom, newTo)
    if (originalDays < 1 || newDays < 1 || !Number.isFinite(basisTotal) || basisTotal < 0) {
      res.status(400).send('AMENDMENT_PRICING: The booking has no price basis to amend from.')
      return
    }
    const basisDailyRate = basisTotal / originalDays
    // F4 / W1 #6 — correction re-pricing. A vehicle change has no
    // original basis for the new car: the whole rental is re-priced
    // from the new car's CURRENT pricing (calculateTotalPrice,
    // server-side — never a client-supplied price), exactly as
    // checkout prices it, and the deposit follows the new car. An
    // add-on change keeps the original basis for the rent and prices
    // ONLY the changed options from the car's current option rates
    // (flat options once, per-day options x the new day count,
    // uplifted by the agency's priceChangeRate like checkout) — the
    // snapshot stores no per-option basis, so the current option rates
    // are the only auditable source. A locations-only correction does
    // not re-price: the total is the basis total exactly (no
    // daily-rate rounding drift).
    let priceChangeRate = 0
    if (carChanged || optionsChanged) {
      const supplier = await User.findById(booking.supplier)
      priceChangeRate = Number(supplier?.priceChangeRate || 0)
    }
    let newTotal: number
    let newDepositAmount: number | undefined
    if (carChanged && targetCar) {
      newTotal = bookcarsHelper.calculateTotalPrice(targetCar as unknown as bookcarsTypes.Car, newFrom, newTo, priceChangeRate, newOptions)
      newDepositAmount = Number((Number(targetCar.deposit || 0) * (1 + priceChangeRate / 100)).toFixed(2))
    } else {
      const baseMinor = datesChanged ? toMinorUnits(basisDailyRate * newDays, currency) : toMinorUnits(basisTotal, currency)
      let optionDeltaMinor = 0
      if (optionsChanged && targetCar) {
        const carOptionRates: Record<OptionKey, number> = {
          cancellation: Number(targetCar.cancellation || 0),
          amendments: Number(targetCar.amendments || 0),
          theftProtection: Number(targetCar.theftProtection || 0),
          collisionDamageWaiver: Number(targetCar.collisionDamageWaiver || 0),
          fullInsurance: Number(targetCar.fullInsurance || 0),
          additionalDriver: Number(targetCar.additionalDriver || 0),
        }
        const perDayOptions: OptionKey[] = ['theftProtection', 'collisionDamageWaiver', 'fullInsurance', 'additionalDriver']
        let optionDeltaRaw = 0
        for (const key of OPTION_KEYS) {
          if (providedOptions[key] === undefined || providedOptions[key] === oldOptions[key]) {
            continue
          }
          const rate = carOptionRates[key]
          if (!(rate > 0)) {
            continue
          }
          const amount = perDayOptions.includes(key) ? rate * newDays : rate
          optionDeltaRaw += (providedOptions[key] ? amount : -amount) * (1 + priceChangeRate / 100)
        }
        optionDeltaMinor = toMinorUnits(optionDeltaRaw, currency)
      }
      newTotal = (baseMinor + optionDeltaMinor) / (10 ** exponent)
    }
    const priceDelta = toMinorUnits(newTotal - basisTotal, currency) / (10 ** exponent)

    const amendedAt = new Date()
    // F4 / W1 #6 — the correction record for the history row, built
    // BEFORE the booking is mutated (the "before" values are the
    // stored ones). Only the fields that actually changed are recorded.
    const correctionRecord: {
      pickupLocationBefore?: string
      pickupLocationAfter?: string
      dropOffLocationBefore?: string
      dropOffLocationAfter?: string
      carBefore?: string
      carAfter?: string
      optionsBefore?: Record<OptionKey, boolean>
      optionsAfter?: Record<OptionKey, boolean>
    } = {}
    if (locationsChanged) {
      correctionRecord.pickupLocationBefore = booking.pickupLocation.toString()
      correctionRecord.pickupLocationAfter = newPickupLocationId
      correctionRecord.dropOffLocationBefore = booking.dropOffLocation.toString()
      correctionRecord.dropOffLocationAfter = newDropOffLocationId
    }
    if (carChanged) {
      correctionRecord.carBefore = booking.car.toString()
      correctionRecord.carAfter = newCarId
    }
    if (optionsChanged) {
      correctionRecord.optionsBefore = { ...oldOptions }
      correctionRecord.optionsAfter = { ...newOptions }
    }
    const historyRow = {
      at: amendedAt,
      by: new mongoose.Types.ObjectId(sessionUser._id),
      reason,
      fromBefore: new Date(booking.from),
      toBefore: new Date(booking.to),
      fromAfter: newFrom,
      toAfter: newTo,
      rentalTotalBefore: basisTotal,
      rentalTotalAfter: newTotal,
      priceDelta,
      basisDailyRate,
      basisDays: originalDays,
      ...(correctionsChanged ? { correction: correctionRecord } : {}),
    }

    booking.from = newFrom
    booking.to = newTo
    booking.price = newTotal
    // F4 / W1 #6 — apply the corrected terms. The deposit follows a
    // vehicle change (new car's deposit); add-on/location corrections
    // leave it alone. The receivable follows the new rental total, so
    // a correction below posted payments surfaces as overpayment
    // exactly like a shortening amendment does — the ledger is untouched.
    if (locationsChanged) {
      booking.pickupLocation = new mongoose.Types.ObjectId(newPickupLocationId)
      booking.dropOffLocation = new mongoose.Types.ObjectId(newDropOffLocationId)
    }
    if (carChanged) {
      booking.car = new mongoose.Types.ObjectId(newCarId)
    }
    if (optionsChanged) {
      booking.cancellation = newOptions.cancellation
      booking.amendments = newOptions.amendments
      booking.theftProtection = newOptions.theftProtection
      booking.collisionDamageWaiver = newOptions.collisionDamageWaiver
      booking.fullInsurance = newOptions.fullInsurance
      booking.additionalDriver = newOptions.additionalDriver
    }
    // F4 / W1 #6 — the additional-driver row follows the flag,
    // mirroring bookingController.update: turning the option off
    // deletes the row; turning it on (or editing it) requires/updates
    // the details row.
    const upsertAdditionalDriverRow = async (details: { fullName: string, email: string, phone: string, birthDate: Date }) => {
      const existingRow = booking._additionalDriver
        ? await AdditionalDriver.findOne({ _id: booking._additionalDriver })
        : null
      if (existingRow) {
        existingRow.fullName = details.fullName
        existingRow.email = details.email
        existingRow.phone = details.phone
        existingRow.birthDate = details.birthDate
        await existingRow.save()
      } else {
        const createdDriver = new AdditionalDriver(details)
        await createdDriver.save()
        booking._additionalDriver = createdDriver._id
        createdAdditionalDriverId = createdDriver._id.toString()
      }
    }
    if (Object.prototype.hasOwnProperty.call(providedOptions, 'additionalDriver') && newOptions.additionalDriver === false) {
      if (booking._additionalDriver) {
        await AdditionalDriver.deleteOne({ _id: booking._additionalDriver })
        booking._additionalDriver = undefined
      }
    } else if (additionalDriverDetails) {
      await upsertAdditionalDriverRow(additionalDriverDetails)
    }
    if (hasRealSnapshot) {
      booking.financialSnapshot = {
        ...snapshot,
        version: (typeof snapshot.version === 'number' ? snapshot.version : 1) + 1,
        rentalTotal: newTotal,
        ...(newDepositAmount !== undefined ? { depositAmount: newDepositAmount } : {}),
        quotedAt: amendedAt,
      }
    } else {
      booking.financialSnapshot = {
        version: 1,
        baseCurrency: currency,
        paymentCurrency: currency,
        mode: bookcarsTypes.CheckoutPaymentMode.PayLater,
        rentalTotal: newTotal,
        depositAmount: newDepositAmount ?? 0,
        amountDueNow: 0,
        amountDueNowInPaymentCurrency: 0,
        quotedAt: amendedAt,
      }
    }
    if (!booking.amendmentHistory) {
      booking.amendmentHistory = []
    }
    booking.amendmentHistory.push(historyRow as never)

    let overlapConflictingBookingId: string | undefined
    await saveBookingWithAvailability(booking, {
      allowOverlapException: !!overlapGate.reason,
      onBookingConflict: (conflictingBookingId) => { overlapConflictingBookingId = conflictingBookingId },
    })

    // PAR-10 record discipline: stamp only a bypass that really happened.
    if (overlapGate.reason && overlapConflictingBookingId) {
      booking.overlapException = {
        reason: overlapGate.reason,
        authorisedBy: new mongoose.Types.ObjectId(sessionUser._id),
        authorisedAt: amendedAt,
        conflictingBooking: new mongoose.Types.ObjectId(overlapConflictingBookingId),
      }
      await booking.save()
    }

    // N10: a Draft invoice follows the new snapshot in the same request.
    if (activeInvoice && activeInvoice.status === bookcarsTypes.InvoiceStatus.Draft) {
      const invoiceDoc = await Invoice.findById(activeInvoice._id)
      if (invoiceDoc) {
        await refreshDraftInvoiceAfterAmendment(
          invoiceDoc,
          newTotal,
          async ({ subtotal, taxAmount, total }) => {
            invoiceDoc.subtotal = subtotal
            invoiceDoc.taxAmount = taxAmount
            invoiceDoc.total = total
            await invoiceDoc.save()
          },
        )
      }
    }

    // Wave 1.6 — an amendment re-prices the booking: if the new total
    // leaves money owed on a Paid/PaidInFull booking, the status must
    // downgrade. Best-effort: the amendment itself already succeeded.
    // Runs after the last booking.save() above, so the refresh is not
    // overwritten by the in-memory doc.
    try {
      const refresh = await refreshBookingPaymentStatus(booking._id)
      if (refresh.updated) {
        booking.status = refresh.status
      }
    } catch (refreshErr) {
      logger.error('[booking.amend] booking payment status could not be refreshed', refreshErr)
    }

    res.json(await populateBookingForDetail(booking._id))
  } catch (err) {
    if (err instanceof BookingConflictError) {
      // F4 / W1 #6 — a conflict after an additional-driver row was
      // created for this amendment leaves the row orphaned (the booking
      // save threw, so the booking still points at the old state);
      // remove it, mirroring the checkout conflict cleanup (W1 #10).
      // A row that was only UPDATED keeps its new details while the
      // booking keeps the old flag — the same shape as update().
      if (createdAdditionalDriverId) {
        await AdditionalDriver.deleteOne({ _id: new mongoose.Types.ObjectId(createdAdditionalDriverId) }).catch(() => undefined)
      }
      res.status(409).send(err.message)
      return
    }
    logger.error(`[booking.amend] ${i18n.t('ERROR')}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export default amend
