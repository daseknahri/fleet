import { describe, expect, test } from '@jest/globals'
import { casablancaDayStart } from '../src/utils/casablancaDate'

// R6-30 — the start of the Casablanca wall day containing a date:
// true local midnight, not the process-local start of day (UTC in
// the container, Chicago on the laptop). Pinned instants: in summer
// (UTC+1) true midnight is 23:00Z the previous day, so a due date
// of "today" at 00:30 local reads as today, not yesterday.
describe('casablancaDayStart (R6-30)', () => {
  test('00:30 local on Jul 6 starts at 23:00Z Jul 5 (summer, UTC+1)', () => {
    expect(casablancaDayStart(new Date('2026-07-05T23:30:00.000Z')).toISOString())
      .toBe('2026-07-05T23:00:00.000Z')
  })

  test('midday local stays on the same wall day', () => {
    expect(casablancaDayStart(new Date('2026-07-06T12:00:00.000Z')).toISOString())
      .toBe('2026-07-05T23:00:00.000Z')
  })

  test('January (UTC+1, outside Ramadan) midnight is 23:00Z the previous day', () => {
    expect(casablancaDayStart(new Date('2026-01-15T12:00:00.000Z')).toISOString())
      .toBe('2026-01-14T23:00:00.000Z')
  })

  test('Ramadan (UTC+0) midnight coincides with UTC midnight', () => {
    expect(casablancaDayStart(new Date('2026-03-05T12:00:00.000Z')).toISOString())
      .toBe('2026-03-05T00:00:00.000Z')
  })

  test('23:30 local on Jul 5 is still the Jul 5 wall day', () => {
    expect(casablancaDayStart(new Date('2026-07-05T22:30:00.000Z')).toISOString())
      .toBe('2026-07-04T23:00:00.000Z')
  })
})
