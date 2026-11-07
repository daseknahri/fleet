import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    TOTAL: 'Total :',
    UPDATE_BOOKING_HEADING: 'Modifier la réservation',
    DELETE_BOOKING: 'Êtes-vous sûr de vouloir supprimer cette réservation ?',
  },
  en: {
    TOTAL: 'Total:',
    UPDATE_BOOKING_HEADING: 'Update booking',
    DELETE_BOOKING: 'Are you sure you want to delete this booking?',
  },
  ar: {
    TOTAL: 'المجموع:',
    UPDATE_BOOKING_HEADING: 'تعديل الحجز',
    DELETE_BOOKING: 'هل تريد حذف هذا الحجز؟',
  },
  es: {
    TOTAL: 'Total:',
    UPDATE_BOOKING_HEADING: 'Actualizar reserva',
    DELETE_BOOKING: '¿Estás seguro de que quieres eliminar esta reserva?',
  },
})

langHelper.setLanguage(strings)
export { strings }
