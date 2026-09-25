# 19 — Development Plan (Phase 2 — Commercial Engine)

> **Last updated:** 2026-09-25 · **Branch:** `main` · **Status:** P1 (pure
> pricing/scheme engine) landed and green; resume at **P2**.
>
> Working plan for Phase 2. Phase 1 backend is landed and verified; the remaining
> Phase 1 UI (website storefront, onboarding wizard/upload, mobile) is tracked in
> `18-development-plan.md`. Where this file and `00-project-status.md` disagree,
> this file is the current *plan*; `00` remains the status record.
>
> **Updated as work proceeds.** Each task flips from `[ ]` to `[x]` and the Status
> table is kept current so a future session can resume from the first `[ ]`.
> The smallest, highest-risk slice is done first: the pure pricing/scheme engine,
> because it is the foundation everything else (cart, orders, invoicing) prices
> against, and it is pure/testable with zero infrastructure.

## Where we are (session log)

- **2026-09-25 — started Phase 2.** Completed **P1**: pure pricing/scheme engine in
  `backend/src/modules/pricing/domain/` (`money.vo.ts`, `scheme.types.ts`,
  `price-engine.ts`) plus `index.ts` and `pricing.module.ts`. Tests in
  `test/unit/pricing-engine.spec.ts` (6 hand-picked + a seeded 2000-case property
  test). Typecheck ✅, lint 0 errors, 7/7 unit tests ✅.
  - The engine is consumed directly by cart/orders pricing steps for now; no app
    wiring yet.
  - **Resume next session at P2** (pricing persistence & port). The engine's
    `PricingContext.priceOverrides` map is exactly what P2's repository populates,
    so P2 needs no engine changes — build the `PricingRepository` port + Prisma
    adapter and feed overrides into `priceLines`.


## Context

Phase 2 is "the numbers become correct and trustworthy" — real money moves, so
its exit criteria are a **merge gate**, not guidelines (see `05-phases-roadmap.md`
§Phase 2). The architecture is hexagonal: `domain/` is pure (no framework, no
I/O), `application/` holds commands/handlers/ports, `infra/` holds adapters,
`api/` holds controllers/DTOs. Money is exact `decimal.js` arithmetic (the same
library Prisma wraps as `Decimal`); domain must stay pure, so it imports
`decimal.js` directly, never `@prisma/client`.

## Conventions (established in repo)

- Domain is **pure**: no `import` of NestJS, Prisma, or I/O. Import `decimal.js`
  for money math. Tests import from `../../src/modules/<m>/domain/...`.
- Every function gets an explicit return type (eslint `explicit-function-return-type`).
- Value objects over primitives for Money; schemes are **data**, not code.
- Tests: `jest` unit specs in `test/unit/*.spec.ts`; `npm run test:unit`.
  Coverage gate is a merge gate for the eight security-critical files and now
  for this engine (it is in the money path).
- Property tests run over a seeded PRNG so failures are reproducible.

## Tasks (small → large)

- [x] **P1 — Pricing/Scheme pure engine** (domain)
  - `Money` value object (exact decimal, round-half-up to paisa, pure).
  - `Scheme` data types: `PERCENTAGE` / `FLAT` (free-goods/combo are P3).
  - `priceLines(inputs, ctx)` pure function: resolves price-list/tier overrides,
    filters schemes by scope (product/category), validity window and `minQty`,
    applies **stackable** schemes in priority order and **non-stackable** schemes
    as exclusive best-offer, never lets a line total go negative, and returns a
    per-line **explanation trail** (every discount names its scheme + amount).
  - Invariant: pure + deterministic, so cart price ≡ invoice price by construction.
  - Files: `src/modules/pricing/domain/{money.vo,scheme.types,price-engine}.ts`,
    `src/modules/pricing/index.ts`, `src/modules/pricing/pricing.module.ts`.
  - Tests: `test/unit/pricing-engine.spec.ts` (hand-picked + seeded property tests).
- [ ] **P2 — Pricing persistence & port** (application + infra)
  - Price lists, customer/tier overrides, effective dating; `PricingRepository`
    port + Prisma adapter; `priceOverrides` fed from it into `priceLines`.
- [ ] **P3 — Scheme scoping, validity & free-goods/combo**
  - Category scope, order-level schemes, free-goods & combo kinds, admin scheme UI.
- [ ] **P4 — Stock ledger domain** (batches, immutable ledger, ATP/FEFO)
  - `Σ(stock_ledger) = stock_on_hand` invariant test (exit criterion).
- [ ] **P5 — Credit module** (limits, exposure, hold/release, append-only ledger)
  - Concurrent credit-limit test with row locking (exit criterion).
- [ ] **P6 — Payments** (gateway abstraction, fail-closed webhooks, idempotency)
  - Duplicate-webhook credits ledger once; invalid signature → 4xx, not 500.
- [ ] **P7 — Invoicing** (tax invoice, gapless numbering, CGST/SGST/IGST, HSN,
  PDF, round-off) + 1,000-order reconcile-to-paisa test.
- [ ] **P8 — Prescriptions** (upload, pharmacist verification, schedule-based
  blocking — server-side enforcement for Schedule H1).
- [ ] **P9 — Notifications** (push, in-app centre, channel preferences, template
  UI) — partly Phase 1; durable retry depends on the outbox relay.
- [ ] **P10 — Outbox relay** (durable notification retry) — Phase 1 leftover,
  prerequisite for notification trust; currently best-effort.
- [ ] **P11 — Admin UI** (pricing, scheme, stock, credit, invoice viewers).
- [ ] **P12 — Mobile** (push, barcode scan, reorder, prescription upload).

## Status

| Task | State |
|---|---|
| P1 Pricing/Scheme engine | done — `Money` VO + `priceLines` pure fn with explanation trail; hand-picked + seeded property tests; typecheck/lint/unit green |
| P2 Pricing persistence | pending |
| P3 Scheme scoping/free-goods | pending |
| P4 Stock ledger | pending |
| P5 Credit | pending |
| P6 Payments | pending |
| P7 Invoicing | pending |
| P8 Prescriptions | pending |
| P9 Notifications | pending |
| P10 Outbox relay | pending (Phase 1 leftover) |
| P11 Admin UI | pending |
| P12 Mobile | pending |

## Resume point

Next unstarted task is **P2** (pricing persistence & port). P1 established the
pure pricing function and its contract (`priceLines` takes a `PricingContext`
whose `priceOverrides` map is exactly what P2's repository will populate), so P2
can be built without touching the engine.

## Verification (per task)

- `npm run typecheck --workspace=@medichain/backend`
- `npm run lint --workspace=@medichain/backend`
- `npm run test:unit --workspace=@medichain/backend` (or `npm test` for the whole
  unit suite)
