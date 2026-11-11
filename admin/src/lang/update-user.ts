import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    UPDATE_USER_HEADING: "Modification de l'utilisateur",
    IDENTITY_HEADING: 'Identité du client',
  },
  en: {
    UPDATE_USER_HEADING: 'User update',
    IDENTITY_HEADING: 'Client identity',
  },
  ar: {
    UPDATE_USER_HEADING: 'تعديل المستخدم',
    IDENTITY_HEADING: 'هوية العميل',
  },
  es: {
    UPDATE_USER_HEADING: 'Actualización del usuario',
    IDENTITY_HEADING: 'Identidad del cliente',
  },
})

langHelper.setLanguage(strings)
export { strings }
