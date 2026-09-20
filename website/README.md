# @medichain/website

The customer-facing application for distributors, wholesalers and retail pharmacies.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · TailwindCSS 4 ·
shadcn/ui · TanStack Query v5 · Zustand · React Hook Form + Zod

---

## Getting started

```bash
cp .env.example .env.local
pnpm install          # from the repo root
pnpm --filter @medichain/website dev
```

Runs at http://localhost:3000. Requires the backend at http://localhost:3001.

---

## Route groups

| Group | Auth | Rendering | Purpose |
|---|---|---|---|
| `(public)` | None | SSR / ISR | Landing, catalogue browse, salt search, apply-to-join |
| `(auth)` | None | CSR | Login, register, OTP, password reset |
| `(app)` | Required | CSR | Cart, checkout, orders, invoices, credit, returns, account |

**Why the public catalogue is server-rendered:** buyers search things like
"Paracetamol 500mg supplier" on the open web. SSR makes those pages indexable and
fast on first paint. The authenticated app behind the login behaves like a SPA.

**Why a separate `(auth)` group:** it needs a different layout and must not inherit
the app shell's auth guard. Route groups give each area its own layout without
changing the URL.

---

## Feature folders

`src/features/<feature>/` mirrors the backend module of the same name. A developer
working on orders finds `features/orders/` and `modules/orders/` with the same
vocabulary, which makes the API contract much easier to reason about.

```
features/orders/
├── components/     # OrderCard, OrderTimeline, StatusChip
├── hooks/          # useOrders, usePlaceOrder, useCancelOrder
├── api/            # thin wrappers over @medichain/api-client
├── schemas/        # Zod schemas (shared with the mobile app)
└── types.ts
```

---

## State management

| Kind of state | Tool | Why |
|---|---|---|
| Server data | **TanStack Query** | Caching, retries, background refetch, optimistic updates |
| Cart | **Zustand** + server sync | Instant UI; the server remains authoritative |
| Auth session | **Zustand** + `HttpOnly` cookie | Access token in memory, refresh token in a cookie |
| Form state | **React Hook Form** | Uncontrolled inputs, minimal re-renders |
| URL state | **Search params** | Filters and pagination must be shareable and bookmarkable |

**The rule that matters:** the cart is optimistic in the UI but **the server
recomputes price, stock and credit on every change**. If the recomputed values differ
from what is displayed, the UI updates to match the server — never the other way
around. A client-side price is a display convenience, never a fact.

---

## Security notes

| Concern | Approach |
|---|---|
| Token storage | Access token **in memory only**; refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie set by a BFF route handler |
| XSS | No `dangerouslySetInnerHTML` on user content; strict CSP |
| CSRF | `SameSite=Strict` + an origin check on state-changing BFF routes |
| File uploads | Pre-signed S3 URLs — files never pass through our API |
| Secrets | None in the browser bundle; the app only ever holds a public API base URL |
| Route protection | `proxy.ts` redirects unauthenticated users, but **the server enforces everything** |

**Client-side route guards are UX, not security.** The backend re-authorises every
request. A user who manipulates client state sees a broken UI, not unauthorised data.

---

## Performance

| Technique | Purpose |
|---|---|
| Server components by default | Less client JavaScript shipped |
| Streaming SSR + Suspense | Faster perceived load |
| `next/image` | Optimised, lazy-loaded images |
| ISR on public catalogue pages | Static speed with periodic freshness |
| TanStack Query cache | Instant back-navigation, fewer API calls |
| Virtualised tables | Large order and stock grids without freezing |
| Prefetch on hover | Perceived instant navigation |
| Bundle budget in CI | Fails the build if the bundle grows past the limit |

Budgets: LCP < 2.5 s, INP < 200 ms, first-load JS < 200 KB gzipped per route.

---

## Testing

```bash
pnpm test        # Vitest — unit + component
pnpm test:e2e    # Playwright — critical user journeys
```

Critical journeys covered by E2E:

1. Register → verify → login
2. Apply to join → admin approves → buyer logs in
3. Salt combination search returns the right products
4. Add to cart → checkout → order placed
5. Order appears in the order list with the correct status
6. Invoice downloadable
7. Credit limit exceeded → order blocked with a clear message
8. Prescription required → order blocked until verified
9. Duplicate submit (double-click) creates one order
10. Session expiry → silent refresh → no logout

---

## Internationalisation

`next-intl` with English and Hindi at launch. All user-facing strings live in
`public/locales/<lang>/`. Currency and number formatting are locale-driven.

**Money is always formatted from a decimal string**, never from a JavaScript number —
`formatMoney("1234.5600")`, never `formatMoney(1234.56)`.
