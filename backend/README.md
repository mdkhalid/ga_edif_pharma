# @medichain/backend

The MediChain API, background workers and schedulers. **One codebase, three process
roles**, selected by `APP_ROLE`.

| Role | Starts | Purpose |
|---|---|---|
| `api` | HTTP listener | Serves all client requests |
| `worker` | Queue consumers | Async jobs: notifications, invoices, indexing, exports |
| `scheduler` | Cron timers | Nightly reconciliation, expiry alerts, partition maintenance |

```bash
APP_ROLE=api       node dist/main.js
APP_ROLE=worker    node dist/main.js
APP_ROLE=scheduler node dist/main.js
```

**Why one artifact for three roles:** the domain, repositories, config and
observability are identical. Splitting them into three codebases guarantees drift —
a bug fixed in the API but still live in the worker. One build, one deploy, one
dependency tree.

---

## Stack

| Concern | Choice |
|---|---|
| Framework | NestJS 11 |
| Language | TypeScript 5.7 (strict) |
| Database | PostgreSQL 17 via Prisma 6 (+ Kysely for complex reads) |
| Cache / queue / rate limit | Redis 7 + BullMQ 5 |
| Search | PostgreSQL FTS (`pg_trgm`) → OpenSearch (phase 4) |
| Validation | class-validator / class-transformer |
| Docs | OpenAPI 3.1 via `@nestjs/swagger` |
| Logging | Pino (structured, redacted) |
| Testing | Jest + Supertest + Testcontainers |

---

## Getting started

```bash
cp .env.example .env          # then fill in the secrets
pnpm install                  # from the repo root
docker compose -f ../infra/docker/docker-compose.yml up -d

pnpm db:migrate
pnpm db:seed
pnpm dev                      # watch mode
```

| URL | What |
|---|---|
| http://localhost:3001/api/v1 | API base |
| http://localhost:3001/docs | Swagger UI |
| http://localhost:3001/health/live | Liveness |
| http://localhost:3001/health/ready | Readiness (**503 if a dependency is down**) |

---

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Watch mode |
| `pnpm build` | Compile to `dist/` |
| `pnpm start:prod` | Run the compiled build |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration tests (Testcontainers) |
| `pnpm test:concurrency` | **Money-path race tests — blocking in CI** |
| `pnpm test:isolation` | **Cross-tenant access tests — blocking in CI** |
| `pnpm test:e2e` | End-to-end HTTP flows |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:migrate:create` | Create a new migration |
| `pnpm db:seed` | Seed reference data |
| `pnpm openapi:generate` | Emit `openapi.json` |
| `pnpm salt:rebuild-keys` | Recompute all composition keys |
| `pnpm salt:verify-keys` | Assert keys match their compositions |
| `pnpm stock:verify` | Assert stock ledger invariants |
| `pnpm lint` / `pnpm typecheck` | Static checks |

---

## Module structure

Every module under `src/modules/` follows the same four-layer shape:

```
modules/<context>/
├── domain/            # Pure. No framework, no I/O, no Prisma types.
│   ├── entities/
│   ├── value-objects/
│   ├── events/
│   └── errors/
├── application/       # Use-case orchestration
│   ├── commands/
│   ├── queries/
│   ├── handlers/
│   ├── sagas/
│   └── ports/         # Interfaces the module needs from the outside
├── infrastructure/    # Adapters that implement the ports
│   └── persistence/
├── api/               # HTTP layer: controllers + DTOs
│   └── dto/           # Classes, never interfaces (see below)
├── <context>.module.ts
└── index.ts           # The ONLY public surface
```

### Two rules that keep the monolith modular

**1. Import other modules only through their `index.ts`.**

```ts
// ✅ allowed
import { ORDER_REPOSITORY } from '@/modules/orders';

// ❌ blocked by ESLint
import { Order } from '@/modules/orders/domain/entities/order.entity';
```

**2. Depend on ports, never on other modules' concrete services.**

```ts
@Injectable()
export class PlaceOrderHandler {
  constructor(
    @Inject(STOCK_PORT)     private readonly stock: StockPort,
    @Inject(PRICING_PORT)   private readonly pricing: PricingPort,
    @Inject(CREDIT_PORT)    private readonly credit: CreditPort,
  ) {}
}
```

This is what makes service extraction a mechanical change later: swap the in-process
adapter for an HTTP adapter at the same injection token. See
[ADR-000](../docs/03-architecture-decisions.md).

---

## Rules that are not negotiable

These exist because each one has a specific, expensive failure mode.

| Rule | Failure it prevents |
|---|---|
| **DTOs must be classes, never interfaces** | The `ValidationPipe` silently skips validation when the metatype is `Object`. Use classes or validation is a no-op. |
| **Never read-modify-write a balance** | Lost updates under concurrency. Always `SELECT … FOR UPDATE` inside the transaction. |
| **Idempotency checks go inside the transaction, after the lock** | A check before the transaction is a TOCTOU race. |
| **Validate before the first mutation** | A guard that throws after a partial write strands the row in a half-applied state. |
| **Never swallow an exception and continue mutating** | Credits an account when the upstream call failed. |
| **Every money-mutating cron takes an advisory lock** | N replicas run it N times. |
| **Advisory locks use a dedicated `QueryRunner`** | They are session-scoped; a pooled connection breaks acquire/release pairing. |
| **Money is `NUMERIC(18,4)` and a decimal string in JSON** | IEEE-754 drift becomes a reconciliation failure. |
| **Every unsafe write accepts an `Idempotency-Key`** | Retried mobile requests create duplicate orders. |
| **Webhooks verify signatures and fail closed** | A missing config must throw, never fall back to a permissive provider. |
| **Readiness returns 503 when a dependency is down** | Otherwise the load balancer routes to pods that can only return 500s. |
| **`app.enableShutdownHooks()`** | Without it, SIGTERM kills in-flight requests. |
| **Every query is tenant-scoped** | A single missed `WHERE tenant_id` is a cross-tenant data breach. |
| **Price and stock are never cached** | Honouring a stale price, or promising unavailable stock. |

Full detail: [docs/09-security-and-compliance.md](../docs/09-security-and-compliance.md)
and [docs/06-database-design.md](../docs/06-database-design.md).

---

## Environment

All configuration is validated at boot with Zod. A malformed environment **fails
startup** rather than failing the first request.

Layer 1 (environment) holds only infrastructure: `DATABASE_URL`, `REDIS_URL`,
`JWT_*_SECRET`, `ENCRYPTION_KEY`.

Everything an admin should be able to change without a redeploy — AI provider and
key, payment gateway, SMS provider, business thresholds — lives in the
`platform_setting` table and is editable at runtime. See
[docs/13-runtime-configuration.md](../docs/13-runtime-configuration.md).

---

## Deployment notes

- **Migrations run before the new version starts**, and must be backward compatible
  with the previous version so a rollback stays possible.
- A startup guard asserts core tables exist, so a missing migration fails loudly
  instead of serving an empty database.
- The Docker image is multi-stage and distroless — no shell, no package manager.
- Graceful shutdown drains for up to 30 s, matching the load balancer's
  deregistration delay.
