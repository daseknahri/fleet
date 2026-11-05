/*
 * GA-P1-APPROVALS-UI-02 — click-level proof of the new /approbations queue UI.
 * Fixture A is seeded through the API (no producer flow exists yet; allowed
 * for this slice), fixture B is created through the page's own form.
 * Decisions are made through rendered UI controls (CDP mouse/keyboard);
 * the API is used for read-back verification only.
 */
const fs = require('fs')
const http = require('http')
const OUT = 'C:\\Users\\Yassi\\Documents\\kimi\\Workspaces\\fleet\\bookcars\\artifacts\\browser-approvals-ui-latest.json'
const MARK = `GA-APPROVALS-UI02-${Date.now()}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:9229' + p, (x) => { let d = ''; x.on('data', (c) => d += c); x.on('end', () => res(JSON.parse(d))) }).on('error', rej))
const ev = { slice: 'GA-P1-APPROVALS-UI-02', marker: MARK, generatedAt: new Date().toISOString(), evidenceType: 'UI-interaction (CDP mouse/keyboard on rendered controls); API used for fixture seed (A) and read-back only', steps: [] }
const step = (name, data) => { ev.steps.push({ name, at: new Date().toISOString(), ...data }); console.log('STEP', name, JSON.stringify(data).slice(0, 320)) }
const save = () => fs.writeFileSync(OUT, JSON.stringify(ev, null, 2))
;(async () => {
  const targets = await get('/json')
  const page = targets.find((x) => x.type === 'page' && x.url.startsWith('http://localhost:3002'))
  if (!page) throw new Error('No admin page target on CDP')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let seq = 0; const pending = new Map()
  ws.onmessage = (e) => { const x = JSON.parse(e.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id) } }
  const cmd = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
  const evl = async (expression) => { const x = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (x.result && x.result.exceptionDetails) throw new Error(JSON.stringify(x.result.exceptionDetails).slice(0, 300)); return x.result && x.result.result ? x.result.result.value : undefined }
  const api = (path, method = 'GET', body) => evl(`fetch('http://localhost:4002' + ${JSON.stringify(path)} + (${JSON.stringify(path)}.includes('?') ? '&' : '?') + '_cb=' + Date.now(), { method: ${JSON.stringify(method)}, credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ${body ? `body: ${JSON.stringify(JSON.stringify(body))},` : ''} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`)
  async function waitFor(fn, what, ms = 15000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('WAIT_TIMEOUT: ' + what); await sleep(400) } }
  const clickAt = async (x, y) => { await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(120); await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await sleep(70); await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await sleep(350) }
  const selectAll = async () => {
    await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 })
    await sleep(100)
  }
  // Type into the input identified by a rect-finder expression; verify by re-reading.
  const typeInto = async (rectExpr, readExpr, value) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const rect = await waitFor(() => evl(rectExpr), 'field rect')
      await clickAt(rect.x, rect.y)
      await selectAll()
      await cmd('Input.insertText', { text: value })
      await sleep(250)
      const val = await evl(readExpr)
      if (val === value) return val
      if (attempt === 3) throw new Error(`FIELD_SET_FAILED: got ${JSON.stringify(val)} want ${JSON.stringify(value)}`)
    }
  }
  const cardRect = (subject) => `(() => { const card = [...document.querySelectorAll('main .MuiCard-root')].find((c) => c.textContent.includes(${JSON.stringify(subject)})); return card ? card.getBoundingClientRect() : null })()`
  const cardText = (subject) => evl(`(() => { const card = [...document.querySelectorAll('main .MuiCard-root')].find((c) => c.textContent.includes(${JSON.stringify(subject)})); return card ? card.textContent.replace(/\\s+/g, ' ').trim() : null })()`)
  const cardButton = (subject, label) => evl(`(() => { const card = [...document.querySelectorAll('main .MuiCard-root')].find((c) => c.textContent.includes(${JSON.stringify(subject)})); if (!card) return null; const b = [...card.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: b.disabled } })()`)
  const cardInput = (subject) => `(() => { const card = [...document.querySelectorAll('main .MuiCard-root')].find((c) => c.textContent.includes(${JSON.stringify(subject)})); if (!card) return null; const input = card.querySelector('input'); if (!input) return null; input.scrollIntoView({ block: 'center' }); const r = input.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`
  const cardInputVal = (subject) => `(() => { const card = [...document.querySelectorAll('main .MuiCard-root')].find((c) => c.textContent.includes(${JSON.stringify(subject)})); if (!card) return null; const input = card.querySelector('input'); return input ? input.value : null })()`
  const formInput = (labelText) => `(() => { const lab = [...document.querySelectorAll('main label')].filter((x) => x.textContent.replace(/[\\s*]+/g, ' ').trim().startsWith(${JSON.stringify(labelText)})); const lab2 = lab[lab.length - 1]; if (!lab2) return null; const wrap = lab2.closest('.MuiFormControl-root') || lab2.parentElement; const input = wrap.querySelector('input'); if (!input) return null; input.scrollIntoView({ block: 'center' }); const r = input.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`
  const formInputVal = (labelText) => `(() => { const lab = [...document.querySelectorAll('main label')].filter((x) => x.textContent.replace(/[\\s*]+/g, ' ').trim().startsWith(${JSON.stringify(labelText)})); const lab2 = lab[lab.length - 1]; if (!lab2) return null; const wrap = lab2.closest('.MuiFormControl-root') || lab2.parentElement; const input = wrap.querySelector('input'); return input ? input.value : null })()`

  await cmd('Page.enable'); await cmd('Runtime.enable')
  // 1. Load the new page
  await cmd('Page.navigate', { url: 'http://localhost:3002/approbations?l=en' })
  await waitFor(() => evl(`document.querySelector('.agency-dashboard__title') && document.querySelector('.agency-dashboard__title').textContent.trim() === 'Approvals'`), 'approvals title')
  const residueText = await cardText('GA-P1-APPROVALS-UI-01')
  const queueBefore = await evl(`[...document.querySelectorAll('main .MuiCard-root')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160))`)
  step('load-page', { title: 'Approvals', queueCardsBefore: queueBefore.length, ui01ResidueRendered: residueText })
  if (!residueText) throw new Error('RESIDUE_NOT_RENDERED')

  // 2. Nav drawer contains the Approvals entry
  const menuBtn = await evl(`(() => { const b = document.querySelector('button[aria-label="open drawer"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  let drawerItems = []
  if (menuBtn) {
    await clickAt(menuBtn.x, menuBtn.y); await sleep(800)
    drawerItems = await evl(`[...document.querySelectorAll('.MuiDrawer-paper .MuiListItemText-primary')].map((x) => x.textContent.trim())`)
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }); await sleep(400)
  }
  step('nav-drawer', { items: drawerItems, approvalsEntryPresent: drawerItems.includes('Approvals') })

  // 3. Seed fixture A via API (creation only; decision happens in the UI)
  const sup = await api('/api/all-suppliers')
  const apex = sup.body.find((s) => s.fullName === 'Apex Car Rentals')
  const subjectA = `${MARK} A`
  const seedA = await api('/api/approvals', 'POST', { supplier: apex._id, subject: subjectA, subjectType: 'ui-proof', amount: 2, reason: 'synthetic fixture A (API seed)' })
  step('seed-fixture-a', { status: seedA.status, id: seedA.body && seedA.body._id, approvalStatus: seedA.body && seedA.body.status })
  if (seedA.status !== 201) throw new Error('SEED_A_FAILED')

  // 4. Refresh through the UI and confirm A renders as Pending with actions
  const refreshBtn = await waitFor(() => evl(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Refresh'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`), 'refresh button')
  await clickAt(refreshBtn.x, refreshBtn.y)
  await waitFor(async () => { const t = await cardText(subjectA); return t && t.includes('Pending') ? t : null }, 'fixture A pending card')
  const approveBtn = await cardButton(subjectA, 'Approve')
  const rejectBtn = await cardButton(subjectA, 'Reject')
  step('fixture-a-rendered', { card: await cardText(subjectA), approveButton: approveBtn, rejectButton: rejectBtn })
  if (!approveBtn || approveBtn.disabled || !rejectBtn) throw new Error('DECIDE_BUTTONS_MISSING')

  // 5. Type a decision reason into A's card and click Approve
  const reasonA = `UI decision reason ${MARK}`
  await typeInto(cardInput(subjectA), cardInputVal(subjectA), reasonA)
  const approveBtn2 = await cardButton(subjectA, 'Approve')
  await clickAt(approveBtn2.x, approveBtn2.y)
  await waitFor(async () => { const t = await cardText(subjectA); return t && t.includes('Approved') && t.includes('Decided by') ? t : null }, 'fixture A approved render', 20000)
  const readA = await api('/api/approvals')
  const recA = (readA.body || []).find((a) => a._id === seedA.body._id)
  step('fixture-a-decided-ui', {
    rendered: await cardText(subjectA),
    readback: recA && { status: recA.status, decidedBy: recA.decidedBy, decidedAt: recA.decidedAt, reason: recA.reason },
  })
  if (!recA || recA.status !== 'approved' || !recA.decidedBy || !recA.decidedAt || recA.reason !== reasonA) throw new Error('READBACK_A_MISMATCH')

  // 6. Fixture B through the page's own create form, then Reject in the UI
  const subjectB = `${MARK} B`
  await typeInto(formInput('Subject'), formInputVal('Subject'), subjectB)
  await typeInto(formInput('Type'), formInputVal('Type'), 'ui-proof')
  await typeInto(formInput('Amount'), formInputVal('Amount'), '3')
  await typeInto(formInput('Reason'), formInputVal('Reason'), 'synthetic fixture B (UI form)')
  const createBtn = await waitFor(() => evl(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Create request'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: b.disabled } })()`), 'create button')
  if (createBtn.disabled) throw new Error('CREATE_BUTTON_DISABLED')
  await clickAt(createBtn.x, createBtn.y)
  await waitFor(async () => { const t = await cardText(subjectB); return t && t.includes('Pending') ? t : null }, 'fixture B pending card', 20000)
  const readB1 = await api('/api/approvals')
  const recB = (readB1.body || []).find((a) => a.subject === subjectB)
  step('fixture-b-created-ui', { rendered: await cardText(subjectB), readback: recB && { id: recB._id, supplier: recB.supplier, status: recB.status, amount: recB.amount } })
  if (!recB) throw new Error('READBACK_B_MISSING')
  const reasonB = `UI rejection reason ${MARK}`
  await typeInto(cardInput(subjectB), cardInputVal(subjectB), reasonB)
  const rejectBtnB = await cardButton(subjectB, 'Reject')
  await clickAt(rejectBtnB.x, rejectBtnB.y)
  await waitFor(async () => { const t = await cardText(subjectB); return t && t.includes('Rejected') && t.includes('Decided by') ? t : null }, 'fixture B rejected render', 20000)
  const readB2 = await api('/api/approvals')
  const recB2 = (readB2.body || []).find((a) => a._id === recB._id)
  step('fixture-b-decided-ui', {
    rendered: await cardText(subjectB),
    readback: recB2 && { status: recB2.status, decidedBy: recB2.decidedBy, decidedAt: recB2.decidedAt, reason: recB2.reason },
  })
  if (!recB2 || recB2.status !== 'rejected' || !recB2.decidedBy || !recB2.decidedAt || recB2.reason !== reasonB) throw new Error('READBACK_B_MISMATCH')

  ev.finalState = { fixtureA: seedA.body._id, fixtureB: recB._id, residueNote: 'No approval delete route exists; both fixtures remain as labeled synthetic records (subjects carry the GA-APPROVALS-UI02 marker).' }
  ev.outcome = 'complete'
  save(); ws.close(); console.log('DONE', ev.outcome)
})().catch((e) => { ev.error = e.message; ev.outcome = 'failed'; try { save() } catch {}; console.error('FAILED', e.message); process.exit(1) })
