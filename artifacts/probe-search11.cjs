const http = require('http')
function getJson(url) { return new Promise((resolve, reject) => { http.get(url, (res) => { let d = ''; res.on('data', (c) => { d += c }); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) }).on('error', reject) }) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const targets = await getJson('http://127.0.0.1:9229/json/list')
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let seq = 0; const pending = new Map()
  const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
  ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result) } }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  await send('Runtime.enable'); await send('Page.enable')
  const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result ? r.result.value : undefined }
  await send('Page.navigate', { url: 'http://localhost:8081/' }); await sleep(3500)
  const dump = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input')].map((i) => ({ type: i.type, role: i.getAttribute('role'), placeholder: i.placeholder, name: i.name, id: i.id, cls: String(i.className).slice(0, 50), ariaLabel: i.getAttribute('aria-label') }))
    const forms = [...document.querySelectorAll('form')].map((f) => String(f.className).slice(0, 60))
    return { inputs, forms, bodyLen: document.body.innerText.length }
  })()`)
  console.log(JSON.stringify(dump, null, 1))
  ws.close()
}
main().catch((e) => { console.error('FATAL', e.message || e); process.exit(1) })
