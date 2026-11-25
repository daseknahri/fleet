import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import CashMovement from '../models/CashMovement'
import CashSession from '../models/CashSession'
import MaintenanceExpense from '../models/MaintenanceExpense'
import MaintenanceExpensePayment from '../models/MaintenanceExpensePayment'
import { normalizeLedgerAmount } from './ledger'
import * as logger from './logger'

/**
 * F7 / W3 M-2 — paidAmount backing for maintenance expenses.
 *
 * `paidAmount` on the expense is SERVER-DERIVED: it is the sum of the
 * expense's MaintenanceExpensePayment records, recomputed here every
 * time a payment is recorded. Legacy rows keep their declared value
 * until a payment is recorded for them (then the sum takes over).
 * Payments are append-only, so the derived figure always traces to
 * records — a typed-in number can never again stand for money paid.
 *
 * Cash linkage follows the F6 C-7 pattern (utils/ledger.ts
 * linkLedgerCashPayment): a cash expense payment creates a CONFIRMED
 * CashMovement Out in the open cash session, linked back to the
 * payment. No open session, or a session in another currency, means
 * the payment still records — unlinked, with an error log — exactly
 * like a ledger cash payment. NO balance check is applied to the
 * linked movement: it records money already spent, not a new
 * commitment (same F6 C-2 decision, same residual: it can drive a
 * session negative through the C-7 compensating Out, which is why
 * close() keeps its schema-min owner decision).
 */
export const recomputeExpensePaid = async (
  expenseId: mongoose.Types.ObjectId | string,
  dbSession?: mongoose.ClientSession,
): Promise<number> => {
  const agg = MaintenanceExpensePayment.aggregate([
    { $match: { expense: new mongoose.Types.ObjectId(expenseId) } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])
  if (dbSession) {
    agg.session(dbSession)
  }
  const rows = await agg
  const total = normalizeLedgerAmount(Number(rows[0]?.total || 0), env.BASE_CURRENCY)
  await MaintenanceExpense.updateOne(
    { _id: expenseId },
    { $set: { paidAmount: total } },
    dbSession ? { session: dbSession } : undefined,
  )
  return total
}

// Wave 2.6 — the bank mirror of linkExpensePaymentToCash: a
// bank-transfer expense payment creates a CONFIRMED CashMovement Out
// in the open Bank session, linked back to the payment. No open Bank
// session, or a session in another currency, means the payment still
// records — unlinked, with an error log — exactly like the cash path.
// GH-24 — targetSessionId links into the NAMED session (the repair
// endpoint validates it first); without it the latest open session is
// used, as before. Same shape as ledger linkLedgerCashPayment.
export const linkExpensePaymentToBank = async (
  payment: env.MaintenanceExpensePayment,
  dbSession?: mongoose.ClientSession,
  targetSessionId?: mongoose.Types.ObjectId | string,
): Promise<env.CashMovement | null> => {
  if (payment.method !== bookcarsTypes.RentalPaymentMethod.BankTransfer) {
    return null
  }
  const existingQuery = CashMovement.findOne({ expensePayment: payment._id })
  if (dbSession) {
    existingQuery.session(dbSession)
  }
  const existing = await existingQuery
  if (existing) {
    if (!payment.bankMovement || !payment.bankMovement.equals(existing._id)) {
      payment.bankMovement = existing._id
      await payment.save(dbSession ? { session: dbSession } : undefined)
    }
    return existing
  }
  const sessionQuery = targetSessionId
    ? CashSession.findOne({
      _id: new mongoose.Types.ObjectId(targetSessionId),
      supplier: payment.supplier,
      account: bookcarsTypes.CashAccountType.Bank,
      status: bookcarsTypes.CashSessionStatus.Open,
    })
    : CashSession.findOne({
      supplier: payment.supplier,
      account: bookcarsTypes.CashAccountType.Bank,
      status: bookcarsTypes.CashSessionStatus.Open,
    }).sort({ openedAt: -1 })
  if (dbSession) {
    sessionQuery.session(dbSession)
  }
  const bankSession = await sessionQuery
  if (!bankSession) {
    logger.error(`[expensePayment.linkExpensePaymentToBank] No open bank session for supplier ${payment.supplier.toString()}; expense payment ${payment._id.toString()} recorded unlinked`)
    return null
  }
  if (bankSession.currency !== payment.currency) {
    logger.error(`[expensePayment.linkExpensePaymentToBank] Bank session currency ${bankSession.currency} does not match payment currency ${payment.currency}; expense payment ${payment._id.toString()} recorded unlinked`)
    return null
  }
  const movement = new CashMovement({
    supplier: payment.supplier,
    session: bankSession._id,
    account: bankSession.account,
    currency: bankSession.currency,
    date: payment.date,
    direction: bookcarsTypes.CashMovementDirection.Out,
    amount: payment.amount,
    source: bookcarsTypes.CashMovementSource.ExpensePayment,
    status: 'confirmed',
    idempotencyKey: `expense-bank-${payment._id.toString()}`,
    expensePayment: payment._id,
    reference: payment.reference,
    note: payment.note,
    actor: payment.actor,
  })
  await movement.save(dbSession ? { session: dbSession } : undefined)
  payment.bankMovement = movement._id
  await payment.save(dbSession ? { session: dbSession } : undefined)
  return movement
}

export const linkExpensePaymentToCash = async (
  payment: env.MaintenanceExpensePayment,
  dbSession?: mongoose.ClientSession,
  targetSessionId?: mongoose.Types.ObjectId | string,
): Promise<env.CashMovement | null> => {
  if (payment.method !== bookcarsTypes.RentalPaymentMethod.Cash) {
    return null
  }
  const existingQuery = CashMovement.findOne({ expensePayment: payment._id })
  if (dbSession) {
    existingQuery.session(dbSession)
  }
  const existing = await existingQuery
  if (existing) {
    if (!payment.cashMovement || !payment.cashMovement.equals(existing._id)) {
      payment.cashMovement = existing._id
      await payment.save(dbSession ? { session: dbSession } : undefined)
    }
    return existing
  }
  const sessionQuery = targetSessionId
    ? CashSession.findOne({
      _id: new mongoose.Types.ObjectId(targetSessionId),
      supplier: payment.supplier,
      account: bookcarsTypes.CashAccountType.Cash,
      status: bookcarsTypes.CashSessionStatus.Open,
    })
    : CashSession.findOne({
      supplier: payment.supplier,
      account: bookcarsTypes.CashAccountType.Cash,
      status: bookcarsTypes.CashSessionStatus.Open,
    }).sort({ openedAt: -1 })
  if (dbSession) {
    sessionQuery.session(dbSession)
  }
  const cashSession = await sessionQuery
  if (!cashSession) {
    logger.error(`[expensePayment.linkExpensePaymentToCash] No open cash session for supplier ${payment.supplier.toString()}; expense payment ${payment._id.toString()} recorded unlinked`)
    return null
  }
  if (cashSession.currency !== payment.currency) {
    logger.error(`[expensePayment.linkExpensePaymentToCash] Cash session currency ${cashSession.currency} does not match payment currency ${payment.currency}; expense payment ${payment._id.toString()} recorded unlinked`)
    return null
  }
  const movement = new CashMovement({
    supplier: payment.supplier,
    session: cashSession._id,
    account: cashSession.account,
    currency: cashSession.currency,
    date: payment.date,
    direction: bookcarsTypes.CashMovementDirection.Out,
    amount: payment.amount,
    source: bookcarsTypes.CashMovementSource.ExpensePayment,
    status: 'confirmed',
    idempotencyKey: `expense-${payment._id.toString()}`,
    expensePayment: payment._id,
    reference: payment.reference,
    note: payment.note,
    actor: payment.actor,
  })
  await movement.save(dbSession ? { session: dbSession } : undefined)
  payment.cashMovement = movement._id
  await payment.save(dbSession ? { session: dbSession } : undefined)
  return movement
}
