import { Request, Response } from 'express'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import CashSession from '../models/CashSession'
import CashMovement from '../models/CashMovement'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'
import { normalizeLedgerAmount } from '../utils/ledger'
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
 res.json(await CashSession.find(getScope(req)).sort({ openedAt: -1 })) 
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
    const openingBalance = normalizeLedgerAmount(Number(req.body?.openingBalance), currency())
    if (!Object.values(bookcarsTypes.CashAccountType).includes(account) || !Number.isFinite(openingBalance) || openingBalance < 0) {
      res.status(400).send('Invalid cash session'); return
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
      status: bookcarsTypes.CashSessionStatus.Open,
    })
    res.status(201).json(session)
  } catch (err) {
 logger.error('[cash.open]', err); res.status(400).send(i18n.t('ERROR')) 
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
    const movements = await CashMovement.find({ session: session._id, ...getScope(req) }).sort({ date: -1, createdAt: -1 })
    res.json(movements)
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
      || reference.length > 160 || note.length > 1000) {
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
    const movement = await CashMovement.create({
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
    res.status(201).json(movement)
  } catch (err) {
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
    movement.status = 'confirmed'
    movement.confirmedBy = new mongoose.Types.ObjectId(user._id)
    movement.confirmedAt = new Date()
    await movement.save()
    res.json(movement)
  } catch (err) {
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
    const movements = await CashMovement.find({ session: session._id }).lean()
    const expected = movements.filter((movement) => !movement.status || movement.status === 'confirmed').reduce((sum, movement) => {
      const value = movement.amount
      return movement.direction === bookcarsTypes.CashMovementDirection.In ? sum + value : sum - value
    }, session.openingBalance)
    session.status = bookcarsTypes.CashSessionStatus.Closed
    session.closedAt = new Date()
    session.closedBy = new mongoose.Types.ObjectId(user._id)
    session.expectedClosingBalance = normalizeLedgerAmount(expected, session.currency)
    session.countedClosingBalance = counted
    session.discrepancy = normalizeLedgerAmount(counted - expected, session.currency)
    session.closingNote = String(req.body?.closingNote || '').trim()
    await session.save()
    res.json(session)
  } catch (err) {
 logger.error('[cash.close]', err); res.status(400).send(i18n.t('ERROR')) 
}
}

