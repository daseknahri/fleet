import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'
import env from '@/config/env.config'

const strings = new LocalizedStrings({
  fr: {
    CONGRATULATIONS: 'Félicitation!',
    SUCCESS: 'Votre paiement a été effectué avec succès. Nous vous avons envoyé un e-mail de confirmation.',
    SUCCESS_PAY_LATER: 'Votre réservation a bien été effectuée avec succès. Veuillez confirmer et payer avant la date limite ci-dessous — nous vous avons envoyé un e-mail de confirmation.',
    ERROR: 'Une erreur est survenue ! Veuillez réessayer plus tard',
    STATUS_TITLE: `${env.WEBSITE_NAME} Confirmation de réservation`,
    STATUS_MESSAGE: "Vérifiez votre boîte mail et suivez les étapes décrites dans l'e-mail de confirmation de réservation pour réserver votre voiture.",
    SESSION_ID_MISMATCH: 'ID de session non correspondant. Veuillez réessayer.', SESSION_EXPIRED: 'Votre session de paiement a expiré avant la fin du paiement. Vous n’avez pas été débité — veuillez lancer une nouvelle recherche.', BOOKING_RELEASED: 'Cette réservation a été libérée (la session de paiement s’est terminée sans paiement). Veuillez lancer une nouvelle recherche.', SEARCH_AGAIN: 'Lancer une nouvelle recherche', REFERENCE: 'Référence de réservation', ACTIVATE_ACCOUNT_NOTICE: 'Cette réservation a créé un compte pour vous. Vérifiez vos e-mails pour l’activer — vous pourrez ensuite vous connecter et gérer cette réservation. Si l’e-mail n’est pas arrivé, renvoyez-le ci-dessous.', RESEND_ACTIVATION: 'Renvoyer l’e-mail d’activation', FIND_BOOKING: 'Retrouver votre réservation par référence', INVOICE_VIEW: 'Voir / télécharger la facture (PDF)', INVOICE_PENDING: 'Votre facture sera disponible ici une fois émise.', HOLD_EXPIRES: 'Confirmer et payer avant le',
  },
  en: {
    CONGRATULATIONS: 'Congratulations!',
    SUCCESS: 'Your payment was successfully done. We sent you a confirmation email.',
    SUCCESS_PAY_LATER: 'Your booking was successfully done. Please confirm and pay before the hold deadline below — we sent you a confirmation email.',
    ERROR: 'Something went wrong! Try again later',
    STATUS_TITLE: `${env.WEBSITE_NAME} Booking Confirmation`,
    STATUS_MESSAGE: 'Check your mailbox and follow the steps described in the booking confirmation email to book your car.',
    SESSION_ID_MISMATCH: 'Session ID mismatch. Please try again.', SESSION_EXPIRED: 'Your payment session expired before the payment finished. You have not been charged — please start a new search.', BOOKING_RELEASED: 'This booking was released (the payment session ended without a payment). Please start a new search.', SEARCH_AGAIN: 'Start a new search', REFERENCE: 'Booking reference', ACTIVATE_ACCOUNT_NOTICE: 'This booking created an account for you. Check your email to activate it — then you can sign in and manage this booking. If the email did not arrive, resend it below.', RESEND_ACTIVATION: 'Resend activation email', FIND_BOOKING: 'Find your booking by reference', INVOICE_VIEW: 'View / download invoice (PDF)', INVOICE_PENDING: 'Your invoice will be available here once it is issued.', HOLD_EXPIRES: 'Confirm and pay before',
  },
  ar: {
    CONGRATULATIONS: 'تهانينا!',
    SUCCESS: 'تم الدفع بنجاح. لقد أرسلنا إليك بريداً إلكترونياً للتأكيد.',
    SUCCESS_PAY_LATER: 'تم حجزك بنجاح. يرجى التأكيد والدفع قبل الموعد النهائي أدناه — أرسلنا إليك رسالة تأكيد.',
    ERROR: 'حدث خطأ ما! حاول مرة أخرى لاحقاً',
    STATUS_TITLE: `${env.WEBSITE_NAME} تأكيد الحجز`,
    STATUS_MESSAGE: 'تحقق من صندوق بريدك واتبع الخطوات الموضحة في بريد تأكيد الحجز لحجز سيارتك.',
    SESSION_ID_MISMATCH: 'معرف الجلسة غير متطابق. يرجى المحاولة مرة أخرى.', SESSION_EXPIRED: 'انتهت صلاحية جلسة الدفع قبل إتمام الدفع. لم يتم خصم أي مبلغ منك — يرجى بدء بحث جديد.', BOOKING_RELEASED: 'تم تحرير هذا الحجز (انتهت جلسة الدفع دون دفع). يرجى بدء بحث جديد.', SEARCH_AGAIN: 'بدء بحث جديد',
     REFERENCE: 'مرجع الحجز', ACTIVATE_ACCOUNT_NOTICE: 'أنشأ هذا الحجز حسابًا لك. تحقق من بريدك الإلكتروني لتفعيله — بعدها يمكنك تسجيل الدخول وإدارة هذا الحجز. إذا لم يصلك البريد، أعد إرساله أدناه.', RESEND_ACTIVATION: 'إعادة إرسال بريد التفعيل', FIND_BOOKING: 'ابحث عن حجزك بالمرجع', INVOICE_VIEW: 'عرض / تنزيل الفاتورة (PDF)', INVOICE_PENDING: 'ستكون فاتورتك متاحة هنا بمجرد إصدارها.', HOLD_EXPIRES: 'أكّد وادفع قبل',
  },
  es: {
    CONGRATULATIONS: '¡Felicitaciones!',
    SUCCESS: 'Tu pago se realizó con éxito. Te hemos enviado un correo de confirmación.',
    SUCCESS_PAY_LATER: 'Su reserva se ha realizado con éxito. Confirme y pague antes de la fecha límite siguiente: le hemos enviado un correo de confirmación.',
    ERROR: '¡Algo salió mal! Inténtelo nuevamente más tarde',
    STATUS_TITLE: `${env.WEBSITE_NAME} Confirmación de reserva`,
    STATUS_MESSAGE: 'Revise su buzón de correo y siga los pasos descritos en el correo electrónico de confirmación de reserva para reservar su vehículo.',
    SESSION_ID_MISMATCH: 'ID de sesión no coincide. Por favor, inténtelo de nuevo.', SESSION_EXPIRED: 'Su sesión de pago caducó antes de terminar el pago. No se le ha cobrado nada; inicie una nueva búsqueda.', BOOKING_RELEASED: 'Esta reserva se liberó (la sesión de pago terminó sin pago). Inicie una nueva búsqueda.', SEARCH_AGAIN: 'Iniciar una nueva búsqueda', REFERENCE: 'Referencia de reserva', ACTIVATE_ACCOUNT_NOTICE: 'Esta reserva creó una cuenta para usted. Revise su correo para activarla; después podrá iniciar sesión y gestionar esta reserva. Si no llegó el correo, reenvíelo abajo.', RESEND_ACTIVATION: 'Reenviar el correo de activación', FIND_BOOKING: 'Buscar su reserva por referencia', INVOICE_VIEW: 'Ver / descargar la factura (PDF)', INVOICE_PENDING: 'Su factura estará disponible aquí una vez emitida.', HOLD_EXPIRES: 'Confirme y pague antes del',
  },
})

langHelper.setLanguage(strings)
export { strings }
