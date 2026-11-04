import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    NEW_USER: 'Nouvel utilisateur',
  },
  ar: {
    NEW_USER: 'مستخدم جديد',
  },
  en: {
    NEW_USER: 'New user',
  },
  es: {
    NEW_USER: 'Nuevo usuario',
  },
})

langHelper.setLanguage(strings)
export { strings }
