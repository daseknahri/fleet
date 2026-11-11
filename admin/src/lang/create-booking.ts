import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    NEW_BOOKING_HEADING: 'Nouvelle réservation',
    AGENT: 'Apporteur',
    AGENT_NONE: 'Aucun apporteur',
    AGENT_MODE: 'Mode de commission (dérogation)',
    AGENT_VALUE: 'Valeur de la commission (dérogation)',
    OVERLAP_EXCEPTION_TITLE: "Conflit de réservation — exception de chevauchement",
    OVERLAP_EXCEPTION_TEXT: "Cette voiture est déjà réservée aux dates choisies. En tant que propriétaire ou gérant, vous pouvez réserver quand même à titre d'exception. Les périodes de maintenance ne peuvent jamais être contournées.",
    OVERLAP_REASON: "Motif de l'exception (obligatoire, 3 à 1000 caractères)",
  },
  en: {
    NEW_BOOKING_HEADING: 'New booking',
    AGENT: 'Referrer (agent)',
    AGENT_NONE: 'No agent',
    AGENT_MODE: 'Commission mode (override)',
    AGENT_VALUE: 'Commission value (override)',
    OVERLAP_EXCEPTION_TITLE: 'Booking conflict — overlap exception',
    OVERLAP_EXCEPTION_TEXT: 'This car is already booked for the selected dates. As an Owner or Manager you may book anyway as an exception. Maintenance periods can never be overridden.',
    OVERLAP_REASON: 'Reason for the exception (required, 3–1000 characters)',
  },
  ar: {
    NEW_BOOKING_HEADING: 'حجز جديد',
    AGENT: 'الوسيط',
    AGENT_NONE: 'بدون وسيط',
    AGENT_MODE: 'طريقة العمولة (تجاوز)',
    AGENT_VALUE: 'قيمة العمولة (تجاوز)',
    OVERLAP_EXCEPTION_TITLE: 'تعارض في الحجز — استثناء التداخل',
    OVERLAP_EXCEPTION_TEXT: 'هذه السيارة محجوزة بالفعل في التواريخ المحددة. بصفتك مالكًا أو مديرًا يمكنك الحجز رغم ذلك على سبيل الاستثناء. لا يمكن تجاوز فترات الصيانة أبدًا.',
    OVERLAP_REASON: 'سبب الاستثناء (إلزامي، من 3 إلى 1000 حرف)',
  },
  es: {
    NEW_BOOKING_HEADING: 'Nueva reserva',
    AGENT: 'Intermediario',
    AGENT_NONE: 'Sin intermediario',
    AGENT_MODE: 'Modo de comisión (anulación)',
    AGENT_VALUE: 'Valor de la comisión (anulación)',
    OVERLAP_EXCEPTION_TITLE: 'Conflicto de reserva — excepción de solapamiento',
    OVERLAP_EXCEPTION_TEXT: 'Este coche ya está reservado en las fechas seleccionadas. Como propietario o gerente, puede reservar de todos modos como excepción. Los periodos de mantenimiento nunca pueden anularse.',
    OVERLAP_REASON: 'Motivo de la excepción (obligatorio, 3–1000 caracteres)',
  },
})

langHelper.setLanguage(strings)
export { strings }
