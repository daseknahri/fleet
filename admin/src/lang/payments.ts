import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  en: {
    EYEBROW: 'FINANCE', TITLE: 'Payments', SUBTITLE: 'Record and review payments received against rental contracts.',
    ADD: 'Record a payment', TOTAL: 'Payments recorded', ENTRIES: 'Transactions', SEARCH: 'Search contract, customer, or vehicle',
    DATE: 'Date', CONTRACT: 'Contract', CUSTOMER: 'Customer', VEHICLE: 'Vehicle', METHOD: 'Method', PURPOSE: 'Purpose', STATUS: 'Status',
    AMOUNT: 'Amount', REFERENCE: 'Reference', NOTE: 'Note', ACTIONS: 'Actions',
    EMPTY: 'No payments recorded yet.', LOAD_ERROR: 'Could not load payments.', SAVE_ERROR: 'Could not record this payment.',
    NEW: 'Record payment', SAVE: 'Record payment', CANCEL: 'Cancel', REQUIRED: 'Required', SELECT_BOOKING: 'Select a contract',
    BOOKING: 'Rental contract', DATE_FIELD: 'Payment date', CASH: 'Cash', BANK: 'Bank transfer', CARD: 'Card', OTHER: 'Other',
    REMAINING: 'Remaining for selected purpose', PURPOSE_FIELD: 'Payment purpose', RENT: 'Rental balance', DEPOSIT: 'Refundable deposit', REFUNDABLE: 'refundable',
    RECEIVABLES: 'Receivables', OVERDUE: 'Overdue receivables', OUTSTANDING: 'Outstanding', NO_OVERDUE: 'No overdue receivables.',
    REVERSE: 'Reverse payment', REVERSE_DEPOSIT: 'Refund deposit', REVERSE_CONFIRM: 'This creates an auditable debit reversal. Continue?',
    REVERSED: 'Reversed', POSTED: 'Posted', PENDING: 'Pending',
  },
  fr: {
    EYEBROW: 'FINANCE', TITLE: 'Paiements', SUBTITLE: 'Enregistrez et consultez les paiements reçus pour les contrats.',
    ADD: 'Enregistrer un paiement', TOTAL: 'Paiements enregistrés', ENTRIES: 'Transactions', SEARCH: 'Rechercher contrat, client ou véhicule',
    DATE: 'Date', CONTRACT: 'Contrat', CUSTOMER: 'Client', VEHICLE: 'Véhicule', METHOD: 'Mode', PURPOSE: 'Motif', STATUS: 'Statut',
    AMOUNT: 'Montant', REFERENCE: 'Référence', NOTE: 'Note', ACTIONS: 'Actions',
    EMPTY: 'Aucun paiement enregistré.', LOAD_ERROR: 'Impossible de charger les paiements.', SAVE_ERROR: 'Impossible d’enregistrer le paiement.',
    NEW: 'Enregistrer un paiement', SAVE: 'Enregistrer', CANCEL: 'Annuler', REQUIRED: 'Obligatoire', SELECT_BOOKING: 'Choisir un contrat',
    BOOKING: 'Contrat de location', DATE_FIELD: 'Date du paiement', CASH: 'Espèces', BANK: 'Virement bancaire', CARD: 'Carte', OTHER: 'Autre',
    REMAINING: 'Reste pour le motif sélectionné', PURPOSE_FIELD: 'Motif du paiement', RENT: 'Solde de location', DEPOSIT: 'Dépôt de garantie remboursable', REFUNDABLE: 'remboursable',
    RECEIVABLES: 'Créances', OVERDUE: 'Créances en retard', OUTSTANDING: 'Solde dû', NO_OVERDUE: 'Aucune créance en retard.',
    REVERSE: 'Annuler le paiement', REVERSE_DEPOSIT: 'Rembourser le dépôt', REVERSE_CONFIRM: 'Cette action crée une écriture de débit auditable. Continuer ?',
    REVERSED: 'Annulé', POSTED: 'Comptabilisé', PENDING: 'En attente',
  },
  es: {
    EYEBROW: 'FINANZAS', TITLE: 'Pagos', SUBTITLE: 'Registra y consulta los pagos recibidos por contrato.',
    ADD: 'Registrar un pago', TOTAL: 'Pagos registrados', ENTRIES: 'Transacciones', SEARCH: 'Buscar contrato, cliente o vehículo',
    DATE: 'Fecha', CONTRACT: 'Contrato', CUSTOMER: 'Cliente', VEHICLE: 'Vehículo', METHOD: 'Método', PURPOSE: 'Concepto', STATUS: 'Estado',
    AMOUNT: 'Importe', REFERENCE: 'Referencia', NOTE: 'Nota', ACTIONS: 'Acciones',
    EMPTY: 'Todavía no hay pagos registrados.', LOAD_ERROR: 'No se pudieron cargar los pagos.', SAVE_ERROR: 'No se pudo registrar el pago.',
    NEW: 'Registrar pago', SAVE: 'Registrar pago', CANCEL: 'Cancelar', REQUIRED: 'Obligatorio', SELECT_BOOKING: 'Seleccionar contrato',
    BOOKING: 'Contrato de alquiler', DATE_FIELD: 'Fecha de pago', CASH: 'Efectivo', BANK: 'Transferencia bancaria', CARD: 'Tarjeta', OTHER: 'Otro',
    REMAINING: 'Pendiente del concepto seleccionado', PURPOSE_FIELD: 'Concepto del pago', RENT: 'Saldo del alquiler', DEPOSIT: 'Depósito reembolsable', REFUNDABLE: 'reembolsable',
    RECEIVABLES: 'Cuentas por cobrar', OVERDUE: 'Cuentas vencidas', OUTSTANDING: 'Pendiente', NO_OVERDUE: 'No hay cuentas vencidas.',
    REVERSE: 'Revertir pago', REVERSE_DEPOSIT: 'Reembolsar depósito', REVERSE_CONFIRM: 'Esto crea una reversión de débito auditable. ¿Continuar?',
    REVERSED: 'Revertido', POSTED: 'Contabilizado', PENDING: 'Pendiente',
  },
  ar: {
    EYEBROW: 'المالية', TITLE: 'المدفوعات', SUBTITLE: 'سجل وراجع المدفوعات المستلمة مقابل عقود التأجير.',
    ADD: 'تسجيل دفعة', TOTAL: 'المدفوعات المسجلة', ENTRIES: 'المعاملات', SEARCH: 'البحث عن عقد أو عميل أو مركبة',
    DATE: 'التاريخ', CONTRACT: 'العقد', CUSTOMER: 'العميل', VEHICLE: 'المركبة', METHOD: 'الطريقة', PURPOSE: 'الغرض', STATUS: 'الحالة',
    AMOUNT: 'المبلغ', REFERENCE: 'المرجع', NOTE: 'ملاحظة', ACTIONS: 'إجراءات',
    EMPTY: 'لا توجد مدفوعات مسجلة بعد.', LOAD_ERROR: 'تعذر تحميل المدفوعات.', SAVE_ERROR: 'تعذر تسجيل هذه الدفعة.',
    NEW: 'تسجيل دفعة', SAVE: 'تسجيل الدفعة', CANCEL: 'إلغاء', REQUIRED: 'مطلوب', SELECT_BOOKING: 'اختر عقداً',
    BOOKING: 'عقد التأجير', DATE_FIELD: 'تاريخ الدفع', CASH: 'نقداً', BANK: 'تحويل بنكي', CARD: 'بطاقة', OTHER: 'أخرى',
    REMAINING: 'المتبقي للغرض المحدد', PURPOSE_FIELD: 'غرض الدفع', RENT: 'رصيد التأجير', DEPOSIT: 'وديعة قابلة للاسترداد', REFUNDABLE: 'قابل للاسترداد',
    RECEIVABLES: 'الذمم المدينة', OVERDUE: 'الذمم المتأخرة', OUTSTANDING: 'المبلغ المستحق', NO_OVERDUE: 'لا توجد ذمم متأخرة.',
    REVERSE: 'عكس الدفعة', REVERSE_DEPOSIT: 'استرداد الوديعة', REVERSE_CONFIRM: 'سيؤدي ذلك إلى إنشاء قيد عكسي قابل للتدقيق. هل تريد المتابعة؟',
    REVERSED: 'معكوسة', POSTED: 'مرحّلة', PENDING: 'قيد الانتظار',
  },
})

langHelper.setLanguage(strings)
export { strings }

