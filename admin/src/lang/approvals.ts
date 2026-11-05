import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  en: {
    TITLE: 'Approvals', SUBTITLE: 'Approval requests awaiting a decision, and past decisions.', AGENCY: 'Agency', ALL_AGENCIES: 'All agencies', REFRESH: 'Refresh', LOADING: 'Loading approvals…', ERROR: 'Approvals could not be loaded.', EMPTY: 'No approval requests.', SUBJECT: 'Subject', SUBJECT_TYPE: 'Type', AMOUNT: 'Amount', STATUS: 'Status', PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', REQUESTED_BY: 'Requested by', REQUESTED_AT: 'Requested on', DECIDED_BY: 'Decided by', DECIDED_AT: 'Decided on', REASON: 'Reason', DECISION_REASON: 'Decision reason (optional)', APPROVE: 'Approve', REJECT: 'Reject', NEW_TITLE: 'New approval request', CREATE: 'Create request', ACTION_ERROR: 'The action could not be completed.',
  },
  fr: {
    TITLE: 'Approbations', SUBTITLE: 'Demandes d’approbation en attente de décision et décisions passées.', AGENCY: 'Agence', ALL_AGENCIES: 'Toutes les agences', REFRESH: 'Actualiser', LOADING: 'Chargement des approbations…', ERROR: 'Les approbations n’ont pas pu être chargées.', EMPTY: 'Aucune demande d’approbation.', SUBJECT: 'Objet', SUBJECT_TYPE: 'Type', AMOUNT: 'Montant', STATUS: 'Statut', PENDING: 'En attente', APPROVED: 'Approuvé', REJECTED: 'Rejeté', REQUESTED_BY: 'Demandé par', REQUESTED_AT: 'Demandé le', DECIDED_BY: 'Décidé par', DECIDED_AT: 'Décidé le', REASON: 'Motif', DECISION_REASON: 'Motif de la décision (facultatif)', APPROVE: 'Approuver', REJECT: 'Rejeter', NEW_TITLE: 'Nouvelle demande d’approbation', CREATE: 'Créer la demande', ACTION_ERROR: 'L’action n’a pas pu être effectuée.',
  },
  ar: {
    TITLE: 'الموافقات', SUBTITLE: 'طلبات الموافقة بانتظار القرار والقرارات السابقة.', AGENCY: 'الوكالة', ALL_AGENCIES: 'جميع الوكالات', REFRESH: 'تحديث', LOADING: 'جار تحميل الموافقات…', ERROR: 'تعذر تحميل الموافقات.', EMPTY: 'لا توجد طلبات موافقة.', SUBJECT: 'الموضوع', SUBJECT_TYPE: 'النوع', AMOUNT: 'المبلغ', STATUS: 'الحالة', PENDING: 'قيد الانتظار', APPROVED: 'تمت الموافقة', REJECTED: 'مرفوض', REQUESTED_BY: 'مقدّم الطلب', REQUESTED_AT: 'تاريخ الطلب', DECIDED_BY: 'صاحب القرار', DECIDED_AT: 'تاريخ القرار', REASON: 'السبب', DECISION_REASON: 'سبب القرار (اختياري)', APPROVE: 'موافقة', REJECT: 'رفض', NEW_TITLE: 'طلب موافقة جديد', CREATE: 'إنشاء الطلب', ACTION_ERROR: 'تعذر إتمام الإجراء.',
  },
  es: {
    TITLE: 'Aprobaciones', SUBTITLE: 'Solicitudes de aprobación pendientes de decisión y decisiones pasadas.', AGENCY: 'Agencia', ALL_AGENCIES: 'Todas las agencias', REFRESH: 'Actualizar', LOADING: 'Cargando aprobaciones…', ERROR: 'No se pudieron cargar las aprobaciones.', EMPTY: 'No hay solicitudes de aprobación.', SUBJECT: 'Asunto', SUBJECT_TYPE: 'Tipo', AMOUNT: 'Importe', STATUS: 'Estado', PENDING: 'Pendiente', APPROVED: 'Aprobado', REJECTED: 'Rechazado', REQUESTED_BY: 'Solicitado por', REQUESTED_AT: 'Solicitado el', DECIDED_BY: 'Decidido por', DECIDED_AT: 'Decidido el', REASON: 'Motivo', DECISION_REASON: 'Motivo de la decisión (opcional)', APPROVE: 'Aprobar', REJECT: 'Rechazar', NEW_TITLE: 'Nueva solicitud de aprobación', CREATE: 'Crear solicitud', ACTION_ERROR: 'No se pudo completar la acción.',
  },
})

langHelper.setLanguage(strings)
export { strings }
