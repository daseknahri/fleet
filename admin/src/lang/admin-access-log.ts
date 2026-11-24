import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    TITLE: 'Journal des accès admin', SUBTITLE: 'Chaque accès d’un administrateur plateforme aux données d’une agence : qui a agi, dans quelle agence, pour quoi, et quand. Les lectures globales (aucune agence nommée) s’affichent comme « Globale ».', LOADING: 'Chargement du journal…', ERROR: 'Le journal n’a pas pu être chargé.', EMPTY: 'Aucun accès enregistré pour le moment.', REFRESH: 'Actualiser', APPLY: 'Appliquer les filtres', CLEAR: 'Effacer', AGENCY: 'Agence', AGENCY_ALL: 'Toutes les agences', AGENCY_PLATFORM_WIDE: 'Globale (aucune agence)', ACTOR: 'Acteur', ACTOR_PLACEHOLDER: 'Identifiant de l’administrateur', ACTION: 'Action', ACTION_PLACEHOLDER: 'p. ex. car: ou agency:readExpenses', DATE: 'Date', METHOD: 'Méthode', PATH: 'Chemin', PLATFORM_WIDE: 'Globale', PREV: 'Précédent', NEXT: 'Suivant', PAGE: 'Page', OF: 'sur',
  },
  ar: {
    TITLE: 'سجل وصول المسؤول', SUBTITLE: 'كل وصول لمسؤول المنصة إلى بيانات وكالة: من قام بالإجراء، وفي أي وكالة، وماذا فعل، ومتى. تظهر القراءات العامة (بدون وكالة محددة) كـ "عام".', LOADING: 'جار تحميل السجل…', ERROR: 'تعذر تحميل السجل.', EMPTY: 'لا يوجد وصول مسجل بعد.', REFRESH: 'تحديث', APPLY: 'تطبيق عوامل التصفية', CLEAR: 'مسح', AGENCY: 'الوكالة', AGENCY_ALL: 'كل الوكالات', AGENCY_PLATFORM_WIDE: 'عام (بدون وكالة)', ACTOR: 'الفاعل', ACTOR_PLACEHOLDER: 'معرف المسؤول', ACTION: 'الإجراء', ACTION_PLACEHOLDER: 'مثال: car: أو agency:readExpenses', DATE: 'التاريخ', METHOD: 'الطريقة', PATH: 'المسار', PLATFORM_WIDE: 'عام', PREV: 'السابق', NEXT: 'التالي', PAGE: 'الصفحة', OF: 'من',
  },
  en: {
    TITLE: 'Admin access log', SUBTITLE: 'Every platform-admin access to agency data: who acted, in which agency, doing what, and when. Platform-wide reads (no agency named) show as "Platform-wide".', LOADING: 'Loading access log…', ERROR: 'The access log could not be loaded.', EMPTY: 'No access recorded yet.', REFRESH: 'Refresh', APPLY: 'Apply filters', CLEAR: 'Clear', AGENCY: 'Agency', AGENCY_ALL: 'All agencies', AGENCY_PLATFORM_WIDE: 'Platform-wide (no agency)', ACTOR: 'Actor', ACTOR_PLACEHOLDER: 'Admin user id', ACTION: 'Action', ACTION_PLACEHOLDER: 'e.g. car: or agency:readExpenses', DATE: 'Date', METHOD: 'Method', PATH: 'Path', PLATFORM_WIDE: 'Platform-wide', PREV: 'Previous', NEXT: 'Next', PAGE: 'Page', OF: 'of',
  },
  es: {
    TITLE: 'Registro de acceso de admin', SUBTITLE: 'Cada acceso de un administrador de la plataforma a los datos de una agencia: quién actuó, en qué agencia, qué hizo y cuándo. Las lecturas globales (sin agencia indicada) se muestran como "Global".', LOADING: 'Cargando registro…', ERROR: 'No se pudo cargar el registro.', EMPTY: 'Aún no hay accesos registrados.', REFRESH: 'Actualizar', APPLY: 'Aplicar filtros', CLEAR: 'Limpiar', AGENCY: 'Agencia', AGENCY_ALL: 'Todas las agencias', AGENCY_PLATFORM_WIDE: 'Global (sin agencia)', ACTOR: 'Actor', ACTOR_PLACEHOLDER: 'ID del administrador', ACTION: 'Acción', ACTION_PLACEHOLDER: 'p. ej. car: o agency:readExpenses', DATE: 'Fecha', METHOD: 'Método', PATH: 'Ruta', PLATFORM_WIDE: 'Global', PREV: 'Anterior', NEXT: 'Siguiente', PAGE: 'Página', OF: 'de',
  },
})

langHelper.setLanguage(strings)
export { strings }
