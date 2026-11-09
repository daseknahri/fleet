import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  en: {
    EYEBROW: 'FLEET & CUSTOMERS', TITLE: 'Maintenance & expenses',
    SUBTITLE: 'Track vehicle servicing, repairs, and agency expenses.', ADD: 'Add an expense',
    TOTAL: 'Recorded expenses', RECORDS: 'Entries', SEARCH: 'Search vehicle or vendor',
    DATE: 'Date', TYPE: 'Type', VEHICLE: 'Vehicle', AMOUNT: 'Amount', MILEAGE: 'Mileage',
    VENDOR: 'Vendor', NOTE: 'Notes', ACTIONS: 'Actions', EDIT: 'Edit', DELETE: 'Delete',
    SAVE: 'Save expense', CANCEL: 'Cancel', NEW: 'New expense', EMPTY: 'No expenses recorded yet.',
    EMPTY_CARS: 'Add a vehicle before recording an expense.', LOAD_ERROR: 'Could not load maintenance expenses.',
    SAVE_ERROR: 'Could not save this expense.', DELETE_CONFIRM: 'Delete this expense? This action cannot be undone.',
    DELETE_ERROR: 'Could not delete this expense.', REQUIRED: 'Required', SELECT_CAR: 'Select a vehicle',
    ALL_TYPES: 'All types', MAINTENANCE: 'Maintenance', REPAIR: 'Repair', CLEANING: 'Cleaning',
    FUEL: 'Fuel', INSURANCE: 'Insurance', OTHER: 'Other', RECEIPT: 'Receipt', SCHEDULES: 'Service schedules', NO_SCHEDULES: 'No service schedules yet.', ADD_SCHEDULE: 'Add schedule', NEW_SCHEDULE: 'New service schedule', EDIT_SCHEDULE: 'Edit service schedule', SAVE_SCHEDULE: 'Save schedule', SCHEDULE_SAVE_ERROR: 'Could not save this schedule.', SCHEDULE_REQUIRED_FIELD: 'Please fill in the field: ', SCHEDULE_INVALID_FIELD: 'Invalid value for the field: ', SCHEDULE_INTERVAL_REQUIRED: 'Please fill in at least one interval (days or km).', DELETE_SCHEDULE_CONFIRM: 'Delete this schedule?', CATEGORY_REPORT: 'Category report', NO_REPORT: 'No expenses in this period.', RECEIPTS: 'receipts', SCHEDULE_TITLE: 'Service title', NEXT_DUE: 'Next due date', INTERVAL_DAYS: 'Interval (days)', INTERVAL_KM: 'Interval (km)', NEXT_MILEAGE: 'Next mileage', STATUS: 'Status', UPCOMING: 'Upcoming', DUE: 'Due soon', OVERDUE: 'Overdue', COMPLETED: 'Completed', STATUS_DERIVED_HINT: 'Status is calculated automatically from the due date. Tick Completed to close the schedule.',
  },
  fr: {
    EYEBROW: 'FLOTTE & CLIENTS', TITLE: 'Entretien et dépenses',
    SUBTITLE: 'Suivez les entretiens, réparations et dépenses de l’agence.', ADD: 'Ajouter une dépense',
    TOTAL: 'Dépenses enregistrées', RECORDS: 'Entrées', SEARCH: 'Rechercher véhicule ou fournisseur',
    DATE: 'Date', TYPE: 'Type', VEHICLE: 'Véhicule', AMOUNT: 'Montant', MILEAGE: 'Kilométrage',
    VENDOR: 'Fournisseur', NOTE: 'Notes', ACTIONS: 'Actions', EDIT: 'Modifier', DELETE: 'Supprimer',
    SAVE: 'Enregistrer la dépense', CANCEL: 'Annuler', NEW: 'Nouvelle dépense', EMPTY: 'Aucune dépense enregistrée.',
    EMPTY_CARS: 'Ajoutez un véhicule avant d’enregistrer une dépense.', LOAD_ERROR: 'Impossible de charger les dépenses.',
    SAVE_ERROR: 'Impossible d’enregistrer cette dépense.', DELETE_CONFIRM: 'Supprimer cette dépense ? Cette action est irréversible.',
    DELETE_ERROR: 'Impossible de supprimer cette dépense.', REQUIRED: 'Obligatoire', SELECT_CAR: 'Choisir un véhicule',
    ALL_TYPES: 'Tous les types', MAINTENANCE: 'Entretien', REPAIR: 'Réparation', CLEANING: 'Nettoyage',
    FUEL: 'Carburant', INSURANCE: 'Assurance', OTHER: 'Autre', RECEIPT: 'Reçu', SCHEDULES: 'Échéances d’entretien', NO_SCHEDULES: 'Aucune échéance.', ADD_SCHEDULE: 'Ajouter une échéance', NEW_SCHEDULE: 'Nouvelle échéance', EDIT_SCHEDULE: 'Modifier l’échéance', SAVE_SCHEDULE: 'Enregistrer', SCHEDULE_SAVE_ERROR: 'Impossible d’enregistrer l’échéance.', SCHEDULE_REQUIRED_FIELD: 'Veuillez renseigner le champ : ', SCHEDULE_INVALID_FIELD: 'Valeur invalide pour le champ : ', SCHEDULE_INTERVAL_REQUIRED: 'Veuillez renseigner au moins un intervalle (jours ou km).', DELETE_SCHEDULE_CONFIRM: 'Supprimer cette échéance ?', CATEGORY_REPORT: 'Rapport par catégorie', NO_REPORT: 'Aucune dépense sur cette période.', RECEIPTS: 'reçus', SCHEDULE_TITLE: 'Intitulé de service', NEXT_DUE: 'Prochaine échéance', INTERVAL_DAYS: 'Intervalle (jours)', INTERVAL_KM: 'Intervalle (km)', NEXT_MILEAGE: 'Prochain kilométrage', STATUS: 'Statut', UPCOMING: 'À venir', DUE: 'Bientôt dû', OVERDUE: 'En retard', COMPLETED: 'Terminé', STATUS_DERIVED_HINT: 'Le statut est calculé automatiquement à partir de la date d’échéance. Cochez Terminé pour clôturer l’échéance.',
  },
  ar: {
    EYEBROW: 'الأسطول والعملاء', TITLE: 'الصيانة والمصروفات', SUBTITLE: 'تتبع صيانة المركبات وإصلاحاتها ومصروفات الوكالة.', ADD: 'إضافة مصروف', TOTAL: 'المصروفات المسجلة', RECORDS: 'السجلات', SEARCH: 'البحث عن مركبة أو مورد', DATE: 'التاريخ', TYPE: 'النوع', VEHICLE: 'المركبة', AMOUNT: 'المبلغ', MILEAGE: 'المسافة', VENDOR: 'المورد', NOTE: 'ملاحظات', ACTIONS: 'الإجراءات', EDIT: 'تعديل', DELETE: 'حذف', SAVE: 'حفظ المصروف', CANCEL: 'إلغاء', NEW: 'مصروف جديد', EMPTY: 'لا توجد مصروفات مسجلة بعد.', EMPTY_CARS: 'أضف مركبة قبل تسجيل مصروف.', LOAD_ERROR: 'تعذر تحميل مصروفات الصيانة.', SAVE_ERROR: 'تعذر حفظ المصروف.', DELETE_CONFIRM: 'هل تريد حذف هذا المصروف؟', DELETE_ERROR: 'تعذر حذف المصروف.', REQUIRED: 'مطلوب', SELECT_CAR: 'اختر مركبة', ALL_TYPES: 'كل الأنواع', MAINTENANCE: 'صيانة', REPAIR: 'إصلاح', CLEANING: 'تنظيف', FUEL: 'وقود', INSURANCE: 'تأمين', OTHER: 'أخرى', RECEIPT: 'الإيصال', SCHEDULES: 'جداول الصيانة', NO_SCHEDULES: 'لا توجد جداول صيانة بعد.', ADD_SCHEDULE: 'إضافة جدول', NEW_SCHEDULE: 'جدول صيانة جديد', EDIT_SCHEDULE: 'تعديل جدول الصيانة', SAVE_SCHEDULE: 'حفظ الجدول', SCHEDULE_SAVE_ERROR: 'تعذر حفظ الجدول.', SCHEDULE_REQUIRED_FIELD: 'يرجى تعبئة الحقل: ', SCHEDULE_INVALID_FIELD: 'قيمة غير صالحة للحقل: ', SCHEDULE_INTERVAL_REQUIRED: 'يرجى إدخال فاصل واحد على الأقل (أيام أو كم).', DELETE_SCHEDULE_CONFIRM: 'هل تريد حذف هذا الجدول؟', CATEGORY_REPORT: 'تقرير حسب الفئة', NO_REPORT: 'لا توجد مصروفات في هذه الفترة.', RECEIPTS: 'إيصالات', SCHEDULE_TITLE: 'عنوان الخدمة', NEXT_DUE: 'تاريخ الاستحقاق التالي', INTERVAL_DAYS: 'الفاصل (أيام)', INTERVAL_KM: 'الفاصل (كم)', NEXT_MILEAGE: 'المسافة التالية', STATUS: 'الحالة', UPCOMING: 'قادم', DUE: 'مستحق قريباً', OVERDUE: 'متأخر', COMPLETED: 'مكتمل', STATUS_DERIVED_HINT: 'تُحسب الحالة تلقائيًا من تاريخ الاستحقاق التالي. ضع علامة على مكتمل لإغلاق الجدول.',
  },
  es: {
    EYEBROW: 'FLOTA Y CLIENTES', TITLE: 'Mantenimiento y gastos',
    SUBTITLE: 'Registra revisiones, reparaciones y gastos de la agencia.', ADD: 'Añadir gasto',
    TOTAL: 'Gastos registrados', RECORDS: 'Registros', SEARCH: 'Buscar vehículo o proveedor',
    DATE: 'Fecha', TYPE: 'Tipo', VEHICLE: 'Vehículo', AMOUNT: 'Importe', MILEAGE: 'Kilometraje',
    VENDOR: 'Proveedor', NOTE: 'Notas', ACTIONS: 'Acciones', EDIT: 'Editar', DELETE: 'Eliminar',
    SAVE: 'Guardar gasto', CANCEL: 'Cancelar', NEW: 'Nuevo gasto', EMPTY: 'Todavía no hay gastos registrados.',
    EMPTY_CARS: 'Añade un vehículo antes de registrar un gasto.', LOAD_ERROR: 'No se pudieron cargar los gastos.',
    SAVE_ERROR: 'No se pudo guardar este gasto.', DELETE_CONFIRM: '¿Eliminar este gasto? Esta acción no se puede deshacer.',
    DELETE_ERROR: 'No se pudo eliminar este gasto.', REQUIRED: 'Obligatorio', SELECT_CAR: 'Selecciona un vehículo',
    ALL_TYPES: 'Todos los tipos', MAINTENANCE: 'Mantenimiento', REPAIR: 'Reparación', CLEANING: 'Limpieza',
    FUEL: 'Combustible', INSURANCE: 'Seguro', OTHER: 'Otro', RECEIPT: 'Recibo', SCHEDULES: 'Calendario de servicio', NO_SCHEDULES: 'No hay calendarios.', ADD_SCHEDULE: 'Añadir calendario', NEW_SCHEDULE: 'Nuevo calendario', EDIT_SCHEDULE: 'Editar calendario', SAVE_SCHEDULE: 'Guardar calendario', SCHEDULE_SAVE_ERROR: 'No se pudo guardar el calendario.', SCHEDULE_REQUIRED_FIELD: 'Por favor, rellene el campo: ', SCHEDULE_INVALID_FIELD: 'Valor no válido para el campo: ', SCHEDULE_INTERVAL_REQUIRED: 'Por favor, rellene al menos un intervalo (días o km).', DELETE_SCHEDULE_CONFIRM: '¿Eliminar este calendario?', CATEGORY_REPORT: 'Informe por categoría', NO_REPORT: 'No hay gastos en este periodo.', RECEIPTS: 'recibos', SCHEDULE_TITLE: 'Título del servicio', NEXT_DUE: 'Próxima fecha', INTERVAL_DAYS: 'Intervalo (días)', INTERVAL_KM: 'Intervalo (km)', NEXT_MILEAGE: 'Próximo kilometraje', STATUS: 'Estado', UPCOMING: 'Próximo', DUE: 'Próximo vencimiento', OVERDUE: 'Atrasado', COMPLETED: 'Completado', STATUS_DERIVED_HINT: 'El estado se calcula automáticamente a partir de la próxima fecha. Marca Completado para cerrar el calendario.',
  },
})

langHelper.setLanguage(strings)

export { strings }
