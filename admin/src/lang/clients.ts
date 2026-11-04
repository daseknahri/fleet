import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  en: {
    EYEBROW: 'FLEET & CUSTOMERS',
    TITLE: 'Customers',
    SUBTITLE: 'Customer accounts and contact details for your agency.',
    ADD_CLIENT: 'Add customer',
  },
  fr: {
    EYEBROW: 'FLOTTE & CLIENTS',
    TITLE: 'Clients',
    SUBTITLE: 'Les comptes clients et leurs coordonnées pour votre agence.',
    ADD_CLIENT: 'Ajouter un client',
  },
  es: {
    EYEBROW: 'FLOTA Y CLIENTES',
    TITLE: 'Clientes',
    SUBTITLE: 'Cuentas de clientes y datos de contacto de tu agencia.',
    ADD_CLIENT: 'Añadir cliente',
  },
})

langHelper.setLanguage(strings)

export { strings }
