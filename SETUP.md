# FleetRent — BookCars Local Setup (Docker)

Self-hosted car rental / fleet management system based on the open-source **BookCars** project (MIT license), branded as **FleetRent**.

## Services & URLs

| Service | URL | Notes |
|---|---|---|
| Customer frontend | http://localhost:8080 | Search, book, manage bookings |
| Admin panel | http://localhost:3002 | Bookings, cars, locations, suppliers, users |
| Backend API | http://localhost:4002 | REST API (`/api/...`), serves `/cdn/...` images |
| Mailpit (email inbox) | http://localhost:8025 | Catches all SMTP mail sent by the system |
| Mongo Express | http://localhost:8084 | DB admin UI, login `admin` / `admin` |
| MongoDB | `localhost:27018` | Replica set `rs0`, user `admin` / `admin` (local dev only) |
| Redis | `localhost:6379` | Cache / rate limiter |

All published service ports are bound to `127.0.0.1` so this development stack is reachable only from this computer.

> The admin panel is on **3002**, not the upstream default 3001, because port 3001 is already used on this machine.

## Start / Stop / Restart

From the project root (`bookcars/`):

```bash
docker compose up -d            # start all services
docker compose ps               # check status
docker compose logs -f bc-backend
docker compose down             # stop (data persists in volumes)
docker compose down -v          # stop AND delete all data (fresh start)
```

Rebuild after code/env changes (admin/frontend env vars are baked in at build time):

```bash
docker compose up -d --build bc-backend bc-admin bc-frontend
```

Full rebuild without cache: `docker compose build --no-cache && docker compose up -d`.

## Login credentials

| Role | Email | Password | Where |
|---|---|---|---|
| Admin | `admin@fleetrent.local` | `B00kC4r5` | http://localhost:3002 |
| Supplier | `dev-seed-supplier@bookcars.ma` | `B00kC4r5` | http://localhost:3002 (supplier features) |
| Customer | `dev-seed-customer@bookcars.ma` | `B00kC4r5` | http://localhost:8080 |

Change the admin password after first login (account menu in the admin panel).

## Demo data

Seeded via the project's dev seed script (idempotent, safe to re-run):

```bash
docker exec -e NODE_ENV=development bookcars-bc-backend-1 node dist/scripts/seed-dev.js
```

- 3 locations: San Francisco Airport (SFO), New York JFK Airport (JFK), Los Angeles Airport (LAX)
- 5 cars with photos: Volkswagen Golf ($35/day), Toyota Camry ($55), Tesla Model 3 ($65), BMW X3 ($85), Ford Mustang Convertible ($95)
- 1 supplier (Apex Car Rentals, pay-later enabled), 1 customer (Alex Morgan), 4 sample bookings + the live test booking
- To remove all seeded demo data: `docker exec -e NODE_ENV=development bookcars-bc-backend-1 node dist/scripts/clean-dev.js`

## Environment files

- `backend/.env.docker` — API config: DB, Redis, SMTP, JWT/cookie secrets, currency (MAD), min driver age (21), website name (FleetRent), admin email
- `admin/.env.docker` — admin panel build-time config
- `frontend/.env.docker` — frontend build-time config (branding, map center New York, currency MAD)

JWT and cookie secrets are strong random values generated at setup. MongoDB uses `admin`/`admin` — **change before any non-local use** (update `docker-compose.yml` and `BC_DB_URI` consistently; the mongo healthcheck also embeds the password).

## Email (SMTP)

A local **Mailpit** container receives all outgoing mail (no external provider needed for testing):

- SMTP host `mailpit:1025` (from the backend container), any auth is accepted
- View messages at http://localhost:8025
- Booking confirmations are sent to the admin, the supplier and the customer

For production, replace `BC_SMTP_HOST/PORT/USER/PASS/FROM` in `backend/.env.docker` with a real provider (SendGrid free tier works: host `smtp.sendgrid.net`, port 587, user `apikey`, pass = API key).

## Payments

No Stripe/PayPal keys are configured. The seeded supplier has **pay-later** enabled, so customers can complete bookings with "pay at pick-up" (booking status = Pending until the admin marks it paid). To enable online payment:

1. Stripe: set `BC_STRIPE_SECRET_KEY` (backend) and `VITE_BC_STRIPE_PUBLISHABLE_KEY` (frontend), keep `VITE_BC_PAYMENT_GATEWAY=Stripe`
2. PayPal: set `BC_PAYPAL_CLIENT_ID/SECRET` and `VITE_BC_PAYPAL_CLIENT_ID`, set `VITE_BC_PAYMENT_GATEWAY=PayPal`
3. Rebuild `bc-backend` / `bc-frontend` afterwards

## Verified working

- Admin login, bookings/cars/locations management UI
- Frontend search (location + dates) → 5 cars with photos and MAD prices
- Full checkout flow (pay-later) → booking visible in admin panel, status Pending, MAD 105 for 3 days
- Confirmation emails delivered to Mailpit for admin, supplier and customer
