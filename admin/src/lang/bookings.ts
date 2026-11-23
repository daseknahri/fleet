import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    NEW_BOOKING: 'Nouvelle réservation', HELP_BOOKINGS: 'Toutes les réservations : créez-en une nouvelle, filtrez par agence, statut ou dates. Cliquez sur une réservation pour ouvrir son contrat.',
    MONTH_VIEW: 'Mois',
    GRID_VIEW: 'Grille par véhicule',
    PARTIAL_DATA: 'Données partielles : la limite de 10 000 réservations (ou 1 000 véhicules) est atteinte — certaines réservations peuvent manquer.',
  },
  ar: {
    NEW_BOOKING: 'حجز جديد', HELP_BOOKINGS: 'جميع الحجوزات: أنشئ حجزًا جديدًا، وصفِّ حسب الوكالة أو الحالة أو التواريخ. انقر على حجز لفتح عقده.',
    MONTH_VIEW: 'شهر',
    GRID_VIEW: 'شبكة حسب المركبة',
    PARTIAL_DATA: 'بيانات جزئية: تم الوصول إلى حد 10,000 حجز (أو 1,000 مركبة) — قد تكون بعض الحجوزات مفقودة.',
  },
  en: {
    NEW_BOOKING: 'New Booking', HELP_BOOKINGS: 'All reservations: create a new one, filter by agency, status or dates. Click a reservation to open its contract.',
    MONTH_VIEW: 'Month',
    GRID_VIEW: 'Grid by vehicle',
    PARTIAL_DATA: 'Partial data: the 10,000-booking (or 1,000-vehicle) limit was reached — some bookings may be missing.',
  },
  es: {
    NEW_BOOKING: 'Nueva reserva', HELP_BOOKINGS: 'Todas las reservas: cree una nueva, filtre por agencia, estado o fechas. Haga clic en una reserva para abrir su contrato.',
    MONTH_VIEW: 'Mes',
    GRID_VIEW: 'Cuadrícula por vehículo',
    PARTIAL_DATA: 'Datos parciales: se alcanzó el límite de 10.000 reservas (o 1.000 vehículos); es posible que falten reservas.',
  },
})

langHelper.setLanguage(strings)
export { strings }
