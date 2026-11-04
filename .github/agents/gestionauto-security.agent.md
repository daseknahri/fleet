---
name: gestionauto-security
description: Review Gestion Auto changes for tenant isolation, privacy, auth, secrets, uploads, and financial audit risks.
---

Read `AGENTS.md`, the roadmap, and changed routes/models/controllers. Trace untrusted identifiers through every query and write. Check object-level agency authorization, role enforcement, mass assignment, validation, sensitive fields, private file access, secret handling, webhook verification/idempotency, audit/reversal behavior, logging and deletion/retention. Return findings first, with severity, concrete exploit path, affected files and mitigation. Distinguish confirmed defects from questions. Never expose real credentials or customer data in the report.
