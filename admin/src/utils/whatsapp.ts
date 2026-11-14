/**
 * GA-PAR-23 — WhatsApp send actions.
 *
 * Pure helpers for the wa.me deep-link actions (invoice send, contract send).
 * This matches the level the competitor implements: a deep link that opens
 * WhatsApp with prefilled text. There is NO WhatsApp API integration here —
 * no new env vars, no new dependencies, no backend calls. The operator's
 * own WhatsApp (web/app) sends the message; nothing is sent by the product.
 *
 * Phone numbers are never fabricated: when the stored client phone is
 * missing or cannot be normalised to a plausible international digit
 * string, the helpers return null and the caller renders the action
 * disabled with the WA_NO_PHONE tooltip.
 */

/** Normalise a stored client phone to the digit string wa.me expects. */
export const normalizeWhatsAppPhone = (raw: string | undefined | null): string | null => {
  if (!raw || typeof raw !== 'string') {
    return null
  }
  let digits = raw.trim()
  if (!digits) {
    return null
  }
  if (digits.startsWith('+')) {
    digits = digits.slice(1)
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2)
  }
  digits = digits.replace(/\D/g, '')
  // Moroccan national format (06/07…) → international (212…).
  if (digits.startsWith('0')) {
    digits = `212${digits.slice(1)}`
  }
  if (!/^\d{9,15}$/.test(digits)) {
    return null
  }
  return digits
}

/** Replace {key} placeholders in a localised template string. */
export const formatTemplate = (template: string, values: Record<string, string>): string => (
  template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? '')
)

/** Build the wa.me deep link for a phone + prefilled message, or null. */
export const buildWhatsAppUrl = (phone: string | undefined | null, message: string): string | null => {
  const digits = normalizeWhatsAppPhone(phone)
  if (!digits || !message) {
    return null
  }
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

export interface InvoiceWhatsAppInput {
  phone?: string | null
  template: string
  clientName: string
  agencyName: string
  invoiceNumber: string
  amountText: string
  currency: string
}

export const invoiceWhatsAppUrl = (input: InvoiceWhatsAppInput): string | null => {
  const message = formatTemplate(input.template, {
    client: input.clientName,
    agency: input.agencyName,
    number: input.invoiceNumber,
    amount: input.amountText,
    currency: input.currency,
  })
  return buildWhatsAppUrl(input.phone, message)
}

export interface ContractWhatsAppInput {
  phone?: string | null
  template: string
  clientName: string
  reference: string
  carLabel: string
  fromText: string
  toText: string
  agencyName: string
}

export const contractWhatsAppUrl = (input: ContractWhatsAppInput): string | null => {
  const message = formatTemplate(input.template, {
    client: input.clientName,
    reference: input.reference,
    car: input.carLabel,
    from: input.fromText,
    to: input.toText,
    agency: input.agencyName,
  })
  return buildWhatsAppUrl(input.phone, message)
}
