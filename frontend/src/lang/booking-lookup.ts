import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    TITLE: 'Retrouver votre réservation',
    REFERENCE: 'Référence de réservation',
    EMAIL: 'E-mail utilisé pour la réservation',
    SUBMIT: 'Trouver la réservation',
    LOOKUP_NOT_FOUND: 'Aucune réservation trouvée pour cette référence et cet e-mail. Vérifiez les deux et réessayez.',
  },
  en: {
    TITLE: 'Find your booking',
    REFERENCE: 'Booking reference',
    EMAIL: 'Email used for the booking',
    SUBMIT: 'Find booking',
    LOOKUP_NOT_FOUND: 'No booking found for this reference and email. Check both and try again.',
  },
  ar: {
    TITLE: 'ابحث عن حجزك',
    REFERENCE: 'مرجع الحجز',
    EMAIL: 'البريد الإلكتروني المستخدم للحجز',
    SUBMIT: 'ابحث عن الحجز',
    LOOKUP_NOT_FOUND: 'لم يتم العثور على حجز بهذا المرجع وهذا البريد الإلكتروني. تحقق منهما وحاول مرة أخرى.',
  },
  es: {
    TITLE: 'Buscar su reserva',
    REFERENCE: 'Referencia de reserva',
    EMAIL: 'Correo usado para la reserva',
    SUBMIT: 'Buscar reserva',
    LOOKUP_NOT_FOUND: 'No se encontró ninguna reserva con esa referencia y ese correo. Compruebe ambos e inténtelo de nuevo.',
  },
})

langHelper.setLanguage(strings)
export { strings }
