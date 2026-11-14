import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    SEARCH_PLACEHOLDER: 'Rechercher un contrat, un véhicule, un client…',
    SEARCH_LABEL: 'Recherche globale',
    NO_RESULTS: 'Aucun résultat',
  },
  ar: {
    SEARCH_PLACEHOLDER: 'ابحث عن عقد أو سيارة أو عميل…',
    SEARCH_LABEL: 'بحث شامل',
    NO_RESULTS: 'لا توجد نتائج',
  },
  en: {
    SEARCH_PLACEHOLDER: 'Search a booking, a car, a client…',
    SEARCH_LABEL: 'Global search',
    NO_RESULTS: 'No results',
  },
  es: {
    SEARCH_PLACEHOLDER: 'Buscar una reserva, un coche, un cliente…',
    SEARCH_LABEL: 'Búsqueda global',
    NO_RESULTS: 'Sin resultados',
  },
})

langHelper.setLanguage(strings)
export { strings }
