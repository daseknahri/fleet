const http = require('http')
const fs = require('fs')
const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:9229' + p, (r) => { let d = ''; r.on('data', (x) => d += x); r.on('end', () => res(JSON.parse(d))) }).on('error', rej))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const targets = await get('/json')
  const t = targets.find((x) => x.url.includes('localhost:3002') && x.type === 'page')
  if (!t) { throw new Error('no admin tab') }
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  const events = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/api/contract-operations')) {
      events.push({ url: m.params.response.url, status: m.params.response.status })
    }
    if (m.method === 'Runtime.exceptionThrown') events.push({ exception: m.params.exceptionDetails?.text || String(m.params.exceptionDetails?.exception?.description) })
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await call('Runtime.enable')
  await call('Network.enable')
  await call('Page.navigate', { url: 'http://localhost:3002/update-booking?b=6ae16b8084b023432140553a&fresh=' + Date.now() })
  await sleep(5000)
  const q = await call('Runtime.evaluate', { expression: `JSON.stringify({
    url: location.href,
    hasPanel: !!document.querySelector('[data-testid=contract-operations]'),
    errorBanner: document.body.innerText.includes('Contract operation failed.'),
    somethingWrong: document.body.innerText.includes('Something went wrong.'),
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    signatureButton: [...document.querySelectorAll('button')].some(b => /signature|توقيع|Signature/i.test(b.innerText)),
    addChargeButton: [...document.querySelectorAll('button')].some(b => /add charge|ajouter des frais|إضافة رسوم/i.test(b.innerText)),
    uploadPhoto: [...document.querySelectorAll('button')].some(b => /upload photo|téléverser une photo|رفع صورة/i.test(b.innerText)),
    body: document.body.innerText.slice(0, 1200)
  })`, returnByValue: true })
  const result = { generatedAt: new Date().toISOString(), ...JSON.parse(q.result.result.value), network: events }
  fs.writeFileSync('artifacts/browser-contract-panel-latest.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  ws.close()
})().catch((e) => { console.error(e); process.exit(1) })
