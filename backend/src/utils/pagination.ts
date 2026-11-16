import { Request } from 'express'
import * as bookcarsTypes from ':bookcars-types'

// F6 / W3 X-1 — server-side pagination for the finance list endpoints
// (payments, invoices, expenses, cash sessions/movements), following the
// existing `page`/`size` convention (booking/car/location lists use
// path params; these GET lists use query params so the unpaginated
// legacy response stays the default).
//
// - No `page`/`size` query param: `null` — the endpoint returns the full
//   filtered array exactly as before (existing admin pages and tests
//   keep working while they migrate).
// - Either param present: `{ page, size }` — page defaults to 1, size
//   defaults to DEFAULT_PAGE_SIZE, size is capped at MAX_PAGE_SIZE.
// - Invalid values: `{ error }` — the controller answers 400 with the
//   message (never a silent clamp: a caller asking for page 0 or size
//   5000 must know it was refused).

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

export type ParsedPagination = { pagination: { page: number, size: number } | null } | { error: string }

export const parsePagination = (req: Request): ParsedPagination => {
  const rawPage = req.query.page
  const rawSize = req.query.size
  if (rawPage === undefined && rawSize === undefined) {
    return { pagination: null }
  }
  const page = rawPage === undefined ? 1 : Number.parseInt(String(rawPage), 10)
  const size = rawSize === undefined ? DEFAULT_PAGE_SIZE : Number.parseInt(String(rawSize), 10)
  if (!Number.isInteger(page) || !Number.isInteger(size) || page < 1 || size < 1 || size > MAX_PAGE_SIZE) {
    return { error: 'Invalid page or size' }
  }
  return { pagination: { page, size } }
}

export const pagedResponse = <T>(rows: T[], total: number, pagination: { page: number, size: number }): bookcarsTypes.PagedResult<T> => ({
  rows,
  total,
  page: pagination.page,
  size: pagination.size,
})

export const paginationSkip = (pagination: { page: number, size: number }) => (pagination.page - 1) * pagination.size
