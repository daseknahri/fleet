import * as bookcarsTypes from ':bookcars-types'
import { strings as csStrings } from '@/lang/cars'

// Fleet statuses (scorecard #15): display derivation for the car list.
//
// The server attaches `car.fleetStatus` (derived with the live-booking
// predicate) and that value always wins. The client-side fallback derives
// ONLY the operator statuses — it never claims `rented` from the client
// (a rented car without the server value simply shows no fleet badge).
// A legacy car with no stored status reads as in service. `unavailable`
// (in service, not rented, available=false) is NOT one of the four
// counted statuses and shows no fleet badge — the existing
// CAR_AVAILABLE / CAR_UNAVAILABLE line already covers it.

export const fleetStatusOfCar = (car: bookcarsTypes.Car): bookcarsTypes.CarFleetStatus | undefined => {
  if (car.fleetStatus) {
    return car.fleetStatus
  }
  if (car.operationalStatus === bookcarsTypes.CarOperationalStatus.Maintenance) {
    return 'maintenance'
  }
  if (car.operationalStatus === bookcarsTypes.CarOperationalStatus.Stopped) {
    return 'stopped'
  }
  return undefined
}

export const fleetStatusLabel = (status: bookcarsTypes.CarFleetStatus): string => {
  switch (status) {
    case 'maintenance':
      return csStrings.FLEET_STATUS_MAINTENANCE
    case 'stopped':
      return csStrings.FLEET_STATUS_STOPPED
    case 'rented':
      return csStrings.FLEET_STATUS_RENTED
    case 'available':
    default:
      return csStrings.AVAILABLE
  }
}

export const fleetStatusClass = (status: bookcarsTypes.CarFleetStatus): string => {
  switch (status) {
    case 'maintenance':
      return 'car-maintenance'
    case 'stopped':
      return 'car-unavailable'
    case 'rented':
      return 'car-rented'
    case 'available':
    default:
      return 'car-available'
  }
}
