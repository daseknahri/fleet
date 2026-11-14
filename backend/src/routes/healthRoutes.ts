import express from 'express'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as databaseHelper from '../utils/databaseHelper'

const routes = express.Router()

/**
 * Backend version, read once from backend/package.json. The file is
 * resolved relative to this module and verified by package name, so it
 * works both from src/ (tests, dev) and from dist/src/ (built server):
 * src/routes -> ../../package.json, dist/src/routes -> ../../../package.json.
 * 'unknown' when unreadable — never a fabricated value.
 */
let cachedVersion: string | null = null
const getVersion = async (): Promise<string> => {
  if (cachedVersion !== null) {
    return cachedVersion
  }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const candidates = [
      path.resolve(here, '..', '..', '..', 'package.json'),
      path.resolve(here, '..', '..', 'package.json'),
    ]
    for (const candidate of candidates) {
      try {
        const pkg = JSON.parse(await readFile(candidate, 'utf8')) as { name?: unknown; version?: unknown }
        if (pkg.name === 'bookcars-backend' && typeof pkg.version === 'string' && pkg.version) {
          cachedVersion = pkg.version
          return cachedVersion
        }
      } catch {
        // Try the next candidate.
      }
    }
    cachedVersion = 'unknown'
  } catch {
    cachedVersion = 'unknown'
  }
  return cachedVersion
}

/**
 * Deployment commit SHA, supplied by the deploy environment as
 * BC_GIT_COMMIT. 'unknown' when unset — the endpoint never invents one.
 * Set BC_GIT_COMMIT in the Coolify environment so /health reports the
 * deployed commit (used to prove a deploy actually swapped containers).
 */
const getCommit = (): string => {
  const commit = (process.env.BC_GIT_COMMIT || '').trim()
  return commit || 'unknown'
}

/**
 * GET /health — unauthenticated liveness/readiness probe for monitoring.
 *
 * - No auth, no writes, no secrets: the response carries only a status,
 *   a real MongoDB ping result, and version/commit identifiers.
 * - 200 + status "ok" when the database ping succeeds.
 * - 503 + status "degraded" when the database ping fails (db "error").
 *   Monitoring must treat 503 as "backend up, database down".
 */
routes.get('/health', async (_req, res) => {
  const dbOk = await databaseHelper.ping()
  const body = {
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'error',
    version: await getVersion(),
    commit: getCommit(),
  }
  res.status(dbOk ? 200 : 503).send(body)
})

export default routes
