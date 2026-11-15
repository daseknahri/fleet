import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    SHOW_FILTERS: 'Afficher les filtres',
    SEARCH_HEADING: 'Résultats de recherche',
    HILE_FILTERS: 'Masquer les filtres',
    FETCH_SUPPLIERS_ERROR: 'Échec de la récupération des fournisseurs',
  },
  ar: { SHOW_FILTERS: 'إظهار الفلاتر', HILE_FILTERS: 'إخفاء الفلاتر', SEARCH_HEADING: 'نتائج البحث', FETCH_SUPPLIERS_ERROR: 'تعذّر جلب المورّدين' },
  en: {
    SHOW_FILTERS: 'Show Filters',
    SEARCH_HEADING: 'Search results',
    HILE_FILTERS: 'Hide Filters',
    FETCH_SUPPLIERS_ERROR: 'Failed to fetch suppliers',
  },
  es: {
    SHOW_FILTERS: 'Mostrar filtros',
    SEARCH_HEADING: 'Resultados de búsqueda',
    HILE_FILTERS: 'Ocultar filtros',
    FETCH_SUPPLIERS_ERROR: 'Error al cargar los proveedores',
  },
})

langHelper.setLanguage(strings)
export { strings }
