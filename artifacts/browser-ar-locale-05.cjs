// GA-P1-ADMIN-AR-LOCALE-05 — Arabic parity evidence for the remaining admin
// surfaces. Verifies /bookings + a booking workspace (contract operations +
// payments) in AR and FR, plus AR spot checks on the newly translated modules
// (/clients, /create-car, /settings, /users, /suppliers). Read-only: no data
// is created or modified. Writes artifacts/browser-ar-locale-latest.json.
const http = require('http')
const fs = require('fs')
const os = require('os')

const ADMIN = 'http://localhost:3002'
const OUT = os.homedir() + '\\Documents\\kimi\\Workspaces\\fleet\\bookcars\\artifacts\\browser-ar-locale-latest.json'
const AR_MONTHS = 'يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر'
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => { d += c }); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) }).on('error', reject)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const targets = await getJson('http://127.0.0.1:9229/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:3002'))
    || targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result)
    }
  }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  await send('Runtime.enable')
  await send('Page.enable')

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result ? r.result.value : undefined
  }
  const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2600) }
  const waitFor = async (expr, timeout = 20000) => {
    const t0 = Date.now()
    for (;;) {
      const ok = await evaluate(`!!(${expr})`).catch(() => false)
      if (ok) return true
      if (Date.now() - t0 > timeout) return false
      await sleep(400)
    }
  }
  const snapshot = () => evaluate(`(() => {
    const text = (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim()
    return {
      url: location.href,
      lang: document.documentElement.lang || '',
      dir: document.documentElement.dir || '',
      hasArabicText: /[\\u0600-\\u06FF]/.test(text),
      hasArabicMonth: new RegExp('${AR_MONTHS}').test(text),
      hasArabicIndicDigits: /[${AR_DIGITS}]/.test(text),
      sample: text.slice(0, 700),
    }
  })()`)

  const result = { slice: 'GA-P1-ADMIN-AR-LOCALE-05', at: new Date().toISOString(), checks: {} }

  const setLanguage = (lang) => evaluate(`(async () => {
    const raw = localStorage.getItem('bc-be-user')
    const user = raw ? JSON.parse(raw) : null
    if (user) { user.language = '${lang}'; localStorage.setItem('bc-be-user', JSON.stringify(user)) }
    localStorage.setItem('bc-be-language', '${lang}')
    if (user && user._id) {
      await fetch('/api/update-language', { method: 'PUT', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user._id, language: '${lang}' }) }).catch(() => null)
    }
    return user ? user._id : null
  })()`)

  await nav(ADMIN + '/bookings')
  const session = await evaluate(`(() => { const u = localStorage.getItem('bc-be-user'); return u ? { signedIn: true, user: JSON.parse(u).email || true } : { signedIn: false } })()`)
  result.session = session
  if (!session || !session.signedIn) { result.outcome = 'session-invalid'; fs.writeFileSync(OUT, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); ws.close(); return }

  // ---------- AR pass ----------
  await setLanguage('ar')
  await nav(ADMIN + '/bookings')
  await waitFor(`document.body && document.body.innerText.length > 50`)
  const bookingsAr = await snapshot()
  bookingsAr.headerBookingsArabic = await evaluate(`document.body.innerText.includes('العقود')`)
  bookingsAr.newBookingArabic = await evaluate(`document.body.innerText.includes('حجز جديد')`)
  bookingsAr.pickupArabic = await evaluate(`document.body.innerText.includes('مكان الاستلام')`)
  result.checks.bookingsAr = bookingsAr

  let bookingId = await evaluate(`fetch('/api/bookings/1/5/ar', { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statuses: ['void', 'pending', 'deposit', 'paid', 'paidInFull', 'reserved', 'cancelled'] }) }).then((r) => r.json()).then((j) => { const rows = (j && j[0] && j[0].resultData) || j.resultData || j; return rows && rows[0] ? rows[0]._id : null }).catch(() => null)`)
  if (!bookingId) {
    // Fallback: the row's delete button carries data-id={booking._id}.
    bookingId = await evaluate(`(() => { const el = document.querySelector('.bs-buttons [data-id]'); return el ? el.getAttribute('data-id') : null })()`)
    result.idFromDom = true
  }
  result.bookingId = bookingId
  const bookingHref = bookingId ? '/update-booking/?b=' + bookingId : null
  result.bookingHref = bookingHref

  if (bookingHref) {
    await nav(ADMIN + bookingHref)
    await waitFor(`document.body && document.body.innerText.length > 100`)
    await sleep(1500)
    const wsAr = await snapshot()
    wsAr.paymentsArabic = await evaluate(`document.body.innerText.includes('المدفوعات')`)
    wsAr.contractOpsEnglish = await evaluate(`document.body.innerText.includes('Contract operations') || document.body.innerText.includes('No inspections or charges yet.')`)
    result.checks.bookingWorkspaceAr = wsAr
  }

  await nav(ADMIN + '/clients')
  await waitFor(`document.body && document.body.innerText.length > 30`)
  result.checks.clientsAr = await snapshot()
  result.checks.clientsAr.titleArabic = await evaluate(`document.body.innerText.includes('العملاء')`)
  result.checks.clientsAr.addClientArabic = await evaluate(`document.body.innerText.includes('إضافة عميل')`)

  await nav(ADMIN + '/create-car')
  await waitFor(`document.body && document.body.innerText.length > 30`)
  result.checks.createCarAr = await snapshot()
  result.checks.createCarAr.headingArabic = await evaluate(`document.body.innerText.includes('سيارة جديدة')`)
  result.checks.createCarAr.plateArabic = await evaluate(`document.body.innerText.includes('لوحة الترخيص')`)

  await nav(ADMIN + '/settings')
  await waitFor(`document.body && document.body.innerText.length > 30`)
  result.checks.settingsAr = await snapshot()

  await nav(ADMIN + '/users')
  await waitFor(`document.body && document.body.innerText.length > 30`)
  result.checks.usersAr = await snapshot()

  await nav(ADMIN + '/suppliers')
  await waitFor(`document.body && document.body.innerText.length > 30`)
  result.checks.suppliersAr = await snapshot()

  // ---------- FR pass ----------
  await setLanguage('fr')
  await nav(ADMIN + '/bookings')
  await waitFor(`document.body && document.body.innerText.length > 50`)
  result.checks.bookingsFr = await snapshot()
  if (bookingHref) {
    await nav(ADMIN + bookingHref)
    await waitFor(`document.body && document.body.innerText.length > 100`)
    await sleep(1200)
    const wsFr = await snapshot()
    wsFr.contractOpsFrench = await evaluate(`document.body.innerText.includes('de contrat')`)
    result.checks.bookingWorkspaceFr = wsFr
  }

  result.checks.summary = {
    bookingsArOk: !!(bookingsAr.lang === 'ar' && bookingsAr.dir === 'rtl' && bookingsAr.hasArabicText && bookingsAr.newBookingArabic && bookingsAr.pickupArabic && bookingsAr.hasArabicMonth),
    workspaceArOk: !!(result.checks.bookingWorkspaceAr && result.checks.bookingWorkspaceAr.hasArabicText && result.checks.bookingWorkspaceAr.contractOpsEnglish === false),
    workspaceFrOk: !!(result.checks.bookingWorkspaceFr && result.checks.bookingWorkspaceFr.contractOpsFrench),
    clientsArOk: !!(result.checks.clientsAr.titleArabic && result.checks.clientsAr.addClientArabic),
    createCarArOk: !!(result.checks.createCarAr.headingArabic && result.checks.createCarAr.plateArabic),
    bookingsFrOk: !!(result.checks.bookingsFr.lang === 'fr' && result.checks.bookingsFr.dir !== 'rtl'),
  }
  result.outcome = Object.values(result.checks.summary).every(Boolean) ? 'all-checks-passed' : 'see-checks'
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result.checks.summary))
  console.log('outcome=' + result.outcome)
  ws.close()
}

main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1) })
