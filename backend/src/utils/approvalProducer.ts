import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Approval from '../models/Approval'

/**
 * Approvals producer wiring (GA-P1-APPROVALS-PRODUCER-02).
 *
 * Owner decisions recorded in GA-P10-DECISIONS-01 (2026-11-05, decision
 * pack section 1, all defaults approved):
 * - 1.1 triggers: invoice issued + contract charge created.
 * - 1.2 threshold: a request is produced only at or above
 *   APPROVAL_THRESHOLD (10,000, the pack's adopted figure). Amounts are
 *   compared in the record's own currency; the deployment currency is MAD.
 * - 1.3 deciders: Owner + Manager (existing DecideInvoices permission).
 * - 1.4 single decider; the requester never decides their own request
 *   (enforced in the approvals decide endpoint).
 * - 1.5 blocking at/above the threshold (the domain flow checks the
 *   request state before it can complete).
 * - 1.6 the Approval queue record is the single source of truth.
 */

export const APPROVAL_THRESHOLD = 10000

export const approvalRequiredFor = (amount: number) => (
  Number.isFinite(amount) && amount >= APPROVAL_THRESHOLD
)

export interface ProduceApprovalInput {
  supplier: mongoose.Types.ObjectId | string
  subjectType: string
  subject: string
  amount: number
  currency?: string
  requestedBy?: mongoose.Types.ObjectId | string
  reason?: string
}

/**
 * Idempotent producer: returns the existing pending request for the same
 * supplier + subject + subjectType instead of creating a duplicate (the
 * manual create endpoint keeps its 409 contract; producers never fail a
 * domain flow just because a request is already open).
 */
export const produceApprovalRequest = async (input: ProduceApprovalInput) => {
  const query = {
    supplier: input.supplier,
    subject: input.subject,
    subjectType: input.subjectType,
    status: bookcarsTypes.ApprovalDecision.Pending,
  }
  const existing = await Approval.findOne(query)
  if (existing) {
    return existing
  }
  try {
    return await Approval.create({
      supplier: input.supplier,
      subject: input.subject,
      subjectType: input.subjectType,
      amount: input.amount,
      currency: input.currency || undefined,
      status: bookcarsTypes.ApprovalDecision.Pending,
      requestedBy: input.requestedBy,
      reason: input.reason,
    })
  } catch (err) {
    // Unique partial index on pending supplier+subject+subjectType: a
    // concurrent producer won the race; return its record.
    if ((err as { code?: number })?.code === 11000) {
      const winner = await Approval.findOne(query)
      if (winner) {
        return winner
      }
    }
    throw err
  }
}

/** Latest queue record for a domain object, whatever its state. */
export const findLatestApproval = async (
  supplier: mongoose.Types.ObjectId | string,
  subjectType: string,
  subject: string,
) => Approval.findOne({ supplier, subjectType, subject }).sort({ createdAt: -1 })

/**
 * Mirror a decision taken in a domain workflow (contract charges) onto
 * the linked pending queue record, so the Approval record stays the
 * single source of truth (decision 1.6).
 */
export const mirrorApprovalDecision = async (input: {
  supplier: mongoose.Types.ObjectId | string
  subjectType: string
  subject: string
  status: bookcarsTypes.ApprovalDecision
  decidedBy?: mongoose.Types.ObjectId | string
  reason?: string
}) => {
  const approval = await Approval.findOne({
    supplier: input.supplier,
    subjectType: input.subjectType,
    subject: input.subject,
    status: bookcarsTypes.ApprovalDecision.Pending,
  })
  if (!approval) {
    return null
  }
  approval.status = input.status
  approval.decidedBy = input.decidedBy
    ? new mongoose.Types.ObjectId(input.decidedBy)
    : undefined
  approval.decidedAt = new Date()
  approval.reason = input.reason
  await approval.save()
  return approval
}
