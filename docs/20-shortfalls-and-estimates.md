# 20 — Shortfalls, Estimates and Future Work

> **Last updated:** 2026-11-26 · **Branch:** `main` (A1 closed; see commit on row) ·
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

**Estimated total: 8–18 working days** for one developer, excluding review/PR
cycles and waiting on external access. The range grew on 2026-11-25 after CI run
57 exposed two more red gates (A9, A10). Blockers are called out per row; a
blocked item does not consume effort until unblocked.

| ID | Item | Current state | Why it matters | Estimate | Blocked by | Status |
|---|---|---|---|---:|---|---|
| **A1** | Reconcile docs with the code | Closed 2026-11-26: all READMEs and docs 01/02/03/05/07/08/09/10/12/14/15 now use npm (ADR-016) and state reality — Next 16 (ADR-017), plain HTML tables, Jest, no e2e runner; TanStack Table, Recharts, shadcn/ui, React Hook Form, next-intl, FlashList, MMKV, BullMQ/Kysely, Testcontainers and Playwright/Vitest are marked as target intent or absent. The root README's stale 🟢 CI claim now points at the red run 57 | A document that asserts what is not true is worse than no document — it is what a reader trusts instead of checking | 0.5–1 d | — | [x] — ~0.5 d actual (`db825fe`) |
| **A2** | Contract-level tests for `@medichain/api-client` | No tests in that workspace. The pagination defect fixed this session (`unwrap()` returning bare rows and dropping `meta`) passed every existing gate; the PDF `Blob` path has no test either | The client is the seam between a correct backend and a working screen; it is currently unverified | 0.5–1 d | — | [ ] |
| **A3** | Playwright e2e for admin key journeys | No e2e specs or runner. Admin screens are verified by typecheck, lint and `next build` only — no browser has rendered them here | A build proves compilation, not that a table shows rows or a PDF button downloads | 2–4 d | Seeded DB + staff fixture with the right capabilities | [ ] |
| **A4** | Diagnose the red `mobile-e2e` CI job | Failed at *Mobile auth flow* since run 36; never diagnosed. Run 56 was red before this session's push; run 57 was still in progress at the time of writing | `main` is not green, so no completion claim is trustworthy | 0.5–2 d | **Hard blocker:** the `mobile-e2e-api-log` artifact and job logs need an authenticated GitHub request (`gh` is not installed and no token is available here). Do not guess from the step name — the base URL/port is already ruled out | [ ] |
| **A5** | Mobile device/simulator smoke run | Auth flow is exercised headlessly (`mobile/test/auth.integration-spec.ts`, 7 cases); no screen has been rendered on a device. New Orders tab is typechecked/linted only | Native storage, layout and tab navigation can fail in ways a headless client cannot see | 1–3 d | **Hard blocker:** no device or simulator exists in this environment | [ ] |
| **A6** | Saga orchestration, one real flow | Listed in `docs/11-design-patterns-and-solid.md` as used; no saga exists | Needed when a multi-step Phase 3 flow (payment + stock + fulfilment) must compensate on failure | 1–2 d | A concrete flow to orchestrate — do not build it speculatively | [ ] |
| **A7** | Circuit breaker + bulkhead for outbound transports | Email, SMS and push have transports and best-effort/strict paths, but no breaker or resource isolation | Useful only once real providers are reachable; without them this is complexity with no consumer | 1–2 d | A real SMTP/SMS/push provider and defined failure budgets | [ ] |
| **A8** | Anti-corruption layer for gateway payloads | Raw gateway responses are not translated behind a domain-shaped port | Needed before Razorpay/SMSG91 payload shapes leak into domain code | 1–2 d | A concrete gateway integration to wrap | [ ] |
| **A9** | Clear the dependency-audit gate | Run 57's *Dependency audit* failed; `npm run check:audit` reports **23 blocking advisories** (Next 16 RCE/SSRF group, node-forge ×8, sharp, zod, grpc-js, shell-quote, source-map-js, systeminformation, proxy-addr, body-parser, decode-uri-component) beyond the three accepted `multer` entries | No completion claim is trustworthy while the gate is red. The last dependency change was months ago, so these are newly published advisories, not this session's code | 1–3 d | Registry access for version bumps; NO `npm install` inside the sandbox — its cleanup is unreliable | [ ] |
| **A10** | Clear the container-scan gate | Run 57's *Container scan (Trivy)* failed at *Build*, while *Build backend image* itself passed | Same shape as A9: likely newly published base-image CVEs, not a Dockerfile change from this session | 0.5–2 d | Trivy binary or CI job log to see which image/package is flagged; not installed locally | [ ] |

**Recommended order:** A1 → A2 → A4/A9/A10 (the three red CI gates; unblock
first, since they gate every "green" claim) → A3 → A5 → A6–A8 only when their
consumers exist. A1 and A2 are about one day together and are fully doable in
this environment.

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
| **B1 — Mobile P12** | Catalogue, salt search, cart/checkout, push, barcode scan, prescription upload. Order history + reorder are already done | 8–15 d | [ ] |
| **B2 — Admin modules** | Payments, logistics, returns, prescriptions queue, reports, users/roles, audit logs, jobs, support, pricing simulator. Phase 2 screens are done | 10–20 d | [ ] |
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
