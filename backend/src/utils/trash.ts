import mongoose from 'mongoose'
import * as env from '../config/env.config'

/**
 * GA-PAR-22 — Trash / restore shared helpers (scorecard row #47).
 *
 * One uniform mechanism on bookings, clients (`User` rows with
 * `type=User`) and cars: trashed is a timestamp, not a status.
 * `deletedAt` absent/`null` = live; set = trashed. There is no
 * `isDeleted` boolean (two fields that can disagree is a bug class;
 * the `expireAt: null` pattern in `getBookings`/`getUsers` is the
 * house precedent for "null = live").
 *
 * Exact-reversal invariant (design D-22.2): trash writes exactly
 * `deletedAt` / `deletedBy` / `deleteReason` and appends exactly one
 * `trashHistory` row; restore clears exactly those three fields and
 * appends exactly one `trashHistory` row. Nothing else changes.
 * Trash/restore persist with a plain `save()` / `updateOne` — never
 * through `saveBookingWithAvailability` (its `reservesCar` check
 * would re-run overlap logic against a status trash deliberately
 * leaves alone).
 */

export const TRASH_REASON_MIN_LENGTH = 3
export const TRASH_REASON_MAX_LENGTH = 1000

/** House reason pattern (PAR-11 amend / PAR-12 signing): 3–1000 chars. */
export const isValidTrashReason = (reason: unknown): reason is string =>
  typeof reason === 'string'
  && reason.trim().length >= TRASH_REASON_MIN_LENGTH
  && reason.trim().length <= TRASH_REASON_MAX_LENGTH

/** Trimmed reason, or `undefined` when absent/blank (restore: optional). */
export const normalizeTrashReason = (reason: unknown): string | undefined => {
  if (typeof reason !== 'string') {
    return undefined
  }
  const trimmed = reason.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Structural shape shared by the three trashable documents. */
export interface TrashableDocument {
  deletedAt?: Date | null
  deletedBy?: mongoose.Types.ObjectId
  deleteReason?: string
  trashHistory?: env.TrashHistoryRow[]
}

export const isTrashed = (doc: { deletedAt?: Date | null } | null | undefined): boolean => !!doc?.deletedAt

/** 409 body for any mutation attempted on a trashed row (design §5.5). */
export const trashedMessage = (entity: string): string =>
  `TRASHED: This ${entity} is trashed and cannot be modified. Restore it first.`

export const applyTrash = (
  doc: TrashableDocument,
  actorId: string | mongoose.Types.ObjectId,
  reason: string,
  flags?: { hadPayments?: boolean, hadInvoices?: boolean },
): void => {
  const now = new Date()
  const by = typeof actorId === 'string' ? new mongoose.Types.ObjectId(actorId) : actorId
  doc.deletedAt = now
  doc.deletedBy = by
  doc.deleteReason = reason.trim()
  if (!doc.trashHistory) {
    doc.trashHistory = []
  }
  const row: env.TrashHistoryRow = {
    at: now,
    by,
    action: 'trashed',
    reason: reason.trim(),
  }
  // Booking rows only: whether the trash money-warning fired (§2.5).
  // Omitted (undefined) on client/car rows and on restore rows.
  if (flags?.hadPayments !== undefined) {
    row.hadPayments = flags.hadPayments
  }
  if (flags?.hadInvoices !== undefined) {
    row.hadInvoices = flags.hadInvoices
  }
  doc.trashHistory.push(row)
}

export const applyRestore = (
  doc: TrashableDocument,
  actorId: string | mongoose.Types.ObjectId,
  reason?: string,
): void => {
  const now = new Date()
  const by = typeof actorId === 'string' ? new mongoose.Types.ObjectId(actorId) : actorId
  // Assigning `undefined` unsets the paths on save, so a restored
  // document is byte-identical to its pre-trash state except
  // `updatedAt` and the (longer) `trashHistory` (design A3).
  doc.deletedAt = undefined
  doc.deletedBy = undefined
  doc.deleteReason = undefined
  if (!doc.trashHistory) {
    doc.trashHistory = []
  }
  doc.trashHistory.push({
    at: now,
    by,
    action: 'restored',
    reason: reason?.trim() || '',
  })
}
