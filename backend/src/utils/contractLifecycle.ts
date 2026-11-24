import * as bookcarsTypes from ':bookcars-types'

/**
 * F3 / W1 #11 — handover has a payment-confirmation gate. A `Draft`
 * booking with status `Pending` (an unpaid pay-later booking) can no
 * longer be handed over: the operator must first confirm the payment
 * (staff manual confirmation, W1 #3 — cash collected at the counter →
 * `Paid`) or the booking must already carry a payment status
 * (`Deposit`/`Paid`/`PaidInFull`). The escape is
 * `paymentConfirmed`: a Pending booking whose receivable shows nothing
 * outstanding (e.g. a zero-total booking) may still be handed over.
 * The controller computes that from the ledger and passes it in; the
 * default (`false`) keeps the gate closed for every other caller.
 *
 * Wave 2.5 — `Reserved` no longer passes this gate: it was a
 * staff-assignable status that both reserved the car and unlocked
 * handover with no payment behind it. A legacy Reserved booking
 * must be confirmed (POST /api/bookings/:id/confirm-reservation,
 * which moves it to Pending + Confirmed) or paid before handover.
 *
 * Wave 2 remainder — 2.2 (M5/C2): the status list is gone. A
 * `Deposit`/`Paid`/`PaidInFull` status used to pass this gate with
 * no balance check at all, so a deposit-paid booking with rent
 * unpaid still took the car. Handover now requires
 * `paymentConfirmed` for EVERY status: the controller computes it
 * from the ledger (nothing outstanding, or the Q14 exception —
 * rent-only balance, deposit collected, no future confirmed
 * booking for the car). The `status` parameter is kept so existing
 * callers need no change; it no longer opens the gate — it only
 * ever closes it, for the terminal statuses (Cancelled/Void, which
 * the controller wall already rejects before reaching here).
 *
 * F4 / W1 #5 — the gate applies to `Confirmed` exactly as to `Draft`.
 * F3 left the Confirmed branch ungated because no producer assigned
 * `Confirmed` yet; F4 adds the producer (provider finalisation and
 * manual payment confirmation, both paid-only), so a `Confirmed`
 * booking that is still `Pending` hands over only when nothing is
 * outstanding (`paymentConfirmed`).
 */
export const inspectionTransition = (
  lifecycle: bookcarsTypes.ContractLifecycle | undefined,
  type: bookcarsTypes.InspectionType,
  status?: bookcarsTypes.BookingStatus,
  paymentConfirmed = false,
): bookcarsTypes.ContractLifecycle | null => {
  const current = lifecycle || bookcarsTypes.ContractLifecycle.Draft
  if (type === bookcarsTypes.InspectionType.Handover
    && (current === bookcarsTypes.ContractLifecycle.Draft || current === bookcarsTypes.ContractLifecycle.Confirmed)
    && status !== bookcarsTypes.BookingStatus.Cancelled
    && status !== bookcarsTypes.BookingStatus.Void
    && paymentConfirmed) {
    return bookcarsTypes.ContractLifecycle.Active
  }
  if (type === bookcarsTypes.InspectionType.Return && current === bookcarsTypes.ContractLifecycle.Active) {
    return bookcarsTypes.ContractLifecycle.ReturnReview
  }
  return null
}

/**
 * F4 / W1 #7 — late return, read-model derivation (roadmap §3: the
 * late path must be explicit; there is no late status write). A
 * booking is overdue when it is `Active` (handed over, no return
 * inspection yet — a return moves it to `ReturnReview`) and its
 * scheduled return `to` has passed. No fee is derived here: any
 * late charge is an ADR-001-gated staff decision, never an invented
 * amount. The overdue-bookings list endpoint filters on the same
 * rule in its Mongo query; this helper is the single definition
 * both the list and the single-booking read use.
 */
export const isBookingOverdue = (
  booking: { lifecycle?: bookcarsTypes.ContractLifecycle, to?: Date | string | null },
  now: Date = new Date(),
): boolean => {
  if (booking.lifecycle !== bookcarsTypes.ContractLifecycle.Active || !booking.to) {
    return false
  }
  const due = booking.to instanceof Date ? booking.to : new Date(booking.to)
  return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime()
}

const CHECKLIST_KEYS = ['spareWheelAndTools', 'radio', 'washed'] as const
const PHOTO_SLOTS: string[] = Object.values(bookcarsTypes.InspectionPhotoSlot)

/** F-08 — discriminated inspection validation: the caller can tell a
 * missing photo apart from any other invalid field. */
export type InspectionValidationResult =
  | { ok: true, value: { occurredAt: Date, odometer?: number, fuelLevel?: number, condition?: string, damageNote?: string, photoFiles: string[], checklist?: bookcarsTypes.InspectionChecklist, photos?: bookcarsTypes.InspectionPhoto[], signatureFile?: string } }
  | { ok: false, reason: 'INVALID' | 'PHOTO_REQUIRED' }

export const validateInspectionFields = (input: {
  occurredAt?: Date | string
  odometer?: unknown
  fuelLevel?: unknown
  condition?: unknown
  damageNote?: unknown
  photoFiles?: unknown
  checklist?: unknown
  photos?: unknown
  signatureFile?: unknown
}, type?: bookcarsTypes.InspectionType): InspectionValidationResult => {
  // GA-PAR-06: structured checklist (booleans only, known keys only) and
  // guided photo slots (slot enum + the existing filename safety rules).
  // Both are optional: legacy payloads without them remain valid.
  let checklist: bookcarsTypes.InspectionChecklist | undefined
  if (input.checklist !== undefined && input.checklist !== null) {
    if (typeof input.checklist !== 'object' || Array.isArray(input.checklist)) {
      return { ok: false, reason: 'INVALID' }
    }
    checklist = {}
    for (const [key, value] of Object.entries(input.checklist as Record<string, unknown>)) {
      if (!(CHECKLIST_KEYS as readonly string[]).includes(key) || typeof value !== 'boolean') {
        return { ok: false, reason: 'INVALID' }
      }
      ;(checklist as Record<string, boolean>)[key] = value
    }
  }
  let photos: bookcarsTypes.InspectionPhoto[] | undefined
  if (input.photos !== undefined && input.photos !== null) {
    if (!Array.isArray(input.photos)) {
      return { ok: false, reason: 'INVALID' }
    }
    photos = []
    for (const entry of input.photos as unknown[]) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, reason: 'INVALID' }
      }
      const slot = String((entry as { slot?: unknown }).slot || '')
      const file = String((entry as { file?: unknown }).file || '').trim()
      if (!PHOTO_SLOTS.includes(slot) || file.length === 0 || file.length > 200 || !/^[A-Za-z0-9._-]+$/.test(file)) {
        return { ok: false, reason: 'INVALID' }
      }
      photos.push({ slot: slot as bookcarsTypes.InspectionPhotoSlot, file })
    }
  }
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date()
  const odometer = input.odometer === undefined || input.odometer === null ? undefined : Number(input.odometer)
  const fuelLevel = input.fuelLevel === undefined || input.fuelLevel === null ? undefined : Number(input.fuelLevel)
  const condition = String(input.condition || '').trim()
  const damageNote = String(input.damageNote || '').trim()
  const photoFiles = Array.isArray(input.photoFiles) ? input.photoFiles.map((file) => String(file).trim()) : []
  const safePhoto = photoFiles.every((file) => file.length <= 200 && /^[A-Za-z0-9._-]+$/.test(file))
  const signatureFile = input.signatureFile === undefined || input.signatureFile === null ? undefined : String(input.signatureFile).trim()
  const safeSignature = signatureFile === undefined || (signatureFile.length <= 200 && /^[A-Za-z0-9._-]+$/.test(signatureFile))
  if (Number.isNaN(occurredAt.getTime())
    || (odometer !== undefined && (!Number.isFinite(odometer) || odometer < 0))
    || (fuelLevel !== undefined && (!Number.isFinite(fuelLevel) || fuelLevel < 0 || fuelLevel > 100))
    || condition.length > 4000 || damageNote.length > 4000 || !safePhoto || !safeSignature) {
return { ok: false, reason: 'INVALID' }
}
  // GA5: a handover is the departure record - it is meaningless
  // without the readings (the mobile test handed over blank). Only the
  // handover leg is gated; the return leg keeps its existing shape.
  if (type === bookcarsTypes.InspectionType.Handover && (odometer === undefined || fuelLevel === undefined)) {
    return { ok: false, reason: 'INVALID' }
  }
  // Next pass - the return leg is the arrival record: the odometer is
  // required there too (it keeps the maintenance chain true and is the
  // basis of the extra-km settlement), and BOTH legs are proof: at least
  // one photo each (a slotted photo counts - the controller merges slots
  // into photoFiles, so the count here is the union of both lists).
  if (type === bookcarsTypes.InspectionType.Return && odometer === undefined) {
    return { ok: false, reason: 'INVALID' }
  }
  if ((type === bookcarsTypes.InspectionType.Handover || type === bookcarsTypes.InspectionType.Return)
    && photoFiles.length === 0 && (photos || []).length === 0) {
    return { ok: false, reason: 'PHOTO_REQUIRED' }
  }
  return { ok: true, value: { occurredAt, odometer, fuelLevel, condition: condition || undefined, damageNote: damageNote || undefined, photoFiles, checklist, photos, signatureFile } }
}


