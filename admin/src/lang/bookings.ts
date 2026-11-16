import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    NEW_BOOKING: 'Nouvelle réservation',
    MONTH_VIEW: 'Mois',
    GRID_VIEW: 'Grille par véhicule',
    PARTIAL_DATA: 'Données partielles : la limite de 10 000 réservations (ou 1 000 véhicules) est atteinte — certaines réservations peuvent manquer.',
  },
  ar: {
    NEW_BOOKING: 'حجز جديد',
    MONTH_VIEW: 'شهر',
    GRID_VIEW: 'شبكة حسب المركبة',
    PARTIAL_DATA: 'بيانات جزئية: تم الوصول إلى حد 10,000 حجز (أو 1,000 مركبة) — قد تكون بعض الحجوزات مفقودة.',
  },
  en: {
    NEW_BOOKING: 'New Booking',
    MONTH_VIEW: 'Month',
    GRID_VIEW: 'Grid by vehicle',
    PARTIAL_DATA: 'Partial data: the 10,000-booking (or 1,000-vehicle) limit was reached — some bookings may be missing.',
  },
  es: {
    NEW_BOOKING: 'Nueva reserva',
    MONTH_VIEW: 'Mes',
    GRID_VIEW: 'Cuadrícula por vehículo',
    PARTIAL_DATA: 'Datos parciales: se alcanzó el límite de 10.000 reservas (o 1.000 vehículos); es posible que falten reservas.',
  },
})

langHelper.setLanguage(strings)
export { strings }
