# Agency authorization matrix

**Status:** Membership foundation and partial operational capability enforcement implemented. Core agency routes use explicit role permissions and staff scope; supplier/settings/bank/report/background paths and runtime route checks remain open; notification routes are self-scoped. Invitations are not implemented; zero or multiple active staff memberships are rejected; multi-agency switching is unresolved.
**Date:** 2026-10-29
**Scope:** Agency back office, customer records, contracts, fleet, money, documents and reports.

## Current authorization model

The shared BookCars `UserType` now includes `admin`, `supplier`, `user` and `staff`. Staff roles are resolved from an `AgencyMembership` record rather than stored as tenant-wide user privileges:

- `admin` is a platform-level role and several controllers permit it to access records across suppliers.
- `supplier` is the agency owner account.
- `staff` requires exactly one active agency membership; its role and supplier scope are derived from that membership. Accounts with zero or multiple active memberships are rejected by token verification.
- `user` is a customer and is denied from supplier-only routes.

Treat the platform admin as a separate support/security principal, not as an agency employee. Customer identity data and all agency-owned records still require object-level scope checks even when the caller is authenticated.

## Proposed agency roles and permissions

Legend: **Manage** = create/update operational records; **Approve** = confirm/reverse/close an irreversible or financial action; **Read** = view within the role's need; **Own** = agency owner-only settings; **—** = no access. Every permission is additionally restricted to the authenticated user's agency scope.

| Capability | Owner | Manager | Counter agent | Accountant | Mechanic | Read-only |
|---|---|---|---|---|---|---|
| Agency profile, tax, currency and integrations | Own | Read | — | Read | — | — |
| Invite staff, roles and account access | Own | — | — | — | — | — |
| Client contact/profile | Manage | Manage | Manage | Read | — | Read |
| Identity documents and private files | Manage | Read | Read | — | — | — |
| Fleet details and pricing | Manage | Manage | Read | Read | Read | Read |
| Contracts, schedule and customer handover | Manage | Manage | Manage | Read | Read | Read |
| Contract amendments/cancellation/closeout | Approve | Manage | Manage with review | Read | — | Read |
| Payment entry and booking balance | Approve | Read | Record pending | Manage | — | Read |
| Refund, reversal and payment confirmation | Approve | Request | — | Request/record with evidence | — | — |
| Cash drawer, bank movement and close | Approve | Read | Record pending | Manage | — | — |
| Maintenance work orders and vehicle downtime | Manage | Manage | Read | Read | Manage | Read |
| Expenses and receipts | Approve | Manage | Submit | Manage | Submit | — |
| Financial reports and exports | Read | Read | — | Manage | — | Read with redaction |
| Audit trail and security events | Own | Read | — | Read money events | Read assigned work | — |

The matrix is now encoded for the implemented coarse capabilities in `backend/src/utils/agencyAuthorization.ts`. Financial approval, pending-entry, identity-document redaction and separation-of-duties details remain product decisions before ledger and approval workflows are finalized.

## Required enforcement model

1. Store an explicit agency membership and role for staff; do not encode all agency employees as the `supplier` account. The current implementation keeps `UserType.Staff` separate and uses `AgencyMembership` for tenant role scope.
2. Derive `supplierId` from the authenticated membership. Ignore or reject client-supplied tenant IDs for non-platform principals.
3. Scope every read, update, delete, aggregate, file lookup, export, notification and background task by agency. Verify every linked booking, car, client, location, expense, payment and document belongs to the same agency.
4. Use explicit action permissions in backend middleware/service methods. `requireAgencyPermission` now covers booking, fleet, location, client, private-document, expense and payment route groups; UI visibility is convenience only.
5. Log actor, agency, action, target, timestamp, reason and before/after references for privileged and financial transitions. Avoid copying identity document content into audit events.
6. Keep platform-admin support access separate, least-privileged, attributable and reviewable. Do not use platform-admin bypasses for ordinary agency workflows.
7. Test horizontal isolation using at least two synthetic agencies and each role before pilot. Do not use real reference-account records.

## Open product decisions

- Can one person belong to multiple agencies, and can one agency assign multiple roles to the same person?
- Which actions require a second approver, and can an owner approve their own action?
- Are counter-agent payment entries pending until an accountant confirms them?
- Which client fields/documents can counter staff view, and what must be masked in lists, search, exports and notifications?
- Can mechanics view client/contract identity, or only vehicle schedule and service work order?
- Should a read-only role export data? Which fields must be redacted?
- What support-access notice, duration and audit review are required for platform administrators?

The implemented coarse boundaries are limited to the accepted current slice. Invitations, multi-agency switching, supplier profile/settings, bank details, global settings, notifications, reports/exports, audit events and background tasks still require migration or owner decisions. Release remains **Not ready**.

