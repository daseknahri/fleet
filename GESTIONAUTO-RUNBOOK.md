# Gestion Auto — Monitoring & Incident Runbook

**Created:** 2026-11-14 (Queue 4, item Q4-5 — roadmap §10 gate item 11).
**Status:** the `/health` endpoint and this runbook are the monitoring leg of
gate 11. **Release stays "Not ready"** — this runbook does not change that.
**Scope:** local dev stack on the laptop + production on the Coolify VPS.
Production surfaces go live with the next redeploy; until then, the live
`/health` endpoint does not exist yet (local proof only — see §1).

Related: `GESTIONAUTO-ROADMAP.md` (§10 readiness checklist),
`.github/workflows/ci.yml` (hosted build + P0 gates),
`__scripts/backup-local.ps1` (local backup automation), `SETUP.md`
("Local backups"), `SESSION-CHECKPOINT.md`
(`GA-P10-RECOVERY-01/02`, `GA-P10-OPS-BACKUP-AUTO-01`,
`GA-P10-ROLLBACK-01`).

## 1. How to check health

### 1.1 The `/health` endpoint (backend only)

```
GET https://api.gestionauto.ibnbatoutaweb.com/health        (production)
GET http://127.0.0.1:4002/health                            (local dev)
```

- **Unauthenticated on purpose** — monitoring must not need credentials.
- **Healthy response — HTTP 200:**
  `{"status":"ok","db":"ok","version":"9.1.0","commit":"<sha-or-unknown>"}`
  - `status: "ok"` + `db: "ok"` means the backend answered **and** a real
    MongoDB ping succeeded (not a hardcoded ok).
  - `version` is the backend `package.json` version; `commit` is the
    deployed commit SHA from the `BC_GIT_COMMIT` environment variable, or
    `"unknown"` when the deploy does not set it. Set `BC_GIT_COMMIT` in the
    Coolify environment so `/health` reports the deployed commit — that is
    how a deploy is proven to have swapped containers (§3.4).
  - The response carries **no secrets, connection strings, env values, or
    internal topology** — only the four fields above.
- **Database down — HTTP 503:**
  `{"status":"degraded","db":"error","version":"...","commit":"..."}`.
  The backend process is up but the database ping failed (or timed out
  after 3 s). Treat 503 as "backend up, database down", not as "site down".
- **Connection refused / timeout:** the backend process itself is down
  (or the container is stopped). See §3.1.

Quick check (any shell):

```sh
curl -s -w '\nHTTP %{http_code}\n' https://api.gestionauto.ibnbatoutaweb.com/health
```

### 1.2 The three live surfaces (production)

| Surface | URL | Healthy |
|---|---|---|
| Customer frontend | https://gestionauto.ibnbatoutaweb.com | HTTP 200 |
| Admin | https://admin.gestionauto.ibnbatoutaweb.com | HTTP 200 |
| API | https://api.gestionauto.ibnbatoutaweb.com/health | HTTP 200, `status: "ok"` |
| API sign probe | `GET https://api.gestionauto.ibnbatoutaweb.com/api/sign/<invalid-token>` | HTTP 400 `{"message":"SIGN_LINK_INVALID"}` |

Local dev equivalents: frontend `http://127.0.0.1:8080/`, admin
`http://127.0.0.1:3002/`, backend `http://127.0.0.1:4002/health`,
MongoDB `127.0.0.1:27018` (replica set `rs0`), Redis `127.0.0.1:6379`.

A single surface failing while the others answer narrows the fault fast:
frontend/admin 200 + API failing = backend or database, not the edge;
all three failing = edge/proxy or whole-VPS problem (§3.1).

### 1.3 Coolify (production control plane)

- Open the Coolify dashboard → the Gestion Auto project → the application
  (backend / admin / frontend) → **Logs** for the recent crash/error lines,
  and **Deployments** for the last deploy status and commit.
- The VPS is reached through Coolify: there is no direct VPS SSH route
  established for this project. Container inspection on the VPS runs from
  the Coolify terminal.

### 1.4 `docker ps` — prove which code is actually running

A deploy status of "Success" is **not** proof the new code is live
(see §3.4). Always confirm the running image tags:

```sh
docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
```

- **Local:** expect `bookcars-bc-backend-1`, `bookcars-bc-admin-1`,
  `bookcars-bc-frontend-1`, `bookcars-mongo-1` (healthy),
  `bookcars-redis-1` (healthy), `mailpit-1`, `mongo-express-1`.
- **Production (Coolify terminal):** the backend/admin/frontend image tags
  must match the commit that was deployed (the `ga-deploy` branch head).
  If a tag still shows the previous commit after a "Success" deploy, the
  deploy did **not** swap the containers — see §3.4.
- Cross-check with `/health`: `commit` must equal the deployed SHA
  (once `BC_GIT_COMMIT` is set in the Coolify environment).

## 2. What is monitored, and what is not (honest state)

- **Have:** `/health` (this item); local backup automation with verified
  restore (`__scripts/backup-local.ps1`, §4); hosted CI
  (`.github/workflows/ci.yml`: four builds + P0 on every push to `main`
  and every pull request); local P0 suites (8 suites / 41 tests).
- **Not have (open, no silent substitute):**
  - No uptime prober / alerting watches production and pages anyone.
    Somebody has to look (§1) — there is no on-call rotation.
  - No off-host backup retention and no on-VPS backup cron (§4).
  - No formal RTO/RPO decision — §5 proposes targets for the owner.

## 3. Incident triage

General rule: **look before restarting.** Capture the symptom, the
`/health` body, the last Coolify deploy, and `docker ps` first; a restart
destroys the evidence of why it failed. Never delete a Docker volume or
local data as a "cleanup" step.

### 3.1 Site down (all three surfaces fail)

1. Check whether the VPS / Coolify itself answers (Coolify dashboard
   reachable?). If Coolify is down, the fault is above the app — escalate
   to the owner; nothing app-side can fix it.
2. In Coolify, check each application's **Logs** (last lines first) and
   **Deployments** (did the last deploy fail?).
3. In the Coolify terminal: `docker ps` — are the three app containers
   running? Is MongoDB healthy?
4. If a container is stopped/crashed: read its logs for the crash line
   before restarting it from Coolify (restart, not rebuild, first).
5. If all containers are up but nothing answers: check Traefik / the edge
   (domain + TLS) — a container-side fix will not help an edge outage.
6. After recovery: run the §1.2 table end-to-end and record what failed
   and what fixed it (append to the roadmap work log).

### 3.2 API 500 (frontend/admin load, API errors)

1. `GET /health`: 200 + `db: "ok"` rules out the database; 503 points
   at §3.3; connection refused points at §3.1.
2. Read the backend logs (Coolify → Logs, or locally
   `docker logs bookcars-bc-backend-1 --tail 200`). The final error
   handler logs the route and the error server-side and returns only a
   generic message to clients — the cause is in the logs, never in the
   response body.
3. Common local-dev cause: the backend container is running a stale
   build. Rebuild the backend image and restart only that container
   (never `docker compose down/up` — that recreates the app containers
   and risks the volumes).
4. If the 500 is on one route only, note the route + a request id/time
   and escalate with the log lines; do not edit production data by hand.

### 3.3 DB down (`/health` 503, or MongoDB unhealthy)

1. Confirm: `/health` returns 503 with `db: "error"`, and/or the mongo
   container is not `(healthy)` in `docker ps`.
2. Check the mongo container logs for the failure (disk full, OOM kill,
   replica-set election stuck). **Do not delete the `mongodb_data`
   volume** — that is the data.
3. Check disk space on the host first: a full disk stops MongoDB before
   anything else does.
4. If MongoDB restarts cleanly, `/health` must return to 200 and the
   three surfaces to the §1.2 table. If data looks wrong after a
   restart, stop and restore from backup (§4) — do not hand-edit records.
5. If the replica set will not elect a primary, escalate to the owner
   with the mongo logs; do not force-reconfigure the set without a
   backup in hand.

### 3.4 Deploy didn't swap (Coolify says "Success", old code still live)

**Lesson (2026-11-14): a Coolify deploy reported "Success" but never
swapped the containers — the old code kept serving. A "Success" status
alone does NOT prove a deploy.**

1. After every deploy, verify **both**:
   - `docker ps` image tags match the deployed commit (`ga-deploy` head);
   - `/health` `commit` equals the deployed SHA (once `BC_GIT_COMMIT`
     is set in the Coolify environment).
2. If either check still shows the old commit: the deploy did not swap.
   Do **not** report the deploy as done. Redeploy from Coolify, then
   re-verify. If a second redeploy still does not swap, escalate to the
   owner with the deployment log + `docker ps` output — do not work
   around it by hand-editing containers on the VPS.
3. Before any redeploy, the RAM gate applies: the VPS must show
   `free -m` available ≥ 2,048 MB. If the gate fails, stop the redeploy
   and report — do not stop other projects to free RAM without the
   owner's word.

## 4. Backup / restore reference

### 4.1 What exists (local, rehearsed)

- **Local backup automation:** `__scripts/backup-local.ps1`
  (`GA-P10-OPS-BACKUP-AUTO-01`, 2026-11-05). It resolves the MongoDB URI
  from the running backend container's environment (never printed),
  runs `mongodump --archive --gzip` to
  `artifacts/recovery/bookcars-<timestamp>.archive.gz`, verifies by
  restoring into a scratch database (`bookcars_verify_<timestamp>`)
  with `mongorestore`, compares per-collection counts, drops the scratch
  database, and writes a JSON summary. Retention default: 7 archives.
- **Restore rehearsal (local, 2026-11-02, `GA-P10-RECOVERY-01`):**
  archive `artifacts/recovery/bookcars-2026-11-02.archive` (38,467 bytes)
  restored with `mongorestore` into `bookcars_rehearsal`: **66 documents /
  0 failures / 27 collections**, source/rehearsal booking = 5, users = 3.
- **Rollback rehearsal (local, 2026-11-05, `GA-P10-ROLLBACK-01`):**
  live restore of a pre-change archive over the dev database:
  **196 documents restored, 0 failed, 3.97 s**, per-collection parity
  196 → 196 with zero mismatches. Dev-scale timing only — not a
  production RTO estimate.
- Full procedure and the scheduled-task example for the owner are in
  `SETUP.md` ("Local backups"). No OS scheduled task was installed by
  the automation slice — running it on a schedule is an owner action.

### 4.2 What does NOT exist — open gap (do not assume otherwise)

- **No on-VPS backup cron for Gestion Auto.** No scheduled backup runs
  on the production host, and no backup is sent off-host. This is a
  known open gap (PAR-20 design note). Until a cron exists, a VPS disk
  loss means production data loss back to the last manual backup.
- No production-volume restore has ever been rehearsed; the rehearsals
  above are local-dev only.
- **Restore rule:** restore into a scratch database and compare counts
  first (the backup script does this by design). Restoring over the live
  database is the last step, only after the scratch parity check passes,
  and only with a fresh pre-restore archive in hand.

## 5. RTO / RPO targets — PROPOSED, not decided

The numbers below are **PROPOSED targets for the owner to approve or
change. They are not decided, not promised, and not evidenced** — the
owner decides them (see PAR-20's 10 open decisions, which include
retention and RTO/RPO).

| Target | Proposed | Basis / condition |
|---|---|---|
| RTO (time to restore service after an outage) | **4 hours** | Single VPS, manual restore + redeploy by one operator; no automation yet. |
| RPO (data loss window) | **24 hours** | Assumes a daily backup cron is approved and runs; see caveat below. |

**Caveat that changes the RPO:** with no on-VPS backup cron today (§4.2),
the effective RPO is **unbounded** — data loss reaches back to the last
manual backup, whenever that was. The 24-hour RPO is only real once the
backup cron exists and its retention is decided. Do not quote the RPO
without that caveat.

## 6. Escalation

- There is no on-call rotation and no alerting (§2). The owner is the
  escalation for: any production outage lasting past first triage, any
  data-loss suspicion, any deploy that will not swap (§3.4), any decision
  in §5, and any backup-cron / retention decision (§4.2).
- When escalating, send: what failed, the `/health` body, the last
  Coolify deploy (commit + status), `docker ps` output, and the last
  ~50 lines of the relevant container log. Never send credentials,
  connection strings, or customer records.
