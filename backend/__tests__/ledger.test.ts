import { currencyExponent, toMinorUnits } from '../src/utils/paymentAmount'
import { normalizeLedgerAmount, remainingLedgerBalance } from '../src/utils/ledger'

describe('ledger money invariants', () => {
  it('rounds amounts using the currency precision before comparing balances', () => {
    expect(currencyExponent('JPY')).toBe(0)
    expect(normalizeLedgerAmount(100.005, 'USD')).toBe(100)
    expect(remainingLedgerBalance(100, 33.33, 'USD')).toBe(66.67)
  })

  it('compares minor units without floating point overpayment drift', () => {
    expect(toMinorUnits(66.67, 'USD')).toBe(6667)
    expect(toMinorUnits(66.67000001, 'USD')).toBe(6667)
    expect(toMinorUnits(66.68, 'USD')).toBeGreaterThan(toMinorUnits(66.67, 'USD'))
  })
})
