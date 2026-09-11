# 00 — Project Status

> **Last updated:** 2026-09-11 · **Branch:** `main` @ `e3a7a74` · **Phase in flight:** 0 (closing out)

A single-glance view of how much is actually built, what has been *verified*
rather than merely written, and what is still open. Where this file and
`05-phases-roadmap.md` disagree, this file is the more current.

---

## 1. Progress at a glance

| Phase | Theme | State | Complete |
|---|---|---|---|
| **0** | Foundation | **Backend built & verified. Closing out.** | ~71% |
| 1 | Core Commerce MVP | Not started | 0% |
| 2 | Commercial Engine | Not started | 0% |
| 3 | Fulfilment & Finance | Not started | 0% |
| 4 | Scale & Mobile GA | Not started | 0% |
| 5 | Intelligence | Not started | 0% |
| 6 | Compliance & Multi-tenant | Not started | 0% |

**Overall: ~10% of the seven-phase programme.**

Phase 0's 71% is not evenly spread. Excluding the three client applications —
which are really Phase 1 deliverable surfaces — the backend foundation is
**~84% complete**. The 16% that remains there is observability, deployment and
the load test, not application logic.

---

## 2. Phase 0 — scope, item by item

19 scope items from `05-phases-roadmap.md`.

### Done and verified

| # | Item | Evidence |
|---|---|---|
| 1 | Monorepo + shared presets | npm workspaces + Turborepo; `npm run build` → 3/3 tasks |
| 2 | Backend skeleton | NestJS 11.2.3; Zod env validation fails at boot with an actionable message |
| 3 | Database | Migration applies cleanly: `citext`, 13 tables, 6 partial indexes |
| 4 | IAM core | Register, login, refresh rotation, reuse detection, logout, sessions |
| 5 | Tenancy | Guard layer + Prisma extension; unclassified models throw |
| 6 | Platform config | `platform_setting`, AES-256-GCM, AAD-bound |
| 7 | Feature flags | DB-backed, seeded |
| 8 | Audit | Append-only via triggers; `UPDATE`/`DELETE`/`TRUNCATE` all raise |
| 9 | Error handling | RFC 9457, correlation ids |
| 10 | Rate limiting | Redis sliding window, fails open (ADR-014) |
| 11 | Health | Liveness vs readiness; 200 → 503 → 200 with Postgres stopped, API never restarting |

### Partial

| # | Item | What exists | What is missing |
|---|---|---|---|
| 12 | Idempotency | Decorator + storage port | Not wired to a single route |
| 13 | Observability | Structured Pino logs | No OpenTelemetry, Prometheus or Sentry — **zero** of those packages are installed |
| 14 | Infra | `docker-compose`, `backend.Dockerfile`, `.dockerignore` | Dockerfile **never built** (Docker was not running); Terraform and k8s are `.gitkeep` placeholders |
| 15 | CI/CD | Workflow runs lint, typecheck, boundaries, tests, coverage, audit, secret scan, build, container scan | No deploy-to-`dev` job; **not yet observed green on a remote run** |
| 16 | Docs / OpenAPI | `openapi:generate` script declared | `src/scripts/generate-openapi.ts` does not exist — the script points at nothing |

### Not started

| # | Item | Note |
|---|---|---|
| 17 | Website skeleton | Folder only — no `package.json`, no code |
| 18 | Admin skeleton | Folder only — no `package.json`, no code |
| 19 | Mobile skeleton | Folder only — no `package.json`, no code |

---

## 3. Phase 0 exit criteria — honest status

| Criterion | State |
|---|---|
| One command brings up backend + website + admin | ✗ Backend only; the other two apps do not exist |
| Register / verify / login / refresh / logout from all three clients | ◐ Verified **against the API directly**; the three clients do not exist |
| `/health/ready` returns 503 when Postgres is stopped | ✓ Verified empirically |
| A mutation writes an audit row with actor + correlation id | ✓ Verified — `auth.login.succeeded` and `auth.refresh.reuse_detected` |
| CI is green on `main` and deploys to `dev` | ◐ Workflow **rewritten and runnable**; no remote run observed yet. No deploy job exists |
| Load test: 100 RPS, p95 < 200 ms | ✗ Not started |
| No secret committed; scanning in CI | ✓ `.env` gitignored, `gitleaks` on every push and PR with full history |

**5 of 7 satisfied or materially satisfied. 2 open.**

---

## 4. Verification actually performed

Everything below was executed, not assumed.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck --workspace=@medichain/backend` | pass (both configs) |
| Lint | `npm run lint --workspace=@medichain/backend` | 0 errors, 20 warnings |
| Unit tests | `npm run test:unit --workspace=@medichain/backend -- --coverage` | **179 passed / 179** |
| Module boundaries | `npm run check:module-boundaries` | pass — 60 files scanned |
| Coverage gate | `npm run check:coverage` | pass |
| Audit gate | `npm run check:audit` | pass — 3 accepted, 0 unaccepted |
| Build | `npm run build` | 3/3 tasks successful |
| Push | `git push origin main` | `baef3f8..e3a7a74` |

### Coverage — the real numbers

Repo-wide, across all of `src`:

| Metric | Value |
|---|---|
| Statements | **17.6%** |
| Branches | 10.6% |
| Functions | 15.4% |
| Lines | 18.1% |

This is low, and it is stated plainly because an earlier draft implied 97.8% —
a figure measured only over the modules that happened to have tests, not over
`src`. The gate is deliberately two-part so that a low global number cannot
hide a hole in something that matters:

- **Critical files — the real gate, ≥90% each:** tenant scoping **98%**,
  envelope encryption **100%**, password policy **100%**, crypto utilities
  **100%**, pagination **100%**.
- **Global ratchet — floors just under today's values:** 16 / 9 / 13 / 16.
  Its job is to stop the number going *down* unnoticed, not to certify quality.

---

## 5. Open items, in priority order

| # | Item | Why it matters | Where |
|---|---|---|---|
| 1 | Confirm CI is green on the remote | The one Phase 0 criterion that needs a real run to close | GitHub Actions |
| 2 | Build the Docker image once | `backend.Dockerfile` has never been executed; CI is its first test | `infra/docker/backend.Dockerfile` |
| 3 | Load test at 100 RPS | Last unmet Phase 0 exit criterion | — |
| 4 | Wire idempotency to a route | Decorator exists, unexercised | `common/decorators/idempotent.decorator.ts` |
| 5 | OpenAPI generation | Script points at a file that does not exist | `backend/src/scripts/` |
| 6 | Observability | No OTel / Prometheus / Sentry at all | `src/infra/observability/` |
| 7 | Deploy job | CI stops at build + container scan | `.github/workflows/ci.yml` |
| 8 | Website / admin / mobile | Three of 19 Phase 0 scope items | `website/`, `admin-portal/`, `mobile/` |

---

## 6. Known accepted risks

| Risk | Why accepted | Revisit |
|---|---|---|
| 3 high `multer` DoS advisories | Reached only via `@nestjs/platform-express`, which pins the vulnerable `2.2.0` exactly. **No upload routes exist**, so the parser is never invoked. npm's suggested fix is a downgrade to Nest 7. | By **2027-03-01**, or when the first upload endpoint lands (Phase 1) |
| 20 ESLint warnings | All `explicit-function-return-type` on decorator factories and config accessors, plus one `no-unsafe-return` inherent to the Prisma extension API. Warnings, not errors. | Opportunistic |
| `npm overrides` does not work in this environment | npm 10.9.7 parses the field and silently ignores it for exactly-pinned transitive deps. Documented in ADR-016 so nobody retries it. | If npm fixes it |

---

## 7. What's next

**Finish Phase 0** (items 1–4 above), then **Phase 1 — Core Commerce MVP**:
a buyer can join, browse, search by salt, and place an order.

Phase 1 needs the three client applications, which is the bulk of the remaining
Phase 0 scope as well — so the two phases overlap in practice and should be
planned together.

---

## 8. Commit history

| Commit | Description |
|---|---|
| `e3a7a74` | docs: ADR-016, Phase 0 corrections, README quickstart |
| `7d8853c` | ci: run npm instead of pnpm; add the Dockerfile CI referenced |
| `bcbeedc` | feat(backend): test suite, architecture gates and lint repair |
| `baef3f8` | feat(backend): Phase 0 foundation — tenancy, IAM, config, audit, health |
| `28a018f` | docs: complete architecture design for the pharma ordering platform |

---

## 9. Unconfirmed assumptions

These are baked into the design and cheap to change now, expensive later:

- Market: **India** (GST, e-way bill, Schedule H/H1/X, drug licence types)
- Currency: **INR**
- Payment gateway: **Razorpay**
- Product name: **MediChain**
