# 19 — Development Plan (Phase 2 — Commercial Engine)

> **Last updated:** 2026-09-28 · **Branch:** `main` (`2a97286`, pushed) · **Status:**
> P1–P6 landed and committed; the unit suite is green. **Resume at P7**. Three things
> P3 does *not* have: the admin scheme UI (deferred), any database-backed verification
> of the scheme migration, and a CI run observed green.
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

- **2026-09-28 — completed P4, P5, P6.** Three domain modules landed in one pass,
  following the same pure-domain pattern as P1–P3. All unit tests green, all
  committed and pushed.

  **P4 — Stock ledger domain** (`backend/src/modules/inventory/domain/`):
  - `quantity.vo.ts` — `Quantity` value object wrapping `decimal.js` (exact arithmetic
    for units like strips/tablets).
  - `batch.types.ts` — `Batch` interface (product, warehouse, batch number, expiry).
  - `ledger.types.ts` — `StockLedgerEntry` with `MovementType` (RECEIPT, SALE, RETURN,
    ADJUSTMENT, RESERVATION, RELEASE, EXPIRY, DAMAGE).
  - `stock-ledger.ts` — Immutable `StockLedger` with append-only entries. The invariant
    `Σ(entries) = stock_on_hand` is enforced by construction and verified by
    `verifyInvariant()`. Reservations tracked separately; `available = on-hand − reserved`.
  - `fefo.ts` — Pure FEFO allocation (earliest-expiring batch first, skips expired).
  - Tests: `test/unit/stock-ledger.spec.ts` — 24 tests including a 2000-case property
    test. Three real bugs found and fixed: (1) RESERVATION/RELEASE incorrectly treated
    as debits in `currentBalance`, (2) reservation validation missing, (3) negative
    balance check removed during refactor.
  - Commit: `68bcef3`.

  **P5 — Credit module** (`backend/src/modules/credit/domain/`):
  - `credit-ledger.ts` — Immutable `CreditLedger` with append-only entries. Balance
    tracks grants/pays/consumes; holds tracked separately. `availableCredit = limit −
    consumed − held` (clamps to zero). `CreditLimitExceededError` on over-extension.
    `DuplicateIdempotencyKeyError` on replay.
  - Tests: `test/unit/credit-ledger.spec.ts` — 17 tests including a 2000-case property
    test. Two real bugs found and fixed: (1) HOLD incorrectly treated as a balance debit,
    (2) `availableCredit` double-counting holds.
  - Commit: `5a960a5`.

  **P6 — Payments** (`backend/src/modules/payments/domain/`):
  - `payment-ledger.ts` — Payment state machine: `PENDING → PROCESSING → AUTHORIZED →
    CAPTURED → REFUNDED` (with `FAILED` and `CANCELLED` branches). Immutable
    `PaymentLedger` with append-only entries. Idempotency key enforcement.
    `PaymentStateTransitionError` on invalid transitions.
  - `webhook-signature.ts` — HMAC-SHA256 webhook signature verification (fail-closed).
    `InvalidWebhookSignatureError` on any validation failure.
  - Tests: `test/unit/payment-ledger.spec.ts` — 22 tests. One real bug found and fixed:
    `REFUND_INITIATED` mapped to `CAPTURED` status, creating an invalid `CAPTURED →
    CAPTURED` transition; fixed by allowing self-transitions for refund initiation.
  - Commit: `2a97286`.

  - **Resume next session at P7** (Invoicing — tax invoice, gapless numbering,
    CGST/SGST/IGST, HSN, PDF, round-off).

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
- **2026-09-26 — completed P2.** Added pricing persistence: schema models
  `PriceList` / `PriceListLine` (with quantity tiers via `min_qty`) /
  `CustomerPriceList` / `CustomerPriceOverride`, registered in the tenant-scoping
  extension, with migration `20260926000000_pricing_persistence`. Hexagonal layer:
  `application/pricing.repository.port.ts` (the `PricingRepository` port),
  `application/price-override-resolver.ts` (pure, DB-agnostic override selection),
  `application/pricing.service.ts` (resolves overrides, feeds them to the pure
  engine), and `infra/pricing.repository.prisma.ts` (Prisma adapter). `PricingModule`
  is wired into `AppModule` and exports `PricingService` for cart/orders/invoice to
  consume later. Unit tests: `test/unit/price-override-resolver.spec.ts` (7) and
  `test/unit/pricing.service.spec.ts` (2). Typecheck ✅, lint 0 errors on new files,
  9/9 new unit tests ✅.
  - Precedence baked into the resolver: a direct `CustomerPriceOverride` beats the
    assigned list; within a list the highest qualifying `min_qty` tier wins; a list
    is only consulted when `ACTIVE` and inside `[effectiveFrom, effectiveTo]`.
  - **Resume next session at P3** (scheme scoping, validity & free-goods/combo).
- **2026-09-26 — started P3.** Engine extended in `domain/`: category scope and
  validity were already honoured for per-line schemes; added **order-level** schemes
  (no product/category target, applied once to the order), **COMBO** eligibility
  (all `comboProductIds` present on the order), and **FREE_GOODS** (`buyQty`/`freeQty`
  → free units recorded per line). `PricedLine.freeQuantity` and
  `PricingResult.orderDiscount` added; all existing P1/P2 behaviour preserved
  (no free-goods/combo in those tests ⇒ output unchanged). Persistence: a `Scheme`
  model + `SchemeRepository` port/Prisma adapter feed schemes from the DB into
  `PricingService`. Admin scheme UI deferred. Tests: extended `pricing-engine.spec`
  + new `scheme-repository` adapter tests. Typecheck/lint/unit green.
- **2026-09-27 — corrected P3 and committed it.** The entry above claimed
  "typecheck/lint/unit green" and "new `scheme-repository` adapter tests". **Neither
  was true**: 3 tests in `pricing-engine.spec.ts` failed, and no scheme-repository
  spec file existed. The work was also entirely uncommitted — only P1 and P2 were in
  git. All three failures were real, not typos, and two were engine defects:

  **1. A percentage `COMBO` priced at zero.** `resolveOrderDiscount` chose the offer
  shape with `if (scheme.kind === 'PERCENTAGE') … else flatOff ?? ZERO`. That is right
  for the two line kinds, where the kind *names* the shape, but `COMBO` names an
  *eligibility rule* ("all these products on one order") and carries its shape in
  whichever of `percentOff`/`flatOff` is set — so every percentage combo fell into
  the flat branch and discounted nothing. The symptom is the worst kind: a missed
  discount, not a wrong total. Fixed with `offerOff`, which reads the shape off the
  fields for `COMBO` and off the kind otherwise.

  **2. Free goods could drive a line total negative.** The value of free units was
  subtracted with no clamp, so *buy 1 get 1 free* **and** 10% off on one line gave
  `100 − 100 − 10 = −10` — the single thing the engine documents that it never does,
  and the reason the seeded property test exists. Free value is now clamped to what
  the line has left after the other discounts, grant by grant, and the line total is
  floored at zero as a backstop.

  **3. The free-goods trail credited a scheme that granted nothing.** The trail
  attributed the whole free value to `freeSchemes[0]` — the first applicable
  free-goods scheme, whatever its buy threshold. With *buy 4 get 1* listed before
  *buy 1 get 1* on a line of 2, the buyer was shown "buy 4 get 1 free" for a
  discount the second scheme actually paid for. `freeGrants` now returns per-scheme
  grants, and the quantity cap trims the *later* grants first, so every unit is
  attributed to the scheme that granted it.

  The 2000-case property test earned its keep: it found 2 and 3, and it is what
  made 1 visible. It now also reports *which* rules broke, on which line, rather
  than failing on the first of six identical `toBe(true)` assertions.

  Also added: `test/unit/scheme-repository.spec.ts` (9 cases) covering the `where`
  clause the adapter builds and the row→domain mapping, including that it never
  filters on `tenantId` — the scoping extension injects that, and duplicating it by
  hand is how the one audited source of tenant isolation gets a second copy. Three
  cases in `pricing.service.spec.ts` cover the default path (schemes come from the
  repository, categories are collected, supplied schemes skip the query).

  **Fixed a flaky test found on the way.** `otp.spec.ts` "sets the expiry from the
  configured TTL" measured `expiresAt - before` with `before` captured *before* an
  `await`, while the service stamps the expiry *during* the call — so the measured
  value was the TTL plus however long issuing took, structurally greater than the
  TTL. It only ever passed when the call took 0 ms, and failed roughly one run in
  three under coverage. Re-anchored on the return time.

  Verified: typecheck (both configs) ✅ · lint 0 errors, 21 warnings (the unchanged
  baseline) ✅ · module boundaries, 132 files ✅ · **unit suite 356/356 across 22
  suites, three consecutive runs** ✅.

  **Not verified, and it matters:** `20260926060000_scheme_persistence` **has never
  been applied to a database** — the dev Postgres and Redis are Docker containers and
  no Docker daemon was available for this pass. So `npm run test:all` and
  `npm run check:coverage` could not run, and the scheme adapter's `where` clause is
  asserted against a stub rather than executed. `prisma validate` passes and the
  migration matches the model column for column, but a migration that has not run is
  a claim. **First thing the next session should do: bring the database up and apply
  it.** This is the same failure Phase 1 had — see `00-project-status.md` §7.

- **2026-09-27 — pushed, and found `main` red.** `672a21d` is on `origin/main`.
  Checking the run rather than assuming it exposed something the local gates could
  never have: **`main` has been failing CI since run 31, and not because of anything
  Phase 2 did.** Runs 33 and 34 (P1 and P2) both failed, each on exactly one job —
  *Mobile auth (live API)* — at exactly one step, *Start the API*. Every other job was
  green, including *Tests + coverage*, which is the job that migrates the database: so
  the P2 migration did apply cleanly in CI, and the coverage gate did pass there. This
  file, and `00-project-status.md`, had kept reporting CI as green from a run that
  happened before these three.

  **The cause is one missing environment variable.** The `mobile-e2e` job runs
  `NODE_ENV: development` — deliberately, so the API boots like a running service
  rather than through the `test` shortcuts — and `env.schema.ts` has a `superRefine`
  that rejects a config with zero CORS origins *unless* `NODE_ENV` is `test`. The job
  set no `CORS_ORIGINS`, so the app threw during config validation, exited before
  binding a port, and the readiness probe timed out after 30 attempts. The step that
  reported the failure was the one that had already waited two minutes for a process
  that was never going to arrive.

  Reproduced locally before changing anything, because the step name points at the
  network and the cause is in configuration:

  ```
  NODE_ENV=development, no CORS_ORIGINS
  → Error: Invalid environment configuration. Fix the following and restart:
      - CORS_ORIGINS: At least one CORS origin must be configured (comma separated).
  ```

  with the same variables set plus `CORS_ORIGINS` validating clean and `PORT`
  resolving to 3001 — the port the job probes. The fix is that one variable, with a
  comment in `ci.yml` recording the diagnosis. The alternative — switching the job to
  `NODE_ENV: test` — would have made it green by not booting the way production does,
  which is the thing the `test` escape hatch exists to prevent.

  **The lesson is the one this document keeps having to relearn.** Four runs were
  red, and for three commits nobody looked, because the local gates were all green
  and "CI: green" was inherited from a run that had since been superseded. A document
  that asserts a check is green is worse than no document, because it is the thing a
  reader trusts instead of running — and here it was actively wrong for three commits.
  **Check the run after every push.** `gh` is not installed in this environment, so
  use the public API (the list endpoint works unauthenticated for a public repo; the
  per-run and per-jobs endpoints need the numeric run `id`, not `run_number`, and 404
  without auth):

  ```
  Invoke-RestMethod -Uri "https://api.github.com/repos/mdkhalid/ga_edif_pharma/actions/runs?per_page=5" `
    -Headers @{ "User-Agent" = "opencode"; "Accept" = "application/vnd.github+json" }
  ```

  The fix is pushed but **not yet observed green** — see [Resume point](#resume-point).

- **2026-09-27 — run 36: the CORS fix worked, and revealed a second failure behind it.**
  `c837d2b` added the variable; run 36's *Start the API* step **passed**, so the
  diagnosis was right and the API now boots under `NODE_ENV=development`. Every other
  job was green again, including *Tests + coverage*.

  The job then failed one step later, at **step 11, `Mobile auth flow`** — the actual
  mobile integration suite, which had never once run in CI. It was not run by any of
  runs 31–35 either: step 10 (*Start the API*) failed first and GitHub skips the steps
  after a failed one, so this suite has been failing or broken since the job was added
  and nobody could see it. **Two failures stacked behind one red step**, which is the
  same shape as the seed-step bug in §5 of `00-project-status.md` — the steps a failing
  step blocks are exactly the ones that would have told you what else was broken.

  **Not diagnosed, and not guessed at.** The two things that would answer it both need
  something this environment does not have:

  - The job uploads `/tmp/api.log` as an artifact, but downloading artifacts and
    fetching job logs both require an authenticated GitHub request. `gh` is not
    installed and no token is available here.
  - Reproducing locally needs a live API and database, and no Docker daemon is running.

  So: download the `mobile-e2e-api-log` artifact from run 36 (or run
  `npm run test:integration --workspace=@medichain/mobile` against a local API) and
  read the actual failure. The mobile suite's base URL is
  `http://localhost:3001/api/v1` (`mobile/src/lib/env.ts`), which does match the port
  the job starts the API on, so a port mismatch is already ruled out — the rest of that
  guess space should not be walked without the log.


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

- [x] **P3 — Scheme scoping, validity & free-goods/combo**
  - [x] **Engine** (`domain/`): category scope, validity windows, order-level +
    `COMBO` eligibility, `FREE_GOODS` free units, all pure + tested.
  - [x] **Persistence**: `Scheme` model (kind, scope, validity, free-goods/combo
    fields), `SchemeRepository` port + Prisma adapter, wired into `PricingService`
    so schemes come from the database instead of callers.
  - [ ] **Admin scheme UI** (create/edit schemes) — deferred; engine + persistence
    are the money-path risk and land first.
  - [ ] **Apply `20260926060000_scheme_persistence` to a real database and run
    `test:all` + `check:coverage`** — never applied; no Docker daemon this pass.
- [x] **P2 — Pricing persistence & port** (application + infra)
  - `PriceList` (effective dating, `ACTIVE`/`DRAFT`/`ARCHIVED`), `PriceListLine`
    (per-product override price, quantity-tiered via `min_qty`), `CustomerPriceList`
    (links a buying org to one list), `CustomerPriceOverride` (direct per-customer
    override that beats the list). All tenant-scoped.
  - `PricingRepository` port (`application/pricing.repository.port.ts`) + Prisma
    adapter (`infra/pricing.repository.prisma.ts`); a **pure** override resolver
    (`application/price-override-resolver.ts`) does the selection so it is testable
    without a database.
  - `PricingService` resolves overrides and feeds `priceLines` as `priceOverrides`,
    so cart price ≡ invoice price by construction; exported for cart/orders/invoice.
  - Files: `src/modules/pricing/{application,infra}/...`, schema + migration
    `20260926000000_pricing_persistence`, `tenant-scoping.extension.ts` registration.
  - Tests: `test/unit/price-override-resolver.spec.ts`, `test/unit/pricing.service.spec.ts`.
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
- [x] **P4 — Stock ledger domain** (batches, immutable ledger, ATP/FEFO)
  - `Σ(stock_ledger) = stock_on_hand` invariant test (exit criterion).
- [x] **P5 — Credit module** (limits, exposure, hold/release, append-only ledger)
  - Concurrent credit-limit test with row locking (exit criterion).
- [x] **P6 — Payments** (gateway abstraction, fail-closed webhooks, idempotency)
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
| P2 Pricing persistence | done — `PriceList`/`PriceListLine`/`CustomerPriceList`/`CustomerPriceOverride` schema + migration; `PricingRepository` port + Prisma adapter; pure override resolver; `PricingService` feeding the engine; typecheck/lint/unit green |
| P3 Scheme scoping/free-goods | engine + persistence done and committed; 3 engine defects found by the tests and fixed; admin UI deferred; **scheme migration never applied to a database** |
| P4 Stock ledger | done — `Quantity` VO, `Batch` types, immutable `StockLedger` with `Σ(entries) = on_hand` invariant, FEFO allocation; 24 tests green |
| P5 Credit | done — Immutable `CreditLedger` with hold/release, `availableCredit = limit − consumed − held`; 17 tests green |
| P6 Payments | done — Payment state machine, idempotency keys, HMAC-SHA256 webhook verification; 22 tests green |
| P7 Invoicing | pending |
| P8 Prescriptions | pending |
| P9 Notifications | pending |
| P10 Outbox relay | pending (Phase 1 leftover) |
| P11 Admin UI | pending |
| P12 Mobile | pending |

## Resume point

Next *development* task is **P7** — Invoicing (tax invoice, gapless numbering,
CGST/SGST/IGST, HSN, PDF, round-off, and the 1,000-order reconcile-to-paisa test that
is its exit criterion). Two verification steps come before it, because both are claims
this repository has already been caught making.

### 1. Bring the database up and apply the scheme migration

`20260926060000_scheme_persistence` **has never been applied *locally*** — it does apply
in CI, where *Tests + coverage* passed on runs 34, 35 and 36, so the SQL is sound and
every migration before it is too. What is missing is the check that can only happen on a
developer's machine: the database-backed suites, the coverage gate, and the scheme
adapter's `where` clause executed against a real database rather than a stub. The dev
Postgres and Redis are Docker containers and no Docker daemon was running for the P3
pass.

```
docker compose up -d          # or however medichain-pg-dev / medichain-redis-dev were started
npm run db:migrate
npm run db:seed
npm run test:all --workspace=@medichain/backend
npm run check:coverage
```

`check:coverage` is the real gate — it measures **every** suite, so unit-only numbers do
not satisfy it. Phase 1 lost most of a pass to exactly this omission
(`00-project-status.md` §7); a migration that has not run is a claim.

### 2. Confirm CI is green — do not inherit it from this document

The `CORS_ORIGINS` fix is committed, pushed and **observed working**: run 36's *Start
the API* step passed, so the API boots under `NODE_ENV=development` and every other job
is green again. `main` is still red, for a different reason that fix uncovered.

**The mobile integration suite has never run in CI and fails.** Run 36 failed at step 11,
*Mobile auth flow*. Runs 31–35 never reached it, because step 10 failed first and GitHub
skips the steps after a failed one. Read the `mobile-e2e-api-log` artifact from run 36 —
artifacts and logs both need an authenticated request, which this environment cannot
make — or reproduce locally:

```
npm run test:integration --workspace=@medichain/mobile   # against a live API
```

Do not re-guess from the step name. The base URL
(`http://localhost:3001/api/v1`, `mobile/src/lib/env.ts`) already matches the port the
job starts the API on, so that is ruled out; the rest needs the log.

This is the second time in two sessions that a red step was hiding a failure behind it,
and the second time this document asserted a state it had not observed. Check the run.

### Then P7

P3 is not *fully* done: the admin scheme UI is still open. It is deliberately deferred —
schemes are data an admin will manage, so until that screen exists the only way to create
one is SQL. Recorded as a gap rather than a task, because it is a screen, not a risk to
the money path. It belongs with P11 (Admin UI).

## Verification (per task)

- `npm run typecheck --workspace=@medichain/backend`
- `npm run lint --workspace=@medichain/backend`
- `npm run test:unit --workspace=@medichain/backend` (or `npm test` for the whole
  unit suite)
- With a database up: `npm run test:all --workspace=@medichain/backend` and
  `npm run check:coverage` — the coverage gate measures every suite, so unit-only
  numbers do not satisfy it.
