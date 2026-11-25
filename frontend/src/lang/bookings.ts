import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    NEW_BOOKING: 'Nouvelle réservation',
    BALANCE_OUTSTANDING: 'Reste dû sur {count} réservation(s) : {amount} {currency}.',
    BALANCE_OVERDUE: '{amount} {currency} en retard.'
  },
  en: {
    NEW_BOOKING: 'New Booking',
    BALANCE_OUTSTANDING: 'Outstanding across {count} booking(s): {amount} {currency}.',
    BALANCE_OVERDUE: '{amount} {currency} overdue.'
  },
  ar: {
    NEW_BOOKING: 'حجز جديد',
    BALANCE_OUTSTANDING: 'المبلغ المستحق على {count} حجز: {amount} {currency}.',
    BALANCE_OVERDUE: '{amount} {currency} متأخر.'
  },
  es: {
    NEW_BOOKING: 'Nueva reserva',
    BALANCE_OUTSTANDING: 'Pendiente en {count} reserva(s): {amount} {currency}.',
    BALANCE_OVERDUE: '{amount} {currency} vencido.'
  },
})

langHelper.setLanguage(strings)
export { strings }
