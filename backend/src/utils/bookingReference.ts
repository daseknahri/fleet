import type { Types } from 'mongoose'
import Counter from '../models/Counter'

/**
 * GA-PAR-02 — human contract reference numbering for bookings.
 *
 * Format: GA-YYMMDD-NNNN (our own GA- prefix/format, matching the GA-
 * invoice style). The sequence is per agency (supplier) and per local day:
 * it reuses the exact Counter pattern invoiceController.issue() uses for
 * invoice numbers — an atomic findOneAndUpdate with $inc + upsert — so
 * concurrent creates can never receive the same number.
 *
 * Counter keying: Counter.year is a Number (min 2000). Keying the booking
 * sequence with name='booking' and year=Number(YYMMDD) (e.g. 261110 for
 * 2026-11-10) satisfies that validation and keeps exactly one Counter
 * document per agency per day, separate from the 'invoice' sequence which
 * keeps year=calendar year. No Counter schema change was needed.
 *
 * The day boundary is the creation date in Africa/Casablanca (the repo's
 * money/date basis), resolved through Intl so UTC-offset changes are
 * honoured. The sequence is padded to 4 digits; beyond 9999 bookings in a
 * day it simply grows (padStart never truncates).
 *
 * A number allocated to a booking whose save afterwards fails (e.g. an
 * availability conflict) is burned, leaving a gap — the same property the
 * invoice numbering has. Gaps are acceptable; duplicates are not: the
 * unique partial index on { supplier, reference } in the Booking model is
 * the backstop and makes a duplicate insert fail loudly.
 */
export const BOOKING_REFERENCE_TIMEZONE = 'Africa/Casablanca'

export const nextBookingReference = async (supplier: string | Types.ObjectId): Promise<string> => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOOKING_REFERENCE_TIMEZONE,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  const day = `${part('year')}${part('month')}${part('day')}`
  const dayKey = Number(day)

  const counter = await Counter.findOneAndUpdate(
    { supplier, name: 'booking', year: dayKey },
    { $inc: { value: 1 }, $setOnInsert: { supplier, name: 'booking', year: dayKey } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  if (!counter) {
    throw new Error('Unable to allocate booking reference')
  }
  return `GA-${day}-${String(counter.value).padStart(4, '0')}`
}

export default nextBookingReference
