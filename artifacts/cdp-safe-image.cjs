const http = require('http')
const fs = require('fs')
const get = (p) => new Promise((resolve, reject) => http.get('http://127.0.0.1:9229' + p, (r) => { let d = ''; r.on('data', (x) => d += x); r.on('end', () => resolve(JSON.parse(d))) }).on('error', reject))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const version = await get('/json/version')
  const browser = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((r) => browser.addEventListener('open', r))
  let id = 1
  browser.send(JSON.stringify({ id, method: 'Target.createTarget', params: { url: 'http://localhost:8080/?safeImageEvidence=1' } }))
  const created = await new Promise((r) => browser.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id === id) r(m) }))
  browser.close()
  await sleep(800)
  const target = (await get('/json')).find((x) => x.id === created.result.targetId)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let n = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push({ kind: 'exception', text: m.params.exceptionDetails?.text || m.params.exceptionDetails?.exception?.description })
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(m.params.type)) errors.push({ kind: 'console', text: m.params.args?.map((a) => a.value || a.description).join(' ') })
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const call = (method, params = {}) => new Promise((resolve) => { const i = ++n; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
  await call('Runtime.enable')
  await call('Page.enable')
  await sleep(3500)
  const choose = await call('Runtime.evaluate', { expression: `(() => {
    const images = [...document.images].filter((i) => i.src.includes('/cdn/bookcars/') && i.naturalWidth > 0)
    const image = images[0]
    if (!image) return { selected: false, count: document.images.length }
    image.dataset.codexOriginal = image.src
    image.dataset.codexEvidence = 'safe-image'
    image.src = 'http://127.0.0.1:4002/cdn/bookcars/cars/__codex_missing_media__.png'
    return { selected: true, original: image.dataset.codexOriginal, candidates: images.length }
  })()`, returnByValue: true })
  await sleep(2500)
  const result = await call('Runtime.evaluate', { expression: `(() => {
    const image = document.querySelector('img[data-codex-evidence="safe-image"]')
    return {
      selected: !!image,
      original: image?.dataset.codexOriginal || null,
      finalSrc: image?.src || null,
      fallbackApplied: !!image && image.src.startsWith('data:image/svg+xml'),
      complete: image?.complete || false,
      naturalWidth: image?.naturalWidth || 0,
      errorBoundary: document.body.innerText.includes('Something went wrong'),
      body: document.body.innerText.slice(0, 250)
    }
  })()`, returnByValue: true })
  const output = { generatedAt: new Date().toISOString(), url: 'http://localhost:8080/', route: '/', ...choose.result.result.value, ...result.result.result.value, errors }
  fs.writeFileSync('artifacts/browser-safe-image-latest.json', JSON.stringify(output, null, 2))
  console.log(JSON.stringify(output, null, 2))
  ws.close()
})().catch((e) => { console.error(e); process.exit(1) })
