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
    en: (v) => ({ subject: `Overdue: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Overdue rental: ${v.car} for ${v.driver}, ${v.amount} ${v.currency} outstanding since ${v.date}. This is reminder #${v.repeatCount}.` }),
    fr: (v) => ({ subject: `En retard : ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Location en retard : ${v.car} pour ${v.driver}, ${v.amount} ${v.currency} impayés depuis le ${v.date}. Ceci est le rappel n°${v.repeatCount}.` }),
    ar: (v) => ({ subject: `متأخر: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `إيجار متأخر: ${v.car} للسائق ${v.driver}، ${v.amount} ${v.currency} غير مسددة منذ ${v.date}. هذا هو التذكير رقم ${v.repeatCount}.` }),
    es: (v) => ({ subject: `Vencido: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Alquiler vencido: ${v.car} para ${v.driver}, ${v.amount} ${v.currency} pendientes desde el ${v.date}. Este es el recordatorio n.º ${v.repeatCount}.` }),
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

// GH-03 / GH-14 / GH-11 — Wave 3.2 templates. Kept in a separate
// map (keyed by plain string) so the backend compiles before the
// shared NotificationTemplateKey union gains them (optional types
// script); renderNotificationTemplate consults both maps.
const extraTemplates: Record<string, Record<TemplateLocale, TemplateFn>> = {
  'auto.holdExpiring': {
    en: (v) => ({ subject: `Hold expiring: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Pay-later hold expires ${v.date}: ${v.car} for ${v.driver}, ${v.amount} ${v.currency} still outstanding. Confirm the reservation or the hold lapses.` }),
    fr: (v) => ({ subject: `Réservation expirant : ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `La réservation « payer plus tard » expire le ${v.date} : ${v.car} pour ${v.driver}, ${v.amount} ${v.currency} toujours impayés. Confirmez la réservation, sinon elle expire.` }),
    ar: (v) => ({ subject: `الحجز ينتهي: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `ينتهي حجز «ادفع لاحقًا» في ${v.date}: ${v.car} للسائق ${v.driver}، ${v.amount} ${v.currency} لا تزال غير مسددة. أكّد الحجز وإلا سينتهي.` }),
    es: (v) => ({ subject: `Reserva a punto de caducar: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `La reserva «pagar más tarde» caduca el ${v.date}: ${v.car} para ${v.driver}, ${v.amount} ${v.currency} aún pendientes. Confirme la reserva o caducará.` }),
  },
  'auto.paymentDue': {
    en: (v) => ({ subject: `Payment due before pickup: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Pickup ${v.date}: ${v.car} for ${v.driver}, ${v.amount} ${v.currency} still outstanding. Collect it at pickup (cash or bank transfer).` }),
    fr: (v) => ({ subject: `Paiement dû avant la prise en charge : ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Prise en charge le ${v.date} : ${v.car} pour ${v.driver}, ${v.amount} ${v.currency} toujours impayés. Encaissez-les à la prise en charge (espèces ou virement).` }),
    ar: (v) => ({ subject: `دفعة مستحقة قبل الاستلام: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `الاستلام ${v.date}: ${v.car} للسائق ${v.driver}، ${v.amount} ${v.currency} لا تزال غير مسددة. حصّلها عند الاستلام (نقدًا أو بتحويل بنكي).` }),
    es: (v) => ({ subject: `Pago pendiente antes de la recogida: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Recogida el ${v.date}: ${v.car} para ${v.driver}, ${v.amount} ${v.currency} aún pendientes. Cóbrelos en la recogida (efectivo o transferencia).` }),
  },
  'auto.missedPickup': {
    en: (v) => ({ subject: `Missed pickup: ${v.car} — ${v.driver}`, body: `Pickup was ${v.date}: ${v.car} for ${v.driver} was not collected (${v.amount} ${v.currency} outstanding). Call the client or mark no-show.` }),
    fr: (v) => ({ subject: `Prise en charge manquée : ${v.car} — ${v.driver}`, body: `La prise en charge était le ${v.date} : ${v.car} pour ${v.driver} n'a pas été récupéré (${v.amount} ${v.currency} impayés). Appelez le client ou marquez absent.` }),
    ar: (v) => ({ subject: `استلام فائت: ${v.car} — ${v.driver}`, body: `كان الاستلام في ${v.date}: لم يتم استلام ${v.car} للسائق ${v.driver} (${v.amount} ${v.currency} غير مسددة). اتصل بالعميل أو سجّله غائبًا.` }),
    es: (v) => ({ subject: `Recogida perdida: ${v.car} — ${v.driver}`, body: `La recogida era el ${v.date}: ${v.car} para ${v.driver} no fue recogido (${v.amount} ${v.currency} pendientes). Llame al cliente o marque no presentado.` }),
  },
  'auto.overdueEscalate': {
    en: (v) => ({ subject: `ESCALATION — ${v.days} days overdue: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Overdue ${v.days} days since ${v.date}: ${v.car} for ${v.driver}, ${v.amount} ${v.currency} outstanding. Owner action needed.` }),
    fr: (v) => ({ subject: `ESCALADE — ${v.days} jours de retard : ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `En retard de ${v.days} jours depuis le ${v.date} : ${v.car} pour ${v.driver}, ${v.amount} ${v.currency} impayés. Action du responsable requise.` }),
    ar: (v) => ({ subject: `تصعيد — متأخر ${v.days} يومًا: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `متأخر ${v.days} يومًا منذ ${v.date}: ${v.car} للسائق ${v.driver}، ${v.amount} ${v.currency} غير مسددة. يلزم تدخل المسؤول.` }),
    es: (v) => ({ subject: `ESCALADA — ${v.days} días vencido: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Vencido desde hace ${v.days} días (desde el ${v.date}): ${v.car} para ${v.driver}, ${v.amount} ${v.currency} pendientes. Se requiere acción del responsable.` }),
  },
  'auto.pendingRefund': {
    en: (v) => ({ subject: `Pending refund: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Refund of ${v.amount} ${v.currency} for ${v.car} (${v.driver}) is still pending since ${v.date} (${v.reason}). Send it or resolve it.` }),
    fr: (v) => ({ subject: `Remboursement en attente : ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Le remboursement de ${v.amount} ${v.currency} pour ${v.car} (${v.driver}) est toujours en attente depuis le ${v.date} (${v.reason}). Envoyez-le ou résolvez-le.` }),
    ar: (v) => ({ subject: `استرداد معلق: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `لا يزال استرداد ${v.amount} ${v.currency} لـ ${v.car} (${v.driver}) معلقًا منذ ${v.date} (${v.reason}). أرسله أو قم بتسويته.` }),
    es: (v) => ({ subject: `Reembolso pendiente: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `El reembolso de ${v.amount} ${v.currency} de ${v.car} (${v.driver}) sigue pendiente desde el ${v.date} (${v.reason}). Envíelo o resuélvalo.` }),
  },
  // R6-28 — the held-for-review notice (auto.holdReview): the
  // notifiers build their own i18n message today, so nothing
  // renders this entry yet; it makes the delivery key a
  // first-class template (the delivery-retry endpoint replays
  // the stored subject/body and never re-renders, so the key
  // choice does not break retry).
  'auto.holdReview': {
    en: (v) => ({ subject: `Held for review: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `Booking ${v.reference} (${v.car} for ${v.driver}, ${v.amount} ${v.currency}) is held for manual review since ${v.date}. Check the paid-unconfirmed queue.` }),
    fr: (v) => ({ subject: `En attente de vérification : ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `La réservation ${v.reference} (${v.car} pour ${v.driver}, ${v.amount} ${v.currency}) est en attente de vérification manuelle depuis le ${v.date}. Consultez la file des réservations payées non confirmées.` }),
    ar: (v) => ({ subject: `قيد المراجعة: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `الحجز ${v.reference} (${v.car} للسائق ${v.driver}، ${v.amount} ${v.currency}) قيد المراجعة اليدوية منذ ${v.date}. راجع قائمة الحجوزات المدفوعة غير المؤكدة.` }),
    es: (v) => ({ subject: `En revisión: ${v.car} — ${v.driver} — ${v.amount} ${v.currency}`, body: `La reserva ${v.reference} (${v.car} para ${v.driver}, ${v.amount} ${v.currency}) está en revisión manual desde el ${v.date}. Revise la cola de reservas pagadas sin confirmar.` }),
  },
  'auto.staleWorkOrder': {
    en: (v) => ({ subject: `Stale work order: ${v.title} — ${v.car}`, body: `Work order "${v.title}" for ${v.car} was scheduled for ${v.date} (${v.days} days ago) and is still Scheduled. Start it, reschedule it, or cancel it.` }),
    fr: (v) => ({ subject: `Ordre de travail en retard : ${v.title} — ${v.car}`, body: `L'ordre de travail « ${v.title} » pour ${v.car} était planifié le ${v.date} (il y a ${v.days} jours) et est toujours planifié. Démarrez-le, replanifiez-le ou annulez-le.` }),
    ar: (v) => ({ subject: `أمر عمل متأخر: ${v.title} — ${v.car}`, body: `كان أمر العمل "${v.title}" للسيارة ${v.car} مجدولًا ليوم ${v.date} (منذ ${v.days} أيام) وما زال في حالة "مجدول". ابدأه أو أعد جدولته أو ألغه.` }),
    es: (v) => ({ subject: `Orden de trabajo atrasada: ${v.title} — ${v.car}`, body: `La orden de trabajo «${v.title}» para ${v.car} estaba programada para el ${v.date} (hace ${v.days} días) y sigue programada. Iníciela, reprográmela o cancélela.` }),
  },
}

export const renderNotificationTemplate = (
  key: bookcarsTypes.NotificationTemplateKey,
  language: string | undefined,
  vars: TemplateVars,
): RenderedTemplate => {
  const locale = normaliseLocale(language)
  const fn = templates[key]?.[locale] || extraTemplates[key]?.[locale] || templates[key]?.en || extraTemplates[key]?.en
  return fn(vars)
}
