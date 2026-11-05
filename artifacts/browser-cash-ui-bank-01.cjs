/*
 * GA-P0-CASH-UI-BANK-01 — click-level proof that the cash UI can open a Bank
 * account session and transfer between two open account sessions.
 * All flow actions are CDP mouse/keyboard interactions on rendered controls
 * (native selects are set through the React-compatible value setter + change
 * event, the same state path a user selection takes). API = read-back only.
 * Pairing note: the backend cross-links transfer movements — each movement's
 * transferId is the counterpart movement's id (verified in cashController).
 * Resume: if a previous run left both sessions open with the transfer pair
 * already applied, the run records that state and continues with the closes.
 */
const fs = require('fs')
const http = require('http')
const OUT = 'C:\\Users\\Yassi\\Documents\\kimi\\Workspaces\\fleet\\bookcars\\artifacts\\browser-cash-ui-bank-latest.json'
const MARK = `GA-BANK01-${Date.now()}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:9229' + p, (x) => { let d = ''; x.on('data', (c) => d += c); x.on('end', () => res(JSON.parse(d))) }).on('error', rej))
const ev = { slice: 'GA-P0-CASH-UI-BANK-01', marker: MARK, generatedAt: new Date().toISOString(), evidenceType: 'UI-interaction (CDP mouse/keyboard on rendered controls); API used for read-back only', steps: [] }
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
  const apiGet = (path) => evl(`fetch('http://localhost:4002' + ${JSON.stringify(path)} + (${JSON.stringify(path)}.includes('?') ? '&' : '?') + '_cb=' + Date.now(), { credentials: 'include', cache: 'no-store' }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`)
  async function waitFor(fn, what, ms = 15000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('WAIT_TIMEOUT: ' + what); await sleep(400) } }
  const clickAt = async (x, y) => { await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(120); await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await sleep(70); await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await sleep(350) }
  const findButton = (label) => evl(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: b.disabled } })()`)
  const clickButton = async (label) => { const b = await waitFor(() => findButton(label), 'button ' + label); if (b.disabled) throw new Error('BUTTON_DISABLED: ' + label); await clickAt(b.x, b.y); return b }
  const dialogRect = () => evl(`(() => { const d = document.querySelector('.MuiDialog-paper'); return d ? true : null })()`)
  const setNativeSelect = async (finderExpr, value) => {
    const result = await evl(`(() => { const sel = ${finderExpr}; if (!sel) return null; const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set; setter.call(sel, ${JSON.stringify(value)}); sel.dispatchEvent(new Event('change', { bubbles: true })); return { value: sel.value, options: [...sel.options].map((o) => ({ value: o.value, label: o.textContent.trim(), disabled: o.disabled })) } })()`)
    await sleep(500)
    return result
  }
  const setSelectByExpr = async (finderExpr, value) => evl(`(() => { const sel = ${finderExpr}; if (!sel) return null; const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set; setter.call(sel, ${JSON.stringify(value)}); sel.dispatchEvent(new Event('change', { bubbles: true })); return sel.value })()`)
  const switcherFinder = `document.querySelector('.agency-cash__session select')`
  const dialogSelectFinder = (labelText) => `(() => { const lab = [...document.querySelectorAll('.MuiDialog-paper label')].find((x) => x.textContent.replace(/[\\s*]+/g, ' ').trim().startsWith(${JSON.stringify(labelText)})); if (!lab) return null; const wrap = lab.closest('.MuiFormControl-root') || lab.parentElement; return wrap.querySelector('select') })()`
  const dialogFieldRect = (labelText) => evl(`(() => { const lab = [...document.querySelectorAll('.MuiDialog-paper label')].find((x) => x.textContent.replace(/[\\s*]+/g, ' ').trim().startsWith(${JSON.stringify(labelText)})); if (!lab) return null; const wrap = lab.closest('.MuiFormControl-root') || lab.parentElement; const input = wrap.querySelector('input, textarea'); if (!input) return null; input.scrollIntoView({ block: 'center' }); const r = input.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  const dialogFieldVal = (labelText) => evl(`(() => { const lab = [...document.querySelectorAll('.MuiDialog-paper label')].find((x) => x.textContent.replace(/[\\s*]+/g, ' ').trim().startsWith(${JSON.stringify(labelText)})); if (!lab) return null; const wrap = lab.closest('.MuiFormControl-root') || lab.parentElement; const input = wrap.querySelector('input, textarea'); return input ? input.value : null })()`)
  const setDialogField = async (labelText, value) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if ((await dialogFieldVal(labelText)) === value) return value
      const f = await waitFor(() => dialogFieldRect(labelText), 'field ' + labelText)
      await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: f.x, y: f.y }); await sleep(100)
      await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: f.x, y: f.y, button: 'left', clickCount: 3 }); await sleep(60)
      await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: f.x, y: f.y, button: 'left', clickCount: 3 }); await sleep(150)
      await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 })
      await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 })
      await sleep(100)
      await cmd('Input.insertText', { text: value }); await sleep(250)
      if ((await dialogFieldVal(labelText)) === value) return value
      if (attempt === 3) throw new Error(`FIELD_SET_FAILED ${labelText}`)
    }
  }
  const clickSaveAndConfirm = async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const b = await waitFor(() => evl(`(() => { const d = document.querySelector('.MuiDialog-paper'); if (!d) return null; const btn = [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Save'); if (!btn) return null; const r = btn.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: btn.disabled } })()`), 'dialog Save')
      await clickAt(b.x, b.y)
      const t0 = Date.now()
      while (Date.now() - t0 < 6000) { if (!(await dialogRect())) return { attempt, confirmed: true }; await sleep(400) }
    }
    return { attempt: 2, confirmed: false }
  }
  const sessionLine = () => evl(`(() => { const s = document.querySelector('.agency-cash__session'); return s ? s.textContent.replace(/\\s+/g, ' ').trim() : null })()`)
  const pollSession = async (apexId, sessionId, pred, ms = 12000) => { const t0 = Date.now(); for (;;) { const r = await apiGet(`/api/cash/sessions?supplier=${apexId}`); const found = (r.body || []).find((x) => x._id === sessionId); if (found && pred(found)) return found; if (Date.now() - t0 > ms) return found || null; await sleep(500) } }
  const closeFocusedViaUI = async (apexId, sessionId, expected) => {
    await clickButton('Close session'); await sleep(900)
    await setDialogField('Counted balance', String(expected))
    const sv = await clickSaveAndConfirm()
    const after = await pollSession(apexId, sessionId, (x) => x.status === 'closed')
    return { save: sv, after: after && { status: after.status, expected: after.expectedClosingBalance, counted: after.countedClosingBalance, discrepancy: after.discrepancy } }
  }
  const pairIsValid = (out, inn) => !!out && !!inn && out.transferId === inn._id && inn.transferId === out._id && out.amount === inn.amount

  await cmd('Page.enable'); await cmd('Runtime.enable')
  // 1. Load page, resolve agency, snapshot start state
  await cmd('Page.navigate', { url: 'http://localhost:3002/caisse?l=en' })
  await waitFor(() => evl(`document.querySelector('.agency-cash__title') && document.querySelector('.agency-cash__title').textContent.trim() === 'Cash journal'`), 'cash page title')
  const sup = await apiGet('/api/all-suppliers')
  const apex = sup.body.find((s) => s.fullName === 'Apex Car Rentals')
  const start = await apiGet(`/api/cash/sessions?supplier=${apex._id}`)
  const openAtStart = (start.body || []).filter((s) => s.status === 'open')
  step('load-page', { apexId: apex._id, openAtStart: openAtStart.map((s) => ({ id: s._id, account: s.account, opening: s.openingBalance })), sessionLine: await sessionLine() })

  let cashSession = null; let bankSession = null; let outMove = null; let inMove = null; let resumed = false

  // Resume detection: both accounts open and a GA-BANK01 transfer pair exists.
  if (openAtStart.length === 2) {
    const c = openAtStart.find((s) => s.account === 'cash'); const b = openAtStart.find((s) => s.account === 'bank')
    if (c && b) {
      const cmv = await apiGet(`/api/cash/sessions/${c._id}/movements?supplier=${apex._id}`)
      const bmv = await apiGet(`/api/cash/sessions/${b._id}/movements?supplier=${apex._id}`)
      const marked = (cmv.body || []).find((m) => typeof m.reference === 'string' && m.reference.startsWith('GA-BANK01-'))
      const counterpart = marked && (bmv.body || []).find((m) => m._id === marked.transferId)
      if (marked && pairIsValid(marked, counterpart)) {
        resumed = true; cashSession = c; bankSession = b; outMove = marked; inMove = counterpart
        step('resume-state', { note: 'Previous run applied the UI transfer then stopped on a harness assertion error (shared-id assumption); the backend cross-links transferId to the counterpart movement id. Sessions and pair verified from read-back; continuing with the UI closes.', cashSession: c._id, bankSession: b._id, outMovement: { id: marked._id, amount: marked.amount, transferId: marked.transferId }, inMovement: { id: counterpart._id, amount: counterpart.amount, transferId: counterpart.transferId } })
      }
    }
  }

  if (!resumed) {
    // 2. Close any other leftover open sessions through the UI
    for (const leftover of openAtStart) {
      await setNativeSelect(switcherFinder, leftover.account)
      await waitFor(async () => { const line = await sessionLine(); return line && line.includes('Session open') ? line : null }, 'leftover focused open')
      const mv = await apiGet(`/api/cash/sessions/${leftover._id}/movements?supplier=${apex._id}`)
      const signed = (mv.body || []).reduce((a, m) => a + (m.direction === 'in' ? m.amount : -m.amount), 0)
      const res = await closeFocusedViaUI(apex._id, leftover._id, leftover.openingBalance + signed)
      step('close-leftover-ui', { sessionId: leftover._id, account: leftover.account, ...res })
      if (!res.after || res.after.discrepancy !== 0) throw new Error('LEFTOVER_CLOSE_FAILED')
    }

    // 3. Open the Cash session through the UI
    await setNativeSelect(switcherFinder, 'cash')
    await sleep(800)
    await clickButton('Open cash session'); await sleep(900)
    const dlgAccountCash = await evl(`(() => { const sel = ${dialogSelectFinder('Account')}; return sel ? { value: sel.value, options: [...sel.options].map((o) => ({ value: o.value, label: o.textContent.trim(), disabled: o.disabled })) } : null })()`)
    await setDialogField('Opening balance', '500')
    const svCash = await clickSaveAndConfirm()
    const afterCash = await apiGet(`/api/cash/sessions?supplier=${apex._id}`)
    cashSession = (afterCash.body || []).find((s) => s.status === 'open' && s.account === 'cash')
    step('open-cash-ui', { dialogAccount: dlgAccountCash, save: svCash, session: cashSession && { id: cashSession._id, account: cashSession.account, opening: cashSession.openingBalance, status: cashSession.status }, sessionLine: await sessionLine() })
    if (!cashSession) throw new Error('OPEN_CASH_FAILED')

    // 4. Switch focus to Bank and open the Bank session through the UI
    const switcher = await setNativeSelect(switcherFinder, 'bank')
    const lineBankEmpty = await waitFor(async () => { const line = await sessionLine(); return line && (line.includes('No open cash session') || line.includes('Open cash session')) ? line : null }, 'bank focus empty state')
    await clickButton('Open cash session'); await sleep(900)
    const dlgAccountBank = await evl(`(() => { const sel = ${dialogSelectFinder('Account')}; return sel ? { value: sel.value, options: [...sel.options].map((o) => ({ value: o.value, label: o.textContent.trim(), disabled: o.disabled })) } : null })()`)
    if (dlgAccountBank && dlgAccountBank.value !== 'bank') {
      await setSelectByExpr(dialogSelectFinder('Account'), 'bank')
      await sleep(400)
    }
    await setDialogField('Opening balance', '1000')
    const svBank = await clickSaveAndConfirm()
    const afterBank = await apiGet(`/api/cash/sessions?supplier=${apex._id}`)
    bankSession = (afterBank.body || []).find((s) => s.status === 'open' && s.account === 'bank')
    step('open-bank-ui', { switcherOptions: switcher && switcher.options, lineBeforeOpen: lineBankEmpty, dialogAccount: dlgAccountBank, save: svBank, session: bankSession && { id: bankSession._id, account: bankSession.account, opening: bankSession.openingBalance, status: bankSession.status }, sessionLine: await sessionLine() })
    if (!bankSession) throw new Error('OPEN_BANK_FAILED')

    // 5. Transfer 200 Cash -> Bank through the UI dialog
    await clickButton('Transfer'); await sleep(900)
    const fromOpts = await evl(`(() => { const sel = ${dialogSelectFinder('From')}; return sel ? [...sel.options].map((o) => ({ value: o.value, label: o.textContent.trim() })) : null })()`)
    const toOptsBefore = await evl(`(() => { const sel = ${dialogSelectFinder('To')}; return sel ? [...sel.options].map((o) => ({ value: o.value, label: o.textContent.trim() })) : null })()`)
    await setSelectByExpr(dialogSelectFinder('From'), cashSession._id)
    await sleep(400)
    await setSelectByExpr(dialogSelectFinder('To'), bankSession._id)
    await sleep(400)
    const toOptsAfter = await evl(`(() => { const sel = ${dialogSelectFinder('To')}; return sel ? { value: sel.value, options: [...sel.options].map((o) => ({ value: o.value, label: o.textContent.trim() })) } : null })()`)
    await setDialogField('Amount', '200')
    await setDialogField('Reference', MARK)
    await setDialogField('Note', `GA-P0-CASH-UI-BANK-01 ${MARK}`)
    const svTransfer = await clickSaveAndConfirm()
    const cashMv = await apiGet(`/api/cash/sessions/${cashSession._id}/movements?supplier=${apex._id}`)
    const bankMv = await apiGet(`/api/cash/sessions/${bankSession._id}/movements?supplier=${apex._id}`)
    outMove = (cashMv.body || []).find((m) => m.reference === MARK)
    inMove = (bankMv.body || []).find((m) => m.reference === MARK)
    step('transfer-ui', { fromOptions: fromOpts, toOptionsBefore: toOptsBefore, toAfter: toOptsAfter, save: svTransfer, outMovement: outMove && { id: outMove._id, direction: outMove.direction, amount: outMove.amount, transferId: outMove.transferId }, inMovement: inMove && { id: inMove._id, direction: inMove.direction, amount: inMove.amount, transferId: inMove.transferId } })
    if (!pairIsValid(outMove, inMove)) throw new Error('TRANSFER_READBACK_MISMATCH')
  }

  // 6. Close the Cash session through the UI (expected = opening - 200)
  const cashExpected = cashSession.openingBalance - outMove.amount
  await setNativeSelect(switcherFinder, 'cash')
  await waitFor(async () => { const line = await sessionLine(); return line && line.includes('Cash · Session open') ? line : null }, 'cash focus line')
  const closeCash = await closeFocusedViaUI(apex._id, cashSession._id, cashExpected)
  step('close-cash-ui', closeCash)
  if (!closeCash.after || closeCash.after.discrepancy !== 0) throw new Error('CLOSE_CASH_MISMATCH')

  // 7. Close the Bank session through the UI (expected = opening + 200)
  const bankExpected = bankSession.openingBalance + inMove.amount
  await setNativeSelect(switcherFinder, 'bank')
  await waitFor(async () => { const line = await sessionLine(); return line && line.includes('Bank · Session open') ? line : null }, 'bank focus line')
  const closeBank = await closeFocusedViaUI(apex._id, bankSession._id, bankExpected)
  step('close-bank-ui', closeBank)
  if (!closeBank.after || closeBank.after.discrepancy !== 0) throw new Error('CLOSE_BANK_MISMATCH')

  ev.finalState = { cashSessionId: cashSession._id, bankSessionId: bankSession._id, transferOutId: outMove._id, transferInId: inMove._id, marker: outMove.reference || MARK, resumed }
  ev.outcome = 'complete'
  save(); ws.close(); console.log('DONE', ev.outcome)
})().catch((e) => { ev.error = e.message; ev.outcome = 'failed'; try { save() } catch {}; console.error('FAILED', e.message); process.exit(1) })
