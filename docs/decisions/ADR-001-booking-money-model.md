# ADR-001: Booking amounts and payment reconciliation

- **Status:** Proposed; partial checkout safeguards and new-ledger posting foundation implemented, full cutover blocked on the Phase 4 finance design gate
- **Date:** 2026-10-29
- **Owners:** Product owner + domain architect + finance reviewer
- **Scope:** Bookings, checkout, provider payments, agency payment ledger, cash journal and legacy reconciliation

## Context and evidence

The existing `Booking.price` field is overloaded and cannot safely represent a contract balance or amount collected.

Verified code behavior:

1. Customer checkout selects `price`, `depositPrice`, or `price + depositPrice` based on the payment option. The frontend puts that selected value in `booking.price` ([Checkout.tsx](../../frontend/src/pages/Checkout.tsx#L200)).
2. Before the interim checkout changes, the backend recalculated rental price into `booking.price`, potentially differing from the frontend-selected charge.
3. Before the interim checkout changes, Stripe and PayPal verification compared the provider amount to `booking.price`, creating a likely mismatch for deposit/full-payment modes.
4. `isDeposit` and `isPayedInFull` are choice/status flags, not amounts. Before the interim guard, staff could set booking status directly without a payment record. Manual create/update/bulk status paths now reject payment-derived statuses; this source change is not yet rebuilt. Therefore `Paid`, `Deposit`, or `PaidInFull` is not proof of an amount collected.
5. The local read-only aggregate audit saw five development-seed booking rows, zero new-ledger rows and no provider references among those rows. This is local demo evidence only; it says nothing about production data.

## Decision proposal

Separate commercial terms, amount due now, settlement, and contract lifecycle. Do not expand `price` into another ambiguous field.

### Booking financial snapshot

At contract/booking confirmation, persist a versioned and immutable snapshot with:

- currency and precision/rounding policy;
- rental base, duration, options/add-ons, discount, tax components and rental total;
- refundable security deposit as a separate held amount;
- amount due at reservation and due-date/collection schedule;
- remaining receivable as a derived value, not a mutable stored balance;
- price-rule/tax-rule version and the timestamp/source used to calculate it.

Amendments create a new version/delta with actor, reason, timestamp and customer acceptance where required; they do not overwrite the issued snapshot.

### Payment ledger

Each payment/credit is an independent auditable transaction with agency, booking, amount, currency, direction, method, source, provider identifiers, settlement/refund state, idempotency key, actor and timestamps. Provider callbacks and manual posting go through the same idempotent posting service. Corrections use linked reversal/adjustment entries. A payment status never changes a contract lifecycle status without an explicit workflow transition; a lifecycle status never fabricates a payment.

Security deposits have separate collect/hold/release/retain/refund transactions. Rental revenue collection, deposit liability, refunds, fees and cash/bank transfers remain distinguishable in reports.

### Checkout contract

The server calculates authoritative commercial totals and returns a quote with a version/expiry. Checkout selection chooses an explicit `amountDueNow` from that quote. The provider is initialized with that exact server-side amount and currency; the callback is verified against that persisted quote/intent, not an editable `Booking.price`. Idempotency prevents duplicate quote consumption, payment posting or webhook replay.

## Interim implementation state (2026-10-29)

The user chose to keep the existing checkout options and amounts for now. The existing customer “deposit” choice continues to charge the configured car deposit amount. This is a compatibility decision only: it does not define the amount as refundable security, rent prepayment, or credit against the rental total. Customer-facing disclosures, accounting treatment, refund rules and ledger classification remain open.

The implementation now calculates a versioned server-side financial snapshot from the selected vehicle, its current price rules, booking options and date range. It initializes Stripe Checkout, Stripe PaymentSheet, or PayPal from that snapshot; provider callbacks verify provider references and amount/currency before finalizing the booking. Staff cannot directly assign provider-derived statuses. Expired or missing temporary bookings with a verifiable successful provider payment are sent through refund handling. These source changes have **not yet passed a build or sandbox payment verification** because the local Docker service could not be started and no local compiler was available.

This is not the final finance model: snapshots do not yet define tax/fee policy or provider-backed historical reconciliation. A new-ledger posting foundation now exists in `backend/src/utils/ledger.ts`: manual and verified provider entries use currency-aware minor-unit checks, per-booking serialization, sparse idempotency keys, source/status/actor/provider metadata, and linked debit reversals. Provider checkout posting currently runs after booking availability finalization; a posting failure is logged for reconciliation rather than being silently treated as a balanced financial state. A transaction callback that atomically commits booking finalization and the ledger entry is still required before financial readiness. Treat the snapshot and the current ledger as interim evidence only until the full design and business decisions pass the acceptance gate below.

## Legacy reconciliation protocol

No bulk migration is authorized by this ADR. The migration implementation must be separate and remain dry-run by default.

1. Inventory counts and amount totals by agency, booking status, flags, gateway-reference presence, currency and date; do not print personal records to logs.
2. For each gateway reference, retrieve authoritative provider transaction/capture and refund/dispute state; compare booking, currency, capture amount, event time and net settlement.
3. Classify: `provider_verified`, `manual_evidence_required`, `amount_mismatch`, `provider_unavailable`, `refund_or_dispute_review`, `cancelled_or_void`, or `no_payment_evidence`.
4. Never infer a payment from `Booking.status`, `isDeposit`, `isPayedInFull`, `price`, or session ID alone. A reference ID is only a lookup key, not proof of settlement.
5. Require an authorized finance reviewer to decide manual cases using approved receipts/bank evidence. Record reviewer, evidence type, decision and timestamp; do not store unnecessary identity documents.
6. Produce a redacted dry-run report and reconcile before/after counts, gross receipts, refunds, net receipts and outstanding balances by currency/agency.
7. Take and verify a restorable backup, obtain data-owner approval, apply in an idempotent transaction/batch with a checkpoint, then reconcile. Keep a rollback/reversal plan and all report artifacts access-controlled.

## Consequences

- The current payment ledger and cash journal are useful prototype surfaces, but must not be represented as reconciled historical finance or used for live accounting until the model and cutover gates pass.
- As an interim safety guard, admin booking edits and bulk status changes cannot assign or alter `Deposit`, `Paid`, or `PaidInFull`; those states must come from a verified provider flow. This does not reconcile historical statuses or prove that every existing provider flow posts a ledger entry.
- Provider-dependent historical records may need manual review if credentials, provider retention or references are unavailable.
- Checkout and payment UI need coordinated changes; changing only one side would preserve amount mismatch risk.
- Current local demo records have no provider references; they remain seed fixtures and must not be “migrated” as real payments.

## Open decisions before implementation

- Is the commercial rental price tax-inclusive, and which Moroccan VAT/tax rules apply by service/date?
- Is the car deposit refundable, when is it collected, and how are damage/late/cleaning deductions authorized?
- Which payment provider(s) and manual methods are in scope for the pilot?
- Which agency roles may record, confirm, reverse and reconcile transactions?
- What are the agency’s official currency, rounding, invoice-number and Casablanca-local-day rules?
- What provider evidence and finance approval are acceptable for legacy records?

## Acceptance gate

Do not implement the ledger cutover or claim financial readiness until the open financial/business rules are decided, checkout stores a correct immutable quote snapshot, payment posting is idempotent and concurrency-safe, reversals are traceable, and dry-run totals reconcile with provider/bank evidence.
