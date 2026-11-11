import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import Booking from '../models/Booking'
import RentalPayment from '../models/RentalPayment'
import ContractCharge from '../models/ContractCharge'
import { currencyExponent, toMinorUnits } from './paymentAmount'

export interface ContractReceivable {
  currency: string
  rentalTotal: number
  refundableDeposit: number
  postedPayments: number
  depositPayments: number
  approvedCharges: number
  outstandingBalance: number
  dueAt?: Date
  overdue: boolean
}

export const getContractReceivable = async (
  booking: Pick<env.Booking, '_id' | 'price' | 'financialSnapshot'>,
  completionAt?: Date,
): Promise<ContractReceivable> => {
  const currency = (booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY).toUpperCase()
  const exponent = currencyExponent(currency)
  const rentalTotal = Number(booking.financialSnapshot?.rentalTotal || booking.price || 0)
  const refundableDeposit = Number(booking.financialSnapshot?.depositAmount || 0)

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

  const approvedChargeRows = await ContractCharge.aggregate<{ total: number }>([
    { $match: { booking: new mongoose.Types.ObjectId(booking._id), status: bookcarsTypes.ApprovalDecision.Approved, currency } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])
  const approvedCharges = Number(approvedChargeRows[0]?.total || 0)
  const outstandingMinor = Math.max(
    0,
    toMinorUnits(rentalTotal + approvedCharges, currency) - toMinorUnits(postedPayments, currency),
  )

  const outstandingBalance = outstandingMinor / (10 ** exponent)
  const dueAt = outstandingBalance > 0 ? (completionAt || new Date()) : undefined

  return {
    currency,
    rentalTotal: Number(rentalTotal.toFixed(exponent)),
    refundableDeposit: Number(refundableDeposit.toFixed(exponent)),
    approvedCharges: Number(approvedCharges.toFixed(exponent)),
    postedPayments: Number(postedPayments.toFixed(exponent)),
    depositPayments: Number(depositPayments.toFixed(exponent)),
    outstandingBalance,
    dueAt,
    overdue: outstandingBalance > 0,
  }
}

/**
 * GA-PAR-04: per-client balances for a set of drivers, computed with
 * EXACTLY the per-booking semantics of getContractReceivable above:
 * outstanding per booking = max(0, rentalTotal + approved charges
 * (same currency only) - posted rent payments (debits negative));
 * the refundable deposit is reported separately and NEVER netted.
 * Void/Cancelled bookings and unexpired checkout placeholders
 * (expireAt set) carry no receivable and are excluded.
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
    expireAt: null,
  }).select('_id driver price financialSnapshot to lifecycle').lean()

  const bookingIds = bookings.map((booking) => booking._id)

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
  for (const row of paymentRows) {
    const key = row._id.booking.toString()
    if (row._id.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit) {
      depositByBooking.set(key, Number(row.total || 0))
    } else if (row._id.purpose === bookcarsTypes.RentalPaymentPurpose.Rent) {
      rentByBooking.set(key, Number(row.total || 0))
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
    // Identical arithmetic to getContractReceivable (minor-unit clamp per booking).
    const outstandingMinor = Math.max(
      0,
      toMinorUnits(rentalTotal + approvedCharges, currency) - toMinorUnits(postedPayments, currency),
    )
    const outstanding = outstandingMinor / (10 ** exponent)
    const isOverdue = outstanding > 0
      && (booking.lifecycle === bookcarsTypes.ContractLifecycle.Completed || (!!booking.to && booking.to < now))

    const row = result.get(driverId) || {
      driver: driverId,
      currency: env.BASE_CURRENCY.toUpperCase(),
      outstanding: 0,
      overdue: 0,
      depositHeld: 0,
      bookings: 0,
    }
    row.outstanding = Number((row.outstanding + outstanding).toFixed(exponent))
    if (isOverdue) {
      row.overdue = Number((row.overdue + outstanding).toFixed(exponent))
    }
    row.depositHeld = Number((row.depositHeld + depositPayments).toFixed(exponent))
    row.bookings += 1
    result.set(driverId, row)
  }

  return result
}
