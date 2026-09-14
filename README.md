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
| Customer website | `website/` | Next.js 15 · React 19 · TypeScript | distributors, wholesalers, pharmacies |
| Admin / back-office portal | `admin-portal/` | Next.js 15 · React 19 · TypeScript | pharma staff |
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
`npm run dev:mobile` starts the Expo dev server on its own. The catalogue, cart and
order screens are Phase 1 — what exists now is the application shell and the full
authentication flow, which is what Phase 0 promised.

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

🟢 **Phase 0 complete** — every exit criterion is met except the automatic deploy to
`dev`, which is blocked on GitHub secrets rather than on code. The backend foundation,
the three client applications, the generated API client and the load test are all
built and verified; see [Project Status](docs/00-project-status.md) for what was
actually executed rather than merely written.

What the clients implement today is the **application shell and the full auth flow** —
sign in, register, verify a contact, reset a password, silent token refresh, and the
RBAC-aware admin navigation. Catalogue, salt search, cart and orders are **Phase 1**;
see [the roadmap](docs/05-phases-roadmap.md).

Two caveats, stated rather than buried:

- The **mobile app** is verified by typecheck and `expo config` only — it has not been
  run on a device or simulator.
- The **Docker images** are written but have never been built: this environment has no
  Docker daemon. CI's `build` job is the first thing that will execute the backend
  image.
