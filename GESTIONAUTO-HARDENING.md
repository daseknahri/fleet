# Gestion Auto — Hardening Program Register

**Program:** Systematic hardening pass over every tab/route of the SaaS (admin app, frontend app, backend API), executed in risk-ordered waves, evidenced with the repo's REA method (evidence from a live run + code, bounded slices, unknowns marked UNKNOWN, nothing claimed without dated evidence).
**Opened:** 2026-11-07 (owner order: "pass over each tab and harden all; use md files for follow-up; use REA").
**Status of the release:** Not ready. (unchanged by this program)
**Rules that bind every wave:** no commits / no push without the owner's explicit say (queue #11 decision is the owner's); never touch the connection line in `__scripts/run-p0-tests.ps1`; preserve Docker volumes/data; fixes are copied into the running containers + restart, never a recreate (D-14); synthetic fixtures only, cleaned by exact IDs; the P0 gate (`__scripts/run-p0-tests.ps1`, 8 suites / 41 tests) must be green after every slice; backend enforcement always wins over frontend hiding.

## How to read this register

- **Census** (Appendices A–C) = every tab/route found, with the roles that can reach it. Census method 2026-11-07: route tables read from `admin/src/App.tsx`, `frontend/src/App.tsx`, and all 23 backend route modules + their `*Routes.config.ts` path tables; cross-checked live (anonymous API sweep of 161 endpoints, HTTP smoke of both apps, container/process state) and against queue #12's action maps.
- **Status per row:** `NOT STARTED` (no pass in this program yet; earlier queue evidence is cited in the row where it exists) · `IN PROGRESS` (at least one dated hardening slice evidenced; full checklist not yet complete) · `HARDENED` (full checklist below passed with dated evidence) · `DEFECT FILED` (an H-### entry in the defect log is open against the row).
- A row is never marked HARDENED on code reading alone: it needs the live evidence items of the checklist.

## Per-tab hardening checklist (applied to every census row)

1. Agency scoping enforced on the server + cross-agency denial evidence (live or P0-suite).
2. Auth/session behaviour (anonymous wall, role gates, suspended/blacklisted/inactive handling).
3. Input validation on client **and** server (ids, pagination, payloads, files).
4. Error / empty / loading states; API errors must not leak internals.
5. fr/ar string parity + RTL rendering.
6. Axe / accessibility (0 violations target; manual label pass tracked separately).
7. Console errors on render and on primary actions.
8. Obvious performance (payload size, render cost, N+1 patterns).
9. Security headers / transport on the API calls the tab makes (helmet baseline verified at app level).
10. File-upload handling where present (auth, agency gate, extension + content validation, size limit, safe storage path, ownership on delete).

## Wave plan (risk-ordered)

| Wave | Scope | Status |
|---|---|---|
| **1** | Auth/session surfaces (both apps), API error leakage, file-upload paths, unauthenticated-surface abuse controls, agency-scoping evidence completion | **EXECUTED 2026-11-07** (slices A–C below) |
| 2 | Money-adjacent tabs deep pass: Payments, Caisse, Approbations, Reports/exports | **EXECUTED 2026-11-07** (record below; D-1/D-2/D-3 re-evidenced and filed for the owner's decisions — not implemented, per wave scope) |
| 3 | CRUD tabs: Cars, Locations, Countries, Clients, Bookings, Scheduler (incl. D-4 checkout guest-validation, D-5 Booking RHF) | **EXECUTED 2026-11-07** (record below; D-4 implemented client+server; D-5 evidence refreshed — redesign, not implemented; D-3 re-evidenced, still the owner's call) |
| 4 | Platform/admin tabs: Suppliers, Users, Team, Bank Details, Settings, Pricing, Dashboard widgets | **EXECUTED 2026-11-07** (record below; H-022…H-026 fixed; census rows stay IN PROGRESS pending the Wave-5 Arabic pass) |
| 5 | Cross-cutting: fr/ar parity + RTL sweep, axe + manual label pass (B4 residual: contractWorkspace 3, approbations 2, cashJournal 1, reports 1, maintenance 1 unlabelled controls), perf re-check, D-10 residuals | **EXECUTED 2026-11-07** (record below; H-012 + H-021 FIXED, H-030 FIXED, H-031/H-032 filed Info; axe 0 on every walked surface) |
| 6 | Residuals & external-proof items: D-13 Stripe live proof (needs test key), mobile app pass (needs a device), H-005/H-006/H-007 design items | **EXECUTED 2026-11-07** (record below; H-005/H-006/H-007 FIXED with live evidence; D-13 + mobile pass remain external gates) |

## Wave 1 execution record — 2026-11-07

**Census verification (live):** anonymous sweep of 161 of 165 API endpoints (4 payment-gateway POSTs excluded — code-verified only, no external calls made): **all 131 protected endpoints returned 403 to anonymous callers, zero anomalies**; the 30 public endpoints behaved per design (storefront reads 200/204, validation 400, capability checks 403). Helmet header set verified live on the API (CSP, HSTS, nosniff, frameguard SAMEORIGIN, no X-Powered-By). Both SPAs serve HTTP 200. Backend route census: **165 endpoints** across 23 modules.

**Slice A — H-001 API error leakage (FIXED).** 100 occurrences of `res.status(400).send(i18n.t('ERROR') + err)` in 11 legacy controllers + 1 bare `res.status(400).send(err)` (userController.sendEmail) replaced with the generic `res.status(400).send(i18n.t('ERROR'))` — the exact pattern the GA-era controllers already use; full errors remain in server logs (every site logs before sending). Deliberate domain messages (`409` + coded `err.message` in checkout/payment flows) were verified intentional and left untouched.
*Evidence:* pre-fix live probe — `GET /api/check-token/...` with an invalid id returned `Internal Error: BSONError: input must be a 24 character hex string...` to an unauthenticated caller; post-fix the same probes return the bare generic string. **P0 gate after slice: 8 suites / 41 tests PASS (P0_EXIT=0).**

**Slice B — H-002 unbounded uploads + H-003 missing API error handler (FIXED).** All 10 multer definitions without a size limit (userRoutes ×4: avatar ×2, license ×2; carRoutes ×2; locationRoutes ×2; supplierRoutes ×2) now carry `limits: { fileSize: 10 * 1024 * 1024 }` (the two GA upload routes already had 5 MB). `backend/src/app.ts` gained: a JSON 404 for unmatched `/api/*` paths, and a final error middleware — multer errors and body-parser failures → generic 400, anything else → generic 500, always logged server-side, registered after the Sentry handler so Sentry still captures first.
*Evidence:* pre-fix — malformed JSON and unknown API paths returned Express HTML error pages; an 11 MB upload was buffered unbounded (code). Post-fix live probes: malformed JSON → 400 generic body; unknown path → 404 `{"message":"Not found"}`; 11 MB `create-license` upload → 400 generic (rejected by multer before the controller; no file written); small invalid-type upload → normal validation 400. **P0 gate after slices B+C: 8 suites / 41 tests PASS (P0_EXIT=0).**

**Slice C — H-004 public mail endpoint had no rate limit (FIXED).** `POST /api/send-email` (contact-form mail) was unauthenticated and unthrottled with a fully caller-controlled recipient; its only gate is an Origin allowlist (a second layer behind the CORS allowlist — both are header checks, not authentication). `middlewares/rateLimiter.ts` was refactored into a scope factory: the existing auth limiter keeps its exact Redis key layout (`ratelimit:auth:<ip>`) and behaviour; a new `mailRateLimiter` (scope `mail`) now guards `send-email` in its own bucket so mail abuse cannot drain the sign-in bucket of the same IP.
*Evidence:* live burst of 115 send-email attempts (all failing the Origin check before any mail could be sent — no mail was sent in this program): exactly 100 × 400 (the container runs `BC_RATE_LIMIT_CAPACITY=100`), then 429 from request #101; a sign-in attempt immediately after was unaffected (bucket independence). *Residual:* a determined multi-IP sender is still possible; CAPTCHA or authenticated sending is a product decision (Wave 6).

**Not fixed in Wave 1 (filed below with evidence):** H-005 … H-009.

## Wave 2 execution record — 2026-11-07

**Method:** fresh synthetic actor set with real sign-ins against the live stack (agency A owner + Manager/Accountant/CounterAgent/ReadOnly staff + agency B owner + platform admin + one customer per agency; suffix-tagged, cleaned by exact IDs at wave close). 92 API checks + browser REA on the BookCars test Chrome (isolated context): the four admin tabs signed in as the agency owner (fr), axe runs on all four, frontend bookings/booking as agency A's customer. Baseline P0 before any change: **8 suites / 41 tests PASS**; same after the wave's fixes.

**Per-tab outcomes (live evidence this wave):**
- **Payments (admin tab + rental-payments API):** scoping and cross-agency denial proven live (list isolation; cross-agency confirm 403 through the pinned-selector middleware; cross-agency create on an A booking 404 from the ledger). Decision-1.5 flow re-proven: counter records pending, counter self-confirm 403, accountant confirms, double-confirm 409; ReadOnly reads but cannot record (403). Validation battery: 6 invalid payloads all 400. Ledger guards proven against a snapshot booking: rent capped at the snapshot rentalTotal and deposits at depositAmount (over-cap → 400 `OVERPAYMENT`; a deposit on a snapshot-less booking is rejected, allowance 0); idempotent replay returns the original payment, same key with a different amount → 409. Reversal annulment semantics re-verified (pair nets 0 in reports; the debit stays list-visible with `reversedFrom`). UI (fr): renders with coherent header totals on the fixture set (14.977 MAD posted-credit net of the reversed original, 8 transactions), **zero confirm controls anywhere on the page (D-1)**, 0 console errors. Axe: 1 violation — **H-012 filed**.
- **Caisse (admin tab + cash API):** role gates live — counter cannot open or confirm (ManageCash) but records pending movements (RecordCash); duplicate open session 409; cross-agency movements read 404 and cross-agency confirm 404; transfer balance cap 409 and idempotent replay does not double-post. Close-out coherence to the centime: session closed with expected = counted = 1,150 MAD and discrepancy 0, the still-pending movement correctly excluded from the expected balance while the confirmed movement (+250) and transfer (−100) counted. UI (fr): open session and balances render, **zero confirm controls (D-1)**, 0 console errors, axe 0.
- **Approbations (+ Invoices):** producer and blocking gate re-proven end to end — issue at/above 10,000 MAD opens a pending request; linking a payment is 409 while pending and 409 after rejection; decide gates: accountant 403 (no DecideInvoices), requester 403 (decision 1.4), cross-agency decide 404; invoice numbering `GA-2026-…`; duplicate active invoice 409; cross-agency invoice create 404; manual requests work with duplicate-pending 409. UI (fr): the queue renders including decided items — and visibly shows the **H-010** self-decided charge with the same user as requester and decider; 2 resource-403 console errors (resource not identified — Wave 5 to pin down); axe 0.
- **Reports + CSV export:** totals reconciled exactly against a hand-computed ledger over a 5-booking / 8-payment fixture day using Casablanca date-only ranges: revenueCollected 12,200; depositsCollected 2,000; expenses 300; receivable 135,300; invoicedTotal 47,000, invoicedPaid 12,000, invoiceCount 3; estimatedMargin 11,900 — pending and annulled amounts correctly excluded, a backdated payment lands only in its own day's range, invalid ranges 400. CSV carries the identical figures (MAD, metric dictionary 2026-11-02.1). Denied for counter, customer and anonymous callers (403); agency B's summary contains only B (contracts 1, receivable 3,000). UI (fr) renders the same figures (12.200 / 2.000 / 135.300 / 300 / 11.900 MAD). Utilization differs by window by design (API today-only 500% vs UI month-to-date default 214.29%) — explained variance under the metric dictionary, not a defect.
- **Frontend money surfaces (Bookings list + Booking detail):** customer reads own booking with its price (other-customer and anonymous reads 403); the list endpoint is driver-scoped on the server — a customer naming another supplier receives only their own bookings; the detail page loads the customer's own booking. The UI list itself could not be exercised with these fixtures: synthetic suppliers do not appear in the public `/api/all-suppliers` list (the 4 seeded suppliers do), so the filter can never select them — list rendering with data rests on queue #12 evidence; Wave 3 owns the Bookings tab.

**Fixes (each: source fix → P0 gate → build + `docker cp` + restart):**
- **H-008 FIXED** — supplier-commercial field gating in `userController.update` (see defect log).
- **H-011 FIXED** — malformed-id 500s on the pinned-selector middlewares (see defect log).

**Filed this wave:** H-010 (charge self-decision vs the P0-encoded review flow — owner's call; a fix was implemented, turned the gate 40/41, and was reverted the same day), H-012 (Payments axe colour-contrast). D-1/D-2/D-3 evidence refreshed in the carried-backlog table. **Remaining checklist gap for these tabs:** the Arabic live pass — fr is proven this wave; ar rests on queue #12 B4 for unchanged UI (a localStorage language switch did not take in this walk; see D-10). Rows therefore stay IN PROGRESS, with Payments and Approbations additionally DEFECT FILED (H-012 / H-010).

## Wave 3 execution record — 2026-11-07

**Method:** fresh synthetic actor set with real sign-ins against the live stack (agency A owner + Manager/Accountant/CounterAgent/ReadOnly staff + agency B owner + platform admin + one customer per agency; suffix `w3-mw6102ze`; real country/location chains with en/fr values; supplier avatars set so the public supplier list carries the fixtures — the Wave-2 caveat root-caused: `getAllSuppliers` matches `avatar: { $ne: null }`). ~250 API checks across six probe batteries + browser REA on the BookCars test Chrome (isolated contexts, fr): the six admin tabs as owner, staff countries/clients views, the deferred frontend Bookings UI pass, and guest + signed-in checkouts end-to-end. Baseline P0 before any change: **8 suites / 41 tests PASS**; same after the fix cycle and at wave close. Fixes deployed the standing way (build → `docker cp` → restart; no container recreated). Fixtures cleaned at close by exact IDs + supplier-scope sweep (deleted: 16 users, 19 bookings, 7 countries, 6 locations, 6 cars, 42 location values, 1 orphaned payment, memberships/notifications; verification counts all 0).

- **Cars:** list isolation + server-side supplier override proven; create validation battery all 400 (missing name, negative dailyPrice, minimumAge 12, empty locations, nonexistent image); B-location create/update 400 (`validateLocationsForSupplier`); uploads proven (valid PNG 200, .txt 400, 11 MB 400 — the H-002 limit live on this surface); cross-agency update 403; delete with booking history 409, without 200, malformed id 400; pagination edges 400 (page/size 0, −1, non-numeric) with size=100000 accepted (perf observation only); partial (name-only) update → 404 — the update contract is the full form. H-017 fixed.
- **Locations:** list is a public shared catalogue by design; writes agency-stamped; check-location/validate agency-scoped; cross-agency delete 403 (controller check); delete unknown 204, malformed 400; staff update of an own-agency location 200 (cross-agency 403). H-013/H-015/H-016 fixed. D-3 re-evidenced (see backlog row) — no behaviour change.
- **Countries:** shared catalogue with supplier join by design; create stamps own agency; owner update/delete proven; staff were locked out of every `:id` operation (H-014, fixed — the pin the B3 sweep applied to car/location routes); cross-agency update/delete still 403 at the controller after the fix; by-id READ is open to any signed-in agency (consistent with the shared-catalogue list; recorded, not a defect). UI note: the admin UpdateCountry page itself gates non-owner staff out in page code — page design, unchanged.
- **Clients:** create returns plain-text "OK" (no id — API wart, recorded); type-escalation creates 403; duplicate/invalid payloads 400; cross-agency delete 403 all-or-nothing; the tab was empty for every agency user (H-018, fixed — ObjectId-cast family with H-015); admin unaffected. H-019 filed for the owner (client deletion orphans RentalPayments).
- **Bookings (admin):** create battery fully correct (agency/car/location scope, date order, negative price, payment-status-on-create, bogus status, non-customer driver — all 400); customers are platform-global as drivers (agency B's customer can drive an A booking — design note); overlap allowed unless the car is `blockOnPay`, then conflict 400; update-status rules hold (paid jump 400, bogus 400 + unchanged, cross-agency silent no-op); cancel-booking only sets `cancelRequest` when the booking carries the cancellation option; H-020 fixed (snapshot-less bookings were permanently uneditable; the checkout-terms lock still 409s real checkout bookings on term changes — proven both ways).
- **Scheduler/Calendar:** month grid renders (fr); its data path (`getBookings` with `filter.dateBetween`, day-overlap semantics) proven at API level including boundary days; axe findings filed to the Wave-5 sweep (H-021).
- **Checkout (D-4 — IMPLEMENTED):** server now rejects new-guest checkouts with missing name/phone/birthDate and underage drivers (400, nothing persisted; pre-fix all three gaps were accepted with 200); the existing-account email path is unchanged; guests with no/empty email already 400'd pre-fix (probed — no arbitrary-account attachment). Client: guest-required schema variant + `noValidate` — pre-fix, the only empty-field enforcement was native browser bubbles over an all-optional zod schema (live-proven); post-fix, an empty guest submit shows in-app localized errors (axe 0 on the surface), and a signed-in customer's pay-on-site checkout still completes end-to-end (live-proven, confirmation rendered).
- **Frontend Bookings/Booking (D-5 — evidence refreshed, NOT implemented):** the deferred UI pass is complete — the supplier filter lists the fixture supplier, the customer's booking renders in the list, and the detail page renders its dates/status. `Booking.tsx` remains a legacy useState form (`edit = false` hardcoded) functioning as the detail view; the register scopes D-5 as a redesign, so no migration was attempted this wave.
- **Also filed:** H-021 (axe on the W3 surfaces → Wave 5 sweep) and H-022 (admin shell's `GET /api/bank-details` 403s for staff on every page → Wave 4 surface).

**Fixed this wave:** H-013, H-014, H-015, H-016, H-017, H-018, H-020 — each re-probed live post-fix; P0 41/41 after the fix cycle and at close. **Filed:** H-019 (owner decision), H-021 (Wave 5), H-022 (Wave 4). **Remaining checklist gap for these tabs:** the Arabic live pass (Wave 5) — fr is proven this wave; rows therefore stay IN PROGRESS.

## Wave 4 execution record — 2026-11-07

Platform/admin tabs deep pass. Fresh synthetic actor set (tag `w4mw643dk4`): platform admin (pre-existing dev account), agency A owner + Manager/Accountant/CounterAgent/ReadOnly/Mechanic staff, agency B owner + Manager/CounterAgent staff, two platform customers, plus stamped clients and throwaway suppliers C/D created and deleted inside the probes. All sign-ins real; browser evidence in the BookCars test Chrome (CDP 9229), admin app, fr (owner/staff) + ar (admin profile) renderings. P0 gate 41/41 after every slice and at close. All fixtures cleaned by exact IDs/tag at close (users 20, memberships 11, bookings 5, cars 3, locations 4 + 8 name values, countries 6, 1 bank-details record); post-cleanup counts equal wave-start (User 10, AgencyMembership 0, BankDetails 0, Setting 1, Booking 15, Car 10) and a full-collection tag scan finds no residue. Settings values snapshotted and restored after every battery.

- **Team (slice 1, 52 checks T01–T52):** cross-agency list/create/update all 403; validation 400s (owner/bogus role, short/missing password, bad email); conflicts 409 (duplicate email, active-elsewhere link); customer-type link 404; platform admin can create/update memberships (by design — matches the Team page admin agency picker); suspend → token validation 403, reactivate → access restored. Member-read is Owner/Manager-only by explicit `requireAgencyMemberRead` design (Counter/ReadOnly 403s are correct, with a designed denial UX in the page — verified in browser). **H-023 FIXED** (reactivation double-active lockout).
- **Suppliers (slice 2):** read matrix correct (`getSupplier`: admin/self/staff-with-ReadAgencyProfile; Counter/ReadOnly 403 by permission design). Admin list returns the 4 seeded suppliers (avatar rule: avatar-less fixture owners absent from list surfaces, consistent with W2/W3). `admin-suppliers` is admin-gated, 400 on empty body, and effectively UI-unused (only commented-out calls in Cars.tsx) — its full-filter payloads returned 0 rows; filter semantics not UI-exercised, recorded with that caveat. `validate-supplier`: taken 204 / free 200 / customer+anon 403. Update/delete matrices clean; admin blacklist of B persisted and killed ownerB's session (401), restored after. **H-024 FIXED** (delete cascade orphaned memberships). Info: H-027 (unconditional `blacklisted` assignment, not exploitable as gated). Census verified: `GET /api/suppliers/:page/:size` is a GET route (Appendix C already correct).
- **Users (slice 3):** `getUsers` requires a `types` body ({} → 400). Admin list: no password fields anywhere; cross-agency keyword searches return 0 rows; customer/anon 403; page=0 → 400 generic; size=100000 → 200 (no page-size cap — perf observation, consistent with W3). Create negatives all correct (customer caller 403, owner→supplier/staff type 403, foreign supplier stamp 403, bogus type 400, duplicate/invalid email 400). Update is POST (PUT → 404 via the H-003 handler): authorized writers succeed (admin, self, owner, Manager/CounterAgent with ManageClients); non-admin type changes silently ignored; admin→staff type change 403. CounterAgent blacklisting an agency client succeeds **by design** (H-008-era gate). **H-008 recheck: no regression** (a client's `payLater=true` was the model default at creation; DB before/after identical). **H-025 FIXED** (non-atomic delete-users).
- **Bank Details (slice 4, B01–B26 + browser):** anon/customer/staff GET → 403 (the staff 403 is the correct backend half of H-022); owner/admin GET → 200. Upsert denied for owner/staff/anon (403) with no side effects; admin create/update round-trips field-exact (compared in-script only — values never printed). Unknown well-formed `_id` creates a fresh singleton; malformed `_id` → 400, record unchanged. Empty-field and fields-omitted upserts → 400 (Mongoose required-field validation) — the missing-validation hypothesis was disproven. IBAN/SWIFT *format* is not validated server-side beyond presence (admin-only write — observation). Browser: owner page renders the 4-field form against the synthetic record; **H-022 FIXED** at the shell layer (see defect log).
- **Settings (slice 5 + browser):** GET public by design; PUT denied for anon/customer/owner/staff (403); admin round-trip exact; model range validation solid. **H-026 FIXED** (partial-PUT default reset + inverted window). Info: H-028 (no max / fractional hours; the two min-hours settings are frontend-consumed only). Browser: admin settings render all forms; staff see no admin forms.
- **Dashboard (slice 6):** dedicated fixture set (agency A: 2 cars 1 available; bookings active/upcoming/past/cancelled; agency B: 1 car, 1 upcoming). UI metrics match hand-computed expectations **exactly** for owner A and Manager A (1/2 cars, 1 on-rent, upcoming 2→1 live after cancelling one booking — the cancelled exclusion proven in the UI, 4 total) and for the platform admin (5/7, 3, 3, 10) against an API replication over the public supplier set (fixture owners absent from that set — the known avatar rule). Staff pinning proven at API level: Manager A's dashboard call carries the staff user's own id yet returns agency A's set; owner B naming agency A receives only B's set. Code observations: the page aggregates client-side with a 1,000-row cap (cap itself not live-tested); `formatDate` uses the browser-local timezone with no explicit `timeZone`.
- **Pricing (slice 6):** static page — renders 3 plans for owner and for ReadOnly staff in browser, clean console post-H-022, strings spot-checked (fr). `priceChangeRate` persistence round-trip via update-supplier proven (unset → 7.5 → restored); staff write attempt 403. Info: H-029 (negative rate accepted).
- **Axe:** W4 surfaces run in both passes; findings filed into the H-021 Wave-5 bucket (see its addendum). No axe regression from the H-022 change (identical profiles before/after).

**Deploy lesson (recorded for future waves):** backend fixes deploy as host `tsc --build` → **babel transform of the changed file** (babel rewrites the `:bookcars-types` alias) → `docker cp` → container restart. Deploying a raw tsc emit crashed the backend once this wave (2026-11-07 ~08:10, `ERR_MODULE_NOT_FOUND ':bookcars-types'`, dev stack only) — recovered by redeploying the babel-transformed file; P0 green after. Admin fixes deploy as host `npm run build` → `docker cp admin/build/.` into the admin container's nginx html dir → restart (no container recreation anywhere, per the binding rules).

**Fixed this wave:** H-022, H-023, H-024, H-025, H-026 — each re-probed live post-fix; P0 41/41 after every fix cycle and at close. **Filed:** H-027, H-028, H-029 (Info observations), H-021 addendum (Wave-5 axe bucket). **Remaining checklist gap for these tabs:** the Arabic live pass (Wave 5) — fr proven this wave (admin profile rendered ar in the walks, but the per-tab ar checklist pass is Wave 5's); rows therefore stay IN PROGRESS.

## Wave 5 execution record — 2026-11-07

Cross-cutting wave: Arabic/RTL parity pass over every tab covered in Waves 2–4, the program-wide axe sweep (H-012 + H-021), and the Approbations console-error resolution. Fresh synthetic actor set (tag `w5-mw6gmgio`): agency A owner + Manager + CounterAgent staff, agency B owner, platform admin, two customers — every actor record carries `language: 'ar'`, because a signed-in user's stored language overrides the UI switcher (the root cause of Wave 2's failed language switch; precedence is by design). All sign-ins real; browser evidence in the BookCars test Chrome (CDP 9229), isolated contexts, 1440×900, both apps in Arabic with `dir=rtl`. A content-prep pass seeded the money surfaces through the real API (invoice + spawned approval request, recorded/confirmed rental payments, an open cash session with a confirmed movement, synthetic bank details with the page enabled). P0 gate 41/41 at baseline, after every slice, and at close. All fixtures cleaned by exact IDs at close; post-cleanup counts equal wave-start (User 10, AgencyMembership 0, BankDetails 0, Setting 1, Booking 15, Car 10) and a full-collection suffix scan finds no residue.

- **Static string parity (all 96 locale modules, both apps):** fr↔ar key parity is COMPLETE — zero missing ar keys anywhere; the only untranslated ar values are brand names (Android Auto / Apple CarPlay), correctly kept. Frontend `sign-up.ts` carries 9 harmless extra ar keys. One out-of-scope gap recorded as H-032: the Spanish locale misses 22 keys in admin `cash-journal.ts`. Rendered fallbacks therefore had to come from hardcoded component strings — the live walks below are the parity evidence.
- **Arabic live pass (28 admin pages + frontend set):** every page rendered `dir=rtl` with Arabic-dominant text, ar-MA dates (e.g. «7 نونبر 2026»), MAD amounts localized, zero console errors and zero HTTP errors on the final pass. The location without an Arabic name (fixture) fell back to its French name value — the designed name-fallback chain, not a missing string. Numbers/dates/currency follow the app's existing ar behaviour (Intl ar-MA; Western digits, consistent with queue #12's A4 format work).
- **Scheduler chrome (D-10 residual) FIXED:** the vendored scheduler's toolbar/calendar strings were English in every non-English locale (its translation table has no ar/fr branches and `date-fns` was never localized). `VehicleScheduler.tsx` now supplies full Arabic and French translation branches plus the ar-MA/fr date-fns locales; live ar render shows «نونبر 2026», «اليوم / شهر / أسبوع / يوم» and Arabic weekday headers.
- **Approbations console errors — RESOLVED (scope item 3):** of the two error classes Wave 2 noted, one was the shell/bank-details 403 family already fixed as H-022 (not reproduced for any actor this wave) and the other was NOT H-022: the page's own requester-name lookup `GET /api/user/:id` 403'd for membership-linked staff — filed and FIXED as **H-030**, together with the page's unlocalized subject-type chip and the agency-name fallback for non-admin viewers. The remaining per-page 404 in early walks was the fixtures' own fake avatar filename (test data, eliminated by uploading real avatars through the API); one seeded user's avatar 404 on /users is a pre-existing seed-data artifact, not an app defect.
- **Axe sweep — H-012 + H-021 FIXED; final state ZERO violations on every walked surface** (admin 28 pages incl. both actors on the money pages; frontend home, search, checkout, bookings, booking detail, settings, notifications). Root causes fixed in source: icon-only filter inputs without labels (87 inputs across both apps' filter components), grids' empty action-column headers, missing `<main>` landmarks and page h1s (sr-only headings added), MUI `InputLabel`s without `htmlFor` (settings/bank-details forms), unlabelled Team selects and status checkboxes, avatar action boxes that were mouse-only divs (now keyboard-operable buttons with names), an icon-only scheduler search pair, and a family of sub-4.5:1 text colours (payments empty state + table heads, booking-status chips in both apps + the scheduler's status-colour helper, price captions, scheduler out-of-month day numbers, user-type chips). MUI chrome is localized for ar (core + data-grid `arSD`); the date-pickers package ships no Arabic locale in the pinned version — filed as H-031.
- **MUI locale note:** admin and frontend `main.tsx` now select the MUI locale by UI language (ar → `arSD` for material + data-grid). `@mui/x-date-pickers` contains no Arabic locale file at all in this version, so picker popups stay English in ar mode (H-031, Info) — the app's own date rendering is Intl-based and fully Arabic.

**Fixed this wave:** H-012, H-021, H-030 — each re-verified live post-fix (final walks: axe [] and console 0 on all surfaces); P0 41/41 after every slice and at close. **Filed:** H-031 (date-pickers ar locale absent upstream), H-032 (es parity gap in cash-journal, out of scope). **Rows marked HARDENED** where all 10 checklist points now carry dated evidence (see Appendices A/B); Approbations and Clients stay DEFECT FILED on the open owner decisions H-010 / H-019.

## Wave 6 execution record — 2026-11-07

Final wave: the three deferred Wave-1 design items, closed design-first with live evidence, plus the H-031 owner-decision note. Method: two synthetic users created through the real API (a self-signup target left unverified and an email-confirmed caller; tag `mw7k4qz2`), mail captured in the stack's mailpit sink, HTTP probes with full Host-header control, and a throwaway host instance of the same build for the one proof the running stack cannot serve (a new env var cannot be added to the backend container without a recreate — D-14; the instance ran the same build against the same DB and was stopped after the proof). Baseline P0 before any change: **8 suites / 41 tests PASS**; the same after every slice and at close. All fixtures cleaned by exact IDs at close (2 users, 4 activation tokens, 2 revoked-session entries, 4 captured mails); post-cleanup counts equal wave-start (User 10, Token 10, AgencyMembership 0, BankDetails 0, Setting 1, Booking 15, Car 10, RevokedSession 0) and a tag scan finds no residue. The backend census grows by one endpoint (166 total): the H-005 POST variant.

- **H-006 FIXED (slice 1)** — see defect log. The defect existed at two sites (`_signup` and `resendLink`); both now build the emailed confirm link from the configured `BC_API_HOST` only, failing safe when it is unset. Live-proven in both configurations (unconfigured running stack: 400 / no token / no mail on resend, sign-up not persisted; configured instance: working link on the configured base under a spoofed Host).
- **H-005 FIXED, legacy GET deprecated (slice 2)** — see defect log. `POST /api/check-password/:id` added; admin + frontend services migrated and their rebuilt bundles deployed; 12-case parity battery POST ≡ GET; the change-password flow driven end-to-end through the POST variant. The GET route stays, marked deprecated in code and here, with the residual risk stated for the owner's removal decision.
- **H-007 FIXED (slice 3)** — design recorded here before implementation: (1) every JWT gains a per-session `sid` (nanoid, per issuance) and the issuing user's `tokenVersion` as `tv`; (2) a new `RevokedSession` collection is the sign-out denylist (unique sid index; TTL index on `expireAt` = the token's exp, or +400 days for stay-connected tokens, matching the cookie cap); (3) `verifyToken` / `verifyTokenOptional` reject a listed sid or a `tv` mismatch right after the existing blacklist check; (4) sign-out resolves the presented token exactly as `verifyToken` does and records its sid — current session only, other sessions and global behaviour unchanged; (5) a password change (`changePassword`, and `activate` as the activation/email-reset completion) bumps `tokenVersion`, revoking every earlier session; (6) claim-less legacy tokens read as tv 0 with no sid, so they stay valid until the user's first post-deploy password change — the deploy itself forces no global logout. Implemented exactly so; live proof matrix in the defect log. One either/or was deliberately NOT decided (defect log): whether sign-out should also revoke all of the user's other sessions.
- **H-031 owner-decision note added** (defect log): options (a) upgrade the date-pickers library, (b) hand-write an ar picker locale, (c) accept English picker popups — recommendation (c) for now; no library change made.

**Fixed this wave:** H-005, H-006, H-007 — each re-verified live post-fix; P0 41/41 at baseline, after every slice, and at close. **The hardening program is complete.** Every census row is HARDENED except Approbations and Clients, which stay DEFECT FILED on the open owner decisions H-010 / H-019. Everything that remains is an owner decision or an external gate (checkpoint GA-HARDENING-W6-01 carries the remainder list).

## Defect log

| ID | Severity | Surface / tab | Defect | Status |
|---|---|---|---|---|
| H-001 | Medium | Backend API (11 controllers) | Error responses concatenated raw error objects (`i18n.t('ERROR') + err`), leaking BSON/Mongoose/driver internals to any caller who can trigger a 400. Live-confirmed unauthenticated via `/api/check-token`. | **FIXED 2026-11-07** (Slice A; P0 41/41) |
| H-002 | High | Backend upload routes (10 multer definitions, incl. anonymous `POST /api/create-license`) | `multer.memoryStorage()` with **no file-size limit**: multipart bodies buffered fully in process memory → memory-exhaustion DoS; the anonymous license upload is internet-facing in production. GA routes (contract files, receipts) already had 5 MB limits — legacy routes had none. | **FIXED 2026-11-07** (Slice B: uniform 10 MB; 11 MB live probe rejected pre-controller; P0 41/41) |
| H-003 | Medium | Backend app level | No global Express error handler and no API 404 handler: multer/body-parser/unexpected errors and unknown `/api/*` paths fell through to the default HTML error page (stack traces when NODE_ENV ≠ production). | **FIXED 2026-11-07** (Slice B: JSON 404 + generic error middleware; live-verified; P0 41/41) |
| H-004 | Medium | `POST /api/send-email` (Contact tabs) | Unauthenticated, unthrottled mail sending with caller-controlled recipient/subject/body; only an Origin header allowlist (spoofable by non-browser clients). | **FIXED 2026-11-07** (Slice C: dedicated `mail` rate-limit bucket; live burst-verified; residual multi-IP/CAPTCHA note in Wave 6) |
| H-005 | Medium | `GET /api/check-password/:id/:password` (Settings / ChangePassword flows) | A credential travels in the URL path → lands in server/proxy logs and browser history. Endpoint is authenticated and relationship-checked (self / platform admin / owning supplier), so exposure is log-side, not access-side. Proper fix = move to a POST body, which changes the API contract for admin, frontend **and the mobile app (untestable — no device)**. | **FIXED 2026-11-07 (Wave 6)** — `POST /api/check-password/:id` added (password in the JSON body) and admin + frontend `UserService.checkPassword` migrated to it (built bundles verified to carry the POST call; the old two-segment URL is gone). One shared controller serves both variants: a 12-case live battery shows POST ≡ GET on every case (self ok 200 / wrong 204, cross-user 403, malformed id 400, unknown id 403, empty body 400, anonymous 403), and the full change-password flow was driven end-to-end through the POST variant (check → change → check new 200 / old 204 → sign-in with the new password → change back). The legacy GET route is **DEPRECATED, not removed**: codebase proof shows the only in-repo callers were the two web services (the mobile source has no caller and no password screen at all; git history and the packages tree are likewise clean), but shipped mobile binaries / unknown API consumers cannot be audited — the log/history exposure persists for any remaining GET caller until the owner approves removal. |

| H-006 | Low | `POST /api/resend-link` (Activate flow) | The emailed activation link is built from `req.headers.host` (Host-header injection class). Mitigants: requires an authenticated session and the mail goes to the account's own address; the sibling `resend` flow correctly builds from configured hosts. Fix needs a configured public API base URL (deployment-specific). | **FIXED 2026-11-07 (Wave 6)** — both Host-header link sites (`_signup` and `resendLink` — the same pattern existed in both) now build the confirm-email link from the configured API base URL only: new optional `BC_API_HOST` (`env.API_HOST`), joined via `helper.joinURL`; there is no Host fallback. Pre-fix live proof: a sign-up and an authenticated resend-link, each sent with `Host: evil.w6test.invalid`, each produced a mailpit-captured activation email whose link was built verbatim on the spoofed host. Post-fix: the running stack (no `BC_API_HOST` — it cannot be added without a container recreate, D-14) fails safe — resend-link → 400 generic with no token created and no mail; sign-up follows the existing mail-failure path (user not persisted, no mail). A configured instance of the same build (`BC_API_HOST=http://127.0.0.1:4003`, throwaway host process) issued a working confirm link on the configured base under the same spoofed Host (link followed → account verified, 200). Deployment note: set `BC_API_HOST` at the next image rebuild (D-14); until a deployment sets it, that deployment sends no confirm link rather than an unsafe one. |

| H-007 | Low | Session model (both apps) | Sign-out clears the cookie but the JWT itself is not revocable server-side (stateless); "stay connected" tokens carry no expiry (cookie capped at 400 days). Account blacklist and staff suspension/membership loss **do** revoke at `verifyToken`. Residual = stolen-token window. A token denylist is an architecture change. | **FIXED 2026-11-07 (Wave 6)** — revocation model implemented as designed in the Wave 6 record: every issued JWT now carries a per-session `sid` claim and the user's `tokenVersion` as a `tv` claim; sign-out records the presented session's `sid` in the new `RevokedSession` denylist (unique sid index; TTL = the token's own exp, or the 400-day stay-connected cookie cap); `verifyToken` and `verifyTokenOptional` reject a listed sid and any `tv` mismatch; `changePassword` and `activate` (activation / email-reset completion) bump `tokenVersion`, revoking every earlier session. Live-proven on both transports (x-access-token header and the signed web cookie): token works → sign-out → the SAME token is rejected 401, while a second session of the same user stays 200 (current-session-only revocation); sign-out with no/invalid token remains a 200 no-op; a password change revokes all prior tokens including a pre-H-007 legacy token (401), and sign-in with the new password works; claim-less legacy tokens stay valid while the version is unchanged (the deploy forced no global logout). Denylist state verified in DB (exactly the 2 proof sids; indexes as designed). **OWNER EITHER/OR (filed, not decided):** sign-out revokes the current session only (implemented); making sign-out revoke ALL of the user's sessions is a one-line change (also bump `tokenVersion` in sign-out) but forces re-login on every device — a product call. |

| H-008 | Low | `POST /api/update-user` (userController.update) | Supplier-commercial fields (`payLater`, `licenseRequired`, `minimumRentalDays`, `priceChangeRate`, `supplierCarLimit`, `notifyAdminOnNewCar`) are writable on any authorized target, including customer records. Verified inert there: checkout and pricing read these fields from the **supplier's** record only (e.g. `bookingController` checkout gate reads `supplier.payLater`). Mass-assignment hygiene tightening is a Wave-2 candidate; `blacklisted` and `type` are already correctly role-gated in the same function. | **FIXED 2026-11-07** (Wave 2: the six fields now apply only when the target account is a supplier AND the actor is the platform admin or that supplier themself — the existing `blacklisted` gate pattern. Live before/after probes: customer self-write and agency-manager write on a customer record were applied before — including a silent wipe of sibling fields to null — and are ignored after; legitimate flows intact (supplier self-update, admin→supplier update, customer phone update). P0 41/41 after the fix.) |
| H-009 | Info | Backend app level | `express.json` / `urlencoded` body limit is 50 MB — generous for this API's payloads. Multipart is now bounded by H-002; JSON remains the largest body surface. Lower only after a payload-size survey (bulk booking payloads) to avoid breaking legitimate flows. | FILED — Wave 5 survey |
| H-010 | Medium | `POST /api/contract-operations/:bookingId/charges/:chargeId/decide` (surfaces in the Approbations queue) | Charge decide does not enforce decision 1.4's requester≠decider rule that `approvalController.decide` enforces for queue items: a charge requester can approve their own ≥-threshold charge, and the decision mirrors onto the queue record. Live-proven 2026-11-07 — a manager created a 12,000 MAD charge and approved it; the Approbations UI shows the same user as requester and decider. A fix was implemented and reverted the same day: the P0 suite `contractEvidence.integration.test.ts` encodes same-actor charge review ("reviews charges") as a valid flow and the gate went 40/41 with the fix — the two evidences conflict, so whether decision 1.4 extends to charges is the owner's call (a fix must change code and suite together). | FILED 2026-11-07 — owner decision |
| H-011 | Low | Pinned-selector agency middlewares (`requirePaymentAgencyPermission`, `requireInvoiceAgencyPermission` in `middlewares/agencyAuth.ts`) | `findById` on a malformed `:id` threw a Mongoose CastError that surfaced as HTTP 500 (live 2026-11-07: payment confirm and invoice issue with id `notanid` → 500; well-formed unknown ids correctly returned 404). | **FIXED 2026-11-07** (Wave 2: `isValidObjectId` guard treats a malformed id as not found; live re-probe 404/404; P0 41/41) |
| H-012 | Low | Admin Payments tab (axe) | `color-contrast` (serious) on the empty-state paragraph `.agency-payments__empty > p`, from the Wave-2 axe run on the authenticated fr page (Caisse, Approbations, Reports: 0 violations in the same run). Queue #12's axe-0 sweep did not surface it — the element renders in the empty receivables state. | **FIXED 2026-11-07** (Wave 5: `.agency-payments__empty` colour #829194 → #5a6d71 — measured 3.27:1 → 5.39:1 on white; the same low-contrast family in the payments table-head spans (#63777b on #f8faf9, 4.49:1) darkened to the same value. Post-fix axe [] on every Payments view incl. the empty state for the agency-B owner; P0 41/41) |
| H-013 | Low | `POST /api/create-location` (Locations tab) | Image validation runs AFTER persistence: a traversal image (`../cars/<temp>`) is rejected 400 but the location and its name values are already saved — an orphaned location remains (car create deletes on failure; location create did not). Live-proven 2026-11-07 (response 400, record persisted). | **FIXED 2026-11-07** (Wave 3: the pure image validations — basename, source containment, extension — run before any persistence; re-probe: 400 and nothing persisted; P0 41/41) |
| H-014 | Medium | `countryRoutes.ts` `:id` routes (Countries tab) | Staff could not update/delete/get/check ANY country (403 "Insufficient agency permission" from `requireAgencyPermission`): `requestedSupplierId` treats `params.id` as a supplier candidate, and countryRoutes was the one `:id` family the queue-#12 B3 pin sweep missed (car/location routes carry `pinAgencySelector`). Owner + platform admin unaffected. Live-proven for a Manager (update/delete/get/check all 403). | **FIXED 2026-11-07** (Wave 3: `pinAgencySelector` added to the four `:id` country routes, mirroring locationRoutes; staff re-probe update 200 / get 200 / check 204 / delete 200; cross-agency update/delete still 403 at the controller; P0 41/41). Note: the admin UpdateCountry page additionally gates staff out in page code (`_user._id !== country.supplier._id` → NoMatch) — page-level design, unchanged by the API fix. |
| H-015 | Low | `validate-country` / `validate-location` (Countries + Locations tabs) | Duplicate-name validation silently never fires for agency users: the agency match helper puts the agencyId **string** into an aggregation `$match` against ObjectId `supplier` fields (aggregations do not cast), so the agency branch never matches and every name validates as "free" (200) — duplicates are creatable (one was created live, and it then shadowed the real location in the storefront autocomplete). Platform admin unaffected (empty match). | **FIXED 2026-11-07** (Wave 3: ObjectId cast in `agencyCountryMatch` / `agencyLocationMatch`; re-probe: own existing names → 204 for owner + Manager on both endpoints, free names still 200, the other agency's names still 200; P0 41/41) |
| H-016 | Low | `POST /api/create-country` / `POST /api/create-location` | `names: []` (or all-blank names) accepted → 200 with a name-less record persisted. Live-proven on both endpoints. | **FIXED 2026-11-07** (Wave 3: 400 unless at least one non-blank name; re-probed on both endpoints; P0 41/41) |
| H-017 | Low | `GET /api/check-car/:id` (Cars tab) | Cross-agency boolean oracle: any agency could learn whether another agency's car has bookings (200) — the sibling check-location / check-country endpoints are agency-scoped. Live-proven (agency B on agency A's booked car → 200). | **FIXED 2026-11-07** (Wave 3: non-admin callers get 204 unless the car belongs to their agency; re-probe: B → 204, owner → 200, admin → 200; P0 41/41) |
| H-018 | High | `POST /api/users/:page/:size` (Clients tab) | The Clients tab is EMPTY for every agency user: `getUsers` pushes the agencyId string into an aggregate `$match` (same root-cause family as H-015), so no customer ever matches — owner + staff lists return 0 rows while the platform admin sees all. Live-proven (API total 0; UI "Pas d'utilisateurs. 0–0 of 0"). | **FIXED 2026-11-07** (Wave 3: ObjectId cast in the getUsers supplier filter; re-probe: owner/Manager/Accountant lists contain the agency's customers, agency B's list stays isolated, admin unchanged; UI lists customers again; P0 41/41) |
| H-019 | Medium | `DELETE /api/delete-users` (Clients tab) | Deleting a client cascade-deletes their bookings (`Booking.deleteMany({ driver })`) but never touches `RentalPayment`: the payment remains listed in the agency's payments with its booking gone (live-proven with a pending payment; the code path is status-independent, so posted payments orphan identically). Whether client deletion should refuse with financial history, annul, or cascade is a money-data behaviour decision. | FILED 2026-11-07 — owner decision (no behaviour change made) |
| H-020 | High | `PUT /api/update-booking` (Bookings tab) | Every snapshot-less booking was uneditable: admin-created and legacy bookings have no `financialSnapshot`; Mongoose hydrates the missing subdocument as `{}` (truthy), so the checkout-terms lock always fired → permanent 409 "Checkout terms are locked". Live-proven (unchanged-terms update on an admin-created booking → 409; in-container model probe: hydrated snapshot = `{}`, `rentalTotal` undefined; the GET response strips the field, which masked it). | **FIXED 2026-11-07** (Wave 3: the lock applies only when a real snapshot with a numeric `rentalTotal` exists; re-probe: snapshot-less updates 200 (unchanged / price / status), checkout bookings unchanged 200 and price change still 409; P0 41/41) |
| H-021 | Low | Axe — Wave-3 surfaces | Axe runs from the W3 walks: admin /cars `label` 42 nodes (critical) + `color-contrast` 4 + `aria-prohibited-attr` 4 + `button-name` 1 (shell, every admin page); /scheduler `color-contrast` 6 + `region` 44; frontend /bookings `color-contrast` 41 + `label` 13; /booking `color-contrast` 1. Checkout scored 0 violations after the D-4 fix. | FILED 2026-11-07 — Wave 5 axe sweep (joins H-012). **W4 addendum 2026-11-07:** /team `aria-input-field-name` 14 (serious) + `color-contrast` 4; /bank-details `label` 4 (critical); /users `button-name` 1 (critical) + `image-alt` 1 (critical) + `empty-table-header` 1 + `image-redundant-alt` 4 + `region` 13; /suppliers `button-name` 1 + `region` 6; /settings `aria-prohibited-attr` 1 + `label` 13 + `region` 18; structural `landmark-one-main` / `page-has-heading-one` on multiple pages. Owner dashboard render scored 0. Axe profiles identical before/after the H-022 fix (no regression). | **FIXED 2026-11-07 (Wave 5)** — every item closed in source and re-verified live: filter/search inputs labelled (transform-verified counts: 42 car-filter inputs on /cars, both apps' filter twins, scheduler search pair), Team selects + status checkboxes labelled, settings/bank-details `InputLabel`↔`htmlFor` pairing, avatar action boxes made keyboard-operable named buttons, grid action columns given accessible headers, `<main>` landmark + sr-only h1s added across the legacy pages, contrast family darkened to ≥4.5:1 (booking-status chips both apps + scheduler colour helper, price captions, scheduler day numbers, user-type chips, payments heads). Final evidence: axe [] on all 28 admin pages and all 7 frontend surfaces, console 0; P0 41/41. |
| H-022 | Low | Admin shell (all tabs) | The admin shell fires `GET /api/bank-details` on page load for staff roles that lack banking permission → one 403 console error on every admin page (observed as Manager on /countries, 2026-11-07; also present in the W3 walks). Console hygiene + a wasted request; no data exposure (the endpoint correctly 403s). | **FIXED 2026-11-07** (Wave 4: `Header.tsx` fetches bank details only for Admin/Supplier-type users — the roles the endpoint admits — and `Settings.tsx` only for platform admins, matching the form's render gate; backend behaviour unchanged. Live before/after in the test Chrome: staff BEFORE = 403 + console error + uncaught promise on dashboard/countries/pricing/team, ×2 on /settings (shell + page); AFTER = zero HTTP errors, zero console errors, zero exceptions for Manager/ReadOnly on every walked page; owner + admin bank behaviour unchanged (owner form renders, admin settings unchanged); axe profiles identical before/after; P0 41/41) |
| H-023 | Low | `PUT /api/agency-memberships/:supplierId/:membershipId` (Team tab) | Membership **reactivation** skipped the single-active-agency check that create enforces: reactivating a suspended membership while the staff user was active in another agency produced a double-active state that `verifyToken` rejects — the staff account was locked out of every agency (fail-closed, no data exposure). Live-proven T47–T51. | **FIXED 2026-11-07** (Wave 4: on status→active (when not already active) `agencyMembershipController.update` returns the same 409 as create when an active membership exists elsewhere; reprobe R1–R9 all correct; P0 41/41) |
| H-024 | Low | `DELETE /api/delete-supplier/:id` (Suppliers tab) | The delete cascade predates agency memberships: deleting a supplier left orphaned `AgencyMembership` rows pointing at the gone agency (staff user doc remains, global by design). Live-proven (supplier C deleted → 1 orphaned membership). | **FIXED 2026-11-07** (Wave 4: cascade now `deleteMany` memberships by supplier; reprobe with throwaway supplier D: memberships 1 → 0, orphaned staff fails closed at token validation; P0 41/41) |
| H-025 | Low | `POST /api/delete-users` (Users tab) | `deleteUsers` was non-atomic: a mixed [own, foreign] id array returned 403 but the authorized prefix was already deleted (live-proven twice: U57, V28–V30). | **FIXED 2026-11-07** (Wave 4: a pre-validation pass over ALL ids with identical authorization semantics returns 403 before any deletion; per-user check kept as defence in depth. Reprobe R1–R10: mixed → 403 + nothing deleted, own-only → 200 + deleted, foreign-only → 403, malformed → 400, unknown-only → 200; P0 41/41) |
| H-026 | Low | `PUT /api/update-settings` (Settings tab) | A partial PUT silently reset every omitted setting to its model default (`{minPickupHours:9}` alone reset the other three), and an inverted pickup window (min 20 > max 6) persisted. Live-proven; originals snapshotted and restored after each battery run. | **FIXED 2026-11-07** (Wave 4: `settingController.updateSettings` assigns only fields actually sent and rejects `minPickupDropoffHour > maxPickupDropoffHour` with 400 before save; battery rerun: inverted → 400 with prior values intact, partial preserves omitted fields, empty payload = no change; P0 41/41) |
| H-027 | Info | `PUT /api/update-supplier` (Suppliers tab) | `supplierController.update` assigns `blacklisted = !!blacklisted` unconditionally (an omitted flag un-blacklists). Not exploitable as gated: callers need ManageAgencyProfile (staff roles do not hold it) and a blacklisted supplier cannot authenticate to call it. Recorded; no fix. | FILED 2026-11-07 — observation (Wave 4) |

| H-030 | Medium | `GET /api/user/:id` (Approbations tab) | The Approbations page resolves requester/decider display names via `UserService.getUser`, but `getUser` did not recognize **membership-linked staff**: agency staff hold no `user.supplier` field, so an agency owner's read of their own Manager returned 403 and the approvals queue fell back to an id fragment for exactly the person whose request the owner must decide (live-proven 2026-11-07 with a 12,000 MAD invoice approval). Sibling gap in the same controller: staff could not read their own agency's owner record. Page-side siblings: the subject-type chip rendered the raw enum (`invoice`) in every language, and non-admin viewers saw their agency as an id fragment (`supplierNames` was seeded only for platform admins). | **FIXED 2026-11-07** (Wave 5: `getUser` now admits a Supplier reading staff with an active membership in their own agency, and Staff reading their own agency's owner — projection unchanged; 10-case probe matrix all-pass: own staff 200 (was 403), staff→own owner 200, every cross-agency read still 403. Page: chip localized via new approvals strings (فاتورة / رسوم العقد), agency name seeded for owner and staff viewers. Live re-verification: both owner and Manager views render requester + agency names in Arabic, axe [], console 0; P0 41/41) |
| H-031 | Info | MUI X date-pickers (both apps) | `@mui/x-date-pickers` ships **no Arabic locale** in the pinned version (its locales directory has no ar file), so calendar popups render English while the rest of the UI is Arabic. Wave 5 wired the locales that exist (`arSD` for @mui/material and @mui/x-data-grid in both apps' `main.tsx`); the app's own dates use Intl ar-MA and are unaffected. Closing this needs a library upgrade or a hand-written picker locale — a dependency decision, not a string fix. | FILED 2026-11-07 — residual (Wave 5). **Owner-decision note added 2026-11-07 (Wave 6):** the options are (a) upgrade `@mui/x-date-pickers` to a release that ships an Arabic locale — a dependency change, after which every picker surface needs a re-test; (b) hand-write and maintain a custom ar locale for the pinned version — ongoing maintenance for a popup-only surface; or (c) accept English picker popups in ar mode — the app's own date rendering is already Intl ar-MA and unaffected. Recommendation: (c) until a planned dependency refresh makes (a) cheap. No library change made. |
| H-032 | Info | Admin locale parity (es) | Static parity analysis of all 96 locale modules (Wave 5): fr↔ar parity is complete, but the Spanish locale is missing 22 keys in admin `cash-journal.ts` (es falls back to English for those strings). Spanish was outside the fr/ar scope of Waves 1–5; recorded so the gap is tracked rather than silent. | FILED 2026-11-07 — observation (Wave 5) |
| H-028 | Info | `PUT /api/update-settings` (Settings tab) | Range validation is model-level only for the hour fields: `minPickupHours=100000` and fractional `2.5` are accepted and persisted (admin-only write; model min/max on the dropoff window itself is solid — 0/−5/24/−1/"abc" all 400 with nothing persisted). Note: `minPickupHours`/`minRentalHours` are consumed only by the frontend search forms; the backend never enforces them at checkout (code-verified). | FILED 2026-11-07 — observation (Wave 4) |
| H-029 | Info | `PUT /api/update-supplier` priceChangeRate (Pricing) | `priceChangeRate` accepts negative values (−4 persisted live, then restored): no server-side range validation. Settable only by the agency owner (self) or the platform admin — staff attempt 403 — so the exposure is self-scoped mispricing, not a privilege issue. Round-trip otherwise exact (unset → 7.5 → restored). | FILED 2026-11-07 — observation (Wave 4) |


### Carried backlog — queue #12 Phase D (D-1…D-14), reconciled 2026-11-07

All 14 items re-verified as still valid against today's census/code and carried into this register; none were silently closed.

| ID | Item | Disposition in this program |
|---|---|---|
| D-1 | Admin confirm-action UI missing (payment/cash confirms are API-only) | Owner workflow call. Wave-2 evidence 2026-11-07: DOM scan of the live Payments and Caisse pages (fr, pending entries present) found zero confirm controls; the backend confirm flow was re-proven the same day. |
| D-2 | Caisse propagation for payment reversals (manual offset today) | Owner money-policy decision. Wave-2 evidence 2026-11-07: a reversal was executed and reconciled in Reports with no cash-journal movement created (the annulled pair lives only in RentalPayment; the same-day caisse close-out contains no reversal leg) — the manual-offset gap stands exactly as filed. |
| D-3 | Location delete has no in-use guard (cars keep dangling location ids; car delete already 409s on booking history) | Owner behaviour decision. Wave-2 evidence 2026-11-07: re-confirmed live — DELETE of a location referenced by a car returns 200 and the populated car view then lists no locations (views cope; the raw reference dangles at the data level, queue #12 B3). Implementation, once decided, belongs to the Wave-3 Locations slice. Wave-3 evidence 2026-11-07: re-proven with a fresh fixture chain — `check-location` reports the location in use (200) yet DELETE still returns 200; the delete scrubs the reference from cars (the car's `locations` becomes `[]`), so a single-location car is left unbookable/unsearchable with no warning. Sibling case proven the same day: deleting a country referenced by a location also returns 200 and the location list then renders `country: null`. Still the owner's call; NOT implemented. |
| D-4 | Checkout guest-validation rework | **IMPLEMENTED 2026-11-07 (Wave 3)** — client: guest-required driver schema variant in `CheckoutForm.createSchema` (localized required/format/age messages) + `<form noValidate>` in Checkout.tsx; server: `bookingController.checkout` validates new-guest driver completeness + minimum age (400, nothing persisted). Live-proven both directions: guest gaps rejected (API 400s; in-app localized errors on empty submit, axe 0), valid guest + signed-in pay-on-site checkouts complete end-to-end. |
| D-5 | Booking.tsx RHF migration (redesign, not a fix) | Wave-3 evidence 2026-11-07: live-verified in its current form — the page functions as the customer booking detail view (legacy useState form, `edit = false` hardcoded; booking renders with dates/status). The register scopes this as a redesign, so NO migration was attempted in Wave 3; carry to a design-first slot. |
| D-6 | Mobile bookings empty card (product call) | Owner decision |
| D-7 | Timezone pinning (cross-cutting product decision) | Owner decision |
| D-8 | GA-list pagination design | Wave 3/4 design-first |
| D-9 | Search price filter/sort (new feature) | Not hardening — product backlog |
| D-10 | Language/data residuals (account vs UI language, English notification bodies, en-US scheduler edge, RTL header graze) | **CLOSED in part 2026-11-07 (Wave 5):** scheduler chrome localized (ar/fr/en branches in VehicleScheduler + ar-MA date-fns) and axe-clean; account-vs-UI language precedence root-caused (a signed-in user's stored `language` overrides localStorage — by design; the W2 switch failure explained, not a defect); RTL header graze NOT reproduced in the W5 ar walks at 1440×900 (all pages dir=rtl, no overflow violations). Remaining: notification e-mail bodies are generated server-side in English — a product-copy decision for the owner, not a defect. |
| D-11 | No create-supplier API route (supplier creation is UI-side; `POST /api/admin-sign-up` exists but returned 404 in the 2026-11-07 anonymous sweep posture) | Census-confirmed; Wave 4 API-completeness call |
| D-12 | cover.mp4 hero video (2,037,251 B; poster/compression is a content call) | Owner decision |
| D-13 | Stripe `resource_missing` → 404 mapping is code-proven only; live proof needs a Stripe test key | Wave 6 — external gate |
| D-14 | Container images predate queues #10/#12 + this program: fixes live in container layers via copy-in; **restart keeps them, recreate loses them**; image rebuild must be kicked off from the owner's desktop session | Owner action; governs every wave's deploy step |

## Census summary (2026-11-07)

| Surface | Count | Verified live | Unknown / not verifiable |
|---|---|---|---|
| Admin app routes | 45 route entries (43 named + index + catch-all) | HTTP 200 smoke; full render matrix by queue #12 B4 (2026-11-06: 45/45 fr+ar, 0 broken) on unchanged UI code | — |
| Frontend app routes | 23 route entries (21 named + index + catch-all; `/suppliers` conditional on `HIDE_SUPPLIERS`) | HTTP 200 smoke; queue #12 B4 (58 scans, 0 broken anonymous) | — |
| Backend API endpoints | 165 (23 route modules) | 161 probed anonymously 2026-11-07 (0 anomalies); agency scoping additionally evidenced by queue #12 B3 live actor matrix (8 actors × 17 mutations) + Wave-1 code verification of every verifyToken-only controller | 4 payment-gateway POSTs code-verified only (no external calls permitted) |
| Mobile app (Expo) | — | API header-auth path exists (`x-access-token`) and is in the API census | **UNKNOWN — no device available**; mobile UI tabs not enumerated |
| External payments (Stripe/PayPal live behaviour) | — | Code paths + P0 provider suites | **UNKNOWN — no sandbox credentials** (see D-13) |

**Deltas vs queue #12 maps:** Q12 counted "45 admin routes" (matches: 45 route entries incl. index + catch-all) and "22 frontend routes" (this census: 23 entries = 21 named + index + catch-all; ±1 is a counting convention — Q12 did not count the catch-all). The MAP's `/abonnement` admin route, previously "details unknown", **does not exist in the current admin router** — recorded as ABSENT (removed or never shipped), not as a tab. `/calendar` and `/scheduler` both render the Scheduler page (alias pair, intentional-looking; noted, not a defect).


## Appendix A — Admin app census (45 route entries)

| Route | Tab / page | Roles that can reach it | Status |
|---|---|---|---|
| `(index) /` | Dashboard | agency staff (scoped widgets) | HARDENED — W4 2026-11-07: fixture-exact reconciliation for owner/staff/admin (see W4 record); cancelled exclusion proven live; axe 0 on the owner render; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED |
| `/dashboard` | Dashboard | agency staff (scoped widgets) | HARDENED — W4 2026-11-07: same component as `(index)`; evidence on the index route; W5 2026-11-07: ar walk axe [] console 0 — HARDENED |
| `/bookings` | Bookings | agency staff (ReadBookings) | HARDENED — W3 2026-11-07: full live API matrix (create battery, update-status, cancel semantics, getBookings dateBetween) + fr UI render; H-020 FIXED; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED |
| `/clients` | Clients | agency staff (ReadClients) | IN PROGRESS — W3 2026-11-07: live matrix (create/delete isolation, type-escalation 403); H-018 FIXED (tab was empty for agency users); H-019 FILED (owner decision); pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0; H-019 still open (owner decision) — stays DEFECT FILED |
| `/calendar` | Scheduler (alias of /scheduler) | agency staff | HARDENED — W3 2026-11-07: fr render + data path proven via getBookings dateBetween; H-021 axe FILED (Wave 5); pt 5 ar = Wave 5; W5 2026-11-07: ar walk (as /scheduler) axe [] — HARDENED |
| `/maintenance` | Maintenance | agency staff (ReadExpenses/ManageExpenses) | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/payments` | Payments | agency staff (ReadPayments/ReadInvoices) | HARDENED — W2 2026-11-07: full live API matrix + fr UI walk (checklist pts 1–4, 6–9 evidenced; pt 5 ar = Wave 5); D-1 confirm UI absent; H-012 FIXED in W5; W5 ar walk axe [] console 0 (owner + empty-state owner) — HARDENED (D-1 remains an open owner product decision in the backlog) |
| `/caisse` | CashJournal | agency staff (ReadCash/ManageCash) | HARDENED — W2 2026-11-07: live API matrix + close-out coherence (discrepancy 0) + fr UI walk, axe 0; D-1 confirm UI absent (owner item); pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED |
| `/team` | Team | agency owner | HARDENED — W4 2026-11-07: 52-check live matrix; H-023 FIXED; browser walks (owner fr renders rows + add flow; ReadOnly designed denial); axe items in H-021 addendum; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED (H-021 team items fixed) |
| `/reports` | Reports | agency staff (ReadPayments) | HARDENED — W2 2026-11-07: totals reconciled to a hand-computed ledger (JSON + CSV) + fr UI walk, axe 0; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED |
| `/approbations` | Approbations | owner/manager (Decide*) | DEFECT FILED — H-010 open (owner decision). W2 2026-11-07: live API matrix (producer, blocking gate, decide rules) + fr UI walk, axe 0; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 (owner + Manager); H-030 FIXED; H-010 still open (owner decision) — stays DEFECT FILED |
| `/sign-in` | SignIn | public | IN PROGRESS — W1 slices A/C (auth APIs) |
| `/activate` | Activate | public (token) | IN PROGRESS — W1 slices A/C (token APIs); H-006 FIXED W6 2026-11-07 (link built from configured BC_API_HOST only; fail-safe when unconfigured) |
| `/forgot-password` | ForgotPassword | public | IN PROGRESS — W1 slice A (resend API) |
| `/reset-password` | ResetPassword | public (token) | IN PROGRESS — W1 slices A/C (token APIs) |
| `/suppliers` | Suppliers | platform admin | HARDENED — W4 2026-11-07: live API matrix + admin browser walk (seeded suppliers render); H-024 FIXED; axe items in H-021 addendum; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED |
| `/supplier` | Supplier (detail) | platform admin / supplier self | HARDENED — W4 2026-11-07: getSupplier read matrix proven live (admin/self/staff-with-permission; Counter/ReadOnly 403 by design); pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 (sr-only h1 added) — HARDENED |
| `/create-supplier` | CreateSupplier | platform admin | NOT STARTED — no create-supplier API route exists (D-11); the UI-only flow was not exercised in W4 |
| `/update-supplier` | UpdateSupplier | platform admin / agency profile mgr | IN PROGRESS — W4 2026-11-07: update matrix + blacklist flow + priceChangeRate round-trip proven live via the underlying endpoint; H-027/H-029 filed (Info); pt 5 ar = Wave 5 |
| `/locations` | Locations | agency staff (ReadLocations) | HARDENED — W3 2026-11-07: live matrix (catalogue semantics, agency-scoped checks, staff update 200); H-013/H-015/H-016 FIXED; D-3 re-evidenced (owner decision); pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED (D-3 remains an open owner decision in the backlog) |
| `/create-location` | CreateLocation | agency staff (ManageLocations) | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/update-location` | UpdateLocation | agency staff (ManageLocations) | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/cars` | Cars | agency staff (ReadFleet) | HARDENED — W3 2026-11-07: live matrix (validation battery, uploads, delete 409 on booking history); H-017 FIXED; axe items in H-021; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED (all 42 filter inputs labelled) |
| `/car` | Car (detail) | agency staff (ReadFleet) | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/create-car` | CreateCar | agency staff (ManageFleet) | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/update-car` | UpdateCar | agency staff (ManageFleet) | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/update-booking` | UpdateBooking | agency staff (ManageBookings) | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/create-booking` | CreateBooking | agency staff (ManageBookings) | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/users` | Users | platform admin | HARDENED — W4 2026-11-07: full live matrix (list/get/create/update/delete); H-025 FIXED; admin browser walk renders users; axe items in H-021 addendum; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED |
| `/user` | User (detail) | platform admin | IN PROGRESS — W4 2026-11-07: getUser matrix proven live (no field leakage); pt 5 ar = Wave 5 |
| `/create-user` | CreateUser | platform admin | IN PROGRESS — W4 2026-11-07: create battery proven live via the underlying endpoint (type gates, foreign-stamp 403, duplicates 400); pt 5 ar = Wave 5 |
| `/update-user` | UpdateUser | platform admin | IN PROGRESS — W4 2026-11-07: update battery proven live via the underlying endpoint (POST; writers/scoping/type-gates); H-008 recheck clean; pt 5 ar = Wave 5 |
| `/settings` | Settings | signed-in user; app settings platform admin | HARDENED — W4 2026-11-07: settings API battery + browser walks (admin forms render; staff see no admin forms, console clean post-H-022); H-026 FIXED; H-005 FIXED W6 2026-11-07; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED (both actors; labels fixed) |
| `/notifications` | Notifications | signed-in user (own) | HARDENED — W1 code-verified (owner-scoped helper); W5 2026-11-07: ar walk axe [] console 0 — HARDENED |
| `/change-password` | ChangePassword | signed-in user (own) | IN PROGRESS — W1 code-verified; H-005 FIXED W6 2026-11-07 (POST variant; web services migrated; flow proven end-to-end) |
| `/about` | About | public | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/tos` | ToS | public | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/contact` | Contact | public | IN PROGRESS — H-004 FIXED 2026-11-07 (mail rate limit) |
| `/countries` | Countries | agency staff (ReadLocations) | HARDENED — W3 2026-11-07: live matrix; H-014/H-015/H-016 FIXED (staff country CRUD restored); pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED |
| `/create-country` | CreateCountry | agency staff (ManageLocations) | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/update-country` | UpdateCountry | agency staff (ManageLocations) | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |
| `/scheduler` | Scheduler | agency staff | HARDENED — W3 2026-11-07: fr month-grid render; data path proven; H-021 axe FILED (Wave 5); pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0; scheduler chrome localized (D-10) — HARDENED |
| `/bank-details` | BankDetails | platform admin (write) / supplier (read) | HARDENED — W4 2026-11-07: 26-check API battery (admin-only write; owner/admin read; required-field validation) + owner browser render of the synthetic record; H-022 FIXED; axe items in H-021 addendum; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 (form renders with the page enabled; labels fixed) — HARDENED |
| `/pricing` | Pricing | signed-in supplier/admin | HARDENED — W4 2026-11-07: static page browser-verified (owner + ReadOnly staff, 3 plans); priceChangeRate round-trip live; H-029 filed (Info); pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 — HARDENED |
| `*` | NoMatch (404) | any | NOT STARTED — prior evidence: Q12-B4 render fr+ar 0 broken; axe 0 on main surfaces |

## Appendix B — Frontend app census (23 route entries)

| Route | Tab / page | Roles that can reach it | Status |
|---|---|---|---|
| `(index) /` | Home | public | HARDENED — prior evidence: Q12-B4 anonymous render scans 0 brokenW5 2026-11-07: ar walk axe [] console 0; guest search flow exercised end-to-end in ar — HARDENED |
| `/sign-in` | SignIn | public | IN PROGRESS — W1 slices A/C (auth APIs) |
| `/sign-up` | SignUp | public | IN PROGRESS — W1 slices A/C (auth APIs) |
| `/activate` | Activate | public (token) | IN PROGRESS — W1 slices A/C; H-006 FIXED W6 2026-11-07 (link built from configured BC_API_HOST only; fail-safe when unconfigured) |
| `/forgot-password` | ForgotPassword | public | IN PROGRESS — W1 slice A |
| `/reset-password` | ResetPassword | public (token) | IN PROGRESS — W1 slices A/C |
| `/search` | Search | public | HARDENED — prior evidence: Q12-B4 anonymous render scans 0 brokenW5 2026-11-07: real ar results render axe [] console 0 (labels + price contrast fixed) — HARDENED |
| `/checkout` | Checkout | public / customer (guest-capable) | HARDENED — W3 2026-11-07: D-4 IMPLEMENTED (guest-required client schema + noValidate + server guest validation); live guest + signed-in proof; axe 0; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] (also after a submit attempt); D-4 empty-submit produces Arabic validation messages live — HARDENED |
| `/checkout-session/:sessionId` | CheckoutSession | public (session capability) | NOT STARTED — prior evidence: Q12-B4 anonymous render scans 0 broken |
| `/bookings` | Bookings | customer (own) | HARDENED — W2 server-side driver scoping proven live; W3 2026-11-07: UI pass completed — with supplier avatars set the fixture supplier lists publicly (the W2 caveat root-caused: `getAllSuppliers` requires an avatar), the list renders the customer's booking and the detail view renders dates/status; axe items in H-021; pt 5 ar = Wave 5; W5 2026-11-07: ar walk axe [] console 0 (status-filter labels + grid header fixed) — HARDENED |
| `/booking` | Booking (detail) | customer (own) / guest with id | HARDENED — W1 code-verified; W2 2026-11-07: own-booking read + detail render proven live, cross-customer and anonymous reads 403; W5 2026-11-07: ar walk axe [] console 0 (price-caption contrast + sr-only h1) — HARDENED |
| `/settings` | Settings | customer (own) | HARDENED — W1 code-verified; H-005 FIXED W6 2026-11-07; W5 2026-11-07: ar walk axe [] console 0 (form labels, license input, avatar actions fixed) — HARDENED |
| `/notifications` | Notifications | customer (own) | HARDENED — W1 code-verified (owner-scoped helper); W5 2026-11-07: ar walk axe [] console 0 — HARDENED |
| `/change-password` | ChangePassword | customer (own) | IN PROGRESS — W1 code-verified; H-005 FIXED W6 2026-11-07 (POST variant; web services migrated; flow proven end-to-end) |
| `/about` | About | public | NOT STARTED — prior evidence: Q12-B4 anonymous render scans 0 broken |
| `/tos` | ToS | public | NOT STARTED — prior evidence: Q12-B4 anonymous render scans 0 broken |
| `/privacy` | Privacy | public | NOT STARTED — prior evidence: Q12-B4 anonymous render scans 0 broken |
| `/contact` | Contact | public | IN PROGRESS — H-004 FIXED 2026-11-07 |
| `/locations` | Locations | public | NOT STARTED — prior evidence: Q12-B4 anonymous render scans 0 broken |
| `/faq` | Faq | public | NOT STARTED — prior evidence: Q12-B4 anonymous render scans 0 broken |
| `/cookie-policy` | CookiePolicy | public | NOT STARTED — prior evidence: Q12-B4 anonymous render scans 0 broken |
| `/suppliers` | Suppliers (only when HIDE_SUPPLIERS is off) | public | NOT STARTED — prior evidence: Q12-B4 anonymous render scans 0 broken |
| `*` | NoMatch (404) | any | NOT STARTED — prior evidence: Q12-B4 anonymous render scans 0 broken |
## Appendix C — Backend API census (165 endpoints, by module)


### agencyMembershipRoutes.ts (4)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/agency-memberships/:supplierId` | auth, agency-member-read | list | IN PROGRESS — Q12-B3 live matrix + W1 route audit; W4 2026-11-07: 52-check matrix (isolation, Owner/Manager-only read by design) |
| POST | `/api/agency-memberships/:supplierId` | auth, agency-owner | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit; W4 2026-11-07: validation/conflict battery (400/409 set proven) |
| PUT | `/api/agency-memberships/:supplierId/:membershipId` | auth, agency-owner | update | IN PROGRESS — Q12-B3 live matrix + W1 route audit; W4 2026-11-07: H-023 FIXED (reactivation single-active check) |
| GET | `/api/agency-memberships/current` | auth, agency-member-read | current | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### approvalRoutes.ts (3)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/approvals` | auth, agency:DecideInvoices | list | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/approvals` | auth, agency:ManageInvoices | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/approvals/:id/decide` | auth, agency:DecideInvoices, pinned-selector | decide | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### bankDetailsRoutes.ts (2)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/bank-details` | auth, admin/supplier-type | get | IN PROGRESS — W1 route audit 2026-11-07; W4 2026-11-07: role matrix proven live (owner/admin 200; staff/customer/anon 403); H-022 fixed at the shell layer |
| POST | `/api/upsert-bank-details` | auth, platform-admin | upsert | IN PROGRESS — W1 route audit 2026-11-07; W4 2026-11-07: admin-only write proven; round-trips field-exact; required-field validation 400s |

### bookingRoutes.ts (12)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/booking-id/:sessionId` | PUBLIC | getBookingId | IN PROGRESS — W1 anon sweep 2026-11-07 |
| GET | `/api/booking/:id/:language` | auth-optional | getBooking | IN PROGRESS — W1 anon sweep + code-verified |
| POST | `/api/bookings/:page/:size/:language` | auth, agency:ReadBookings | getBookings | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/cancel-booking/:id` | auth | cancelBooking | IN PROGRESS — W1 route audit 2026-11-07 |
| POST | `/api/checkout` | PUBLIC | checkout | IN PROGRESS — W1 anon sweep 2026-11-07 |
| POST | `/api/confirm-payment-intent` | PUBLIC | confirmPaymentIntent | IN PROGRESS — W1 anon sweep 2026-11-07 |
| POST | `/api/create-booking` | auth, agency:ManageBookings | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/delete-bookings` | auth, agency:ManageBookings | deleteBookings | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| DELETE | `/api/delete-temp-booking/:bookingId/:sessionId` | PUBLIC | deleteTempBooking | IN PROGRESS — W1 anon sweep 2026-11-07 |
| GET | `/api/has-bookings/:driver` | auth | hasBookings | IN PROGRESS — W1 route audit 2026-11-07 |
| PUT | `/api/update-booking` | auth, agency:ManageBookings | update | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/update-booking-status` | auth, agency:ManageBookings | updateStatus | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### carRoutes.ts (14)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| POST | `/api/booking-cars/:page/:size` | auth, agency:ReadFleet | getBookingCars | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/car/:id/:language` | PUBLIC | getCar | IN PROGRESS — W1 anon sweep 2026-11-07 |
| POST | `/api/cars/:page/:size` | auth, agency:ReadFleet | getCars | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/check-car/:id` | auth, agency:ReadFleet, pinned-selector | checkCar | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/create-car` | auth, agency:ManageFleet | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/create-car-image` | auth, agency:ManageFleet, upload | createImage | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/delete-car-image/:id` | auth, agency:ManageFleet, pinned-selector | deleteImage | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| DELETE | `/api/delete-car/:id` | auth, agency:ManageFleet, pinned-selector | deleteCar | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/delete-temp-car-image/:image` | auth, agency:ManageFleet | deleteTempImage | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/frontend-cars/:page/:size` | PUBLIC | getFrontendCars | IN PROGRESS — W1 anon sweep 2026-11-07 |
| PUT | `/api/update-car` | auth, agency:ManageFleet | update | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/update-car-image/:id` | auth, agency:ManageFleet, pinned-selector, upload | updateImage | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/validate-license-plate/:id/:licensePlate` | auth, agency:ReadFleet, pinned-selector | validateCarLicensePlate | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/validate-license-plate/:licensePlate` | auth, agency:ReadFleet | validateLicensePlate | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### cashRoutes.ts (8)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/cash/sessions` | auth, agency:ReadCash | listSessions | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/cash/sessions` | auth, agency:ManageCash | open | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/cash/sessions/:sessionId/close` | auth, agency:ManageCash | close | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/cash/sessions/:sessionId/movements` | auth, agency:ReadCash | listMovements | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/cash/sessions/:sessionId/movements` | auth, agency-any-permission | createMovement | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/cash/sessions/:sessionId/movements/:movementId/confirm` | auth, agency:ManageCash | confirmMovement | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/cash/sessions/current` | auth, agency:ReadCash | current | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/cash/transfers` | auth, agency:ManageCash | transfer | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### contractOperationRoutes.ts (12)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/contract-operations/:bookingId` | auth, agency:ReadBookings | list | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/contract-operations/:bookingId/charges` | auth, agency:ReadBookings | listCharges | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/contract-operations/:bookingId/charges` | auth, agency:ManageBookings | createCharge | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/contract-operations/:bookingId/charges/:chargeId/decide` | auth, agency:DecideInvoices | decideCharge | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/contract-operations/:bookingId/complete` | auth, agency:ManageBookings | complete | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/contract-operations/:bookingId/files` | auth, agency:ManageBookings, upload | uploadFile | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| DELETE | `/api/contract-operations/:bookingId/files/:filename` | auth, agency:ManageBookings | deleteFile | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/contract-operations/:bookingId/files/:filename` | auth, agency:ReadBookings | getFile | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/contract-operations/:bookingId/handover` | auth, agency:ManageBookings | handover | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/contract-operations/:bookingId/return` | auth, agency:ManageBookings | returnInspection | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/contract-operations/:bookingId/snapshots` | auth, agency:ManageBookings | createSnapshot | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/contract-operations/:bookingId/snapshots/:filename` | auth, agency:ReadBookings | getSnapshotFile | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### countryRoutes.ts (9)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/check-country/:id` | auth, agency:ReadLocations | checkCountry | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/countries-with-locations/:language/:imageRequired/:minLocations` | PUBLIC | getCountriesWithLocations | IN PROGRESS — W1 anon sweep 2026-11-07 |
| GET | `/api/countries/:page/:size/:language` | auth, agency:ReadLocations | getCountries | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/country-id/:name/:language` | auth, agency:ReadLocations | getCountryId | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/country/:id/:language` | auth, agency:ReadLocations | getCountry | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/create-country` | auth, agency:ManageLocations | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| DELETE | `/api/delete-country/:id` | auth, agency:ManageLocations | deleteCountry | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| PUT | `/api/update-country/:id` | auth, agency:ManageLocations | update | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/validate-country` | auth, agency:ReadLocations | validate | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### documentRoutes.ts (3)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/maintenance-expense-receipt/:expenseId/:filename` | auth | downloadMaintenanceReceipt | IN PROGRESS — W1 code-verified 2026-11-07 |
| GET | `/api/supplier-contract/:supplierId/:filename` | auth | downloadContract | IN PROGRESS — W1 code-verified 2026-11-07 |
| GET | `/api/user-license/:userId/:filename` | auth | downloadLicense | IN PROGRESS — W1 code-verified 2026-11-07 |

### invoiceRoutes.ts (5)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/invoices` | auth, agency:ReadInvoices | list | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/invoices` | auth, agency:ManageInvoices | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/invoices/:id/issue` | auth, invoice-agency:ManageInvoices | issue | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/invoices/:id/payments` | auth, invoice-agency:ManageInvoices | recordPayment | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/invoices/:id/void` | auth, invoice-agency:ManageInvoices | voidInvoice | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### ipinfoRoutes.ts (1)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/country-code` | PUBLIC | getCountryCode | IN PROGRESS — W1 anon sweep 2026-11-07 |

### locationRoutes.ts (13)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/check-location/:id` | auth, agency:ReadLocations, pinned-selector | checkLocation | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/create-location` | auth, agency:ManageLocations | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/create-location-image` | auth, agency:ManageLocations, upload | createImage | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/delete-location-image/:id` | auth, agency:ManageLocations, pinned-selector | deleteImage | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| DELETE | `/api/delete-location/:id` | auth, agency:ManageLocations, pinned-selector | deleteLocation | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/delete-temp-location-image/:image` | auth, agency:ManageLocations | deleteTempImage | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/location-id/:name/:language` | PUBLIC | getLocationId | IN PROGRESS — W1 anon sweep 2026-11-07 |
| GET | `/api/location/:id/:language` | PUBLIC | getLocation | IN PROGRESS — W1 anon sweep 2026-11-07 |
| GET | `/api/locations-with-position/:language` | PUBLIC | getLocationsWithPosition | IN PROGRESS — W1 anon sweep 2026-11-07 |
| GET | `/api/locations/:page/:size/:language` | PUBLIC | getLocations | IN PROGRESS — W1 anon sweep 2026-11-07 |
| POST | `/api/update-location-image/:id` | auth, agency:ManageLocations, pinned-selector, upload | updateImage | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| PUT | `/api/update-location/:id` | auth, agency:ManageLocations, pinned-selector | update | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/validate-location` | auth, agency:ReadLocations | validate | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### maintenanceExpenseRoutes.ts (7)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/maintenance-expenses` | auth, agency:ReadExpenses | list | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/maintenance-expenses` | auth, agency:ManageExpenses | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| DELETE | `/api/maintenance-expenses/:id` | auth, agency:ManageExpenses | remove | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| PUT | `/api/maintenance-expenses/:id` | auth, agency:ManageExpenses | update | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/maintenance-expenses/receipts` | auth, agency:ManageExpenses | uploadReceipt | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/maintenance-expenses/receipts/:file` | auth, agency:ManageExpenses | deleteTempReceipt | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/maintenance-expenses/report` | auth, agency:ReadExpenses | report | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### maintenanceScheduleRoutes.ts (4)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/maintenance-schedules` | auth, agency:ReadExpenses | list | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/maintenance-schedules` | auth, agency:ManageExpenses | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| DELETE | `/api/maintenance-schedules/:id` | auth, agency:ManageExpenses | remove | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| PUT | `/api/maintenance-schedules/:id` | auth, agency:ManageExpenses | update | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### maintenanceWorkOrderRoutes.ts (4)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/maintenance-work-orders` | auth, agency:ReadExpenses | list | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/maintenance-work-orders` | auth, agency:ManageExpenses | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| DELETE | `/api/maintenance-work-orders/:id` | auth, agency:ManageExpenses | remove | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| PUT | `/api/maintenance-work-orders/:id` | auth, agency:ManageExpenses | update | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### notificationRoutes.ts (5)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| POST | `/api/delete-notifications/:userId` | auth | deleteNotifications | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/mark-notifications-as-read/:userId` | auth | markAsRead | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/mark-notifications-as-unread/:userId` | auth | markAsUnRead | IN PROGRESS — W1 code-verified 2026-11-07 |
| GET | `/api/notification-counter/:userId` | auth | notificationCounter | IN PROGRESS — W1 code-verified 2026-11-07 |
| GET | `/api/notifications/:userId/:page/:size` | auth | getNotifications | IN PROGRESS — W1 code-verified 2026-11-07 |

### paypalRoutes.ts (2)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| POST | `/api/check-paypal-order/:bookingId/:orderId` | PUBLIC | checkPayPalOrder | IN PROGRESS — code-verified; live UNKNOWN (no sandbox) |
| POST | `/api/create-paypal-order` | PUBLIC | createPayPalOrder | IN PROGRESS — code-verified; live UNKNOWN (no sandbox) |

### rentalPaymentRoutes.ts (4)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/rental-payments` | auth, agency:ReadPayments | list | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/rental-payments` | auth, agency:RecordPayments | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/rental-payments/:id/confirm` | auth, payment-agency:RecordPayments | confirm | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/rental-payments/:id/reverse` | auth, payment-agency:RecordPayments | reverse | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### reportRoutes.ts (2)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/reports/summary` | auth, agency:ReadPayments | summary | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/reports/summary.csv` | auth, agency:ReadPayments | exportCsv | IN PROGRESS — Q12-B3 live matrix + W1 route audit |

### settingRoutes.ts (2)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| GET | `/api/settings` | PUBLIC | getSettings | IN PROGRESS — W1 anon sweep 2026-11-07 |
| PUT | `/api/update-settings` | auth, platform-admin | updateSettings | IN PROGRESS — W1 route audit 2026-11-07; W4 2026-11-07: H-026 FIXED (partial-PUT reset + inverted window); H-028 filed (Info) |

### stripeRoutes.ts (1)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| POST | `/api/check-checkout-session/:sessionId` | PUBLIC | checkCheckoutSession | IN PROGRESS — code-verified; live UNKNOWN (no sandbox) |

### supplierRoutes.ts (12)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| POST | `/api/admin-suppliers` | auth, platform-admin | getAdminSuppliers | IN PROGRESS — W1 route audit 2026-11-07 |
| GET | `/api/all-suppliers` | PUBLIC | getAllSuppliers | IN PROGRESS — W1 anon sweep 2026-11-07 |
| POST | `/api/create-contract/:language` | auth, agency:ManagePrivateDocuments, upload | createContract | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/delete-contract/:supplierId/:language` | auth, agency:ManagePrivateDocuments | deleteContract | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| DELETE | `/api/delete-supplier/:id` | auth, platform-admin | deleteSupplier | IN PROGRESS — W1 route audit 2026-11-07; W4 2026-11-07: H-024 FIXED (membership cascade) |
| POST | `/api/delete-temp-contract/:file` | auth, agency:ManagePrivateDocuments | deleteTempContract | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/frontend-suppliers` | PUBLIC | getFrontendSuppliers | IN PROGRESS — W1 anon sweep 2026-11-07 |
| GET | `/api/supplier/:id` | auth, agency:ReadAgencyProfile | getSupplier | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| GET | `/api/suppliers/:page/:size` | auth, platform-admin | getSuppliers | IN PROGRESS — W1 route audit 2026-11-07 |
| POST | `/api/update-contract/:supplierId/:language` | auth, agency:ManagePrivateDocuments, upload | updateContract | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| PUT | `/api/update-supplier` | auth, agency:ManageAgencyProfile | update | IN PROGRESS — Q12-B3 live matrix + W1 route audit; W4 2026-11-07: matrix + blacklist + priceChangeRate round-trip; H-027/H-029 filed (Info) |
| POST | `/api/validate-supplier` | auth, admin/supplier-type | validate | IN PROGRESS — W1 route audit 2026-11-07 |

### userRoutes.ts (36)

| Method | Path | Gate | Handler | Status |
|---|---|---|---|---|
| POST | `/api/activate` | PUBLIC | activate | IN PROGRESS — W1 anon sweep 2026-11-07 |
| POST | `/api/admin-sign-up` | PUBLIC | adminSignup | IN PROGRESS — W1 anon sweep 2026-11-07 |
| POST | `/api/change-password` | auth, rate-limited | changePassword | IN PROGRESS — W1 code-verified 2026-11-07 |
| GET | `/api/check-password/:id/:password` | auth | checkPassword | DEPRECATED W6 2026-11-07 (H-005) — kept only for unauditable legacy clients; POST variant below is the supported form |
| POST | `/api/check-password/:id` | auth | checkPassword | W6 2026-11-07: added (H-005) — 12-case live parity battery vs the GET variant, all identical |
| GET | `/api/check-token/:type/:userId/:email/:token` | PUBLIC | checkToken | IN PROGRESS — W1 anon sweep 2026-11-07 |
| GET | `/api/confirm-email/:email/:token` | PUBLIC | confirmEmail | IN PROGRESS — W1 anon sweep 2026-11-07 |
| POST | `/api/create-avatar` | auth, upload | createAvatar | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/create-license` | upload | createLicense | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/create-push-token/:userId/:token` | auth | createPushToken | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/create-user` | auth, agency:ManageClients | create | IN PROGRESS — Q12-B3 live matrix + W1 route audit |
| POST | `/api/delete-avatar/:userId` | auth | deleteAvatar | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/delete-license/:id` | auth | deleteLicense | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/delete-push-token/:userId` | auth | deletePushToken | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/delete-temp-avatar/:avatar` | auth | deleteTempAvatar | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/delete-temp-license/:file` | PUBLIC | deleteTempLicense | IN PROGRESS — W1 anon sweep 2026-11-07 |
| DELETE | `/api/delete-tokens/:userId` | PUBLIC | deleteTokens | IN PROGRESS — W1 anon sweep 2026-11-07 |
| POST | `/api/delete-users` | auth, agency:ManageClients | deleteUsers | IN PROGRESS — Q12-B3 live matrix + W1 route audit; W4 2026-11-07: H-025 FIXED (atomic pre-validation) |
| GET | `/api/has-password/:id` | auth | hasPassword | IN PROGRESS — W1 code-verified 2026-11-07 |
| GET | `/api/push-token/:userId` | auth | getPushToken | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/resend-link` | auth, rate-limited | resendLink | IN PROGRESS — W1 code-verified 2026-11-07; W6 2026-11-07: H-006 FIXED (link from configured BC_API_HOST; fail-safe unconfigured) |
| POST | `/api/resend/:type/:email/:reset` | rate-limited | resend | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/send-email` | PUBLIC | sendEmail | IN PROGRESS — W1 anon sweep 2026-11-07 |
| POST | `/api/sign-in/:type` | rate-limited | signin | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/sign-out` | PUBLIC | signout | IN PROGRESS — W1 anon sweep 2026-11-07; W6 2026-11-07: H-007 — sign-out now revokes the presented session server-side (sid denylist); no/invalid token stays a 200 no-op |
| POST | `/api/sign-up` | rate-limited | signup | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/social-sign-in` | rate-limited | socialSignin | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/update-avatar/:userId` | auth, upload | updateAvatar | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/update-email-notifications` | auth | updateEmailNotifications | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/update-language` | auth | updateLanguage | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/update-license/:id` | auth, upload | updateLicense | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/update-user` | auth | update | IN PROGRESS — W1 code-verified 2026-11-07; W4 2026-11-07: writer/scope/type-gate battery live; H-008 recheck clean |
| GET | `/api/user/:id` | auth | getUser | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/users/:page/:size` | auth, agency:ReadClients | getUsers | IN PROGRESS — Q12-B3 live matrix + W1 route audit; W4 2026-11-07: types-required 400, no password fields, cross-agency keyword isolation, no page-size cap (observation) |
| POST | `/api/validate-access-token` | auth | validateAccessToken | IN PROGRESS — W1 code-verified 2026-11-07 |
| POST | `/api/validate-email` | PUBLIC | validateEmail | IN PROGRESS — W1 anon sweep 2026-11-07 |
| POST | `/api/verify-recaptcha/:token/:ip` | PUBLIC | verifyRecaptcha | IN PROGRESS — W1 anon sweep 2026-11-07 |