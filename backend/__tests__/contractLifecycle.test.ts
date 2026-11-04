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

  test('validates odometer, fuel and private photo names', () => {
    expect(validateInspectionFields({ odometer: 100, fuelLevel: 50, photoFiles: ['handover-front.jpg'] })).not.toBeNull()
    expect(validateInspectionFields({ odometer: -1 })).toBeNull()
    expect(validateInspectionFields({ fuelLevel: 101 })).toBeNull()
    expect(validateInspectionFields({ photoFiles: ['../private.jpg'] })).toBeNull()
    expect(validateInspectionFields({ occurredAt: 'not-a-date' })).toBeNull()
  })
})