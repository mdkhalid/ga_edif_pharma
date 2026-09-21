# Pharma Distribution & Ordering Platform (working name: **MediChain**)

A multi-role B2B/B2C pharmaceutical ordering and distribution platform. Distributors,
wholesalers and retail pharmacies join the platform, browse a live catalogue, place
orders, and receive delivery from the pharma company's warehouses. Internal admin,
sales and finance teams operate the back office.

---

## 1. What this repository contains

This is a **monorepo** holding four deployable applications that communicate only
over the backend HTTP/event API:

| App | Folder | Stack | Consumers |
|---|---|---|---|
| Backend API + workers | `backend/` | NestJS 11 · TypeScript · PostgreSQL · Redis | all clients |
| Customer website | `website/` | Next.js 16 · React 19 · TypeScript | distributors, wholesalers, pharmacies |
| Admin / back-office portal | `admin-portal/` | Next.js 16 · React 19 · TypeScript | pharma staff |
| Mobile app (Android + iOS) | `mobile/` | React Native · Expo · TypeScript | field sales, buyers on the move |
| Shared packages | `packages/` | TypeScript libraries | all of the above |
| Infrastructure as code | `infra/` | Docker · Terraform · K8s | platform team |

> **Why a monorepo?** The four apps share a large amount of contract surface —
> DTOs, enums, validation schemas and a generated API client. A monorepo lets us
> change a field in one place and have the compiler tell us every client that
> broke. Deployments remain fully independent; nothing is shared at runtime.

---

## 2. Read the documentation in this order

| # | Document | What it answers |
|---|---|---|
| **00** | **[Project Status](docs/00-project-status.md)** | **What is actually built right now, verified — start here** |
| 01 | [High-Level Design](docs/01-high-level-design.md) | System shape, contexts, request flow, consistency model |
| 02 | [Tech Stack](docs/02-tech-stack.md) | Every technology choice with justification |
| 03 | [Architecture Decisions](docs/03-architecture-decisions.md) | Monolith vs microservices, DB choices, ADR log |
| 04 | [Feature Catalogue](docs/04-feature-catalog.md) | Every feature the platform needs, by module |
| 05 | [Phased Roadmap](docs/05-phases-roadmap.md) | What to build in which phase, exit criteria |
| 06 | [Database Design](docs/06-database-design.md) | PostgreSQL schema, indexes, constraints |
| 07 | [API Design](docs/07-api-design.md) | REST conventions, versioning, errors, pagination |
| 08 | [Search & Salt Engine](docs/08-search-and-salt-engine.md) | Salt-composition → medicine discovery |
| 09 | [Security & Compliance](docs/09-security-and-compliance.md) | Auth, rate limiting, pharma/GST compliance |
| 10 | [Scalability & Performance](docs/10-scalability-performance.md) | Load balancing, caching, horizontal scale |
| 11 | [Design Patterns & SOLID](docs/11-design-patterns-and-solid.md) | Every pattern used, and where |
| 12 | [Folder Structures](docs/12-folder-structures.md) | Full tree for backend, website, admin, mobile |
| 13 | [Runtime Configuration](docs/13-runtime-configuration.md) | Runtime AI provider/key switching, feature flags |
| 14 | [Deployment, DevOps & Observability](docs/14-deployment-devops-observability.md) | CI/CD, environments, monitoring |
| 15 | [Testing Strategy](docs/15-testing-strategy.md) | Test pyramid, Testcontainers, contract tests |
| 16 | [Non-Functional Requirements](docs/16-non-functional-requirements.md) | SLOs, capacity targets, budgets |
| 17 | [Domain Model & Glossary](docs/17-domain-model-and-glossary.md) | Ubiquitous language, ER overview |

---

## 3. The one-paragraph architecture summary

Start as a **modular monolith** — a single NestJS deployable composed of strictly
isolated bounded contexts that talk through in-process ports and an event bus.
Scale it horizontally behind an L7 load balancer with stateless JWT auth, Redis for
shared state, and PostgreSQL as the single source of truth. Extract contexts into
network services **only** when a real force demands it (independent scaling, a
different data store, or a separate team). Consistency is preserved by keeping one
transactional database per context, using the transactional-outbox pattern for
events, and never splitting a business invariant across two services.

This gets you microservice-grade scalability without paying the microservice
distributed-transaction tax before you have the traffic that justifies it.

---

## 4. Local development

> **Package manager: npm workspaces.** The design documents were written
> assuming pnpm; the implementation uses npm workspaces + Turborepo. See
> [ADR-016](docs/03-architecture-decisions.md#adr-016--npm-workspaces-instead-of-pnpm)
> for why, and use `npm` everywhere a doc says `pnpm`.

```bash
# 1. Prerequisites: Node 22+, Docker Desktop

# 2. Install all workspace dependencies
npm install

# 3. Bring up Postgres, Redis, OpenSearch, MinIO, MailHog
docker compose -f infra/docker/docker-compose.yml up -d

# 4. Configure the backend
cp backend/.env.example backend/.env

# 5. Build the shared packages, then migrate + seed
npm run build:shared
npm run db:migrate
npm run db:seed

# 6. Run everything: backend + website + admin (Turborepo runs them concurrently)
npm run dev

#    ...or just the backend
npm run dev --workspace=@medichain/backend

# 7. Mobile — a separate terminal, because Metro is not a Next dev server
npm run dev:mobile
```

**What runs today:** all four applications. `npm run dev` brings up the backend API
(:3001), the customer website (:3000) and the admin portal (:3002) concurrently;
`npm run dev:mobile` starts the Expo dev server on its own. The backend foundation and
the three clients are built. The website additionally has catalogue browse, salt search,
cart, checkout and order-history screens — built and route-verified, but **not yet
exercised against real data**. The remaining client screens are Phase 1 scope; see
[§5](#5-status).

Run `npm run build:shared` before any command that typechecks or tests a consumer of
the shared packages, and `npm run api-client:generate` after a backend contract
change (CI fails on drift between the two).

| Service | URL |
|---|---|
| Backend API | http://localhost:3001/api/v1 |
| Swagger UI | http://localhost:3001/docs |
| Customer website | http://localhost:3000 |
| Admin portal | http://localhost:3002 |
| OpenSearch Dashboards | http://localhost:5601 |
| MinIO console | http://localhost:9001 |
| MailHog | http://localhost:8025 |

---

## 5. Status

🟢 **CI is green on `main`** — run 26 passes every job. Worth stating because it is new:
the pipeline had failed all 23 of its runs and had never reached the test step. Four
defects had to be fixed, none of them a failing test; the sequence is in
[§5 of the status file](docs/00-project-status.md).

**Phase 0: 9 of 10 criteria verified, 1 open.**

Outstanding, stated rather than buried:

- **The automatic deploy to `dev`** — the one open criterion. The job exists and reports
  what it is missing; there is no `dev` estate yet, so its two credentials are uncreated
  rather than merely unset.
- **The mobile app's UI** has never been rendered on a device or simulator — none exists
  in this environment. The auth flow itself is now exercised at runtime against a live
  API (`mobile/test/auth.integration-spec.ts`, 7 cases, headless, with the Keychain
  replaced by an in-memory stand-in); the screens around it are covered by typecheck and
  `expo config` only.
- **The Docker images** were built for the first time in this pass, which is how both web
  images turned out to be unbuildable and both web containers permanently unhealthy. All
  three build now, and both web images report `healthy`.

What the clients implement today: the **application shell and the full auth flow** (sign
in, register, verify a contact, reset a password, silent token refresh, RBAC-aware admin
navigation), plus catalogue browse, salt search, cart, checkout and order history on the
website. Everything else is **Phase 1** — see [the roadmap](docs/05-phases-roadmap.md),
and [Project Status](docs/00-project-status.md) for what was executed rather than merely
written.
