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
  await send('Runtime.enable'); await send('Page.enable'); await send('Input.enable').catch(() => {})
  const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result ? r.result.value : undefined }
  const clickRect = async (rect) => { const x = rect.x + rect.width / 2; const y = rect.y + rect.height / 2; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
  await send('Page.navigate', { url: 'http://localhost:8080/' }); await sleep(2500)
  await evaluate(`localStorage.setItem('bc-fe-language', 'ar'); true`)
  await send('Page.navigate', { url: 'http://localhost:8080/' }); await sleep(3500)
  await evaluate(`(() => { const el = document.querySelector('form.home-search-form input[role="combobox"]'); el.focus(); el.click(); return true })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' })
  await sleep(2500)
  const optRect = await evaluate(`(() => { const el = [...document.querySelectorAll('[role="option"]')].find((o) => /LAX/.test(o.textContent)) || document.querySelector('[role="option"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, text: el.textContent } })()`)
  console.log('option:', JSON.stringify(optRect))
  await clickRect(optRect); await sleep(1200)
  const after = await evaluate(`(() => { const el = document.querySelector('form.home-search-form input[role="combobox"]'); const helpers = [...document.querySelectorAll('form.home-search-form .MuiFormHelperText-root')].map((h) => h.textContent); const btn = document.querySelector('form.home-search-form button[type="submit"]'); return { value: el.value, helpers, btnDisabled: btn ? btn.disabled : null, btnText: btn ? btn.textContent : null } })()`)
  console.log('after pick:', JSON.stringify(after))
  const btnRect = await evaluate(`(() => { const b = document.querySelector('form.home-search-form button[type="submit"]'); const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  await clickRect(btnRect)
  await sleep(4000)
  const end = await evaluate(`(() => ({ path: location.pathname, helpers: [...document.querySelectorAll('.MuiFormHelperText-root')].map((h) => h.textContent).slice(0, 4), sample: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200) }))()`)
  console.log('after click submit:', JSON.stringify(end))
  await evaluate(`(() => { document.querySelector('form.home-search-form').requestSubmit(); return true })()`)
  await sleep(4000)
  const end2 = await evaluate(`(() => ({ path: location.pathname, sample: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 150) }))()`)
  console.log('after requestSubmit:', JSON.stringify(end2))

  ws.close()
}
main().catch((e) => { console.error('FATAL', e.message || e); process.exit(1) })
