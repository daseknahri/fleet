import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  en: {
    EYEBROW: 'FLEET & CUSTOMERS',
    TITLE: 'Customers',
    SUBTITLE: 'Customer accounts and contact details for your agency.',
    ADD_CLIENT: 'Add customer',
    // F5b (W2-04): client-list filters.
    FILTER_STATUS: 'Status',
    FILTER_TYPE: 'Type',
    FILTER_ALL: 'All',
    FILTER_MISSING_DOCS: 'Missing documents',
    FILTER_HAS_CONTRACTS: 'Has contracts',
    FILTER_CLEAR: 'Clear filters',
  },
  fr: {
    EYEBROW: 'FLOTTE & CLIENTS',
    TITLE: 'Clients',
    SUBTITLE: 'Les comptes clients et leurs coordonnées pour votre agence.',
    ADD_CLIENT: 'Ajouter un client',
    FILTER_STATUS: 'Statut',
    FILTER_TYPE: 'Type',
    FILTER_ALL: 'Tous',
    FILTER_MISSING_DOCS: 'Documents manquants',
    FILTER_HAS_CONTRACTS: 'Avec contrats',
    FILTER_CLEAR: 'Effacer les filtres',
  },
  ar: {
    EYEBROW: 'الأسطول والعملاء',
    TITLE: 'العملاء',
    SUBTITLE: 'حسابات العملاء وبيانات الاتصال الخاصة بوكالتك.',
    ADD_CLIENT: 'إضافة عميل',
    FILTER_STATUS: 'الحالة',
    FILTER_TYPE: 'النوع',
    FILTER_ALL: 'الكل',
    FILTER_MISSING_DOCS: 'مستندات ناقصة',
    FILTER_HAS_CONTRACTS: 'لديه عقود',
    FILTER_CLEAR: 'مسح عوامل التصفية',
  },
  es: {
    EYEBROW: 'FLOTA Y CLIENTES',
    TITLE: 'Clientes',
    SUBTITLE: 'Cuentas de clientes y datos de contacto de tu agencia.',
    ADD_CLIENT: 'Añadir cliente',
    FILTER_STATUS: 'Estado',
    FILTER_TYPE: 'Tipo',
    FILTER_ALL: 'Todos',
    FILTER_MISSING_DOCS: 'Documentos faltantes',
    FILTER_HAS_CONTRACTS: 'Con contratos',
    FILTER_CLEAR: 'Limpiar filtros',
  },
})

langHelper.setLanguage(strings)

export { strings }
