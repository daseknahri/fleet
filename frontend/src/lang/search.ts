import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    SHOW_FILTERS: 'Afficher les filtres',
    SEARCH_HEADING: 'Résultats de recherche',
    HILE_FILTERS: 'Masquer les filtres',
  },
  ar: { SHOW_FILTERS: 'إظهار الفلاتر', HILE_FILTERS: 'إخفاء الفلاتر', SEARCH_HEADING: 'نتائج البحث' },
  en: {
    SHOW_FILTERS: 'Show Filters',
    SEARCH_HEADING: 'Search results',
    HILE_FILTERS: 'Hide Filters',
  },
  es: {
    SHOW_FILTERS: 'Mostrar filtros',
    SEARCH_HEADING: 'Resultados de búsqueda',
    HILE_FILTERS: 'Ocultar filtros',
  },
})

langHelper.setLanguage(strings)
export { strings }
