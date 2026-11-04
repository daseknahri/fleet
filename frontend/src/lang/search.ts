import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    SHOW_FILTERS: 'Afficher les filtres',
    HILE_FILTERS: 'Masquer les filtres',
  },
  ar: { SHOW_FILTERS: 'إظهار الفلاتر', HILE_FILTERS: 'إخفاء الفلاتر' },
  en: {
    SHOW_FILTERS: 'Show Filters',
    HILE_FILTERS: 'Hide Filters',
  },
  es: {
    SHOW_FILTERS: 'Mostrar filtros',
    HILE_FILTERS: 'Ocultar filtros',
  },
})

langHelper.setLanguage(strings)
export { strings }
