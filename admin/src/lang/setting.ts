import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    SETTINGS: 'Paramètres de location',
    MIN_PICKUP_HOURS: 'Délai minimum requis en heures avant le retrait',
    MIN_RENTAL_HOURS: 'Durée minimale de location en heures entre le retrait et le retour',
    MIN_PICKUP_DROPOFF_HOUR: 'Heure minimale autorisée pour le retrait et le retour (par ex. 9 pour 09:00)',
    MAX_PICKUP_DROPOFF_HOUR: 'Heure maximale autorisée pour le retrait et le retour (par ex. 19 pour 19:00)',
    RETURN_SETTINGS: 'Tarifs de retour et de règlement',
    INCLUDED_KM_PER_DAY: 'Kilomètres inclus par jour (vide = illimité)',
    EXTRA_KM_PRICE: 'Prix par kilomètre supplémentaire',
    FUEL_PRICE_PER_LITRE: 'Prix du carburant par litre',
    WASH_FEE: 'Frais de lavage',
    DEFAULT_DEPOSIT: 'Caution par défaut',
    RETURN_SETTINGS_SAVED: 'Tarifs de retour enregistrés.',
  },
  en: {
    SETTINGS: 'Rental Settings',
    MIN_PICKUP_HOURS: 'Minimum required time in hours before pick-up',
    MIN_RENTAL_HOURS: 'Minimum rental duration in hours between pick up and drop off',
    MIN_PICKUP_DROPOFF_HOUR: 'Minimum allowed hour for pickup and drop-off (e.g., 9 for 09:00)',
    MAX_PICKUP_DROPOFF_HOUR: 'Maximum allowed hour for pickup and drop-off (e.g., 19 for 19:00)',
    RETURN_SETTINGS: 'Return & settlement rates',
    INCLUDED_KM_PER_DAY: 'Included kilometres per day (empty = unlimited)',
    EXTRA_KM_PRICE: 'Price per extra kilometre',
    FUEL_PRICE_PER_LITRE: 'Fuel price per litre',
    WASH_FEE: 'Wash fee',
    DEFAULT_DEPOSIT: 'Default deposit',
    RETURN_SETTINGS_SAVED: 'Return rates saved.',
  },
  ar: {
    SETTINGS: 'إعدادات التأجير',
    MIN_PICKUP_HOURS: 'الحد الأدنى من الوقت المطلوب بالساعات قبل الاستلام',
    MIN_RENTAL_HOURS: 'الحد الأدنى لمدة التأجير بالساعات بين الاستلام والتسليم',
    MIN_PICKUP_DROPOFF_HOUR: 'الحد الأدنى للساعة المسموح بها للاستلام والتسليم (مثال: 9 لـ 09:00)',
    MAX_PICKUP_DROPOFF_HOUR: 'الحد الأقصى للساعة المسموح بها للاستلام والتسليم (مثال: 19 لـ 19:00)',
    RETURN_SETTINGS: 'أسعار الإرجاع والتسوية',
    INCLUDED_KM_PER_DAY: 'الكيلومترات المشمولة في اليوم (فارغ = غير محدود)',
    EXTRA_KM_PRICE: 'سعر الكيلومتر الإضافي',
    FUEL_PRICE_PER_LITRE: 'سعر الوقود لكل لتر',
    WASH_FEE: 'رسوم الغسيل',
    DEFAULT_DEPOSIT: 'الضمان الافتراضي',
    RETURN_SETTINGS_SAVED: 'تم حفظ أسعار الإرجاع.',
  },
  es: {
    SETTINGS: 'Configuración del alquiler',
    MIN_PICKUP_HOURS: 'Tiempo mínimo requerido en horas antes del retiro',
    MIN_RENTAL_HOURS: 'Duración mínima del alquiler en horas entre el retiro y la devolución',
    MIN_PICKUP_DROPOFF_HOUR: 'Hora mínima permitida para el retiro y la devolución (por ej. 9 para las 09:00)',
    MAX_PICKUP_DROPOFF_HOUR: 'Hora máxima permitida para el retiro y la devolución (por ej. 19 para las 19:00)',
    RETURN_SETTINGS: 'Tarifas de devolución y liquidación',
    INCLUDED_KM_PER_DAY: 'Kilómetros incluidos por día (vacío = ilimitado)',
    EXTRA_KM_PRICE: 'Precio por kilómetro extra',
    FUEL_PRICE_PER_LITRE: 'Precio del combustible por litro',
    WASH_FEE: 'Cargo por lavado',
    DEFAULT_DEPOSIT: 'Depósito predeterminado',
    RETURN_SETTINGS_SAVED: 'Tarifas de devolución guardadas.',
  },
})

langHelper.setLanguage(strings)
export { strings }
