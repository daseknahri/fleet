// GA-P2-A11Y-01 — Accessibility audit of the highest-traffic admin surfaces.
// Scripted axe-core audit (axe-core 4.10.2, injected at runtime only — not a
// project dependency) + manual DOM checks: accessible names on interactive
// elements, label association on form controls, positive tabindex, keyboard
// Tab-order probe on two surfaces, :focus-visible presence on a probed stop.
// Read-only: no data is created or modified. Usage:
//   node browser-a11y-audit-01.cjs <before|after>
// Writes artifacts/browser-a11y-audit-<mode>-latest.json
const http = require('http')
const fs = require('fs')
const os = require('os')

const ADMIN = 'http://localhost:3002'
const MODE = process.argv[2] || 'before'
const REPO = os.homedir() + '\\Documents\\kimi\\Workspaces\\fleet\\bookcars'
const OUT = REPO + '\\artifacts\\browser-a11y-audit-' + MODE + '-latest.json'
const AXE_PATH = process.env.GA_AXE_PATH || (os.homedir() + '\\ga-q4-axe.min.js')

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => { d += c }); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) }).on('error', reject)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const axeSource = fs.readFileSync(AXE_PATH, 'utf8')
  const targets = await getJson('http://127.0.0.1:9229/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:3002'))
    || targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result)
    }
  }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Input.enable').catch(() => {})

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result ? r.result.value : undefined
  }
  const nav = async (url) => { await send('Page.navigate', { url }); await sleep(3200) }
  const waitFor = async (expr, timeout = 25000) => {
    const t0 = Date.now()
    for (;;) {
      const ok = await evaluate(`!!(${expr})`).catch(() => false)
      if (ok) return true
      if (Date.now() - t0 > timeout) return false
      await sleep(400)
    }
  }

  const result = { slice: 'GA-P2-A11Y-01', mode: MODE, at: new Date().toISOString(), axeVersion: '4.10.2', surfaces: {}, summary: {} }

  const session = await evaluate(`(() => { const u = localStorage.getItem('bc-be-user'); return u ? { signedIn: true, language: JSON.parse(u).language || null } : { signedIn: false } })()`).catch(() => ({ signedIn: false }))
  result.session = session
  if (!session.signedIn) { result.outcome = 'session-invalid'; fs.writeFileSync(OUT, JSON.stringify(result, null, 2)); console.log('SESSION INVALID'); ws.close(); return }

  // Discover a booking id for the contract workspace (read-only list call).
  await nav(ADMIN + '/bookings')
  await waitFor(`document.body && document.body.innerText.length > 50`)
  // The bookings list POST returns 405 to a bare page-context fetch in this
  // build; the row action group's [data-id] is the reliable discovery path
  // (same lesson as GA-P1-ADMIN-AR-LOCALE-05).
  const bookingId = await evaluate(`(() => { const el = document.querySelector('.bs-buttons [data-id]'); return el ? el.getAttribute('data-id') : null })()`)
  result.bookingIdUsed = bookingId

  const surfaces = [
    { key: 'dashboard', url: '/' },
    { key: 'bookings', url: '/bookings' },
    { key: 'contractWorkspace', url: bookingId ? '/update-booking/?b=' + bookingId : null },
    { key: 'cashJournal', url: '/caisse' },
    { key: 'reports', url: '/reports' },
    { key: 'approbations', url: '/approbations' },
    { key: 'maintenance', url: '/maintenance' },
  ]

  const manualProbe = `(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
    const accName = (el) => {
      const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim()
      const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\\s+/).map((i) => { const n = document.getElementById(i); return n ? n.textContent : '' }).join(' ').trim(); if (t) return t }
      const txt = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim(); if (txt) return txt
      const ti = el.getAttribute('title'); if (ti && ti.trim()) return ti.trim()
      return ''
    }
    const snippet = (el) => (el.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 180)
    const out = {}
    // icon/interactive elements without an accessible name
    const inters = [...document.querySelectorAll('button, [role="button"], a[href]')].filter(visible)
    const noName = inters.filter((el) => !accName(el))
    out.interactiveTotal = inters.length
    out.interactiveNoName = { count: noName.length, samples: noName.slice(0, 12).map((el) => ({ tag: el.tagName, cls: (el.className && el.className.baseVal !== undefined ? '' : String(el.className)).slice(0, 60), html: snippet(el) })) }
    // form controls without a label association
    const ctrls = [...document.querySelectorAll('input, select, textarea')].filter((el) => visible(el) && el.type !== 'hidden')
    const noLabel = ctrls.filter((el) => {
      if (el.getAttribute('aria-label') && el.getAttribute('aria-label').trim()) return false
      if (el.getAttribute('aria-labelledby')) return false
      if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return false
      if (el.closest('label')) return false
      return true
    })
    out.controlsTotal = ctrls.length
    out.controlsNoLabel = { count: noLabel.length, samples: noLabel.slice(0, 12).map((el) => ({ tag: el.tagName, type: el.getAttribute('type') || '', name: el.getAttribute('name') || '', placeholder: el.getAttribute('placeholder') || '', html: snippet(el) })) }
    // positive tabindex (focus order smell)
    const posTab = [...document.querySelectorAll('[tabindex]')].filter((el) => { const v = parseInt(el.getAttribute('tabindex'), 10); return !Number.isNaN(v) && v > 0 })
    out.positiveTabindex = { count: posTab.length, samples: posTab.slice(0, 6).map((el) => snippet(el)) }
    // images without alt
    const imgs = [...document.querySelectorAll('img')].filter(visible)
    out.imagesNoAlt = { total: imgs.length, count: imgs.filter((i) => !i.hasAttribute('alt')).length }
    // main landmark
    out.hasMain = !!document.querySelector('main, [role="main"]')
    out.title = document.title
    return out
  })()`

  const tabProbe = async (stops) => {
    await evaluate(`(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); window.scrollTo(0, 0); return true })()`)
    const seqOut = []
    for (let i = 0; i < stops; i++) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      await sleep(180)
      const info = await evaluate(`(() => { const el = document.activeElement; if (!el || el === document.body) return { tag: 'BODY' }; const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim().slice(0, 50); let fv = null; try { fv = el.matches(':focus-visible') } catch (e) { fv = null } let outline = null; if (fv) { const cs = getComputedStyle(el); outline = cs.outlineStyle + ' ' + cs.outlineWidth } return { tag: el.tagName, name, focusVisible: fv, outline } })()`)
      seqOut.push(info)
    }
    return seqOut
  }

  for (const s of surfaces) {
    if (!s.url) { result.surfaces[s.key] = { skipped: 'no booking id available' }; continue }
    await nav(ADMIN + s.url)
    await waitFor(`document.body && document.body.innerText.length > 30`)
    await sleep(1200)
    await evaluate(axeSource)
    const axeRes = await evaluate(`axe.run(document, { resultTypes: ['violations', 'incomplete'] }).then((r) => ({
      violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => (n.target || []).join(' ')), firstFailure: v.nodes[0] ? String(v.nodes[0].failureSummary || '').split('\\n')[1] || '' : '' })),
      incompleteContrast: r.incomplete.filter((v) => v.id === 'color-contrast').reduce((a, v) => a + v.nodes.length, 0),
      incompleteOther: r.incomplete.filter((v) => v.id !== 'color-contrast').map((v) => ({ id: v.id, nodes: v.nodes.length })),
    }))`)
    const manual = await evaluate(manualProbe)
    const entry = { url: ADMIN + s.url, axe: axeRes, manual }
    if (s.key === 'dashboard' || s.key === 'bookings') {
      entry.keyboardProbe = await tabProbe(14)
    }
    result.surfaces[s.key] = entry
    const nodeTotal = axeRes.violations.reduce((a, v) => a + v.nodes, 0)
    result.summary[s.key] = { violationRules: axeRes.violations.length, violationNodes: nodeTotal, byImpact: axeRes.violations.reduce((a, v) => { a[v.impact || 'unknown'] = (a[v.impact || 'unknown'] || 0) + v.nodes; return a }, {}), interactiveNoName: manual.interactiveNoName.count, controlsNoLabel: manual.controlsNoLabel.count, positiveTabindex: manual.positiveTabindex.count, incompleteContrast: axeRes.incompleteContrast }
    console.log(s.key + ': rules=' + axeRes.violations.length + ' nodes=' + nodeTotal + ' noName=' + manual.interactiveNoName.count + ' noLabel=' + manual.controlsNoLabel.count)
  }

  result.outcome = 'audit-complete'
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result.summary, null, 1))
  ws.close()
}

main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1) })
