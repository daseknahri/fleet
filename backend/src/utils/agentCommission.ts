import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import Agent from '../models/Agent'
import AgentSettlement from '../models/AgentSettlement'
import Booking from '../models/Booking'

/**
 * GA-PAR-07 — the ONE definition of apporteur commission money.
 *
 * A booking carries an agent SNAPSHOT (Booking.agent = { agent, mode,
 * value, amount }) captured when the booking is created (or when its agent
 * inputs change on update). `amount` is always computed HERE, server-side:
 *   percent -> rentalTotal x value / 100
 *   fixed   -> value
 *   perDay  -> value x rental days (helper.days(from, to), the price
 *              logic's own day count)
 * where rentalTotal is the booking's financialSnapshot.rentalTotal when a
 * real snapshot exists, else its price — the same derivation the invoice
 * machinery uses. Amounts are rounded to 2 decimals (the house money
 * rounding, cf. invoiceCreation). Later edits to the agent's default terms
 * never rewrite an existing booking's snapshot.
 *
 * OUTSTANDING (due) for one agent — the single definition used by the
 * agent list, the KPI strip and settle validation alike:
 *   due = Σ Booking.agent.amount over the agency's bookings carrying the
 *         agent, EXCLUDING bookings whose status is Void or Cancelled,
 *         − Σ AgentSettlement.amount for the agent.
 *
 * RENTAL BROUGHT for one agent = Σ (financialSnapshot.rentalTotal, else
 * price) over the SAME booking set.
 *
 * COMMISSIONS THIS MONTH (KPI) = Σ Booking.agent.amount over bookings of
 * the agency carrying any agent, CREATED in the current Africa/Casablanca
 * calendar month (same Void/Cancelled exclusion).
 */

export const AGENT_TIMEZONE = 'Africa/Casablanca'

const EXCLUDED_STATUSES: bookcarsTypes.BookingStatus[] = [
  bookcarsTypes.BookingStatus.Void,
  bookcarsTypes.BookingStatus.Cancelled,
]

export const roundMoney = (value: number) => Number(value.toFixed(2))

export const computeCommissionAmount = (
  mode: bookcarsTypes.CommissionMode,
  value: number,
  rentalTotal: number,
  days: number,
): number => {
  if (mode === bookcarsTypes.CommissionMode.Percent) {
    return roundMoney((rentalTotal * value) / 100)
  }
  if (mode === bookcarsTypes.CommissionMode.PerDay) {
    return roundMoney(value * days)
  }
  return roundMoney(value)
}

export const isValidCommission = (mode: unknown, value: unknown): mode is bookcarsTypes.CommissionMode => {
  if (!Object.values(bookcarsTypes.CommissionMode).includes(mode as bookcarsTypes.CommissionMode)) {
    return false
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return false
  }
  if (mode === bookcarsTypes.CommissionMode.Percent && numeric > 100) {
    return false
  }
  return true
}

export interface BookingAgentSnapshot {
  agent: mongoose.Types.ObjectId
  mode: bookcarsTypes.CommissionMode
  value: number
  amount: number
}

export type ResolveAgentResult =
  | { ok: true, snapshot: BookingAgentSnapshot }
  | { ok: false, error: string }

/**
 * Resolve a booking payload's agent input into a stored snapshot. The
 * agent must exist AND belong to the booking's agency — a foreign or
 * unknown agent id is refused, never silently accepted. mode/value fall
 * back to the agent's current default when the payload carries no
 * per-contract override.
 */
export const resolveBookingAgentSnapshot = async (
  supplierId: string | mongoose.Types.ObjectId,
  input: { agent?: unknown, mode?: unknown, value?: unknown },
  rentalTotal: number,
  days: number,
): Promise<ResolveAgentResult> => {
  const rawId = typeof input.agent === 'string'
    ? input.agent
    : (input.agent as { _id?: string } | undefined)?._id
  if (!rawId || !mongoose.isValidObjectId(rawId)) {
    return { ok: false, error: 'Invalid agent for this booking' }
  }
  const agent = await Agent.findOne({ _id: rawId, supplier: supplierId }).lean()
  if (!agent) {
    return { ok: false, error: 'Agent not found for this agency' }
  }
  const mode = (input.mode !== undefined && input.mode !== null ? input.mode : agent.commissionMode) as bookcarsTypes.CommissionMode
  const value = input.value !== undefined && input.value !== null ? Number(input.value) : agent.commissionValue
  if (!isValidCommission(mode, value)) {
    return { ok: false, error: 'Invalid commission mode or value' }
  }
  return {
    ok: true,
    snapshot: {
      agent: agent._id,
      mode,
      value,
      amount: computeCommissionAmount(mode, value, rentalTotal, days),
    },
  }
}

const agentBookingsFilter = (supplierId: string | mongoose.Types.ObjectId, agentId: string | mongoose.Types.ObjectId) => ({
  supplier: supplierId,
  'agent.agent': agentId,
  status: { $nin: EXCLUDED_STATUSES },
})

export interface AgentFigures {
  /** Σ snapshot commissions over the counted booking set. */
  gross: number
  /** Σ settlements recorded for the agent. */
  settled: number
  /** gross − settled (the outstanding definition above). */
  due: number
  /** Σ rental totals over the counted booking set. */
  rentalBrought: number
}

export const getAgentFigures = async (
  supplierId: string | mongoose.Types.ObjectId,
  agentId: string | mongoose.Types.ObjectId,
): Promise<AgentFigures> => {
  const [bookings, settlements] = await Promise.all([
    Booking.find(agentBookingsFilter(supplierId, agentId)).select('agent price financialSnapshot').lean() as unknown as Array<{
      agent?: { amount?: number }, price?: number, financialSnapshot?: { rentalTotal?: number },
    }>,
    AgentSettlement.find({ supplier: supplierId, agent: agentId }).select('amount').lean() as unknown as Array<{ amount?: number }>,
  ])
  const gross = roundMoney(bookings.reduce((sum, booking) => sum + (booking.agent?.amount || 0), 0))
  const rentalBrought = roundMoney(bookings.reduce(
    (sum, booking) => sum + (booking.financialSnapshot?.rentalTotal ?? booking.price ?? 0),
    0,
  ))
  const settled = roundMoney(settlements.reduce((sum, settlement) => sum + (settlement.amount || 0), 0))
  return { gross, settled, due: roundMoney(gross - settled), rentalBrought }
}

/** UTC instants bounding the current Africa/Casablanca calendar month. */
export const casablancaMonthRange = (now: Date = new Date()): { start: Date, end: Date } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AGENT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || '0')
  const year = part('year')
  const month = part('month')
  const offsetAt = (t: number) => {
    const zoned = new Intl.DateTimeFormat('en-US', {
      timeZone: AGENT_TIMEZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(t))
    const p: Record<string, number> = {}
    for (const item of zoned) {
      if (item.type !== 'literal') {
        p[item.type] = Number(item.value)
      }
    }
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000
  }
  const localMidnightUtc = (y: number, m: number) => {
    const guess = Date.UTC(y, m - 1, 1, 0, 0, 0)
    const firstPass = guess - offsetAt(guess)
    return new Date(guess - offsetAt(firstPass))
  }
  const start = localMidnightUtc(year, month)
  const end = month === 12 ? localMidnightUtc(year + 1, 1) : localMidnightUtc(year, month + 1)
  return { start, end }
}

export interface AgentKpiFigures {
  totalDue: number
  commissionsThisMonth: number
  rentalBrought: number
  activeAgents: number
}

/** KPI strip figures for one agency scope (or every agency when no supplier is given, platform-admin view). */
export const getAgentKpis = async (supplierId?: string | mongoose.Types.ObjectId): Promise<AgentKpiFigures> => {
  const agentFilter = supplierId ? { supplier: supplierId } : {}
  const agents = await Agent.find(agentFilter).select('_id active supplier').lean()
  let totalDue = 0
  let rentalBrought = 0
  for (const agent of agents) {
    const figures = await getAgentFigures(agent.supplier as mongoose.Types.ObjectId, agent._id)
    totalDue += figures.due
    rentalBrought += figures.rentalBrought
  }
  const { start, end } = casablancaMonthRange()
  const monthFilter: Record<string, unknown> = {
    'agent.agent': { $exists: true },
    status: { $nin: EXCLUDED_STATUSES },
    createdAt: { $gte: start, $lt: end },
  }
  if (supplierId) {
    monthFilter.supplier = supplierId
  }
  const monthBookings = await Booking.find(monthFilter).select('agent').lean() as unknown as Array<{ agent?: { amount?: number } }>
  const commissionsThisMonth = roundMoney(monthBookings.reduce((sum, booking) => sum + (booking.agent?.amount || 0), 0))
  return {
    totalDue: roundMoney(totalDue),
    commissionsThisMonth,
    rentalBrought: roundMoney(rentalBrought),
    activeAgents: agents.filter((agent) => agent.active).length,
  }
}

/**
 * FIFO allocation of a new settlement across the agent's counted bookings,
 * oldest booking first, skipping what earlier settlements already covered.
 * Returns the ids of the bookings this payment covers (the bookingRefs
 * record — an allocation record, not a per-booking split of the amount).
 */
export const fifoBookingRefs = async (
  supplierId: string | mongoose.Types.ObjectId,
  agentId: string | mongoose.Types.ObjectId,
  amount: number,
  alreadySettled: number,
): Promise<mongoose.Types.ObjectId[]> => {
  const bookings = await Booking.find(agentBookingsFilter(supplierId, agentId))
    .select('_id agent createdAt')
    .sort({ createdAt: 1 })
    .lean() as unknown as Array<{ _id: mongoose.Types.ObjectId, agent?: { amount?: number } }>
  const refs: mongoose.Types.ObjectId[] = []
  let settledRemaining = alreadySettled
  let toAllocate = amount
  for (const booking of bookings) {
    if (toAllocate <= 0) {
      break
    }
    const bookingAmount = booking.agent?.amount || 0
    const coveredBefore = Math.min(bookingAmount, Math.max(0, settledRemaining))
    settledRemaining -= coveredBefore
    const uncovered = roundMoney(bookingAmount - coveredBefore)
    if (uncovered > 0) {
      refs.push(booking._id)
      toAllocate = roundMoney(toAllocate - uncovered)
    }
  }
  return refs
}
