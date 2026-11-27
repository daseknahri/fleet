import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import RentalPayment from '../models/RentalPayment'
import ContractCharge from '../models/ContractCharge'
import User from '../models/User'
import { currencyExponent, toMinorUnits } from './paymentAmount'
import * as logger from './logger'
import { resolveVatRatePercent, vatAmountMinor } from './fiscal'

export interface ContractReceivable {
  currency: string
  rentalTotal: number
  refundableDeposit: number
  postedPayments: number
  depositPayments: number
  approvedCharges: number
  // Wave 2.4 — posted Charge credits (kept deposit settling approved
  // charges). They reduce the outstanding balance exactly like rent
  // payments do: a charge paid from the deposit is no longer owed.
  chargeCredits: number
  // Wave 2 remainder — 2.7 (Q11 = HT). The VAT on the rent, as a
  // percent and as a major-unit amount, and the VAT-inclusive rent.
  // All three are 0 / equal to rentalTotal when the supplier has VAT
  // off (the default): the outstanding balance is then exactly the
  // pre-2.7 number.
  vatRate: number
  vatAmount: number
  rentalTotalInclVat: number
  outstandingBalance: number
  // Next pass - the exact complement of the outstanding balance: what the
  // client has already paid over the rent + approved charges + VAT. 0 when
  // nothing is overpaid. An early return (or a shortening amendment) below
  // posted payments surfaces here - the ledger is untouched, no refund is
  // implied; any refund goes through the existing reverse path.
  overpaidAmount: number
  dueAt?: Date
  overdue: boolean
}

/**
 * Wave 2 remainder — 2.7. The supplier's effective VAT rate as a
 * percent (0 when VAT is off or the supplier cannot be found). One
 * small query per call site that needs it; callers that already hold
 * the supplier document should use resolveVatRatePercent directly.
 */
export const getSupplierVatRatePercent = async (
  supplierId: mongoose.Types.ObjectId | string | null | undefined,
): Promise<number> => {
  if (!supplierId) {
    return 0
  }
  const supplier = await User.findById(supplierId).select('vatEnabled vatRate').lean()
  return resolveVatRatePercent(supplier)
}

// ---------------------------------------------------------------------
// F6 / W3 P-3 — THE shared outstanding / receivable definition
// (CROSS-4 with F8; the dashboard applies this same definition, it
// does not invent its own — see the note for F8 in F6-REPORT.md).
//
// Before this fix three surfaces disagreed: getContractReceivable
// called any unpaid balance "overdue" (dueAt = completionAt || now);
// the Payments page's overdue table omitted APPROVED charges and used
// rental-end as the due date; the collections summary included charges
// with a per-booking clamp. One definition now governs all three:
//   - outstandingBalance = max(0, rentalTotal + APPROVED charges
//     − posted rent), clamped per booking in minor units. Deposits are
//     held separately and NEVER netted against rent.
//   - dueAt = the completion time when one is given (contract
//     completion), else now for a Completed lifecycle (the rental is
//     done, the money is due), else the rental end (`to`). No due date
//     is known → dueAt is undefined and the balance is not overdue.
//   - overdue = outstandingBalance > 0 AND dueAt has passed.
// The collections summary's `remaining` already used the
// per-booking-clamped, charges-included arithmetic; it is the same
// number summed over the collections universe. The metric dictionary
// (reportController, v2026-11-15.1) records this definition.
// ---------------------------------------------------------------------

export const resolveDueAt = (
  booking: { to?: Date | string | null, lifecycle?: bookcarsTypes.ContractLifecycle | string | null },
  completionAt?: Date,
  now = new Date(),
): Date | undefined => {
  if (completionAt) {
    return completionAt
  }
  if (booking.lifecycle === bookcarsTypes.ContractLifecycle.Completed) {
    return now
  }
  const to = booking.to ? new Date(booking.to) : undefined
  return to && !Number.isNaN(to.getTime()) ? to : undefined
}

export const isOverdue = (outstandingBalance: number, dueAt: Date | undefined, now = new Date()): boolean =>
  outstandingBalance > 0 && !!dueAt && dueAt.getTime() <= now.getTime()

export const getContractReceivable = async (
  booking: Pick<env.Booking, '_id' | 'price' | 'financialSnapshot' | 'to' | 'lifecycle'> & { supplier?: env.Booking['supplier'] },
  completionAt?: Date,
): Promise<ContractReceivable> => {
  const currency = (booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
  const exponent = currencyExponent(currency)
  const rentalTotal = Number(booking.financialSnapshot?.rentalTotal || booking.price || 0)
  const refundableDeposit = Number(booking.financialSnapshot?.depositAmount || 0)
  // Wave 2 remainder — 2.7 (Q11 = HT): the rent the customer owes is
  // the HT rental total PLUS the supplier's VAT when VAT is on. A
  // booking without a supplier (legacy callers that select without
  // it) resolves to 0% — the pre-2.7 number.
  const vatRate = await getSupplierVatRatePercent(booking.supplier as mongoose.Types.ObjectId | string | null | undefined)
  const vatMinor = vatAmountMinor(rentalTotal, currency, vatRate)
  const vatAmount = vatMinor / (10 ** exponent)
  const rentalTotalInclVat = Number((rentalTotal + vatAmount).toFixed(exponent))

  const rows = await RentalPayment.aggregate<{
    _id: bookcarsTypes.RentalPaymentPurpose
    total: number
  }>([
    {
      $match: {
        booking: new mongoose.Types.ObjectId(booking._id),
        status: bookcarsTypes.RentalPaymentStatus.Posted,
      },
    },
    {
      $group: {
        _id: {
          $ifNull: ['$purpose', bookcarsTypes.RentalPaymentPurpose.Rent],
        },
        total: {
          $sum: {
            $cond: [
              { $eq: ['$direction', bookcarsTypes.RentalPaymentDirection.Debit] },
              { $multiply: ['$amount', -1] },
              '$amount',
            ],
          },
        },
      },
    },
  ])

  const postedPayments = Number(
    rows.find((row) => row._id === bookcarsTypes.RentalPaymentPurpose.Rent)?.total || 0,
  )

  const depositPayments = Number(
    rows.find((row) => row._id === bookcarsTypes.RentalPaymentPurpose.Deposit)?.total || 0,
  )

  // Wave 2.4 — posted Charge credits (kept deposit settling approved
  // charges). Signed by direction, like the other purposes.
  const chargeCredits = Number(
    rows.find((row) => row._id === bookcarsTypes.RentalPaymentPurpose.Charge)?.total || 0,
  )

  const approvedChargeRows = await ContractCharge.aggregate<{ total: number }>([
    { $match: { booking: new mongoose.Types.ObjectId(booking._id), status: bookcarsTypes.ApprovalDecision.Approved, currency } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])
  const approvedCharges = Number(approvedChargeRows[0]?.total || 0)
  // Wave 2.4 — a charge settled from the kept deposit is paid: the
  // Charge credit comes off the outstanding balance (the deposit
  // itself is still never netted against rent).
  // Wave 2 remainder — 2.7: the rent leg is VAT-inclusive when the
  // supplier has VAT on (vatMinor above); approved charges are
  // staff-decided amounts and carry no VAT here, exactly as the
  // quote/invoice subtotal taxes the rental total only.
  const outstandingMinor = Math.max(
    0,
    toMinorUnits(rentalTotal + approvedCharges, currency) + vatMinor - toMinorUnits(postedPayments, currency) - toMinorUnits(chargeCredits, currency),
  )

  const outstandingBalance = outstandingMinor / (10 ** exponent)
  const overpaidMinor = Math.max(
    0,
    toMinorUnits(postedPayments, currency) + toMinorUnits(chargeCredits, currency)
      - toMinorUnits(rentalTotal + approvedCharges, currency) - vatMinor,
  )
  const overpaidAmount = overpaidMinor / (10 ** exponent)
  // F6 / W3 P-3 — the shared due-date rule (see above): overdue only
  // once the due date has passed. A balance with no known due date is
  // outstanding, never overdue.
  const dueAt = outstandingBalance > 0 ? resolveDueAt(booking, completionAt) : undefined

  return {
    currency,
    rentalTotal: Number(rentalTotal.toFixed(exponent)),
    refundableDeposit: Number(refundableDeposit.toFixed(exponent)),
    approvedCharges: Number(approvedCharges.toFixed(exponent)),
    postedPayments: Number(postedPayments.toFixed(exponent)),
    depositPayments: Number(depositPayments.toFixed(exponent)),
    chargeCredits: Number(chargeCredits.toFixed(exponent)),
    vatRate,
    vatAmount: Number(vatAmount.toFixed(exponent)),
    rentalTotalInclVat,
    outstandingBalance,
    overpaidAmount,
    dueAt,
    overdue: isOverdue(outstandingBalance, dueAt),
  }
}

/** GH-17 — the stored isPayedInFull flag is derived from the ledger, never
 *  from the checkout payment mode. outstandingBalance <= 0 means the rent
 *  (+ approved charges, VAT-inclusive when VAT is on) is fully covered.
 *  The deposit is excluded by design: deposits are held, never netted.
 *  Callers invoke this only AFTER the posting transaction has committed:
 *  getContractReceivable reads outside any session, so calling it inside
 *  a transaction would see the pre-transaction ledger. */
export const syncBookingPaidInFull = async (
  bookingId: mongoose.Types.ObjectId | string,
  dbSession?: mongoose.ClientSession,
): Promise<boolean> => {
  // R4-04 — retry a transient sync failure instead of leaving the
  // stored flag stale on a completed contract. The receivable is
  // computed live from the ledger, so no money figure is wrong — but
  // list filters, badges and queries driven by the stored flag would
  // misread the contract until the next refresh/sync. Three attempts
  // with a 250 ms pause cover a transient read/write error (primary
  // stepdown, brief network loss); a sustained failure still throws
  // and the call sites log it as before. With a caller-supplied
  // session the sync runs once, as before: retrying inside a
  // caller-owned transaction could re-read after an abort.
  const attempts = dbSession ? 1 : 3
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const bookingQuery = Booking.findById(bookingId).select('_id price financialSnapshot to lifecycle supplier isPayedInFull')
      if (dbSession) {
        bookingQuery.session(dbSession)
      }
      const booking = await bookingQuery
      if (!booking) return false
      const receivable = await getContractReceivable(booking as Parameters<typeof getContractReceivable>[0])
      const paidInFull = receivable.outstandingBalance <= 0
      if (booking.isPayedInFull !== paidInFull) {
        booking.isPayedInFull = paidInFull
        await booking.save(dbSession ? { session: dbSession } : undefined)
      }
      return paidInFull
    } catch (err) {
      if (attempt === attempts) throw err
      logger.warn(`[contractReceivable.syncBookingPaidInFull] Booking ${bookingId.toString()} sync attempt ${attempt} failed, retrying`)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  return false
}

/**
 * GA-PAR-04: per-client balances for a set of drivers, computed with
 * EXACTLY the per-booking semantics of getContractReceivable above:
 * outstanding per booking = max(0, rentalTotal + approved charges
 * (same currency only) - posted rent payments (debits negative));
 * the refundable deposit is reported separately and NEVER netted.
 * Void/Cancelled bookings carry no receivable and are excluded.
 * (R6-15) Live pay-later holds ARE included: a Pending hold with
 * expireAt set is a live booking with an outstanding balance, and
 * the query below filters only Void/Cancelled/deleted — the old
 * claim that placeholders are excluded was never implemented here.
 */
export interface ClientBalanceRow extends bookcarsTypes.ClientBalance {
  driver: string
}

export const getClientBalances = async (driverIds: string[]): Promise<Map<string, ClientBalanceRow>> => {
  const result = new Map<string, ClientBalanceRow>()
  const ids = [...new Set(driverIds.filter(Boolean))]
  if (ids.length === 0) {
    return result
  }

  const bookings = await Booking.find({
    driver: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
    status: { $nin: [bookcarsTypes.BookingStatus.Void, bookcarsTypes.BookingStatus.Cancelled] },
    // GA-PAR-22: trashed bookings leave the live balance due (§2.5).
    deletedAt: null,
  }).select('_id driver supplier price financialSnapshot to lifecycle').lean()

  const bookingIds = bookings.map((booking) => booking._id)

  // Wave 2 remainder — 2.7: one VAT-rate lookup per supplier in the
  // set (the rollup must use the same VAT-inclusive rent as
  // getContractReceivable above).
  const supplierIds = [...new Set(bookings.map((booking) => booking.supplier?.toString()).filter(Boolean))]
  const vatRateBySupplier = new Map<string, number>()
  if (supplierIds.length > 0) {
    const suppliers = await User.find({ _id: { $in: supplierIds.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select('vatEnabled vatRate').lean()
    for (const supplier of suppliers) {
      vatRateBySupplier.set(supplier._id.toString(), resolveVatRatePercent(supplier))
    }
  }

  const paymentRows = bookingIds.length > 0 ? await RentalPayment.aggregate<{
    _id: { booking: mongoose.Types.ObjectId, purpose: bookcarsTypes.RentalPaymentPurpose }
    total: number
  }>([
    {
      $match: {
        booking: { $in: bookingIds },
        status: bookcarsTypes.RentalPaymentStatus.Posted,
      },
    },
    {
      $group: {
        _id: {
          booking: '$booking',
          purpose: { $ifNull: ['$purpose', bookcarsTypes.RentalPaymentPurpose.Rent] },
        },
        total: {
          $sum: {
            $cond: [
              { $eq: ['$direction', bookcarsTypes.RentalPaymentDirection.Debit] },
              { $multiply: ['$amount', -1] },
              '$amount',
            ],
          },
        },
      },
    },
  ]) : []

  const chargeRows = bookingIds.length > 0 ? await ContractCharge.aggregate<{
    _id: { booking: mongoose.Types.ObjectId, currency: string }
    total: number
  }>([
    { $match: { booking: { $in: bookingIds }, status: bookcarsTypes.ApprovalDecision.Approved } },
    { $group: { _id: { booking: '$booking', currency: '$currency' }, total: { $sum: '$amount' } } },
  ]) : []

  const rentByBooking = new Map<string, number>()
  const depositByBooking = new Map<string, number>()
  // Wave 2.4 — posted Charge credits per booking (kept deposit
  // settling approved charges); they reduce the outstanding balance.
  const chargeByBooking = new Map<string, number>()
  for (const row of paymentRows) {
    const key = row._id.booking.toString()
    if (row._id.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit) {
      depositByBooking.set(key, Number(row.total || 0))
    } else if (row._id.purpose === bookcarsTypes.RentalPaymentPurpose.Rent) {
      rentByBooking.set(key, Number(row.total || 0))
    } else if (row._id.purpose === bookcarsTypes.RentalPaymentPurpose.Charge) {
      chargeByBooking.set(key, Number(row.total || 0))
    }
  }
  const chargesByBooking = new Map<string, { currency: string, total: number }[]>()
  for (const row of chargeRows) {
    const key = row._id.booking.toString()
    const list = chargesByBooking.get(key) || []
    list.push({ currency: row._id.currency, total: Number(row.total || 0) })
    chargesByBooking.set(key, list)
  }

  const now = new Date()
  for (const booking of bookings) {
    const driverId = booking.driver.toString()
    const currency = (booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
    const exponent = currencyExponent(currency)
    const rentalTotal = Number(booking.financialSnapshot?.rentalTotal || booking.price || 0)
    const key = booking._id.toString()
    const approvedCharges = Number(
      (chargesByBooking.get(key) || [])
        .filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + row.total, 0),
    )
    const postedPayments = Number(rentByBooking.get(key) || 0)
    const depositPayments = Number(depositByBooking.get(key) || 0)
    const chargeCredits = Number(chargeByBooking.get(key) || 0)
    // Identical arithmetic to getContractReceivable (minor-unit clamp per booking).
    // Wave 2 remainder — 2.7: the rent leg is VAT-inclusive when the
    // booking's supplier has VAT on.
    const vatMinor = vatAmountMinor(rentalTotal, currency, vatRateBySupplier.get(booking.supplier?.toString() || '') || 0)
    const outstandingMinor = Math.max(
      0,
      toMinorUnits(rentalTotal + approvedCharges, currency) + vatMinor - toMinorUnits(postedPayments, currency) - toMinorUnits(chargeCredits, currency),
    )
    const outstanding = outstandingMinor / (10 ** exponent)
    const overpaidMinor = Math.max(
      0,
      toMinorUnits(postedPayments, currency) + toMinorUnits(chargeCredits, currency)
        - toMinorUnits(rentalTotal + approvedCharges, currency) - vatMinor,
    )
    const overpaid = overpaidMinor / (10 ** exponent)
    // F6 / W3 P-3 — the same shared overdue rule as
    // getContractReceivable above (due = completion, else rental end).
    const dueAt = outstanding > 0
      ? resolveDueAt({ to: booking.to, lifecycle: booking.lifecycle }, undefined, now)
      : undefined
    const isOverdueRow = isOverdue(outstanding, dueAt, now)

    const row = result.get(driverId) || {
      driver: driverId,
      currency: env.BASE_CURRENCY.toUpperCase(),
      outstanding: 0,
      overdue: 0,
      depositHeld: 0,
      bookings: 0,
      overpaid: 0,
    }
    row.outstanding = Number((row.outstanding + outstanding).toFixed(exponent))
    row.overpaid = Number(((row.overpaid || 0) + overpaid).toFixed(exponent))
    if (isOverdueRow) {
      row.overdue = Number((row.overdue + outstanding).toFixed(exponent))
    }
    row.depositHeld = Number((row.depositHeld + depositPayments).toFixed(exponent))
    row.bookings += 1
    result.set(driverId, row)
  }

  return result
}
