import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    TITLE: 'Abonnez-vous',
    SUB_TITLE: 'Abonnez-vous à notre liste de diffusion pour recevoir les dernières mises à jour !',
    SUBSCRIBE: "S'abonner",
    SUCCESS: 'Inscription réussie !',
    NEWSLETTER_SUBJECT: 'Nouvel abonnement à la newsletter',
  },
  ar: { TITLE: 'اشترك', SUB_TITLE: 'اشترك في قائمتنا البريدية لتصلك آخر التحديثات!', SUBSCRIBE: 'اشترك', SUCCESS: 'تم الاشتراك بنجاح!', NEWSLETTER_SUBJECT: 'اشتراك جديد في النشرة البريدية' },
  en: {
    TITLE: 'Subscribe',
    SUB_TITLE: 'Subscribe to our mailing list for the latest updates!',
    SUBSCRIBE: 'Subscribe',
    SUCCESS: 'Subscription successful!',
    NEWSLETTER_SUBJECT: 'New Newsletter Subscription',
  },
  es: {
    TITLE: 'Suscribir',
    SUB_TITLE: '¡Suscríbete a nuestra lista de correo para recibir las últimas actualizaciones!',
    SUBSCRIBE: 'Suscribir',
    SUCCESS: '¡Suscripción exitosa!',
    NEWSLETTER_SUBJECT: 'Nueva suscripción al boletín',
  },
})

langHelper.setLanguage(strings)
export { strings }
