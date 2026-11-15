import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import escapeStringRegexp from 'escape-string-regexp'
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import { Request, Response } from 'express'
import Stripe from 'stripe'
import * as nodemailer from 'nodemailer'
import type { SendMailOptions } from 'nodemailer'
import path from 'node:path'
import asyncFs from 'node:fs/promises'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import i18n from '../lang/i18n'
import Booking from '../models/Booking'
import User from '../models/User'
import Token from '../models/Token'
import Car from '../models/Car'
import Location from '../models/Location'
import { isValidLicenseCapabilityFilename } from '../utils/tempFileCapability'
import Notification from '../models/Notification'
import NotificationCounter from '../models/NotificationCounter'
import PushToken from '../models/PushToken'
import AdditionalDriver from '../models/AdditionalDriver'
import * as helper from '../utils/helper'
import * as mailHelper from '../utils/mailHelper'
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import { BookingConflictError, findBookingConflictForRestore, saveBookingWithAvailability, saveBookingsWithAvailability } from '../utils/bookingReservationHelper'
import { applyRestore, applyTrash, isValidTrashReason, trashedMessage } from '../utils/trash'
import RentalPayment from '../models/RentalPayment'
import Invoice from '../models/Invoice'
import ContractCharge from '../models/ContractCharge'
import Quote from '../models/Quote'
import ContractSnapshot from '../models/ContractSnapshot'
import ContractInspection from '../models/ContractInspection'
import AgentSettlement from '../models/AgentSettlement'
import { postProviderPayment, postRentalPayment, refreshBookingPaymentStatus, reverseRentalPayment, supportsTransactions, LedgerError } from '../utils/ledger'
import { getContractReceivable } from '../utils/contractReceivable'
import stripeAPI from '../payment/stripe'
import { toMinorUnits } from '../utils/paymentAmount'
import { agencySupplierId, getAgencyContext } from '../utils/agencyAuthorization'
import { nextBookingReference } from '../utils/bookingReference'
import { publicOnlineSignature } from '../utils/bookingSigning'
import { ensureDraftInvoice } from '../utils/invoiceCreation'
import { resolveLocationTranslation } from '../utils/locationHelper'
import { isBookingOverdue } from '../utils/contractLifecycle'
import { resolveBookingAgentSnapshot } from '../utils/agentCommission'

/**
 * GA-PAR-10 — overlap-exception gate for the admin create/update funnels.
 *
 * The hard overlap block stays the default. A caller may supply
 * `overlapException: { reason }` to confirm one specific
 * booking-vs-booking overlap as an exception. Only agency callers whose
 * role is Owner or Manager may do so (resolved through the agency
 * context — no new permission/capability); anyone else supplying the
 * payload is refused 403. The reason is required, 3–1000 chars (house
 * pattern); `authorisedBy`/`authorisedAt` are stamped server-side by
 * the caller of this helper, never taken from the client. Maintenance
 * work-order conflicts are never excepted (bookingReservationHelper).
 * The public checkout funnel never calls this gate: it ignores the
 * payload unconditionally.
 */
type OverlapExceptionGate =
  | { ok: true, reason?: string }
  | { ok: false, status: number, message: string }

export const resolveOverlapExceptionGate = async (
  req: Request,
  actor: { _id: string, type?: bookcarsTypes.UserType },
  supplierId: string,
  raw: unknown,
): Promise<OverlapExceptionGate> => {
  if (raw === undefined || raw === null) {
    return { ok: true }
  }
  let role = req.agency?.role
  if (!role) {
    if (actor.type === bookcarsTypes.UserType.Supplier) {
      role = bookcarsTypes.AgencyRole.Owner
    } else {
      const context = await getAgencyContext({ _id: actor._id, type: actor.type }, supplierId)
      role = context?.role
    }
  }
  if (role !== bookcarsTypes.AgencyRole.Owner && role !== bookcarsTypes.AgencyRole.Manager) {
    return { ok: false, status: 403, message: 'OVERLAP_EXCEPTION_FORBIDDEN: Only an agency Owner or Manager may confirm an overlap exception.' }
  }
  const reason = (raw as { reason?: unknown })?.reason
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000) {
    return { ok: false, status: 400, message: 'OVERLAP_EXCEPTION_REASON: An overlap exception requires a reason of 3 to 1000 characters.' }
  }
  return { ok: true, reason }
}

/**
 * Create a Booking.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const create = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.UpsertBookingPayload } = req
    const sessionUser = req.user
    const bookingInput = body?.booking
    const getId = (value: string | { _id?: string } | undefined) => (typeof value === 'string' ? value : value?._id) || ''
    const submittedSupplierId = getId(bookingInput?.supplier as string | { _id?: string })
    const agencyId = agencySupplierId(req)
    const supplierId = sessionUser?.type === bookcarsTypes.UserType.Admin
      ? submittedSupplierId
      : agencyId || submittedSupplierId
    const carId = getId(bookingInput?.car as string | { _id?: string })
    const driverId = getId(bookingInput?.driver as string | { _id?: string })
    const pickupLocationId = getId(bookingInput?.pickupLocation as string | { _id?: string })
    const dropOffLocationId = getId(bookingInput?.dropOffLocation as string | { _id?: string })

    if (!sessionUser || !bookingInput
      || ![bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff, bookcarsTypes.UserType.Admin].includes(sessionUser.type)
      || ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type) && (!agencyId || submittedSupplierId !== agencyId))
      || !mongoose.isValidObjectId(supplierId)
      || !mongoose.isValidObjectId(carId)
      || !mongoose.isValidObjectId(driverId)
      || !mongoose.isValidObjectId(pickupLocationId)
      || !mongoose.isValidObjectId(dropOffLocationId)
      || !Number.isFinite(Number(bookingInput.price))
      || Number(bookingInput.price) < 0
      || (bookingInput.additionalDriver && !body.additionalDriver)
      || !Object.values(bookcarsTypes.BookingStatus).includes(bookingInput.status)) {
      res.status(400).send('Invalid booking or agency scope')
      return
    }

    if ([bookcarsTypes.BookingStatus.Deposit, bookcarsTypes.BookingStatus.Paid, bookcarsTypes.BookingStatus.PaidInFull].includes(bookingInput.status)) {
      res.status(400).send('Payment statuses can only be created through a verified payment workflow')
      return
    }

    // GA-PAR-22: a trashed car cannot be selected for a new booking.
    const vehicle = await Car.findOne({ _id: carId, supplier: supplierId, deletedAt: null }).select('_id locations operationalStatus').lean()
    const locationIds = (vehicle?.locations || []).map((locationId: mongoose.Types.ObjectId | string) => locationId.toString())
    if (!vehicle || !locationIds.includes(pickupLocationId) || !locationIds.includes(dropOffLocationId)) {
      res.status(400).send('Vehicle and locations must belong to the booking agency')
      return
    }
    // Fleet statuses (scorecard #15): a car in maintenance or stopped is
    // NOT bookable — refused here in the admin-create path, mirroring
    // the PAR-04 CLIENT_BLOCKED 403 pattern below. Checkout/update are
    // untouched (documented residual, not silently fixed).
    if (vehicle.operationalStatus === bookcarsTypes.CarOperationalStatus.Maintenance) {
      res.status(403).send('CAR_NOT_BOOKABLE: This car is in maintenance and cannot be booked.')
      return
    }
    if (vehicle.operationalStatus === bookcarsTypes.CarOperationalStatus.Stopped) {
      res.status(403).send('CAR_NOT_BOOKABLE: This car is stopped and cannot be booked.')
      return
    }

    const driver = await User.findOne({ _id: driverId, type: bookcarsTypes.UserType.User }).select('_id clientStatus blacklisted deletedAt')
    if (!driver) {
      res.status(400).send('Booking customer not found')
      return
    }

    // GA-PAR-22: a trashed client cannot be booked (403 CLIENT_TRASHED,
    // same shape as the PAR-04 CLIENT_BLOCKED refusal below).
    if (driver.deletedAt) {
      res.status(403).send('CLIENT_TRASHED: This client is trashed and cannot be booked.')
      return
    }

    // GA-PAR-04: blocked-client guard (admin create path ONLY - checkout,
    // update and auth are untouched). A client whose workflow status is
    // blocked, or who is blacklisted, cannot be booked; nothing persists.
    if (driver.clientStatus === bookcarsTypes.ClientStatus.Blocked || driver.blacklisted === true) {
      res.status(403).send('CLIENT_BLOCKED: This client is blocked and cannot be booked.')
      return
    }

    // GA-PAR-10: overlap-exception gate — evaluated before anything is
    // persisted, so a refused exception (403/400) leaves no trace.
    const overlapGate = await resolveOverlapExceptionGate(
      req,
      { _id: String(sessionUser?._id || ''), type: sessionUser?.type },
      supplierId,
      bookingInput.overlapException,
    )
    if (!overlapGate.ok) {
      res.status(overlapGate.status).send(overlapGate.message)
      return
    }

    const fromDate = new Date(bookingInput.from)
    const toDate = new Date(bookingInput.to)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
      res.status(400).send('Invalid rental dates')
      return
    }

    // GA-PAR-07: resolve the apporteur snapshot BEFORE persisting. The
    // agent must belong to this agency (a foreign agent id is refused
    // here, never silently accepted); the payload may carry a per-contract
    // override (mode/value), otherwise the agent's default applies; the
    // amount is computed server-side from the rental total (the booking
    // price on this path) and the rental day count.
    let agentSnapshot
    if (bookingInput.agent) {
      const resolvedAgent = await resolveBookingAgentSnapshot(
        supplierId,
        bookingInput.agent as { agent?: unknown, mode?: unknown, value?: unknown },
        Number(bookingInput.price),
        helper.days(fromDate, toDate),
      )
      if (!resolvedAgent.ok) {
        res.status(400).send(resolvedAgent.error)
        return
      }
      agentSnapshot = resolvedAgent.snapshot
    }

    let additionalDriverId: string | undefined
    if (bookingInput.additionalDriver && body.additionalDriver) {
      const additionalDriver = new AdditionalDriver(body.additionalDriver)
      await additionalDriver.save()
      additionalDriverId = additionalDriver._id.toString()
    }

    const reference = await nextBookingReference(supplierId)

    const booking = new Booking({
      ...bookingInput,
      reference,
      supplier: supplierId,
      car: carId,
      driver: driver._id,
      pickupLocation: pickupLocationId,
      dropOffLocation: dropOffLocationId,
      from: fromDate,
      to: toDate,
      _additionalDriver: additionalDriverId,
      sessionId: undefined,
      paymentIntentId: undefined,
      customerId: undefined,
      paypalOrderId: undefined,
      expireAt: undefined,
      isDeposit: false,
      isPayedInFull: false,
      financialSnapshot: undefined,
      agent: agentSnapshot,
      // GA-PAR-10: never trust a client-shaped exception record — the
      // record is stamped below only when a conflict was actually
      // bypassed under the gate above.
      overlapException: undefined,
    })

    // GA-PAR-10: with a gated exception the helper bypasses
    // booking-vs-booking conflicts only (maintenance still throws) and
    // reports the conflicting booking; the exception record is then
    // persisted on the booking itself. If nothing actually conflicted
    // (e.g. a blockOnPay=false car), no record is stamped — an exception
    // that excepts nothing would be audit noise.
    let overlapConflictingBookingId: string | undefined
    await saveBookingWithAvailability(booking, {
      allowOverlapException: !!overlapGate.reason,
      onBookingConflict: (conflictingBookingId) => { overlapConflictingBookingId = conflictingBookingId },
    })
    if (overlapGate.reason && overlapConflictingBookingId) {
      booking.overlapException = {
        reason: overlapGate.reason,
        authorisedBy: new mongoose.Types.ObjectId(sessionUser._id),
        authorisedAt: new Date(),
        conflictingBooking: new mongoose.Types.ObjectId(overlapConflictingBookingId),
      }
      await booking.save()
    }
    // GA-PAR-05: auto-draft invoice (idempotent, never throws, draft only).
    await ensureDraftInvoice(booking)
    res.json(booking)
  } catch (err) {
    // GA-PAR-10: availability conflicts surface as 409 on create too,
    // matching checkout/update/updateStatus (previously the generic 400
    // below swallowed BookingConflictError on this funnel only).
    if (err instanceof BookingConflictError) {
      res.status(409).send(err.message)
      return
    }
    logger.error(`[booking.create] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Notify a supplier or admin.
 *
 * @async
 * @param {env.User} driver
 * @param {string} bookingId
 * @param {env.User} user
 * @param {boolean} notificationMessage
 * @returns {void}
 */
export const notify = async (driver: env.User, bookingId: string, user: env.User, notificationMessage: string) => {
  i18n.locale = user.language

  // notification
  const message = `${driver.fullName} ${notificationMessage} ${bookingId}.`
  const notification = new Notification({
    user: user._id,
    message,
    booking: bookingId,
  })

  await notification.save()
  let counter = await NotificationCounter.findOne({ user: user._id })
  if (counter && typeof counter.count !== 'undefined') {
    counter.count += 1
    await counter.save()
  } else {
    counter = new NotificationCounter({ user: user._id, count: 1 })
    await counter.save()
  }

  // mail
  if (user.enableEmailNotifications) {
    const mailOptions: SendMailOptions = {
      from: env.SMTP_FROM,
      to: user.email,
      subject: message,
      html: `<p>
    ${i18n.t('HELLO')}${user.fullName},<br><br>
    ${message}<br><br>
    ${helper.joinURL(env.ADMIN_HOST, `update-booking?b=${bookingId}`)}<br><br>
    ${i18n.t('REGARDS')}<br>
    </p>`,
    }

    await mailHelper.sendMail(mailOptions)
  }
}

/**
 * Send checkout confirmation email to driver.
 *
 * @async
 * @param {env.User} user
 * @param {env.Booking} booking
 * @param {boolean} payLater
 * @returns {unknown}
 */
export const confirm = async (user: env.User, supplier: env.User, booking: env.Booking, payLater: boolean) => {
  const { language } = user
  // F1 / W1 #2: upstream's 7-locale map, plus `ar` (Gestion Auto added an
  // Arabic UI but location values are conventionally en/fr/es — a bare
  // `fr ? fr-FR : en-US` map formats every other language as US English).
  const locales: Record<string, string> = { fr: 'fr-FR', de: 'de-DE', es: 'es-ES', pt: 'pt-PT', it: 'it-IT', zh: 'zh-CN', ja: 'ja-JP', ar: 'ar-MA' }
  const locale = locales[language] || 'en-US'
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    year: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZone: env.TIMEZONE,
  }
  const from = booking.from.toLocaleString(locale, options)
  const to = booking.to.toLocaleString(locale, options)
  const car = await Car.findById(booking.car).populate<{ supplier: env.User }>('supplier')
  if (!car) {
    logger.info(`Car ${booking.car} not found`)
    return false
  }
  const pickupLocation = await Location.findById(booking.pickupLocation).populate<{ values: env.LocationValue[] }>('values')
  if (!pickupLocation) {
    logger.info(`Pick-up location ${booking.pickupLocation} not found`)
    return false
  }

  const pickupLocationName = resolveLocationTranslation(pickupLocation.values, language)
  const dropOffLocation = await Location.findById(booking.dropOffLocation).populate<{ values: env.LocationValue[] }>('values')
  if (!dropOffLocation) {
    logger.info(`Drop-off location ${booking.pickupLocation} not found`)
    return false
  }
  const dropOffLocationName = resolveLocationTranslation(dropOffLocation.values, language)

  let contractFile: string | null = null
  if (supplier.contracts && supplier.contracts.length > 0) {
    contractFile = supplier.contracts.find((c) => c.language === user.language)?.file || null
    if (!contractFile) {
      contractFile = supplier.contracts.find((c) => c.language === 'en')?.file || null
    }
  }

  const mailOptions: SendMailOptions = {
    from: env.SMTP_FROM,
    to: user.email,
    subject: `${i18n.t('BOOKING_CONFIRMED_SUBJECT_PART1')} ${booking._id} ${i18n.t('BOOKING_CONFIRMED_SUBJECT_PART2')}`,
    html:
      `<p>
        ${i18n.t('HELLO')}${user.fullName},<br><br>
        ${!payLater ? `${i18n.t('BOOKING_CONFIRMED_PART1')} ${booking._id} ${i18n.t('BOOKING_CONFIRMED_PART2')}`
        + '<br><br>' : ''}
        ${i18n.t('BOOKING_CONFIRMED_PART3')}${car.supplier.fullName}${i18n.t('BOOKING_CONFIRMED_PART4')}${pickupLocationName}${i18n.t('BOOKING_CONFIRMED_PART5')}`
      + `${from} ${i18n.t('BOOKING_CONFIRMED_PART6')}`
      + `${car.name}${i18n.t('BOOKING_CONFIRMED_PART7')}`
      + `<br><br>${i18n.t('BOOKING_CONFIRMED_PART8')}<br><br>`
      + `${i18n.t('BOOKING_CONFIRMED_PART9')}${car.supplier.fullName}${i18n.t('BOOKING_CONFIRMED_PART10')}${dropOffLocationName}${i18n.t('BOOKING_CONFIRMED_PART11')}`
      + `${to} ${i18n.t('BOOKING_CONFIRMED_PART12')}`
      + `<br><br>${i18n.t('BOOKING_CONFIRMED_PART13')}<br><br>${i18n.t('BOOKING_CONFIRMED_PART14')}${env.FRONTEND_HOST}<br><br>
        ${i18n.t('REGARDS')}<br>
        </p>`,
  }

  if (contractFile) {
    const file = path.join(env.CDN_CONTRACTS, contractFile)
    if (await helper.pathExists(file)) {
      mailOptions.attachments = [{ path: file }]
    }
  }

  await mailHelper.sendMail(mailOptions)

  return true
}

/**
 * F1 / W3 P-2 — split a verified provider checkout into its rent and deposit
 * legs, per ADR-001's deposit separation. Posting the whole `amountDueNow`
 * as Rent threw OVERPAYMENT in Full mode (rent cap is `rentalTotal`) and
 * misclassified the deposit as rent in Deposit mode. Each leg posts under
 * its own purpose with its own idempotency key.
 *
 * @param {env.BookingFinancialSnapshot} snapshot
 * @returns {{ rent: number, deposit: number }}
 */
const splitProviderCheckoutAmounts = (snapshot: bookcarsTypes.BookingFinancialSnapshot) => {
  const amountDueNow = snapshot.amountDueNow
  const rentalTotal = snapshot.rentalTotal
  const depositAmount = snapshot.depositAmount
  // F1 fix-up / W4 GAP-07 residual (§2.2): the deposit leg is validated
  // against its cap HERE, before any posting. Previously only the
  // Full-mode rent leg was checked, so on an inconsistent snapshot the
  // rent leg could post and the deposit leg then throw OVERPAYMENT —
  // leaving a posted RentalPayment row on a Void booking (standalone path)
  // while the caller refunded the provider. The split now never returns
  // a deposit leg that exceeds its cap. (The Rental-mode rent leg is the
  // first leg, so an over-cap throw there cannot orphan a row, and the
  // ledger still enforces its cap. Remainder, follow-up: a throw after
  // the legs post — e.g. a missing car/driver — still leaves posted legs
  // on the rolled-back booking; that needs posted-leg cleanup in the
  // standalone rollback, not a cap check.)
  if (snapshot.mode === bookcarsTypes.CheckoutPaymentMode.Deposit) {
    if (amountDueNow > depositAmount) {
      throw new Error('Snapshot amountDueNow exceeds the deposit amount in Deposit mode')
    }
    return { rent: 0, deposit: amountDueNow }
  }
  if (snapshot.mode === bookcarsTypes.CheckoutPaymentMode.Full) {
    if (amountDueNow < rentalTotal) {
      throw new Error('Snapshot amountDueNow is below the rental total in Full mode')
    }
    if (amountDueNow - rentalTotal > depositAmount) {
      throw new Error('Snapshot deposit exceeds the deposit amount in Full mode')
    }
    return { rent: rentalTotal, deposit: amountDueNow - rentalTotal }
  }
  return { rent: amountDueNow, deposit: 0 }
}

/** Finalize a booking only after an external provider has verified payment. */
export const finalizePaidCheckoutBooking = async (
  booking: env.Booking,
  provider: 'stripe' | 'paypal',
  reference: string,
) => {
  const snapshot = booking.financialSnapshot
  if (!snapshot || !reference) {
    throw new Error('Verified payment requires a booking snapshot and provider reference')
  }
  const { rent: rentAmount, deposit: depositAmount } = splitProviderCheckoutAmounts(snapshot)

  const originalStatus = booking.status
  const originalExpireAt = booking.expireAt
  const originalLifecycle = booking.lifecycle
  let saved = false

  const runFinalization = async (session?: mongoose.ClientSession) => {
    if (provider === 'stripe') booking.paymentIntentId = reference
    else booking.paypalOrderId = reference
    booking.expireAt = undefined
    // F4 / W1 #5 — a provider-verified payment confirms the contract:
    // the lifecycle middle finally has a producer. Only a Draft (or
    // legacy lifecycle-less) booking is confirmed here; a booking that
    // already advanced is left alone. The pay-later half of the middle
    // is produced by refreshBookingPaymentStatus (manual/cash
    // confirmation to Paid); a pay-later booking is NOT confirmed at
    // checkout creation — it is still unpaid, and confirming it there
    // would let it bypass the handover payment gate (W1 #11). The
    // approvals-queue producer half stays GATED (#41, GAPS.md §5).
    if (!booking.lifecycle || booking.lifecycle === bookcarsTypes.ContractLifecycle.Draft) {
      booking.lifecycle = bookcarsTypes.ContractLifecycle.Confirmed
    }
    booking.status = snapshot.mode === bookcarsTypes.CheckoutPaymentMode.Deposit
      ? bookcarsTypes.BookingStatus.Deposit
      : snapshot.mode === bookcarsTypes.CheckoutPaymentMode.Full
        ? bookcarsTypes.BookingStatus.PaidInFull
        : bookcarsTypes.BookingStatus.Paid

    saved = await saveBookingWithAvailability(booking, {
      expectedStatus: bookcarsTypes.BookingStatus.Void,
      requireExpireAt: true,
      ...(session ? { session } : {}),
    })
    if (!saved) return

    // F1 / W3 P-2: one ledger posting per purpose, same transaction (or
    // same non-transactional run). A Full-mode checkout posts the rent leg
    // against the rent cap and the deposit leg against the deposit cap, so
    // it no longer throws OVERPAYMENT; a Deposit-mode checkout posts the
    // deposit as Deposit, not Rent.
    //
    // F2 / W4 GAP-10: each leg also stores its provider-settled leg
    // (payment currency) so the ledger reconciles to the provider
    // settlement exactly. The base-currency amount/currency still post
    // under the existing purpose caps (ledger invariant — the settled leg
    // is informational and never enters the recorded totals). The settled
    // rent leg is the base leg × the snapshot FX rate (2dp); the deposit
    // leg takes the remainder so the settled legs sum to the provider
    // total exactly. Snapshots written before F2 carry no fxRate; the
    // ratio of the two stored amounts is the fallback (exact for
    // same-currency snapshots).
    const settledFxRate = snapshot.fxRate && snapshot.fxRate > 0
      ? snapshot.fxRate
      : (snapshot.amountDueNow > 0 ? snapshot.amountDueNowInPaymentCurrency / snapshot.amountDueNow : 1)
    const settledRentAmount = Number((rentAmount * settledFxRate).toFixed(2))
    const settledDepositAmount = Number((snapshot.amountDueNowInPaymentCurrency - settledRentAmount).toFixed(2))
    const postLeg = async (purpose: bookcarsTypes.RentalPaymentPurpose, amount: number) => {
      await postProviderPayment({
        bookingId: booking._id.toString(),
        date: new Date(),
        amount,
        currency: snapshot.baseCurrency,
        provider,
        providerReference: reference,
        actorId: booking.driver?.toString(),
        note: `Verified ${provider} checkout payment`,
        idempotencyKey: `${provider}-checkout-${reference}-${purpose === bookcarsTypes.RentalPaymentPurpose.Deposit ? 'deposit' : 'rent'}`,
        purpose,
        settledAmount: purpose === bookcarsTypes.RentalPaymentPurpose.Deposit ? settledDepositAmount : settledRentAmount,
        settledCurrency: snapshot.paymentCurrency,
        fxRate: settledFxRate,
        fxSource: snapshot.fxSource,
        fxAt: snapshot.fxAt,
        ...(session ? { session } : {}),
      })
    }
    if (rentAmount > 0) {
      await postLeg(bookcarsTypes.RentalPaymentPurpose.Rent, rentAmount)
    }
    if (depositAmount > 0) {
      await postLeg(bookcarsTypes.RentalPaymentPurpose.Deposit, depositAmount)
    }

    // F1 / W4 GAP-06: the trip count and the guest-account expiry are part
    // of the paid finalisation, so they move inside the same transaction
    // (or non-transactional run) as the status + ledger post. Previously
    // they ran after `confirm()` and were skipped whenever the email
    // failed, leaving a paid guest's account TTL-deletable.
    const carQuery = Car.findById(booking.car)
    if (session) {
      carQuery.session(session)
    }
    const car = await carQuery
    if (!car) {
      throw new Error(`Car ${booking.car} not found`)
    }
    car.trips += 1
    await car.save(session ? { session } : undefined)

    const userQuery = User.findById(booking.driver)
    if (session) {
      userQuery.session(session)
    }
    const user = await userQuery
    if (!user) {
      throw new Error(`Driver ${booking.driver} not found`)
    }
    user.expireAt = undefined
    await user.save(session ? { session } : undefined)
  }

  // F1 / W4 GAP-07: `withTransaction` unconditionally fails on a standalone
  // mongod (no replica set) — every paid checkout threw after the money was
  // taken. Reuse the ledger's `supportsTransactions()` guard: transaction
  // when available, else the locked non-transactional path. Without a
  // transaction the booking status is already flipped when the ledger post
  // runs, so a post failure restores Void + expireAt (compensating
  // rollback) before the error reaches the caller, which refunds.
  if (supportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(() => runFinalization(session))
    } finally {
      await session.endSession()
    }
  } else {
    try {
      await runFinalization()
    } catch (err) {
      if (saved) {
        try {
          booking.status = originalStatus
          booking.expireAt = originalExpireAt
          booking.lifecycle = originalLifecycle
          await booking.save()
        } catch (rollbackError) {
          logger.error('[booking.finalizePaidCheckoutBooking] Failed to roll back booking after ledger failure', rollbackError)
        }
      }
      throw err
    }
  }

  if (!saved) return false

  // GA-PAR-05: the booking is finalised (expireAt cleared inside the
  // transaction) — auto-draft its invoice. Idempotent and never throws,
  // so a replayed finalisation still yields exactly one draft.
  await ensureDraftInvoice(booking)

  // F1 / W4 GAP-06: the confirmation email and the notifications must
  // never fail a paid booking. The money is settled and the ledger posted
  // at this point; a failing mailer is logged, not thrown (upstream
  // behaviour). The customer keeps a paid booking even if the email fails.
  const supplier = await User.findById(booking.supplier)
  const user = await User.findById(booking.driver)
  if (!supplier || !user) {
    logger.error(`[booking.finalizePaidCheckoutBooking] Supplier or driver not found for paid booking ${booking._id}`)
  } else {
    try {
      if (!(await confirm(user, supplier, booking, false))) {
        logger.error(`[booking.finalizePaidCheckoutBooking] Confirmation email could not be sent for paid booking ${booking._id}`)
      }
    } catch (err) {
      logger.error(`[booking.finalizePaidCheckoutBooking] Confirmation email failed for paid booking ${booking._id}; booking stays paid`, err)
    }
    try {
      i18n.locale = supplier.language
      const message = i18n.t('BOOKING_PAID_NOTIFICATION')
      await notify(user, booking._id.toString(), supplier, message)

      const admin = !!env.ADMIN_EMAIL && (await User.findOne({ email: env.ADMIN_EMAIL, type: bookcarsTypes.UserType.Admin }))
      if (admin) {
        i18n.locale = admin.language
        await notify(user, booking._id.toString(), admin, i18n.t('BOOKING_PAID_NOTIFICATION'))
      }
    } catch (err) {
      logger.error(`[booking.finalizePaidCheckoutBooking] Post-payment notification failed for paid booking ${booking._id}; booking stays paid`, err)
    }
  }

  return true
}

/** Complete the mobile PaymentSheet flow using the provider's authoritative intent. */
export const confirmPaymentIntent = async (req: Request, res: Response) => {
  let verifiedPaymentIntentId: string | undefined
  try {
    const { bookingId, paymentIntentId } = req.body as { bookingId?: string; paymentIntentId?: string }
    if (!mongoose.isValidObjectId(bookingId) || typeof paymentIntentId !== 'string' || !paymentIntentId.startsWith('pi_')) {
      res.status(400).send('Invalid payment confirmation')
      return
    }

    const booking = await Booking.findById(bookingId)
    if (!booking) {
      const orphanPaymentIntent = await stripeAPI.paymentIntents.retrieve(paymentIntentId)
      if (orphanPaymentIntent.status === 'succeeded'
        && orphanPaymentIntent.metadata.bookingId === bookingId) {
        verifiedPaymentIntentId = orphanPaymentIntent.id
        await stripeAPI.refunds.create(
          { payment_intent: orphanPaymentIntent.id },
          { idempotencyKey: `orphan-booking-${orphanPaymentIntent.id}` },
        )
        res.status(410).send('Booking expired; the payment was refunded')
        return
      }
      res.sendStatus(404)
      return
    }
    if (booking.paymentIntentId === paymentIntentId && booking.status !== bookcarsTypes.BookingStatus.Void) {
      res.sendStatus(200)
      return
    }
    if (booking.status !== bookcarsTypes.BookingStatus.Void || !booking.expireAt) {
      // F1 fix-up / W4 GAP-05: this 409 can hide a second succeeded intent
      // (the booking was already paid through another intent, or is Void
      // with no expiry left). Refund it before answering, as the expired
      // branch does; an intent that never succeeded keeps the plain 409.
      try {
        const strayIntent = await stripeAPI.paymentIntents.retrieve(paymentIntentId)
        if (strayIntent.status === 'succeeded') {
          verifiedPaymentIntentId = strayIntent.id
          try {
            await stripeAPI.refunds.create(
              { payment_intent: strayIntent.id },
              { idempotencyKey: `refund-${strayIntent.id}-mismatch` },
            )
          } catch (refundError) {
            logger.error('[booking.confirmPaymentIntent] Failed to refund payment for booking not awaiting payment', refundError)
            res.status(500).send('Booking is not awaiting payment. Payment refund requires support review.')
            return
          }
          res.status(409).send('Booking is not awaiting payment; the payment was refunded. Support review is required.')
          return
        }
      } catch (err) {
        logger.error(`[booking.confirmPaymentIntent] Could not retrieve payment intent ${paymentIntentId} for booking not awaiting payment`, err)
      }
      res.status(409).send('Booking is not awaiting payment')
      return
    }

    if (booking.expireAt <= new Date()) {
      const expiredPaymentIntent = await stripeAPI.paymentIntents.retrieve(paymentIntentId)
      // F1 fix-up / W4 GAP-05: the booking expired, but a succeeded intent
      // took the money — refund it regardless of the metadata/attribution
      // match, before answering. The 410 stays for the intent that was
      // this booking's; a differently-attributed succeeded intent is still
      // refunded, answered 409.
      if (expiredPaymentIntent.status === 'succeeded') {
        verifiedPaymentIntentId = expiredPaymentIntent.id
        try {
          await stripeAPI.refunds.create(
            { payment_intent: expiredPaymentIntent.id },
            { idempotencyKey: `expired-booking-${expiredPaymentIntent.id}` },
          )
        } catch (refundError) {
          logger.error('[booking.confirmPaymentIntent] Failed to refund payment for expired booking', refundError)
          res.status(500).send('Booking expired. Payment refund requires support review.')
          return
        }
        if (expiredPaymentIntent.metadata.bookingId === booking._id.toString()
          && booking.paymentIntentId === expiredPaymentIntent.id) {
          res.status(410).send('Booking expired; the payment was refunded')
          return
        }
        res.status(409).send('Booking expired; the payment was refunded. Support review is required.')
        return
      }
      res.status(409).send('Booking is not awaiting payment')
      return
    }

    const snapshot = booking.financialSnapshot
    // F1 fix-up round 2 / §8: Mongoose hydrates a missing financialSnapshot
    // as {} (truthy), so !snapshot is dead — a snapshot-less booking whose
    // intent matches would fall through to the verification below and
    // throw on snapshot.paymentCurrency, returning a bare 400 with the
    // money kept. Treat a snapshot without a numeric rental total as
    // missing (same guard as update()); the branch body already refunds a
    // succeeded intent before the 409.
    const hasRealSnapshot = !!snapshot && typeof snapshot.rentalTotal === 'number'
    if (!hasRealSnapshot || booking.paymentIntentId !== paymentIntentId) {
      // F1 fix-up / W4 GAP-05: a succeeded client-supplied intent that is
      // not this booking's intent took the money — refund it before the
      // 409, as the verification-mismatch branch below does. An intent
      // that never succeeded keeps the plain 409.
      try {
        const unlinkedIntent = await stripeAPI.paymentIntents.retrieve(paymentIntentId)
        if (unlinkedIntent.status === 'succeeded') {
          try {
            await stripeAPI.refunds.create(
              { payment_intent: unlinkedIntent.id },
              { idempotencyKey: `refund-${unlinkedIntent.id}-mismatch` },
            )
          } catch (refundError) {
            logger.error('[booking.confirmPaymentIntent] Failed to refund unlinked payment intent', refundError)
            res.status(500).send('Payment intent is not linked to this booking. Payment refund requires support review.')
            return
          }
          res.status(409).send('Payment intent is not linked to this booking; the payment was refunded. Support review is required.')
          return
        }
      } catch (err) {
        logger.error(`[booking.confirmPaymentIntent] Could not retrieve unlinked payment intent ${paymentIntentId}`, err)
      }
      res.status(409).send('Payment intent is not linked to this booking')
      return
    }

    const paymentIntent = await stripeAPI.paymentIntents.retrieve(paymentIntentId)
    if (paymentIntent.status !== 'succeeded'
      || paymentIntent.metadata.bookingId !== booking._id.toString()
      || paymentIntent.currency.toUpperCase() !== snapshot.paymentCurrency.toUpperCase()
      || paymentIntent.amount_received !== toMinorUnits(snapshot.amountDueNowInPaymentCurrency, snapshot.paymentCurrency)) {
      // F1 / W4 GAP-05: the intent already succeeded at Stripe, so a
      // verification mismatch must not keep the money. Refund it first and
      // return a distinct manual-review code.
      if (paymentIntent.status === 'succeeded') {
        try {
          await stripeAPI.refunds.create(
            { payment_intent: paymentIntent.id },
            { idempotencyKey: `refund-${paymentIntent.id}-mismatch` },
          )
          logger.error(`[booking.confirmPaymentIntent] Payment verification failed for booking ${booking._id}: expected ${snapshot.amountDueNowInPaymentCurrency} ${snapshot.paymentCurrency}, got ${paymentIntent.amount_received} ${paymentIntent.currency}; payment refunded`)
          res.status(409).send('Payment verification failed; the payment was refunded. Support review is required.')
          return
        } catch (refundError) {
          logger.error('[booking.confirmPaymentIntent] Failed to refund payment after verification mismatch', refundError)
          res.status(500).send('Payment verification failed. Payment refund requires support review.')
          return
        }
      }
      res.status(400).send('Payment verification failed')
      return
    }

    verifiedPaymentIntentId = paymentIntent.id
    const finalized = await finalizePaidCheckoutBooking(booking, 'stripe', paymentIntent.id)
    if (!finalized) {
      const existingPaidBooking = await Booking.findOne({ _id: booking._id, paymentIntentId: paymentIntent.id })
      if (existingPaidBooking && existingPaidBooking.status !== bookcarsTypes.BookingStatus.Void) {
        res.sendStatus(200)
        return
      }
      await stripeAPI.refunds.create(
        { payment_intent: paymentIntent.id },
        { idempotencyKey: `booking-unavailable-${paymentIntent.id}` },
      )
      res.status(409).send('Booking payment was already processed or availability changed')
      return
    }
    res.sendStatus(200)
  } catch (err) {
    if (err instanceof BookingConflictError) {
      if (verifiedPaymentIntentId) {
        try {
          await stripeAPI.refunds.create(
            { payment_intent: verifiedPaymentIntentId },
            { idempotencyKey: `booking-conflict-${verifiedPaymentIntentId}` },
          )
        } catch (refundError) {
          logger.error('[booking.confirmPaymentIntent] Failed to refund payment after booking conflict', refundError)
          res.status(500).send('Booking unavailable. Payment refund requires support review.')
          return
        }
      }
      res.status(409).send(err.message)
      return
    }
    logger.error(`[booking.confirmPaymentIntent] ${i18n.t('ERROR')}`, err instanceof Error ? err.message : 'Unknown error')
    // F1 / W3 P-2a + W4 GAP-05: finalisation can throw after the provider
    // payment succeeded (e.g. a ledger OVERPAYMENT). Never return a bare
    // 400 with the money taken: if the booking did finalise despite the
    // throw, report success; otherwise refund the succeeded intent first.
    if (verifiedPaymentIntentId) {
      try {
        const { bookingId: confirmBookingId } = req.body as { bookingId?: string }
        const paidBooking = mongoose.isValidObjectId(confirmBookingId)
          ? await Booking.findOne({ _id: confirmBookingId, paymentIntentId: verifiedPaymentIntentId, status: { $ne: bookcarsTypes.BookingStatus.Void } })
          : null
        if (paidBooking) {
          res.sendStatus(200)
          return
        }
        const failedIntent = await stripeAPI.paymentIntents.retrieve(verifiedPaymentIntentId)
        if (failedIntent.status === 'succeeded') {
          await stripeAPI.refunds.create(
            { payment_intent: verifiedPaymentIntentId },
            { idempotencyKey: `refund-${verifiedPaymentIntentId}-mismatch` },
          )
          res.status(409).send('Booking finalisation failed; the payment was refunded. Support review is required.')
          return
        }
      } catch (refundError) {
        logger.error('[booking.confirmPaymentIntent] Failed to refund payment after finalisation failure', refundError)
        res.status(500).send('Booking finalisation failed. Payment refund requires support review.')
        return
      }
    }
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Complete checkout process and create Booking.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const checkout = async (req: Request, res: Response) => {
  // F4 / W1 #10 — orphan-cleanup tracking. These live outside the try:
  // the catch cannot see block-scoped `let`s declared inside it. Only
  // a guest account created by THIS request is ever removed — an
  // existing account matched by email is never deleted.
  let guestUserCreatedInRequest = false
  let guestUserId: string | undefined
  let guestUserLicenseFile: string | undefined
  let guestAdditionalDriverId: string | undefined
  try {
    let user: env.User | null
    const { body }: { body: bookcarsTypes.CheckoutPayload } = req
    const { driver } = body

    if (!body.booking) {
      throw new Error('Booking not found')
    }

    if (!Object.values(bookcarsTypes.CheckoutPaymentMode).some((mode) => mode === body.paymentMode)
      || !Object.values(bookcarsTypes.PaymentGateway).some((gateway) => gateway === body.paymentGateway)
      || typeof body.currency !== 'string'
      || !bookcarsHelper.checkCurrency(body.currency.toUpperCase())) {
      res.status(400).send('Invalid checkout payment selection')
      return
    }
    const paymentMode = body.paymentMode!
    const paymentGateway = body.paymentGateway!
    const paymentCurrency = body.currency.toUpperCase()
    const paymentFlow = body.paymentFlow || 'embedded'
    if (!['embedded', 'paymentSheet'].includes(paymentFlow)
      || (paymentFlow === 'paymentSheet' && paymentGateway !== bookcarsTypes.PaymentGateway.Stripe)) {
      res.status(400).send('Unsupported checkout payment flow')
      return
    }

    // GA-PAR-22: a trashed car cannot be booked from the public funnel.
    // (findById keeps the pre-existing populate typing; the trash
    // check is explicit so a trashed car reads as 'not found'.)
    const carObj = await Car.findById(body.booking.car).populate('dateBasedPrices').lean()
    if (!carObj || carObj.deletedAt) {
      res.status(400).send('Car not found')
      return
    }
    const supplierId = carObj.supplier.toString()
    const supplier = await User.findById(supplierId)
    if (!supplier) {
      throw new Error(`Agency ${supplierId} not found`)
    }

    if (paymentMode === bookcarsTypes.CheckoutPaymentMode.PayLater && !supplier.payLater) {
      res.status(400).send('Pay later is not available for this agency')
      return
    }

    const fromDate = new Date(body.booking.from)
    const toDate = new Date(body.booking.to)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
      res.status(400).send('Invalid rental dates')
      return
    }
    const carLocationIds = (carObj.locations || []).map((locationId: mongoose.Types.ObjectId | string) => locationId.toString())
    if (!carLocationIds.includes(body.booking.pickupLocation.toString())
      || !carLocationIds.includes(body.booking.dropOffLocation.toString())) {
      res.status(400).send('Pick-up and drop-off locations must be available for this vehicle')
      return
    }

    if (driver) {
      const { license } = driver
      if (supplier.licenseRequired && !license) {
        throw new Error("Driver's license required")
      }
      if (license && !isValidLicenseCapabilityFilename(path.basename(license))) {
        throw new Error('Invalid or expired license capability')
      }
      if (supplier.licenseRequired && !(await helper.pathExists(path.join(env.CDN_TEMP_LICENSES, license!)))) {
        throw new Error("Driver's license file not found")
      }

      const existingUser = await User.findOne({ email: driver.email?.toLowerCase() })

      if (existingUser) {
        user = existingUser
      } else {
        // New guest account: the driver details become the account, so they
        // must be complete and the driver must meet the car's minimum age.
        // (The client schema marks these fields optional; without this the
        // API accepted phoneless, birthdate-less and underage drivers.)
        const guestFullName = typeof driver.fullName === 'string' ? driver.fullName.trim() : ''
        const guestPhone = typeof driver.phone === 'string' ? driver.phone.trim() : ''
        const guestBirthDate = driver.birthDate ? new Date(driver.birthDate) : null
        if (!guestFullName || !guestPhone || !guestBirthDate || Number.isNaN(guestBirthDate.getTime())) {
          res.status(400).send('Invalid driver information')
          return
        }
        if (carObj.minimumAge) {
          const nowDate = new Date()
          let driverAge = nowDate.getFullYear() - guestBirthDate.getFullYear()
          const monthDelta = nowDate.getMonth() - guestBirthDate.getMonth()
          if (monthDelta < 0 || (monthDelta === 0 && nowDate.getDate() < guestBirthDate.getDate())) {
            driverAge--
          }
          if (driverAge < carObj.minimumAge) {
            res.status(400).send('Driver does not meet the minimum age requirement')
            return
          }
        }
        user = new User({
          fullName: driver.fullName,
          email: driver.email,
          phone: driver.phone,
          birthDate: driver.birthDate,
          language: driver.language,
          type: bookcarsTypes.UserType.User,
          license: null,
          verified: false,
          blacklisted: false,
        })
        await user.save()
        guestUserCreatedInRequest = true
        guestUserId = user._id.toString()

        // create license
        if (license) {
          const safeLicense = path.basename(license)
          const tempLicensePath = path.resolve(env.CDN_TEMP_LICENSES, safeLicense)
          const filename = `${user._id.toString()}${path.extname(safeLicense)}`
          const destPath = path.resolve(env.CDN_LICENSES, filename)

          // security check: restrict allowed extensions
          const ext = path.extname(safeLicense)
          if (!env.allowedLicenseExtensions.includes(ext.toLowerCase())) {
            throw new Error('Invalid license file type')
          }

          if (!destPath.startsWith(path.resolve(env.CDN_LICENSES) + path.sep)) {
            throw new Error('Invalid destination path for license')
          }

          await asyncFs.rename(tempLicensePath, destPath)
          user.license = filename
          guestUserLicenseFile = filename
          await user.save()
        }

        const token = new Token({ user: user._id, token: helper.generateToken() })
        await token.save()

        i18n.locale = user.language

        const mailOptions: SendMailOptions = {
          from: env.SMTP_FROM,
          to: user.email,
          subject: i18n.t('ACCOUNT_ACTIVATION_SUBJECT'),
          html: `<p>
          ${i18n.t('HELLO')}${user.fullName},<br><br>
          ${i18n.t('ACCOUNT_ACTIVATION_LINK')}<br><br>
          ${helper.joinURL(env.FRONTEND_HOST, 'activate')}/?u=${encodeURIComponent(user._id.toString())}&e=${encodeURIComponent(user.email)}&t=${encodeURIComponent(token.token)}<br><br>
          ${i18n.t('REGARDS')}<br>
          </p>`,
        }
        await mailHelper.sendMail(mailOptions)
      }

      body.booking.driver = user._id.toString()
    } else {
      user = await User.findById(body.booking.driver)
    }

    if (!user) {
      throw new Error(`User ${body.booking.driver} not found`)
    }
    // GA-PAR-22: a trashed client cannot be booked from the public
    // funnel (covers both the existing-account-by-email branch and the
    // signed-in-driver branch above).
    if (user.type === bookcarsTypes.UserType.User && user.deletedAt) {
      res.status(403).send('CLIENT_TRASHED: This client is trashed and cannot be booked.')
      return
    }
    if (supplier.licenseRequired && !user!.license) {
      throw new Error("Driver's license required")
    }
    if (supplier.licenseRequired && !(await helper.pathExists(path.join(env.CDN_LICENSES, user!.license!)))) {
      throw new Error("Driver's license file not found")
    }

    // Calculate authoritative terms from agency-owned car pricing and options.
    const expectedBasePrice = bookcarsHelper.calculateTotalPrice(
      carObj as unknown as bookcarsTypes.Car,
      fromDate,
      toDate,
      supplier.priceChangeRate || 0,
      {
        cancellation: body.booking.cancellation,
        amendments: body.booking.amendments,
        theftProtection: body.booking.theftProtection,
        collisionDamageWaiver: body.booking.collisionDamageWaiver,
        fullInsurance: body.booking.fullInsurance,
        additionalDriver: body.booking.additionalDriver,
      }
    )
    const expectedBasePriceInBaseCurrency = await bookcarsHelper.convertPrice(expectedBasePrice, env.BASE_CURRENCY, env.BASE_CURRENCY)

    const depositAmount = Number((Number(carObj.deposit || 0) * (1 + (supplier.priceChangeRate || 0) / 100)).toFixed(2))
    if (paymentMode === bookcarsTypes.CheckoutPaymentMode.Deposit && depositAmount <= 0) {
      res.status(400).send('The selected deposit payment is not available')
      return
    }
    const amountDueNow = paymentMode === bookcarsTypes.CheckoutPaymentMode.PayLater ? 0
      : paymentMode === bookcarsTypes.CheckoutPaymentMode.Deposit ? depositAmount
        : paymentMode === bookcarsTypes.CheckoutPaymentMode.Full ? Number((expectedBasePriceInBaseCurrency + depositAmount).toFixed(2))
          : expectedBasePriceInBaseCurrency
    if (paymentMode !== bookcarsTypes.CheckoutPaymentMode.PayLater && amountDueNow <= 0) {
      res.status(400).send('The selected checkout amount must be greater than zero')
      return
    }
    // F2 / W4 GAP-02: the FX rate service is a live dependency — its
    // failure is a retryable provider outage, not a bad request. Answer
    // 503 (no booking is created and no money is taken at this point)
    // instead of letting the outer catch turn it into the generic 400.
    let amountDueNowInPaymentCurrency: number
    try {
      amountDueNowInPaymentCurrency = amountDueNow === 0 || paymentCurrency === env.BASE_CURRENCY.toUpperCase()
        ? amountDueNow
        : await bookcarsHelper.convertPrice(amountDueNow, env.BASE_CURRENCY.toUpperCase(), paymentCurrency)
    } catch (err) {
      logger.error('[booking.checkout] Currency conversion failed; checkout cannot be priced', err)
      res.status(503).send('Currency conversion is temporarily unavailable; please retry checkout')
      return
    }
    // F2 / W4 GAP-10: record the FX rate behind
    // amountDueNowInPaymentCurrency so the ledger's provider-settled leg
    // reconciles exactly. The rate is derived from the two converted
    // amounts (convertPrice rounds the converted total to 2dp); 1 with
    // source 'identity' when no conversion happened.
    const fxRate = amountDueNow > 0 && paymentCurrency !== env.BASE_CURRENCY.toUpperCase()
      ? Number((amountDueNowInPaymentCurrency / amountDueNow).toFixed(6))
      : 1
    const fxSource = paymentCurrency === env.BASE_CURRENCY.toUpperCase() ? 'identity' : 'easy-currencies'
    const financialSnapshot: bookcarsTypes.BookingFinancialSnapshot = {
      version: 1,
      baseCurrency: env.BASE_CURRENCY,
      paymentCurrency,
      mode: paymentMode,
      rentalTotal: expectedBasePriceInBaseCurrency,
      depositAmount,
      amountDueNow,
      amountDueNowInPaymentCurrency,
      quotedAt: new Date(),
      fxRate,
      fxSource,
      fxAt: new Date(),
    }

    const { language } = user
    i18n.locale = language

    let additionalDriverId: string | undefined
    if (body.booking.additionalDriver && body.additionalDriver) {
      const additionalDriver = new AdditionalDriver(body.additionalDriver)
      await additionalDriver.save()
      additionalDriverId = additionalDriver._id.toString()
      guestAdditionalDriverId = additionalDriver._id.toString()
    }

    const isPayLater = paymentMode === bookcarsTypes.CheckoutPaymentMode.PayLater
    const expireAt = isPayLater ? undefined : new Date(Date.now() + env.BOOKING_EXPIRE_AT * 1000)
    const reference = await nextBookingReference(supplier._id)

    // GA-PAR-10: the public checkout funnel ignores any overlapException
    // payload unconditionally — the booking below is built field-by-field
    // and never copies it, so normal conflict rules apply and no
    // exception record can be persisted from checkout.
    const booking = new Booking({
      reference,
      supplier: supplier._id,
      car: carObj._id,
      driver: user._id,
      pickupLocation: body.booking.pickupLocation,
      dropOffLocation: body.booking.dropOffLocation,
      from: fromDate,
      to: toDate,
      status: isPayLater ? bookcarsTypes.BookingStatus.Pending : bookcarsTypes.BookingStatus.Void,
      cancellation: !!body.booking.cancellation,
      amendments: !!body.booking.amendments,
      theftProtection: !!body.booking.theftProtection,
      collisionDamageWaiver: !!body.booking.collisionDamageWaiver,
      fullInsurance: !!body.booking.fullInsurance,
      additionalDriver: !!body.booking.additionalDriver,
      _additionalDriver: additionalDriverId,
      price: expectedBasePriceInBaseCurrency,
      isDeposit: paymentMode === bookcarsTypes.CheckoutPaymentMode.Deposit,
      isPayedInFull: paymentMode === bookcarsTypes.CheckoutPaymentMode.Full,
      financialSnapshot,
      sessionId: paymentGateway === bookcarsTypes.PaymentGateway.Stripe && !isPayLater && paymentFlow !== 'paymentSheet' ? undefined : randomUUID(),
      expireAt,
    })

    await saveBookingWithAvailability(booking)

    // GA-PAR-05: only the pay-later checkout is finalised at this point.
    if (isPayLater) {
      await ensureDraftInvoice(booking)
    }

    if (!isPayLater && !user.verified) {
      user.expireAt = new Date(Date.now() + env.USER_EXPIRE_AT * 1000)
      await user.save()
    }

    let customerId: string | undefined
    let clientSecret: string | null | undefined
    let paymentIntentId: string | undefined
    if (!isPayLater && paymentGateway === bookcarsTypes.PaymentGateway.Stripe) {
      let session: Stripe.Checkout.Session | undefined
      let pendingPaymentIntent: Stripe.PaymentIntent | undefined
      try {
        const customers = await stripeAPI.customers.list({ email: user.email })
        const customer = customers.data[0] || await stripeAPI.customers.create({ email: user.email, name: user.fullName })
        const name = bookcarsHelper.truncateString(`${env.WEBSITE_NAME} - ${carObj.name}`, 250)
        const description = bookcarsHelper.truncateString(`${env.WEBSITE_NAME} - ${carObj.name} - ${fromDate.toISOString()} - ${toDate.toISOString()}`, 500)
        if (paymentFlow === 'paymentSheet') {
          pendingPaymentIntent = await stripeAPI.paymentIntents.create({
            amount: toMinorUnits(amountDueNowInPaymentCurrency, paymentCurrency),
            currency: paymentCurrency.toLowerCase(),
            receipt_email: user.email,
            description,
            customer: customer.id,
            metadata: { bookingId: booking._id.toString() },
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          })
          booking.paymentIntentId = pendingPaymentIntent.id
          paymentIntentId = pendingPaymentIntent.id
          clientSecret = pendingPaymentIntent.client_secret
        } else {
          const expiresAt = Math.floor((Date.now() / 1000) + Math.min(env.STRIPE_SESSION_EXPIRE_AT, env.BOOKING_EXPIRE_AT))
          session = await stripeAPI.checkout.sessions.create({
            ui_mode: 'embedded',
            line_items: [{
              price_data: {
                product_data: { name },
                unit_amount: toMinorUnits(amountDueNowInPaymentCurrency, paymentCurrency),
                currency: paymentCurrency.toLowerCase(),
              },
              quantity: 1,
            }],
            mode: 'payment',
            return_url: `${helper.trimEnd(env.FRONTEND_HOST, '/')}/checkout-session/{CHECKOUT_SESSION_ID}`,
            customer: customer.id,
            locale: helper.getStripeLocale(language),
            metadata: { bookingId: booking._id.toString() },
            payment_intent_data: {
              description,
              metadata: { bookingId: booking._id.toString() },
            },
            expires_at: expiresAt,
          })
          booking.sessionId = session.id
          clientSecret = session.client_secret
        }
        booking.customerId = customer.id
        await booking.save()
        customerId = customer.id
        user.customerId = customer.id
        await user.save()
      } catch (providerError) {
        if (session) {
          await stripeAPI.checkout.sessions.expire(session.id).catch((expireError) => {
            logger.error('[booking.checkout] Could not expire unlinked Stripe session', expireError)
          })
        }
        if (pendingPaymentIntent) {
          await stripeAPI.paymentIntents.cancel(pendingPaymentIntent.id).catch((cancelError) => {
            logger.error('[booking.checkout] Could not cancel unlinked Stripe payment intent', cancelError)
          })
        }
        await Booking.deleteOne({ _id: booking._id, status: bookcarsTypes.BookingStatus.Void }).catch((deleteError) => {
          logger.error('[booking.checkout] Could not release unpaid temporary booking', deleteError)
        })
        throw providerError
      }
    }

    if (isPayLater) {
      // Mark car as fully booked
      // if (env.MARK_CAR_AS_FULLY_BOOKED_ON_CHECKOUT) {
      //   await Car.updateOne({ _id: booking.car }, { fullyBooked: false })
      // }

      // Send confirmation email to customer.
      // F1 / W4 GAP-06: the pay-later booking is already saved as Pending;
      // a failing mailer must not turn the checkout into a 400. Log and
      // continue, as in finalizePaidCheckoutBooking.
      try {
        if (!(await confirm(user, supplier, booking, true))) {
          logger.error(`[booking.checkout] Confirmation email could not be sent for pay-later booking ${booking._id}`)
        }
      } catch (err) {
        logger.error(`[booking.checkout] Confirmation email failed for pay-later booking ${booking._id}`, err)
      }

      // Notify supplier + admin. F1 / W4 GAP-06: same log-and-continue rule
      // as the confirmation email — the booking is already saved.
      try {
        i18n.locale = supplier.language
        let message = i18n.t('BOOKING_PAY_LATER_NOTIFICATION')
        await notify(user, booking._id.toString(), supplier, message)

        // Notify admin
        const admin = !!env.ADMIN_EMAIL && (await User.findOne({ email: env.ADMIN_EMAIL, type: bookcarsTypes.UserType.Admin }))
        if (admin) {
          i18n.locale = admin.language
          message = i18n.t('BOOKING_PAY_LATER_NOTIFICATION')
          await notify(user, booking._id.toString(), admin, message)
        }
      } catch (err) {
        logger.error(`[booking.checkout] Pay-later notification failed for booking ${booking._id}`, err)
      }
    }

    res.status(200).send({
      bookingId: booking._id.toString(),
      sessionId: booking.sessionId,
      customerId,
      clientSecret,
      paymentIntentId,
      financialSnapshot,
    } satisfies bookcarsTypes.CheckoutResult)
  } catch (err) {
    if (err instanceof BookingConflictError) {
      // F4 / W1 #10 — the conflict leaves the just-created guest user
      // behind with no `expireAt` (it is set only after the availability
      // save succeeds) and the activation email already sent — and the
      // additional-driver row created for it. Remove exactly what this
      // request created, best-effort and logged: the booking itself was
      // never saved (the save threw), so there is no booking row to
      // delete, and the reference counter advancing is harmless. A
      // pre-existing account matched by email is untouched.
      if (guestUserCreatedInRequest && guestUserId) {
        try {
          if (guestUserLicenseFile) {
            await asyncFs.unlink(path.resolve(env.CDN_LICENSES, guestUserLicenseFile)).catch(() => undefined)
          }
          await Token.deleteMany({ user: new mongoose.Types.ObjectId(guestUserId) })
          await User.deleteOne({ _id: new mongoose.Types.ObjectId(guestUserId) })
        } catch (cleanupError) {
          logger.error('[booking.checkout] Could not clean up guest account after booking conflict', cleanupError)
        }
      }
      if (guestAdditionalDriverId) {
        try {
          await AdditionalDriver.deleteOne({ _id: new mongoose.Types.ObjectId(guestAdditionalDriverId) })
        } catch (cleanupError) {
          logger.error('[booking.checkout] Could not clean up additional driver after booking conflict', cleanupError)
        }
      }
      res.status(409).send(err.message)
      return
    }
    logger.error(`[booking.checkout] ${i18n.t('ERROR')}`, err instanceof Error ? err.message : 'Unknown error')
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Notify driver and send push notification.
 *
 * @async
 * @param {env.Booking} booking
 * @returns {void}
 */
const notifyDriver = async (booking: env.Booking) => {
  const driver = await User.findById(booking.driver)
  if (!driver) {
    logger.info(`Driver ${booking.driver} not found`)
    return
  }

  i18n.locale = driver.language

  const message = `${i18n.t('BOOKING_UPDATED_NOTIFICATION_PART1')} ${booking._id} ${i18n.t('BOOKING_UPDATED_NOTIFICATION_PART2')}`
  const notification = new Notification({
    user: driver._id,
    message,
    booking: booking._id,
  })
  await notification.save()

  let counter = await NotificationCounter.findOne({ user: driver._id })
  if (counter && typeof counter.count !== 'undefined') {
    counter.count += 1
    await counter.save()
  } else {
    counter = new NotificationCounter({ user: driver._id, count: 1 })
    await counter.save()
  }

  // mail
  if (driver.enableEmailNotifications) {
    const mailOptions: SendMailOptions = {
      from: env.SMTP_FROM,
      to: driver.email,
      subject: message,
      html: `<p>
    ${i18n.t('HELLO')}${driver.fullName},<br><br>
    ${message}<br><br>
    ${helper.joinURL(env.FRONTEND_HOST, `booking?b=${booking._id}`)}<br><br>
    ${i18n.t('REGARDS')}<br>
    </p>`,
    }
    await mailHelper.sendMail(mailOptions)
  }

  // push notification
  const pushToken = await PushToken.findOne({ user: driver._id })
  if (pushToken) {
    const { token } = pushToken
    const expo = new Expo({ accessToken: env.EXPO_ACCESS_TOKEN })

    if (!Expo.isExpoPushToken(token)) {
      logger.info(`Push token ${token} is not a valid Expo push token.`)
      return
    }

    const messages: ExpoPushMessage[] = [
      {
        to: token,
        sound: 'default',
        body: message,
        data: {
          user: driver._id,
          notification: notification._id,
          booking: booking._id,
        },
      },
    ]

    // The Expo push notification service accepts batches of notifications so
    // that you don't need to send 1000 requests to send 1000 notifications. We
    // recommend you batch your notifications to reduce the number of requests
    // and to compress them (notifications with similar content will get
    // compressed).
    const chunks = expo.chunkPushNotifications(messages)
    const tickets: ExpoPushTicket[] = [];

    (async () => {
      // Send the chunks to the Expo push notification service. There are
      // different strategies you could use. A simple one is to send one chunk at a
      // time, which nicely spreads the load out over time:
      for (const chunk of chunks) {
        try {
          const ticketChunks = await expo.sendPushNotificationsAsync(chunk)

          tickets.push(...ticketChunks)

          // NOTE: If a ticket contains an error code in ticket.details.error, you
          // must handle it appropriately. The error codes are listed in the Expo
          // documentation:
          // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
          for (const ticketChunk of ticketChunks) {
            if (ticketChunk.status === 'ok') {
              logger.info(`Push notification sent: ${ticketChunk.id}`)
            } else {
              throw new Error(ticketChunk.message)
            }
          }
        } catch (error) {
          logger.error('Error while sending push notification', error)
        }
      }
    })()
  }
}

/**
 * Update Booking.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const update = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.UpsertBookingPayload } = req
    const booking = await Booking.findById(body.booking._id)

    if (booking) {
      // begin of security check
      const sessionUserId = req.user?._id
      const sessionUser = await User.findById(sessionUserId)
      const sessionAgencyId = agencySupplierId(req)
      const isAgencyUser = !!sessionUser && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
      if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User || (isAgencyUser && sessionAgencyId !== booking.supplier?.toString())) {
        logger.error(`[booking.update] Unauthorized attempt to update booking ${booking._id.toString()} by user ${sessionUserId}`)
        res.status(403).send('Forbidden: You cannot update booking information')
        return
      }
      // end of security check

      // GA-PAR-22: every mutation on a trashed booking refuses 409
      // TRASHED (wall sits after the agency/ownership check above,
      // before any other business validation).
      if (booking.deletedAt) {
        res.status(409).send(trashedMessage('booking'))
        return
      }

      const bookingId = (value: string | { _id?: string } | undefined) => (typeof value === 'string' ? value : value?._id) || ''
      const submittedSupplierId = bookingId(body.booking.supplier as string | { _id?: string })
      const submittedCarId = bookingId(body.booking.car as string | { _id?: string })
      const submittedPickupLocationId = bookingId(body.booking.pickupLocation as string | { _id?: string })
      const submittedDropOffLocationId = bookingId(body.booking.dropOffLocation as string | { _id?: string })

      // Never allow a normal booking edit to transfer an agency-owned contract or link it to another agency's vehicle.
      if (submittedSupplierId !== booking.supplier.toString()
        || !mongoose.isValidObjectId(submittedCarId)
        || !mongoose.isValidObjectId(submittedPickupLocationId)
        || !mongoose.isValidObjectId(submittedDropOffLocationId)) {
        res.status(400).send('Booking agency, vehicle, or location is invalid')
        return
      }

      // GA-PAR-22: a trashed car cannot be (re)selected on update.
      const vehicle = await Car.findOne({ _id: submittedCarId, supplier: booking.supplier, deletedAt: null }).select('_id locations').lean()
      const carLocationIds = (vehicle?.locations || []).map((locationId: mongoose.Types.ObjectId | string) => locationId.toString())
      if (!vehicle
        || !carLocationIds.includes(submittedPickupLocationId)
        || !carLocationIds.includes(submittedDropOffLocationId)) {
        res.status(400).send('Vehicle and locations must belong to the booking agency')
        return
      }

      const fromDate = new Date(body.booking.from)
      const toDate = new Date(body.booking.to)
      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
        res.status(400).send('Invalid rental dates')
        return
      }

      // GA-PAR-22: reassigning the booking to a trashed client refuses
      // 403 CLIENT_TRASHED (same rule as create/checkout).
      const submittedDriverId = bookingId(body.booking.driver as string | { _id?: string })
      if (submittedDriverId && submittedDriverId !== booking.driver.toString()) {
        const newDriver = await User.findOne({ _id: submittedDriverId, type: bookcarsTypes.UserType.User }).select('_id deletedAt').lean()
        if (!newDriver) {
          res.status(400).send('Booking customer not found')
          return
        }
        if (newDriver.deletedAt) {
          res.status(403).send('CLIENT_TRASHED: This client is trashed and cannot be booked.')
          return
        }
      }

      // GA-PAR-10: overlap-exception gate, same rules as create. A
      // payload whose reason matches the stored record is an echo of
      // the already-authorised exception (the admin form resubmits the
      // loaded booking), not a new exception: it continues under the
      // original stamp. A stored record with no payload also continues.
      // Anything else supplying a payload goes through the full gate
      // (Owner/Manager only, reason 3–1000) before anything persists.
      // NB: Mongoose hydrates the nested overlapException path as an
      // empty subdocument on loaded bookings, so a stored exception is
      // only real when it carries a reason — truthiness alone would
      // silently bypass every update conflict.
      const storedOverlapException = booking.overlapException?.reason ? booking.overlapException : undefined
      const rawOverlapException = (body.booking as bookcarsTypes.Booking).overlapException
      const isOverlapEcho = !!rawOverlapException && !!storedOverlapException
        && typeof rawOverlapException.reason === 'string'
        && rawOverlapException.reason === storedOverlapException.reason
      let overlapGate: OverlapExceptionGate = { ok: true }
      let overlapIsFresh = false
      if (rawOverlapException && !isOverlapEcho) {
        overlapGate = await resolveOverlapExceptionGate(
          req,
          { _id: sessionUser._id.toString(), type: sessionUser.type },
          booking.supplier.toString(),
          rawOverlapException,
        )
        if (!overlapGate.ok) {
          res.status(overlapGate.status).send(overlapGate.message)
          return
        }
        overlapIsFresh = !!overlapGate.reason
      }
      const overlapAllowed = overlapIsFresh || !!storedOverlapException

      const {
        supplier,
        car,
        driver,
        pickupLocation,
        dropOffLocation,
        from,
        to,
        status,
        cancellation,
        amendments,
        theftProtection,
        collisionDamageWaiver,
        fullInsurance,
        additionalDriver,
        price,
        isDeposit,
        isPayedInFull
      } = body.booking

      const previousStatus = booking.status

      // Mongoose hydrates a missing financialSnapshot as {} (truthy), so the
      // lock must only apply when a real snapshot with a rental total exists;
      // otherwise every snapshot-less booking (admin-created, legacy) is
      // permanently uneditable with a misleading 409.
      const hasRealSnapshot = !!booking.financialSnapshot && typeof booking.financialSnapshot.rentalTotal === 'number'
      const snapshotTermsChanged = hasRealSnapshot && (
        bookingId(body.booking.supplier as string | { _id?: string }) !== booking.supplier.toString()
        || bookingId(body.booking.car as string | { _id?: string }) !== booking.car.toString()
        || bookingId(body.booking.pickupLocation as string | { _id?: string }) !== booking.pickupLocation.toString()
        || bookingId(body.booking.dropOffLocation as string | { _id?: string }) !== booking.dropOffLocation.toString()
        || new Date(body.booking.from).getTime() !== booking.from.getTime()
        || new Date(body.booking.to).getTime() !== booking.to.getTime()
        || Number(body.booking.price) !== booking.financialSnapshot!.rentalTotal
        || !!body.booking.cancellation !== !!booking.cancellation
        || !!body.booking.amendments !== !!booking.amendments
        || !!body.booking.theftProtection !== !!booking.theftProtection
        || !!body.booking.collisionDamageWaiver !== !!booking.collisionDamageWaiver
        || !!body.booking.fullInsurance !== !!booking.fullInsurance
        || !!body.booking.additionalDriver !== !!booking.additionalDriver
      )
      if (snapshotTermsChanged) {
        res.status(409).send('Checkout terms are locked; use a contract amendment workflow')
        return
      }

      const paymentStatuses = new Set<string>([
        bookcarsTypes.BookingStatus.Deposit,
        bookcarsTypes.BookingStatus.Paid,
        bookcarsTypes.BookingStatus.PaidInFull,
      ])
      if (status !== previousStatus && (paymentStatuses.has(status) || paymentStatuses.has(previousStatus))) {
        // F3 / W1 #18: a paid booking is not cancelled by flipping its
        // status here — that dead-ended in a bare 400 with no in-UI
        // explanation. It goes through the cancel workflow (reason +
        // staff refund decision), which sets status + lifecycle
        // together. Name the workflow in the refusal so the admin UI can
        // surface the reason instead of a dead end.
        if (status === bookcarsTypes.BookingStatus.Cancelled && paymentStatuses.has(previousStatus)) {
          res.status(400).send('CANCEL_VIA_WORKFLOW: Paid and deposit bookings must be cancelled through the cancel workflow (reason and refund decision required); use the cancel action on the booking, not a status change.')
          return
        }
        res.status(400).send('Payment statuses can only be changed through a verified payment workflow')
        return
      }

      if (!body.booking.additionalDriver && booking._additionalDriver) {
        await AdditionalDriver.deleteOne({ _id: booking._additionalDriver })
      }

      if (body.additionalDriver) {
        const {
          fullName,
          email,
          phone,
          birthDate,
        } = body.additionalDriver

        if (booking._additionalDriver) {
          const additionalDriverRecord = await AdditionalDriver.findOne({ _id: booking._additionalDriver })
          if (!additionalDriverRecord) {
            const msg = `Additional Driver ${booking._additionalDriver} not found`
            logger.info(msg)
            res.status(204).send(msg)
            return
          }
          additionalDriverRecord.fullName = fullName
          additionalDriverRecord.email = email
          additionalDriverRecord.phone = phone
          additionalDriverRecord.birthDate = birthDate
          await additionalDriverRecord.save()
        } else {
          const additionalDriverRecord = new AdditionalDriver({
            fullName,
            email,
            phone,
            birthDate,
          })

          await additionalDriverRecord.save()
          booking._additionalDriver = additionalDriverRecord._id
        }
      }

      booking.supplier = new mongoose.Types.ObjectId(supplier as string)
      booking.car = new mongoose.Types.ObjectId(car as string)
      booking.driver = new mongoose.Types.ObjectId(driver as string)
      booking.pickupLocation = new mongoose.Types.ObjectId(pickupLocation as string)
      booking.dropOffLocation = new mongoose.Types.ObjectId(dropOffLocation as string)
      booking.from = from
      booking.to = to
      booking.status = status
      // F3 / W1 #1: cancellation sets the contract lifecycle together
      // with the status — a cancelled booking previously kept lifecycle
      // Draft/Active while only its status said Cancelled (the helper's
      // `lifecycle: Cancelled` exclusion was dead code for
      // cancellations). Reactivating a cancelled booking returns the
      // lifecycle to Draft.
      if (status === bookcarsTypes.BookingStatus.Cancelled && previousStatus !== bookcarsTypes.BookingStatus.Cancelled) {
        booking.lifecycle = bookcarsTypes.ContractLifecycle.Cancelled
      } else if (previousStatus === bookcarsTypes.BookingStatus.Cancelled && status !== bookcarsTypes.BookingStatus.Cancelled && booking.lifecycle === bookcarsTypes.ContractLifecycle.Cancelled) {
        booking.lifecycle = bookcarsTypes.ContractLifecycle.Draft
      }
      booking.cancellation = cancellation
      booking.amendments = amendments
      booking.theftProtection = theftProtection
      booking.collisionDamageWaiver = collisionDamageWaiver
      booking.fullInsurance = fullInsurance
      booking.additionalDriver = additionalDriver
      booking.price = booking.financialSnapshot?.rentalTotal ?? (price as number)
      if (!booking.financialSnapshot) {
        booking.isDeposit = isDeposit || false
        booking.isPayedInFull = isPayedInFull || false
      }

      // GA-PAR-07: apporteur snapshot update rule — the stored snapshot is
      // recomputed ONLY when the payload changes the agent inputs (a
      // different agent, or a mode/value that differs from the stored
      // snapshot). A payload without an `agent` key leaves the snapshot
      // untouched; an explicit null (or an empty agent id) clears it; a
      // payload amount is never trusted. Rental-total-only changes do NOT
      // re-rate the commission (amendment re-pricing is GA-PAR-11). When a
      // recompute does happen it uses the booking's current rental total
      // and day count; mode/value fall back to the stored snapshot when
      // the same agent is kept, and to the new agent's default when the
      // agent changes.
      if (Object.prototype.hasOwnProperty.call(body.booking, 'agent')) {
        const payloadAgent = (body.booking as bookcarsTypes.Booking).agent
        const storedAgent = booking.agent
        if (payloadAgent === null) {
          booking.agent = undefined
        } else if (payloadAgent) {
          const payloadAgentId = typeof payloadAgent.agent === 'string'
            ? payloadAgent.agent
            : (payloadAgent.agent as unknown as { _id?: string })?._id || ''
          if (!payloadAgentId) {
            booking.agent = undefined
          } else {
            const sameAgent = !!storedAgent && storedAgent.agent?.toString() === payloadAgentId
            const inputsChanged = !sameAgent
              || (payloadAgent.mode !== undefined && payloadAgent.mode !== storedAgent?.mode)
              || (payloadAgent.value !== undefined && Number(payloadAgent.value) !== storedAgent?.value)
            if (inputsChanged) {
              const resolvedAgent = await resolveBookingAgentSnapshot(
                booking.supplier.toString(),
                {
                  agent: payloadAgentId,
                  mode: payloadAgent.mode ?? (sameAgent ? storedAgent?.mode : undefined),
                  value: payloadAgent.value ?? (sameAgent ? storedAgent?.value : undefined),
                },
                booking.price,
                helper.days(booking.from, booking.to),
              )
              if (!resolvedAgent.ok) {
                res.status(400).send(resolvedAgent.error)
                return
              }
              booking.agent = resolvedAgent.snapshot as typeof booking.agent
            }
          }
        }
      }

      if (!additionalDriver && booking._additionalDriver) {
        booking._additionalDriver = undefined
      }

      // GA-PAR-10: a fresh exception is stamped before the save (the
      // conflicting booking is patched in afterwards, once the helper
      // reports it); a continuing stored exception is left verbatim.
      // Maintenance conflicts still throw inside the helper.
      if (overlapIsFresh && overlapGate.ok && overlapGate.reason) {
        booking.overlapException = {
          reason: overlapGate.reason,
          authorisedBy: sessionUser._id,
          authorisedAt: new Date(),
          conflictingBooking: undefined,
        }
      } else if (!storedOverlapException) {
        // No exception in play: clear the (possibly empty, Mongoose-
        // hydrated) nested path so no empty record is persisted.
        booking.overlapException = undefined
      }
      let updateOverlapConflictingId: string | undefined
      await saveBookingWithAvailability(booking, {
        allowOverlapException: overlapAllowed,
        onBookingConflict: (conflictingBookingId) => { updateOverlapConflictingId = conflictingBookingId },
      })
      if (overlapIsFresh) {
        if (updateOverlapConflictingId) {
          booking.overlapException!.conflictingBooking = new mongoose.Types.ObjectId(updateOverlapConflictingId)
          await booking.save()
        } else {
          // Nothing actually conflicted: an exception that excepts
          // nothing is not recorded (audit noise — cf. create).
          booking.overlapException = undefined
          await booking.save()
        }
      }

      if (previousStatus !== status) {
        // notify driver
        await notifyDriver(booking)
      }

      res.json(booking)
      return
    }

    logger.error('[booking.update] Booking not found:', body.booking._id)
    res.sendStatus(204)
  } catch (err) {
    if (err instanceof BookingConflictError) {
      res.status(409).send(err.message)
      return
    }
    logger.error(`[booking.update] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Update Booking Status.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const updateStatus = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.UpdateStatusPayload } = req
    const { ids: _ids, status } = body
    const ids = _ids.map((id) => new mongoose.Types.ObjectId(id))
    const paymentStatuses = new Set<string>([
      bookcarsTypes.BookingStatus.Deposit,
      bookcarsTypes.BookingStatus.Paid,
      bookcarsTypes.BookingStatus.PaidInFull,
    ])

    // begin of security check
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)

    if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User) {
      logger.error(`[booking.updateStatus] Unauthorized attempt to update status by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot update booking status')
      return
    }

    const filter: Record<string, any> = { _id: { $in: ids } }
    if ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)) {
      const supplierId = agencySupplierId(req)
      if (!supplierId) {
        res.status(403).send('Agency membership is required')
        return
      }
      filter.supplier = supplierId
    }
    // end of security check

    const bookings = await Booking.find(filter)

    // GA-PAR-22: a bulk status change refuses the whole request when
    // any target is trashed (wall before other business validation;
    // zero mutations on refusal).
    const trashedBooking = bookings.find((booking) => booking.deletedAt)
    if (trashedBooking) {
      res.status(409).send(`TRASHED: Booking ${trashedBooking._id.toString()} is trashed and cannot be modified. Restore it first.`)
      return
    }

    if (status === bookcarsTypes.BookingStatus.Cancelled && bookings.some((booking) => paymentStatuses.has(booking.status))) {
      // F3 / W1 #18: same workflow redirect as update() — a paid
      // booking is cancelled through the cancel workflow, never by a
      // bulk status flip. The whole request refuses; nothing mutates.
      res.status(400).send('CANCEL_VIA_WORKFLOW: Paid and deposit bookings must be cancelled through the cancel workflow (reason and refund decision required); use the cancel action on the booking, not a status change.')
      return
    }

    if (paymentStatuses.has(status) || bookings.some((booking) => paymentStatuses.has(booking.status) && booking.status !== status)) {
      res.status(400).send('Payment statuses can only be changed through a verified payment workflow')
      return
    }

    if (bookings.length === 0) {
      res.sendStatus(200)
      return
    }

    const previousStatuses = bookings.map((booking) => booking.status)
    for (const booking of bookings) {
      booking.status = status as bookcarsTypes.BookingStatus
      // F3 / W1 #1: lifecycle follows the status on cancellation (and
      // back to Draft when a cancelled booking is reactivated).
      if (status === bookcarsTypes.BookingStatus.Cancelled) {
        booking.lifecycle = bookcarsTypes.ContractLifecycle.Cancelled
      } else if (booking.lifecycle === bookcarsTypes.ContractLifecycle.Cancelled) {
        booking.lifecycle = bookcarsTypes.ContractLifecycle.Draft
      }
    }
    await saveBookingsWithAvailability(bookings)

    for (const [index, booking] of bookings.entries()) {
      if (previousStatuses[index] !== status) {
        await notifyDriver(booking)
      }
    }

    res.sendStatus(200)
  } catch (err) {
    if (err instanceof BookingConflictError) {
      res.status(409).send(err.message)
      return
    }
    logger.error(`[booking.updateStatus] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Delete Bookings.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const deleteBookings = async (req: Request, res: Response) => {
  try {
    // GA-PAR-22: hard delete is purge-from-trash ONLY (D-22.9). The
    // old delete-as-you-go shape is replaced by the H-025 pattern:
    // validate every id first (scope, trash state, linked-record
    // guards), then purge; any failure refuses the whole request with
    // zero mutations. The admin calls this only from the Trash view;
    // a live booking is never deleted by this route. The reason is
    // required (3–1000 chars, D-22.4); the durable trace is the
    // server log (D-22.8 — exactly one line per purged id).
    const body = req.body as { ids?: unknown, reason?: unknown } | string[]
    const idsRaw: unknown = Array.isArray(body) ? body : body?.ids
    const reason = Array.isArray(body) ? undefined : body?.reason
    if (!Array.isArray(idsRaw) || idsRaw.length === 0
      || idsRaw.some((id) => typeof id !== 'string' || !mongoose.isValidObjectId(id))) {
      res.status(400).send('Invalid booking ids')
      return
    }
    if (!isValidTrashReason(reason)) {
      res.status(400).send('PURGE_REASON: Purging a trashed booking requires a reason of 3 to 1000 characters.')
      return
    }
    const ids = (idsRaw as string[]).map((id) => new mongoose.Types.ObjectId(id))

    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User) {
      logger.error(`[booking.deleteBookings] Unauthorized purge attempt by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot delete bookings')
      return
    }
    const isAgencyUser = [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
    const sessionAgencyId = agencySupplierId(req)

    const bookings = await Booking.find({ _id: { $in: ids } })
    if (bookings.length !== ids.length) {
      res.status(400).send('PURGE_NOT_FOUND: One or more bookings were not found.')
      return
    }
    for (const booking of bookings) {
      if (isAgencyUser && sessionAgencyId !== booking.supplier?.toString()) {
        logger.error(`[booking.deleteBookings] Unauthorized purge attempt on booking ${booking._id.toString()} by user ${sessionUserId}`)
        res.status(403).send('Forbidden: You cannot delete some of the bookings')
        return
      }
      if (!booking.deletedAt) {
        res.status(409).send(`NOT_TRASHED: Booking ${booking._id.toString()} is not trashed. Trash it before purging.`)
        return
      }
    }

    // Purge guards (D-22.11): any linked record blocks the purge,
    // naming the blocker. Checked for every booking before any purge
    // runs, so a blocked bulk request changes nothing.
    // FIX22 (S1): AgentSettlement.bookingRefs is a Booking ref the
    // S-1 sweep missed — a settlement referencing the booking blocks
    // the purge (PURGE_BLOCKED_AGENT_SETTLEMENT).
    for (const booking of bookings) {
      const [payment, invoice, charge, quote, snapshot, inspection, settlement] = await Promise.all([
        RentalPayment.findOne({ booking: booking._id }).select('_id').lean(),
        Invoice.findOne({ booking: booking._id }).select('_id').lean(),
        ContractCharge.findOne({ booking: booking._id }).select('_id').lean(),
        Quote.findOne({ booking: booking._id }).select('_id').lean(),
        ContractSnapshot.findOne({ booking: booking._id }).select('_id').lean(),
        ContractInspection.findOne({ booking: booking._id }).select('_id').lean(),
        AgentSettlement.findOne({ bookingRefs: booking._id }).select('_id').lean(),
      ])
      const blockers: Array<[unknown, string, string]> = [
        [payment, 'RENTAL_PAYMENT', 'rental payments'],
        [invoice, 'INVOICE', 'invoices'],
        [charge, 'CONTRACT_CHARGE', 'contract charges'],
        [quote, 'QUOTE', 'quotes'],
        [snapshot, 'CONTRACT_SNAPSHOT', 'contract snapshots'],
        [inspection, 'CONTRACT_INSPECTION', 'contract inspections'],
        [settlement, 'AGENT_SETTLEMENT', 'agent settlements'],
      ]
      const found = blockers.find(([row]) => !!row)
      if (found) {
        res.status(409).send(`PURGE_BLOCKED_${found[1]}: Booking ${booking._id.toString()} has ${found[2]} and cannot be purged.`)
        return
      }
    }

    // Cascade on purge: ONLY the `_additionalDriver` row (S-1).
    // Notifications are left (today's behaviour); payments, invoices,
    // charges, quotes, snapshots, inspections and agent settlements
    // block the purge above instead of being deleted.
    for (const booking of bookings) {
      await booking.deleteOne()
      await AdditionalDriver.deleteOne({ _id: booking._additionalDriver })
      logger.info(`[booking.deleteBookings] Purged booking ${booking._id.toString()} by user ${sessionUserId} (reason: ${(reason as string).trim()})`)
    }

    res.sendStatus(200)
  } catch (err) {
    logger.error(`[booking.deleteBookings] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Delete temporary Booking created from checkout session.
 *
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const deleteTempBooking = async (req: Request, res: Response) => {
  const { bookingId, sessionId } = req.params

  try {
    const booking = await Booking.findOne({ _id: bookingId, sessionId, status: bookcarsTypes.BookingStatus.Void, expireAt: { $ne: null } })
    if (booking) {
      const user = await User.findOne({ _id: booking.driver, verified: false, expireAt: { $ne: null } })
      await user?.deleteOne()
    }
    await booking?.deleteOne()
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[booking.deleteTempBooking] ${i18n.t('ERROR')} ${JSON.stringify({ bookingId, sessionId })}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Get Booking by ID.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getBooking = async (req: Request, res: Response) => {
  const { id } = req.params
  const sessionId = req.query.sessionId as string | undefined

  try {
    const sessionUserId = req.user?._id
    const sessionUser = sessionUserId ? await User.findById(sessionUserId) : null

    const booking = await Booking.findById(id)
      .populate<{ supplier: env.UserInfo }>('supplier')
      .populate<{ car: env.CarInfo }>({
        path: 'car',
        populate: {
          path: 'supplier',
          model: 'User',
        },
      })
      .populate<{ driver: env.UserInfo }>({
        path: 'driver',
        select: '_id fullName avatar phone', // GA-PAR-23: driver phone for the WhatsApp contract send
      })
      .populate<{ pickupLocation: env.LocationInfo }>({
        path: 'pickupLocation',
        populate: {
          path: 'values',
          model: 'LocationValue',
        },
      })
      .populate<{ dropOffLocation: env.LocationInfo }>({
        path: 'dropOffLocation',
        populate: {
          path: 'values',
          model: 'LocationValue',
        },
      })
      .populate<{ _additionalDriver: env.AdditionalDriver }>('_additionalDriver')
      .lean()

    if (booking) {
      // 1. SessionId Token Check (for unauthenticated checkout session confirmation)
      const isValidSession = !!sessionId && booking.sessionId === sessionId

      // 2. Role-Based Authorization Check
      const isOwner = !!sessionUserId && booking.driver._id?.toString() === sessionUserId
      const sessionAgencyId = agencySupplierId(req)
      const isSupplier = !!sessionUser
        && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
        && booking.supplier._id?.toString() === sessionAgencyId
      const isAdmin = !!sessionUser && sessionUser.type === bookcarsTypes.UserType.Admin

      if (!isValidSession && !isOwner && !isSupplier && !isAdmin) {
        logger.error(`[booking.getBooking] Forbidden access to booking ${id}`)
        res.status(403).send('Forbidden: Access denied')
        return
      }

      // GA-PAR-22: a trashed booking is returned in full to the owning
      // agency / platform admin only; every other caller (the customer,
      // a checkout session) gets a silent 404 (OQ-7).
      if (booking.deletedAt && !isSupplier && !isAdmin) {
        res.sendStatus(404)
        return
      }

      const { language } = req.params

      booking.supplier = {
        _id: booking.supplier._id,
        fullName: booking.supplier.fullName,
        avatar: booking.supplier.avatar,
        payLater: booking.supplier.payLater,
        priceChangeRate: booking.supplier.priceChangeRate,
      }

      booking.car.supplier = {
        _id: booking.car.supplier._id,
        fullName: booking.car.supplier.fullName,
        avatar: booking.car.supplier.avatar,
        payLater: booking.car.supplier.payLater,
        priceChangeRate: booking.car.supplier.priceChangeRate,
      }

      booking.pickupLocation.name = resolveLocationTranslation(booking.pickupLocation.values, language)
      booking.dropOffLocation.name = resolveLocationTranslation(booking.dropOffLocation.values, language)
      // F4 / W1 #7 — late-return read model (Active + past `to`); a
      // computed flag only, never a stored state.
      ;(booking as unknown as Record<string, unknown>).overdue = isBookingOverdue({
        lifecycle: booking.lifecycle,
        to: booking.to,
      })

      // GA-PAR-12: signing secrets never leave the server. The nonce is
      // `select: false` (absent here by construction) and is deleted
      // defensively; the signature record is reduced to its derived
      // state — presence + signedAt — so the stored file name and
      // content hash stay server-side.
      delete booking.signingNonce
      if (booking.onlineSignature) {
        booking.onlineSignature = publicOnlineSignature(booking.onlineSignature) as env.Booking['onlineSignature']
      }

      res.json(booking)
      return
    }

    logger.error('[booking.getBooking] Booking not found:', id)
    res.sendStatus(204)
  } catch (err) {
    logger.error(`[booking.getBooking] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Get Booking by sessionId.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getBookingId = async (req: Request, res: Response) => {
  const { sessionId } = req.params

  try {
    const booking = await Booking.findOne({ sessionId })

    if (!booking) {
      logger.error('[booking.getBookingId] Booking not found (sessionId):', sessionId)
      res.sendStatus(204)
      return
    }
    res.json(booking?._id.toString())
  } catch (err) {
    logger.error(`[booking.getBookingId] (sessionId) ${i18n.t('ERROR')} ${sessionId}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Get Bookings.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getBookings = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.GetBookingsPayload } = req
    const page = Number.parseInt(req.params.page, 10)
    const size = Number.parseInt(req.params.size, 10)
    let suppliers = body.suppliers.map((id) => new mongoose.Types.ObjectId(id))
    const {
      statuses,
      // user,
      car,
    } = body
    const from = (body.filter && body.filter.from && new Date(body.filter.from)) || null
    const dateBetween = (body.filter && body.filter.dateBetween && new Date(body.filter.dateBetween)) || null
    const to = (body.filter && body.filter.to && new Date(body.filter.to)) || null
    const pickupLocation = (body.filter && body.filter.pickupLocation) || null
    const dropOffLocation = (body.filter && body.filter.dropOffLocation) || null
    let keyword = (body.filter && body.filter.keyword) || ''
    const options = 'i'

    // begin of security check
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    if (!sessionUser) {
      logger.error(`[booking.getBookings] Unauthorized attempt to get bookings by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot get booking information')
      return
    }
    if ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)) {
      const supplierId = agencySupplierId(req)
      if (!supplierId) {
        res.status(403).send('Agency membership is required')
        return
      }
      suppliers = [new mongoose.Types.ObjectId(supplierId)]
    }
    // end of security check

    const $match: mongoose.QueryFilter<any> = {
      // GA-PAR-22: live rows only — trashed bookings never leak into
      // the live list (the trash view has its own endpoint).
      $and: [{ 'supplier._id': { $in: suppliers } }, { status: { $in: statuses } }, { expireAt: null }, { deletedAt: null }],
    }

    if (sessionUser.type === bookcarsTypes.UserType.User) {
      $match.$and!.push({ 'driver._id': { $eq: new mongoose.Types.ObjectId(sessionUser._id) } })
    }

    // if (user) {
    //   $match.$and!.push({ 'driver._id': { $eq: new mongoose.Types.ObjectId(user) } })
    // }
    if (car) {
      $match.$and!.push({ 'car._id': { $eq: new mongoose.Types.ObjectId(car) } })
    }

    if (dateBetween) {
      const dateBetweenStart = new Date(dateBetween)
      dateBetweenStart.setHours(0, 0, 0, 0)
      const dateBetweenEnd = new Date(dateBetween)
      dateBetweenEnd.setHours(23, 59, 59, 999)

      $match.$and!.push({
        $and: [
          { from: { $lte: dateBetweenEnd } },
          { to: { $gte: dateBetweenStart } },
        ],
      })
    } else if (from) {
      $match.$and!.push({ from: { $gte: from } }) // $from >= from
    }

    if (to) {
      $match.$and!.push({ to: { $lte: to } })// $to < to
    }
    if (pickupLocation) {
      $match.$and!.push({ 'pickupLocation._id': { $eq: new mongoose.Types.ObjectId(pickupLocation) } })
    }
    if (dropOffLocation) {
      $match.$and!.push({ 'dropOffLocation._id': { $eq: new mongoose.Types.ObjectId(dropOffLocation) } })
    }
    if (keyword) {
      const isObjectId = helper.isValidObjectId(keyword)
      if (isObjectId) {
        $match.$and!.push({
          _id: { $eq: new mongoose.Types.ObjectId(keyword) },
        })
      } else {
        keyword = escapeStringRegexp(keyword)
        $match.$and!.push({
          $or: [
            { reference: { $regex: keyword, $options: options } },
            { 'supplier.fullName': { $regex: keyword, $options: options } },
            { 'driver.fullName': { $regex: keyword, $options: options } },
            { 'car.name': { $regex: keyword, $options: options } },
          ],
        })
      }
    }

    const { language } = req.params

    const data = await Booking.aggregate([
      {
        $lookup: {
          from: 'User',
          let: { supplierId: '$supplier' },
          pipeline: [
            {
              $match: { $expr: { $eq: ['$_id', '$$supplierId'] } },
            },
          ],
          as: 'supplier',
        },
      },
      { $unwind: { path: '$supplier', preserveNullAndEmptyArrays: false } },
      {
        $lookup: {
          from: 'Car',
          let: { carId: '$car' },
          pipeline: [
            {
              $match: { $expr: { $eq: ['$_id', '$$carId'] } },
            },
          ],
          as: 'car',
        },
      },
      { $unwind: { path: '$car', preserveNullAndEmptyArrays: false } },
      {
        $lookup: {
          from: 'User',
          let: { driverId: '$driver' },
          pipeline: [
            {
              $match: { $expr: { $eq: ['$_id', '$$driverId'] } },
            },
            {
              $project: { _id: 1, fullName: 1, avatar: 1 },
            },
          ],
          as: 'driver',
        },
      },
      { $unwind: { path: '$driver', preserveNullAndEmptyArrays: false } },
      {
        $lookup: {
          from: 'Location',
          let: { pickupLocationId: '$pickupLocation' },
          pipeline: [
            {
              $match: { $expr: { $eq: ['$_id', '$$pickupLocationId'] } },
            },
            {
              $lookup: {
                from: 'LocationValue',
                let: { values: '$values' },
                pipeline: [
                  {
                    $match: {
                      $and: [{ $expr: { $in: ['$_id', '$$values'] } }, { $expr: { $eq: ['$language', language] } }],
                    },
                  },
                ],
                as: 'value',
              },
            },
            {
              $addFields: { name: '$value.value' },
            },
          ],
          as: 'pickupLocation',
        },
      },
      {
        $unwind: { path: '$pickupLocation', preserveNullAndEmptyArrays: false },
      },
      {
        $lookup: {
          from: 'Location',
          let: { dropOffLocationId: '$dropOffLocation' },
          pipeline: [
            {
              $match: { $expr: { $eq: ['$_id', '$$dropOffLocationId'] } },
            },
            {
              $lookup: {
                from: 'LocationValue',
                let: { values: '$values' },
                pipeline: [
                  {
                    $match: {
                      $and: [{ $expr: { $in: ['$_id', '$$values'] } }, { $expr: { $eq: ['$language', language] } }],
                    },
                  },
                ],
                as: 'value',
              },
            },
            {
              $addFields: { name: '$value.value' },
            },
          ],
          as: 'dropOffLocation',
        },
      },
      {
        $unwind: {
          path: '$dropOffLocation',
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $match,
      },
      {
        $facet: {
          resultData: [{ $sort: { createdAt: -1, _id: 1 } }, { $skip: (page - 1) * size }, { $limit: size }],
          pageInfo: [
            {
              $count: 'totalRecords',
            },
          ],
        },
      },
    ])

    const bookings: env.BookingInfo[] = data[0].resultData

    for (const booking of bookings) {
      const { _id, fullName, avatar, priceChangeRate } = booking.supplier
      booking.supplier = { _id, fullName, avatar, priceChangeRate }
      // GA-PAR-12: aggregations bypass Mongoose `select: false`, so the
      // signing nonce is stripped here explicitly and the signature
      // record is reduced to presence + signedAt (see getBooking).
      const row = booking as unknown as Record<string, unknown>
      delete row.signingNonce
      // GA-PAR-22: lists carry the trash scalars (deletedAt /
      // deletedBy / deleteReason) but never the history (§3).
      delete row.trashHistory
      if (row.onlineSignature) {
        row.onlineSignature = publicOnlineSignature(row.onlineSignature as { signedAt?: Date })
      }
    }

    res.json(data)
  } catch (err) {
    logger.error(`[booking.getBookings] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * Check if a driver has Bookings.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const hasBookings = async (req: Request, res: Response) => {
  const { driver } = req.params

  try {
    if (!mongoose.isValidObjectId(driver) || !req.user) {
      res.status(400).send('Invalid driver')
      return
    }

    const sessionUser = req.user
    // GA-PAR-22: only LIVE bookings count (a client whose bookings are
    // all trashed reads as booking-free).
    const filter: mongoose.QueryFilter<env.Booking> = { driver: new mongoose.Types.ObjectId(driver), deletedAt: null }
    if (sessionUser.type === bookcarsTypes.UserType.User) {
      if (sessionUser._id.toString() !== driver) {
        res.status(403).send('Forbidden: Access denied')
        return
      }
    } else if ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)) {
      const supplierId = agencySupplierId(req)
      if (!supplierId || !mongoose.isValidObjectId(supplierId)) {
        res.status(403).send('Agency membership is required')
        return
      }
      filter.supplier = new mongoose.Types.ObjectId(supplierId)
    }

    const count = await Booking.find(filter).limit(1).countDocuments()
    res.sendStatus(count === 1 ? 200 : 204)
  } catch (err) {
    logger.error(`[booking.hasBookings] ${i18n.t('ERROR')} ${driver}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
/**
 * Cancel a Booking.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const cancelBooking = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const booking = await Booking
      .findOne({
        _id: new mongoose.Types.ObjectId(id),
      })
      .populate<{ supplier: env.User }>('supplier')
      .populate<{ driver: env.User }>('driver')

    if (booking && booking.cancellation && !booking.cancelRequest) {
      // begin of security check
      const sessionUserId = req.user?._id
      const sessionUser = sessionUserId ? await User.findById(sessionUserId) : null

      const isOwner = !!sessionUserId && booking.driver._id.toString() === sessionUserId
      const sessionAgencyId = agencySupplierId(req)
      const isSupplier = !!sessionUser
        && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
        && booking.supplier._id?.toString() === sessionAgencyId
      const isAdmin = !!sessionUser && sessionUser.type === bookcarsTypes.UserType.Admin

      if (!isOwner && !isSupplier && !isAdmin) {
        logger.error(`[booking.cancelBooking] Forbidden attempt to cancel booking ${id} by user ${sessionUserId}`)
        res.status(403).send('Forbidden: You cannot cancel this booking')
        return
      }
      // end of security check

      // GA-PAR-22: a trashed booking cannot be cancelled — restore first.
      if (booking.deletedAt) {
        res.status(409).send(trashedMessage('booking'))
        return
      }

      booking.cancelRequest = true
      // F3 / W1 #9: stamp the request so the queue can order and display
      // it (previously the flag was write-only with no time or author).
      booking.cancelRequestAt = new Date()
      if (sessionUserId && mongoose.isValidObjectId(sessionUserId)) {
        booking.cancelRequestBy = new mongoose.Types.ObjectId(sessionUserId)
      }
      await booking.save()

      // Notify supplier
      const supplier = await User.findById(booking.supplier)
      if (!supplier) {
        logger.info(`Supplier ${booking.supplier} not found`)
        res.sendStatus(204)
        return
      }
      i18n.locale = supplier.language
      await notify(booking.driver, booking._id.toString(), supplier, i18n.t('CANCEL_BOOKING_NOTIFICATION'))

      // Notify admin
      const admin = !!env.ADMIN_EMAIL && (await User.findOne({ email: env.ADMIN_EMAIL, type: bookcarsTypes.UserType.Admin }))
      if (admin) {
        i18n.locale = admin.language
        await notify(booking.driver, booking._id.toString(), admin, i18n.t('CANCEL_BOOKING_NOTIFICATION'))
      }

      res.sendStatus(200)
      return
    }

    res.sendStatus(204)
  } catch (err) {
    logger.error(`[booking.cancelBooking] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * F3 / W1 #1 + #9 + W4 GAP-11 — the staff cancel workflow.
 *
 * Paid/Deposit bookings could not be cancelled in-app at all: `update` /
 * `updateStatus` refuse leaving a payment status and `cancelBooking`
 * above only sets a flag nobody consumes. This is the replacement path:
 * a reasoned staff cancel that (a) sets `status: Cancelled` +
 * `lifecycle: Cancelled` in one save — the car is freed for the dates
 * because `Cancelled` reserves nothing (bookingReservationHelper) —
 * (b) executes the staff member's explicit refund decision, and (c)
 * records the decision with the amounts at stake so the money is
 * auditable.
 *
 * The refund amount is NEVER auto-decided here (ADR-001 deposit
 * release/retain/refund rules are an open owner decision — GAPS.md §5):
 * `full` reverses every posted payment through the F1 reversal path
 * (`reverseRentalPayment` — provider refund first, then the ledger
 * reversal row, same idempotent keys as the Payments page); `none`
 * keeps the money collected; `manual` cancels now and leaves the refund
 * to staff in the provider dashboard (`refundStatus: 'pending'`). A
 * partial refund cannot be executed by this workflow — it stays a
 * `manual` step. Refunds run BEFORE the status flip, so a failed
 * provider refund (502) cancels nothing and a retry only reverses the
 * legs that are still Posted.
 */

type StaffCancelResult =
  | { ok: true, refundedRent: number, refundedDeposit: number, refundProviderReferences: string[], refundStatus: bookcarsTypes.CancelRefundStatus }
  | { ok: false, status: number, message: string }

const isValidCancelReason = (reason: unknown): reason is string =>
  typeof reason === 'string' && reason.trim().length >= 3 && reason.trim().length <= 1000

const isValidRefundDecision = (decision: unknown): decision is bookcarsTypes.CancelRefundDecision =>
  decision === 'full' || decision === 'none' || decision === 'manual'

const authorizeStaffBooking = async (
  req: Request,
  booking: env.Booking,
  action: string,
): Promise<{ ok: true, sessionUser: env.User } | { ok: false, status: number, message: string }> => {
  const sessionUserId = req.user?._id
  const sessionUser = sessionUserId ? await User.findById(sessionUserId) : null
  if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User) {
    return { ok: false, status: 403, message: `Forbidden: You cannot ${action}` }
  }
  if ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)) {
    const sessionAgencyId = agencySupplierId(req)
    if (!sessionAgencyId || sessionAgencyId !== booking.supplier?.toString()) {
      return { ok: false, status: 403, message: `Forbidden: You cannot ${action} for another agency` }
    }
  }
  return { ok: true, sessionUser }
}

const executeStaffCancel = async (
  booking: env.Booking,
  actorId: string,
  reason: string,
  refundDecision: bookcarsTypes.CancelRefundDecision,
): Promise<StaffCancelResult> => {
  // Guards — every refusal happens before any money moves.
  if (booking.deletedAt) {
    return { ok: false, status: 409, message: trashedMessage('booking') }
  }
  if (booking.status === bookcarsTypes.BookingStatus.Void) {
    return { ok: false, status: 409, message: 'TEMP_BOOKING: This is a temporary checkout booking; release it through the checkout flow instead of cancelling it.' }
  }
  if (booking.status === bookcarsTypes.BookingStatus.Cancelled) {
    return { ok: false, status: 409, message: `ALREADY_CANCELLED: Booking ${booking._id.toString()} is already cancelled.` }
  }
  if ([
    bookcarsTypes.ContractLifecycle.Active,
    bookcarsTypes.ContractLifecycle.ReturnReview,
    bookcarsTypes.ContractLifecycle.Completed,
  ].includes(booking.lifecycle as bookcarsTypes.ContractLifecycle)) {
    return { ok: false, status: 409, message: 'CANCEL_AFTER_HANDOVER: The car has already been handed over; settle the contract through the return flow instead of cancelling it.' }
  }
  const pendingCharge = await ContractCharge.findOne({ booking: booking._id, status: bookcarsTypes.ApprovalDecision.Pending }).select('_id').lean()
  if (pendingCharge) {
    return { ok: false, status: 409, message: 'CANCEL_PENDING_CHARGES: This booking has pending contract charges. Decide them first, then cancel.' }
  }

  // Amounts at stake, from the same receivable the contract pages use
  // (rent posted, deposit posted — the deposit is never netted).
  const receivable = await getContractReceivable(booking)
  const rentPaid = receivable.postedPayments
  const depositPaid = receivable.depositPayments
  const requestedBy = booking.cancelRequestBy
  const requestedAt = booking.cancelRequestAt

  let refundedRent = 0
  let refundedDeposit = 0
  const refundProviderReferences: string[] = []
  let reversedCount = 0
  if (refundDecision === 'full') {
    const posted = await RentalPayment.find({
      booking: booking._id,
      status: bookcarsTypes.RentalPaymentStatus.Posted,
      direction: { $ne: bookcarsTypes.RentalPaymentDirection.Debit },
    }).sort({ date: 1, _id: 1 }).lean()
    for (const payment of posted) {
      try {
        const reversal = await reverseRentalPayment({
          paymentId: payment._id,
          actorId,
          idempotencyKey: `cancel-refund-${booking._id.toString()}-${payment._id.toString()}`,
          note: `Cancellation refund of booking ${booking.reference || booking._id.toString()}`,
        })
        reversedCount += 1
        if ((payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent) === bookcarsTypes.RentalPaymentPurpose.Deposit) {
          refundedDeposit += Number(payment.amount || 0)
        } else {
          refundedRent += Number(payment.amount || 0)
        }
        if (reversal.refundProviderReference) {
          refundProviderReferences.push(reversal.refundProviderReference)
        }
      } catch (err) {
        if (err instanceof LedgerError && err.code === 'REFUND_FAILED') {
          return { ok: false, status: 502, message: `REFUND_FAILED: The provider refund could not be completed (${err.message}). Nothing was cancelled; retry the cancellation once the provider refund succeeds.` }
        }
        if (err instanceof LedgerError) {
          return { ok: false, status: 409, message: err.message }
        }
        throw err
      }
    }
  }

  const refundStatus: bookcarsTypes.CancelRefundStatus = refundDecision === 'manual'
    ? 'pending'
    : reversedCount > 0 ? 'refunded' : 'none'
  booking.status = bookcarsTypes.BookingStatus.Cancelled
  booking.lifecycle = bookcarsTypes.ContractLifecycle.Cancelled
  booking.cancelRequest = false
  booking.cancelRequestAt = undefined
  booking.cancelRequestBy = undefined
  booking.cancellationRecord = {
    reason: reason.trim(),
    cancelledBy: new mongoose.Types.ObjectId(actorId),
    cancelledAt: new Date(),
    refundDecision,
    refundStatus,
    rentPaid,
    depositPaid,
    refundedRent,
    refundedDeposit,
    refundProviderReferences,
    ...(refundStatus === 'refunded' ? { refundedAt: new Date() } : {}),
    ...(requestedBy ? { requestedBy } : {}),
    ...(requestedAt ? { requestedAt } : {}),
  }
  // Cancelled reserves nothing, so the availability save only frees the
  // dates (and bumps the reservation version for any concurrent check).
  await saveBookingWithAvailability(booking)

  // The driver is told the booking was cancelled. A failing mailer must
  // not fail a completed cancellation (F1 / W4 GAP-06 lesson).
  try {
    await notifyDriver(booking)
  } catch (err) {
    logger.error(`[booking.cancel] Cancellation notification failed for booking ${booking._id.toString()}; booking stays cancelled`, err)
  }
  return { ok: true, refundedRent, refundedDeposit, refundProviderReferences, refundStatus }
}

/**
 * Staff cancel (F3 / W1 #1) — cancel any live booking with a reason and
 * an explicit staff refund decision. The executable outcome behind the
 * cancel-request queue (decideCancelRequest) and the direct cancel action.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const cancelBookingStaff = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { reason, refundDecision } = req.body as bookcarsTypes.CancelBookingPayload
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).send('Invalid booking')
      return
    }
    if (!isValidCancelReason(reason)) {
      res.status(400).send('CANCEL_REASON: Cancelling a booking requires a reason of 3 to 1000 characters.')
      return
    }
    if (!isValidRefundDecision(refundDecision)) {
      res.status(400).send('CANCEL_REFUND_DECISION: The refund decision is required: full (refund everything collected), none (keep the money collected), or manual (refund later in the provider dashboard). No partial refund is executed here.')
      return
    }
    const booking = await Booking.findById(id)
    if (!booking) {
      res.status(404).send('Booking not found')
      return
    }
    const scope = await authorizeStaffBooking(req, booking, 'cancel bookings')
    if (!scope.ok) {
      res.status(scope.status).send(scope.message)
      return
    }
    const result = await executeStaffCancel(booking, scope.sessionUser._id.toString(), reason, refundDecision)
    if (!result.ok) {
      res.status(result.status).send(result.message)
      return
    }
    res.json({
      booking,
      refund: {
        decision: refundDecision,
        status: result.refundStatus,
        rentPaid: booking.cancellationRecord?.rentPaid,
        depositPaid: booking.cancellationRecord?.depositPaid,
        refundedRent: result.refundedRent,
        refundedDeposit: result.refundedDeposit,
        refundProviderReferences: result.refundProviderReferences,
      },
    })
  } catch (err) {
    logger.error(`[booking.cancelBookingStaff] ${i18n.t('ERROR')} ${req.params.id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * F3 / W1 #9 — the cancel-request queue: pending customer cancel
 * requests with the amounts at stake (rent paid, deposit paid,
 * outstanding balance), so staff can decide each request with the money
 * in view. Same response shape as getBookings / getTrashedBookings.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getCancelRequests = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.GetBookingsPayload } = req
    const page = Number.parseInt(req.params.page, 10)
    const size = Number.parseInt(req.params.size, 10)
    let suppliers = (body.suppliers || []).map((supplierId) => new mongoose.Types.ObjectId(supplierId))

    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User) {
      logger.error(`[booking.getCancelRequests] Unauthorized attempt by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot get booking information')
      return
    }
    if ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)) {
      const supplierId = agencySupplierId(req)
      if (!supplierId) {
        res.status(403).send('Agency membership is required')
        return
      }
      suppliers = [new mongoose.Types.ObjectId(supplierId)]
    }

    const filter: mongoose.QueryFilter<env.Booking> = {
      supplier: { $in: suppliers },
      cancelRequest: true,
      expireAt: null,
      deletedAt: null,
    }
    const totalRecords = await Booking.countDocuments(filter)
    const rows = await Booking.find(filter)
      .populate<{ supplier: env.UserInfo }>('supplier', '_id fullName avatar')
      .populate<{ car: env.CarInfo }>('car', '_id name')
      .populate<{ driver: env.UserInfo }>('driver', '_id fullName avatar')
      .sort({ cancelRequestAt: -1, _id: 1 })
      .skip((page - 1) * size)
      .limit(size)
      .lean()

    const resultData: bookcarsTypes.CancelRequestRow[] = []
    for (const row of rows) {
      const receivable = await getContractReceivable(row as Pick<env.Booking, '_id' | 'price' | 'financialSnapshot'>)
      const r = row as unknown as Record<string, unknown>
      delete r.signingNonce
      resultData.push({
        booking: row as unknown as bookcarsTypes.Booking,
        currency: receivable.currency,
        rentPaid: receivable.postedPayments,
        depositPaid: receivable.depositPayments,
        outstandingBalance: receivable.outstandingBalance,
        requestedAt: (r.cancelRequestAt as Date | undefined),
      })
    }

    res.json([{ resultData, pageInfo: [{ totalRecords }] }])
  } catch (err) {
    logger.error(`[booking.getCancelRequests] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * F3 / W1 #9 — decide a customer cancel request. Approve executes the
 * staff cancel (same path as cancelBookingStaff, with the staff member's
 * explicit refund decision); deny clears the flag with a reason and
 * leaves the booking untouched.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const decideCancelRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { decision, reason, refundDecision } = req.body as bookcarsTypes.DecideCancelRequestPayload
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).send('Invalid booking')
      return
    }
    if (decision !== 'approve' && decision !== 'deny') {
      res.status(400).send('Invalid cancel-request decision')
      return
    }
    if (!isValidCancelReason(reason)) {
      res.status(400).send('CANCEL_REASON: Deciding a cancel request requires a reason of 3 to 1000 characters.')
      return
    }
    if (decision === 'approve' && !isValidRefundDecision(refundDecision)) {
      res.status(400).send('CANCEL_REFUND_DECISION: Approving a cancel request requires a refund decision: full (refund everything collected), none (keep the money collected), or manual (refund later in the provider dashboard). No partial refund is executed here.')
      return
    }
    const booking = await Booking.findById(id)
    if (!booking) {
      res.status(404).send('Booking not found')
      return
    }
    const scope = await authorizeStaffBooking(req, booking, 'decide cancel requests')
    if (!scope.ok) {
      res.status(scope.status).send(scope.message)
      return
    }
    if (!booking.cancelRequest) {
      res.status(409).send(`NO_CANCEL_REQUEST: Booking ${booking._id.toString()} has no pending cancel request.`)
      return
    }
    if (decision === 'deny') {
      booking.cancelRequest = false
      booking.cancelRequestAt = undefined
      booking.cancelRequestBy = undefined
      await booking.save()
      res.json(booking)
      return
    }
    const result = await executeStaffCancel(booking, scope.sessionUser._id.toString(), reason, refundDecision!)
    if (!result.ok) {
      res.status(result.status).send(result.message)
      return
    }
    res.json({
      booking,
      refund: {
        decision: refundDecision,
        status: result.refundStatus,
        rentPaid: booking.cancellationRecord?.rentPaid,
        depositPaid: booking.cancellationRecord?.depositPaid,
        refundedRent: result.refundedRent,
        refundedDeposit: result.refundedDeposit,
        refundProviderReferences: result.refundProviderReferences,
      },
    })
  } catch (err) {
    logger.error(`[booking.decideCancelRequest] ${i18n.t('ERROR')} ${req.params.id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * F4 / W1 #7 — mark a booking as a no-show (roadmap §3: the no-show path
 * must be explicit; absent in both codebases).
 *
 * A `Draft`/`Confirmed` booking whose scheduled pickup time has passed
 * without a handover is cancelled: `status` + `lifecycle` become
 * `Cancelled` in one availability save, so the car is freed for the
 * dates exactly as a staff cancel frees them. The no-show itself is
 * recorded with server-stamped `noShowAt` / `noShowBy` — no refund or
 * fee decision is taken here: any charge/fee attached to a no-show is
 * ADR-001-gated (GAPS.md §5) and must never be invented by this
 * endpoint. The driver is notified best-effort (a failing mailer never
 * fails the marking, F1 / W4 GAP-06 lesson).
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const markNoShow = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).send('Invalid booking')
      return
    }
    const booking = await Booking.findById(id)
    if (!booking) {
      res.sendStatus(404)
      return
    }
    const scope = await authorizeStaffBooking(req, booking, 'mark bookings as no-show')
    if (!scope.ok) {
      res.status(scope.status).send(scope.message)
      return
    }
    if (booking.deletedAt) {
      res.status(409).send(trashedMessage('booking'))
      return
    }
    if (booking.status === bookcarsTypes.BookingStatus.Void) {
      res.status(409).send('TEMP_BOOKING: This is a temporary checkout booking; release it through the checkout flow instead of marking it as a no-show.')
      return
    }
    if (booking.status === bookcarsTypes.BookingStatus.Cancelled) {
      res.status(409).send(`ALREADY_CANCELLED: Booking ${booking._id.toString()} is already cancelled.`)
      return
    }
    // A missing lifecycle reads as Draft (the Mongoose default on
    // create); only a booking that has not been handed over can
    // no-show — Active means the car was collected.
    const lifecycle = booking.lifecycle || bookcarsTypes.ContractLifecycle.Draft
    if (![bookcarsTypes.ContractLifecycle.Draft, bookcarsTypes.ContractLifecycle.Confirmed].includes(lifecycle)) {
      res.status(409).send('NO_SHOW_INVALID_STATE: Only a booking that has not been handed over can be marked as a no-show. The car has already been collected or the contract has moved on; settle it through the return flow instead.')
      return
    }
    // F4-2 / W1 #7 — a paid booking is never no-showed here. Marking
    // it no-show would cancel it with no refund decision and no
    // cancellationRecord, bypassing the F3 cancel workflow's
    // explicit-refund-decision rule for paid cancels: the money would
    // stay Posted against a Cancelled booking with no audit trail of
    // its disposition, and any retain decision is ADR-001-gated. Staff
    // must cancel through POST /api/bookings/:id/cancel instead, where
    // the decision is recorded. The no-show path therefore covers
    // exactly the unpaid bookings the gap sketch names. Placed after
    // the lifecycle check on purpose, so a handed-over paid booking
    // still answers NO_SHOW_INVALID_STATE.
    if ([bookcarsTypes.BookingStatus.Deposit, bookcarsTypes.BookingStatus.Paid, bookcarsTypes.BookingStatus.PaidInFull].includes(booking.status)) {
      res.status(409).send('NO_SHOW_PAID_BOOKING: This booking has money collected; cancel it through the staff cancel workflow with an explicit refund decision instead of marking it as a no-show.')
      return
    }
    if (Date.now() <= new Date(booking.from).getTime()) {
      res.status(409).send('NO_SHOW_TOO_EARLY: The scheduled pickup time has not passed yet.')
      return
    }
    booking.status = bookcarsTypes.BookingStatus.Cancelled
    booking.lifecycle = bookcarsTypes.ContractLifecycle.Cancelled
    booking.noShowAt = new Date()
    booking.noShowBy = new mongoose.Types.ObjectId(scope.sessionUser._id.toString())
    booking.cancelRequest = false
    booking.cancelRequestAt = undefined
    booking.cancelRequestBy = undefined
    // Cancelled reserves nothing, so the availability save only frees
    // the dates (and bumps the reservation version for any concurrent
    // check) — the same shape as executeStaffCancel.
    await saveBookingWithAvailability(booking)
    try {
      await notifyDriver(booking)
    } catch (err) {
      logger.error(`[booking.markNoShow] Driver notification failed for no-show booking ${booking._id}`, err)
    }
    res.json(booking)
  } catch (err) {
    logger.error(`[booking.markNoShow] ${i18n.t('ERROR')} ${req.params.id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * F4 / W1 #7 — the overdue (late-return) list: `Active` bookings whose
 * scheduled return `to` has passed, most overdue first. Read-model only
 * (same rule as isBookingOverdue, expressed as the Mongo filter) — no
 * status is written. Same response shape and agency scoping as the
 * cancel-request queue (F3 / W1 #9).
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getOverdueBookings = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.GetBookingsPayload } = req
    const page = Number.parseInt(req.params.page, 10)
    const size = Number.parseInt(req.params.size, 10)
    let suppliers = (body.suppliers || []).map((supplierId) => new mongoose.Types.ObjectId(supplierId))

    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User) {
      logger.error(`[booking.getOverdueBookings] Unauthorized attempt by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot get booking information')
      return
    }
    if ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)) {
      const supplierId = agencySupplierId(req)
      if (!supplierId) {
        res.status(403).send('Agency membership is required')
        return
      }
      suppliers = [new mongoose.Types.ObjectId(supplierId)]
    }

    const now = new Date()
    const filter: mongoose.QueryFilter<env.Booking> = {
      supplier: { $in: suppliers },
      lifecycle: bookcarsTypes.ContractLifecycle.Active,
      to: { $lt: now },
      status: { $nin: [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled] },
      deletedAt: null,
    }
    const totalRecords = await Booking.countDocuments(filter)
    const rows = await Booking.find(filter)
      .populate<{ supplier: env.UserInfo }>('supplier', '_id fullName avatar')
      .populate<{ car: env.CarInfo }>('car', '_id name')
      .populate<{ driver: env.UserInfo }>('driver', '_id fullName avatar')
      .sort({ to: 1, _id: 1 })
      .skip((page - 1) * size)
      .limit(size)
      .lean()

    const resultData: bookcarsTypes.OverdueBookingRow[] = []
    for (const row of rows) {
      const receivable = await getContractReceivable(row as Pick<env.Booking, '_id' | 'price' | 'financialSnapshot'>)
      const r = row as unknown as Record<string, unknown>
      delete r.signingNonce
      resultData.push({
        booking: row as unknown as bookcarsTypes.Booking,
        currency: receivable.currency,
        overdueSince: row.to,
        overdueHours: bookcarsHelper.hours(row.to, now),
      })
    }

    res.json([{ resultData, pageInfo: [{ totalRecords }] }])
  } catch (err) {
    logger.error(`[booking.getOverdueBookings] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * F3 / W1 #3 — staff manual payment confirmation (cash at the counter,
 * walk-in rentals, pay-later collections).
 *
 * Two shapes in one endpoint: with `amount` it posts the just-collected
 * cash to the ledger first (Cash by default; any RentalPaymentMethod, any
 * purpose — Rent by default) and then derives the status; without it, it
 * derives the status from already-posted payments only (e.g. cash that
 * was recorded on the Payments page). The status is always DERIVED from
 * the ledger via refreshBookingPaymentStatus — Pending/Reserved with
 * nothing outstanding becomes Paid, Deposit with nothing outstanding
 * becomes PaidInFull — never trusted from the payload. A partial
 * collection answers 200 with `updated: false` and the outstanding
 * balance, so the counter can see what is still due; a booking whose
 * dates were taken meanwhile answers 200 with `conflict: true` (the
 * payment stays posted).
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const confirmManualPayment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const payload = req.body as bookcarsTypes.ConfirmManualPaymentPayload
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).send('Invalid booking')
      return
    }
    const booking = await Booking.findById(id)
    if (!booking) {
      res.status(404).send('Booking not found')
      return
    }
    const scope = await authorizeStaffBooking(req, booking, 'confirm payments for bookings')
    if (!scope.ok) {
      res.status(scope.status).send(scope.message)
      return
    }
    if (booking.deletedAt) {
      res.status(409).send(trashedMessage('booking'))
      return
    }
    if ([bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled].includes(booking.status)) {
      res.status(409).send('PAYMENT_CONFIRM_CLOSED: This booking is closed and cannot have payments confirmed.')
      return
    }
    if (payload?.amount !== undefined) {
      const amount = Number(payload.amount)
      const method = payload.method || bookcarsTypes.RentalPaymentMethod.Cash
      const purpose = payload.purpose || bookcarsTypes.RentalPaymentPurpose.Rent
      const note = typeof payload.note === 'string' ? payload.note.trim() : ''
      const reference = typeof payload.reference === 'string' ? payload.reference.trim() : ''
      if (!Number.isFinite(amount) || amount <= 0
        || !Object.values(bookcarsTypes.RentalPaymentMethod).includes(method)
        || !Object.values(bookcarsTypes.RentalPaymentPurpose).includes(purpose)
        || note.length > 1000 || reference.length > 160) {
        res.status(400).send('Invalid manual payment')
        return
      }
      try {
        await postRentalPayment({
          bookingId: booking._id,
          supplierId: scope.sessionUser.type === bookcarsTypes.UserType.Admin ? undefined : agencySupplierId(req),
          date: new Date(),
          amount,
          currency: payload.currency,
          method,
          purpose,
          actorId: scope.sessionUser._id,
          note: note || undefined,
          reference: reference || undefined,
        })
      } catch (err) {
        if (err instanceof LedgerError) {
          const status = err.code === 'BOOKING_NOT_FOUND' ? 404
            : err.code === 'DUPLICATE_IDEMPOTENCY_KEY' ? 409
              : err.code === 'TRASHED' ? 409
              : 400
          res.status(status).send(err.message)
          return
        }
        throw err
      }
    }
    const refresh = await refreshBookingPaymentStatus(booking._id)
    const updatedBooking = await Booking.findById(id)
    res.json({
      booking: updatedBooking,
      status: refresh.status,
      updated: refresh.updated,
      outstandingBalance: refresh.outstandingBalance,
      currency: refresh.currency,
      postedRent: refresh.postedRent,
      depositPaid: refresh.depositPaid,
      conflict: refresh.conflict,
      ...(refresh.conflict ? { message: 'PAYMENT_CONFLICT: The payment was recorded but the booking cannot be confirmed to Paid: the car is no longer available for the rental dates.' } : {}),
    })
  } catch (err) {
    logger.error(`[booking.confirmManualPayment] ${i18n.t('ERROR')} ${req.params.id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * GA-PAR-22 — Trash Bookings (scorecard #47, D-22.3/D-22.4).
 *
 * Trash is an operational visibility state, not a financial reversal:
 * exactly `deletedAt` / `deletedBy` / `deleteReason` are written and
 * one `trashHistory` row is appended (exact-reversal invariant D-22.2),
 * with a plain `save()` — never through `saveBookingWithAvailability`.
 * The trashHistory row records whether the §5.7 money warning fired
 * (`hadPayments` / `hadInvoices`). All-or-nothing per request (H-025):
 * every id is validated before any mutation; any refusal changes
 * nothing. Refusals: already trashed → 409 TRASHED; a temporary
 * (`expireAt`-set) booking → 409 TEMP_BOOKING.
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const trashBookings = async (req: Request, res: Response) => {
  try {
    const body = req.body as { ids?: unknown, reason?: unknown }
    const { ids: idsRaw, reason } = body
    if (!Array.isArray(idsRaw) || idsRaw.length === 0
      || idsRaw.some((id) => typeof id !== 'string' || !mongoose.isValidObjectId(id))) {
      res.status(400).send('Invalid booking ids')
      return
    }
    if (!isValidTrashReason(reason)) {
      res.status(400).send('TRASH_REASON: Trashing a booking requires a reason of 3 to 1000 characters.')
      return
    }
    const ids = (idsRaw as string[]).map((id) => new mongoose.Types.ObjectId(id))

    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User) {
      logger.error(`[booking.trashBookings] Unauthorized trash attempt by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot trash bookings')
      return
    }
    const isAgencyUser = [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
    const sessionAgencyId = agencySupplierId(req)

    const bookings = await Booking.find({ _id: { $in: ids } })
    if (bookings.length !== ids.length) {
      res.status(400).send('TRASH_NOT_FOUND: One or more bookings were not found.')
      return
    }
    // Validate everything before mutating anything (H-025).
    const flags = new Map<string, { hadPayments: boolean, hadInvoices: boolean }>()
    for (const booking of bookings) {
      if (isAgencyUser && sessionAgencyId !== booking.supplier?.toString()) {
        logger.error(`[booking.trashBookings] Unauthorized trash attempt on booking ${booking._id.toString()} by user ${sessionUserId}`)
        res.status(403).send('Forbidden: You cannot trash some of the bookings')
        return
      }
      if (booking.deletedAt) {
        res.status(409).send(`TRASHED: Booking ${booking._id.toString()} is already trashed.`)
        return
      }
      if (booking.expireAt) {
        res.status(409).send(`TEMP_BOOKING: Booking ${booking._id.toString()} is a temporary checkout booking and cannot be trashed.`)
        return
      }
      // §5.7 money warning, from the same sources the Payments /
      // Invoices pages use; the flags land on the history row (§2.5).
      const [payment, invoice] = await Promise.all([
        RentalPayment.findOne({ booking: booking._id, status: bookcarsTypes.RentalPaymentStatus.Posted }).select('_id').lean(),
        Invoice.findOne({ booking: booking._id, status: { $ne: bookcarsTypes.InvoiceStatus.Voided } }).select('_id').lean(),
      ])
      flags.set(booking._id.toString(), { hadPayments: !!payment, hadInvoices: !!invoice })
    }

    for (const booking of bookings) {
      applyTrash(booking, sessionUser._id.toString(), reason as string, flags.get(booking._id.toString()))
      await booking.save()
    }
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[booking.trashBookings] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * GA-PAR-22 — Restore Bookings (scorecard #47, D-22.6).
 *
 * Exact reversal of trash (the three fields are cleared, one history
 * row appended). Re-validation before any mutation, in the design's
 * order: (a) car exists + live else 409 CAR_TRASHED; (b) driver exists
 * + live else 409 CLIENT_TRASHED; (c) driver not Blocked/blacklisted
 * else 409 CLIENT_BLOCKED; (d) availability re-runs against LIVE
 * bookings only else 409 OVERLAP naming the conflicting booking (a
 * stored PAR-10 overlap exception stays valid for the conflicting
 * booking it names — OQ-8; maintenance conflicts are never excepted).
 * Locations are NOT re-validated. The reason is optional (≤1000).
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const restoreBookings = async (req: Request, res: Response) => {
  try {
    const body = req.body as { ids?: unknown, reason?: unknown }
    const { ids: idsRaw, reason } = body
    if (!Array.isArray(idsRaw) || idsRaw.length === 0
      || idsRaw.some((id) => typeof id !== 'string' || !mongoose.isValidObjectId(id))) {
      res.status(400).send('Invalid booking ids')
      return
    }
    if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length > 1000)) {
      res.status(400).send('RESTORE_REASON: A restore reason must be at most 1000 characters.')
      return
    }
    const ids = (idsRaw as string[]).map((id) => new mongoose.Types.ObjectId(id))

    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User) {
      logger.error(`[booking.restoreBookings] Unauthorized restore attempt by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot restore bookings')
      return
    }
    const isAgencyUser = [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
    const sessionAgencyId = agencySupplierId(req)

    const bookings = await Booking.find({ _id: { $in: ids } })
    if (bookings.length !== ids.length) {
      res.status(400).send('RESTORE_NOT_FOUND: One or more bookings were not found.')
      return
    }
    // Validate everything before mutating anything (H-025).
    for (const booking of bookings) {
      if (isAgencyUser && sessionAgencyId !== booking.supplier?.toString()) {
        logger.error(`[booking.restoreBookings] Unauthorized restore attempt on booking ${booking._id.toString()} by user ${sessionUserId}`)
        res.status(403).send('Forbidden: You cannot restore some of the bookings')
        return
      }
      if (!booking.deletedAt) {
        res.status(409).send(`NOT_TRASHED: Booking ${booking._id.toString()} is not trashed.`)
        return
      }
      const car = await Car.findById(booking.car).select('_id deletedAt').lean()
      if (!car || car.deletedAt) {
        res.status(409).send(`CAR_TRASHED: The car of booking ${booking._id.toString()} is trashed or no longer exists. Restore the car first.`)
        return
      }
      const driver = await User.findById(booking.driver).select('_id clientStatus blacklisted deletedAt').lean()
      if (!driver || driver.deletedAt) {
        res.status(409).send(`CLIENT_TRASHED: The client of booking ${booking._id.toString()} is trashed or no longer exists. Restore the client first.`)
        return
      }
      if (driver.clientStatus === bookcarsTypes.ClientStatus.Blocked || driver.blacklisted === true) {
        res.status(409).send(`CLIENT_BLOCKED: The client of booking ${booking._id.toString()} is blocked and cannot be restored to a live booking.`)
        return
      }
      const conflict = await findBookingConflictForRestore(booking)
      if (conflict.maintenance) {
        res.status(409).send(`OVERLAP: Booking ${booking._id.toString()} conflicts with scheduled maintenance for the car in the selected dates.`)
        return
      }
      // F7 / W3 M-4 — an overdue schedule blocks a restore exactly
      // like it blocks a fresh booking; the message names the schedule.
      if (conflict.overdueSchedule) {
        res.status(409).send(`OVERDUE_MAINTENANCE: Booking ${booking._id.toString()} cannot be restored: the car has an overdue maintenance schedule (${conflict.overdueSchedule.title}: ${conflict.overdueSchedule.trigger}).`)
        return
      }
      if (conflict.conflictingBookingId) {
        // OQ-8: a stored PAR-10 overlap exception stays valid for the
        // conflicting booking it names.
        const exceptedId = booking.overlapException?.reason
          ? booking.overlapException?.conflictingBooking?.toString()
          : undefined
        if (exceptedId !== conflict.conflictingBookingId) {
          res.status(409).send(`OVERLAP: Booking ${booking._id.toString()} conflicts with booking ${conflict.conflictingBookingId} for the selected dates.`)
          return
        }
      }
    }

    for (const booking of bookings) {
      applyRestore(booking, sessionUser._id.toString(), typeof reason === 'string' ? reason : undefined)
      await booking.save()
    }
    res.sendStatus(200)
  } catch (err) {
    logger.error(`[booking.restoreBookings] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * GA-PAR-22 — Get Trashed Bookings (scorecard #47, §5.2/§5.3).
 *
 * The trash view's read path is a separate dedicated endpoint — live
 * endpoints can never return trashed rows. Same response shape as
 * `getBookings` (aggregate-style `{ resultData, pageInfo }`), same
 * keyword behaviour (reference, driver name, car name), sorted by
 * trashed-at descending. Rows carry the trash scalars (`deletedAt` /
 * `deletedBy` / `deleteReason`) and the trashed-by name, never the
 * history (§3).
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getTrashedBookings = async (req: Request, res: Response) => {
  try {
    const { body }: { body: bookcarsTypes.GetBookingsPayload } = req
    const page = Number.parseInt(req.params.page, 10)
    const size = Number.parseInt(req.params.size, 10)
    let suppliers = body.suppliers.map((id) => new mongoose.Types.ObjectId(id))
    let keyword = (body.filter && body.filter.keyword) || ''

    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    if (!sessionUser) {
      logger.error(`[booking.getTrashedBookings] Unauthorized attempt to get trashed bookings by user ${sessionUserId}`)
      res.status(403).send('Forbidden: You cannot get booking information')
      return
    }
    if ([bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)) {
      const supplierId = agencySupplierId(req)
      if (!supplierId) {
        res.status(403).send('Agency membership is required')
        return
      }
      suppliers = [new mongoose.Types.ObjectId(supplierId)]
    }

    const filter: mongoose.QueryFilter<env.Booking> = {
      supplier: { $in: suppliers },
      expireAt: null,
      deletedAt: { $ne: null },
    }
    if (keyword) {
      const isObjectId = helper.isValidObjectId(keyword)
      if (isObjectId) {
        filter._id = new mongoose.Types.ObjectId(keyword)
      } else {
        keyword = escapeStringRegexp(keyword)
        const rx = new RegExp(keyword, 'i')
        const [drivers, cars] = await Promise.all([
          User.find({ fullName: rx }).select('_id').lean(),
          Car.find({ name: rx }).select('_id').lean(),
        ])
        filter.$or = [
          { reference: rx },
          { driver: { $in: drivers.map((d) => d._id) } },
          { car: { $in: cars.map((c) => c._id) } },
        ]
      }
    }

    const totalRecords = await Booking.countDocuments(filter)
    const rows = await Booking.find(filter)
      .populate<{ supplier: env.UserInfo }>('supplier', '_id fullName avatar')
      .populate<{ car: env.CarInfo }>('car', '_id name')
      .populate<{ driver: env.UserInfo }>('driver', '_id fullName avatar')
      .populate<{ deletedBy: env.UserInfo }>('deletedBy', '_id fullName')
      .sort({ deletedAt: -1, _id: 1 })
      .skip((page - 1) * size)
      .limit(size)
      .lean()

    const resultData = rows.map((row) => {
      const r = row as unknown as Record<string, unknown>
      // Lists never carry the history (§3) — but the trash view's
      // money-warning flags come from its LAST row, flattened here so
      // the table can show them without the history itself.
      const history = (r.trashHistory as Array<{ hadPayments?: boolean, hadInvoices?: boolean }> | undefined) || []
      const last = history[history.length - 1]
      r.hadPayments = last?.hadPayments ?? false
      r.hadInvoices = last?.hadInvoices ?? false
      delete r.trashHistory
      delete r.signingNonce
      if (r.onlineSignature) {
        r.onlineSignature = publicOnlineSignature(r.onlineSignature as { signedAt?: Date })
      }
      const deletedBy = r.deletedBy as { _id?: unknown, fullName?: string } | null | undefined
      r.deletedByName = deletedBy?.fullName || ''
      r.deletedBy = deletedBy?._id || null
      return r
    })

    res.json([{ resultData, pageInfo: [{ totalRecords }] }])
  } catch (err) {
    logger.error(`[booking.getTrashedBookings] ${i18n.t('ERROR')} ${JSON.stringify(req.body)}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

/**
 * GA-PAR-22 — Booking trash-warning figures (§5.7).
 *
 * Live counts behind the trash confirm dialog, from the same sources
 * the Payments/Invoices pages use: posted payments + MAD collected,
 * invoices (issued count among them), pending charges. The warning
 * flags are also stored on the trashHistory row at trash time (§2.5).
 *
 * @export
 * @async
 * @param {Request} req
 * @param {Response} res
 * @returns {unknown}
 */
export const getBookingTrashWarning = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)
    const booking = await Booking.findById(id).select('_id supplier deletedAt').lean()
    if (!booking) {
      res.sendStatus(204)
      return
    }
    const isAgencyUser = !!sessionUser && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
    if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User
      || (isAgencyUser && agencySupplierId(req) !== booking.supplier?.toString())) {
      logger.error(`[booking.getBookingTrashWarning] Forbidden access to booking ${id} by user ${sessionUserId}`)
      res.status(403).send('Forbidden: Access denied')
      return
    }

    const [payments, invoices, charges] = await Promise.all([
      RentalPayment.find({ booking: booking._id, status: bookcarsTypes.RentalPaymentStatus.Posted }).select('amount direction').lean(),
      Invoice.find({ booking: booking._id, status: { $ne: bookcarsTypes.InvoiceStatus.Voided } }).select('status').lean(),
      ContractCharge.find({ booking: booking._id, status: bookcarsTypes.ApprovalDecision.Pending }).select('_id').lean(),
    ])
    const collected = payments.reduce((sum, p) => sum + (p.direction === bookcarsTypes.RentalPaymentDirection.Debit ? -Number(p.amount || 0) : Number(p.amount || 0)), 0)
    const warning: bookcarsTypes.TrashWarning = {
      paymentsCount: payments.length,
      paymentsCollected: Number(collected.toFixed(2)),
      invoicesCount: invoices.length,
      invoicesIssuedCount: invoices.filter((i) => i.status === bookcarsTypes.InvoiceStatus.Issued).length,
      pendingChargesCount: charges.length,
    }
    res.json(warning)
  } catch (err) {
    logger.error(`[booking.getBookingTrashWarning] ${i18n.t('ERROR')} ${id}`, err)
    res.status(400).send(i18n.t('ERROR'))
  }
}
