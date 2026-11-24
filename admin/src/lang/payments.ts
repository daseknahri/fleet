import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  en: {
    EYEBROW: 'FINANCE', TITLE: 'Payments', HELP_PAYMENTS: 'All money received against rental contracts: rent, deposits and refunds. Record a payment against a booking; reverse it if it was a mistake.', HELP_RECEIVABLES: 'What clients still owe: rent outstanding and deposits due, with the due date. Start here each morning.', SUBTITLE: 'Record and review payments received against rental contracts.',
    ADD: 'Record a payment', TOTAL: 'Payments recorded', ENTRIES: 'Transactions', SEARCH: 'Search contract, customer, or vehicle',
    DATE: 'Date', CONTRACT: 'Contract', CUSTOMER: 'Customer', VEHICLE: 'Vehicle', METHOD: 'Method', PURPOSE: 'Purpose', STATUS: 'Status',
    AMOUNT: 'Amount', REFERENCE: 'Reference', NOTE: 'Note', ACTIONS: 'Actions',
    EMPTY: 'No payments recorded yet.', LOAD_ERROR: 'Could not load payments.', SAVE_ERROR: 'Could not record this payment.',
    NEW: 'Record payment', SAVE: 'Record payment', CANCEL: 'Cancel', REQUIRED: 'Required', SELECT_BOOKING: 'Select a contract',
    BOOKING: 'Rental contract', DATE_FIELD: 'Payment date', CASH: 'Cash', BANK: 'Bank transfer', CARD: 'Card', OTHER: 'Other',
    REMAINING: 'Remaining for selected purpose', PURPOSE_FIELD: 'Payment purpose', RENT: 'Rental balance', DEPOSIT: 'Refundable deposit', REFUNDABLE: 'refundable',
    RECEIVABLES: 'Receivables', OVERDUE: 'Overdue receivables', OUTSTANDING: 'Outstanding', NO_OVERDUE: 'No outstanding receivables.',
    REVERSE: 'Reverse payment', REVERSE_DEPOSIT: 'Refund deposit', REVERSE_CONFIRM: 'This creates an auditable debit reversal. Continue?',
    REVERSED: 'Reversed', POSTED: 'Posted', PENDING: 'Pending', COLLECTIONS: 'Collections', COLLECTION_RATE: 'Collection rate', EXPORT_CSV: 'Export CSV',
    DIRECTION: 'Direction', CREDIT: 'Credit', DEBIT: 'Debit', DEBIT_CAP: 'Recorded for selected purpose', REASON: 'Reason', EDIT: 'Edit', DELETE: 'Delete', DELETE_CONFIRM: 'Delete this pending entry? It never counted as money.', DELETED: 'Pending entry deleted', EDIT_PAYMENT: 'Edit payment entry', PREVIOUS: 'Previous', NEXT: 'Next', SHOWING: 'Showing', REFRESH_CONFLICT: 'Payment recorded, but the contract could not be confirmed: {reason} Clear the block, then retry the confirmation.', RETRY_CONFIRMATION: 'Retry confirmation', REFRESH_CONFIRMED: 'Contract confirmed',
  },
  fr: {
    EYEBROW: 'FINANCE', TITLE: 'Paiements', HELP_PAYMENTS: 'Tout l’argent reçu pour les contrats de location : loyers, cautions et remboursements. Enregistrez un paiement sur une réservation ; annulez-le en cas d’erreur.', HELP_RECEIVABLES: 'Ce que les clients doivent encore : loyers impayés et cautions dues, avec la date d’échéance. Commencez par ici chaque matin.', SUBTITLE: 'Enregistrez et consultez les paiements reçus pour les contrats.',
    ADD: 'Enregistrer un paiement', TOTAL: 'Paiements enregistrés', ENTRIES: 'Transactions', SEARCH: 'Rechercher contrat, client ou véhicule',
    DATE: 'Date', CONTRACT: 'Contrat', CUSTOMER: 'Client', VEHICLE: 'Véhicule', METHOD: 'Mode', PURPOSE: 'Motif', STATUS: 'Statut',
    AMOUNT: 'Montant', REFERENCE: 'Référence', NOTE: 'Note', ACTIONS: 'Actions',
    EMPTY: 'Aucun paiement enregistré.', LOAD_ERROR: 'Impossible de charger les paiements.', SAVE_ERROR: 'Impossible d’enregistrer le paiement.',
    NEW: 'Enregistrer un paiement', SAVE: 'Enregistrer', CANCEL: 'Annuler', REQUIRED: 'Obligatoire', SELECT_BOOKING: 'Choisir un contrat',
    BOOKING: 'Contrat de location', DATE_FIELD: 'Date du paiement', CASH: 'Espèces', BANK: 'Virement bancaire', CARD: 'Carte', OTHER: 'Autre',
    REMAINING: 'Reste pour le motif sélectionné', PURPOSE_FIELD: 'Motif du paiement', RENT: 'Solde de location', DEPOSIT: 'Dépôt de garantie remboursable', REFUNDABLE: 'remboursable',
    RECEIVABLES: 'Créances', OVERDUE: 'Créances en retard', OUTSTANDING: 'Solde dû', NO_OVERDUE: 'Aucune créance en attente.',
    REVERSE: 'Annuler le paiement', REVERSE_DEPOSIT: 'Rembourser le dépôt', REVERSE_CONFIRM: 'Cette action crée une écriture de débit auditable. Continuer ?',
    REVERSED: 'Annulé', POSTED: 'Comptabilisé', PENDING: 'En attente', COLLECTIONS: 'Encaissements', COLLECTION_RATE: 'Taux d’encaissement', EXPORT_CSV: 'Exporter CSV',
    DIRECTION: 'Sens', CREDIT: 'Crédit', DEBIT: 'Débit', DEBIT_CAP: 'Enregistré pour le motif sélectionné', REASON: 'Motif', EDIT: 'Modifier', DELETE: 'Supprimer', DELETE_CONFIRM: 'Supprimer cette écriture en attente ? Elle n’a jamais compté comme argent.', DELETED: 'Écriture en attente supprimée', EDIT_PAYMENT: 'Modifier l’écriture', PREVIOUS: 'Précédent', NEXT: 'Suivant', SHOWING: 'Affichage', REFRESH_CONFLICT: 'Paiement enregistré, mais le contrat n’a pas pu être confirmé : {reason} Levez le blocage, puis réessayez la confirmation.', RETRY_CONFIRMATION: 'Réessayer la confirmation', REFRESH_CONFIRMED: 'Contrat confirmé',
  },
  es: {
    EYEBROW: 'FINANZAS', TITLE: 'Pagos', HELP_PAYMENTS: 'Todo el dinero recibido por los contratos de alquiler: alquileres, depósitos y reembolsos. Registre un pago en una reserva; reviertalo si fue un error.', HELP_RECEIVABLES: 'Lo que aún deben los clientes: alquileres pendientes y depósitos adeudados, con la fecha de vencimiento. Empiece aquí cada mañana.', SUBTITLE: 'Registra y consulta los pagos recibidos por contrato.',
    ADD: 'Registrar un pago', TOTAL: 'Pagos registrados', ENTRIES: 'Transacciones', SEARCH: 'Buscar contrato, cliente o vehículo',
    DATE: 'Fecha', CONTRACT: 'Contrato', CUSTOMER: 'Cliente', VEHICLE: 'Vehículo', METHOD: 'Método', PURPOSE: 'Concepto', STATUS: 'Estado',
    AMOUNT: 'Importe', REFERENCE: 'Referencia', NOTE: 'Nota', ACTIONS: 'Acciones',
    EMPTY: 'Todavía no hay pagos registrados.', LOAD_ERROR: 'No se pudieron cargar los pagos.', SAVE_ERROR: 'No se pudo registrar el pago.',
    NEW: 'Registrar pago', SAVE: 'Registrar pago', CANCEL: 'Cancelar', REQUIRED: 'Obligatorio', SELECT_BOOKING: 'Seleccionar contrato',
    BOOKING: 'Contrato de alquiler', DATE_FIELD: 'Fecha de pago', CASH: 'Efectivo', BANK: 'Transferencia bancaria', CARD: 'Tarjeta', OTHER: 'Otro',
    REMAINING: 'Pendiente del concepto seleccionado', PURPOSE_FIELD: 'Concepto del pago', RENT: 'Saldo del alquiler', DEPOSIT: 'Depósito reembolsable', REFUNDABLE: 'reembolsable',
    RECEIVABLES: 'Cuentas por cobrar', OVERDUE: 'Cuentas vencidas', OUTSTANDING: 'Pendiente', NO_OVERDUE: 'No hay cuentas pendientes.',
    REVERSE: 'Revertir pago', REVERSE_DEPOSIT: 'Reembolsar depósito', REVERSE_CONFIRM: 'Esto crea una reversión de débito auditable. ¿Continuar?',
    REVERSED: 'Revertido', POSTED: 'Contabilizado', PENDING: 'Pendiente', COLLECTIONS: 'Cobros', COLLECTION_RATE: 'Tasa de cobro', EXPORT_CSV: 'Exportar CSV',
    DIRECTION: 'Dirección', CREDIT: 'Crédito', DEBIT: 'Débito', DEBIT_CAP: 'Registrado para el concepto seleccionado', REASON: 'Motivo', EDIT: 'Editar', DELETE: 'Eliminar', DELETE_CONFIRM: '¿Eliminar este asiento pendiente? Nunca contó como dinero.', DELETED: 'Asiento pendiente eliminado', EDIT_PAYMENT: 'Editar asiento', PREVIOUS: 'Anterior', NEXT: 'Siguiente', SHOWING: 'Mostrando', REFRESH_CONFLICT: 'Pago registrado, pero no se pudo confirmar el contrato: {reason} Elimine el bloqueo y reintente la confirmación.', RETRY_CONFIRMATION: 'Reintentar la confirmación', REFRESH_CONFIRMED: 'Contrato confirmado',
  },
  ar: {
    EYEBROW: 'المالية', TITLE: 'المدفوعات', HELP_PAYMENTS: 'كل الأموال المستلمة مقابل عقود الإيجار: الإيجارات والضمانات والمبالغ المستردة. سجّل دفعة على حجز؛ وألغها إذا كانت خاطئة.', HELP_RECEIVABLES: 'ما تبقى على العملاء: الإيجارات المستحقة والضمانات الواجبة، مع تاريخ الاستحقاق. ابدأ من هنا كل صباح.', SUBTITLE: 'سجل وراجع المدفوعات المستلمة مقابل عقود التأجير.',
    ADD: 'تسجيل دفعة', TOTAL: 'المدفوعات المسجلة', ENTRIES: 'المعاملات', SEARCH: 'البحث عن عقد أو عميل أو مركبة',
    DATE: 'التاريخ', CONTRACT: 'العقد', CUSTOMER: 'العميل', VEHICLE: 'المركبة', METHOD: 'الطريقة', PURPOSE: 'الغرض', STATUS: 'الحالة',
    AMOUNT: 'المبلغ', REFERENCE: 'المرجع', NOTE: 'ملاحظة', ACTIONS: 'إجراءات',
    EMPTY: 'لا توجد مدفوعات مسجلة بعد.', LOAD_ERROR: 'تعذر تحميل المدفوعات.', SAVE_ERROR: 'تعذر تسجيل هذه الدفعة.',
    NEW: 'تسجيل دفعة', SAVE: 'تسجيل الدفعة', CANCEL: 'إلغاء', REQUIRED: 'مطلوب', SELECT_BOOKING: 'اختر عقداً',
    BOOKING: 'عقد التأجير', DATE_FIELD: 'تاريخ الدفع', CASH: 'نقداً', BANK: 'تحويل بنكي', CARD: 'بطاقة', OTHER: 'أخرى',
    REMAINING: 'المتبقي للغرض المحدد', PURPOSE_FIELD: 'غرض الدفع', RENT: 'رصيد التأجير', DEPOSIT: 'وديعة قابلة للاسترداد', REFUNDABLE: 'قابل للاسترداد',
    RECEIVABLES: 'الذمم المدينة', OVERDUE: 'الذمم المتأخرة', OUTSTANDING: 'المبلغ المستحق', NO_OVERDUE: 'لا توجد ذمم مستحقة.',
    REVERSE: 'عكس الدفعة', REVERSE_DEPOSIT: 'استرداد الوديعة', REVERSE_CONFIRM: 'سيؤدي ذلك إلى إنشاء قيد عكسي قابل للتدقيق. هل تريد المتابعة؟',
    REVERSED: 'معكوسة', POSTED: 'مرحّلة', PENDING: 'قيد الانتظار', COLLECTIONS: 'التحصيلات', COLLECTION_RATE: 'نسبة التحصيل', EXPORT_CSV: 'تصدير CSV',
    DIRECTION: 'الاتجاه', CREDIT: 'دائن', DEBIT: 'مدين', DEBIT_CAP: 'المسجل للغرض المحدد', REASON: 'السبب', EDIT: 'تعديل', DELETE: 'حذف', DELETE_CONFIRM: 'حذف هذا القيد المعلق؟ لم يُحتسب كمال أبداً.', DELETED: 'تم حذف القيد المعلق', EDIT_PAYMENT: 'تعديل قيد الدفع', PREVIOUS: 'السابق', NEXT: 'التالي', SHOWING: 'عرض', REFRESH_CONFLICT: 'تم تسجيل الدفع، لكن تعذّر تأكيد العقد: {reason} أزل العائق، ثم أعد محاولة التأكيد.', RETRY_CONFIRMATION: 'إعادة محاولة التأكيد', REFRESH_CONFIRMED: 'تم تأكيد العقد',
  },
})

langHelper.setLanguage(strings)
export { strings }

