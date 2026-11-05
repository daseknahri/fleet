/*
 * GA-P0-CASH-UI-CLICKFLOW-01 (v2, after sign-in payload fix)
 * Cash journal click-level acceptance on /caisse.
 * All flow actions are CDP mouse/keyboard interactions on the rendered UI.
 * API is used only for read-back verification. Writes evidence JSON next to it.
 */
const fs = require('fs')
const http = require('http')
const OUT = 'C:\\Users\\Yassi\\Documents\\kimi\\Workspaces\\fleet\\bookcars\\artifacts\\browser-cash-ui-clickflow-latest.json'
const MARK = `GA-CLICKFLOW-${Date.now()}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:9229' + p, (x) => { let d = ''; x.on('data', (c) => d += c); x.on('end', () => res(JSON.parse(d))) }).on('error', rej))
const ev = { slice: 'GA-P0-CASH-UI-CLICKFLOW-01', marker: MARK, generatedAt: new Date().toISOString(), evidenceType: 'UI-interaction (CDP mouse/keyboard on rendered controls); API used for read-back only', steps: [], fixApplied: 'backend sign-in/socialSignin payload now includes user type + supplier (userController.ts)' }
const step = (name, data) => { ev.steps.push({ name, at: new Date().toISOString(), ...data }); console.log('STEP', name, JSON.stringify(data).slice(0, 300)) }
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
  const apiGet = (path) => evl(`fetch('http://localhost:4002' + '${path}' + ('${path}'.includes('?') ? '&' : '?') + '_cb=' + Date.now(), { credentials: 'include', cache: 'no-store' }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`)
  async function waitFor(fn, arg, what, ms = 15000) { const t0 = Date.now(); for (;;) { const v = await fn(arg); if (v) return v; if (Date.now() - t0 > ms) throw new Error('WAIT_TIMEOUT: ' + what); await sleep(400) } }
  const findButton = (label) => evl(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: b.disabled } })()`)
  const clickAt = async (x, y) => { await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(120); await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await sleep(70); await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await sleep(350) }
  const clickButton = async (label) => { const b = await waitFor(findButton, label, 'button ' + label); if (b.disabled) throw new Error('BUTTON_DISABLED: ' + label); await clickAt(b.x, b.y); return b }
  const dialogRect = () => evl(`(() => { const d = document.querySelector('.MuiDialog-paper'); if (!d) return null; const r = d.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
  async function findField(labelText) { return evl(`(() => { const lab = [...document.querySelectorAll('.MuiDialog-paper label')].find((x) => x.textContent.replace(/[\\s*]+/g, ' ').trim().startsWith(${JSON.stringify(labelText)})); if (!lab) return null; const wrap = lab.closest('.MuiFormControl-root') || lab.parentElement; const input = wrap.querySelector('input, textarea'); if (!input) return null; const r = input.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: input.id } })()`) }
  async function setField(labelText, value) {
    const readVal = () => evl(`(() => { const lab = [...document.querySelectorAll('.MuiDialog-paper label')].find((x) => x.textContent.replace(/[\\s*]+/g, ' ').trim().startsWith(${JSON.stringify(labelText)})); if (!lab) return null; const wrap = lab.closest('.MuiFormControl-root') || lab.parentElement; const input = wrap.querySelector('input, textarea'); return input ? input.value : null })()`)
    const selState = () => evl(`(() => { const lab = [...document.querySelectorAll('.MuiDialog-paper label')].find((x) => x.textContent.replace(/[\\s*]+/g, ' ').trim().startsWith(${JSON.stringify(labelText)})); if (!lab) return null; const wrap = lab.closest('.MuiFormControl-root') || lab.parentElement; const input = wrap.querySelector('input, textarea'); return input ? { s: input.selectionStart, e: input.selectionEnd, len: input.value.length } : null })()`)
    for (let attempt = 1; attempt <= 3; attempt++) {
      const cur = await readVal()
      if (cur === value) return cur
      const f = await waitFor(() => findField(labelText), null, 'field ' + labelText)
      // triple-click to select existing content
      await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: f.x, y: f.y }); await sleep(100)
      await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: f.x, y: f.y, button: 'left', clickCount: 3 }); await sleep(60)
      await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: f.x, y: f.y, button: 'left', clickCount: 3 }); await sleep(150)
      let sel = await selState()
      if (!sel || sel.s !== 0 || sel.e !== sel.len) {
        await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 })
        await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 })
        await sleep(120)
        sel = await selState()
      }
      if (sel && sel.s === 0 && sel.e === sel.len && sel.len > 0) {
        await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 })
        await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 })
        await sleep(120)
      }
      await cmd('Input.insertText', { text: value }); await sleep(250)
      const val = await readVal()
      if (val === value) return val
      if (attempt === 3) throw new Error(`FIELD_SET_FAILED ${labelText}: got ${JSON.stringify(val)} want ${JSON.stringify(value)}`)
    }
  }
  async function clickSaveAndConfirm() {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const b = await waitFor(() => evl(`(() => { const d = document.querySelector('.MuiDialog-paper'); if (!d) return null; const btn = [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Save'); if (!btn) return null; const r = btn.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: btn.disabled } })()`), null, 'dialog Save')
      await clickAt(b.x, b.y)
      const t0 = Date.now()
      while (Date.now() - t0 < 6000) { if (!(await dialogRect())) return { attempt, confirmed: true }; await sleep(400) }
    }
    return { attempt: 2, confirmed: false }
  }
  const pollSession = async (apexId, sessionId, pred, ms = 10000) => { const t0 = Date.now(); for (;;) { const r = await apiGet(`/api/cash/sessions?supplier=${apexId}`); const found = (r.body || []).find((x) => x._id === sessionId); if (found && pred(found)) return found; if (Date.now() - t0 > ms) return found || null; await sleep(500) } }
  const rendered = () => evl(`(() => ({ sessionLine: (document.querySelector('.agency-cash__session') || {}).textContent?.replace(/\\s+/g, ' ').trim() || null, alerts: [...document.querySelectorAll('.agency-cash .MuiAlert-message')].map((a) => a.textContent.trim()), buttons: [...document.querySelectorAll('.agency-cash__session-actions button, .agency-cash button')].map((b) => b.textContent.trim()).filter(Boolean), toolbarSelect: (() => { const s = document.querySelector('.agency-cash__toolbar .MuiSelect-select'); return s ? s.textContent.trim() : null })(), rows: [...document.querySelectorAll('.agency-cash__list li')].map((li) => li.textContent.replace(/\\s+/g, ' ').trim()) }))()`)

  await cmd('Page.enable'); await cmd('Runtime.enable')
  // 1. Load page
  await cmd('Page.navigate', { url: 'http://localhost:3002/caisse?l=en' })
  await waitFor(() => evl(`document.querySelector('.agency-cash__title') && document.querySelector('.agency-cash__title').textContent.trim() === 'Cash journal'`), null, 'cash page title')
  const agencySel = await waitFor(() => evl(`(() => { const s = document.querySelector('.agency-cash__toolbar .MuiSelect-select'); return s && s.textContent.includes('Apex Car Rentals') ? s.textContent.trim() : null })()`), null, 'admin agency toolbar with Apex selected', 20000).catch(() => null)
  let r0 = await rendered()
  step('load-page', { agencyToolbarVisible: !!agencySel, agencySelected: agencySel, sessionLine: r0.sessionLine, alerts: r0.alerts, buttons: [...new Set(r0.buttons)] })
  // 2. Read-back start
  const sup = await apiGet('/api/all-suppliers')
  const apex = sup.body.find((s) => s.fullName === 'Apex Car Rentals')
  const start = await apiGet(`/api/cash/sessions?supplier=${apex._id}`)
  const openAtStart = (start.body || []).filter((s) => s.status === 'open')
  step('readback-start', { apexId: apex._id, sessionsTotal: (start.body || []).length, openAtStart: openAtStart.map((s) => ({ id: s._id, opening: s.openingBalance, account: s.account })) })
  // 3. Close leftover open sessions through the UI, but resume one that already
  // carries a GA-CLICKFLOW marker movement from an interrupted run of this script.
  let working = null
  for (const leftover of openAtStart) {
    const mv0 = await apiGet(`/api/cash/sessions/${leftover.id}/movements?supplier=${apex._id}`)
    const marked = (mv0.body || []).find((mm) => typeof mm.reference === 'string' && mm.reference.startsWith('GA-CLICKFLOW-'))
    if (marked) { working = { session: leftover, movement: marked }; continue }
    const mv = mv0
    const signed = (mv.body || []).reduce((a, m) => a + (m.direction === 'in' ? m.amount : -m.amount), 0)
    const expected = leftover.openingBalance + signed
    await clickButton('Close session'); await sleep(900)
    await setField('Counted balance', String(expected))
    const sv = await clickSaveAndConfirm()
    const after = await pollSession(apex._id, leftover.id, (x) => x.status === 'closed')
    step('close-leftover-ui', { sessionId: leftover.id, countedEntered: expected, save: sv, after: after && { status: after.status, expected: after.expectedClosingBalance, counted: after.countedClosingBalance, discrepancy: after.discrepancy } })
    if (!after || after.status !== 'closed') throw new Error('LEFTOVER_CLOSE_FAILED')
  }
  // 4. Open a new session through the UI (skipped when resuming)
  let newSession = working ? working.session : null
  let movement = working ? working.movement : null
  if (!newSession) {
    await clickButton('Open cash session'); await sleep(900)
    await setField('Opening balance', '500')
    const svOpen = await clickSaveAndConfirm()
    const afterOpen = await apiGet(`/api/cash/sessions?supplier=${apex._id}`)
    newSession = (afterOpen.body || []).find((x) => x.status === 'open')
    const rOpen = await rendered()
    step('open-session-ui', { save: svOpen, session: newSession && { id: newSession._id, account: newSession.account, opening: newSession.openingBalance, status: newSession.status }, sessionLine: rOpen.sessionLine, buttons: [...new Set(rOpen.buttons)] })
    if (!newSession) throw new Error('OPEN_FAILED')
  } else {
    step('open-session-ui', { resumed: true, session: { id: newSession._id, account: newSession.account, opening: newSession.openingBalance, status: newSession.status } })
  }
  // 5. Add a manual movement through the UI (skipped when resuming)
  if (!movement) {
    await clickButton('Add movement'); await sleep(900)
    await setField('Amount', '150')
    await setField('Reference', MARK)
    await setField('Note', `GA-P0-CASH-UI-CLICKFLOW-01 ${MARK}`)
    const svMv = await clickSaveAndConfirm()
    const amountRow = await waitFor(() => evl(`(() => { const li = [...document.querySelectorAll('.agency-cash__list li')].find((x) => x.textContent.includes('150')); return li ? li.textContent.replace(/\\s+/g, ' ').trim() : null })()`), null, 'movement amount row', 12000).catch(() => null)
    const rMv = await rendered()
    const mvList = await apiGet(`/api/cash/sessions/${newSession._id}/movements?supplier=${apex._id}`)
    movement = (mvList.body || []).find((m) => m.reference === MARK)
    step('add-movement-ui', { save: svMv, amountRowRendered: amountRow, rowsRendered: rMv.rows, sessionLine: rMv.sessionLine, movement: movement && { id: movement._id, direction: movement.direction, amount: movement.amount, source: movement.source, note: movement.note } })
    if (!movement) throw new Error('MOVEMENT_FAILED')
  } else {
    step('add-movement-ui', { resumed: true, movement: { id: movement._id, direction: movement.direction, amount: movement.amount, source: movement.source, note: movement.note } })
  }
  // 6. Transfer dialog: capture destination options, then Cancel
  await clickButton('Transfer'); await sleep(900)
  const dlg = await evl(`(() => { const d = document.querySelector('.MuiDialog-paper'); if (!d) return null; const sel = d.querySelector('.MuiSelect-select'); let selRect = null; if (sel) { const r = sel.getBoundingClientRect(); selRect = { x: r.x + r.width / 2, y: r.y + r.height / 2 } } return { title: (d.querySelector('h2') || {}).textContent || '', text: d.textContent.replace(/\\s+/g, ' ').trim().slice(0, 300), selRect, selectDisplay: sel ? sel.textContent.trim() : null } })()`)
  let menuOptions = []
  if (dlg && dlg.selRect) { await clickAt(dlg.selRect.x, dlg.selRect.y); await sleep(700); menuOptions = await evl(`[...document.querySelectorAll('.MuiMenuItem-root')].map((mi) => mi.textContent.trim())`); await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }); await sleep(300) }
  const cancelBtn = await evl(`(() => { const d = document.querySelector('.MuiDialog-paper'); if (!d) return null; const b = [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Cancel'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  if (cancelBtn) await clickAt(cancelBtn.x, cancelBtn.y)
  await sleep(500)
  step('transfer-dialog-ui', { dialogTitle: dlg && dlg.title, selectDisplay: dlg && dlg.selectDisplay, destinationOptionsRendered: menuOptions, finding: menuOptions.length <= 1 ? 'No destination session is offered: the open-session dialog hardcodes account Cash and only one Cash session can be open per agency, so a second open account session cannot be created through this UI; transfer cannot be exercised at click level.' : 'destinations offered' })
  // 7. Close with counted = expected (650)
  const rPreClose = await rendered()
  await clickButton('Close session'); await sleep(900)
  await setField('Counted balance', '650')
  const svClose = await clickSaveAndConfirm()
  const rClosed = await rendered()
  const finSession = await pollSession(apex._id, newSession._id, (x) => x.status === 'closed')
  step('close-session-ui', { preCloseSessionLine: rPreClose.sessionLine, save: svClose, renderedAfter: rClosed.sessionLine, final: finSession && { status: finSession.status, opening: finSession.openingBalance, expected: finSession.expectedClosingBalance, counted: finSession.countedClosingBalance, discrepancy: finSession.discrepancy } })
  ev.finalState = { sessionId: newSession._id, movementId: movement._id, marker: MARK }
  ev.outcome = finSession && finSession.status === 'closed' && finSession.discrepancy === 0 ? 'flow-complete-except-transfer-ui-limitation' : 'incomplete'
  save(); ws.close(); console.log('DONE', ev.outcome)
})().catch((e) => { ev.error = e.message; ev.outcome = 'failed'; try { save() } catch {} ; console.error('FAILED', e.message); process.exit(1) })
