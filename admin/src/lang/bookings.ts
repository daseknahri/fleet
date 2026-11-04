import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    NEW_BOOKING: 'Nouvelle réservation',
  },
  ar: {
    NEW_BOOKING: 'حجز جديد',
  },
  en: {
    NEW_BOOKING: 'New Booking',
  },
  es: {
    NEW_BOOKING: 'Nueva reserva',
  },
})

langHelper.setLanguage(strings)
export { strings }
