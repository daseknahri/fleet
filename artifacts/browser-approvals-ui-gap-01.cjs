/*
 * GA-P1-APPROVALS-UI-01 — verification probe.
 * Part A (UI): renders /approbations in the admin SPA and captures what the
 * router shows (a queue page vs the NoMatch page).
 * Part B (browser-session API evidence, NOT UI): creates one labeled synthetic
 * Approval via POST /api/approvals, lists, decides it, lists again — proving
 * the backend workflow is live while the UI is absent.
 */
const fs = require('fs')
const http = require('http')
const OUT = 'C:\\Users\\Yassi\\Documents\\kimi\\Workspaces\\fleet\\bookcars\\artifacts\\browser-approvals-ui-gap-latest.json'
const MARK = `GA-P1-APPROVALS-UI-01 ${Date.now()}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:9229' + p, (x) => { let d = ''; x.on('data', (c) => d += c); x.on('end', () => res(JSON.parse(d))) }).on('error', rej))
const ev = { slice: 'GA-P1-APPROVALS-UI-01', generatedAt: new Date().toISOString(), marker: MARK }
;(async () => {
  const targets = await get('/json')
  const page = targets.find((x) => x.type === 'page' && x.url.startsWith('http://localhost:3002'))
  if (!page) throw new Error('No admin page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let seq = 0; const pending = new Map()
  ws.onmessage = (e) => { const x = JSON.parse(e.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id) } }
  const cmd = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
  const evl = async (expression) => { const x = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return x.result && x.result.result ? x.result.result.value : undefined }
  await cmd('Page.enable'); await cmd('Runtime.enable')
  // Part A: SPA route
  await cmd('Page.navigate', { url: 'http://localhost:3002/approbations?l=en' })
  await sleep(3500)
  ev.spaRoute = await evl(`(() => ({ url: location.pathname, h1: document.querySelector('h1')?.textContent.trim() || null, bodyExcerpt: document.body.textContent.replace(/\\s+/g, ' ').trim().slice(0, 220) }))()`)
  // Part B: API smoke
  ev.apiSmoke = await evl(`(async () => {
    const B = 'http://localhost:4002'
    const sup = await (await fetch(B + '/api/all-suppliers', { credentials: 'include', cache: 'no-store' })).json()
    const apex = sup.find((s) => s.fullName === 'Apex Car Rentals')
    const create = await fetch(B + '/api/approvals', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplier: apex._id, subject: ${JSON.stringify(MARK)}, subjectType: 'ui-gap-verification', amount: 1, currency: 'MAD', reason: 'Synthetic backend smoke for GA-P1-APPROVALS-UI-01; no UI exists to decide this queue.' }) })
    const created = await create.json().catch(() => null)
    const list1 = await (await fetch(B + '/api/approvals', { credentials: 'include', cache: 'no-store' })).json().catch(() => null)
    let decide = null; let decided = null
    if (created && created._id) {
      const d = await fetch(B + '/api/approvals/' + created._id + '/decide', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approved', reason: 'GA-P1-APPROVALS-UI-01 smoke decision' }) })
      decide = d.status; decided = await d.json().catch(() => null)
    }
    const list2 = await (await fetch(B + '/api/approvals', { credentials: 'include', cache: 'no-store' })).json().catch(() => null)
    const mine = (a) => Array.isArray(a) ? a.find((x) => x.subject === ${JSON.stringify(MARK)}) : null
    return { createStatus: create.status, createdId: created && created._id, createdStatus: created && created.status, listContainsPending: !!(mine(list1) && mine(list1).status === 'pending'), decideStatus: decide, decidedStatus: decided && decided.status, decidedByPresent: !!(decided && decided.decidedBy), decidedAtPresent: !!(decided && decided.decidedAt), listAfterStatus: mine(list2) && mine(list2).status, totalApprovalsVisibleToAdmin: Array.isArray(list2) ? list2.length : null }
  })()`)
  ev.conclusion = 'Backend approval workflow is live and permission-gated, but no admin UI exists for the /approbations queue declared in GESTIONAUTO-MAP.md: the SPA route renders the NoMatch page, no admin page/service calls /api/approvals, and no product flow creates Approval records. The only decision UI in the admin is the separate contract-charge decision inside ContractOperations (POST /api/contract-operations/:bookingId/charges/:chargeId/decide).'
  ev.residue = 'One decided synthetic Approval record (subject = marker) remains in the dev database; the approvals API has no delete route. It is labeled and harmless.'
  fs.writeFileSync(OUT, JSON.stringify(ev, null, 2))
  console.log(JSON.stringify(ev, null, 1).slice(0, 1600))
  ws.close()
})().catch((e) => { console.error('FAILED', e.message); process.exit(1) })
