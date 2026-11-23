import * as bookcarsTypes from ':bookcars-types'
import { inspectionTransition, isBookingOverdue, validateInspectionFields } from '../src/utils/contractLifecycle'

describe('contract lifecycle operations', () => {
  test('allows handover from draft and confirmed only', () => {
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, undefined, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover, undefined, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Cancelled, true)).toBeNull()
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Active, bookcarsTypes.InspectionType.Handover, undefined, true)).toBeNull()
  })

  test('allows return only from active', () => {
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Active, bookcarsTypes.InspectionType.Return)).toBe(bookcarsTypes.ContractLifecycle.ReturnReview)
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Return)).toBeNull()
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.ReturnReview, bookcarsTypes.InspectionType.Return)).toBeNull()
  })

  // F3 / W1 #11 — handover payment gate: a Draft booking that is still
  // Pending (unpaid pay-later) cannot be handed over until the payment
  // is confirmed. Wave 2 remainder — 2.2: the status no longer opens
  // the gate — Deposit/Paid/PaidInFull hand over ONLY with
  // paymentConfirmed (the controller computes it from the ledger:
  // nothing outstanding and the deposit collected, or the Q14
  // exception). A Pending booking with nothing outstanding
  // (paymentConfirmed) hands over (e.g. a zero-total booking). A
  // legacy Reserved booking hands over only when paid
  // (paymentConfirmed); otherwise it must be confirmed first (2.5).
  test('blocks handover on unpaid pay-later bookings (Draft + Pending)', () => {
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending)).toBeNull()
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Draft, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending)).toBeNull()
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Deposit)).toBeNull()
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Paid)).toBeNull()
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.PaidInFull)).toBeNull()
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Deposit, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Paid, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.PaidInFull, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Reserved)).toBeNull()
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Reserved, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
  })

  // F4 / W1 #5 — the Confirmed lifecycle now has a producer (provider
  // finalisation + manual payment confirmation, both paid-only), so the
  // handover payment gate applies to Confirmed exactly as to Draft.
  test('blocks handover on unpaid pay-later bookings (Confirmed + Pending)', () => {
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending)).toBeNull()
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Paid)).toBeNull()
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Paid, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Deposit)).toBeNull()
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Deposit, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
  })

  test('validates odometer, fuel and private photo names', () => {
    expect(validateInspectionFields({ odometer: 100, fuelLevel: 50, photoFiles: ['handover-front.jpg'] })).not.toBeNull()
    expect(validateInspectionFields({ odometer: -1 })).toBeNull()
    expect(validateInspectionFields({ fuelLevel: 101 })).toBeNull()
    expect(validateInspectionFields({ photoFiles: ['../private.jpg'] })).toBeNull()
    expect(validateInspectionFields({ occurredAt: 'not-a-date' })).toBeNull()
  })

  // GA5 - a handover is the departure record: it needs the readings.
  test('handover requires odometer and fuel readings; return keeps its shape', () => {
    expect(validateInspectionFields({}, bookcarsTypes.InspectionType.Handover)).toBeNull()
    expect(validateInspectionFields({ odometer: 100 }, bookcarsTypes.InspectionType.Handover)).toBeNull()
    expect(validateInspectionFields({ fuelLevel: 80 }, bookcarsTypes.InspectionType.Handover)).toBeNull()
    expect(validateInspectionFields({ odometer: 0, fuelLevel: 0 }, bookcarsTypes.InspectionType.Handover)).not.toBeNull()
    expect(validateInspectionFields({ odometer: 100, fuelLevel: 80 }, bookcarsTypes.InspectionType.Handover)).not.toBeNull()
    expect(validateInspectionFields({}, bookcarsTypes.InspectionType.Return)).not.toBeNull()
    expect(validateInspectionFields({})).not.toBeNull()
  })
})

describe('isBookingOverdue (F4 / W1 #7)', () => {
  const past = new Date(Date.now() - 3600000)
  const future = new Date(Date.now() + 3600000)

  test('flags an Active booking past its scheduled return', () => {
    expect(isBookingOverdue({ lifecycle: bookcarsTypes.ContractLifecycle.Active, to: past })).toBe(true)
  })

  test('does not flag an Active booking still within its rental', () => {
    expect(isBookingOverdue({ lifecycle: bookcarsTypes.ContractLifecycle.Active, to: future })).toBe(false)
  })

  test('does not flag a not-yet-handed-over booking past its return', () => {
    expect(isBookingOverdue({ lifecycle: bookcarsTypes.ContractLifecycle.Draft, to: past })).toBe(false)
    expect(isBookingOverdue({ lifecycle: bookcarsTypes.ContractLifecycle.Confirmed, to: past })).toBe(false)
  })

  test('does not flag a missing or invalid return date', () => {
    expect(isBookingOverdue({ lifecycle: bookcarsTypes.ContractLifecycle.Active })).toBe(false)
    expect(isBookingOverdue({ lifecycle: bookcarsTypes.ContractLifecycle.Active, to: null })).toBe(false)
    expect(isBookingOverdue({ lifecycle: bookcarsTypes.ContractLifecycle.Active, to: 'not-a-date' })).toBe(false)
  })
})
