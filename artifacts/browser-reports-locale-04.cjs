/*
 * GA-P1-ADMIN-AR-LOCALE-04 — Arabic parity evidence for /reports + dashboard.
 * Browser-session evidence in the authenticated automation profile (CDP):
 * renders each surface in Arabic and French and captures lang/dir, labels,
 * and (dashboard) a rendered booking date to verify ar-MA formatting.
 */
const fs = require('fs')
const http = require('http')
const OUT = 'C:\\Users\\Yassi\\Documents\\kimi\\Workspaces\\fleet\\bookcars\\artifacts\\browser-reports-ar-locale-latest.json'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:9229' + p, (x) => { let d = ''; x.on('data', (c) => d += c); x.on('end', () => res(JSON.parse(d))) }).on('error', rej))
const ev = { slice: 'GA-P1-ADMIN-AR-LOCALE-04', generatedAt: new Date().toISOString(), evidenceType: 'browser-session render capture (authenticated CDP profile)', checks: {}, captures: {} }
;(async () => {
  const targets = await get('/json')
  const page = targets.find((x) => x.type === 'page' && x.url.startsWith('http://localhost:3002'))
  if (!page) throw new Error('No admin page target on CDP')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let seq = 0; const pending = new Map(); const consoleErrors = []
  ws.onmessage = (e) => { const x = JSON.parse(e.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id) } else if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') { consoleErrors.push(x.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200)) } else if (x.method === 'Runtime.exceptionThrown') { consoleErrors.push('exception: ' + (x.params.exceptionDetails.text || '').slice(0, 160)) } }
  const cmd = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
  const evl = async (expression) => { const x = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return x.result && x.result.result ? x.result.result.value : undefined }
  async function waitFor(expression, what, ms = 20000) { const t0 = Date.now(); for (;;) { const v = await evl(expression); if (v) return v; if (Date.now() - t0 > ms) throw new Error('WAIT_TIMEOUT: ' + what); await sleep(400) } }
  await cmd('Page.enable'); await cmd('Runtime.enable')

  // --- /reports in Arabic ---
  await cmd('Page.navigate', { url: 'http://localhost:3002/reports?l=ar' })
  await waitFor(`document.querySelector('h1') && document.querySelector('h1').textContent.includes('التقارير')`, 'reports AR title')
  await sleep(2500) // allow summary load
  ev.captures.reportsAr = await evl(`(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, h1: document.querySelector('h1')?.textContent.trim(), subtitle: document.querySelector('.agency-dashboard__heading p')?.textContent.trim() || null, agencySelectPresent: !!document.querySelector('.agency-dashboard__heading .MuiSelect-select'), cardLabels: [...document.querySelectorAll('.MuiCard-root .MuiTypography-colorTextSecondary, .MuiCard-root p')].map((e) => e.textContent.trim()).filter(Boolean), cardValues: [...document.querySelectorAll('.MuiCard-root h5')].map((e) => e.textContent.trim()), footer: (() => { const els = [...document.querySelectorAll('main p, main .MuiTypography-root')].map((e) => e.textContent.trim()); return els.find((t) => t.includes('Africa') || t.includes('v2026')) || null })(), alerts: [...document.querySelectorAll('.MuiAlert-message')].map((a) => a.textContent.trim()), bodyHasFrench: /Rapports|Recettes encaiss\u00e9es|Utilisation de la flotte/.test(document.body.textContent), bodyHasEnglishFallback: /Reports|Revenue collected|Fleet utilization/.test(document.body.textContent) }))()`)
  // --- /reports in French ---
  await cmd('Page.navigate', { url: 'http://localhost:3002/reports?l=fr' })
  await waitFor(`document.querySelector('h1') && document.querySelector('h1').textContent.includes('Rapports')`, 'reports FR title')
  await sleep(2000)
  ev.captures.reportsFr = await evl(`(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, h1: document.querySelector('h1')?.textContent.trim(), cardLabels: [...document.querySelectorAll('.MuiCard-root .MuiTypography-colorTextSecondary, .MuiCard-root p')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 6) }))()`)
  // --- /dashboard in Arabic ---
  await cmd('Page.navigate', { url: 'http://localhost:3002/dashboard?l=ar' })
  await waitFor(`document.querySelector('h1') && document.querySelector('h1').textContent.includes('يومك')`, 'dashboard AR title')
  await sleep(3000) // allow bookings/cars load
  ev.captures.dashboardAr = await evl(`(() => { const text = document.body.textContent.replace(/\\s+/g, ' '); const months = ['يناير','فبراير','مارس','أبريل','ماي','يونيو','يوليوز','غشت','شتنبر','أكتوبر','نونبر','دجنبر']; const arDate = months.find((m) => text.includes(m)) || null; const enDatePattern = /\\b\\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{2}:\\d{2}\\b/.test(text); return { lang: document.documentElement.lang, dir: document.documentElement.dir, h1: document.querySelector('h1')?.textContent.trim(), arabicMonthRendered: arDate, englishDatePatternPresent: enDatePattern, emptyBookingsArabic: text.includes('لا توجد حجوزات للعرض حالياً'), loadErrorShown: text.includes('تعذر تحميل بيانات الوكالة') || text.includes('could not be loaded'), hasArabicLabels: ['المركبات المتاحة','قيد التأجير','وصول سريع','دفتر الصندوق'].filter((s) => text.includes(s)) } })()`)
  // --- /dashboard in French ---
  await cmd('Page.navigate', { url: 'http://localhost:3002/dashboard?l=fr' })
  await waitFor(`document.querySelector('h1') && document.querySelector('h1').textContent.includes('Votre journée')`, 'dashboard FR title')
  await sleep(1500)
  ev.captures.dashboardFr = await evl(`(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, h1: document.querySelector('h1')?.textContent.trim() }))()`)

  ev.consoleErrors = consoleErrors
  const R = ev.captures.reportsAr, D = ev.captures.dashboardAr
  ev.checks = {
    reportsArLangDir: R.lang === 'ar' && R.dir === 'rtl',
    reportsArTitle: R.h1 === 'التقارير',
    reportsArNoFrenchFallback: !R.bodyHasFrench,
    reportsArNoEnglishFallback: !R.bodyHasEnglishFallback,
    reportsArNoErrorAlert: R.alerts.length === 0,
    reportsArCardsRendered: R.cardLabels.length >= 5,
    reportsFrTitle: ev.captures.reportsFr.h1 === 'Rapports' && ev.captures.reportsFr.dir === 'ltr',
    dashboardArLangDir: D.lang === 'ar' && D.dir === 'rtl',
    dashboardArTitle: D.h1 === 'يومك',
    dashboardArLabelsPresent: D.hasArabicLabels.length >= 3,
    dashboardArDateFormat: D.arabicMonthRendered !== null && !D.englishDatePatternPresent,
    dashboardFrTitle: ev.captures.dashboardFr.h1 === 'Votre journée',
    noConsoleErrors: consoleErrors.length === 0,
  }
  ev.allChecksPassed = Object.values(ev.checks).every(Boolean)
  fs.writeFileSync(OUT, JSON.stringify(ev, null, 2))
  console.log(JSON.stringify({ checks: ev.checks, allChecksPassed: ev.allChecksPassed, consoleErrors }, null, 1))
  ws.close()
})().catch((e) => { ev.error = e.message; try { fs.writeFileSync(OUT, JSON.stringify(ev, null, 2)) } catch {} ; console.error('FAILED', e.message); process.exit(1) })
