import * as bookcarsTypes from ':bookcars-types'

type Identifier = string | { toString: () => string }

export type AuthorizationActor = {
  _id: Identifier
  type?: bookcarsTypes.UserType
}

/** Normalize Mongo ObjectIds and request path IDs before comparing them. */
export const sameIdentifier = (left: Identifier | null | undefined, right: Identifier | null | undefined) => (
  !!left && !!right && left.toString() === right.toString()
)

/** Platform support can read across agencies; agency users stay tenant-bound. */
export const canReadSupplier = (actor: AuthorizationActor, supplierId: Identifier) => (
  actor.type === bookcarsTypes.UserType.Admin
  || (actor.type === bookcarsTypes.UserType.Supplier && sameIdentifier(actor._id, supplierId))
)

/** A customer may read a supplier contract only when a booking links both records. */
export const canReadSupplierContract = (
  actor: AuthorizationActor,
  supplierId: Identifier,
  hasBookingAtSupplier: boolean,
) => (
  canReadSupplier(actor, supplierId)
  || (actor.type === bookcarsTypes.UserType.User && hasBookingAtSupplier)
)

/** A license is visible to its owner, the owning agency, or platform support. */
export const canReadUserLicense = (
  actor: AuthorizationActor,
  userId: Identifier,
  owningSupplierId: Identifier | null | undefined,
) => (
  actor.type === bookcarsTypes.UserType.Admin
  || (actor.type === bookcarsTypes.UserType.User && sameIdentifier(actor._id, userId))
  || (actor.type === bookcarsTypes.UserType.Supplier && sameIdentifier(actor._id, owningSupplierId))
)

/** Temporary files created by authenticated users carry an owner prefix. */
export const canDeleteOwnedTempFile = (
  actor: AuthorizationActor,
  filename: string,
) => (
  !!actor.type
  && (actor.type === bookcarsTypes.UserType.Admin
    || `${actor._id.toString()}_` === filename.slice(0, actor._id.toString().length + 1))
)
