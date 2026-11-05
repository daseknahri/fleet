// GA-P1-ADMIN-AR-LOCALE-03
// Browser evidence for Arabic parity on the admin /maintenance surface.
// Creates one synthetic expense (known date + mileage) from the authenticated
// admin session, renders /maintenance in Arabic and French, captures the
// document language/direction, headings and the rendered date cell, then
// deletes the fixture by exact ID. Browser-session evidence via CDP.
const http = require('http')
const fs = require('fs')
const path = require('path')

const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:9229' + p, (x) => { let d = ''; x.on('data', (c) => d += c); x.on('end', () => res(JSON.parse(d))) }).on('error', rej))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const targets = await get('/json')
  const t = targets.find((x) => x.type === 'page' && x.url.startsWith('http://localhost:3002'))
  if (!t) { console.error('NO_ADMIN_TARGET'); process.exit(2) }
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let i = 0; const pending = new Map()
  ws.onmessage = (e) => { const x = JSON.parse(e.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id) } }
  const call = (method, params = {}) => new Promise((r) => { const id = ++i; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
  await call('Runtime.enable')
  await call('Page.enable')
  const evaluate = async (expression) => {
    const x = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    const v = x.result && x.result.result ? x.result.result.value : undefined
    if (v === undefined) throw new Error('EVALUATE_FAILED ' + JSON.stringify(x.result).slice(0, 400))
    return v
  }

  // Fixture: one expense on 2026-11-04 with mileage, via admin session API.
  const setup = await evaluate(`(async () => {
    const base = 'http://localhost:4002'
    const json = async (u, o = {}) => { const r = await fetch(base + u, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...o }); const text = await r.text(); let data; try { data = JSON.parse(text) } catch { data = text } return { status: r.status, data } }
    const suppliers = await json('/api/all-suppliers')
    const carsRes = await json('/api/cars/1/20/?s=', { method: 'POST', body: JSON.stringify({ suppliers: [suppliers.data[0]._id] }) })
    const car = carsRes.data[0].resultData[0]
    const created = await json('/api/maintenance-expenses', { method: 'POST', body: JSON.stringify({ car: car._id, date: '2026-11-04T10:00:00.000Z', type: 'repair', amount: 222.5, mileage: 123456, vendor: 'GA locale fixture', note: 'GA-P1-ADMIN-AR-LOCALE-03' }) })
    return { createStatus: created.status, expenseId: created.data && created.data._id, car: car.name }
  })()`)
  if (setup.createStatus !== 201 || !setup.expenseId) { console.error('SETUP_FAILED', JSON.stringify(setup)); process.exit(4) }

  const capture = async (lang) => {
    await call('Page.navigate', { url: 'http://localhost:3002/maintenance?l=' + lang })
    let snap = null
    for (let n = 0; n < 24; n++) {
      await sleep(700)
      snap = await evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll('.agency-maintenance__row'))
        const row = rows.find((r) => r.textContent && r.textContent.includes('GA locale fixture'))
        const h1 = document.querySelector('h1')
        const head = document.querySelector('.agency-maintenance__table-head')
        return {
          url: location.href,
          docLang: document.documentElement.lang,
          dir: document.documentElement.dir,
          h1: h1 ? h1.textContent.trim() : null,
          tableHead: head ? head.textContent.replace(/\\s+/g, ' ').trim() : null,
          rowFound: !!row,
          rowDate: row ? (row.querySelector('.agency-maintenance__date') || {}).textContent : null,
          rowText: row ? row.textContent.replace(/\\s+/g, ' ').trim().slice(0, 220) : null,
          bodyHasArabicTitle: document.body.textContent.includes('الصيانة والمصروفات'),
          bodyHasFrenchTitle: document.body.textContent.includes('Entretien et dépenses')
        }
      })()`)
      if (snap.rowFound && snap.h1) break
    }
    return snap
  }

  const ar = await capture('ar')
  const fr = await capture('fr')
  // Leave the session back in Arabic, as found.
  await call('Page.navigate', { url: 'http://localhost:3002/maintenance?l=ar' })
  await sleep(1200)

  const cleanup = await evaluate(`(async () => {
    const r = await fetch('http://localhost:4002/api/maintenance-expenses/${setup.expenseId}', { method: 'DELETE', credentials: 'include' })
    const list = await fetch('http://localhost:4002/api/maintenance-expenses', { credentials: 'include' }).then((x) => x.json()).catch(() => null)
    return { deleteStatus: r.status, stillListed: Array.isArray(list) ? list.some((row) => row && row._id === '${setup.expenseId}') : null }
  })()`)

  const artifact = {
    slice: 'GA-P1-ADMIN-AR-LOCALE-03',
    generatedAt: new Date().toISOString(),
    method: 'Authenticated admin browser session (CDP): one synthetic expense created via the session API, /maintenance rendered with ?l=ar and ?l=fr, DOM language/direction/headings/date cell captured; fixture deleted by exact ID afterwards. Browser-session rendering evidence, not physical clicks.',
    fixture: setup,
    arabic: ar,
    french: fr,
    checks: {
      arRtl: ar.dir === 'rtl',
      arDocLang: ar.docLang,
      arTitleArabic: ar.bodyHasArabicTitle && !ar.bodyHasFrenchTitle,
      arDateHasArabicScript: !!ar.rowDate && /[\u0600-\u06FF]/.test(ar.rowDate),
      arDateHasEnglishMonth: !!ar.rowDate && /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(ar.rowDate),
      frTitleFrench: fr.bodyHasFrenchTitle,
      frDate: fr.rowDate
    },
    cleanup
  }
  fs.writeFileSync(path.join(__dirname, 'browser-maintenance-ar-locale-latest.json'), JSON.stringify(artifact, null, 2))
  console.log(JSON.stringify(artifact, null, 2))
  ws.close()
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1) })
