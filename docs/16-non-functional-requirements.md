# 16 — Non-Functional Requirements

> **Status:** Approved · **Owner:** Architecture · **Last updated:** 2026-09-11

Measurable, testable requirements. Each has a target, a measurement method and a
consequence of breach. A non-functional requirement without a number is an opinion.

---

## 1. Performance

| ID | Requirement | Target | Measured by |
|---|---|---|---|
| NFR-P-01 | API p50 latency (reads) | < 50 ms | Prometheus histogram |
| NFR-P-02 | API p95 latency (reads) | < 200 ms | Prometheus histogram |
| NFR-P-03 | API p99 latency (reads) | < 500 ms | Prometheus histogram |
| NFR-P-04 | API p95 latency (writes) | < 800 ms | Prometheus histogram |
| NFR-P-05 | Order placement p95 | < 800 ms | Custom metric |
| NFR-P-06 | Salt combination search p95 | < 150 ms | Custom metric |
| NFR-P-07 | Autocomplete p95 | < 50 ms | Custom metric |
| NFR-P-08 | Database query p95 | < 20 ms | `pg_stat_statements` |
| NFR-P-09 | Slow queries (> 1 s) | 0 per hour | `pg_stat_statements` |
| NFR-P-10 | Website LCP | < 2.5 s | RUM / Lighthouse |
| NFR-P-11 | Website INP | < 200 ms | RUM |
| NFR-P-12 | Mobile cold start | < 2 s | Firebase Performance |
| NFR-P-13 | Mobile list scroll | 60 fps | Profiler |
| NFR-P-14 | Report generation (async) | < 60 s | Job metrics |
| NFR-P-15 | PDF generation | < 3 s | Job metrics |

**Breach consequence:** a sustained breach for 2 consecutive days raises a
performance ticket. It does not become the new baseline.

---

## 2. Scalability

| ID | Requirement | Target |
|---|---|---|
| NFR-S-01 | Horizontal API scaling | Linear to 40 pods |
| NFR-S-02 | Sustained API throughput | 2,500 RPS at year 3 peak |
| NFR-S-03 | Sustained search throughput | 1,200 RPS |
| NFR-S-04 | Concurrent users | 10,000 active |
| NFR-S-05 | Catalogue size | 150,000 SKUs |
| NFR-S-06 | Orders per day | 50,000 |
| NFR-S-07 | Order lines per day | 800,000 |
| NFR-S-08 | Database size | 600 GB without degradation |
| NFR-S-09 | Autoscale reaction time | < 60 s to add capacity |
| NFR-S-10 | Stateless tier | Any pod serves any request |

**Design implication:** NFR-S-10 is the load-bearing one. Every other scalability
requirement depends on the application tier holding no state.

---

## 3. Availability and reliability

| ID | Requirement | Target |
|---|---|---|
| NFR-A-01 | Monthly uptime (API) | 99.9% (≤ 43 min/month) |
| NFR-A-02 | Monthly uptime (website) | 99.9% |
| NFR-A-03 | Planned maintenance downtime | 0 (zero-downtime deploys) |
| NFR-A-04 | Single pod failure impact | None (user-invisible) |
| NFR-A-05 | AZ failure impact | Reduced capacity, no outage |
| NFR-A-06 | Database failover time | < 60 s |
| NFR-A-07 | RPO | ≤ 5 minutes |
| NFR-A-08 | RTO | ≤ 60 minutes |
| NFR-A-09 | Error rate (5xx) | < 0.1% |
| NFR-A-10 | Background job success rate | > 99.5% |

### Degradation modes (graceful, not binary)

| Dependency down | System behaviour |
|---|---|
| Redis | Rate limiter fails open; cache falls through to DB; latency rises, service continues |
| OpenSearch | Falls back to Postgres FTS; search quality drops, search works |
| S3 | Uploads fail with a clear error; reads of cached docs continue |
| Payment gateway | Orders placeable on credit; payments retried later |
| SMS provider | Notification queued and retried; orders unaffected |
| AI provider | Deterministic fallbacks; core flows unaffected |
| Read replica | Reads fall back to primary; latency rises |
| Primary DB | **Full outage** — the single hard dependency. Multi-AZ + fast failover. |

**The one thing with no graceful degradation is the primary database.** That is why
it gets Multi-AZ, continuous WAL archiving, and quarterly failover drills.

---

## 4. Consistency and correctness

| ID | Requirement | Target |
|---|---|---|
| NFR-C-01 | Zero oversell under concurrency | 100% (tested every PR) |
| NFR-C-02 | Zero credit-limit breach under concurrency | 100% (tested every PR) |
| NFR-C-03 | Zero duplicate orders on retry | 100% (idempotency) |
| NFR-C-04 | Zero double-credit on webhook redelivery | 100% (unique constraint) |
| NFR-C-05 | Ledger balance = derived sum | 100% (reconciled nightly) |
| NFR-C-06 | Σ(stock_ledger) = qty_on_hand | 100% (reconciled nightly) |
| NFR-C-07 | Cross-tenant data leakage | 0 (tested every PR) |
| NFR-C-08 | Price shown = price invoiced | 100% |
| NFR-C-09 | Invoice totals reconcile to the paisa | 100% |
| NFR-C-10 | Event delivery | At-least-once with idempotent consumers |
| NFR-C-11 | Saga completion | Every saga reaches a terminal state |

**NFR-C-01 through C-09 are the requirements that matter most in this system.** They
are all enforced by automated tests that block every PR, because code review does not
reliably catch concurrency and isolation bugs.

---

## 5. Security

| ID | Requirement | Target |
|---|---|---|
| NFR-SEC-01 | Password hashing | argon2id, 19 MiB, t=2 |
| NFR-SEC-02 | Access token TTL | 15 minutes |
| NFR-SEC-03 | Refresh token rotation | Every use, with reuse detection |
| NFR-SEC-04 | MFA | Mandatory for all staff roles |
| NFR-SEC-05 | Secrets at rest | AES-256-GCM encrypted |
| NFR-SEC-06 | Secrets in logs | 0 |
| NFR-SEC-07 | TLS version | 1.2 minimum, 1.3 preferred |
| NFR-SEC-08 | Critical/high vulnerabilities | 0 in production |
| NFR-SEC-09 | Patch SLA (critical) | 24 hours |
| NFR-SEC-10 | Penetration test findings (critical/high) | 0 before launch |
| NFR-SEC-11 | Audit coverage of state changes | 100% |
| NFR-SEC-12 | Rate limiting | Enforced on every endpoint class |
| NFR-SEC-13 | Webhook signature verification | 100%, fail-closed |
| NFR-SEC-14 | Dependency audit | Clean on every PR |

---

## 6. Compliance

| ID | Requirement | Target |
|---|---|---|
| NFR-COMP-01 | Drug licence validity check before sale | 100% |
| NFR-COMP-02 | Expired licence ⇒ order blocked | 100% |
| NFR-COMP-03 | Schedule H/H1/X prescription enforcement | 100%, server-side |
| NFR-COMP-04 | Statutory registers generated | 100% of dispensed records |
| NFR-COMP-05 | Gapless invoice numbering | 100% |
| NFR-COMP-06 | Invoice immutability | 100% (no UPDATE grant) |
| NFR-COMP-07 | GST computation correctness | 100% |
| NFR-COMP-08 | Financial record retention | 7 years |
| NFR-COMP-09 | Audit log retention | 7 years |
| NFR-COMP-10 | Data export on request | Within 30 days |
| NFR-COMP-11 | PII in logs | 0 |
| NFR-COMP-12 | Batch traceability (invoice → batch) | 100% |

---

## 7. Usability

| ID | Requirement | Target |
|---|---|---|
| NFR-U-01 | Order placement steps | ≤ 4 from cart |
| NFR-U-02 | Quick order (paste SKUs) | ≤ 3 steps |
| NFR-U-03 | Search-to-add time | < 30 s |
| NFR-U-04 | Reorder a past order | 1 tap |
| NFR-U-05 | Mobile: reachable controls | Thumb zone |
| NFR-U-06 | Accessibility | WCAG 2.1 AA |
| NFR-U-07 | Error messages | Actionable, in plain language |
| NFR-U-08 | Offline browsing (mobile) | Catalogue + cart cached |
| NFR-U-09 | Languages | English + Hindi at launch |
| NFR-U-10 | Browser support | Last 2 versions of Chrome, Safari, Edge, Firefox |

**NFR-U-07 deserves emphasis:** "Invalid input" is not an error message. "Quantity
must be at least 1 pack (10 tablets). You entered 0." is. Every validation error
states what is wrong, what is allowed, and what was received.

---

## 8. Maintainability

| ID | Requirement | Target |
|---|---|---|
| NFR-M-01 | Domain test coverage | ≥ 95% |
| NFR-M-02 | Overall test coverage | ≥ 85% |
| NFR-M-03 | Flaky tests | 0 |
| NFR-M-04 | TypeScript strict mode | Enabled everywhere |
| NFR-M-05 | `any` usage | 0 in application code |
| NFR-M-06 | Module boundary violations | 0 (ESLint-enforced) |
| NFR-M-07 | Documented architecture decisions | 100% of significant choices |
| NFR-M-08 | API documentation coverage | 100% of endpoints in OpenAPI |
| NFR-M-09 | Build time (CI) | < 10 minutes |
| NFR-M-10 | Deploy time | < 5 minutes |
| NFR-M-11 | Time to onboard a developer | < 1 day to a running environment |

**NFR-M-05** is enforced by lint, not by discipline. `any` in application code is a
hole in the type system at exactly the point where the compiler was supposed to help.

---

## 9. Operability

| ID | Requirement | Target |
|---|---|---|
| NFR-O-01 | Health endpoints | `/health/live` + `/health/ready`, correct semantics |
| NFR-O-02 | Structured logs | 100% JSON with correlation ids |
| NFR-O-03 | Distributed tracing | Enabled on all request paths |
| NFR-O-04 | Metrics coverage | RED on every endpoint |
| NFR-O-05 | Alert coverage | Every P1 condition has an alert + runbook |
| NFR-O-06 | MTTD (detect) | < 5 minutes |
| NFR-O-07 | MTTR (recover) | < 30 minutes |
| NFR-O-08 | Runbook coverage | 100% of P1 scenarios |
| NFR-O-09 | Rollback time | < 5 minutes |
| NFR-O-10 | Log retention | 30 days hot, 1 year cold |

---

## 10. Compatibility

| ID | Requirement | Target |
|---|---|---|
| NFR-COMPAT-01 | Android support | API 24+ (Android 7) |
| NFR-COMPAT-02 | iOS support | iOS 15+ |
| NFR-COMPAT-03 | Old mobile clients | Minimum 6-month deprecation window |
| NFR-COMPAT-04 | API versioning | URL path, parallel versions |
| NFR-COMPAT-05 | Database | PostgreSQL 16+ |
| NFR-COMPAT-06 | Node runtime | 22 LTS |
| NFR-COMPAT-07 | Export formats | Excel (.xlsx), CSV, PDF |

**NFR-COMPAT-03 drives real design decisions.** Because an old mobile client cannot
be force-updated, the API must run `/v1` and `/v2` in parallel for at least 6 months,
and the client must send `X-App-Version` so the server can enforce a minimum.

---

## 11. Capacity planning summary

| Metric | Launch | Year 1 | Year 3 |
|---|---|---|---|
| Organisations | 200 | 2,000 | 10,000 |
| Users | 600 | 8,000 | 40,000 |
| SKUs | 8,000 | 40,000 | 150,000 |
| Orders/day | 500 | 8,000 | 50,000 |
| Peak RPS | 30 | 400 | 2,500 |
| DB size | 5 GB | 80 GB | 600 GB |
| API pods | 3 | 12 | 40 |
| DB connections (pooled) | 40 | 120 | 200 |
| Redis ops/s | 5k | 50k | 200k |
| OpenSearch nodes | 0 (PG FTS) | 1 | 3 |

---

## 12. Requirement traceability

| Business goal | NFRs that serve it |
|---|---|
| Handle a lot of user requests | NFR-P-01…04, NFR-S-01…10 |
| Scale easily | NFR-S-01…10, NFR-A-04…05 |
| No data-consistency challenges | NFR-C-01…11 |
| Money must be correct | NFR-C-01…09 |
| Security and rate limiting | NFR-SEC-01…14 |
| Pharma compliance | NFR-COMP-01…12 |
| Runtime-configurable AI | NFR-O-01…10, doc 13 |
| Usable by distributors and pharmacies | NFR-U-01…10 |
| Long-term maintainability | NFR-M-01…11 |

---

## 13. Verification plan

| Requirement class | Verified by | Frequency |
|---|---|---|
| Performance | k6 load tests | Weekly + pre-release |
| Scalability | Load tests at 3× peak | Pre-release |
| Availability | Chaos drills, pod kills | Quarterly |
| Consistency | Concurrency + isolation test suites | **Every PR** |
| Security | SAST, DAST, audit, pen test | Continuous + pre-launch |
| Compliance | Automated compliance tests + audit | Every PR + annual audit |
| Usability | Usability testing with real buyers | Per phase |
| Maintainability | CI coverage gates | Every PR |
| Operability | Game-day exercises | Quarterly |
| Compatibility | Device matrix testing | Per mobile release |

**The two rows in bold are the ones that block every PR.** Everything else can be
scheduled; overselling and cross-tenant leakage cannot wait for a weekly run.
