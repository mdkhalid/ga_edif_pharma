# 20 — Shortfalls, Estimates and Future Work

> **Last updated:** 2026-11-27 · **Branch:** `main` (pushed on 2026-11-27; A1, A2, A11 and A12 closed) ·
> **Purpose:** the honest backlog for work that is *not done yet*. This file
> records gaps found during the 2026-11-25 pass, rough estimates, blockers, and
> the order I recommend taking them in.
>
> `19-development-plan-phase2.md` remains the **current plan** for Phase 2;
> `00-project-status.md` remains the **status record**. Where this file and an
> aspirational README disagree, **this file is the reality check**. Update it as
> work proceeds: flip `[ ]` to `[x]`, record actual effort against the estimate,
> and link the commit. Never inherit "CI green" from a document — check the run.

## Why this file exists

The 2026-11-25 pass closed Phase 2's remaining admin screens and the deferred
invoice PDF, then started P12 Mobile with order history + reorder. It also
exposed a pattern worth recording: several documents describe a design that is
only partly implemented, and several claims of verification were stronger than
the evidence. Those gaps are not defects in the money path, but they are real.
Keeping them in one file stops them being rediscovered — and re-estimated —
from scratch every session.

---

## Scope A — design, documentation and verification shortfalls

**Estimated total: 10.5–23 working days** for one developer, excluding review/PR
cycles and waiting on external access. The range grew on 2026-11-25 after CI run
57 exposed two more red gates (A9, A10), and again on 2026-11-26 when the P6
payments claim was found to be false (A11) and an unaudited Swagger DTO class of
defect was recorded (A12). A1, A2, A11 and A12 are closed. Blockers are called out per row;
a blocked item does not consume effort until unblocked.

| ID | Item | Current state | Why it matters | Estimate | Blocked by | Status |
|---|---|---|---|---:|---|---|
| **A1** | Reconcile docs with the code | Closed 2026-11-26: all READMEs and docs 01/02/03/05/07/08/09/10/12/14/15 now use npm (ADR-016) and state reality — Next 16 (ADR-017), plain HTML tables, Jest, no e2e runner; TanStack Table, Recharts, shadcn/ui, React Hook Form, next-intl, FlashList, MMKV, BullMQ/Kysely, Testcontainers and Playwright/Vitest are marked as target intent or absent. The root README's stale 🟢 CI claim now points at the red run 57 | A document that asserts what is not true is worse than no document — it is what a reader trusts instead of checking | 0.5–1 d | — | [x] — ~0.5 d actual (`db825fe`) |
| **A2** | Contract-level tests for `@medichain/api-client` | Closed 2026-11-26: 55 contract tests in `packages/api-client/test`, wired into the CI Tests + coverage job. They cover pagination `meta` on all eight paged endpoints (reintroducing the defect fails the suite), path/query/header/body serialisation, problem → `ApiError`, the PDF `Blob` path, and the committed OpenAPI/generated-client seam. An injected fetch means no live API is needed | The client is the seam between a correct backend and a working screen; it is currently unverified | 0.5–1 d | — | [x] — ~0.5 d actual (`c3dfcc1`) |
| **A3** | Playwright e2e for admin key journeys | No e2e specs or runner. Admin screens are verified by typecheck, lint and `next build` only — no browser has rendered them here | A build proves compilation, not that a table shows rows or a PDF button downloads | 2–4 d | Seeded DB + staff fixture with the right capabilities | [ ] |
| **A4** | Diagnose the red `mobile-e2e` CI job | Failed at *Mobile auth flow* since run 36; never diagnosed. Run 56 was red before this session's push; run 57 was still in progress at the time of writing | `main` is not green, so no completion claim is trustworthy | 0.5–2 d | **Hard blocker:** the `mobile-e2e-api-log` artifact and job logs need an authenticated GitHub request (`gh` is not installed and no token is available here). Do not guess from the step name — the base URL/port is already ruled out | [ ] |
| **A5** | Mobile device/simulator smoke run | Auth flow is exercised headlessly (`mobile/test/auth.integration-spec.ts`, 7 cases); no screen has been rendered on a device. New Orders tab is typechecked/linted only | Native storage, layout and tab navigation can fail in ways a headless client cannot see | 1–3 d | **Hard blocker:** no device or simulator exists in this environment | [ ] |
| **A6** | Saga orchestration, one real flow | Listed in `docs/11-design-patterns-and-solid.md` as used; no saga exists | Needed when a multi-step Phase 3 flow (payment + stock + fulfilment) must compensate on failure | 1–2 d | A concrete flow to orchestrate — do not build it speculatively | [ ] |
| **A7** | Circuit breaker + bulkhead for outbound transports | Email, SMS and push have transports and best-effort/strict paths, but no breaker or resource isolation | Useful only once real providers are reachable; without them this is complexity with no consumer | 1–2 d | A real SMTP/SMS/push provider and defined failure budgets | [ ] |
| **A8** | Anti-corruption layer for gateway payloads | Raw gateway responses are not translated behind a domain-shaped port | Needed before Razorpay/SMSG91 payload shapes leak into domain code | 1–2 d | A concrete gateway integration to wrap | [ ] |
| **A9** | Clear the dependency-audit gate | Run 57's *Dependency audit* failed; `npm run check:audit` reports **23 blocking advisories** (Next 16 RCE/SSRF group, node-forge ×8, sharp, zod, grpc-js, shell-quote, source-map-js, systeminformation, proxy-addr, body-parser, decode-uri-component) beyond the three accepted `multer` entries | No completion claim is trustworthy while the gate is red. The last dependency change was months ago, so these are newly published advisories, not this session's code | 1–3 d | Registry access for version bumps; NO `npm install` inside the sandbox — its cleanup is unreliable | [ ] |
| **A10** | Clear the container-scan gate | Run 57's *Container scan (Trivy)* failed at *Build*, while *Build backend image* itself passed | Same shape as A9: likely newly published base-image CVEs, not a Dockerfile change from this session | 0.5–2 d | Trivy binary or CI job log to see which image/package is flagged; not installed locally | [ ] |
| **A11** | Re-open the P6 Payments "done" claim | Closed 2026-11-27 (`926b287`): `Payment`/`PaymentEvent` models + hand-written migration, tenant-scoping registration, repository port + Prisma adapter, mock gateway adapter, `PaymentService` (order-priced intent, replay by key, signed webhooks, refund), controller with five routes (`/payments/intents`, `/payments`, `/payments/{id}`, `/payments/{id}/refund`, `/payments/webhooks`), typed `createPaymentsApi`, shared response shapes. Duplicate webhooks are rejected by a unique `gateway_event_id` index inside the same transaction that appends the ledger row; invalid signatures → 400, no DB read. Contract 65 paths / 32 schemas; backend unit 472/472, api-client 76/76; typecheck/lint/build/boundaries green. **Not verified:** no DB-backed suite (Docker daemon unavailable), so the unique-index behaviour is asserted at the service seam only, and no admin payment screen yet (that is B2 scope) | Payments is a money path — a false "done" is worse than a known gap, and the admin/website have no payment screen | 2–4 d to implement end to end; 0.25 d to reconcile the docs if deferred | None for the code, but DB-backed tests need a running Postgres (Docker daemon unavailable here) | [x] — ~1 d actual (`926b287`) |
| **A12** | Audit Swagger DTOs for untyped optional fields | Closed 2026-11-27: audited all 13 backend DTO files and the whole committed OpenAPI document. No further untyped optional fields: every union/array field already carries an explicit `type`/`nullable`/`enum` (or reflects to a usable array type), and no object or array schema lacks a shape. Two contract tests in `packages/api-client/test/contract.spec.ts` now scan the document and the generated client; both were verified to fail when the defect is reintroduced. api-client 63/63 tests, typecheck ✅ | The same defect makes a typed client unable to send a value, and looks like a client bug rather than an API description bug | 0.5–1 d | — | [x] — ~0.5 d actual (`b7aeedc`) |

**Recommended order:** A1 → A2 → A12 → A11 (done) → **A4/A9/A10** (the three red
CI gates; unblock first, since they gate every "green" claim) → A3 → A5 → A6–A8
only when their consumers exist. Everything remaining in Scope A is blocked by
access, tooling or a missing consumer — do not re-estimate those as local code
work. The next unblocked *feature* work is B2's admin modules (payments first).

**CI after the 2026-11-27 push:** run 62 (head `1265f24`) was `in_progress`
when observed; run 61 (head `ba830aa`) failed, as did runs 57–60. No green claim
is made here — check the newest run on the public API before relying on it.

### CI observation that changed this file (2026-11-25)

Immediately after pushing `7d546a3`, run 57 finished with three failures; run 56
(the starting commit) was already red. Per-job results:

| Job | Step | Result |
|---|---|---|
| Lint · Typecheck · Boundaries | — | ✅ |
| Tests + coverage | — | ✅ |
| Build | npm build / OpenAPI / contract drift / backend image | ✅ |
| Build | **Container scan (Trivy)** | ❌ |
| Security scans | Secret scan (gitleaks) | ✅ |
| Security scans | **Dependency audit** | ❌ |
| Mobile auth (live API) | **Mobile auth flow** | ❌ (pre-existing since run 36) |

Check-run annotations contained only "Process completed with exit code 1" and
Node 20 deprecation notices, so the exact failing package/CVE needs the job log
(authenticated) or local tooling. `npm run check:audit` reproduced A9 locally;
Trivy is not installed here, so A10 is inferred from the failed step name, not
diagnosed. **Do not re-estimate these as code regressions without evidence.**

---

## Scope B — feature completeness beyond the current phase

These are **scope**, not refactoring. Estimated separately so they are not
silently folded into "finish the design".

| Item | What remains | Estimate | Status |
|---|---|---:|---|
| **B1 — Mobile P12** | Remaining: push, barcode scan, prescription upload (native modules absent). Landed 2026-11-26: catalogue browse, salt search, product detail, cart quantity/remove and checkout; order history + reorder predates it. Typecheck/lint and 11 pure cart-quantity tests pass; no device render | 8–15 d (partial) | [ ] — partially closed (`0a211b3`) |
| **B2 — Admin modules** | Remaining: payments screen (backend landed 2026-11-27 via A11), logistics, returns, reports, users/roles, audit logs, jobs, support, pricing simulator. Landed 2026-11-26: pharmacist prescriptions queue (filter, approve/reject with reason) via a new typed client factory; fixing its Swagger DTO types also repaired a real contract defect (`Record<string, never>` → `string | null`). 63 api-client contract tests pass; admin typecheck/lint/build (22 routes) green | 10–20 d (partial) | [ ] — partially closed (`b67f63b`) |
| **B3 — Phases 3–6** | Fulfilment & Finance, Scale & Mobile GA, Intelligence, Compliance & Multi-tenant | Not estimated — whole phases, not shortfalls | [ ] |

**Combined view:** Scope A ≈ 8–18 d; Scope B (B1+B2) ≈ 18–35 d; Phases 3–6
are a separate programme and are deliberately not estimated here.

---

## Assumptions behind every estimate

1. One developer, working in this repo with local Postgres 17 / Redis 7 available.
2. `npm run build:shared` before typechecking consumers; no dependency installs
   (the sandbox's npm cleanup is unreliable, and native Expo modules are absent).
3. Estimates are **developer-days of focused work**, not calendar days. They
   exclude PR review, deployment approvals and vendor credential provisioning.
4. A4 and A5 are blocked on access, not effort. Until unblocked they should stay
   `[ ]` with the blocker named — not silently re-estimated as if it were code.
5. No claim of CI green may be copied from a file. Check the run:
   `https://github.com/mdkhalid/ga_edif_pharma/actions` (public list endpoint
   works unauthenticated; per-run/jobs endpoints need auth).

---

## Deliberately not estimated

- Adding saga/circuit-breaker/bulkhead/ACL before there is a consumer. That is
  speculative complexity, not modern design.
- Performance work on the one unmet Phase 1 criterion (sustained placement
  throughput at 200 RPS) — it needs a staging run, not a local estimate.
- The 30-second email/SMS delivery bound — no provider is reachable here.
- Migrating the remaining docs from design intent to implementation verbatim;
  only the claims that are actively misleading are in A1.

---

## How to use this file next session

1. Read `19-development-plan-phase2.md` for the *current task*, then this file
   for what is still owed.
2. Pick the first unblocked `[ ]` in Scope A unless the user asks for a feature.
3. After the work: tick the row, add the commit SHA and actual effort, and
   update the header of this file. If a blocker clears, record how.
4. Commit the update with the work — a backlog that lags the code is just another
   misleading document.
