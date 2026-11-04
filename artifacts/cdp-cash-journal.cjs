const http = require('http')
const fs = require('fs')
const get = (p) => new Promise((resolve, reject) => http.get('http://127.0.0.1:9229' + p, (r) => { let d = ''; r.on('data', (x) => d += x); r.on('end', () => resolve(JSON.parse(d))) }).on('error', reject))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const v = await get('/json/version')
  const browser = new WebSocket(v.webSocketDebuggerUrl)
  await new Promise((r) => browser.addEventListener('open', r))
  let createId = 1
  browser.send(JSON.stringify({ id: createId, method: 'Target.createTarget', params: { url: 'http://localhost:3002/sign-in?cashEvidence=1' } }))
  const created = await new Promise((r) => browser.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id === createId) r(m) }))
  browser.close()
  await sleep(700)
  const target = (await get('/json')).find((x) => x.id === created.result.targetId)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  const network = []
  const errors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/api/')) network.push({ url: m.params.response.url, status: m.params.response.status })
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text || 'exception')
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(m.params.type)) errors.push(m.params.args?.map((a) => a.value || a.description).join(' '))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const call = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
  await call('Runtime.enable')
  await call('Network.enable')
  await call('Page.enable')
  await sleep(1200)
  const loginExpression = `(() => { const fields = [...document.querySelectorAll('input')]; const set = (element, value) => { if (!element) return; const setter = Object.getOwnPropertyDescriptor(element.__proto__, 'value').set; setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); }; set(fields.find((x) => x.name === 'email'), 'admin@fleetrent.local'); set(fields.find((x) => x.name === 'password'), 'B00kC4r5'); document.querySelector('form')?.requestSubmit(); return true })()`
  await call('Runtime.evaluate', { expression: loginExpression, returnByValue: true })
  await sleep(4500)
  await call('Page.navigate', { url: 'http://localhost:3002/caisse?l=ar&cashEvidence=' + Date.now() })
  await sleep(4500)
  const inspection = await call('Runtime.evaluate', { expression: `JSON.stringify({ url: location.href, lang: document.documentElement.lang, dir: document.documentElement.dir, errorBoundary: document.body.innerText.includes('Something went wrong.'), body: document.body.innerText.slice(0, 2200), buttons: [...document.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean).slice(0, 30), hasSessionBalance: document.body.innerText.includes('Expected') || document.body.innerText.includes('المتوقع'), hasTransfer: document.body.innerText.includes('Transfer') || document.body.innerText.includes('تحويل') })`, returnByValue: true })
  const out = { generatedAt: new Date().toISOString(), ...JSON.parse(inspection.result.result.value), network, consoleErrors: errors }
  fs.writeFileSync('artifacts/browser-cash-journal-latest.json', JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  ws.close()
})().catch((e) => { console.error(e); process.exit(1) })
