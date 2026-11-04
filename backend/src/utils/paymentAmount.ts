/** Return the ISO currency fraction digits understood by JavaScript's Intl data. */
export const currencyExponent = (currency: string) => {
  try {
    const exponent = new Intl.NumberFormat('en', { style: 'currency', currency: currency.toUpperCase() })
      .resolvedOptions().maximumFractionDigits
    return exponent ?? 2
  } catch {
    throw new Error(`Unsupported currency ${currency}`)
  }
}

/** Convert a provider charge to integer minor units without truncating cents. */
export const toMinorUnits = (amount: number, currency: string) => {
  const exponent = currencyExponent(currency)
  return Math.round(Number(amount.toFixed(exponent)) * (10 ** exponent))
}

/** Format a provider amount using the currency's supported fraction digits. */
export const formatProviderAmount = (amount: number, currency: string) =>
  amount.toFixed(currencyExponent(currency))
