import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
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