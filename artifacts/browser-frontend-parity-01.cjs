// GA-P2-FRONTEND-PARITY-01 — Frontend (customer app) parity audit.
// axe-core 4.10.2 injected at runtime (not a project dependency) + manual
// DOM probes, on the main public surfaces in fr and ar (RTL): home, search
// results (driven through the real home search form), the booking page
// reached from a result card, sign-in and sign-up. Language is switched via
// the real persisted guest path (localStorage 'bc-fe-language'). Read-only:
// no booking is submitted and no account is created.
// Usage: node browser-frontend-parity-01.cjs <baseUrl> <label>
// Writes artifacts/browser-frontend-parity-<label>-latest.json
const http = require('http')
const fs = require('fs')
const os = require('os')

const BASE = process.argv[2] || 'http://localhost:8080'
const LABEL = process.argv[3] || 'before'
const REPO = os.homedir() + '\\Documents\\kimi\\Workspaces\\fleet\\bookcars'
const OUT = REPO + '\\artifacts\\browser-frontend-parity-' + LABEL + '-latest.json'
const AXE_PATH = process.env.GA_AXE_PATH || (os.homedir() + '\\ga-q4-axe.min.js')

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => { d += c }); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) }).on('error', reject)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const axeSource = fs.readFileSync(AXE_PATH, 'utf8')
  const CDP_PORT = process.env.GA_CDP_PORT || '9229'
  const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`)
  const page = targets.find((t) => t.type === 'page' && (t.url.includes('localhost:8080') || t.url.includes('localhost:8081')))
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
  // Fresh/background audit windows drop CDP key events without this.
  await send('Page.bringToFront').catch(() => {})
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result ? r.result.value : undefined
  }
  const nav = async (url) => { await send('Page.navigate', { url }); await sleep(3000) }
  const waitFor = async (expr, timeout = 25000) => {
    const t0 = Date.now()
    for (;;) {
      const ok = await evaluate(`!!(${expr})`).catch(() => false)
      if (ok) return true
      if (Date.now() - t0 > timeout) return false
      await sleep(400)
    }
  }
  const clickRect = async (rect) => {
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }

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
    const inters = [...document.querySelectorAll('button, [role="button"], a[href]')].filter(visible)
    const noName = inters.filter((el) => !accName(el))
    out.interactiveTotal = inters.length
    out.interactiveNoName = { count: noName.length, samples: noName.slice(0, 10).map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 60), html: snippet(el) })) }
    const ctrls = [...document.querySelectorAll('input, select, textarea')].filter((el) => visible(el) && el.type !== 'hidden')
    const noLabel = ctrls.filter((el) => {
      if (el.getAttribute('aria-label') && el.getAttribute('aria-label').trim()) return false
      if (el.getAttribute('aria-labelledby')) return false
      if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return false
      if (el.closest('label')) return false
      return true
    })
    out.controlsTotal = ctrls.length
    out.controlsNoLabel = { count: noLabel.length, samples: noLabel.slice(0, 10).map((el) => ({ tag: el.tagName, type: el.getAttribute('type') || '', name: el.getAttribute('name') || '', placeholder: el.getAttribute('placeholder') || '', html: snippet(el) })) }
    const posTab = [...document.querySelectorAll('[tabindex]')].filter((el) => { const v = parseInt(el.getAttribute('tabindex'), 10); return !Number.isNaN(v) && v > 0 })
    out.positiveTabindex = { count: posTab.length, samples: posTab.slice(0, 6).map((el) => snippet(el)) }
    const imgs = [...document.querySelectorAll('img')].filter(visible)
    out.imagesNoAlt = { total: imgs.length, count: imgs.filter((i) => !i.hasAttribute('alt')).length }
    out.hasMain = !!document.querySelector('main, [role="main"]')
    out.docLang = document.documentElement.getAttribute('lang') || ''
    out.docDir = document.documentElement.getAttribute('dir') || ''
    out.title = document.title
    const text = (document.body.innerText || '')
    out.arabicChars = (text.match(/[\\u0600-\\u06FF]/g) || []).length
    out.textSample = text.replace(/\\s+/g, ' ').slice(0, 400)
    return out
  })()`

  const auditSurface = async (key) => {
    await waitFor(`document.body && document.body.innerText.length > 30`)
    await sleep(1200)
    await evaluate(axeSource)
    const axeRes = await evaluate(`axe.run(document, { resultTypes: ['violations', 'incomplete'] }).then((r) => ({
      violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => (n.target || []).join(' ')), firstFailure: v.nodes[0] ? String(v.nodes[0].failureSummary || '').split('\\n')[1] || '' : '' })),
      incompleteContrast: r.incomplete.filter((v) => v.id === 'color-contrast').reduce((a, v) => a + v.nodes.length, 0),
      incompleteOther: r.incomplete.filter((v) => v.id !== 'color-contrast').map((v) => ({ id: v.id, nodes: v.nodes.length })),
    }))`)
    const manual = await evaluate(manualProbe)
    const nodeTotal = axeRes.violations.reduce((a, v) => a + v.nodes, 0)
    console.log(key + ': rules=' + axeRes.violations.length + ' nodes=' + nodeTotal + ' noName=' + manual.interactiveNoName.count + ' noLabel=' + manual.controlsNoLabel.count + ' arChars=' + manual.arabicChars + ' dir=' + manual.docDir)
    return { axe: axeRes, manual, summary: { violationRules: axeRes.violations.length, violationNodes: nodeTotal, interactiveNoName: manual.interactiveNoName.count, controlsNoLabel: manual.controlsNoLabel.count, positiveTabindex: manual.positiveTabindex.count, incompleteContrast: axeRes.incompleteContrast } }
  }

  const result = { slice: 'GA-P2-FRONTEND-PARITY-01', label: LABEL, base: BASE, at: new Date().toISOString(), axeVersion: '4.10.2', languages: {} }

  for (const lang of ['fr', 'ar']) {
    const L = { surfaces: {} }
    result.languages[lang] = L
    await nav(BASE + '/')
    await evaluate(`localStorage.setItem('bc-fe-language', '${lang}'); true`)
    await nav(BASE + '/')
    L.surfaces.home = await auditSurface(lang + '/home')

    // Drive the real search flow: pickup location autocomplete -> submit.
    const flow = { steps: [] }
    try {
      const formReady = await waitFor(`!!document.querySelector('form.home-search-form input[role="combobox"]')`, 30000)
      if (!formReady) throw new Error('pickup combobox never mounted')
      let optWait = false
      for (let attempt = 0; attempt < 3 && !optWait; attempt++) {
        const focused = await evaluate(`(() => { const el = document.querySelector('form.home-search-form input[role="combobox"]'); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.focus(); el.click(); return document.activeElement === el })()`)
        if (!focused) throw new Error('pickup combobox not focusable')
        await sleep(700)
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a' })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' })
        optWait = await waitFor(`document.querySelectorAll('[role="option"]').length > 0`, 9000)
        flow.steps.push('typeAttempt' + attempt + '=' + optWait)
      }
      flow.steps.push('options=' + optWait)
      if (!optWait) throw new Error('no autocomplete options')
      const optRect = await evaluate(`(() => { const el = [...document.querySelectorAll('[role="option"]')].find((o) => /LAX/.test(o.textContent)) || document.querySelector('[role="option"]'); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, text: el.textContent } })()`)
      flow.pickedLocation = optRect.text
      await clickRect(optRect)
      await sleep(800)
      const btnRect = await evaluate(`(() => { const btns = [...document.querySelectorAll('form.home-search-form button')]; const b = btns.find((x) => x.type === 'submit') || btns.find((x) => /rechercher|ابحث/.test(x.textContent || '')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, text: b.textContent } })()`)
      if (!btnRect) throw new Error('search submit not found')
      flow.submitText = btnRect.text
      await clickRect(btnRect)
      let reached = await waitFor(`location.pathname.includes('/search')`, 8000)
      flow.submitVia = reached ? 'cdp-click' : 'fallback'
      if (!reached) {
        // CDP click delivery on this submit button proved unreliable in
        // probes (form state valid; requestSubmit navigates). Recorded
        // fallback: ask the form itself to submit its real state.
        await evaluate(`(() => { const f = document.querySelector('form.home-search-form'); if (f) f.requestSubmit(); return true })()`)
        reached = await waitFor(`location.pathname.includes('/search')`, 20000)
      }
      flow.reachedSearch = reached
      if (reached) {
        await sleep(3500)
        L.surfaces.search = await auditSurface(lang + '/search')
        // First result card's booking action -> booking flow page.
        const bookRect = await evaluate(`(() => { const els = [...document.querySelectorAll('button, a[href]')]; const b = els.find((x) => /Réserver|اختر هذه السيارة/.test(x.textContent || '')); if (!b) return null; const r = b.getBoundingClientRect(); return r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height, text: b.textContent } : null })()`)
        if (bookRect) {
          await clickRect(bookRect)
          let reachedBooking = await waitFor(`location.pathname.includes('/booking') || location.pathname.includes('/checkout')`, 8000)
          flow.bookVia = reachedBooking ? 'cdp-click' : 'fallback'
          if (!reachedBooking) {
            await evaluate(`(() => { const els = [...document.querySelectorAll('button, a[href]')]; const b = els.find((x) => /Réserver|اختر هذه السيارة/.test(x.textContent || '')); if (b) b.click(); return true })()`)
            reachedBooking = await waitFor(`location.pathname.includes('/booking') || location.pathname.includes('/checkout')`, 20000)
          }
          flow.reachedBooking = reachedBooking
          if (reachedBooking) {
            await sleep(2500)
            L.surfaces.bookingFlow = await auditSurface(lang + '/bookingFlow')
          }
        } else {
          flow.reachedBooking = 'no-book-button'
        }
      }
    } catch (e) {
      flow.error = String(e && e.message ? e.message : e)
    }
    L.searchFlow = flow

    await nav(BASE + '/sign-in')
    L.surfaces.signIn = await auditSurface(lang + '/signIn')
    await nav(BASE + '/sign-up')
    L.surfaces.signUp = await auditSurface(lang + '/signUp')
    result.languages[lang] = L
  }

  result.outcome = 'audit-complete'
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
  console.log('WROTE', OUT)
  ws.close()
}

main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1) })
