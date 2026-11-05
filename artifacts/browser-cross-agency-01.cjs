// GA-P0-BROWSER-CROSS-AGENCY-01 (attempt 2 — corrected method)
// Cross-agency denial evidence from a second agency's authenticated session.
//
// Why two transports: backend auth (middlewares/authJwt.ts + utils/authHelper.ts)
// resolves the token from the signed admin cookie whenever the request Origin
// is the admin host, and only reads the x-access-token header for non-admin /
// non-frontend origins. Attempt 1 sent B's header token from inside the admin
// page (admin cookie also sent), so every "B" call silently ran as admin and
// the attempt was invalidated (its delete call removed the fixture expense as
// admin; the leftover B account was deleted separately and verified absent).
// This attempt: fixtures are created from the authenticated admin browser
// session (CDP page context); agency B signs in through the real API sign-in
// and its calls are made with B's token only, from a plain API client with no
// admin cookie and no admin Origin. The synthetic password/token exist only
// in this process's memory and are never printed or written to disk.
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const BASE = 'http://localhost:4002'
const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:9229' + p, (x) => { let d = ''; x.on('data', (c) => d += c); x.on('end', () => res(JSON.parse(d))) }).on('error', rej))

const apiJson = async (u, o = {}) => {
  const r = await fetch(BASE + u, { headers: { 'Content-Type': 'application/json' }, ...o })
  const text = await r.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data, text }
}

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
  const evaluate = async (expression) => {
    const x = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    const v = x.result && x.result.result ? x.result.result.value : undefined
    if (v === undefined) throw new Error('EVALUATE_FAILED ' + JSON.stringify(x.result).slice(0, 500))
    return v
  }

  const stamp = Date.now()
  const emailB = 'ga-xagency-' + stamp + '@fixture.local'
  const passwordB = 'Ga!' + crypto.randomBytes(18).toString('hex')

  // ---------- Part 1: fixtures from the authenticated admin browser session ----------
  const setup = await evaluate(`(async () => {
    const stamp = ${stamp}
    const base = 'http://localhost:4002'
    const content = '%PDF-1.4 GA-P0-BROWSER-CROSS-AGENCY-01 ' + stamp
    const req = async (u, o = {}) => { const r = await fetch(base + u, { credentials: 'include', ...o }); const text = await r.text(); let data; try { data = JSON.parse(text) } catch { data = text } return { status: r.status, data, text } }
    const json = async (u, o = {}) => req(u, { headers: { 'Content-Type': 'application/json' }, ...o })
    const out = {}
    const suppliers = await json('/api/all-suppliers')
    if (!Array.isArray(suppliers.data) || !suppliers.data.length) return { stage: 'suppliers', status: suppliers.status }
    const supplierA = suppliers.data[0]
    const carsRes = await json('/api/cars/1/20/?s=', { method: 'POST', body: JSON.stringify({ suppliers: [supplierA._id] }) })
    const rows = Array.isArray(carsRes.data) && carsRes.data[0] && Array.isArray(carsRes.data[0].resultData) ? carsRes.data[0].resultData : []
    if (!rows.length) return { stage: 'cars', status: carsRes.status }
    const carA = rows[0]
    out.agencyA = { _id: supplierA._id, fullName: supplierA.fullName }
    out.carA = { _id: carA._id, name: carA.name }
    const fd = new FormData()
    fd.append('file', new File([new Blob([content], { type: 'application/pdf' })], 'ga-xagency-receipt-' + stamp + '.pdf', { type: 'application/pdf' }))
    const upload = await req('/api/maintenance-expenses/receipts', { method: 'POST', body: fd })
    out.uploadReceipt = upload.status
    if (upload.status !== 201 || !upload.data || !upload.data.filename) return { ...out, stage: 'upload' }
    const created = await json('/api/maintenance-expenses', { method: 'POST', body: JSON.stringify({ car: carA._id, date: new Date().toISOString(), type: 'repair', amount: 321.75, vendor: 'GA cross-agency fixture garage', note: 'GA-P0-BROWSER-CROSS-AGENCY-01 ' + stamp, receipt: upload.data.filename }) })
    out.createExpenseA = created.status
    if (created.status !== 201 || !created.data || !created.data._id) return { ...out, stage: 'createExpense' }
    out.expenseA = created.data._id
    out.receiptA = created.data.receipt
    const ownerDownload = await req('/api/maintenance-expense-receipt/' + out.expenseA + '/' + out.receiptA)
    out.ownerDownloadBefore = ownerDownload.status
    out.ownerDownloadExact = ownerDownload.text === content
    const createB = await json('/api/create-user', { method: 'POST', body: JSON.stringify({ email: ${JSON.stringify(emailB)}, fullName: 'GA Cross Agency Fixture B', phone: '0600000000', location: '', bio: '', language: 'en', type: 'supplier', password: ${JSON.stringify(passwordB)}, payLater: true }) })
    out.createUserB = createB.status
    return out
  })()`)
  if (setup.stage || setup.createUserB !== 200) { console.error('SETUP_FAILED', JSON.stringify(setup, null, 2)); ws.close(); process.exit(4) }

  // ---------- Part 2: agency B via real API sign-in, token-only calls ----------
  const signinB = await apiJson('/api/sign-in/admin', { method: 'POST', body: JSON.stringify({ email: emailB, password: passwordB, mobile: true }) })
  const result = { ...setup, signinB: signinB.status }
  if (signinB.status !== 200 || !signinB.data || !signinB.data.accessToken) {
    console.error('SIGNIN_B_FAILED', JSON.stringify(result, null, 2)); ws.close(); process.exit(5)
  }
  const tokenB = signinB.data.accessToken
  const userBId = signinB.data._id
  result.agencyB = { _id: userBId, email: emailB }
  const asB = (u, o = {}) => apiJson(u, { headers: { 'Content-Type': 'application/json', 'x-access-token': tokenB }, ...o })
  const bList = await asB('/api/maintenance-expenses')
  result.bOwnExpenseList = bList.status
  result.bListContainsExpenseA = Array.isArray(bList.data) ? bList.data.some((row) => row && row._id === setup.expenseA) : null
  result.bListCount = Array.isArray(bList.data) ? bList.data.length : null
  const noTokenList = await apiJson('/api/maintenance-expenses')
  result.noTokenExpenseList = noTokenList.status
  const bDownload = await asB('/api/maintenance-expense-receipt/' + setup.expenseA + '/' + setup.receiptA)
  result.bDownloadReceiptA = bDownload.status
  const bReport = await asB('/api/maintenance-expenses/report')
  result.bReport = { status: bReport.status, total: bReport.data && typeof bReport.data.total === 'number' ? bReport.data.total : null, currency: bReport.data ? bReport.data.currency : null }
  const bDelete = await asB('/api/maintenance-expenses/' + setup.expenseA, { method: 'DELETE' })
  result.bDeleteExpenseA = bDelete.status

  // ---------- Part 3: owner verification + cleanup from admin session ----------
  const cleanup = await evaluate(`(async () => {
    const base = 'http://localhost:4002'
    const content = '%PDF-1.4 GA-P0-BROWSER-CROSS-AGENCY-01 ' + ${stamp}
    const req = async (u, o = {}) => { const r = await fetch(base + u, { credentials: 'include', ...o }); const text = await r.text(); let data; try { data = JSON.parse(text) } catch { data = text } return { status: r.status, data, text } }
    const json = async (u, o = {}) => req(u, { headers: { 'Content-Type': 'application/json' }, ...o })
    const expenseId = ${JSON.stringify(setup.expenseA)}
    const receipt = ${JSON.stringify(setup.receiptA)}
    const userBId = ${JSON.stringify(userBId)}
    const out = {}
    const ownerAfter = await req('/api/maintenance-expense-receipt/' + expenseId + '/' + receipt)
    out.ownerDownloadAfterBDeleteAttempt = ownerAfter.status
    out.ownerDownloadAfterBDeleteExact = ownerAfter.text === content
    const delExpense = await json('/api/maintenance-expenses/' + expenseId, { method: 'DELETE' })
    out.cleanupDeleteExpenseA = delExpense.status
    const afterDownload = await req('/api/maintenance-expense-receipt/' + expenseId + '/' + receipt)
    out.afterCleanupDownload = afterDownload.status
    const delB = await json('/api/delete-users', { method: 'POST', body: JSON.stringify([userBId]) })
    out.cleanupDeleteUserB = delB.status
    const getB = await json('/api/user/' + userBId)
    out.getUserBAfterDelete = getB.status
    return out
  })()`)
  Object.assign(result, cleanup)

  // ---------- Part 4: B can no longer sign in ----------
  const signinBAfter = await apiJson('/api/sign-in/admin', { method: 'POST', body: JSON.stringify({ email: emailB, password: passwordB, mobile: true }) })
  result.signinBAfterDelete = signinBAfter.status

  const artifact = {
    slice: 'GA-P0-BROWSER-CROSS-AGENCY-01',
    generatedAt: new Date().toISOString(),
    method: 'Fixtures created from the authenticated admin browser page context (CDP). Agency B authenticated through the real API sign-in (mobile token response); B calls carried only B token (no admin cookie, no admin Origin) because backend auth resolves admin-Origin requests to the signed admin cookie (middlewares/authJwt.ts, utils/authHelper.ts). Browser-session + API-client evidence, not physical UI clicks. Attempt 1 (same day) was invalidated for that cookie-precedence reason and is superseded by this run; its leftover B account was deleted and verified absent before this run. Synthetic password/token were held in process memory only and are not recorded.',
    result
  }
  fs.writeFileSync(path.join(__dirname, 'browser-cross-agency-01-latest.json'), JSON.stringify(artifact, null, 2))
  console.log(JSON.stringify(artifact, null, 2))
  ws.close()
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1) })
