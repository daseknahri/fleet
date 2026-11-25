import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    TOTAL: 'Total :',
    BALANCE_DUE_AT_PICKUP: 'Montant dû à la prise en charge : {amount}',
    BALANCE_NOTHING_DUE: 'Rien à payer à la prise en charge — entièrement payé.'
  },
  en: {
    TOTAL: 'Total:',
    BALANCE_DUE_AT_PICKUP: 'Amount due at pickup: {amount}',
    BALANCE_NOTHING_DUE: 'Nothing due at pickup — fully paid.'
  },
  ar: {
    TOTAL: 'المجموع:',
    BALANCE_DUE_AT_PICKUP: 'المبلغ المستحق عند الاستلام: {amount}',
    BALANCE_NOTHING_DUE: 'لا شيء مستحق عند الاستلام — مدفوع بالكامل.'
  },
  es: {
    TOTAL: 'Total:',
    BALANCE_DUE_AT_PICKUP: 'Importe a pagar al recoger: {amount}',
    BALANCE_NOTHING_DUE: 'Nada que pagar al recoger — totalmente pagado.'
  },
})

langHelper.setLanguage(strings)
export { strings }
