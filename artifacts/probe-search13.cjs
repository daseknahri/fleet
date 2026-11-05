const http = require('http')
function getJson(url) { return new Promise((resolve, reject) => { http.get(url, (res) => { let d = ''; res.on('data', (c) => { d += c }); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) }).on('error', reject) }) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const targets = await getJson('http://127.0.0.1:9231/json/list')
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let seq = 0; const pending = new Map()
  const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
  ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result) } }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  await send('Runtime.enable'); await send('Page.enable'); await send('Input.enable').catch(() => {}); await send('Network.enable').catch(() => {})
  await send('Page.bringToFront').catch((e) => console.log('bringToFront err', e.message))
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch((e) => console.log('focusEmu err', e.message))
  const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result ? r.result.value : undefined }
  await send('Page.navigate', { url: 'http://localhost:8081/' }); await sleep(3000)
  await evaluate(`localStorage.setItem('bc-fe-language', 'fr'); true`)
  await send('Page.navigate', { url: 'http://localhost:8081/' }); await sleep(4500)
  await evaluate(`(() => { const el = document.querySelector('form.home-search-form input[role="combobox"]'); el.scrollIntoView({ block: 'center' }); el.focus(); el.click(); return document.activeElement === el })()`).then((v) => console.log('focused:', v))
  for (const ch of ['C', 'a', 's']) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code: 'Key' + ch.toUpperCase(), text: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase() })
    await sleep(120)
  }
  const midValue = await evaluate(`document.querySelector('form.home-search-form input[role="combobox"]').value`)
  console.log('value after key events:', JSON.stringify(midValue))
  if (!midValue) { await send('Input.insertText', { text: 'Cas' }); console.log('insertText sent') }
  await sleep(3000)
  const state = await evaluate(`(() => { const el = document.querySelector('form.home-search-form input[role="combobox"]'); const banners = [...document.querySelectorAll('body *')].filter((n) => /cookie|consent/i.test(String(n.className))).map((n) => String(n.className).slice(0, 60)); return { value: el.value, expanded: el.getAttribute('aria-expanded'), options: [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent).slice(0, 6), popper: (document.querySelector('.MuiAutocomplete-popper') || { textContent: null }).textContent, banners } })()`)
  console.log(JSON.stringify(state, null, 1))
  ws.close()
}
main().catch((e) => { console.error('FATAL', e.message || e); process.exit(1) })
