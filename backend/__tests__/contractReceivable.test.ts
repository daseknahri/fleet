import { describe, expect, test } from '@jest/globals'
import * as bookcarsTypes from ':bookcars-types'
import { remainingLedgerBalance } from '../src/utils/ledger'

describe('completion receivable policy', () => {
  test('keeps refundable deposit separate from rental receivable arithmetic', () => {
    expect(remainingLedgerBalance(1000, 250, 'MAD')).toBe(750)
  })

  test('documents the approved refundable security-deposit payment mode', () => {
    expect(bookcarsTypes.CheckoutPaymentMode.Deposit).toBe('deposit')
  })
})