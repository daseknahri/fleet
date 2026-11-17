import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Approval from '../models/Approval'

/**
 * Approvals producer wiring (GA-P1-APPROVALS-PRODUCER-02).
 *
 * The policy itself lives in ./approvalPolicy (owner-approved
 * defaults 2026-11-17 + Decision Pack GA-P10-DECISIONS-01 section 1):
 * triggers refund / discount / price override / manual charge above
 * 10,000 MAD, approver Owner + Manager, no self-approval, blocking.
 * This module is the producer that opens queue requests for the
 * invoice-issued and contract-charge-created triggers; the rental
 * payment (refund) and booking (price override) triggers wire in
 * through the same approvalRequiredFor / produceApprovalRequest.
 */

export { APPROVAL_THRESHOLD_MAD as APPROVAL_THRESHOLD, approvalRequiredFor } from './approvalPolicy'

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
