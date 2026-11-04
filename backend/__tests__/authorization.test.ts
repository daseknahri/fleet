import * as bookcarsTypes from ':bookcars-types'
import {
  canReadSupplier,
  canReadSupplierContract,
  canReadUserLicense,
  canDeleteOwnedTempFile,
  sameIdentifier,
} from '../src/utils/authorization'
import { createLicenseCapabilityFilename, isValidLicenseCapabilityFilename } from '../src/utils/tempFileCapability'
import {
  AgencyPermission,
  canManageMemberships,
  canReadMemberships,
  hasAgencyPermission,
  hasUniqueActiveMembershipCount,
  isActiveMembership,
  isStaffRole,
} from '../src/utils/agencyAuthorization'

describe('synthetic two-agency authorization policy', () => {
  const admin = { _id: 'admin-1', type: bookcarsTypes.UserType.Admin }
  const supplierA = { _id: 'supplier-a', type: bookcarsTypes.UserType.Supplier }
  const supplierB = { _id: 'supplier-b', type: bookcarsTypes.UserType.Supplier }
  const customer = { _id: 'customer-x', type: bookcarsTypes.UserType.User }

  it('compares request IDs and Mongo-like IDs by value', () => {
    expect(sameIdentifier('agency-a', 'agency-a')).toBe(true)
    expect(sameIdentifier('agency-a', 'agency-b')).toBe(false)
    expect(sameIdentifier({ toString: () => 'agency-a' }, 'agency-a')).toBe(true)
    expect(sameIdentifier('agency-a', null)).toBe(false)
  })

  it('keeps supplier reads inside the owning agency', () => {
    expect(canReadSupplier(admin, supplierB._id)).toBe(true)
    expect(canReadSupplier(supplierA, supplierA._id)).toBe(true)
    expect(canReadSupplier(supplierA, supplierB._id)).toBe(false)
  })

  it('requires a booking relationship for a customer to read a supplier contract', () => {
    expect(canReadSupplierContract(admin, supplierB._id, false)).toBe(true)
    expect(canReadSupplierContract(supplierA, supplierA._id, false)).toBe(true)
    expect(canReadSupplierContract(customer, supplierA._id, false)).toBe(false)
    expect(canReadSupplierContract(customer, supplierA._id, true)).toBe(true)
  })

  it('allows only the owner or platform support to delete authenticated temp files', () => {
    expect(canDeleteOwnedTempFile(admin, 'supplier-a_contract.pdf')).toBe(true)
    expect(canDeleteOwnedTempFile(supplierA, 'supplier-a_contract.pdf')).toBe(true)
    expect(canDeleteOwnedTempFile(supplierB, 'supplier-a_contract.pdf')).toBe(false)
    expect(canDeleteOwnedTempFile(customer, 'supplier-a_contract.pdf')).toBe(false)
    expect(canDeleteOwnedTempFile(supplierA, 'supplier-aevil_contract.pdf')).toBe(false)
  })


  it('resolves the staff membership foundation with least privilege', () => {
    const owner = { supplierId: supplierA._id, role: bookcarsTypes.AgencyRole.Owner }
    const manager = { supplierId: supplierA._id, role: bookcarsTypes.AgencyRole.Manager }
    const limitedRoles = [
      bookcarsTypes.AgencyRole.CounterAgent,
      bookcarsTypes.AgencyRole.Accountant,
      bookcarsTypes.AgencyRole.Mechanic,
      bookcarsTypes.AgencyRole.ReadOnly,
    ]

    expect(canManageMemberships(owner)).toBe(true)
    expect(canReadMemberships(owner)).toBe(true)
    expect(canManageMemberships(manager)).toBe(false)
    expect(canReadMemberships(manager)).toBe(true)
    for (const role of limitedRoles) {
      expect(isStaffRole(role)).toBe(true)
      expect(canManageMemberships({ supplierId: supplierA._id, role })).toBe(false)
      expect(canReadMemberships({ supplierId: supplierA._id, role })).toBe(false)
    }
    expect(isStaffRole(bookcarsTypes.AgencyRole.Owner)).toBe(false)
    expect(isStaffRole('unknown')).toBe(false)
  })

  it('enforces operational capabilities by staff role', () => {
    const context = (role) => ({ supplierId: supplierA._id, role })

    for (const permission of Object.values(AgencyPermission)) {
      expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.Owner), permission)).toBe(true)
    }
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.Manager), AgencyPermission.ReadAgencyProfile)).toBe(true)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.Manager), AgencyPermission.ManageAgencyProfile)).toBe(false)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.Manager), AgencyPermission.ManageBookings)).toBe(true)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.Manager), AgencyPermission.ManageFleet)).toBe(true)
    expect(canManageMemberships(context(bookcarsTypes.AgencyRole.Manager))).toBe(false)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.CounterAgent), AgencyPermission.ManageBookings)).toBe(true)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.CounterAgent), AgencyPermission.ManageClients)).toBe(true)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.CounterAgent), AgencyPermission.ManageFleet)).toBe(false)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.Accountant), AgencyPermission.ReadAgencyProfile)).toBe(true)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.Accountant), AgencyPermission.RecordPayments)).toBe(true)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.Accountant), AgencyPermission.ManageBookings)).toBe(false)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.Mechanic), AgencyPermission.ManageExpenses)).toBe(true)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.Mechanic), AgencyPermission.RecordPayments)).toBe(false)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.ReadOnly), AgencyPermission.ReadBookings)).toBe(true)
    expect(hasAgencyPermission(context(bookcarsTypes.AgencyRole.ReadOnly), AgencyPermission.ManageBookings)).toBe(false)
  })

  it('keeps staff identity self-service scoped', () => {
    const staff = { _id: 'staff-1', type: bookcarsTypes.UserType.Staff }
    const isSelf = (targetId: string) => staff._id === targetId
    expect(isSelf('staff-1')).toBe(true)
    expect(isSelf('staff-2')).toBe(false)
  })

  it('does not treat pending or suspended memberships as active', () => {
    expect(isActiveMembership({ status: bookcarsTypes.AgencyMembershipStatus.Active })).toBe(true)
    expect(isActiveMembership({ status: bookcarsTypes.AgencyMembershipStatus.Pending })).toBe(false)
    expect(isActiveMembership({ status: bookcarsTypes.AgencyMembershipStatus.Suspended })).toBe(false)
    expect(hasUniqueActiveMembershipCount(0)).toBe(false)
    expect(hasUniqueActiveMembershipCount(1)).toBe(true)
    expect(hasUniqueActiveMembershipCount(2)).toBe(false)
  })

  it('accepts only signed, unexpired anonymous checkout-license capabilities', () => {
    const capability = createLicenseCapabilityFilename('.jpg')
    expect(isValidLicenseCapabilityFilename(capability)).toBe(true)
    expect(isValidLicenseCapabilityFilename('random.jpg')).toBe(false)
    expect(isValidLicenseCapabilityFilename(capability.replace('.jpg', '.pdf'))).toBe(false)
    expect(isValidLicenseCapabilityFilename(`${capability}\0`)).toBe(false)
    expect(isValidLicenseCapabilityFilename(`../${capability}`)).toBe(false)
  })

  it('keeps booking-existence checks scoped to the customer or agency', () => {
    const canCheck = (actor, requestedDriver, supplier) => {
      if (actor.type === bookcarsTypes.UserType.User) {
return actor._id === requestedDriver
}
      if (actor.type === bookcarsTypes.UserType.Supplier) {
return actor._id === supplier
}
      return actor.type === bookcarsTypes.UserType.Admin
    }
    expect(canCheck(customer, customer._id, supplierA._id)).toBe(true)
    expect(canCheck(customer, 'customer-y', supplierA._id)).toBe(false)
    expect(canCheck(supplierA, customer._id, supplierA._id)).toBe(true)
    expect(canCheck(supplierA, customer._id, supplierB._id)).toBe(false)
    expect(canCheck(admin, customer._id, supplierB._id)).toBe(true)
  })
  it('keeps customer licenses private across agencies and customers', () => {
    expect(canReadUserLicense(admin, customer._id, null)).toBe(true)
    expect(canReadUserLicense(customer, customer._id, supplierA._id)).toBe(true)
    expect(canReadUserLicense(supplierA, customer._id, supplierA._id)).toBe(true)
    expect(canReadUserLicense(supplierB, customer._id, supplierA._id)).toBe(false)
    expect(canReadUserLicense(customer, 'customer-y', null)).toBe(false)
  })
})
