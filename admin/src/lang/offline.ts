import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

// GA-Q4-4 (#54) — honest offline state for the admin app. The banner
// (OfflineBanner.tsx) shows OFFLINE_BANNER while the browser is offline;
// OFFLINE_MUTATION_BLOCKED is toasted when a mutation is blocked offline
// (the shared axios instance dispatches a window event for it — it cannot
// import these strings itself, see axiosInstance.ts); OFFLINE_BACK_ONLINE
// is toasted once when connectivity returns.
const strings = new LocalizedStrings({
  fr: {
    OFFLINE_BANNER: 'Vous êtes hors ligne — les modifications sont suspendues jusqu’au retour de la connexion.',
    OFFLINE_MUTATION_BLOCKED: 'Hors ligne : cette modification n’a pas été enregistrée. Reconnectez-vous puis réessayez.',
    OFFLINE_BACK_ONLINE: 'Connexion rétablie.',
  },
  ar: {
    OFFLINE_BANNER: 'أنت غير متصل بالإنترنت — التعديلات متوقفة مؤقتًا حتى عودة الاتصال.',
    OFFLINE_MUTATION_BLOCKED: 'أنت غير متصل: لم يُحفَظ هذا التعديل. أعد الاتصال ثم حاول مجددًا.',
    OFFLINE_BACK_ONLINE: 'عاد الاتصال.',
  },
  en: {
    OFFLINE_BANNER: 'You are offline — changes are paused until you are back online.',
    OFFLINE_MUTATION_BLOCKED: 'Offline: this change was not saved. Reconnect and try again.',
    OFFLINE_BACK_ONLINE: 'Back online.',
  },
  es: {
    OFFLINE_BANNER: 'Estás sin conexión — los cambios están en pausa hasta que vuelvas a conectarte.',
    OFFLINE_MUTATION_BLOCKED: 'Sin conexión: este cambio no se guardó. Vuelve a conectarte e inténtalo de nuevo.',
    OFFLINE_BACK_ONLINE: 'Conexión restablecida.',
  },
})

langHelper.setLanguage(strings)
export { strings }
