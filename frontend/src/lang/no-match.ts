import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    NO_MATCH: 'Rien à voir ici !', NO_MATCH_SEARCH: 'Votre recherche n’a pas survécu à l’actualisation — pas de souci, recommencez.', START_NEW_SEARCH: 'Lancer une nouvelle recherche',
  },
  en: {
    NO_MATCH: 'Nothing to see here!', NO_MATCH_SEARCH: 'Your search didn’t survive the refresh — no worries, start a new one.', START_NEW_SEARCH: 'Start a new search',
  },
  ar: {
    NO_MATCH: 'لا شيء هنا!', NO_MATCH_SEARCH: 'لم تنجُ عملية البحث من التحديث — لا بأس، ابدأ بحثاً جديداً.', START_NEW_SEARCH: 'بدء بحث جديد',
  },
  es: {
    NO_MATCH: '¡No hay nada que ver aquí!', NO_MATCH_SEARCH: 'Tu búsqueda no sobrevivió a la actualización; no pasa nada, empieza una nueva.', START_NEW_SEARCH: 'Iniciar una nueva búsqueda',
  },
})

langHelper.setLanguage(strings)
export { strings }
