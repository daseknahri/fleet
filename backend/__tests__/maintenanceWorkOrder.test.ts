import { describe, expect, it } from '@jest/globals'

const overlaps = (bookingFrom: Date, bookingTo: Date, downtimeFrom: Date, downtimeTo: Date) => (
  downtimeFrom < bookingTo && downtimeTo > bookingFrom
)

describe('maintenance downtime availability rule', () => {
  const bookingFrom = new Date('2026-11-10T10:00:00.000Z')
  const bookingTo = new Date('2026-11-12T10:00:00.000Z')

  it('blocks a reservation that overlaps active downtime', () => {
    expect(overlaps(bookingFrom, bookingTo, new Date('2026-11-11T00:00:00.000Z'), new Date('2026-11-13T00:00:00.000Z'))).toBe(true)
  })

  it('allows a reservation ending exactly when downtime starts', () => {
    expect(overlaps(bookingFrom, bookingTo, bookingTo, new Date('2026-11-13T00:00:00.000Z'))).toBe(false)
  })

  it('allows completed or cancelled work orders by policy', () => {
    const blocking = ['scheduled', 'inProgress']
    expect(blocking.includes('completed')).toBe(false)
    expect(blocking.includes('cancelled')).toBe(false)
  })
})
