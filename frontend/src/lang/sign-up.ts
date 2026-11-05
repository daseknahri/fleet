import LocalizedStrings from 'localized-strings'
import * as langHelper from '@/utils/langHelper'

const strings = new LocalizedStrings({
  fr: {
    SIGN_UP_HEADING: 'Inscription',
    SIGN_UP: "S'inscrire",
    SIGN_UP_ERROR: "Une erreur s'est produite lors de l'inscription.",
    SIGN_UP_SUCCESS_HEADING: 'Inscription réussie',
    SIGN_UP_SUCCESS_MESSAGE: "Un e-mail d'activation a été envoyé si cette adresse n'est pas déjà enregistrée. Si vous avez déjà un compte, veuillez vous connecter.",
  },
  ar: { SIGN_UP_HEADING: 'إنشاء حساب', FIRST_NAME: 'الاسم الأول', LAST_NAME: 'اسم العائلة', EMAIL: 'البريد الإلكتروني', PASSWORD: 'كلمة المرور', CONFIRM_PASSWORD: 'تأكيد كلمة المرور', PHONE: 'رقم الهاتف', SIGN_UP: 'تسجيل', ALREADY_REGISTERED: 'لديك حساب بالفعل؟', TOS: 'قرأت وأوافق على شروط الاستخدام', TOS_ERROR: 'يرجى الموافقة على شروط الاستخدام.', SIGN_UP_ERROR: 'حدث خطأ أثناء إنشاء الحساب.', SIGN_UP_SUCCESS_HEADING: 'تم إنشاء الحساب بنجاح', SIGN_UP_SUCCESS_MESSAGE: 'تم إرسال بريد تفعيل إذا لم يكن هذا العنوان مسجلاً من قبل. إذا كان لديك حساب بالفعل، يرجى تسجيل الدخول.' },
  en: {
    SIGN_UP_HEADING: 'Register',
    SIGN_UP: 'Register',
    SIGN_UP_ERROR: 'An error occurred during sign up.',
    SIGN_UP_SUCCESS_HEADING: 'Registration Successful',
    SIGN_UP_SUCCESS_MESSAGE: 'An activation email has been sent if this address is not already registered. If you already have an account, please sign in.',
  },
  es: {
    SIGN_UP_HEADING: 'Regístrate',
    SIGN_UP: 'Regístrate',
    SIGN_UP_ERROR: 'Se produjo un error durante el registro.',
    SIGN_UP_SUCCESS_HEADING: 'Registro exitoso',
    SIGN_UP_SUCCESS_MESSAGE: 'Se ha enviado un correo electrónico de activación si esta dirección no está registrada. Si ya tiene una cuenta, inicie sesión.',
  },
})

langHelper.setLanguage(strings)
export { strings }
