import * as bookcarsTypes from ':bookcars-types'
import { inspectionTransition, isBookingOverdue, validateInspectionFields } from '../src/utils/contractLifecycle'

describe('contract lifecycle operations', () => {
  test('allows handover from draft and confirmed only', () => {
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Reserved)).toBeNull()
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Cancelled)).toBeNull()
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Active, bookcarsTypes.InspectionType.Handover)).toBeNull()
  })

  test('allows return only from active', () => {
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Active, bookcarsTypes.InspectionType.Return)).toBe(bookcarsTypes.ContractLifecycle.ReturnReview)
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Return)).toBeNull()
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.ReturnReview, bookcarsTypes.InspectionType.Return)).toBeNull()
  })

  // F3 / W1 #11 — handover payment gate: a Draft booking that is still
  // Pending (unpaid pay-later) cannot be handed over until the payment
  // is confirmed. Deposit/Paid/PaidInFull still hand over, and
  // a Pending booking with nothing outstanding (paymentConfirmed) does
  // too (e.g. a zero-total booking). Wave 2.5 — Reserved no longer
  // hands over: a legacy Reserved row must be confirmed (or cancelled)
  // first.
  test('blocks handover on unpaid pay-later bookings (Draft + Pending)', () => {
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending)).toBeNull()
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Draft, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending)).toBeNull()
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Deposit)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Paid)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.PaidInFull)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Reserved)).toBeNull()
  })

  // F4 / W1 #5 — the Confirmed lifecycle now has a producer (provider
  // finalisation + manual payment confirmation, both paid-only), so the
  // handover payment gate applies to Confirmed exactly as to Draft.
  test('blocks handover on unpaid pay-later bookings (Confirmed + Pending)', () => {
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending)).toBeNull()
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Paid)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Deposit)).toBe(bookcarsTypes.ContractLifecycle.Active)
  })

  test('validates odometer, fuel and private photo names', () => {
    expect(validateInspectionFields({ odometer: 100, fuelLevel: 50, photoFiles: ['handover-front.jpg'] })).not.toBeNull()
    expect(validateInspectionFields({ odometer: -1 })).toBeNull()
    expect(validateInspectionFields({ fuelLevel: 101 })).toBeNull()
    expect(validateInspectionFields({ photoFiles: ['../private.jpg'] })).toBeNull()
    expect(validateInspectionFields({ occurredAt: 'not-a-date' })).toBeNull()
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
