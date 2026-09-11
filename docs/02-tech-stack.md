# 02 — Technology Stack

> **Status:** Approved · **Owner:** Solution Architecture · **Last updated:** 2026-09-11

Every choice below states **what**, **why**, and **what we gave up**. A stack with no
stated trade-offs is a stack nobody thought about.

---

## 1. Stack at a glance

| Layer | Choice | Version |
|---|---|---|
| Language (all) | **TypeScript** | 5.7+ |
| Runtime | **Node.js** | 22 LTS |
| Package manager | **pnpm** workspaces + **Turborepo** | 9 / 2 |
| Backend framework | **NestJS** | 11 |
| ORM / query builder | **Prisma** (+ Kysely for complex reads) | 6 |
| Primary database | **PostgreSQL** | 17 |
| Cache / rate limit / queue | **Redis** (Valkey-compatible) | 7 |
| Search engine | **OpenSearch** (Postgres FTS fallback) | 2.17 |
| Job queue | **BullMQ** | 5 |
| Event streaming | **Kafka** (phase 4+); outbox in Postgres before that | 3.7 |
| Object storage | **S3-compatible** (MinIO local, S3/Spaces prod) | — |
| API contract | **OpenAPI 3.1** + generated client | — |
| Website framework | **Next.js** (App Router) | 15 |
| UI library | **React** + Tailwind + shadcn/ui | 19 |
| Mobile framework | **React Native** + **Expo** | 0.76 / SDK 52 |
| Validation | **class-validator** (server), **Zod** (client + env) | — |
| Testing | **Vitest/Jest**, **Supertest**, **Testcontainers**, **Playwright** | — |
| Observability | **Pino**, **OpenTelemetry**, **Prometheus**, **Grafana**, **Sentry** | — |
| Container / orchestration | **Docker**, **Kubernetes** (or ECS Fargate) | — |
| IaC | **Terraform** | 1.9 |

---

## 2. Backend

### 2.1 NestJS 11 — application framework

**Why**

- First-class **dependency injection**, which is what makes SOLID practical rather
  than aspirational. Depend on an interface token, inject the implementation.
- **Modules** map 1:1 onto our bounded contexts, and NestJS enforces the boundary
  (a module can only use what it imports). This is the guard-rail that keeps a
  monolith from decaying into a ball of mud.
- **Guards / Interceptors / Pipes / Filters** give us one obvious place each for
  auth, cross-cutting concerns, validation and error mapping — the Decorator and
  Chain-of-Responsibility patterns, built in.
- **Transport-agnostic**: the same application service can be exposed over REST,
  GraphQL, gRPC, or a queue consumer. That is exactly what makes the future
  service extraction mechanical instead of a rewrite.

**Trade-off:** opinionated and decorator-heavy. Steeper ramp for a developer coming
from Express. Accepted — the structure pays for itself past the first 20 endpoints.

**Alternative considered:** Fastify + manual DI, or tRPC. Fastify alone gives no
structure; tRPC is excellent for a single TypeScript client but we have three
clients and need a public OpenAPI contract. Rejected.

### 2.2 PostgreSQL 17 — the primary datastore

**Why one database covers a surprising amount of the brief**

| Requirement | Postgres feature |
|---|---|
| Medicine listing | Ordinary relational tables with strong constraints |
| Full-text search on brand/salt | `tsvector` + GIN + `pg_trgm` + `unaccent` |
| Salt-combination matching | Normalised salt tables + GIN index on a canonical composition key |
| Semi-structured data (product attributes) | `JSONB` with GIN indexes |
| Audit trail | Append-only table + `pg_partman` monthly partitions |
| Money | `NUMERIC(18,4)` — exact decimal, no float drift |
| Row-level concurrency control | `SELECT … FOR UPDATE`, `SKIP LOCKED` for job queues |
| Advisory locks for crons | `pg_try_advisory_lock` |
| Delivery zone geo queries (later) | PostGIS |
| Analytics | Read replica + materialised views |

**Why not a second database for search from day one:** the initial catalogue is
tens of thousands of SKUs. Postgres FTS answers that in single-digit milliseconds.
Introducing a separate search cluster before it is needed adds an index-consistency
problem for zero user-visible gain. The `SearchPort` interface means switching to
OpenSearch later is a config flag, not a refactor.

**Why not MongoDB:** the domain is deeply relational (order → line → product → salt
→ batch → warehouse). Document stores push joins into application code, and we lose
the transactional guarantees that the money paths depend on.

**Trade-off:** Postgres vertical scaling has a ceiling and write-heavy partitioning
requires real operational skill. Mitigated by read replicas, then table partitioning,
then context extraction — in that order.

### 2.3 Prisma 6 + Kysely — data access

**Prisma for 90% of the code:** generated types that are derived from the schema, so
a schema change surfaces every affected call site at compile time. Migrations are
versioned SQL files under `backend/src/database/migrations`.

**Kysely for the other 10%:** reporting queries, dynamic filters, and anything
needing window functions or CTEs. Prisma's query builder fights those; raw SQL with
a typed builder does not.

**Critical rule:** hot money paths use `$queryRaw` with explicit `FOR UPDATE`, not
`findOne` + `save`. Prisma's default read-modify-write is exactly the lost-update
bug described in §6.5 of the HLD. A lint rule and a code-review checklist enforce
this.

**Alternative considered:** TypeORM. It is more familiar to NestJS developers and
has built-in `pessimistic_write` locking, but its type inference is weaker and its
migration story is more fragile. Drizzle is a strong modern contender and would be
our second choice.

### 2.4 Redis 7 — cache, rate limiter, session store, queue

Four jobs, one dependency:

1. **Cache** — catalogue, price lists, permissions, config. TTL + explicit
   invalidation on write.
2. **Rate limiting** — sliding-window counters per principal/IP/route.
3. **Session & token state** — refresh token rotation, revocation lists, device
   registry, OTP storage.
4. **BullMQ queues** — background jobs (email, SMS, indexing, invoice PDF).

**Why not Memcached:** we need data structures (sorted sets for sliding windows,
hashes for sessions), persistence, and a queue. Redis does all four.

**Failure policy:** Redis is **not** the source of truth. If it is down, the
rate limiter fails **open** with a warning (better to serve traffic than to lock
everyone out), the cache fails through to Postgres, and auth falls back to
signature-only JWT validation until the token TTL expires. A cache outage degrades
latency; it must never cause an outage.

### 2.5 OpenSearch 2.17 — relevance search

Introduced in **Phase 4**, behind the `SearchPort` abstraction.

**Why:** salt synonym expansion, typo tolerance, fuzzy brand matching, boosting by
customer purchase history, and faceted filtering at catalogue scale. Postgres
`pg_trgm` gets us to maybe 60% of that quality; OpenSearch gets the rest.

**Trade-off:** an index is a **projection, never a source of truth**. It can be
rebuilt from Postgres at any time (`pnpm search:reindex`). Search results are
therefore always "approximately current", which is acceptable for discovery and
unacceptable for price and stock — those are always re-read from Postgres before an
order is confirmed.

### 2.6 BullMQ + transactional outbox — asynchronous work

**Phase 1–3:** BullMQ (Redis-backed) for jobs. Postgres `outbox_event` table for
domain events, with a relay worker polling every second.

**Phase 4+:** add Kafka for event streaming when we need retention, replay, or
multiple independent consumers. The outbox relay simply gains a Kafka publisher
alongside the BullMQ one — no domain code changes.

**Why this order:** Kafka is operationally expensive (ZooKeeper/KRaft, partitions,
consumer groups, schema registry). The outbox pattern already gives us
at-least-once delivery with atomicity; Kafka adds throughput and replay on top.

### 2.7 Supporting libraries

| Concern | Library | Note |
|---|---|---|
| Password hashing | `argon2` | argon2id, 19 MiB / t=2 / p=1 baseline |
| JWT | `@nestjs/jwt` + `jose` | Access + refresh rotation |
| Validation | `class-validator` + `class-transformer` | **Classes, not interfaces** — interfaces make the ValidationPipe a silent no-op |
| Decimal arithmetic | `decimal.js` | Never native `number` for money |
| HTTP client | `undici` / `axios` | With retry + circuit breaker |
| Circuit breaker | `opossum` | Protects every external provider call |
| PDF | `puppeteer` (invoice render) | HTML template → PDF |
| Excel | `exceljs` | Bulk import/export |
| Barcode | `bwip-js` | Product barcodes, labels |
| Scheduler | `@nestjs/schedule` | Always paired with an advisory lock |
| Config schema | `zod` | Fail fast on boot if env is malformed |

---

## 3. Website (customer-facing)

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 15**, App Router | SSR for SEO on public catalogue pages; server components reduce client bundle; API routes for BFF-style aggregation |
| Language | TypeScript strict | Same types as backend via `packages/shared-types` |
| Styling | **TailwindCSS 4** + **shadcn/ui** | Utility-first, copy-in components we own, no version lock-in |
| Server state | **TanStack Query v5** | Caching, retries, background refetch, optimistic updates |
| Client state | **Zustand** | Cart, UI preferences, filters — small and unopinionated |
| Forms | **React Hook Form** + **Zod** | Zod schemas shared with the API client |
| Tables | **TanStack Table** | Virtualised large order/stock grids |
| Charts | **Recharts** | Sales and outstanding dashboards |
| i18n | **next-intl** | EN + HI at launch |
| Testing | **Vitest** + **Playwright** | Unit + E2E |

**Why Next.js over a plain SPA:** public product pages need to be indexable and
fast on first paint for buyers searching "Paracetamol 500mg supplier". SSR gives
that for free. The authenticated app behind it behaves like a SPA.

**Why not a mobile-first PWA only:** the brief requires native apps on both stores.
The website is the desktop-heavy workflow (bulk ordering, ledgers, reports).

---

## 4. Admin portal

Same stack as the website, **separate deployable**. Reasons for a separate app
rather than a route group:

- Different threat model — admin surface should be separately network-restricted
  (VPN / IP allow-list) and can be deployed to a private subnet.
- Different release cadence — back-office changes should not risk the customer app.
- Much heavier tables, exports and charts that should not bloat the customer bundle.

Shared code (design system, API client, types) comes from `packages/`.

---

## 5. Mobile — React Native + Expo

| Concern | Choice | Why |
|---|---|---|
| Framework | **React Native 0.76** (New Architecture) | One codebase for Android + iOS, as the brief requires |
| Toolchain | **Expo SDK 52** + EAS Build | Removes 80% of native build pain; OTA updates; managed signing |
| Navigation | **React Navigation 7** | Native stack + tabs |
| Server state | **TanStack Query** | Same mental model as web |
| Client state | **Zustand** | Cart, auth, preferences |
| Persistence | **MMKV** | Fast synchronous key-value, encrypted variant available |
| Secure storage | **expo-secure-store** / **react-native-keychain** | Tokens in Keychain/Keystore, never AsyncStorage |
| Forms | **React Hook Form** + **Zod** | Reuses web validation schemas |
| Lists | **FlashList** | Virtualised lists at 60 fps with 1000+ products |
| Push | **expo-notifications** + FCM/APNs | Order status, dispatch, payment reminders |
| Camera | **expo-camera** + **expo-barcode-scanner** | Prescription upload, barcode reorder |
| Offline | **TanStack Query persister** + MMKV | Cart and catalogue browse work offline |
| Build / release | **EAS Build** + **EAS Submit** | CI-driven store submission |
| OTA updates | **EAS Update** | Ship JS fixes without store review |

**Why Expo over bare React Native:** the brief needs both stores shipped by a small
team. Expo handles signing, provisioning profiles, and native module linking.
Bare RN is the escape hatch if a native module ever blocks us — and Expo prebuild
supports ejecting without losing the codebase.

**Why not Flutter:** the team and the entire backend/website stack is TypeScript.
Sharing validation schemas, types and business logic across all four apps is worth
more than Flutter's marginally better rendering performance.

---

## 6. Shared packages

| Package | Contents | Consumers |
|---|---|---|
| `@medichain/shared-types` | DTO interfaces, enums, domain types | all |
| `@medichain/shared-utils` | Decimal helpers, formatters, guards, date utils | all |
| `@medichain/api-client` | Generated from OpenAPI + typed fetch wrapper | web, admin, mobile |
| `@medichain/ui` | Design-system primitives (web) | website, admin |
| `@medichain/config` | Shared eslint / tsconfig / tailwind presets | all |

The API client is **generated**, never hand-written. A hand-written client drifts
from the server contract the moment someone forgets to update it.

---

## 7. Infrastructure

| Concern | Choice | Why |
|---|---|---|
| Containers | Docker (multi-stage, distroless runtime) | Small images, no shell in prod |
| Orchestration | Kubernetes (EKS/GKE) **or** ECS Fargate | K8s if the team has the skills; Fargate if not. Both satisfy the brief. |
| Load balancer | ALB / NGINX Ingress / APISIX | L7 routing, TLS termination, health checks, WAF |
| CDN + WAF | CloudFront / Cloudflare | Static assets, DDoS, bot mitigation |
| Secrets | AWS Secrets Manager / Vault | DB creds, gateway keys; app secrets live encrypted in Postgres |
| IaC | Terraform | Reproducible environments |
| CI/CD | GitHub Actions | Lint → typecheck → test → build → migrate → deploy |
| Monitoring | Prometheus + Grafana | RED metrics, alerting |
| Tracing | OpenTelemetry → Tempo/Jaeger | Cross-service request tracing |
| Errors | Sentry | Stack traces with release + correlation id |
| Logs | Pino → Loki / CloudWatch | Structured JSON, queryable |

**Recommended managed services** (fastest path, least ops burden): AWS RDS for
PostgreSQL (Multi-AZ), ElastiCache for Redis, OpenSearch Service, S3, ALB, ECS
Fargate, SQS/EventBridge. A team of 4–6 can run this comfortably.

---

## 8. Version pinning policy

- All versions are pinned exactly in `package.json` (`"next": "15.1.3"`, not `^15`).
- Renovate opens grouped dependency PRs weekly; security patches are auto-merged
  after CI passes.
- Node version pinned in `.nvmrc` and in the Dockerfile base image.
- A `pnpm-lock.yaml` is committed and is the single source of dependency truth.

**Why:** floating ranges mean two developers can build different applications from
the same commit. That is how "works on my machine" bugs are born.
