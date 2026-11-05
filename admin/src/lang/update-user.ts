import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    UPDATE_USER_HEADING: "Modification de l'utilisateur",
  },
  en: {
    UPDATE_USER_HEADING: 'User update',
  },
  ar: {
    UPDATE_USER_HEADING: 'تعديل المستخدم',
  },
  es: {
    UPDATE_USER_HEADING: 'Actualización del usuario',
  },
})

langHelper.setLanguage(strings)
export { strings }
