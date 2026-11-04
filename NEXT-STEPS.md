# FleetRent — Next Steps

## Before going to production

1. **Domain & SSL** — put the stack behind a reverse proxy (nginx/Traefik/Caddy) with a real domain; enable HTTPS (`BC_HTTPS=true`, SSL nginx configs for admin/frontend are documented in the BookCars wiki "Installing (Docker) → SSL") and update `BC_ADMIN_HOST`, `BC_FRONTEND_HOST`, `BC_AUTH_COOKIE_DOMAIN` plus all `VITE_BC_*` hosts.
2. **Secrets** — replace MongoDB `admin`/`admin` (docker-compose.yml + `BC_DB_URI` + mongo healthcheck), rotate `BC_JWT_SECRET` / `BC_COOKIE_SECRET`, and set a strong Mailpit-free SMTP provider in `backend/.env.docker` (SendGrid: `smtp.sendgrid.net:587`, user `apikey`).
3. **Payments** — add Stripe or PayPal keys (see SETUP.md) so "Block car on successful payment" (`blockOnPay`) can be enabled per car; without a gateway only pay-later bookings work.
4. **Email sender identity** — current from-address is `no-reply@fleetrent.local`, which real mail servers will reject; use a domain you control and set up SPF/DKIM.
5. **Backups** — back up the `mongodb_data`, `cdn` and `backend_logs` Docker volumes (e.g. scheduled `mongodump --archive` + volume snapshot).
6. **Security** — remove/replace the Mailpit container, change Mongo Express credentials or drop it, restrict published MongoDB/Redis ports to localhost, and disable reCAPTCHA only after adding real keys (`VITE_BC_RECAPTCHA_ENABLED=true`).

## Recommended first customizations

- Branding: logo, colors and home-page copy (frontend `src/assets` / `src/components`, admin panel likewise), real company contact data (`VITE_BC_CONTACT_EMAIL` → `info@fleetrent.local` placeholder today)
- Fleet & network: add real suppliers, locations and cars through the admin panel (images are uploaded to the CDN volume automatically)
- Pricing rules: deposits, insurance options, mileage, fuel policy, minimum driver age (already 21), date-based seasonal pricing
- Mobile app: the repo includes an Expo `mobile/` app that works against the same API
- Languages: content is already multilingual (en/fr/es seeded); add more via `BC_DEFAULT_LANGUAGE` and location/country translations

## GPS tracking (e.g. Traccar) — later

BookCars has no built-in telematics, but the pieces integrate cleanly:

1. Run Traccar separately (its own Docker compose, e.g. `traccar/traccar` with MySQL/H2) and register GPS devices per car.
2. Map BookCars `Car._id` ↔ Traccar `deviceId` (a small lookup collection or a field added via a backend patch).
3. Poll Traccar's REST API (`/api/positions`, `/api/reports/route`) from a small sync service (or a new backend route) and store last-known coordinates per car.
4. Surface them in the admin panel (a map on the car page) and optionally expose live position to customers after checkout.
Keep the sync service read-only against BookCars' MongoDB and write telemetry to its own collection to stay upgrade-safe.

## Known limitations of the current setup

- **Local demo only**: `fleetrent.local` mail domain, MongoDB/Redis/Mongo-Express exposed with weak/default credentials, no TLS.
- **No online payments** — checkout works via the supplier's pay-later flag; Stripe/PayPal keys are empty placeholders.
- **Admin port is 3002** (3001 occupied by the Kimi Work desktop app on this machine); upstream docs assume 3001.
- **Backend image is patched**: the Dockerfile pre-builds the TypeScript at image build time and starts with `setup.js` (upstream tried to build at container start, which fails because `NODE_ENV=production` at runtime strips devDependencies — specifically `tsc-alias`/`@babel`). The seed script was also extended (2 extra locations, 2 extra cars, location images, cleanup support) while keeping everything manifest-tracked and idempotent.
- **Search API quirk** (upstream behavior): empty filter arrays are treated as active `$in: []` filters; the UI always sends meaningful values, but hand-rolled API clients must omit filters they don't want.
- Demo data uses placeholder emails `@bookcars.ma` for the seeded supplier/customer (upstream seed convention); the admin account uses the branded `@fleetrent.local` domain.

## Immediate execution order after the route fix
1. Preserve the current green baseline: backend build, seven-suite Mongo P0, admin/frontend lint, Docker runtime and route matrix artifact.
2. Add route smoke automation and safe-media fallback coverage so optional persisted data cannot crash a page again.
3. Complete the finance/contract browser vertical: payment purpose, refundable deposit disclosure/refund, overdue receivable queue, cash movement, contract inspection/file actions and completion gates.
4. Run real provider sandbox callback/webhook/refund tests and reconcile results against the ledger; keep manual review on all provider uncertainty.
5. Execute staging deployment rehearsal, backup/restore/RTO/RPO and rollback/monitoring checks, then obtain pilot/business-owner sign-off.

The current release declaration is intentionally **Not ready**. Do not promote until every P0 gate has exact evidence.

## Next-phase execution plan — after route-access verification

### Immediate bounded slice: localization parity
- Baseline the current Arabic and French browser matrices for `/cars`, `/bookings`, `/locations`, `/suppliers`, `/users`, `/maintenance`, `/payments`, `/caisse`, and `/reports`.
- Replace unintended French fallback labels with centralized Arabic keys, preserving French source text and existing language-selection behavior.
- Verify RTL direction, responsive layout, empty states, API errors and no error boundary. Do not change persisted records.

### Product-acceptance slice
- Use only explicitly owned local fixtures created through supported domain/API paths.
- Exercise contract lifecycle and private attachment upload/download, cash session open/movement/transfer/close, payment-purpose display and idempotent reversal, and cross-agency denial from the browser.
- Save sanitized artifacts with request status, route, visible state and mutation result. No invented observations and no mutation of preserved fixtures.

### Deployment-readiness slice
- Configure provider sandboxes and signed webhook verification, then prove callback/refund/ledger reconciliation.
- Rehearse staging deploy, encrypted backup/restore, RTO/RPO, rollback and monitoring; run hosted CI with protected branches.
- Complete legal/tax/VAT, threat-model/privacy, accessibility, performance and pilot approval gates.

**Release rule:** remain exactly **Not ready** until every P0 gate has dated evidence. The route-access problem is currently resolved in the local runtime, but the product is not yet deployment-ready.

## Updated next phase after localization slice
1. Complete the remaining locale inventory (all admin/customer/mobile modules) and prove both Arabic RTL and French matrices.
2. Build a sanitized, explicitly owned browser-fixture harness for contract upload/download, cash open→movement/transfer→close, payment reversal retry and cross-agency denial. Preserve existing records and volumes.
3. Configure provider sandboxes and signed webhooks; test success, cancellation, timeout/manual review, refunds and ledger reconciliation.
4. Run staging deployment, backup/restore/RTO/RPO, rollback/monitoring and hosted CI/protected-branch rehearsals.
5. Close tax/legal, privacy/threat-model, accessibility, performance and pilot approval gates.

**Release rule remains:** exactly **Not ready** until every P0 gate has dated evidence.
