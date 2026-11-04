const http = require('http')
const fs = require('fs')
const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:9229' + p, (r) => { let d = ''; r.on('data', (x) => d += x); r.on('end', () => res(JSON.parse(d))) }).on('error', rej))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const targets = await get('/json')
  const t = targets.find((x) => x.url.includes('localhost:3002') && x.type === 'page')
  if (!t) throw new Error('no admin tab')
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  let bucket = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') bucket.push({ kind: 'exception', text: m.params.exceptionDetails?.text || String(m.params.exceptionDetails?.exception?.description || '') })
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') bucket.push({ kind: 'console', text: (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300) })
    if (m.method === 'Network.loadingFailed') bucket.push({ kind: 'netfail', text: (m.params.errorText || '') + ' ' + (m.params.blockedReason || '') })
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await call('Runtime.enable')
  await call('Network.enable')
  await call('Page.enable')

  const routes = [
    '/', '/dashboard', '/bookings', '/clients', '/calendar', '/maintenance', '/payments', '/caisse', '/team', '/reports',
    '/suppliers', '/locations', '/cars', '/users', '/settings', '/countries', '/notifications', '/about', '/tos', '/contact', '/pricing', '/bank-details', '/scheduler',
  ]
  const rows = []
  for (const route of routes) {
    bucket = []
    await call('Page.navigate', { url: 'http://localhost:3002' + route + '?fresh=' + Date.now() })
    await sleep(2200)
    const r = await call('Runtime.evaluate', {
      expression: `JSON.stringify({url:location.pathname,lang:document.documentElement.lang,dir:document.documentElement.dir,title:document.title,body:document.body.innerText.slice(0,180),links:document.querySelectorAll('a').length,buttons:document.querySelectorAll('button').length,errorBoundary:document.body.innerText.includes('Something went wrong.'),notFound:document.body.innerText.includes('404')})`,
      returnByValue: true,
    })
    const row = JSON.parse(r.result?.result?.value || '{}')
    row.route = route
    row.errors = bucket
    rows.push(row)
    console.log(route, '| boundary=' + row.errorBoundary, '| errs=' + bucket.length, bucket.length ? JSON.stringify(bucket.slice(0, 2)) : '')
  }
  fs.writeFileSync('artifacts/browser-admin-route-sweep-latest.json', JSON.stringify({ generatedAt: new Date().toISOString(), routes: rows }, null, 2))
  ws.close()
})().catch((e) => { console.error(e); process.exit(1) })
