import 'dotenv/config'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import Booking from '../src/models/Booking'
import RentalPayment from '../src/models/RentalPayment'

/**
 * Read-only, aggregate-only inventory for planning legacy payment reconciliation.
 * Never emit booking IDs, customer/supplier details, provider tokens, or raw records.
 */
const audit = async () => {
  const connected = await databaseHelper.connect(env.DB_URI, env.DB_SSL, env.DB_DEBUG)
  if (!connected) throw new Error('Unable to connect to the configured database')

  try {
    const bookingGroups = await Booking.aggregate([
      {
        $group: {
          _id: {
            status: '$status',
            isDeposit: { $eq: ['$isDeposit', true] },
            isPayedInFull: { $eq: ['$isPayedInFull', true] },
            hasStripeReference: { $ne: [{ $ifNull: ['$paymentIntentId', ''] }, ''] },
            hasPayPalReference: { $ne: [{ $ifNull: ['$paypalOrderId', ''] }, ''] },
            isTemporary: { $and: [{ $eq: [{ $type: '$expireAt' }, 'date'] }, { $eq: ['$status', 'void'] }] },
          },
          count: { $sum: 1 },
          sumStoredBookingPrice: { $sum: { $ifNull: ['$price', 0] } },
        },
      },
      { $sort: { '_id.status': 1, '_id.hasStripeReference': 1, '_id.hasPayPalReference': 1 } },
    ])

    const legacyLedgerCount = await RentalPayment.countDocuments()
    const ledgerSummary = await RentalPayment.aggregate([
      { $group: { _id: '$method', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ])

    console.log(JSON.stringify({
      report: 'legacy-booking-payment-inventory',
      generatedAt: new Date().toISOString(),
      mode: 'read-only; aggregates only; no identifiers or personal fields',
      legacyBookingGroups: bookingGroups,
      newLedger: { count: legacyLedgerCount, byMethod: ledgerSummary },
      interpretation: [
        'A status or intent flag alone is not proof of an amount collected.',
        'Provider reference presence is a lookup hint, not proof of current settlement or absence of refunds.',
        'Do not migrate groups automatically; reconcile provider evidence or require an authorized manual opening-balance decision.',
      ],
    }, null, 2))
  } finally {
    await databaseHelper.close()
  }
}

audit().catch((error) => {
  console.error('Legacy payment audit failed:', error instanceof Error ? error.message : 'unknown error')
  process.exitCode = 1
})
