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
import { BookingConflictError, saveBookingWithAvailability, saveBookingsWithAvailability } from '../utils/bookingReservationHelper'
import { postProviderPayment } from '../utils/ledger'
import stripeAPI from '../payment/stripe'
import { toMinorUnits } from '../utils/paymentAmount'
import { agencySupplierId, getAgencyContext } from '../utils/agencyAuthorization'
import { nextBookingReference } from '../utils/bookingReference'
import { publicOnlineSignature } from '../utils/bookingSigning'
import { ensureDraftInvoice } from '../utils/invoiceCreation'
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

    const vehicle = await Car.findOne({ _id: carId, supplier: supplierId }).select('_id locations').lean()
    const locationIds = (vehicle?.locations || []).map((locationId: mongoose.Types.ObjectId | string) => locationId.toString())
    if (!vehicle || !locationIds.includes(pickupLocationId) || !locationIds.includes(dropOffLocationId)) {
      res.status(400).send('Vehicle and locations must belong to the booking agency')
      return
    }

    const driver = await User.findOne({ _id: driverId, type: bookcarsTypes.UserType.User }).select('_id clientStatus blacklisted')
    if (!driver) {
      res.status(400).send('Booking customer not found')
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
  const locale = language === 'fr' ? 'fr-FR' : 'en-US'
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

  const pickupLocationName = pickupLocation.values.filter((value) => value.language === language)[0].value
  const dropOffLocation = await Location.findById(booking.dropOffLocation).populate<{ values: env.LocationValue[] }>('values')
  if (!dropOffLocation) {
    logger.info(`Drop-off location ${booking.pickupLocation} not found`)
    return false
  }
  const dropOffLocationName = dropOffLocation.values.filter((value) => value.language === language)[0].value

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

  const session = await mongoose.startSession()
  let saved = false
  try {
    await session.withTransaction(async () => {
      if (provider === 'stripe') booking.paymentIntentId = reference
      else booking.paypalOrderId = reference
      booking.expireAt = undefined
      booking.status = snapshot.mode === bookcarsTypes.CheckoutPaymentMode.Deposit
        ? bookcarsTypes.BookingStatus.Deposit
        : snapshot.mode === bookcarsTypes.CheckoutPaymentMode.Full
          ? bookcarsTypes.BookingStatus.PaidInFull
          : bookcarsTypes.BookingStatus.Paid

      saved = await saveBookingWithAvailability(booking, {
        expectedStatus: bookcarsTypes.BookingStatus.Void,
        requireExpireAt: true,
        session,
      })
      if (!saved) return

      if (snapshot.amountDueNow > 0) {
        await postProviderPayment({
          bookingId: booking._id.toString(),
          date: new Date(),
          amount: snapshot.amountDueNow,
          currency: snapshot.baseCurrency,
          provider,
          providerReference: reference,
          actorId: booking.driver?.toString(),
          note: `Verified ${provider} checkout payment`,
          idempotencyKey: `${provider}-checkout-${reference}`,
          session,
        })
      }
    })
  } finally {
    await session.endSession()
  }

  if (!saved) return false

  // GA-PAR-05: the booking is finalised (expireAt cleared inside the
  // transaction) — auto-draft its invoice. Idempotent and never throws,
  // so a replayed finalisation still yields exactly one draft.
  await ensureDraftInvoice(booking)

  const car = await Car.findById(booking.car)
  if (!car) {
    throw new Error(`Car ${booking.car} not found`)
  }
  car.trips += 1
  await car.save()

  const supplier = await User.findById(booking.supplier)
  if (!supplier) {
    throw new Error(`Agency ${booking.supplier} not found`)
  }
  const user = await User.findById(booking.driver)
  if (!user) {
    throw new Error(`Driver ${booking.driver} not found`)
  }
  user.expireAt = undefined
  await user.save()

  if (!(await confirm(user, supplier, booking, false))) {
    throw new Error('Booking confirmation could not be sent')
  }

  i18n.locale = supplier.language
  let message = i18n.t('BOOKING_PAID_NOTIFICATION')
  await notify(user, booking._id.toString(), supplier, message)

  const admin = !!env.ADMIN_EMAIL && (await User.findOne({ email: env.ADMIN_EMAIL, type: bookcarsTypes.UserType.Admin }))
  if (admin) {
    i18n.locale = admin.language
    message = i18n.t('BOOKING_PAID_NOTIFICATION')
    await notify(user, booking._id.toString(), admin, message)
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
      res.status(409).send('Booking is not awaiting payment')
      return
    }

    if (booking.expireAt <= new Date()) {
      const expiredPaymentIntent = await stripeAPI.paymentIntents.retrieve(paymentIntentId)
      if (expiredPaymentIntent.status === 'succeeded'
        && expiredPaymentIntent.metadata.bookingId === booking._id.toString()
        && booking.paymentIntentId === expiredPaymentIntent.id) {
        verifiedPaymentIntentId = expiredPaymentIntent.id
        await stripeAPI.refunds.create(
          { payment_intent: expiredPaymentIntent.id },
          { idempotencyKey: `expired-booking-${expiredPaymentIntent.id}` },
        )
        res.status(410).send('Booking expired; the payment was refunded')
        return
      }
      res.status(409).send('Booking is not awaiting payment')
      return
    }

    const snapshot = booking.financialSnapshot
    if (!snapshot || booking.paymentIntentId !== paymentIntentId) {
      res.status(409).send('Payment intent is not linked to this booking')
      return
    }

    const paymentIntent = await stripeAPI.paymentIntents.retrieve(paymentIntentId)
    if (paymentIntent.status !== 'succeeded'
      || paymentIntent.metadata.bookingId !== booking._id.toString()
      || paymentIntent.currency.toUpperCase() !== snapshot.paymentCurrency.toUpperCase()
      || paymentIntent.amount_received !== toMinorUnits(snapshot.amountDueNowInPaymentCurrency, snapshot.paymentCurrency)) {
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

    const carObj = await Car.findById(body.booking.car).populate('dateBasedPrices').lean()
    if (!carObj) {
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
    const amountDueNowInPaymentCurrency = amountDueNow === 0 || paymentCurrency === env.BASE_CURRENCY.toUpperCase()
      ? amountDueNow
      : await bookcarsHelper.convertPrice(amountDueNow, env.BASE_CURRENCY.toUpperCase(), paymentCurrency)
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
    }

    const { language } = user
    i18n.locale = language

    let additionalDriverId: string | undefined
    if (body.booking.additionalDriver && body.additionalDriver) {
      const additionalDriver = new AdditionalDriver(body.additionalDriver)
      await additionalDriver.save()
      additionalDriverId = additionalDriver._id.toString()
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

      // Send confirmation email to customer
      if (!(await confirm(user, supplier, booking, true))) {
        res.sendStatus(400)
        return
      }

      // Notify supplier
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

      const vehicle = await Car.findOne({ _id: submittedCarId, supplier: booking.supplier }).select('_id locations').lean()
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
    const { body }: { body: string[] } = req
    const ids = body.map((id) => new mongoose.Types.ObjectId(id))

    const sessionUserId = req.user?._id
    const sessionUser = await User.findById(sessionUserId)

    let unauthorizedAttemptLogged = false
    for (const id of ids) {
      const booking = await Booking.findById(id)

      if (booking) {
        // begin of security check
        const sessionAgencyId = agencySupplierId(req)
        const isAgencyUser = !!sessionUser && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
        if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User || (isAgencyUser && sessionAgencyId !== booking.supplier?.toString())) {
          logger.error(`[booking.deleteBookings] Unauthorized attempt to delete booking ${booking._id.toString()} by user ${sessionUserId}`)
          unauthorizedAttemptLogged = true
          continue
        }
        // end of security check

        await booking.deleteOne()
        await AdditionalDriver.deleteOne({ _id: booking._additionalDriver })
      }
    }

    if (unauthorizedAttemptLogged) {
      res.status(403).send('Forbidden: You cannot delete some of the bookings')
      return
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
        select: '_id fullName avatar',
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

      booking.pickupLocation.name = booking.pickupLocation.values.filter((value) => value.language === language)[0].value
      booking.dropOffLocation.name = booking.dropOffLocation.values.filter((value) => value.language === language)[0].value

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
      $and: [{ 'supplier._id': { $in: suppliers } }, { status: { $in: statuses } }, { expireAt: null }],
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
    const filter: mongoose.QueryFilter<env.Booking> = { driver: new mongoose.Types.ObjectId(driver) }
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

      booking.cancelRequest = true
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


