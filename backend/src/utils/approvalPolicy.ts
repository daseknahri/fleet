/**
 * Gestion Auto approvals policy - owner-approved defaults.
 *
 * Decision Pack GA-P10-DECISIONS-01 section 1 (2026-11-05) and the
 * owner approval of these defaults on 2026-11-17 ("go with the default,
 * we will adjust when we apply it to the real business"):
 *
 * 1. Trigger - any refund, discount / price override, or manual charge
 *    above the threshold. In this codebase that is: an invoice issued,
 *    a contract charge created (a manual charge), a manual rental
 *    payment debit (a refund), and a price reduction on a snapshot-less
 *    booking (a discount / price override). A contract amendment
 *    re-prices from the snapshot basis and is NOT a discretionary
 *    discount, so it is not a trigger.
 * 2. Threshold - 10,000 MAD. Approval is required at or above it.
 *    Amounts are compared in the record's own currency; the deployment
 *    currency is MAD.
 * 3. Approver - the agency manager / owner, never the requester. That
 *    is the DecideInvoices permission: Owner holds every permission
 *    and Manager holds DecideInvoices; Accountant and CounterAgent do
 *    not. The routes enforce it; the decide endpoints also refuse the
 *    requester (4).
 * 4. Self-approval - never allowed, on any decide path (the approvals
 *    queue decide endpoint and the contract-charge decide endpoint).
 * 5. Effect - BLOCKING. The item waits in the queue until approved:
 *    an invoice cannot take payments while its request is pending or
 *    rejected, a manual refund stays a pending ledger entry until its
 *    request is approved, and a price reduction cannot be saved until
 *    its request is approved. A rejected request stops the item.
 */
export const APPROVAL_THRESHOLD_MAD = 10000
export const APPROVAL_CURRENCY = 'MAD'

/** Subject types the approvals queue accepts. */
export const APPROVAL_SUBJECT_TYPES = ['invoice', 'contract-charge', 'rental-payment', 'booking'] as const
export type ApprovalSubjectType = (typeof APPROVAL_SUBJECT_TYPES)[number]

/** The policy trigger each queue subject type stands for. */
export const APPROVAL_SUBJECT_TRIGGERS: Record<ApprovalSubjectType, string> = {
  invoice: 'invoice',
  'contract-charge': 'manual-charge',
  'rental-payment': 'refund',
  booking: 'price-override',
}

/** True when an amount needs approval: at or above 10,000 MAD. */
export const approvalRequiredFor = (amount: number) => (
  Number.isFinite(amount) && amount >= APPROVAL_THRESHOLD_MAD
)

/** True when the decider is the same person who requested approval. */
export const isSelfApproval = (requestedBy: unknown, deciderId: unknown) => (
  !!requestedBy && !!deciderId && String(requestedBy) === String(deciderId)
)
