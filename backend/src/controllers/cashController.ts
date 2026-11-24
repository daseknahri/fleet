import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import CashSession from '../models/CashSession'
import CashMovement from '../models/CashMovement'
import RentalPayment from '../models/RentalPayment'
import User from '../models/User'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId, logAdminResourceAccess } from '../utils/agencyAuthorization'
import { normalizeLedgerAmount } from '../utils/ledger'
import { parsePagination, pagedResponse, paginationSkip } from '../utils/pagination'
import { renderCashSessionPdf } from '../utils/cashSessionPdf'
import * as env from '../config/env.config'

const currency = () => env.BASE_CURRENCY.toUpperCase()

const adminSupplierSelector = (req: Request) => {
  const raw = req.body?.supplier ?? req.query.supplier ?? req.params.supplierId
  return typeof raw === 'string' && mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(raw) : undefined
}

const effectiveSupplierId = (req: Request) => {
  const agency = agencySupplierId(req)
  if (agency) return agency
  if (req.user?.type !== bookcarsTypes.UserType.Admin) return undefined
  const selected = adminSupplierSelector(req)
  return selected?.toString()
}

const getScope = (req: Request): Record<string, unknown> => {
  if (req.user?.type !== bookcarsTypes.UserType.Admin) {
    return { supplier: agencySupplierId(req) || '000000000000000000000000' }
  }
  // Platform admins may narrow the cash view to one agency. Without an explicit
  // selector the unscoped view is retained for backward-compatible reporting.
  const supplier = adminSupplierSelector(req)
  return supplier ? { supplier } : {}
}

export const listSessions = async (req: Request, res: Response) => {
  try {
    // F6 / W3 X-1 — server-side pagination + status / account filters.
    // No page/size params keeps the legacy full-array response.
    const parsed = parsePagination(req)
    if ('error' in parsed) {
      res.status(400).send(parsed.error)
      return
    }
    const filter: Record<string, unknown> = { ...getScope(req) }
    if (typeof req.query.status === 'string' && req.query.status) {
      if (!Object.values(bookcarsTypes.CashSessionStatus).includes(req.query.status as bookcarsTypes.CashSessionStatus)) {
        res.status(400).send('Invalid cash session status filter')
        return
      }
      filter.status = req.query.status
    }
    if (typeof req.query.account === 'string' && req.query.account) {
      if (!Object.values(bookcarsTypes.CashAccountType).includes(req.query.account as bookcarsTypes.CashAccountType)) {
        res.status(400).send('Invalid cash account filter')
        return
      }
      filter.account = req.query.account
    }
    if (!parsed.pagination) {
      res.json(await CashSession.find(filter).sort({ openedAt: -1 }))
      return
    }
    const total = await CashSession.countDocuments(filter)
    const sessions = await CashSession.find(filter).sort({ openedAt: -1 }).skip(paginationSkip(parsed.pagination)).limit(parsed.pagination.size)
    res.json(pagedResponse(sessions, total, parsed.pagination))
} catch (err) {
 logger.error('[cash.listSessions]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const current = async (req: Request, res: Response) => {
  try {
    const account = String(req.query.account || bookcarsTypes.CashAccountType.Cash) as bookcarsTypes.CashAccountType
    const session = await CashSession.findOne({ ...getScope(req), account, status: bookcarsTypes.CashSessionStatus.Open }).sort({ openedAt: -1 })
    res.json(session || null)
  } catch (err) {
 logger.error('[cash.current]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const open = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const supplierId = effectiveSupplierId(req)
    if (!user || !supplierId) {
 res.status(403).send('Agency membership is required'); return 
}
    const account = req.body?.account || bookcarsTypes.CashAccountType.Cash
    if (!Object.values(bookcarsTypes.CashAccountType).includes(account)) {
      res.status(400).send('Invalid cash session'); return
    }
    // F6 / W3 C-1 — the opening balance chains from the previous counted
    // close of the same (supplier, account): cash can no longer appear
    // or vanish between sessions unnoticed. Omitted means "chain": the
    // previous countedClosingBalance (0 on a first session). An explicit
    // value that differs from the chained balance requires a recorded
    // opening difference reason (>= 3 chars); an explicit value equal to
    // the chain, or a first session, needs none. The chained value and
    // the reason (when given) are stored on the session for the audit
    // trail. A previous close in another currency never chains.
    const previous = await CashSession.findOne({ supplier: supplierId, account, status: bookcarsTypes.CashSessionStatus.Closed }).sort({ closedAt: -1 })
    const chained = previous && previous.currency === currency() && previous.countedClosingBalance !== undefined
      ? normalizeLedgerAmount(previous.countedClosingBalance, currency())
      : undefined
    const hasExplicitOpening = req.body?.openingBalance !== undefined && req.body?.openingBalance !== null && req.body?.openingBalance !== ''
    const openingBalance = hasExplicitOpening
      ? normalizeLedgerAmount(Number(req.body?.openingBalance), currency())
      : (chained ?? 0)
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      res.status(400).send('Invalid cash session'); return
    }
    const openingDifferenceReason = String(req.body?.openingDifferenceReason || '').trim()
    if (hasExplicitOpening && chained !== undefined && openingBalance !== chained && openingDifferenceReason.length < 3) {
      res.status(400).send('Opening balance differs from the previous counted close; an opening difference reason is required'); return
    }
    const existing = await CashSession.findOne({ supplier: supplierId, account, status: bookcarsTypes.CashSessionStatus.Open })
    if (existing) {
 res.status(409).send('An open cash session already exists'); return 
}
    const session = await CashSession.create({
      supplier: supplierId,
      account,
      currency: currency(),
      openedAt: new Date(),
      openedBy: user._id,
      openingBalance,
      previousClosingBalance: chained,
      openingDifferenceReason: openingDifferenceReason || undefined,
      status: bookcarsTypes.CashSessionStatus.Open,
    })
    res.status(201).json(session)
  } catch (err) {
 logger.error('[cash.open]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

// F6 / W3 C-1 — the chained opening for the open-session dialog: the
// previous closed session's counted balance for this (supplier,
// account), or null on a first session. ReadCash, like the session
// reads; the operator sees the chain before opening.
export const previousClose = async (req: Request, res: Response) => {
  try {
    const supplierId = effectiveSupplierId(req)
    if (!supplierId) {
      res.status(403).send('Agency membership is required'); return
    }
    const account = String(req.query.account || bookcarsTypes.CashAccountType.Cash) as bookcarsTypes.CashAccountType
    if (!Object.values(bookcarsTypes.CashAccountType).includes(account)) {
      res.status(400).send('Invalid cash account'); return
    }
    const previous = await CashSession.findOne({ supplier: supplierId, account, status: bookcarsTypes.CashSessionStatus.Closed }).sort({ closedAt: -1 })
    if (!previous || previous.currency !== currency() || previous.countedClosingBalance === undefined) {
      res.json(null); return
    }
    res.json({
      sessionId: previous._id,
      closedAt: previous.closedAt,
      countedClosingBalance: normalizeLedgerAmount(previous.countedClosingBalance, currency()),
      currency: previous.currency,
    })
  } catch (err) {
    logger.error('[cash.previousClose]', err); res.status(400).send(i18n.t('ERROR'))
  }
}

export const listMovements = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.sessionId)) {
 res.status(400).send('Invalid session'); return 
}
    const session = await CashSession.findOne({ _id: req.params.sessionId, ...getScope(req) })
    if (!session) {
 res.sendStatus(404); return 
}
    // GH-07 — a platform admin read this session's movements without a
    // selector; audit with the session's agency.
    await logAdminResourceAccess(req, session.supplier?.toString(), 'cash:list-movements')
    // F6 / W3 X-1 — server-side pagination + direction / source /
    // status filters. No page/size params keeps the legacy full-array
    // response.
    const parsed = parsePagination(req)
    if ('error' in parsed) {
      res.status(400).send(parsed.error)
      return
    }
    const filter: Record<string, unknown> = { session: session._id, ...getScope(req) }
    if (typeof req.query.direction === 'string' && req.query.direction) {
      if (!Object.values(bookcarsTypes.CashMovementDirection).includes(req.query.direction as bookcarsTypes.CashMovementDirection)) {
        res.status(400).send('Invalid cash movement direction filter')
        return
      }
      filter.direction = req.query.direction
    }
    if (typeof req.query.source === 'string' && req.query.source) {
      if (!Object.values(bookcarsTypes.CashMovementSource).includes(req.query.source as bookcarsTypes.CashMovementSource)) {
        res.status(400).send('Invalid cash movement source filter')
        return
      }
      filter.source = req.query.source
    }
    if (typeof req.query.status === 'string' && req.query.status) {
      if (!['pending', 'confirmed'].includes(req.query.status)) {
        res.status(400).send('Invalid cash movement status filter')
        return
      }
      filter.status = req.query.status
    }
    if (!parsed.pagination) {
      res.json(await CashMovement.find(filter).sort({ date: -1, createdAt: -1 }))
      return
    }
    const total = await CashMovement.countDocuments(filter)
    const movements = await CashMovement.find(filter).sort({ date: -1, createdAt: -1 }).skip(paginationSkip(parsed.pagination)).limit(parsed.pagination.size)
    res.json(pagedResponse(movements, total, parsed.pagination))
  } catch (err) {
 logger.error('[cash.listMovements]', err); res.status(400).send(i18n.t('ERROR')) 
}
}


const cashLocks = new Map<string, Promise<void>>()

const withCashLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const previous = cashLocks.get(key) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
 release = resolve 
})
  const queued = previous.then(() => current)
  cashLocks.set(key, queued)
  await previous
  try {
 return await fn() 
} finally {
    release()
    if (cashLocks.get(key) === queued) {
cashLocks.delete(key)
}
  }
}

const supportsTransactions = () => {
  const client = mongoose.connection.getClient() as any
  const topologyType = client?.topology?.description?.type
  return !!topologyType && topologyType !== 'Single' && topologyType !== 'Unknown'
}

// Only confirmed movements count toward balances: counter-agent entries
// stay pending until confirmed (owner decision 1.5, GA-P10-DECISIONS-01);
// movements written before the status field existed count as confirmed.
const confirmedMovementMatch = { $or: [{ status: 'confirmed' }, { status: { $exists: false } }] }

const sessionBalance = async (sessionId: mongoose.Types.ObjectId, session?: mongoose.ClientSession) => {
  const aggregate = CashMovement.aggregate([
    { $match: { session: sessionId, ...confirmedMovementMatch } },
    { $group: { _id: null, balance: { $sum: { $cond: [
      { $eq: ['$direction', bookcarsTypes.CashMovementDirection.In] }, '$amount', { $multiply: ['$amount', -1] },
    ] } } } },
  ])
  if (session) {
aggregate.session(session)
}
  const rows = await aggregate
  return Number(rows[0]?.balance || 0)
}

const transferWithinSession = async (input: {
  supplierId: mongoose.Types.ObjectId
  fromSessionId: mongoose.Types.ObjectId
  toSessionId: mongoose.Types.ObjectId
  amount: number
  date: Date
  idempotencyKey: string
  reference?: string
  note?: string
  actorId: mongoose.Types.ObjectId
}, dbSession?: mongoose.ClientSession) => {
  const existingQuery = CashMovement.findOne({ idempotencyKey: input.idempotencyKey })
  if (dbSession) {
existingQuery.session(dbSession)
}
  const existing = await existingQuery
  if (existing) {
    if (existing.supplier.toString() !== input.supplierId.toString()
      || existing.session.toString() !== input.fromSessionId.toString()
      || existing.direction !== bookcarsTypes.CashMovementDirection.Out
      || !existing.transferId) {
throw new Error('Cash transfer idempotency key is already used')
}
    const destinationQuery = CashMovement.findById(existing.transferId)
    if (dbSession) {
destinationQuery.session(dbSession)
}
    const destination = await destinationQuery
    if (!destination || destination.session.toString() !== input.toSessionId.toString()
      || destination.amount !== input.amount) {
throw new Error('Cash transfer idempotency key does not match')
}
    return { from: existing, to: destination }
  }

  const sessionsQuery = CashSession.find({
    _id: { $in: [input.fromSessionId, input.toSessionId] },
    supplier: input.supplierId,
    status: bookcarsTypes.CashSessionStatus.Open,
  })
  if (dbSession) {
sessionsQuery.session(dbSession)
}
  const sessions = await sessionsQuery
  const from = sessions.find((item) => item._id.equals(input.fromSessionId))
  const to = sessions.find((item) => item._id.equals(input.toSessionId))
  if (!from || !to) {
throw new Error('Cash session not found')
}
  if (from._id.equals(to._id) || from.currency !== to.currency) {
throw new Error('Open cash sessions must share an agency and currency')
}

  const currentBalance = from.openingBalance + await sessionBalance(from._id, dbSession)
  if (input.amount > currentBalance + 0.000001) {
throw new Error('Transfer exceeds the source account balance')
}

  const source = new CashMovement({
    supplier: input.supplierId, session: from._id, account: from.account, currency: from.currency,
    date: input.date, direction: bookcarsTypes.CashMovementDirection.Out,
    amount: input.amount, source: bookcarsTypes.CashMovementSource.Transfer,
    idempotencyKey: input.idempotencyKey, reference: input.reference, note: input.note,
    actor: input.actorId,
  })
  const destination = new CashMovement({
    supplier: input.supplierId, session: to._id, account: to.account, currency: to.currency,
    date: input.date, direction: bookcarsTypes.CashMovementDirection.In,
    amount: input.amount, source: bookcarsTypes.CashMovementSource.Transfer,
    reference: input.reference, note: input.note, actor: input.actorId,
  })
  source.transferId = destination._id
  destination.transferId = source._id
  if (dbSession) {
    await source.save({ session: dbSession })
    await destination.save({ session: dbSession })
  } else {
    await source.save()
    try {
 await destination.save() 
} catch (error) {
 await CashMovement.deleteOne({ _id: source._id }); throw error 
}
  }
  return { from: source, to: destination }
}

export const transfer = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const supplierId = effectiveSupplierId(req)
    const fromSessionId = req.body?.fromSession
    const toSessionId = req.body?.toSession
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : ''
    const amount = normalizeLedgerAmount(Number(req.body?.amount), currency())
    const date = new Date(req.body?.date || new Date())
    const reference = String(req.body?.reference || '').trim()
    const note = String(req.body?.note || '').trim()
    if (!user || !supplierId || !mongoose.isValidObjectId(fromSessionId) || !mongoose.isValidObjectId(toSessionId)
      || fromSessionId === toSessionId || idempotencyKey.length < 8 || idempotencyKey.length > 200
      || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(date.getTime())
      || reference.length > 160 || note.length > 1000) {
      res.status(400).send('Invalid cash transfer'); return
    }
    const lockKey = `${supplierId}:${fromSessionId}:${toSessionId}`
    const result = await withCashLock(lockKey, async () => {
      const input = {
        supplierId: new mongoose.Types.ObjectId(supplierId),
        fromSessionId: new mongoose.Types.ObjectId(fromSessionId),
        toSessionId: new mongoose.Types.ObjectId(toSessionId), amount, date, idempotencyKey,
        reference: reference || undefined, note: note || undefined,
        actorId: new mongoose.Types.ObjectId(user._id),
      }
      if (supportsTransactions()) {
return mongoose.connection.transaction((dbSession) => transferWithinSession(input, dbSession))
}
      return transferWithinSession(input)
    })
    res.status(201).json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cash transfer failed'
    const notFound = message.includes('Cash session not found')
    const conflict = message.includes('idempotency') || message.includes('exceeds') || message.includes('Open cash')
    logger.error('[cash.transfer]', err)
    res.status(notFound ? 404 : conflict ? 409 : 400).send(message)
  }
}

export const createMovement = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const supplierId = effectiveSupplierId(req)
    if (!user || !supplierId || !mongoose.isValidObjectId(req.params.sessionId)) {
 res.status(400).send('Invalid cash movement'); return 
}
    const session = await CashSession.findOne({ _id: req.params.sessionId, supplier: supplierId, status: bookcarsTypes.CashSessionStatus.Open })
    if (!session) {
 res.status(404).send('Open cash session not found'); return 
}
    const date = new Date(req.body?.date)
    const amount = normalizeLedgerAmount(Number(req.body?.amount), session.currency)
    const direction = req.body?.direction
    const source = req.body?.source || bookcarsTypes.CashMovementSource.Manual
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : undefined
    const reference = String(req.body?.reference || '').trim()
    const note = String(req.body?.note || '').trim()
    if (Number.isNaN(date.getTime()) || !Number.isFinite(amount) || amount <= 0
      || !Object.values(bookcarsTypes.CashMovementDirection).includes(direction)
      || !Object.values(bookcarsTypes.CashMovementSource).includes(source)
      || reference.length > 160 || note.length > 1000
      // F6 / W3 C-2 — a movement is dated inside the session it belongs
      // to: never before the session opened.
      || date.getTime() < new Date(session.openedAt).getTime()) {
      res.status(400).send('Invalid cash movement'); return
    }
    if (idempotencyKey) {
      const existing = await CashMovement.findOne({ idempotencyKey, supplier: supplierId, session: session._id })
      if (existing) {
 res.status(200).json(existing); return 
}
    }
    // Owner decision 1.5: counter-agent entries are recorded pending and
    // do not count toward the session balance until confirmed.
    const pendingEntry = req.agency?.role === bookcarsTypes.AgencyRole.CounterAgent
    // F6 / W3 C-2 — a manual Out must never drive the expected balance
    // negative: close() cannot store a negative expected balance (schema
    // min 0), so an unchecked Out bricks the session — closable only by
    // inventing cash. The check runs under the per-session lock, against
    // the same confirmed-only balance close() and transfer() use, and
    // names the balance in the refusal. Pending counter-agent entries do
    // not count yet, so their check happens at confirmation time instead
    // (see confirmMovement); linked ledger movements are created by the
    // ledger itself and record money that already moved (see
    // utils/ledger.ts linkLedgerCashPayment).
    const movement = await withCashLock(session._id.toString(), async () => {
      if (!pendingEntry && direction === bookcarsTypes.CashMovementDirection.Out) {
        const expectedBalance = normalizeLedgerAmount(session.openingBalance + await sessionBalance(session._id), session.currency)
        if (amount > expectedBalance + 0.000001) {
          throw new Error(`Cash movement exceeds the session balance (expected balance ${expectedBalance.toFixed(2)} ${session.currency})`)
        }
      }
      return CashMovement.create({
        supplier: supplierId,
        session: session._id,
        account: session.account,
        currency: session.currency,
        date,
        direction,
        amount,
        source,
        status: pendingEntry ? 'pending' : 'confirmed',
        idempotencyKey,
        reference,
        note,
        actor: user._id,
      })
    })
    res.status(201).json(movement)
  } catch (err) {
    // F6 / W3 C-2 — the balance refusal is a conflict with a named
    // balance, not a generic validation error.
    if (err instanceof Error && err.message.startsWith('Cash movement exceeds the session balance')) {
      res.status(409).send(err.message)
      return
    }
 logger.error('[cash.createMovement]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const confirmMovement = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const supplierId = effectiveSupplierId(req)
    if (!user || !supplierId || !mongoose.isValidObjectId(req.params.sessionId) || !mongoose.isValidObjectId(req.params.movementId)) {
 res.status(400).send('Invalid cash movement confirmation'); return 
}
    const movement = await CashMovement.findOne({ _id: req.params.movementId, session: req.params.sessionId, supplier: supplierId })
    if (!movement) {
 res.sendStatus(404); return 
}
    if (movement.status !== 'pending') {
 res.status(409).send('Only a pending cash entry can be confirmed'); return 
}
    // F6 / W3 C-2 — a pending Out never counted toward the balance when
    // recorded, so confirmation is where its balance check belongs: a
    // confirmation that would drive the expected balance negative stays
    // pending, and the session can still be closed with the entry
    // explicitly carried (see the pending-carry rules in close(), C-4).
    // The check runs under the per-session lock, against the same
    // confirmed-only balance as createMovement.
    const confirmed = await withCashLock(req.params.sessionId, async () => {
      const fresh = await CashMovement.findOne({ _id: movement._id, session: req.params.sessionId, supplier: supplierId })
      if (!fresh || fresh.status !== 'pending') {
        throw new Error('Only a pending cash entry can be confirmed')
      }
      if (fresh.direction === bookcarsTypes.CashMovementDirection.Out) {
        const session = await CashSession.findOne({ _id: req.params.sessionId, supplier: supplierId })
        if (!session) {
          throw new Error('Cash session not found')
        }
        const expectedBalance = normalizeLedgerAmount(session.openingBalance + await sessionBalance(session._id), session.currency)
        if (fresh.amount > expectedBalance + 0.000001) {
          throw new Error(`Cash movement exceeds the session balance (expected balance ${expectedBalance.toFixed(2)} ${session.currency})`)
        }
      }
      fresh.status = 'confirmed'
      fresh.confirmedBy = new mongoose.Types.ObjectId(user._id)
      fresh.confirmedAt = new Date()
      await fresh.save()
      // F6 / W3 C-4 (b) — a pending entry confirmed AFTER its session
      // closed used to desync the stored figures from the Z-report
      // (which recomputes from movements). Restamp the closed session's
      // expected/discrepancy from the now-confirmed movements; the
      // counted balance stands as counted. The pending-carry figures
      // recorded at close stay as the close-time snapshot.
      const closedSession = await CashSession.findOne({ _id: req.params.sessionId, supplier: supplierId, status: bookcarsTypes.CashSessionStatus.Closed })
      if (closedSession) {
        const all = await CashMovement.find({ session: closedSession._id }).lean()
        const expected = normalizeLedgerAmount(all.filter((movement) => !movement.status || movement.status === 'confirmed').reduce((sum, movement) => {
          const value = movement.amount
          return movement.direction === bookcarsTypes.CashMovementDirection.In ? sum + value : sum - value
        }, closedSession.openingBalance), closedSession.currency)
        closedSession.expectedClosingBalance = expected
        closedSession.discrepancy = normalizeLedgerAmount((closedSession.countedClosingBalance ?? 0) - expected, closedSession.currency)
        await closedSession.save()
      }
      return fresh
    })
    res.json(confirmed)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Cash movement exceeds the session balance')) {
      res.status(409).send(err.message)
      return
    }
    if (err instanceof Error && err.message === 'Only a pending cash entry can be confirmed') {
      res.status(409).send(err.message)
      return
    }
    if (err instanceof Error && err.message === 'Cash session not found') {
      res.status(404).send(err.message)
      return
    }
 logger.error('[cash.confirmMovement]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

export const close = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const supplierId = effectiveSupplierId(req)
    if (!user || !supplierId || !mongoose.isValidObjectId(req.params.sessionId)) {
 res.status(400).send('Invalid cash session'); return 
}
    const session = await CashSession.findOne({ _id: req.params.sessionId, supplier: supplierId, status: bookcarsTypes.CashSessionStatus.Open })
    if (!session) {
 res.status(404).send('Open cash session not found'); return 
}
    const counted = normalizeLedgerAmount(Number(req.body?.countedClosingBalance), session.currency)
    if (!Number.isFinite(counted) || counted < 0) {
 res.status(400).send('Invalid counted balance'); return 
}
    // F6 / W3 C-4 — the close runs under the per-session lock so no
    // movement can land between the balance read and the save.
    const closed = await withCashLock(session._id.toString(), async () => {
      const movements = await CashMovement.find({ session: session._id }).lean()
      const pending = movements.filter((movement) => movement.status === 'pending')
      // Wave 2.6 — the close uses the SAME bucket helper as the journal,
      // so the expected balance can never diverge between the two again.
      const buckets = computeSessionBalance(session.openingBalance, session.currency, movements)
      const expected = buckets.expectedBalance
      const discrepancy = normalizeLedgerAmount(counted - expected, session.currency)
      // (a) Pending entries are surfaced, never silently ignored: the
      // close is refused (409, with the pending figures named) until
      // every pending entry is resolved — or the operator explicitly
      // carries them with a recorded reason. Carried entries stay
      // pending on the closed session and can still be confirmed
      // afterwards; confirming one restamps the stored figures (see
      // confirmMovement), so the Z-report never desyncs from them.
      const pendingIn = buckets.pendingIn
      const pendingOut = buckets.pendingOut
      const acknowledgePending = req.body?.acknowledgePending === true
      const pendingCarryReason = String(req.body?.pendingCarryReason || '').trim()
      if (pending.length > 0 && (!acknowledgePending || pendingCarryReason.length < 3)) {
        throw new Error(`Cannot close: ${pending.length} pending entries (in ${pendingIn.toFixed(2)}, out ${pendingOut.toFixed(2)} ${session.currency}) must be resolved or explicitly carried with a reason`)
      }
      // (c) Discrepancy approval — tolerance is ZERO by design (the
      // task fixes it; no amount is invented): any nonzero discrepancy
      // needs an explicit approval + reason, recorded on the session
      // with the approver and time. The close() schema validation
      // itself (expectedClosingBalance min 0) is untouched.
      const discrepancyApproved = req.body?.discrepancyApproved === true
      const discrepancyReason = String(req.body?.discrepancyReason || '').trim()
      if (discrepancy !== 0 && (!discrepancyApproved || discrepancyReason.length < 3)) {
        throw new Error(`Closing discrepancy of ${discrepancy.toFixed(2)} ${session.currency} requires approval with a reason`)
      }
      session.status = bookcarsTypes.CashSessionStatus.Closed
      session.closedAt = new Date()
      session.closedBy = new mongoose.Types.ObjectId(user._id)
      session.expectedClosingBalance = expected
      session.countedClosingBalance = counted
      session.discrepancy = discrepancy
      session.closingNote = String(req.body?.closingNote || '').trim()
      if (pending.length > 0) {
        session.pendingCarriedCount = pending.length
        session.pendingCarriedIn = pendingIn
        session.pendingCarriedOut = pendingOut
        session.pendingCarryReason = pendingCarryReason
      }
      if (discrepancy !== 0) {
        session.discrepancyReason = discrepancyReason
        session.discrepancyApprovedBy = new mongoose.Types.ObjectId(user._id)
        session.discrepancyApprovedAt = new Date()
      }
      await session.save()
      return session
    })
    res.json(closed)
  } catch (err) {
    // The 409s above carry the actionable message; everything else is
    // the generic error, as before.
    if (err instanceof Error && (err.message.startsWith('Cannot close:') || err.message.startsWith('Closing discrepancy'))) {
      res.status(409).send(err.message)
      return
    }
 logger.error('[cash.close]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

// ---------------------------------------------------------------------
// F6 / W3 C-5 — server-side cash journal (one scope, one set of
// figures). The old page merged three sources client-side — movements
// of the selected session only, plus ALL agency payments and ALL
// expenses (any date, any session/account) — then summed the merged
// list with payment direction hardcoded to 'in' and no status filter,
// so Reversed/Pending/Deposit payments counted as income and unpaid
// expenses as outflows, and the totals could not reconcile to any
// session. The journal is now the selected session's drawer, computed
// server-side from that session's movements under one scope:
//   - income: confirmed In movements whose purpose is not Deposit
//     (linked rent collections + manual ins);
//   - expenses: confirmed Out movements whose purpose is not Deposit
//     (manual outs + linked cash refunds/debits);
//   - deposits: confirmed In movements with purpose Deposit — drawer
//     cash held as a liability, NEVER income (the ledger's own
//     treatment: deposits are never revenue and never netted);
//   - depositRefunds (Wave 2.6, M8): confirmed Out movements with
//     purpose Deposit — a deposit handed back. Before this bucket the
//     journal ignored them while close() subtracted them, so the two
//     expected balances disagreed by exactly the refunded amount;
//   - pendingIn/pendingOut: pending entries, listed separately and
//     never counted (owner decision 1.5);
//   - net = income − expenses; expectedBalance = opening + income +
//     deposits − expenses − depositRefunds, under the same
//     confirmed-only rule close() uses, so the journal reconciles to
//     the session and to the Z-report. The buckets come from the one
//     shared helper below (computeSessionBalance), used by the journal
//     AND by close(), so the formula cannot fork again.
// Maintenance expenses are NOT journal rows: an expense has no session
// attribution (its paidAmount is self-declared and unbacked, W3 M-2),
// so attributing it to a drawer would invent the link the Z-report
// honestly refuses to invent. Expenses stay on Maintenance + Reports.
// Linked ledger payments reach the journal as movements (C-7): a
// cash-method posting creates a linked movement in the open session,
// so the drawer and the ledger agree by construction. A posted cash
// payment with no movement (no open session at posting time, or posted
// before the linkage existed) is listed under `unlinkedCashPayments`
// with its total, so the two books' difference stays visible.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Wave 2.6 — ONE expected-balance formula for the journal and close().
// Buckets are computed from the session's movements under one rule
// (confirmed only; deposits are a liability, never income):
//   income: In, purpose != Deposit
//   expenses: Out, purpose != Deposit
//   deposits: In, purpose == Deposit
//   depositRefunds: Out, purpose == Deposit (M8)
//   expectedBalance = opening + income + deposits - expenses
//     - depositRefunds
// which is exactly opening + Σ confirmed (In +, Out −): the same
// number close() used to compute by direction, so the two agree by
// construction. `net` stays income − expenses (deposits are not
// revenue, refunds are not expenses).
// ---------------------------------------------------------------------

type SessionMovementRow = {
  amount?: number | null
  direction: bookcarsTypes.CashMovementDirection
  status?: string | null
  purpose?: bookcarsTypes.RentalPaymentPurpose | string | null
}

export interface SessionBalanceBuckets {
  income: number
  expenses: number
  deposits: number
  depositRefunds: number
  pendingIn: number
  pendingOut: number
  net: number
  expectedBalance: number
}

export const computeSessionBalance = (
  openingBalance: number,
  currency: string,
  movements: SessionMovementRow[],
): SessionBalanceBuckets => {
  const isConfirmed = (movement: SessionMovementRow) => !movement.status || movement.status === 'confirmed'
  const isDeposit = (movement: SessionMovementRow) => movement.purpose === bookcarsTypes.RentalPaymentPurpose.Deposit
  const sum = (rows: SessionMovementRow[]) => normalizeLedgerAmount(rows.reduce((total, row) => total + Number(row.amount || 0), 0), currency)
  const confirmed = movements.filter(isConfirmed)
  const pending = movements.filter((movement) => movement.status === 'pending')
  const income = sum(confirmed.filter((movement) => movement.direction === bookcarsTypes.CashMovementDirection.In && !isDeposit(movement)))
  const expenses = sum(confirmed.filter((movement) => movement.direction === bookcarsTypes.CashMovementDirection.Out && !isDeposit(movement)))
  const deposits = sum(confirmed.filter((movement) => movement.direction === bookcarsTypes.CashMovementDirection.In && isDeposit(movement)))
  const depositRefunds = sum(confirmed.filter((movement) => movement.direction === bookcarsTypes.CashMovementDirection.Out && isDeposit(movement)))
  const pendingIn = sum(pending.filter((movement) => movement.direction === bookcarsTypes.CashMovementDirection.In))
  const pendingOut = sum(pending.filter((movement) => movement.direction === bookcarsTypes.CashMovementDirection.Out))
  return {
    income,
    expenses,
    deposits,
    depositRefunds,
    pendingIn,
    pendingOut,
    net: normalizeLedgerAmount(income - expenses, currency),
    expectedBalance: normalizeLedgerAmount(openingBalance + income + deposits - expenses - depositRefunds, currency),
  }
}

const JOURNAL_UNLINKED_CAP = 100

const buildJournal = async (req: Request) => {
  const sessionId = req.query.sessionId
  if (typeof sessionId !== 'string' || !mongoose.isValidObjectId(sessionId)) {
    throw new Error('Invalid cash session')
  }
  const session = await CashSession.findOne({ _id: sessionId, ...getScope(req) })
  if (!session) {
    throw new Error('Cash session not found')
  }
  const from = typeof req.query.from === 'string' && req.query.from ? new Date(req.query.from) : null
  const to = typeof req.query.to === 'string' && req.query.to ? new Date(req.query.to) : null
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    throw new Error('Invalid journal date filter')
  }
  const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim().toLocaleLowerCase() : ''
  const movementFilter: Record<string, unknown> = { session: session._id }
  if (from || to) {
    movementFilter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
  }
  const movements = await CashMovement.find(movementFilter)
    .sort({ date: -1, createdAt: -1 })
    .populate({ path: 'rentalPayment', select: 'booking purpose direction status', populate: { path: 'booking', select: 'reference' } })
    .lean()
  const filtered = keyword
    ? movements.filter((movement) => `${movement.reference || ''} ${movement.note || ''} ${movement.source || ''}`.toLocaleLowerCase().includes(keyword))
    : movements
  // Wave 2.6 — the journal's buckets come from the shared helper, the
  // same one close() uses (M8: deposit refunds now count).
  const buckets = computeSessionBalance(session.openingBalance, session.currency, filtered)
  const totals: bookcarsTypes.CashJournalTotals = {
    openingBalance: normalizeLedgerAmount(session.openingBalance, session.currency),
    income: buckets.income,
    expenses: buckets.expenses,
    deposits: buckets.deposits,
    depositRefunds: buckets.depositRefunds,
    net: buckets.net,
    pendingIn: buckets.pendingIn,
    pendingOut: buckets.pendingOut,
    expectedBalance: buckets.expectedBalance,
    currency: session.currency,
  }
  // C-7 reconciliation: posted cash payments of this agency with no
  // drawer movement (no open session when posted, or pre-linkage).
  // Pending payments are not money yet and never listed here.
  const unlinkedFilter: Record<string, unknown> = {
    supplier: session.supplier,
    method: bookcarsTypes.RentalPaymentMethod.Cash,
    status: bookcarsTypes.RentalPaymentStatus.Posted,
    $or: [{ cashSession: { $exists: false } }, { cashSession: null }],
  }
  if (from || to) {
    unlinkedFilter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
  }
  const [unlinkedRows, unlinkedTotalRows] = await Promise.all([
    RentalPayment.find(unlinkedFilter).sort({ date: -1 }).limit(JOURNAL_UNLINKED_CAP)
      .populate({ path: 'booking', select: 'reference' }).lean(),
    RentalPayment.aggregate([
      { $match: unlinkedFilter },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ])
  const unlinkedCashPayments: bookcarsTypes.UnlinkedCashPaymentRow[] = unlinkedRows.map((payment) => ({
    id: payment._id.toString(),
    date: payment.date,
    bookingReference: (payment.booking && typeof payment.booking === 'object' ? (payment.booking as { reference?: string }).reference : undefined) || '',
    purpose: payment.purpose || bookcarsTypes.RentalPaymentPurpose.Rent,
    direction: payment.direction || bookcarsTypes.RentalPaymentDirection.Credit,
    status: payment.status || bookcarsTypes.RentalPaymentStatus.Posted,
    amount: Number(payment.amount || 0),
    currency: payment.currency || session.currency,
  }))
  return {
    session,
    movements: filtered,
    totals,
    unlinkedCashPayments,
    unlinkedCashTotal: normalizeLedgerAmount(Number(unlinkedTotalRows[0]?.total || 0), session.currency),
  }
}

const journalRowOf = (movement: Awaited<ReturnType<typeof buildJournal>>['movements'][number]): bookcarsTypes.CashJournalRow => {
  const linked = movement.rentalPayment && typeof movement.rentalPayment === 'object' ? movement.rentalPayment as { _id?: unknown, booking?: unknown } : null
  const booking = linked?.booking && typeof linked.booking === 'object' ? linked.booking as { reference?: string, _id?: unknown } : null
  return {
    id: movement._id.toString(),
    date: movement.date,
    direction: movement.direction,
    source: movement.source,
    status: (movement.status || 'confirmed') as 'pending' | 'confirmed',
    purpose: movement.purpose,
    reference: movement.reference,
    note: movement.note,
    amount: Number(movement.amount || 0),
    rentalPayment: linked?._id ? String(linked._id) : undefined,
    bookingReference: booking?.reference || (booking?._id ? String(booking._id).slice(-8).toUpperCase() : undefined),
  }
}

export const journal = async (req: Request, res: Response) => {
  try {
    const parsed = parsePagination(req)
    if ('error' in parsed) {
      res.status(400).send(parsed.error)
      return
    }
    const built = await buildJournal(req)
    const rows = built.movements.map(journalRowOf)
    if (!parsed.pagination) {
      res.json({
        session: built.session as unknown as bookcarsTypes.CashSession,
        rows,
        totals: built.totals,
        unlinkedCashPayments: built.unlinkedCashPayments,
        unlinkedCashTotal: built.unlinkedCashTotal,
        total: rows.length,
        page: 1,
        size: rows.length,
      } satisfies bookcarsTypes.CashJournalResponse)
      return
    }
    const start = paginationSkip(parsed.pagination)
    const page = pagedResponse(rows.slice(start, start + parsed.pagination.size), rows.length, parsed.pagination)
    res.json({
      session: built.session as unknown as bookcarsTypes.CashSession,
      rows: page.rows,
      totals: built.totals,
      unlinkedCashPayments: built.unlinkedCashPayments,
      unlinkedCashTotal: built.unlinkedCashTotal,
      total: page.total,
      page: page.page,
      size: page.size,
    } satisfies bookcarsTypes.CashJournalResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cash journal failed'
    if (message === 'Cash session not found') {
      res.status(404).send(message)
      return
    }
    logger.error('[cash.journal]', err)
    res.status(400).send(message === 'Invalid cash session' || message === 'Invalid journal date filter' ? message : i18n.t('ERROR'))
  }
}

const escapeCsv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

export const journalCsv = async (req: Request, res: Response) => {
  try {
    const built = await buildJournal(req)
    const header = 'date,direction,source,status,purpose,reference,note,amount,currency,linkedPayment,bookingReference'
    const lines = built.movements.map(journalRowOf).map((row) => [
      row.date ? new Date(row.date).toISOString() : '',
      row.direction,
      row.source,
      row.status,
      row.purpose || '',
      row.reference || '',
      row.note || '',
      Number(row.amount || 0).toFixed(2),
      built.totals.currency,
      row.rentalPayment || '',
      row.bookingReference || '',
    ].map(escapeCsv).join(','))
    const t = built.totals
    const summary = [
      '',
      ['summary', 'openingBalance', t.openingBalance.toFixed(2), t.currency].map(escapeCsv).join(','),
      ['summary', 'income', t.income.toFixed(2), t.currency].map(escapeCsv).join(','),
      ['summary', 'expenses', t.expenses.toFixed(2), t.currency].map(escapeCsv).join(','),
      ['summary', 'deposits', t.deposits.toFixed(2), t.currency].map(escapeCsv).join(','),
      ['summary', 'depositRefunds', t.depositRefunds.toFixed(2), t.currency].map(escapeCsv).join(','),
      ['summary', 'net', t.net.toFixed(2), t.currency].map(escapeCsv).join(','),
      ['summary', 'pendingIn', t.pendingIn.toFixed(2), t.currency].map(escapeCsv).join(','),
      ['summary', 'pendingOut', t.pendingOut.toFixed(2), t.currency].map(escapeCsv).join(','),
      ['summary', 'expectedBalance', t.expectedBalance.toFixed(2), t.currency].map(escapeCsv).join(','),
      ['summary', 'unlinkedCashTotal', built.unlinkedCashTotal.toFixed(2), t.currency].map(escapeCsv).join(','),
    ]
    res.type('text/csv')
      .set('Content-Disposition', `attachment; filename="gestion-auto-cash-journal-${built.session._id}.csv"`)
      .send([header, ...lines, ...summary].join('\r\n') + '\r\n')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cash journal export failed'
    if (message === 'Cash session not found') {
      res.status(404).send(message)
      return
    }
    logger.error('[cash.journalCsv]', err)
    res.status(400).send(message === 'Invalid cash session' || message === 'Invalid journal date filter' ? message : i18n.t('ERROR'))
  }
}


// ---------------------------------------------------------------------
// GA-PAR-24 — per-session closing (Z) report. On-demand pdf-lib PDF in
// the PAR-03 / PAR-17 tradition: no file stored, no collection written.
// Read-only: the handler writes nothing, so generating the report can
// never change the session it describes.
// Gated ManageCash — exactly like the session-close action. A session
// of another agency answers 404 (established pattern); an open
// (unclosed) session is refused 409 with a clear message.
// Figures: expected / counted / discrepancy are printed exactly as
// stored on the session. Movement totals use the same confirmed-only
// rule close() uses; pending movements are listed separately and never
// counted. Deposits have no stored session balance (see the renderer),
// so no deposit figure is invented.
// ---------------------------------------------------------------------

export const zReport = async (req: Request, res: Response) => {
  try {
    const user = req.user
    const supplierId = effectiveSupplierId(req)
    if (!user || !supplierId || !mongoose.isValidObjectId(req.params.sessionId)) {
      res.status(400).send('Invalid cash session'); return
    }
    const session = await CashSession.findOne({ _id: req.params.sessionId, supplier: supplierId })
    if (!session) {
      res.sendStatus(404); return
    }
    if (session.status !== bookcarsTypes.CashSessionStatus.Closed) {
      res.status(409).send('Cash session is not closed'); return
    }
    const movements = await CashMovement.find({ session: session._id }).sort({ date: 1, createdAt: 1 }).lean()
    const supplierDoc = await User.findById(supplierId).select('fullName email phone ice registreCommerce identifiantFiscal patente rib fiscalAddress city').lean()
    const personIds = [session.openedBy, session.closedBy].filter((id): id is mongoose.Types.ObjectId => !!id)
    const people = await User.find({ _id: { $in: personIds } }).select('fullName').lean()
    const nameOf = (id: unknown) => {
      const row = people.find((person) => person._id.toString() === String(id || ''))
      return row?.fullName || ''
    }
    const confirmed = movements.filter((movement) => !movement.status || movement.status === 'confirmed')
    const pending = movements.filter((movement) => movement.status === 'pending')
    const sum = (rows: typeof movements, direction: bookcarsTypes.CashMovementDirection) => normalizeLedgerAmount(
      rows.filter((movement) => movement.direction === direction).reduce((total, movement) => total + Number(movement.amount || 0), 0),
      session.currency,
    )
    const pdf = await renderCashSessionPdf({
      supplier: supplierDoc as never,
      sessionShortId: session._id.toString().slice(-8).toUpperCase(),
      account: session.account,
      currency: session.currency,
      openedAt: session.openedAt,
      openedByName: nameOf(session.openedBy),
      openingBalance: session.openingBalance,
      status: session.status,
      closedAt: session.closedAt,
      closedByName: nameOf(session.closedBy),
      expectedClosingBalance: session.expectedClosingBalance ?? 0,
      countedClosingBalance: session.countedClosingBalance ?? 0,
      discrepancy: session.discrepancy ?? 0,
      closingNote: session.closingNote,
      confirmedIn: sum(confirmed, bookcarsTypes.CashMovementDirection.In),
      confirmedInCount: confirmed.filter((movement) => movement.direction === bookcarsTypes.CashMovementDirection.In).length,
      confirmedOut: sum(confirmed, bookcarsTypes.CashMovementDirection.Out),
      confirmedOutCount: confirmed.filter((movement) => movement.direction === bookcarsTypes.CashMovementDirection.Out).length,
      pendingIn: sum(pending, bookcarsTypes.CashMovementDirection.In),
      pendingOut: sum(pending, bookcarsTypes.CashMovementDirection.Out),
      pendingCount: pending.length,
      movements: movements.map((movement) => ({
        date: movement.date,
        direction: movement.direction,
        source: movement.source,
        status: movement.status || 'confirmed',
        reference: movement.reference,
        note: movement.note,
        amount: Number(movement.amount || 0),
      })),
      generatedAt: new Date(),
    })
    res.type('application/pdf')
      .set('Content-Disposition', `attachment; filename="gestion-auto-z-report-${session._id}.pdf"`)
      .send(pdf)
  } catch (err) {
    logger.error('[cash.zReport]', err); res.status(400).send(i18n.t('ERROR'))
  }
}
