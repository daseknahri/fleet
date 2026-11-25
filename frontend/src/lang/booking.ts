import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    TOTAL: 'Total :',
    BALANCE_DUE_AT_PICKUP: 'Montant dû à la prise en charge : {amount}',
    BALANCE_NOTHING_DUE: 'Rien à payer à la prise en charge — entièrement payé.', INVOICE_VIEW: 'Voir / télécharger la facture (PDF)', INVOICE_PENDING: 'Votre facture sera disponible ici une fois émise.',
    HOLD_EXPIRES: 'Confirmer et payer avant le'
  },
  en: {
    TOTAL: 'Total:',
    BALANCE_DUE_AT_PICKUP: 'Amount due at pickup: {amount}',
    BALANCE_NOTHING_DUE: 'Nothing due at pickup — fully paid.', INVOICE_VIEW: 'View / download invoice (PDF)', INVOICE_PENDING: 'Your invoice will be available here once it is issued.',
    HOLD_EXPIRES: 'Confirm and pay before'
  },
  ar: {
    TOTAL: 'المجموع:',
    BALANCE_DUE_AT_PICKUP: 'المبلغ المستحق عند الاستلام: {amount}',
    BALANCE_NOTHING_DUE: 'لا شيء مستحق عند الاستلام — مدفوع بالكامل.', INVOICE_VIEW: 'عرض / تنزيل الفاتورة (PDF)', INVOICE_PENDING: 'ستكون فاتورتك متاحة هنا بمجرد إصدارها.',
    HOLD_EXPIRES: 'أكّد وادفع قبل'
  },
  es: {
    TOTAL: 'Total:',
    BALANCE_DUE_AT_PICKUP: 'Importe a pagar al recoger: {amount}',
    BALANCE_NOTHING_DUE: 'Nada que pagar al recoger — totalmente pagado.', INVOICE_VIEW: 'Ver / descargar la factura (PDF)', INVOICE_PENDING: 'Su factura estará disponible aquí una vez emitida.',
    HOLD_EXPIRES: 'Confirme y pague antes del'
  },
})

langHelper.setLanguage(strings)
export { strings }
