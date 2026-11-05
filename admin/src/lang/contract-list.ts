import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    TITLE: 'Contrats',
  },
  en: {
    TITLE: 'Contracts',
  },
  ar: {
    TITLE: 'العقود',
  },
  es: {
    TITLE: 'Contratos',
  }
})

langHelper.setLanguage(strings)
export { strings }
