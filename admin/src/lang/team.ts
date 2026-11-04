import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  en: {
    EYEBROW: 'AGENCY', TITLE: 'Team', SUBTITLE: 'Manage staff access and responsibilities for this agency.',
    AGENCY: 'Agency', SELECT_AGENCY: 'Select an agency', ADD_MEMBER: 'Add staff member',
    FULL_NAME: 'Full name', EMAIL: 'Email', PASSWORD: 'Temporary password', ROLE: 'Role', STATUS: 'Status',
    ACTIONS: 'Actions', SAVE: 'Save changes', CREATE: 'Create staff account', CANCEL: 'Cancel', EDIT: 'Edit',
    ACTIVE: 'Active', SUSPENDED: 'Suspended', PENDING: 'Pending',
    MANAGER: 'Manager', COUNTER_AGENT: 'Counter agent', ACCOUNTANT: 'Accountant', MECHANIC: 'Mechanic', READ_ONLY: 'Read only',
    OWNER: 'Owner', CURRENT: 'Current agency',
    EMPTY: 'No staff members have been added yet.', LOADING: 'Loading team…', LOAD_ERROR: 'Could not load the team.',
    UNAUTHORIZED: 'You do not have access to team administration.', NETWORK_ERROR: 'The team could not be reached. Check the connection and try again.',
    FORM_ERROR: 'Check the required fields and try again.', CREATE_ERROR: 'The staff account could not be created.', UPDATE_ERROR: 'The staff member could not be updated.',
    PASSWORD_HINT: 'At least 6 characters', ROLE_HINT: 'Owner access is reserved for the agency account.',
  },
  fr: {
    EYEBROW: 'AGENCE', TITLE: 'Équipe', SUBTITLE: 'Gérez les accès et les responsabilités de cette agence.',
    AGENCY: 'Agence', SELECT_AGENCY: 'Choisir une agence', ADD_MEMBER: 'Ajouter un collaborateur',
    FULL_NAME: 'Nom complet', EMAIL: 'E-mail', PASSWORD: 'Mot de passe temporaire', ROLE: 'Rôle', STATUS: 'Statut',
    ACTIONS: 'Actions', SAVE: 'Enregistrer', CREATE: 'Créer le compte collaborateur', CANCEL: 'Annuler', EDIT: 'Modifier',
    ACTIVE: 'Actif', SUSPENDED: 'Suspendu', PENDING: 'En attente',
    MANAGER: 'Responsable', COUNTER_AGENT: 'Agent de comptoir', ACCOUNTANT: 'Comptable', MECHANIC: 'Mécanicien', READ_ONLY: 'Lecture seule',
    OWNER: 'Propriétaire', CURRENT: 'Agence actuelle',
    EMPTY: 'Aucun collaborateur n’a encore été ajouté.', LOADING: 'Chargement de l’équipe…', LOAD_ERROR: 'Impossible de charger l’équipe.',
    UNAUTHORIZED: 'Vous n’avez pas accès à l’administration de l’équipe.', NETWORK_ERROR: 'L’équipe est inaccessible. Vérifiez la connexion et réessayez.',
    FORM_ERROR: 'Vérifiez les champs obligatoires et réessayez.', CREATE_ERROR: 'Le compte collaborateur n’a pas pu être créé.', UPDATE_ERROR: 'Le collaborateur n’a pas pu être modifié.',
    PASSWORD_HINT: 'Au moins 6 caractères', ROLE_HINT: 'Le rôle propriétaire est réservé au compte de l’agence.',
  },
  ar: {
    EYEBROW: 'الوكالة', TITLE: 'الفريق', SUBTITLE: 'إدارة صلاحيات ومسؤوليات موظفي هذه الوكالة.',
    AGENCY: 'الوكالة', SELECT_AGENCY: 'اختر وكالة', ADD_MEMBER: 'إضافة موظف',
    FULL_NAME: 'الاسم الكامل', EMAIL: 'البريد الإلكتروني', PASSWORD: 'كلمة مرور مؤقتة', ROLE: 'الدور', STATUS: 'الحالة',
    ACTIONS: 'الإجراءات', SAVE: 'حفظ التغييرات', CREATE: 'إنشاء حساب الموظف', CANCEL: 'إلغاء', EDIT: 'تعديل',
    ACTIVE: 'نشط', SUSPENDED: 'موقوف', PENDING: 'قيد الانتظار',
    MANAGER: 'مدير', COUNTER_AGENT: 'موظف الاستقبال', ACCOUNTANT: 'محاسب', MECHANIC: 'ميكانيكي', READ_ONLY: 'قراءة فقط',
    OWNER: 'المالك', CURRENT: 'الوكالة الحالية',
    EMPTY: 'لم تتم إضافة أي موظف بعد.', LOADING: 'جار تحميل الفريق…', LOAD_ERROR: 'تعذر تحميل الفريق.',
    UNAUTHORIZED: 'لا تملك صلاحية إدارة الفريق.', NETWORK_ERROR: 'تعذر الوصول إلى الفريق. تحقق من الاتصال وحاول مرة أخرى.',
    FORM_ERROR: 'تحقق من الحقول المطلوبة وحاول مرة أخرى.', CREATE_ERROR: 'تعذر إنشاء حساب الموظف.', UPDATE_ERROR: 'تعذر تعديل الموظف.',
    PASSWORD_HINT: 'ستة أحرف على الأقل', ROLE_HINT: 'صلاحية المالك محفوظة لحساب الوكالة.',
  },
  es: {
    EYEBROW: 'AGENCIA', TITLE: 'Equipo', SUBTITLE: 'Gestiona los accesos y responsabilidades de esta agencia.',
    AGENCY: 'Agencia', SELECT_AGENCY: 'Seleccionar agencia', ADD_MEMBER: 'Añadir empleado',
    FULL_NAME: 'Nombre completo', EMAIL: 'Correo electrónico', PASSWORD: 'Contraseña temporal', ROLE: 'Rol', STATUS: 'Estado',
    ACTIONS: 'Acciones', SAVE: 'Guardar cambios', CREATE: 'Crear cuenta de empleado', CANCEL: 'Cancelar', EDIT: 'Editar',
    ACTIVE: 'Activo', SUSPENDED: 'Suspendido', PENDING: 'Pendiente',
    MANAGER: 'Responsable', COUNTER_AGENT: 'Agente de mostrador', ACCOUNTANT: 'Contable', MECHANIC: 'Mecánico', READ_ONLY: 'Solo lectura',
    OWNER: 'Propietario', CURRENT: 'Agencia actual',
    EMPTY: 'Todavía no se han añadido empleados.', LOADING: 'Cargando equipo…', LOAD_ERROR: 'No se pudo cargar el equipo.',
    UNAUTHORIZED: 'No tienes acceso a la administración del equipo.', NETWORK_ERROR: 'No se pudo acceder al equipo. Comprueba la conexión e inténtalo de nuevo.',
    FORM_ERROR: 'Comprueba los campos obligatorios e inténtalo de nuevo.', CREATE_ERROR: 'No se pudo crear la cuenta del empleado.', UPDATE_ERROR: 'No se pudo actualizar el empleado.',
    PASSWORD_HINT: 'Al menos 6 caracteres', ROLE_HINT: 'El acceso de propietario está reservado para la cuenta de la agencia.',
  },
})

langHelper.setLanguage(strings)
export { strings }
