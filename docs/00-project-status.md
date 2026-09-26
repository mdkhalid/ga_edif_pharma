# 00 — Project Status

> **Last updated:** 2026-09-22 · **Branch:** `main` · **Phase in flight:** Phase 1 — the migration applies, the commerce and salt paths are exercised against a real database, and **six of the seven exit criteria are met**; the seventh (placement throughput) meets its latency budget but not its sustained rate on this machine. **Admin MFA is landed end-to-end** — backend TOTP (`203f16f`) plus admin/website/mobile wiring (`221b3ce`) · **CI:** 🟢 **green on `main`** — run 24 is the first successful run in the repository's history, after 23 failures. Four separate defects had to be fixed to get there, and not one of them was a failing test (§5)

A single-glance view of how much is actually built, what has been *verified* rather
than merely written, and what is still open. Where this file and
`05-phases-roadmap.md` disagree, this file is the more current.

---

## 1. Progress at a glance

| Phase | Theme | State | Complete |
|---|---|---|---|
| **0** | Foundation | **Complete but for the `dev` deploy, which needs credentials** | ~98% |
| 1 | Core Commerce MVP | **In flight — six of seven exit criteria met and verified against a real database and a real Redis; admin MFA landed end-to-end; remaining work is UI (wizard, admin screens, mobile storefront) plus the throughput run** | ~80% |
| 2 | Commercial Engine | **In flight — P1 (pure pricing/scheme engine) and P2 (pricing persistence & port) landed and green; P3 (scheme scoping/free-goods) is next** | ~20% |
| 3 | Fulfilment & Finance | Not started | 0% |
| 4 | Scale & Mobile GA | Not started | 0% |
| 5 | Intelligence | Not started | 0% |
| 6 | Compliance & Multi-tenant | Not started | 0% |

**Overall: ~25% of the seven-phase programme.** Two things changed the phase
fundamentally in this pass. The Phase 1 migration had never run — it was invalid
SQL — so nothing above it could be verified; it now applies from scratch, which
unblocked end-to-end testing. And the verification that followed found a real
defect: four concurrent placements of one cart produced four orders.

Every Phase 0 exit criterion but the credential-blocked `dev` deploy is now satisfied —
including the mobile one, which this pass moved from "typecheck only" to a runtime run
against a live API.

---

## 2. Phase 0 — scope, item by item

19 scope items from `05-phases-roadmap.md`.

### Done and verified

| # | Item | Evidence |
|---|---|---|
| 1 | Monorepo + shared presets | npm workspaces + Turborepo; `npm run build` across every workspace |
| 2 | Backend skeleton | NestJS 11.2.3; Zod env validation fails at boot with an actionable message |
| 3 | Database | Migration applies cleanly: `citext`, 13 tables, 6 partial indexes |
| 4 | IAM core | Register, login, refresh rotation, reuse detection, logout, sessions — **plus contact verification and password reset, added in this pass** |
| 5 | Tenancy | Guard layer + Prisma extension; unclassified models throw |
| 6 | Platform config | `platform_setting`, AES-256-GCM, AAD-bound |
| 7 | Feature flags | DB-backed, seeded |
| 8 | Audit | Append-only via triggers; `UPDATE`/`DELETE`/`TRUNCATE` all raise |
| 9 | Error handling | RFC 9457, correlation ids |
| 10 | Rate limiting | Redis sliding window, fails open (ADR-014) |
| 11 | Health | Liveness vs readiness; 200 → 503 → 200 with Postgres stopped, API never restarting |
| 12 | Idempotency | `IdempotencyInterceptor` + `IdempotencyStore` (Redis adapter behind a port); `POST /auth/register` requires `Idempotency-Key` and replays on retry |
| 13 | Observability | Pino logs, Prometheus `/metrics`, OpenTelemetry traces from a preload, Sentry through an `ErrorReporter` port |
| 14 | Infra | `docker-compose`, `backend.Dockerfile`, and new `website.Dockerfile` / `admin.Dockerfile`. Terraform and k8s are still `.gitkeep` placeholders |
| 15 | CI/CD | Runs lint + typecheck across **every** workspace, boundaries, unit tests, coverage, audit, secret scan, build, container scan, OpenAPI generation and a **contract-drift check**; deploy-to-`dev` present and gated |
| 16 | Docs / OpenAPI | 32 paths / 15 schemas, generated from the same definition the server serves |
| 17 | Website | Next 16 App Router, shared design tokens, route groups, BFF auth flow |
| 18 | Admin skeleton | Next 16, RBAC-aware navigation shell |
| 19 | Mobile skeleton | Expo SDK 57, React Navigation 7, Keychain-backed tokens |

### New in this pass

| Item | What landed |
|---|---|
| **Contact verification** | `POST /auth/verify/request` and `POST /auth/verify`. A registered account can finally reach `ACTIVE` — before this, `register()` set `PENDING_VERIFICATION` and **nothing in the codebase ever changed it**. Uses the existing `otp_challenge` table, so no migration was needed |
| **Password reset** | `POST /auth/password/forgot` and `POST /auth/password/reset`. No account enumeration, policy checked before the code is consumed, argon2 spent only after the code is accepted, and every session revoked |
| **Mobile auth verified at runtime** | `mobile/test/auth.integration-spec.ts` — jest + ts-jest in the mobile workspace, driving the app's real client code against a live API, with the platform's Keychain replaced by an in-memory stand-in. Wired into CI as the `mobile-e2e` job |
| **Shared packages** | `@medichain/config` (nextjs + react-native tsconfig, shared ESLint flat config, Tailwind 4 theme), `@medichain/api-client` (generated from OpenAPI), `@medichain/ui` |
| **Client applications** | website, admin portal, mobile — each with a working auth flow, not a stub |
| **Load test** | autocannon runner + k6 script + `load-test` workflow |
| **Coverage** | Floors raised from 16/9/13/16 to **38/26/27/37**; three new security-critical modules added to the gate, all at 100% |

---

## 3. Phase 0 exit criteria — honest status

| Criterion | State | Evidence |
|---|---|---|
| One command brings up backend + website + admin | ✓ | `npm run dev`; :3000, :3001 and :3002 all answered |
| Register / verify / login / refresh / logout from all three clients | ✓ | Website and admin verified end-to-end against a live API (cookie set and rotated, session revoked on sign-out, cross-origin refused). **Mobile is now verified at runtime too** — `mobile/test/auth.integration-spec.ts` (7 cases) drives register → verify → sign in → cold-start token rotation → sign out against a live API, plus the single-flight refresh and the replay detection that revokes a token family. The run is headless: the app's real client code and HTTP calls, with the platform's Keychain replaced by an in-memory stand-in. **The screens have still not been rendered on a device or simulator — none exists in this environment** |
| `/health/ready` returns 503 when Postgres is stopped | ✓ | Verified empirically |
| A mutation writes an audit row with actor + correlation id | ✓ | `auth.login.succeeded`, `auth.refresh.reuse_detected`, `auth.verify.succeeded`, `auth.password.reset` |
| CI is green on `main` | ✓ | **Run 24 (`0586fe3`) — the first green run in 24 attempts.** Every job passed: lint and typecheck across every workspace, module boundaries, secret scan, dependency audit, Semgrep, 331 tests plus the coverage gate against real PostgreSQL and Redis, the monorepo build, OpenAPI generation, the contract-drift check, the backend image build and the Trivy scan. Reaching it needed four separate fixes and none of them was a failing test (§5) |
| Deploys to `dev` automatically | ✗ | Job exists and reports what is missing; gated on `DEV_DATABASE_URL` / `KUBE_CONFIG`. **The one open criterion — blocked on credentials, not code** |
| Load test: 100 RPS, p95 < 200 ms | ✓ | 1,500 requests at 100 RPS over 15 s on `GET /auth/me`; zero errors; p50 9 ms, **p97.5 23 ms**, p99 26 ms |
| No secret committed; scanning in CI | ✓ | `.env` gitignored; `gitleaks` on every push and PR over full history |
| Security-critical code unit-tested and gated | ✓ | 331 tests / 22 suites, including the database-backed integration, concurrency and tenant-isolation suites; eight security-critical modules still held to ≥90% |
| No unreviewed high-severity advisory ships | ✓ | `check:audit` passes; 3 accepted `multer` DoS advisories with reasons and a review date |

**9 satisfied · 1 open.** The open one needs a `dev` estate to exist before it can be
satisfied. What the mobile criterion does **not** cover is stated with it: the app's UI
has never been rendered on a device, only its auth flow executed headlessly.

---

## 4. Verification actually performed

Everything below was executed in this environment, not assumed.

| Check | Command | Result |
|---|---|---|
| Shared packages build | `npm run build:shared` | pass |
| API client generation | `npm run api-client:generate` | 32 paths → `src/generated/schema.ts` |
| Backend typecheck | `npm run typecheck --workspace=@medichain/backend` | pass (both configs) |
| Backend lint | `npm run lint --workspace=@medichain/backend` | 0 errors, 21 warnings (the baseline plus one more of the same `explicit-function-return-type` kind) |
| Unit tests | `npm run test:unit --workspace=@medichain/backend -- --coverage` | **275 passed / 275**, 15 suites |
| All suites | `npm run test:all --workspace=@medichain/backend` | **331 passed / 331**, 22 suites (unit + integration + concurrency + isolation) |
| Coverage gate | `npm run check:coverage` | pass — 8 critical files all ≥90%, global 41.60/29.62/34.95/41.58 against floors of 38/26/27/37 |
| Module boundaries | `npm run check:module-boundaries` | pass — 118 files scanned |
| Dependency audit | `npm run check:audit` | pass — 3 accepted, 0 unaccepted |
| Backend build | `npm run build --workspace=@medichain/backend` | pass |
| OpenAPI generation | `npm run openapi:generate` | **32 paths, 15 schemas** |
| Website build | `npm run build --workspace=@medichain/website` | pass — 16 routes. **It did not, before this pass**: the cart, checkout and order-history pages were server components calling client-only hooks, with the typed client used as `api.cart.get()` (there is no such namespace) and `useMutation` destructured as a tuple. Three pages, one commit |
| Admin build | `npm run build --workspace=@medichain/admin-portal` | pass — 11 routes |
| Full monorepo | `npm run build` / `npm run typecheck` / `npm run lint` | **7/7, 12/12 and 8/8 tasks successful** — the workspace-wide build, typecheck and lint all pass for the first time in this pass |
| Website / admin lint | `npm run lint --workspace=@medichain/website` and `…admin-portal` | 0 problems |
| Mobile typecheck | `npm run typecheck --workspace=@medichain/mobile` | pass |
| Mobile lint | `npm run lint --workspace=@medichain/mobile` | pass |
| Expo config resolves | `npx expo config --type public` | SDK 57, `expo-secure-store` plugin |
| Database | `npm run db:migrate` / `db:seed` against PostgreSQL 17 | migration current; seed idempotent |
| **IAM end to end** | register → verify → login → reset against a live API | **pass** — including single-use code, wrong-code rejection, no enumeration on `forgot`, old password refused, sessions revoked |
| **Web BFF end to end** | login / refresh / logout on :3000 and :3002 | **pass** — cookie set and rotated, session revoked, cross-origin refused |
| **Storefront routing** | `next start` on the built website, probed path by path | **pass** — `/products`, `/salt-search` and `/dashboard` answer `307` to `/login?next=…` with no refresh cookie and `200` with one; `/` and `/login` stay `200` either way |
| **Load test** | `LOAD_PASSWORD=… npm run load:local` | **pass** — 100 RPS, p97.5 23 ms, 0 errors |
| **Integration / concurrency suites** | `npm run test:all --workspace=@medichain/backend` | **pass** — 33 database-backed cases against PostgreSQL 17 and Redis 7, covering all but one exit criterion (§7) |
| **Order placement under load** | `npm run load:orders` | **p95 62.6 ms** against an 800 ms budget, 0 failures; the sustained *rate* did not reproduce locally (§7) |
| **Mobile auth flow** | `npm run test:integration --workspace=@medichain/mobile` against a live API | **pass** — 7 cases: register → verify (a wrong code rejected first) → sign in → cold-start token rotation → sign out, plus the concurrent-401 single-flight guard and replay detection revoking a token family |
| **MFA client slice** | Direct `tsc --noEmit` (admin, website, mobile, api-client), `eslint` (admin, website, mobile), `next build` (admin, website), backend unit `mfa totp` | **pass** — admin build lists `/api/auth/mfa/setup|confirm|login`; 323 unit tests incl. `mfa`/`totp`/`mfa-policy` |

> **These rows are local — and as of run 24, no longer only local.** Every one ran in
> *this* sandbox, against throwaway PostgreSQL and Redis containers. The same suite and
> the same coverage gate now run on a GitHub runner as well, which is what turns them from
> a claim into a check. It took four fixes to get there (§5): before them the pipeline had
> failed all 23 of its runs, so none of this had been verified anywhere but a developer's
> machine.
>
> The mobile row is the exception: it has a CI job (`mobile-e2e`) that starts the API and
> runs the suite, but that job has not yet run on a runner — so the mobile result is, for
> now, this sandbox only.

### Coverage — the real numbers

| Metric | Phase 0 | Phase 1 |
|---|---|---|
| Statements | 39.1% | **41.60%** |
| Branches | 27.7% | **29.62%** |
| Functions | 28.6% | **34.95%** |
| Lines | 38.5% | **41.58%** |

The Phase 0 column is worth reading with care, because it was wrong in a way the
gate did not catch: the floor (38/26/27/37) had been chosen from a measurement
taken before the Phase 1 services existed, and those services are covered by the
database-backed suites. Measured with the unit suite alone — which is what the
gate used to run — the repo reports **35.15%** against a 38% floor, and CI would
have failed. The gate now runs every suite (`npm run test:all`), which is where
those files are actually exercised; the CI job gained PostgreSQL and Redis
services to make that possible.

The gate is deliberately two-part, so a low global number cannot hide a hole in
something that matters:

- **Critical files — the real gate, ≥90% each:** tenant scoping 100%, envelope
  encryption 100%, password policy 100%, crypto utilities 100%, pagination 100%,
  one-time codes 100%, contact verification 100%, password reset 100%.
- **Global ratchet:** 38 / 26 / 27 / 37. Its job is to stop the number going
  *down* unnoticed, not to certify quality. The repo-wide figure is low because
  most of `src` belongs to phases that do not exist yet.

---

## 5. Open items, in priority order

| # | Item | Why it matters | Where |
|---|---|---|---|
| 1 | **Provision `DEV_DATABASE_URL` / `KUBE_CONFIG`** | Without them the deploy-to-`dev` job reports that it is skipped — the last open Phase 0 criterion. Confirmed as of this pass: there is no `dev` estate yet, so these are not *missing* credentials so much as *uncreated* ones. A dev Postgres and cluster have to exist before any secret can point at them | GitHub → Environments → `dev` |
| 2 | **Set `LOAD_TEST_BASE_URL` / `LOAD_TEST_PASSWORD`** | Without them the weekly k6 job reports that it is skipped | GitHub → Secrets |
| 3 | **Render the mobile app on a device** | The auth flow is now verified at runtime headlessly; only the UI layer has never been rendered, and a device is the only way to exercise the real Keychain | `npm run dev:mobile` |
| 4 | **Admin MFA — closed 2026-09-22** | Landed: backend TOTP enrolment + second-factor sign-in (`203f16f`), wired through the admin BFF/login UI, website challenge handling and mobile guard (`221b3ce`) | — |
| 5 | **The remaining `test-concurrency` money-path cases** | The oversell case is covered. Credit limits, the stock-ledger invariant and duplicate-webhook credit are not | `backend/test/concurrency/` |
| 6 | **The `contract` and `test-e2e` jobs** | The OpenAPI diff and regenerated client are enforced inside the Build job; breaking-change detection and consumer-driven tests are still owed, and `test/e2e` has no specs | parked block in `ci.yml` |

One known-debt note that does not appear as an open item, because it breaks nothing
today: a full-history `gitleaks` scan reports **six** `generic-api-key` hits beyond the
one this pass fixed. Three are the seed catalogue's product-slug `key:` values, and three
are the token-shaped request-header examples in `docs/07` (plus the `openapi:generate`
key in the Build job). All are false positives, and none of them fails the build, because
`gitleaks-action` scans the commits in a push rather than the whole history. They will
need an allowlist with reasons before that scan is ever widened.

Writing this paragraph turned out to be its own demonstration of the problem: the first
version quoted the offending patterns as examples, and the secret scan failed the commit
that documented it. A `generic-api-key` match is a *shape*, not a secret, and prose that
reproduces the shape is indistinguishable from the thing it is describing — which is
precisely why the repair for those six is a reasoned allowlist rather than looser prose.

### How CI was fixed — four defects, and not one of them a test

The workflow had **never passed a single run** in 23 attempts. Four separate defects had
to be cleared, and fixing each one only revealed the next, because the steps and jobs it
had been blocking finally ran. In order:

**1. The test job died at the seed, before running a single test.** It failed at:

```
- name: Migrate and seed the test database
  run: |
    npm run db:migrate
    npm run db:seed
```

`seedPlatformSettings` encrypts the `SECRET` rows of `platform_setting` at rest, so it
calls `buildKeyring(process.env)` — and the `test-unit` job declared only `NODE_ENV`,
`DATABASE_URL` and `REDIS_URL`. With no `ENCRYPTION_KEY`, the seed threw
`ConfigurationError: ENCRYPTION_KEY is not set` and exited 1. GitHub skips the steps
after a failed one, so **Tests**, **Enforce coverage floors** and the whole **Build**
job were skipped on every push. The suite that this document describes at length had
never run in CI.

It survived because it is invisible locally in the most convincing way: `backend/.env`
supplies `ENCRYPTION_KEY`, and Prisma Client loads that file itself. So the seed passes
on every developer machine and on the machine the Phase 0 verification ran on. CI has no
`.env` *by design* — `ignoreEnvFile: NODE_ENV === 'test'` in `app-config.module.ts` —
which is exactly the difference that mattered.

Reproduced by running the two commands with `backend/.env` moved aside, against an empty
PostgreSQL 17 container and declaring only the three variables the job declared:

```
ConfigurationError: ENCRYPTION_KEY is not set.
    at buildKeyring (src/common/utils/encryption.service.ts:72:11)
    at seedPlatformSettings (prisma/seeds/platform-settings.seed.ts:197:56)
```

Fixed by giving the job a key — first as a literal, which was itself a mistake, and then
by generating one per run, for the reason in defect 2.

**2. The Security job failed on a secret that was not one.** Supplying the key as a
literal put a `generic-api-key` finding in `ci.yml`, and gitleaks failed the scan that
had been passing. The value is a test fixture, but secret scanning cannot know that, and
adding the workflow to an allowlist would be the wrong repair — it is the one file where
a real credential would do the most damage. The key is now generated per run and exported
through `$GITHUB_ENV`; nothing needs it to persist, because the database it protects is
created from empty every time.

**3. The Build job failed on contract drift that had never been checked.** Build `needs`
the test job, so it had been skipped on every previous push — meaning the drift check had
never once executed on a runner. `packages/api-client/src/generated/schema.ts` was stale
in exactly one line: the summary for `GET /orders/:id` still read "Get an order with its
lines", while `backend/openapi.json` and the controller had said "…and status history"
since the commit that added `order_status_history`. Regenerated from the document, which
the generation leaves unchanged.

**4. The container scan failed because it was not scanning what it said it scanned.**
`severity: CRITICAL` was being discarded: with `format: sarif`, `trivy-action`'s
`entrypoint.sh` runs `unset TRIVY_SEVERITY` unless `limit-severities-for-sarif` is true.
So the scan ran at every severity and exited 1 on the three accepted `multer` HIGHs that
the comment directly above it assigns to the audit gate. The image is clean at CRITICAL —
0 criticals, confirmed by scanning the built image locally — and
`limit-severities-for-sarif: true` makes the step do what its own comment has claimed
since it was written. It also narrows what reaches code scanning, which had been
receiving every severity.

Run 24 (`0586fe3`) then passed every job. The lesson worth keeping is the one the previous
commit in this file drew about a stale comment: *a document that asserts a check is green
is worse than no document, because it is the thing a reader trusts instead of running.*
This document asserted it about a check that was failing.

### Closed since the last pass

| Item | What was done |
|---|---|
| **`middleware.ts` → `proxy.ts`** | Renamed in both web apps, and the exported handler renamed to `proxy` — Next 16 resolves `mod.proxy` for a `proxy.ts` file and throws `ProxyMissingExportError` otherwise. Both apps build with `ƒ Proxy (Middleware)` and no deprecation warning, and the redirects were re-probed on the built app: `/products`, `/salt-search`, `/dashboard` → 307, `/` and `/login` → 200 |
| **The `test-isolation` suite** | Written — 23 cases in `backend/test/isolation/cross-tenant-access.isolation-spec.ts`, against a real database, covering the read, write, aggregate and count shapes plus `findUnique` returning null (404, not 403). It now also runs in CI, because `jest.all.config.js` includes `test/isolation` |
| **The Docker images** | All three built for the first time — `backend`, `website` and `admin`. Building them exposed three real defects in the two web images that no amount of reading the Dockerfiles would have found; see below |
| **The stale "runs on the edge" comments** | Both `lib/auth/cookies.ts` files and the storefront layout justified being dependency-free by claiming the file runs on the edge runtime. Next 16 states the opposite — "Proxy always runs on Node.js runtime" — so the reasoning was corrected rather than carried across the rename |

### What building the Docker images found

The Phase 0 item was "build the Docker images once", carried because no Docker daemon
was available during that pass. It turned out to be the highest-yield item here: **both
web images were unbuildable**, and neither defect is visible by reading the files.

**1. `npm ci` failed in both web images.** A root workspace install runs every
workspace's lifecycle scripts, and `backend` has `postinstall: prisma generate`. npm runs
a workspace's scripts with *that workspace* as the working directory, so Prisma resolved
`./prisma/schema.prisma` — and the web Dockerfiles copied `backend/package.json` but
never `backend/prisma`:

```
npm error Error: Could not find Prisma Schema that is required for this command.
npm error   prisma/schema.prisma: file not found
```

`backend.Dockerfile` had this right, with a comment explaining exactly why. The two web
Dockerfiles omitted the line.

**2. The admin image died at its last step.** `COPY /repo/admin-portal/public` has no
source, because that directory does not exist in the repository — the admin portal has no
static assets. The website's Dockerfile carried a comment claiming "creating it keeps the
COPY valid when the app has no static assets yet", in a file that created nothing; it
worked only because `website/public` happens to exist.

**3. Both web containers were permanently unhealthy.** Once built and running, the health
check exited 1 on *every* attempt while the app served `/` → 200 and `/products` → 307
through the published port. Next's standalone server binds to `process.env.HOSTNAME`, and
Docker sets `HOSTNAME` to the container id — so `127.0.0.1` is never bound.
`ENV HOSTNAME=0.0.0.0` is the fix, and it is the one that matters most in production: an
orchestrator would have seen a permanently unhealthy container and either restarted it in
a loop or withheld traffic from a working one.

All three are fixed. Both web images build and report `healthy`; the website image was
verified by running it, probing `/`, `/login` and `/products`, and confirming it serves
as the non-root `nextjs` user (uid 1001).

---

## 6. Accepted risks

| Risk | Why accepted | Revisit |
|---|---|---|
| 3 high `multer` DoS advisories | Reached only via `@nestjs/platform-express`, which pins the vulnerable `2.2.0` exactly. **No upload routes exist**, so the parser is never invoked. npm's suggested fix is a downgrade to Nest 7. | By **2027-03-01**, or when the first upload endpoint lands (Phase 1) |
| 21 ESLint warnings (backend) | All `explicit-function-return-type` on decorator factories and config accessors — including the one added by the new notifications accessor — plus one `no-unsafe-return` inherent to the Prisma extension API. Warnings, not errors, and CI enforces no warning budget. Two rules are relaxed for `backend/test/**` so Jest's `any`-typed matchers do not inflate the count | Opportunistic |
| `npm overrides` does not work in this environment | npm 10.9.7 parses the field and silently ignores it for exactly-pinned transitive deps. Documented in ADR-016 so nobody retries it | If npm fixes it |

Resolved and removed from this table: the Next 16 `middleware.ts` deprecation. The file
convention still worked and only warned, so it was carried as accepted risk — it is now
renamed to `proxy.ts` in both apps (§5).

---

## 7. Phase 1 — exit criteria

**Phase 1 — Core Commerce MVP.** Six of the seven exit criteria are met, and each
one has a test behind it rather than a claim. The full evidence is in
[05-phases-roadmap.md](05-phases-roadmap.md); this is the summary.

| # | Criterion | State |
|---|---|---|
| 1 | A new distributor completes onboarding and is approved end-to-end | ✅ approval creates the org's first administrator (wizard/document upload remain UI scope) |
| 2 | Salt combination search works, and a typo still finds Paracetamol | ✅ `pg_trgm`, including composition-only hits such as `Dolo 650mg` |
| 3 | The same `Idempotency-Key` twice creates one order | ✅ against a real Redis; the retry replays the first response |
| 4 | Concurrent placement on the last unit never oversells | ✅ four buyers, two units, exactly two win |
| 5 | An order triggers an email **and** an SMS within 30 s | 🟡 the fan-out is verified end-to-end; the 30 s bound is not measurable here (no provider is reachable) |
| 6 | Order placement p95 < 800 ms at 200 RPS sustained | ❌ p95 62.6 ms — the budget is met — but the sustained rate did not reproduce locally |
| 7 | 100% of order transitions in `order_status_history` with an actor | ✅ |

### What this pass changed

**The Phase 1 migration had never run.** It was hand-written SQL containing Prisma
schema syntax (`@map`, `@updatedAt`) and camelCase column names that contradicted
the schema's own `snake_case` rule, so `prisma migrate deploy` stopped at the first
column. Nothing above it could be verified, which is why no criterion was met
before. Regenerated from the schema; all three migrations now apply from scratch.

**`order_status_history` did not exist**, though a criterion requires every
transition to appear in it. Added, written inside the same transaction as each
status change, and exposed on `GET /orders/:id`.

**Typo tolerance.** `Paracetmol` now finds Paracetamol, matching the same three
sources the exact pass uses (name, salt aliases, composition names) so brand names
like `Dolo 650mg` are found too. Two details mattered: `array_to_string` is STABLE
rather than IMMUTABLE so it cannot be indexed directly, and pg_trgm's default
threshold is 0.6 while the commonest typo of this salt (`parasetamol`) scores
exactly 0.600 — so the default silently misses it.

**A real defect: one cart produced four orders.** Placement locked the cart but
never re-read its status after taking the lock, so every caller that had already
read the cart as `ACTIVE` went on to place its own order. Four concurrent
placements produced four orders and reserved four times the stock. The concurrency
suite was written first, failed, and passes after the fix.

**Real email and SMS transports.** SMTP through `nodemailer` and MSG91/Twilio over
plain `fetch`, selected from configuration and logged at boot. `sendOrderPlaced`
stays best-effort across both channels; `sendOtp` throws on failure, because
reporting "code sent" when it was not leaves the user waiting for nothing.

**Approval provisions the administrator.** The scope says "approval → org + user
creation" and only the org half existed. The account is created
`PENDING_VERIFICATION` with a password nobody knows, and claimed through the
existing reset flow — so nobody, including the approver, ever holds another
person's credential.

**The coverage gate was failing.** The floor had been chosen before the Phase 1
services existed, and those services are covered by the database-backed suites, so
measuring the unit suite alone reported them as 0% (35.15% against a 38% floor).
The gate now measures every suite, and passes at 41.56%. The figure is a little
lower than the 43.98% an earlier run of this pass reported, and the reason is
worth keeping: the order-placement load harness lives in `src/scripts/` and is
counted, so it dilutes the total without being exercised. That is left alone
rather than excluded — widening the coverage exclusions to lift a number is the
wrong direction, and the gate passes either way.

**An order-placement load harness** (`npm run load:orders`) that pre-provisions a
pool of buyers, drives placement at a target rate, and fails if the rate is not
reached rather than quietly reporting latency for load that never arrived.

### Open, in priority order

| # | Item | Why it matters | Where |
|---|---|---|---|
| 1 | Placement throughput on real disk | The one unmet criterion. The latency budget is met with large headroom; the rate needs a staging run | `npm run load:orders` on staging |
| 2 | The 30 s notification bound | No mail or SMS provider is reachable here, so delivery timing is unmeasured | a staging provider |
| 3 | Admin UI screens, onboarding wizard, document upload | The remaining Phase 1 scope is UI | `admin-portal/`, `website/` |
| 4 | Mobile storefront | Auth shell only; never run on a device in this environment | `mobile/` |
| 5 | Outbox relay | Notification delivery is best-effort with no durable retry | Phase 2 |
| 6 | Confirm remote CI green | Every local gate passes; the workflow has still never run on a runner | push, then GitHub Actions |
| 7 | `DEV_DATABASE_URL` / `KUBE_CONFIG` | The last open Phase 0 criterion | GitHub → Environments → `dev` |
| 8 | Admin MFA — closed 2026-09-22 | Backend TOTP enrolment + challenge sign-in (`203f16f`); admin BFF + 3-step login UI, website union handling, mobile guard (`221b3ce`). Verified: direct typecheck ×4, lint ×3, `next build` ×2, 323 backend unit tests incl. `mfa`/`totp`/`mfa-policy` | — |
| 9 | `test-isolation` / `test-concurrency` suites | Configs exist; `test/concurrency` now has specs, `test-isolation` does not | parked block in `ci.yml` |

### Local environment used for this verification

PostgreSQL 17 and Redis 7 run as throwaway containers (`medichain-pg-dev`,
`medichain-redis-dev`); the database is created by `prisma migrate reset` and
seeded by `prisma db seed`. `backend/.env` points at them and is gitignored. Note
that this sandbox's shell has `NODE_ENV=production` set, and dotenv does not
override it — so development and test commands must set `NODE_ENV` explicitly, or
the env schema refuses to boot with the console SMS provider.

---

## 8. Commits in this pass

The table above describes the *previous* pass. It was wrong about one thing, and the
correction is the most important entry in this document: it said "all local; nothing has
been pushed, so the remote workflow is still unobserved". Both halves were false. The
repository is public, `main` is at `6087ca9` on the remote, and the workflow had run
**21 times** — the last five against `main` all failing at the seed step (§5). "Not yet
observed" and "observed, and red every time" need very different responses, and the
document chose the wrong one.

| Commit | Change |
|---|---|
| `fix(db)` | Replaced the invalid Phase 1 migration with one generated from the schema; corrected six `snake_case` column mappings; added `order_status_history`; removed a captured error log misnamed `phase1_migration.sql` |
| `feat(orders)` | Records `order_status_history` on placement and on every transition; exposed on `GET /orders/:id` |
| `feat(search)` | `pg_trgm` typo-tolerant salt search — the immutable wrapper, and an explicit threshold because the default silently misses `parasetamol` |
| `fix(orders)` | **One cart produces one order** — the concurrent double-placement defect, found by the suite committed with the fix |
| `test(orders)` | Integration coverage for the order-history criterion |
| `feat(notifications)` | Real SMTP (`nodemailer`) and MSG91/Twilio transports, replacing the log-only adapter |
| `fix(ci)` | The coverage gate measured the unit suite alone — and was failing. It now measures every suite, with PostgreSQL and Redis services in the job |
| `test(orders)` | Idempotency proved against a real Redis |
| `feat(onboarding)` | Approval provisions the organisation's administrator, so "approved" means someone can be given access |
| `test(orders)` | The order-placement load harness |
| `203f16f` `feat(auth)` | Backend admin TOTP: pure-Node RFC 6238, role-based enrolment policy, encrypted pending secrets, single-use recovery codes, five-minute challenge redeemed at `/auth/mfa/login`; `totp.ts` and `mfa.service.ts` held at 90% by the coverage gate |
| `221b3ce` `feat(auth)` | MFA client wiring: admin 3-step login UI + BFF `mfa/setup|confirm|login` routes, website `SignInResult` handling with no session on challenge, mobile loud-fail guard, typed `api-client` MFA endpoints |

---

## 9. Unconfirmed assumptions

These are baked into the design and cheap to change now, expensive later:

- Market: **India** (GST, e-way bill, Schedule H/H1/X, drug licence types)
- Currency: **INR**
- Payment gateway: **Razorpay**
- Product name: **MediChain**
