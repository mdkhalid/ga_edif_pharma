# 19 — Development Plan (Phase 2 — Commercial Engine)

> **Last updated:** 2026-09-30 · **Branch:** `main` (`a311bae`, pushed) ·
> **Status: P7 is now closed except the invoice PDF, which is deliberately
> deferred. Resume at P8.**
>
> What changed this pass: the database is up locally for the first time, both
> never-applied migrations are applied and seeded, and P7's DB-backed tests exist
> and are green — `test:all` **539/539 across 39 suites**, coverage gate **passed**
> (53.18% statements, every critical file ≥96%). Writing them found **three real
> defects**, all fixed: concurrent issuing of one order produced five tax
> documents, an idempotent replay returned a differently-formatted total than the
> first response, and one of my own reconciliation assertions had the round-off
> sign backwards. Details in the session log below.
>
> CI was checked twice this pass, which is the habit this file keeps needing: run 45
> showed a *new* red — the dependency audit, broken by advisories published after
> run 44 rather than by anything in this pass — fixed in `a311bae` and **not yet
> observed green in CI**. `main` is red regardless, on the pre-existing mobile-e2e
> failure.
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

- **2026-09-30 — closed P7's verification gap. Two real defects, and one of mine.**

  The pass started with the thing three previous sessions said to do first: bring
  the database up. It had never run locally. It now has.

  **The database.** Docker Desktop was not running; the service was stopped and the
  `medichain-pg-dev` / `medichain-redis-dev` containers (which match the ports in
  `backend/.env`: 55432 and 56379) were exited. Note the compose file publishes
  5432/6379 and is *not* what `backend/.env` points at — using it gives a
  database the tests cannot see. After starting Docker, `db:migrate` applied
  **three** previously-unapplied migrations — `20260926000000_pricing_persistence`,
  `20260926060000_scheme_persistence` and `20260929000000_invoicing` — so the
  scheme migration from P3 is now applied *and* seeded, which had been owed since
  2026-09-27. `prisma migrate deploy` was used rather than `migrate dev`; nothing
  here needs a shadow database.

  **The tests.** Two new files, following the pattern the Phase 1 suites set
  (real database, hand-assembled services, own tenant so the fixtures cannot
  collide):

  - `test/integration/invoicing.integration-spec.ts` — 26 tests. Intra-state
    CGST/SGST vs inter-state IGST, per-line tax snapshotted, an order-level
    discount taxed on the *discounted* value, whole-rupee round-off within ±0.50
    and its exact value when declined, header/lines reconciling to the paisa, the
    gapless number consuming exactly one sequence position, replay returning the
    same invoice and consuming no second number, a cancelled invoice releasing the
    order for a fresh one, all five fail-closed paths (missing HSN, missing buyer
    state, missing tenant state, cancelled order, empty order), cancel/audit, and
    the buyer-vs-staff read scope.
  - `test/concurrency/invoicing-numbering.concurrency-spec.ts` — 7 tests. Six
    concurrent issues of six orders get six distinct numbers forming an
    *uninterrupted run*; the counter agrees with the invoices committed; every
    invoice has its lines. Then five concurrent issues of *one* order.

  **Defect 1 — five tax documents for one order.** The last concurrency test
  failed: five concurrent issues of one order produced five invoices, numbered
  `000022`–`000026`. The service's business-level idempotency was a
  `findFirst`-for-a-live-invoice followed by an insert, and under `READ COMMITTED`
  both branches of that can run before either commits — so all five callers read
  "no existing invoice" and all five inserted. The unit suite could never have
  found this; there was no unit test for the race, because the race is not a
  property of the method in isolation. This is the duplicate-tax-document failure
  the service's own header comment says is worse than a duplicate order, and the
  idempotency guarantee was documented as holding.

  Fixed by locking the order row `FOR UPDATE` (via the existing `uow.lockById`)
  **before** the existence check, both inside the one transaction. Concurrent
  issuers for one order now serialise on the order, so the second reads what the
  first committed. Locking the *order* rather than an invoice row is deliberate:
  on the first issue there is no invoice row to lock, and the order is what the
  invariant is keyed on. The test also asserts the counter moved by exactly 1 — a
  fix applied to the insert but not the counter would still leave four permanent
  gaps.

  **Defect 2 — the same invoice, two different totals.** The replay path returned
  `existing.total.toString()` while the fresh path returned
  `draft.totals.grandTotal`. `Decimal.toString()` drops trailing zeros, so the
  first response said `"236.00"` and the replay said `"236"`. A caller comparing
  the two cannot tell whether the money changed or only its formatting did, and the
  API contract (`DecimalString`) does not say which scale to expect. Added
  `paisa()` to `money.vo.ts` — the stored column rendered at the paisa the domain
  already rounds at — and applied it to every money field leaving the service
  (`getById` totals and lines, `list`, the replay branch). Tax rate and quantity
  are deliberately left on `toString()`: forcing them to two places would invent
  precision they do not have.

  **Defect 3 — mine, and worth recording.** My own reconciliation assertion
  `total + roundOff === Σ lineTotal` was backwards. The builder computes
  `total = raw + roundOff`, so the correct relation is
  `total − roundOff === Σ lineTotal`. It failed on a correct invoice, and had it
  passed it would have passed for a header whose round-off was wrong in the
  opposite direction. Fixed, with a comment explaining the sign, because the whole
  value of this suite is that a failing assertion means something.

  Two fixture problems also surfaced and were fixed rather than worked around: the
  teardown could not cascade (`organisation.tenant` and `invoice.organisation` are
  `Restrict`, so the tenant has to be dismantled leaf-first), and the teardown has
  to run `runUnscoped`, since the scoping extension refuses tenant-scoped models
  with no request context rather than guessing. Both suites use their own tenant
  with fixed ids, tear it down completely, and set the documented
  `medichain.allow_audit_mutation` escape hatch for the `audit_log` rows — inside
  one transaction, so a partial teardown cannot leave rows for the next run.

  **One gap recorded rather than tested around.** `Product.gstRate` is
  `NOT NULL DEFAULT 0`, so a zero-rated line and a line whose rate was never
  entered are indistinguishable, and both produce a zero-tax invoice. 0% is a
  legitimate GST rate, so this is a real data-model gap rather than a fixture
  inconvenience. Noted here and carried into the Phase 3 plan; changing the column
  is a schema decision that belongs with invoicing+, not a test fix.

  **Verified:** typecheck (both configs) ✅ · lint 0 errors, 21 warnings (the
  unchanged baseline) ✅ · module boundaries, 153 files ✅ · unit suite **450/450**
  ✅ · integration 55/55 ✅ · concurrency 11/11 ✅ · **`test:all` 539/539 across 39
  suites** ✅ · **`check:coverage` passed** — all ten critical files ≥96%, global
  53.18% statements / 39.29% branches / 50.32% functions / 53.66% lines.

  **A third failure surfaced in CI, and it was not mine.** Run 45's *Security scans*
  job went **red** — *Dependency audit*, `GHSA-qhr7-859c-m2p7` and
  `GHSA-6j4f-fj2g-mc7p`, both high-severity uncontrolled-recursion DoS in
  `brace-expansion`. Nothing in this pass touched a dependency: the last commit to
  `package.json` was `e178fa7` on 2026-09-14. The advisories were *published* after
  run 44, so a gate that had been green for a month turned red on its own. That is
  the mirror image of the runs-31-to-42 story above and worth naming: a security
  gate going red is not evidence the commit under review caused it, and the useful
  move is to check *when* the finding appeared rather than to start auditing the
  diff.

  Fixed with `overrides` in `package.json` rather than `ACCEPTED` entries in
  `check-audit.mjs`, because these have fixed releases and the allow-list exists
  for advisories that have none. Scoped per major line
  (`brace-expansion@1`/`@2`/`@5`) — a global pin to `1.1.21` also resolves and is
  wrong: it forces `minimatch@10` and the Redocly chain, which need major 5, onto a
  version they do not declare support for, and npm flags that tree invalid. Scoped,
  it resolves with zero invalid edges. One mechanical note for next time: `npm
  install` reports "up to date" and rewrites nothing when only an override changed;
  `npm update brace-expansion` is what applies it.

  Everything else on run 45 was green: *Lint + Typecheck + Boundaries* ✅, *Tests +
  coverage* ✅, *Build* ✅. *Mobile auth (live API)* still fails at *Mobile auth
  flow* — the pre-existing, undiagnosed one.

  **Not verified, and it matters:** run 45 predates the dependency fix, so **the
  audit has not been observed green in CI**. Check after pushing.

  **Resume next session at P8** (Prescriptions). The invoice PDF and the admin
  scheme UI stay deferred — both are screens, not money-path risks.

- **2026-09-29 — completed P7 (invoicing).** Two commits, following the
  domain-first pattern. `9f35924` — pure GST core in
  `backend/src/modules/invoicing/domain/` (`tax.ts`, `invoice.builder.ts`,
  `invoice-numbering.ts`, `invoice.types.ts`): intra-state CGST/SGST vs
  inter-state IGST split, per-line tax summed (never computed on the total),
  HSN summary, whole-rupee round-off within ±0.50, gapless number formatting.
  Tests: hand-picked + invariants + the **1,000 generated-order
  reconcile-to-paisa property test against an independent oracle — the P7 exit
  criterion, green**. `eec34fe` — schema (`Invoice`/`InvoiceLine`/
  `InvoiceSequence`, `gstRate` on Product) + hand-written migration
  `20260929000000_invoicing` (`migrate diff` needs a live shadow DB, none
  reachable), `InvoicingService` issuing from an order in one transaction
  (fail-closed tax data, proportional discount distribution, idempotent
  re-issue, atomic `UPDATE … RETURNING` numbering, audit in-tx), controller +
  DTOs, tenant-scoping registration, AppModule wiring, contract regenerated
  (40 paths / 21 schemas) with invoice shapes in shared-types and an invoices
  endpoint module on the typed client. Verified: typecheck 12/12, lint back to
  the 0-error baseline, boundaries 153 files, unit suite **450/450**.
  Collateral repairs the gates exposed (all pre-existing, none from this
  pass): an `as any` in payment-ledger (deleted — the constructor already
  derives the key set), `prefer-const`/`require()` in its spec, barrel imports
  in credit/payments/invoicing, and two unused imports found in the previous
  pass.
  **Not verified, and it matters:** the invoicing migration has never
  been applied and no DB-backed invoicing test exists — owed before P7 closes.
  **Resume next session at P8** (Prescriptions).
- **2026-09-29 — pushed P7 and observed CI run 43.** `a4ee990..33fe5c2`,
  `main -> main`. Run 43 completed: *Lint + Typecheck + Boundaries* ✅, *Tests
  + coverage* ✅, *Build* ✅, *Security scans* ✅, *Mobile auth (live API)* ❌,
  *Deploy to dev* skipped. Two consequences. First, the P7 invoicing migration
  **does apply cleanly** — *Tests + coverage* migrates the database, so
  `20260929000000_invoicing` is proven sound SQL and the coverage gate passes
  with the new code; what remains owed is local, not structural: DB-backed
  invoicing specs (issue, gapless concurrency, idempotent re-issue) run through
  `test:all` + `check:coverage` on a developer machine. Second, `main` is red
  for the same pre-existing reason as runs 36–42 — the mobile integration suite
  (step 11, *Mobile auth flow*), never diagnosed for lack of the `api.log`
  artifact, which needs an authenticated request this environment cannot make.
  Nothing in this push caused it: every job this push could affect is green.
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
- **Money leaving a service goes through `paisa()`** (`pricing/domain/money.vo.ts`).
  A `Decimal(18,4)` read back through `toString()` drops trailing zeros, so the
  same amount would leave as `"236"` on one path and `"236.00"` on another.
  Tax rates and quantities keep `toString()` — forcing them to two places would
  invent precision they do not have.
- **Database-backed suites get their own tenant** with a fixed id, and tear it
  down completely. Two things bite: `organisation.tenant` and
  `invoice.organisation` are `Restrict`, so the tenant must be dismantled
  leaf-first rather than cascaded, and the teardown needs `runUnscoped` because
  the scoping extension refuses tenant-scoped models with no request context
  rather than guessing. `audit_log` rows need the documented
  `SET LOCAL medichain.allow_audit_mutation = 'on'` — inside the same
  transaction, so a partial teardown cannot leave rows for the next run.
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
  - [x] **Apply `20260926060000_scheme_persistence` to a real database and run
    `test:all` + `check:coverage`** — both done 2026-09-30: the migration applied
    and seeded, `test:all` 539/539, `check:coverage` passed.
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
- [x] **P7 — Invoicing** (tax invoice, gapless numbering, CGST/SGST/IGST, HSN,
  round-off) + 1,000-order reconcile-to-paisa test + DB-backed verification —
  complete except the deferred PDF.
  - [x] Pure domain + reconcile property test (the exit criterion, green).
  - [x] Schema + migration `20260929000000_invoicing` — now **applied to a real
    database and seeded**, locally and in CI.
  - [x] Service (issue/list/get/cancel), controller/DTOs, scoping, module wiring.
  - [x] Contract regenerated (40 paths / 21 schemas) + typed client module.
  - [x] **DB-backed tests**: `invoicing.integration-spec.ts` (26) and
    `invoicing-numbering.concurrency-spec.ts` (7), green through `test:all`
    (539/539) and `check:coverage`. Found and fixed the concurrent double-issue
    and the replay total-scale defect; see the 2026-09-30 session log.
  - [x] **Scheme migration applied** — `20260926060000_scheme_persistence` has now
    run against a real database and been seeded. Owed since 2026-09-27.
  - [ ] **Invoice PDF rendering** — deferred; the invoice is structured data and
    the PDF is presentation, like the deferred admin scheme UI (belongs with
    P11 Admin UI or when fulfilment needs a printable).
  - [ ] **`Product.gstRate` cannot express "rate not set"** — `NOT NULL DEFAULT 0`,
    so a zero-rated line and an un-rated one invoice identically. Carried into the
    Phase 3 plan; changing it is a schema decision, not a test fix.
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
| P3 Scheme scoping/free-goods | complete — engine + persistence; 3 engine defects found by the tests and fixed; **migration now applied and seeded**; admin UI deferred (a screen, not a money-path risk) |
| P4 Stock ledger | done — `Quantity` VO, `Batch` types, immutable `StockLedger` with `Σ(entries) = on_hand` invariant, FEFO allocation; 24 tests green |
| P5 Credit | done — immutable `CreditLedger` with hold/release, `availableCredit = limit − consumed − held`; 17 tests green |
| P6 Payments | done — Payment state machine, idempotency keys, HMAC-SHA256 webhook verification; 22 tests green |
| P7 Invoicing | **done except the deferred PDF and the `gstRate` "not set" gap** — domain, service, API, contract, client, plus 26 integration + 7 concurrency tests; 2 real defects found by them and fixed (concurrent double-issue, replay total scale) |
| P8 Prescriptions | pending |
| P9 Notifications | pending |
| P10 Outbox relay | pending (Phase 1 leftover) |
| P11 Admin UI | pending |
| P12 Mobile | pending |

## Resume point

Next *development* task is **P8** — Prescriptions (upload, pharmacist
verification, schedule-based blocking — server-side enforcement for Schedule
H1, which is its exit criterion).

### 1. ~~Bring the database up and apply the migrations~~ — done 2026-09-30

Closed. The database-backed suites ran, `test:all` is 539/539 and the coverage
gate passed. Two notes for whoever runs it next, since both cost time here:

- **Use the compose file's ports only if you change `.env`.** `infra/docker/docker-compose.yml`
  publishes 5432/6379; `backend/.env` points at 55432/56379, which is what
  `medichain-pg-dev` / `medichain-redis-dev` publish. Bringing up the compose file
  gives a database the tests cannot see, and the failure reads as "can't reach
  database server" rather than as a port mismatch.
- **`db:migrate` is `migrate deploy`, not `migrate dev`**, so it needs no shadow
  database. That is why it could run at all, given no shadow DB was ever reachable.

### 2. Confirm CI is green — do not inherit it from this document

**Still owed, and now the only thing standing between this pass and P8.** Two runs
were checked and both were red, for two different reasons, neither of them the code
under review:

- **Run 45 — *Dependency audit***, on `brace-expansion` advisories published after
  run 44. Fixed in `a311bae`, **not yet observed green**. Check the next run.
- **Runs 36–45 — *Mobile auth flow***, the pre-existing failure below.

Neither is a signal about P7. Both are a signal about not trusting a document —
including this one — to describe the state of a pipeline.

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

### Then P8

P7 and P3 are complete as far as the money path goes. Three items stay open on
purpose, and none of them is a correctness risk:

- **Invoice PDF** — the invoice is structured data and the PDF is presentation.
  Belongs with P11 (Admin UI) or when fulfilment needs a printable.
- **Admin scheme UI** — schemes are data an admin will manage, so until that
  screen exists the only way to create one is SQL. Same reasoning.
- **`Product.gstRate` cannot express "rate not set"** (`NOT NULL DEFAULT 0`). A
  zero-rated line and an un-rated one invoice identically, and 0% is a real GST
  rate, so this belongs with Phase 3's invoicing work rather than being patched
  here.

Recorded as gaps rather than tasks because they are screens and one schema
question — not risks to the numbers.

## Verification (per task)

- `npm run typecheck --workspace=@medichain/backend`
- `npm run lint --workspace=@medichain/backend`
- `npm run test:unit --workspace=@medichain/backend` (or `npm test` for the whole
  unit suite)
- With a database up: `npm run test:all --workspace=@medichain/backend` and
  `npm run check:coverage` — the coverage gate measures every suite, so unit-only
  numbers do not satisfy it.
