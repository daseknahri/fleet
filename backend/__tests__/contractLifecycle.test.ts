import * as bookcarsTypes from ':bookcars-types'
import { inspectionTransition, validateInspectionFields } from '../src/utils/contractLifecycle'

describe('contract lifecycle operations', () => {
  test('allows handover from draft and confirmed only', () => {
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Confirmed, bookcarsTypes.InspectionType.Handover)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Reserved)).toBe(bookcarsTypes.ContractLifecycle.Active)
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
  // is confirmed. Deposit/Paid/PaidInFull/Reserved still hand over, and
  // a Pending booking with nothing outstanding (paymentConfirmed) does
  // too (e.g. a zero-total booking).
  test('blocks handover on unpaid pay-later bookings (Draft + Pending)', () => {
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending)).toBeNull()
    expect(inspectionTransition(bookcarsTypes.ContractLifecycle.Draft, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending)).toBeNull()
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Pending, true)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Deposit)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Paid)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.PaidInFull)).toBe(bookcarsTypes.ContractLifecycle.Active)
    expect(inspectionTransition(undefined, bookcarsTypes.InspectionType.Handover, bookcarsTypes.BookingStatus.Reserved)).toBe(bookcarsTypes.ContractLifecycle.Active)
  })

  test('validates odometer, fuel and private photo names', () => {
    expect(validateInspectionFields({ odometer: 100, fuelLevel: 50, photoFiles: ['handover-front.jpg'] })).not.toBeNull()
    expect(validateInspectionFields({ odometer: -1 })).toBeNull()
    expect(validateInspectionFields({ fuelLevel: 101 })).toBeNull()
    expect(validateInspectionFields({ photoFiles: ['../private.jpg'] })).toBeNull()
    expect(validateInspectionFields({ occurredAt: 'not-a-date' })).toBeNull()
  })
})