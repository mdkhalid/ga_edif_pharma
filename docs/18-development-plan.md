# 18 — Development Plan (Phase 1 UI)

> Working plan for closing the remaining Phase 1 UI scope. Backend for all of
> these endpoints is already landed and verified; this plan is the client side.
> Updated as work proceeds. Where it and `00-project-status.md` disagree, this
> file is the more current *plan*; `00` remains the status record.

## Context

Phase 1 backend (onboarding approval, catalogue, orders, notifications) is done
and verified against real Postgres + Redis. The admin portal, however, still
shows `ModulePlaceholder` for Onboarding, Catalogue and Orders — the remaining
Phase 1 UI. This plan fills those three screens. The website storefront screens
already build; exercising them against real data is a separate, lower-priority
track noted at the bottom.

## Conventions (established in repo)

- Screens are `'use client'` components under `src/features/<domain>/components/`.
  The `page.tsx` stays a server component that only renders the screen, to keep
  `metadata`. Mirror `website/src/features/orders/components/order-history-screen.tsx`.
- Data: `callAuthed((client) => create<Domain>Api(client).<op>(...))` inside
  `useQuery` / `useMutation` from `@tanstack/react-query`.
- UI primitives: only `Card`/`CardHeader`/`CardTitle`/`CardDescription`,
  `Button`, `Input`, `Label`, `cn` from `@medichain/ui`. Tables are plain
  HTML + Tailwind. No `Badge`/`Table` component exists — do not import one.
- Capability gating: hide actions with `usePermission().can(Capability.X)`. The
  API still enforces; hiding is courtesy only.
- Money/quantity are `DecimalString` (strings) — render with `₹{value}`, never
  `Number()` for arithmetic.

## Tasks

- [ ] **T1 — Admin onboarding approval queue** (Onboarding page)
  - List `PENDING` applications (`listPending`), oldest first.
  - Per-row Approve / Reject with optional reason; mutations invalidate the list.
  - Gate actions on `ONBOARDING_APPROVE` / `ONBOARDING_REJECT`.
  - Files: `src/features/onboarding/components/onboarding-queue-screen.tsx`,
    edit `src/app/(admin)/onboarding/page.tsx`.
- [ ] **T2 — Admin orders list + manual status** (Orders page)
  - List all tenant orders (`orders.list`), render summary table.
  - Per-row actions allowed by the state machine (`ORDER_TRANSITIONS`):
    confirm / process / dispatch / deliver / cancel, each a mutation.
  - Gate on `ORDER_APPROVE` / `ORDER_CANCEL` as appropriate.
  - Files: `src/features/orders/components/orders-screen.tsx`,
    edit `src/app/(admin)/orders/page.tsx`.
- [ ] **T3 — Admin order detail** (Orders `[id]` page)
  - `orders.getById`: lines, total, payment status, `order_status_history`
    when available on `OrderDetail`.
  - Files: `src/app/(admin)/orders/[id]/page.tsx`,
    `src/features/orders/components/order-detail-screen.tsx`.
- [ ] **T4 — Admin catalogue browse** (Catalogue page)
  - Read-only `catalog.list` (name filter, pagination), schedule badge.
  - No create/edit yet (Phase 1 scope is "CRUD landed" backend; UI edit is
    lower priority than the review queues above).
  - Files: `src/features/catalog/components/catalogue-browse-screen.tsx`,
    edit `src/app/(admin)/catalog/page.tsx`.
- [ ] **T5 — Website storefront data exercise** (lower priority)
  - The cart / checkout / order-history pages build but were never run against
    real data. A separate track; depends on a running API + browser.

## Status

| Task | State |
|---|---|
| T1 Onboarding queue | done — `src/features/onboarding/components/onboarding-queue-screen.tsx`; approve/reject gated on `ONBOARDING_APPROVE`/`ONBOARDING_REJECT` |
| T2 Orders list + status | done — `src/features/orders/components/orders-screen.tsx`; actions derived from `ORDER_TRANSITIONS`, gated on `ORDER_APPROVE`/`ORDER_CANCEL` |
| T3 Order detail | done — `src/app/(admin)/orders/[id]/page.tsx` + `order-detail-screen.tsx` |
| T4 Catalogue browse | done — `src/features/catalog/components/catalogue-browse-screen.tsx`; read-only search + paging |
| T5 Website data exercise | pending (needs running API + browser) |

### Supporting change

`admin-portal/src/features/auth/api.ts` `callAuthed` now passes a `MediChainClient`
to its callback (not an `AuthApi`), matching the website's convention so domain
APIs (`createOrdersApi`, `createCatalogApi`, …) can be called through it. The
auth-only call site (`auth.me()`) and the dashboard were updated to wrap the
client with `createAuthApi(client)` themselves.

## Verification

- `npm run typecheck --workspace=@medichain/admin-portal` — pass
- `npm run lint --workspace=@medichain/admin-portal` — 0 problems
- `npm run build --workspace=@medichain/admin-portal` — pass; routes
  `/onboarding`, `/catalog`, `/orders`, `/orders/[id]` all built

The full monorepo build is the broader gate (run before a release, not per
commit, to keep the loop fast).

## Open follow-ups (not started)

- Catalogue create/edit UI (backend already supports `create`/`update`).
- Onboarding application wizard + document upload (backend submit-only so far).
- Mobile storefront (auth shell only).
- Order `order_status_history` on `OrderDetail` — the shared `OrderDetail` type
  does not yet carry it; add the field to `shared-types` when wiring history.

