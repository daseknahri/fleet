/**
 * Wave 2 remainder — Q13 (answered YES by the user 2026-11-21).
 *
 * Default deposit for a car: 5× the daily rate, rounded to the
 * nearest 500 MAD, bounded to [1,500 – 5,000] MAD. Used at car create
 * when the manager leaves the deposit blank; the manager may still
 * override the deposit per car (an explicit value, including 0, is
 * never replaced). A non-positive or non-finite daily price cannot
 * produce a rate — it defaults to the 1,500 floor.
 *
 * Note: the design doc's worked examples (Clio 320/day → 2,000;
 * Golf 420/day → 2,000) are mutually inconsistent with any single
 * rounding of 5× (Clio 1,600 → nearest-500 = 1,500; Golf 2,100 →
 * nearest-500 = 2,000) — the seeded deposits were hand-picked round
 * numbers. The rule as the user answered it is "nearest 500"
 * (Math.round), and that is what this helper implements.
 */
export const DEPOSIT_MIN = 1500
export const DEPOSIT_MAX = 5000
export const DEPOSIT_MULTIPLE = 5
export const DEPOSIT_ROUNDING = 500

export const defaultDeposit = (dailyPrice: unknown): number => {
  const price = typeof dailyPrice === 'number' && Number.isFinite(dailyPrice) ? dailyPrice : 0
  if (price <= 0) {
    return DEPOSIT_MIN
  }
  const raw = price * DEPOSIT_MULTIPLE
  const rounded = Math.round(raw / DEPOSIT_ROUNDING) * DEPOSIT_ROUNDING
  return Math.min(DEPOSIT_MAX, Math.max(DEPOSIT_MIN, rounded))
}
