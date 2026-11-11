import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    SETTINGS_UPDATED: 'Paramètres modifiés avec succès.',
    NETWORK_SETTINGS: 'Paramètres Réseau',
    SETTINGS_EMAIL_NOTIFICATIONS: 'Activer les notifications par email',
    SETTINGS_EMAIL_RETURNS_DUE: 'Retours à échéance',
    SETTINGS_EMAIL_CAR_DUE_DATES: 'Échéances des voitures (huile, assurance, visite)',
    SETTINGS_EMAIL_SIGNED_CONTRACTS: 'Contrats signés en ligne',
    SETTINGS_EMAIL_WEEKLY_RECAP: 'Récapitulatif hebdomadaire',
    SETTINGS_EMAIL_TIPS: 'Conseils',
    SETTINGS_EMAIL_NEWS: 'Actualités',
  },
  en: {
    SETTINGS_UPDATED: 'Settings updated successfully.',
    NETWORK_SETTINGS: 'Network settings',
    SETTINGS_EMAIL_NOTIFICATIONS: 'Enable email notifications',
    SETTINGS_EMAIL_RETURNS_DUE: 'Returns due',
    SETTINGS_EMAIL_CAR_DUE_DATES: 'Car due dates (oil, insurance, visite)',
    SETTINGS_EMAIL_SIGNED_CONTRACTS: 'Signed contracts',
    SETTINGS_EMAIL_WEEKLY_RECAP: 'Weekly recap',
    SETTINGS_EMAIL_TIPS: 'Tips',
    SETTINGS_EMAIL_NEWS: 'News',
  },
  ar: {
    SETTINGS_UPDATED: 'تم تحديث الإعدادات بنجاح.',
    NETWORK_SETTINGS: 'إعدادات الشبكة',
    SETTINGS_EMAIL_NOTIFICATIONS: 'تفعيل الإشعارات عبر البريد الإلكتروني',
    SETTINGS_EMAIL_RETURNS_DUE: 'المرتجعات المستحقة',
    SETTINGS_EMAIL_CAR_DUE_DATES: 'مواعيد استحقاق السيارات (الزيت، التأمين، الفحص)',
    SETTINGS_EMAIL_SIGNED_CONTRACTS: 'العقود الموقعة عبر الإنترنت',
    SETTINGS_EMAIL_WEEKLY_RECAP: 'الملخص الأسبوعي',
    SETTINGS_EMAIL_TIPS: 'نصائح',
    SETTINGS_EMAIL_NEWS: 'الأخبار',
  },
  es: {
    SETTINGS_UPDATED: 'Configuración actualizada correctamente.',
    NETWORK_SETTINGS: 'Configuración de red',
    SETTINGS_EMAIL_NOTIFICATIONS: 'Habilitar notificaciones por correo electrónico',
    SETTINGS_EMAIL_RETURNS_DUE: 'Devoluciones vencidas',
    SETTINGS_EMAIL_CAR_DUE_DATES: 'Vencimientos del coche (aceite, seguro, inspección)',
    SETTINGS_EMAIL_SIGNED_CONTRACTS: 'Contratos firmados en línea',
    SETTINGS_EMAIL_WEEKLY_RECAP: 'Resumen semanal',
    SETTINGS_EMAIL_TIPS: 'Consejos',
    SETTINGS_EMAIL_NEWS: 'Noticias',
  },
})

langHelper.setLanguage(strings)
export { strings }
