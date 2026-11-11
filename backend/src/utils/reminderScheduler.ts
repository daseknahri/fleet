import * as env from '../config/env.config'
import Reminder from '../models/Reminder'
import ReminderFiring from '../models/ReminderFiring'
import * as logger from './logger'
import { nextOccurrence } from './reminderSchedule'
import { notifyReminderFired } from './reminderNotify'

/**
 * GA-PAR-13 — the codebase's first background-job infrastructure: an
 * in-process 60 s tick for the reminders engine.
 *
 * Placement contract: `startReminderScheduler` is called ONLY from the
 * server entrypoint (backend/src/index.ts) after the database is
 * connected — NEVER from app.ts, which the P0 suites import, so the
 * tick cannot fire during P0. Kill-switch: environment variable
 * BC_REMINDERS_SCHEDULER=off disables the scheduler entirely. The
 * timer is unref'd so it never keeps the process alive on its own.
 *
 * Exactly-once: a ReminderFiring row is CLAIMED (inserted) before any
 * notification is sent; the unique (reminder, occurrenceAt,
 * offsetHours) index makes a duplicate claim fail with E11000, which
 * is treated as "already fired — skip silently". This holds across
 * ticks and across backend restarts, and is the concurrency guard for
 * the single local backend instance (and any future second one).
 */

export const REMINDER_TICK_MS = 60_000
const MAX_OFFSET_HOURS = 720
const HOUR_MS = 60 * 60 * 1000

export const runReminderTick = async (now: Date = new Date()): Promise<void> => {
  try {
    // Cheap pre-filter: an occurrence can only be due (for some offset)
    // when nextDueAt - maxOffset <= now.
    const horizon = new Date(now.getTime() + MAX_OFFSET_HOURS * HOUR_MS)
    const reminders = await Reminder.find({ active: true, nextDueAt: { $lte: horizon } })
    for (const reminder of reminders) {
      try {
        if (!reminder.nextDueAt) {
          continue
        }
        const occurrenceAt = new Date(reminder.nextDueAt)
        const offsets = [...(reminder.notifyAheadHours?.length ? reminder.notifyAheadHours : [0])]
          .sort((a, b) => b - a)
        let firedAny = false
        for (const offsetHours of offsets) {
          const fireAt = occurrenceAt.getTime() - offsetHours * HOUR_MS
          if (fireAt > now.getTime()) {
            continue
          }
          // Defence-in-depth pre-check (single-instance reality): a
          // firing row from an earlier tick means this offset already
          // fired — skip without relying on the index alone. The
          // claim insert below remains the authoritative guard.
          const alreadyFired = await ReminderFiring.exists({
            reminder: reminder._id,
            occurrenceAt,
            offsetHours,
          })
          if (alreadyFired) {
            continue
          }
          // Claim before notifying.
          let claim
          try {
            claim = await ReminderFiring.create({
              supplier: reminder.supplier,
              reminder: reminder._id,
              occurrenceAt,
              offsetHours,
              firedAt: now,
            })
          } catch (err) {
            if ((err as { code?: number })?.code === 11000) {
              continue // already fired — skip silently
            }
            throw err
          }
          firedAny = true
          const counts = await notifyReminderFired(reminder, occurrenceAt, offsetHours)
          claim.inAppCount = counts.inAppCount
          claim.emailCount = counts.emailCount
          claim.pushCount = counts.pushCount
          await claim.save()
        }

        if (firedAny) {
          reminder.lastFiredAt = now
        }

        // Advance only after the LAST offset of this occurrence (the
        // smallest offset fires last) has been claimed by anyone.
        const finalOffset = Math.min(...offsets)
        const finalClaimed = await ReminderFiring.exists({
          reminder: reminder._id,
          occurrenceAt,
          offsetHours: finalOffset,
        })
        if (finalClaimed) {
          const next = nextOccurrence(
            new Date(reminder.firstDueAt),
            { kind: reminder.recurrence?.kind, intervalDays: reminder.recurrence?.intervalDays },
            occurrenceAt,
            env.TIMEZONE || 'Africa/Casablanca',
          )
          if (next) {
            reminder.nextDueAt = next
          } else {
            // `once` (or an exhausted recurrence): deactivate.
            reminder.active = false
            reminder.nextDueAt = undefined
          }
        }
        if (firedAny || finalClaimed) {
          await reminder.save()
        }
      } catch (err) {
        logger.error(`[reminderScheduler] tick failed for reminder ${reminder._id}`, err)
      }
    }
  } catch (err) {
    // A tick failure must log and never crash the process.
    logger.error('[reminderScheduler] tick failed', err)
  }
}

let timer: NodeJS.Timeout | null = null

export const startReminderScheduler = (): NodeJS.Timeout | null => {
  if (process.env.BC_REMINDERS_SCHEDULER === 'off') {
    logger.info('[reminderScheduler] disabled via BC_REMINDERS_SCHEDULER=off')
    return null
  }
  if (timer) {
    return timer
  }
  // One immediate tick so reminders already due at boot fire without
  // waiting a full interval; then the steady 60 s cadence.
  void runReminderTick()
  timer = setInterval(() => { void runReminderTick() }, REMINDER_TICK_MS)
  timer.unref()
  logger.info('[reminderScheduler] started (60s tick)')
  return timer
}

export const stopReminderScheduler = (): void => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
