import * as bookcarsTypes from ':bookcars-types'

/**
 * F8 / W5 N3 — notification templates. One key per notification kind,
 * rendered in the recipient's language (the agency owner's language;
 * the fan-out passes the owner's `language`). Plain-text subject +
 * body; the email sender wraps the body in the standard HTML shell,
 * in-app and push use the body as-is.
 *
 * Templates never invent content: every variable is a real record
 * value (car, driver, date, amount) computed by the caller.
 */

export type TemplateLocale = 'en' | 'fr' | 'ar' | 'es'

export type TemplateVars = Record<string, string | number | undefined>

export interface RenderedTemplate {
  subject: string
  body: string
}

type TemplateFn = (vars: TemplateVars) => RenderedTemplate

const templates: Record<bookcarsTypes.NotificationTemplateKey, Record<TemplateLocale, TemplateFn>> = {
  'auto.pickup': {
    en: (v) => ({ subject: `Pickup ${v.when}: ${v.car} — ${v.driver}`, body: `Pickup ${v.when} (${v.date}): ${v.car} for ${v.driver}.` }),
    fr: (v) => ({ subject: `Prise en charge ${v.whenFr}: ${v.car} — ${v.driver}`, body: `Prise en charge ${v.whenFr} (${v.date}) : ${v.car} pour ${v.driver}.` }),
    ar: (v) => ({ subject: `استلام ${v.whenAr}: ${v.car} — ${v.driver}`, body: `استلام ${v.whenAr} (${v.date}): ${v.car} للسائق ${v.driver}.` }),
    es: (v) => ({ subject: `Recogida ${v.whenEs}: ${v.car} — ${v.driver}`, body: `Recogida ${v.whenEs} (${v.date}): ${v.car} para ${v.driver}.` }),
  },
  'auto.return': {
    en: (v) => ({ subject: `Return ${v.when}: ${v.car} — ${v.driver}`, body: `Return ${v.when} (${v.date}): ${v.car} from ${v.driver}.` }),
    fr: (v) => ({ subject: `Retour ${v.whenFr}: ${v.car} — ${v.driver}`, body: `Retour ${v.whenFr} (${v.date}) : ${v.car} de ${v.driver}.` }),
    ar: (v) => ({ subject: `إرجاع ${v.whenAr}: ${v.car} — ${v.driver}`, body: `إرجاع ${v.whenAr} (${v.date}): ${v.car} من ${v.driver}.` }),
    es: (v) => ({ subject: `Devolución ${v.whenEs}: ${v.car} — ${v.driver}`, body: `Devolución ${v.whenEs} (${v.date}): ${v.car} de ${v.driver}.` }),
  },
  'auto.confirmedUnpaid': {
    en: (v) => ({ subject: `Confirmed but unpaid: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Confirmed reservation ${v.days} day(s) ago: ${v.car} for ${v.driver}, ${v.amount} ${v.currency} still outstanding (pickup ${v.date}).` }),
    fr: (v) => ({ subject: `Confirmée mais impayée : ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Réservation confirmée il y a ${v.days} jour(s) : ${v.car} pour ${v.driver}, ${v.amount} ${v.currency} toujours impayés (prise en charge le ${v.date}).` }),
    ar: (v) => ({ subject: `مؤكدة ولكن غير مدفوعة: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `حجز مؤكد منذ ${v.days} يوم: ${v.car} للسائق ${v.driver}، ${v.amount} ${v.currency} لا تزال غير مسددة (الاستلام ${v.date}).` }),
    es: (v) => ({ subject: `Confirmada pero sin pagar: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Reserva confirmada hace ${v.days} día(s): ${v.car} para ${v.driver}, ${v.amount} ${v.currency} aún pendientes (recogida ${v.date}).` }),
  },
  'auto.overdue': {
    en: (v) => ({ subject: `Overdue: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Overdue rental: ${v.car} for ${v.driver}, ${v.amount} ${v.currency} outstanding since ${v.date}.` }),
    fr: (v) => ({ subject: `En retard : ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Location en retard : ${v.car} pour ${v.driver}, ${v.amount} ${v.currency} impayés depuis le ${v.date}.` }),
    ar: (v) => ({ subject: `متأخر: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `إيجار متأخر: ${v.car} للسائق ${v.driver}، ${v.amount} ${v.currency} غير مسددة منذ ${v.date}.` }),
    es: (v) => ({ subject: `Vencido: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Alquiler vencido: ${v.car} para ${v.driver}, ${v.amount} ${v.currency} pendientes desde el ${v.date}.` }),
  },
  'auto.expiry': {
    en: (v) => ({ subject: `${v.doc} expires ${v.date} — ${v.car}`, body: `${v.doc} for ${v.car} expires on ${v.date}.` }),
    fr: (v) => ({ subject: `${v.doc} expire le ${v.date} — ${v.car}`, body: `${v.doc} pour ${v.car} expire le ${v.date}.` }),
    ar: (v) => ({ subject: `${v.doc} ينتهي في ${v.date} — ${v.car}`, body: `${v.doc} للمركبة ${v.car} ينتهي في ${v.date}.` }),
    es: (v) => ({ subject: `${v.doc} vence el ${v.date} — ${v.car}`, body: `${v.doc} de ${v.car} vence el ${v.date}.` }),
  },
  'weekly.recap': {
    en: (v) => ({
      subject: `Weekly recap: ${v.pickups} pickups, ${v.returns} returns, ${v.overdueCount} overdue`,
      body: `This week: ${v.pickups} pickups, ${v.returns} returns, ${v.overdueCount} overdue rentals (${v.overdueAmount} ${v.currency} outstanding), ${v.expiring} documents expiring soon.`,
    }),
    fr: (v) => ({
      subject: `Récapitulatif hebdomadaire : ${v.pickups} prises en charge, ${v.returns} retours, ${v.overdueCount} en retard`,
      body: `Cette semaine : ${v.pickups} prises en charge, ${v.returns} retours, ${v.overdueCount} locations en retard (${v.overdueAmount} ${v.currency} impayés), ${v.expiring} documents bientôt expirés.`,
    }),
    ar: (v) => ({
      subject: `الملخص الأسبوعي: ${v.pickups} عمليات استلام، ${v.returns} عمليات إرجاع، ${v.overdueCount} متأخرة`,
      body: `هذا الأسبوع: ${v.pickups} عمليات استلام، ${v.returns} عمليات إرجاع، ${v.overdueCount} إيجارات متأخرة (${v.overdueAmount} ${v.currency} غير مسددة)، ${v.expiring} وثائق تنتهي قريبًا.`,
    }),
    es: (v) => ({
      subject: `Resumen semanal: ${v.pickups} recogidas, ${v.returns} devoluciones, ${v.overdueCount} vencidos`,
      body: `Esta semana: ${v.pickups} recogidas, ${v.returns} devoluciones, ${v.overdueCount} alquileres vencidos (${v.overdueAmount} ${v.currency} pendientes), ${v.expiring} documentos a punto de vencer.`,
    }),
  },
  // Manual reminders keep the exact text shape the scheduler already
  // sent (title — label — linked name, due date): the template only
  // wraps it so the delivery log has a key for it.
  'reminder.manual': {
    en: (v) => ({ subject: String(v.message || ''), body: String(v.message || '') }),
    fr: (v) => ({ subject: String(v.message || ''), body: String(v.message || '') }),
    ar: (v) => ({ subject: String(v.message || ''), body: String(v.message || '') }),
    es: (v) => ({ subject: String(v.message || ''), body: String(v.message || '') }),
  },
  'contract.signed': {
    en: (v) => ({ subject: `Client signed online: contract ${v.reference}`, body: `${v.driver} signed contract ${v.reference} online.` }),
    fr: (v) => ({ subject: `Client a signé en ligne : contrat ${v.reference}`, body: `${v.driver} a signé le contrat ${v.reference} en ligne.` }),
    ar: (v) => ({ subject: `وقع العميل عبر الإنترنت: العقد ${v.reference}`, body: `وقع ${v.driver} العقد ${v.reference} عبر الإنترنت.` }),
    es: (v) => ({ subject: `Cliente firmó en línea: contrato ${v.reference}`, body: `${v.driver} firmó el contrato ${v.reference} en línea.` }),
  },
}

const normaliseLocale = (language?: string): TemplateLocale => {
  if (language === 'fr' || language === 'ar' || language === 'es') return language
  return 'en'
}

export const renderNotificationTemplate = (
  key: bookcarsTypes.NotificationTemplateKey,
  language: string | undefined,
  vars: TemplateVars,
): RenderedTemplate => {
  const locale = normaliseLocale(language)
  const fn = templates[key]?.[locale] || templates[key]?.en
  return fn(vars)
}
