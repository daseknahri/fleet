import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  en: {
    EYEBROW: 'FINANCE', TITLE: 'Cash journal', SUBTITLE: 'Review recorded contract payments and vehicle expenses in one timeline.',
    INCOME: 'Recorded income', EXPENSES: 'Recorded expenses', NET: 'Net movement', ENTRIES: 'Entries',
    SEARCH: 'Search client, vehicle, contract, or reason', FROM: 'From', TO: 'To', DATE: 'Date', TYPE: 'Type',
    REASON: 'Reason', CONTEXT: 'Contract / vehicle', METHOD: 'Method', AMOUNT: 'Amount', PAYMENT: 'Contract payment',
    MAINTENANCE: 'Vehicle expense', CASH: 'Cash', BANK: 'Bank transfer', CARD: 'Card', OTHER: 'Other',
    EMPTY: 'No journal entries match these filters.', LOAD_ERROR: 'Could not load journal entries.',
    INCOMING: 'Income', OUTGOING: 'Expense', OPEN_SESSION: 'Open cash session', CLOSE_SESSION: 'Close session', OPENING_BALANCE: 'Opening balance', COUNTED_BALANCE: 'Counted balance', SESSION_OPEN: 'Session open', SESSION_CLOSED: 'Session closed', NO_SESSION: 'No open cash session', SESSION_ERROR: 'Could not update the cash session.', SAVE: 'Save', CANCEL: 'Cancel', CLOSE_NOTE: 'Closing note', EXPECTED: 'Expected', DISCREPANCY: 'Discrepancy', ADD_MOVEMENT: 'Add movement', DIRECTION: 'Direction', REFERENCE: 'Reference', NOTE: 'Note', MANUAL_MOVEMENT: 'Manual movement', TRANSFER: 'Transfer', AGENCY: 'Agency', ALL_AGENCIES: 'All agencies', AGENCY_REQUIRED: 'Select an agency before changing cash sessions.',
  },
  fr: {
    EYEBROW: 'FINANCE', TITLE: 'Journal de caisse', SUBTITLE: 'Consultez les paiements de contrats et les dépenses véhicules dans une chronologie.',
    INCOME: 'Recettes enregistrées', EXPENSES: 'Dépenses enregistrées', NET: 'Solde des mouvements', ENTRIES: 'Écritures',
    SEARCH: 'Rechercher client, véhicule, contrat ou motif', FROM: 'Du', TO: 'Au', DATE: 'Date', TYPE: 'Type',
    REASON: 'Motif', CONTEXT: 'Contrat / véhicule', METHOD: 'Mode', AMOUNT: 'Montant', PAYMENT: 'Paiement contrat',
    MAINTENANCE: 'Dépense véhicule', CASH: 'Espèces', BANK: 'Virement bancaire', CARD: 'Carte', OTHER: 'Autre',
    EMPTY: 'Aucune écriture ne correspond aux filtres.', LOAD_ERROR: 'Impossible de charger le journal.',
    INCOMING: 'Recette', OUTGOING: 'Dépense', OPEN_SESSION: 'Ouvrir une session de caisse', CLOSE_SESSION: 'Clôturer la session', OPENING_BALANCE: 'Solde d’ouverture', COUNTED_BALANCE: 'Solde compté', SESSION_OPEN: 'Session ouverte', SESSION_CLOSED: 'Session clôturée', NO_SESSION: 'Aucune session ouverte', SESSION_ERROR: 'Impossible de mettre à jour la caisse.', SAVE: 'Enregistrer', CANCEL: 'Annuler', CLOSE_NOTE: 'Note de clôture', EXPECTED: 'Attendu', DISCREPANCY: 'Écart', ADD_MOVEMENT: 'Ajouter un mouvement', DIRECTION: 'Sens', REFERENCE: 'Référence', NOTE: 'Note', MANUAL_MOVEMENT: 'Mouvement manuel', TRANSFER: 'Virement interne', AGENCY: 'Agence', ALL_AGENCIES: 'Toutes les agences', AGENCY_REQUIRED: 'Sélectionnez une agence avant de modifier la caisse.',
  },
  es: {
    EYEBROW: 'FINANZAS', TITLE: 'Libro de caja', SUBTITLE: 'Consulta pagos de contratos y gastos de vehículos en una cronología.',
    INCOME: 'Ingresos registrados', EXPENSES: 'Gastos registrados', NET: 'Movimiento neto', ENTRIES: 'Asientos',
    SEARCH: 'Buscar cliente, vehículo, contrato o motivo', FROM: 'Desde', TO: 'Hasta', DATE: 'Fecha', TYPE: 'Tipo',
    REASON: 'Motivo', CONTEXT: 'Contrato / vehículo', METHOD: 'Método', AMOUNT: 'Importe', PAYMENT: 'Pago de contrato',
    MAINTENANCE: 'Gasto del vehículo', CASH: 'Efectivo', BANK: 'Transferencia bancaria', CARD: 'Tarjeta', OTHER: 'Otro',
    EMPTY: 'No hay asientos que coincidan con estos filtros.', LOAD_ERROR: 'No se pudo cargar el libro de caja.',
    INCOMING: 'Ingreso', OUTGOING: 'Gasto',
  },
  ar: {
    EYEBROW: 'المالية', TITLE: 'دفتر الصندوق', SUBTITLE: 'راجع الحركات وافتح جلسات الصندوق وأغلقها مع توثيق الفروقات.',
    INCOME: 'المداخيل المسجلة', EXPENSES: 'المصاريف المسجلة', NET: 'صافي الحركة', ENTRIES: 'القيود', SEARCH: 'البحث عن عميل أو مركبة أو عقد أو سبب', FROM: 'من', TO: 'إلى', DATE: 'التاريخ', TYPE: 'النوع', REASON: 'السبب', CONTEXT: 'العقد / المركبة', METHOD: 'الطريقة', AMOUNT: 'المبلغ', PAYMENT: 'دفعة العقد', MAINTENANCE: 'مصروف المركبة', CASH: 'نقداً', BANK: 'تحويل بنكي', CARD: 'بطاقة', OTHER: 'أخرى', EMPTY: 'لا توجد قيود مطابقة.', LOAD_ERROR: 'تعذر تحميل القيود.', INCOMING: 'دخل', OUTGOING: 'مصروف', OPEN_SESSION: 'فتح جلسة الصندوق', CLOSE_SESSION: 'إغلاق الجلسة', OPENING_BALANCE: 'الرصيد الافتتاحي', COUNTED_BALANCE: 'الرصيد المعدود', SESSION_OPEN: 'الجلسة مفتوحة', SESSION_CLOSED: 'الجلسة مغلقة', NO_SESSION: 'لا توجد جلسة مفتوحة', SESSION_ERROR: 'تعذر تحديث جلسة الصندوق.', SAVE: 'حفظ', CANCEL: 'إلغاء', CLOSE_NOTE: 'ملاحظة الإغلاق', EXPECTED: 'المتوقع', DISCREPANCY: 'الفرق', ADD_MOVEMENT: 'إضافة حركة', DIRECTION: 'الاتجاه', REFERENCE: 'المرجع', NOTE: 'ملاحظة', MANUAL_MOVEMENT: 'حركة يدوية', TRANSFER: 'تحويل داخلي', AGENCY: 'الوكالة', ALL_AGENCIES: 'جميع الوكالات', AGENCY_REQUIRED: 'اختر وكالة قبل تعديل جلسة الصندوق.',
  },
})

langHelper.setLanguage(strings)
export { strings }
