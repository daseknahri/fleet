import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    PICK_UP_DATE: 'Date de prise en charge',
    DROP_OFF_DATE: 'Date de retour',
    DROP_OFF: 'Restituer au même endroit',
    MIN_PICK_UP_HOURS_ERROR: "L'heure de retrait doit être prévue quelques heures à l'avance",
    MIN_RENTAL_HOURS_ERROR: 'La durée de location est trop courte',
    INVALID_PICK_UP_TIME: 'Heure de prise en charge invalide',
    INVALID_DROP_OFF_TIME: 'Heure de restitution invalide',
    PICK_UP_LOCATION_REQUIRED: 'Veuillez sélectionner un lieu de prise en charge',
    DROP_OFF_LOCATION_REQUIRED: 'Veuillez sélectionner un lieu de restitution',
  },
  ar: { PICK_UP_DATE: 'تاريخ الاستلام', DROP_OFF_DATE: 'تاريخ التسليم', DROP_OFF: 'الإرجاع في نفس الموقع', MIN_PICK_UP_HOURS_ERROR: 'يجب أن يكون موعد الاستلام بعد ساعات قليلة', MIN_RENTAL_HOURS_ERROR: 'مدة الإيجار قصيرة جدًا', INVALID_PICK_UP_TIME: 'وقت استلام غير صالح', INVALID_DROP_OFF_TIME: 'وقت تسليم غير صالح', PICK_UP_LOCATION_REQUIRED: 'يرجى اختيار مكان الاستلام', DROP_OFF_LOCATION_REQUIRED: 'يرجى اختيار مكان التسليم' },
  en: {
    PICK_UP_DATE: 'Pick-up Date',
    DROP_OFF_DATE: 'Drop-off Date',
    DROP_OFF: 'Return to same location',
    MIN_PICK_UP_HOURS_ERROR: 'Pick-up time must be at least a few hours in the future',
    MIN_RENTAL_HOURS_ERROR: 'Rental duration is too short',
    INVALID_PICK_UP_TIME: 'Invalid pick-up time',
    INVALID_DROP_OFF_TIME: 'Invalid drop-off time',
    PICK_UP_LOCATION_REQUIRED: 'Please select a pick-up location',
    DROP_OFF_LOCATION_REQUIRED: 'Please select a drop-off location',
  },
  es: {
    PICK_UP_DATE: 'Fecha de recogida',
    DROP_OFF_DATE: 'Fecha de entrega',
    DROP_OFF: 'Devolución al mismo lugar',
    MIN_PICK_UP_HOURS_ERROR: 'La hora de recogida debe programarse con varias horas de anticipación',
    MIN_RENTAL_HOURS_ERROR: 'La duración del alquiler es demasiado corta',
    INVALID_PICK_UP_TIME: 'Hora de recogida no válida',
    INVALID_DROP_OFF_TIME: 'Hora de devolución no válida',
    PICK_UP_LOCATION_REQUIRED: 'Seleccione un lugar de recogida',
    DROP_OFF_LOCATION_REQUIRED: 'Seleccione un lugar de devolución',
  },
})

langHelper.setLanguage(strings)
export { strings }
