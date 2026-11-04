const http = require('http')
const fs = require('fs')
const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:9229' + p, (r) => { let d = ''; r.on('data', (x) => d += x); r.on('end', () => res(JSON.parse(d))) }).on('error', rej))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const getBody = (url) => new Promise((res) => { http.get(url, (r) => { r.resume(); res({ status: r.statusCode, contentType: r.headers['content-type'], length: r.headers['content-length'] || null }) }).on('error', () => res({ status: 0, contentType: null, length: null })) })

;(async () => {
  const routes = ['/cars', '/bookings', '/clients', '/suppliers', '/users', '/scheduler']
  const avatars = ['avatar.jpg', 'customer.png', 'supplier.png']
  const avatarEvidence = []
  for (const name of avatars) {
    const url = 'http://127.0.0.1:4002/cdn/bookcars/users/' + name
    const head = await getBody(url)
    avatarEvidence.push({ file: name, url, status: head.status, contentType: head.contentType, bytes: head.length })
  }

  const targets = await get('/json')
  const t = targets.find((x) => x.url.includes('localhost:3002') && x.type === 'page')
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  let failed = []
  const reqs = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Network.requestWillBeSent') reqs.set(m.params.requestId, m.params.request.url)
    if (m.method === 'Network.loadingFailed') failed.push({ url: reqs.get(m.params.requestId), type: m.params.type, error: m.params.errorText, blocked: m.params.blockedReason || null })
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await call('Network.enable')
  await call('Page.enable')

  const rows = []
  for (const route of routes) {
    failed = []
    reqs.clear()
    await call('Page.navigate', { url: 'http://localhost:3002' + route + '?probe=' + Date.now() })
    await sleep(3500)
    rows.push({ route, loadingFailures: failed, orbBlocked: failed.filter((f) => f.error === 'net::ERR_BLOCKED_BY_ORB').length })
    console.log(route, JSON.stringify(rows[rows.length - 1]))
  }
  const out = { generatedAt: new Date().toISOString(), avatarEvidence, routes: rows }
  fs.writeFileSync('artifacts/browser-avatar-recovery-latest.json', JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  ws.close()
})().catch((e) => { console.error(e); process.exit(1) })
