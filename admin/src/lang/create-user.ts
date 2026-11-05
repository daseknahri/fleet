import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    CREATE_USER_HEADING: 'Nouvelle utilisateur',
    CREATE_CLIENT_HEADING: 'Nouveau client',
    BIRTH_DATE: 'Date de naissance',
  },
  en: {
    CREATE_USER_HEADING: 'New user',
    CREATE_CLIENT_HEADING: 'New customer',
    BIRTH_DATE: 'Birth date',
  },
  ar: {
    CREATE_USER_HEADING: 'مستخدم جديد',
    CREATE_CLIENT_HEADING: 'عميل جديد',
    BIRTH_DATE: 'تاريخ الميلاد',
  },
  es: {
    CREATE_USER_HEADING: 'Nuevo usuario',
    CREATE_CLIENT_HEADING: 'Nuevo cliente',
    BIRTH_DATE: 'Fecha de nacimiento',
  },
})

langHelper.setLanguage(strings)
export { strings }
