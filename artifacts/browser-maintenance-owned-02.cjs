// GA-P0-MAINTENANCE-BROWSER-02
// Authenticated browser-session owned maintenance receipt lifecycle.
// Runs inside the already-authenticated admin page context via CDP.
// Creates exactly one synthetic expense + receipt, verifies the private
// download, deletes the expense, and verifies the receipt is gone.
// No preserved records are touched; cleanup is by the created expense ID.
const http = require('http')
const fs = require('fs')
const path = require('path')

const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:9229' + p, (x) => { let d = ''; x.on('data', (c) => d += c); x.on('end', () => res(JSON.parse(d))) }).on('error', rej))

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

  const expression = `(async () => {
    const stamp = Date.now()
    const base = 'http://localhost:4002'
    const content = '%PDF-1.4 GA-P0-MAINTENANCE-BROWSER-02 ' + stamp
    const req = async (u, o = {}) => {
      const r = await fetch(base + u, { credentials: 'include', ...o })
      const text = await r.text()
      let data; try { data = JSON.parse(text) } catch { data = text }
      return { status: r.status, data, text }
    }
    const json = async (u, o = {}) => req(u, { headers: { 'Content-Type': 'application/json' }, ...o })

    const suppliers = await json('/api/all-suppliers')
    if (!Array.isArray(suppliers.data) || !suppliers.data.length) return { stage: 'suppliers', status: suppliers.status }
    const supplier = suppliers.data[0]

    const carsRes = await json('/api/cars/1/20/?s=', { method: 'POST', body: JSON.stringify({ suppliers: [supplier._id] }) })
    const rows = Array.isArray(carsRes.data) && carsRes.data[0] && Array.isArray(carsRes.data[0].resultData) ? carsRes.data[0].resultData : []
    if (!rows.length) return { stage: 'cars', status: carsRes.status }
    const car = rows[0]

    const fd = new FormData()
    fd.append('file', new File([new Blob([content], { type: 'application/pdf' })], 'ga-browser-receipt-' + stamp + '.pdf', { type: 'application/pdf' }))
    const upload = await req('/api/maintenance-expenses/receipts', { method: 'POST', body: fd })
    if (upload.status !== 201 || !upload.data || !upload.data.filename) return { stage: 'upload', status: upload.status, data: upload.data }

    const created = await json('/api/maintenance-expenses', { method: 'POST', body: JSON.stringify({ car: car._id, date: new Date().toISOString(), type: 'repair', amount: 123.45, vendor: 'GA browser fixture garage', note: 'GA-P0-MAINTENANCE-BROWSER-02 ' + stamp, receipt: upload.data.filename }) })
    if (created.status !== 201 || !created.data || !created.data._id) return { stage: 'create', status: created.status, data: created.data, uploadedReceipt: upload.data.filename }
    const expenseId = created.data._id
    const receipt = created.data.receipt

    const download = await req('/api/maintenance-expense-receipt/' + expenseId + '/' + receipt)
    const unauthenticated = await fetch(base + '/api/maintenance-expense-receipt/' + expenseId + '/' + receipt)
    const removed = await json('/api/maintenance-expenses/' + expenseId, { method: 'DELETE' })
    const afterDelete = await req('/api/maintenance-expense-receipt/' + expenseId + '/' + receipt)
    const list = await json('/api/maintenance-expenses')
    const stillListed = Array.isArray(list.data) ? list.data.some((row) => row && row._id === expenseId) : null

    return {
      supplier: { _id: supplier._id, fullName: supplier.fullName },
      car: { _id: car._id, name: car.name },
      upload: upload.status,
      create: created.status,
      expenseId,
      receipt,
      createdSupplier: created.data.supplier && (created.data.supplier._id || created.data.supplier),
      download: download.status,
      downloadExactContent: download.text === content,
      unauthenticatedDownload: unauthenticated.status,
      delete: removed.status,
      afterDeleteDownload: afterDelete.status,
      stillListedAfterDelete: stillListed
    }
  })()`

  const x = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  const value = x.result && x.result.result ? x.result.result.value : undefined
  if (!value) { console.error('EVALUATE_FAILED', JSON.stringify(x.result, null, 2).slice(0, 2000)); process.exit(3) }
  const artifact = {
    slice: 'GA-P0-MAINTENANCE-BROWSER-02',
    generatedAt: new Date().toISOString(),
    method: 'Authenticated admin browser page context (CDP) executing application API calls; browser-session evidence, not physical UI clicks.',
    result: value
  }
  fs.writeFileSync(path.join(__dirname, 'browser-maintenance-owned-latest.json'), JSON.stringify(artifact, null, 2))
  console.log(JSON.stringify(artifact, null, 2))
  ws.close()
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1) })
