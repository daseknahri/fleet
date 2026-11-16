import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    NEW_BOOKING: 'Nouvelle réservation',
    MONTH_VIEW: 'Mois',
    GRID_VIEW: 'Grille par véhicule',
  },
  ar: {
    NEW_BOOKING: 'حجز جديد',
    MONTH_VIEW: 'شهر',
    GRID_VIEW: 'شبكة حسب المركبة',
  },
  en: {
    NEW_BOOKING: 'New Booking',
    MONTH_VIEW: 'Month',
    GRID_VIEW: 'Grid by vehicle',
  },
  es: {
    NEW_BOOKING: 'Nueva reserva',
    MONTH_VIEW: 'Mes',
    GRID_VIEW: 'Cuadrícula por vehículo',
  },
})

langHelper.setLanguage(strings)
export { strings }
