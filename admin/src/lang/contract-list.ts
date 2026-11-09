import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    TITLE: 'Contrats',
    UPLOAD_CONTRACT: 'Charger un contrat',
    DELETE_CONTRACT: 'Supprimer le contrat',
  },
  en: {
    TITLE: 'Contracts',
    UPLOAD_CONTRACT: 'Upload contract',
    DELETE_CONTRACT: 'Delete contract',
  },
  ar: {
    TITLE: 'العقود',
    UPLOAD_CONTRACT: 'رفع عقد',
    DELETE_CONTRACT: 'حذف العقد',
  },
  es: {
    TITLE: 'Contratos',
    UPLOAD_CONTRACT: 'Subir contrato',
    DELETE_CONTRACT: 'Eliminar contrato',
  }
})

langHelper.setLanguage(strings)
export { strings }
