# 12 — Folder Structures

> **Status:** Approved · **Owner:** Architecture · **Last updated:** 2026-09-11

The complete target tree for every application, with the reason each folder exists.
Annotations explain **why**, not just **what**.

---

## 1. Repository root

```
GA_Edif_pharma/
├── backend/                     # NestJS API + workers + scheduler (one artifact, three roles)
├── website/                     # Next.js customer-facing application
├── admin-portal/                # Next.js back-office application
├── mobile/                      # React Native (Expo) app — Android + iOS
├── packages/                    # Shared TypeScript libraries
│   ├── api-client/              #   generated from OpenAPI — never hand-written
│   ├── shared-types/            #   DTOs, enums, domain types
│   ├── shared-utils/            #   decimal, date, salt-normalisation helpers
│   ├── ui/                      #   design-system primitives (web)
│   └── config/                  #   shared eslint / tsconfig / tailwind presets
├── infra/                       # Infrastructure as code
│   ├── docker/                  #   Dockerfiles, docker-compose, init scripts
│   ├── terraform/               #   cloud resources per environment
│   ├── k8s/                     #   manifests / Helm charts
│   ├── nginx/                   #   reverse-proxy config
│   ├── observability/           #   Prometheus, Grafana, alert rules
│   └── scripts/                 #   operational scripts
├── docs/                        # This documentation set
├── scripts/                     # Repo-level developer scripts
├── .github/workflows/           # CI/CD pipelines
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── .gitignore
└── README.md
```

**Why the apps are top-level rather than under `apps/`:** the brief names them as
first-class separate applications. Keeping them at the root makes that explicit while
still allowing pnpm workspaces to share packages. Deployment is fully independent —
nothing is shared at runtime, only at build time.

**Why a monorepo at all:** the four apps share DTOs, enums, validation schemas and a
generated API client. In a polyrepo, a field rename becomes four coordinated PRs and
a window where clients are broken. In a monorepo, the compiler finds every affected
call site in one build.

---

## 2. Backend

```
backend/
├── src/
│   ├── main.ts                          # bootstrap: role selection, shutdown hooks, CORS
│   ├── app.module.ts                    # root module — imports every feature module
│   │
│   ├── config/                          # ── configuration, validated at boot ──
│   │   ├── configuration.ts             #   typed config factory
│   │   ├── env.schema.ts                #   Zod schema — fails fast on malformed env
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   ├── jwt.config.ts
│   │   ├── storage.config.ts
│   │   ├── ai.config.ts                 #   bootstrap defaults only; runtime values live in DB
│   │   └── app.config.ts
│   │
│   ├── common/                          # ── cross-cutting concerns, no business logic ──
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts
│   │   │   ├── require-capability.decorator.ts
│   │   │   ├── scope-by.decorator.ts
│   │   │   ├── public.decorator.ts
│   │   │   ├── idempotent.decorator.ts
│   │   │   ├── audit.decorator.ts
│   │   │   └── cacheable.decorator.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── capability.guard.ts      #   RBAC check
│   │   │   ├── tenant-scope.guard.ts    #   ABAC scoping
│   │   │   ├── api-key.guard.ts
│   │   │   └── rate-limit.guard.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   ├── audit.interceptor.ts     #   writes audit_log on mutations
│   │   │   ├── transform.interceptor.ts #   response envelope
│   │   │   ├── timeout.interceptor.ts
│   │   │   ├── cache.interceptor.ts
│   │   │   ├── idempotency.interceptor.ts
│   │   │   └── correlation-id.interceptor.ts
│   │   ├── filters/
│   │   │   ├── all-exceptions.filter.ts #   RFC 9457 problem+json
│   │   │   ├── domain-exception.filter.ts
│   │   │   ├── validation-exception.filter.ts
│   │   │   └── prisma-exception.filter.ts
│   │   ├── pipes/
│   │   │   ├── validation.pipe.ts
│   │   │   ├── parse-uuid.pipe.ts
│   │   │   └── trim.pipe.ts
│   │   ├── middleware/
│   │   │   ├── tenant-context.middleware.ts
│   │   │   ├── request-context.middleware.ts
│   │   │   └── security-headers.middleware.ts
│   │   ├── cqrs/                        #   Command / Query buses (Mediator)
│   │   │   ├── command-bus.ts
│   │   │   ├── query-bus.ts
│   │   │   └── event-bus.ts
│   │   ├── database/
│   │   │   ├── unit-of-work.ts          #   transaction boundary
│   │   │   ├── transaction-context.ts
│   │   │   ├── tenant-scoping.extension.ts  # auto-injects tenant_id into every query
│   │   │   └── advisory-lock.service.ts #   distributed lock for crons
│   │   ├── idempotency/
│   │   │   ├── idempotency.service.ts
│   │   │   └── idempotency.store.ts
│   │   ├── exceptions/
│   │   │   ├── domain.exception.ts
│   │   │   ├── business-rule.exception.ts
│   │   │   ├── insufficient-credit.exception.ts
│   │   │   ├── insufficient-stock.exception.ts
│   │   │   ├── invalid-transition.exception.ts
│   │   │   └── configuration.exception.ts
│   │   ├── value-objects/
│   │   │   ├── money.vo.ts
│   │   │   ├── quantity.vo.ts
│   │   │   ├── gst-rate.vo.ts
│   │   │   ├── composition-key.vo.ts
│   │   │   └── phone.vo.ts
│   │   └── utils/
│   │       ├── pagination.util.ts
│   │       ├── decimal.util.ts
│   │       ├── date.util.ts
│   │       └── crypto.util.ts
│   │
│   ├── database/                        # ── schema, migrations, seeds ──
│   │   ├── schema.prisma
│   │   ├── migrations/                  #   versioned SQL — never edited after release
│   │   │   ├── 20260901_init_extensions/
│   │   │   ├── 20260901_init_tenancy_iam/
│   │   │   ├── 20260910_catalog_salt/
│   │   │   └── ...
│   │   ├── seeds/
│   │   │   ├── 01-tenant.ts
│   │   │   ├── 02-roles-capabilities.ts
│   │   │   ├── 03-salt-master.ts
│   │   │   ├── 04-categories.ts
│   │   │   ├── 05-demo-products.ts
│   │   │   └── 06-feature-flags.ts
│   │   └── factories/                   #   test data builders
│   │
│   ├── infra/                           # ── driven adapters (implement the ports) ──
│   │   ├── cache/
│   │   │   ├── redis.service.ts
│   │   │   ├── cache.service.ts         #   cache-aside + single-flight
│   │   │   └── cache-keys.ts
│   │   ├── queue/
│   │   │   ├── bullmq.module.ts
│   │   │   ├── queue.service.ts
│   │   │   └── processors/
│   │   ├── storage/
│   │   │   ├── s3.service.ts
│   │   │   └── storage.port.ts
│   │   ├── mailer/
│   │   │   ├── mailer.service.ts
│   │   │   └── templates/
│   │   ├── sms/
│   │   │   ├── sms.service.ts
│   │   │   └── providers/
│   │   ├── payment-gateways/
│   │   │   ├── payment-gateway.interface.ts
│   │   │   ├── payment-gateway.registry.ts
│   │   │   ├── razorpay.adapter.ts
│   │   │   ├── stripe.adapter.ts
│   │   │   └── mock.adapter.ts          #   dev/test only — never selectable in prod
│   │   ├── ai-providers/
│   │   │   ├── ai-provider.interface.ts
│   │   │   ├── ai-provider.registry.ts
│   │   │   ├── openai.provider.ts
│   │   │   ├── anthropic.provider.ts
│   │   │   ├── azure-openai.provider.ts
│   │   │   ├── bedrock.provider.ts
│   │   │   ├── ollama.provider.ts
│   │   │   └── custom-http.provider.ts
│   │   ├── http/
│   │   │   ├── resilient-http.client.ts #   retry + circuit breaker + timeout
│   │   │   └── http.module.ts
│   │   └── observability/
│   │       ├── logger.service.ts        #   Pino with redaction
│   │       ├── metrics.service.ts
│   │       ├── tracing.service.ts
│   │       └── health.service.ts
│   │
│   ├── modules/                         # ── bounded contexts ──
│   │   │
│   │   ├── iam/
│   │   │   ├── domain/
│   │   │   │   ├── entities/{user,role,session,otp-challenge}.entity.ts
│   │   │   │   ├── value-objects/{password,email,phone}.vo.ts
│   │   │   │   ├── events/{user-registered,password-changed}.event.ts
│   │   │   │   └── errors/iam.errors.ts
│   │   │   ├── application/
│   │   │   │   ├── commands/{register,login,refresh,logout,reset-password}.command.ts
│   │   │   │   ├── handlers/{register,login,refresh,logout}.handler.ts
│   │   │   │   ├── queries/{get-me,list-sessions}.query.ts
│   │   │   │   └── ports/{user,role,session}.repository.port.ts
│   │   │   ├── infrastructure/persistence/*.repository.ts
│   │   │   ├── api/{auth,users,roles}.controller.ts + dto/
│   │   │   ├── iam.module.ts
│   │   │   └── index.ts                 #   the ONLY public surface of this module
│   │   │
│   │   ├── tenancy/                     #   tenant, organisation, addresses
│   │   ├── onboarding-kyc/              #   applications, documents, review workflow
│   │   ├── catalog/                     #   products, manufacturers, categories, packs
│   │   ├── salt-engine/                 #   salts, aliases, composition, keys, search
│   │   ├── pricing/                     #   price lists, rules, schemes, explanation trail
│   │   ├── cart/                        #   server-side cart, quick order
│   │   ├── orders/                      #   order aggregate, state machine, sagas
│   │   ├── prescriptions/               #   upload, verification, schedule compliance
│   │   ├── inventory/                   #   warehouses, batches, ledger, ATP, FEFO
│   │   ├── credit/                      #   limits, exposure, append-only ledger
│   │   ├── payments/                    #   intents, webhooks, allocation, refunds
│   │   ├── invoicing/                   #   tax invoices, GST, credit notes, e-way bill
│   │   ├── logistics/                   #   shipments, transporters, tracking, ePOD
│   │   ├── returns/                     #   RMA, inspection, credit notes
│   │   ├── notifications/               #   templates, channels, delivery tracking
│   │   ├── search/                      #   SearchPort, adapters, projections, ranking
│   │   ├── reporting/                   #   read models, materialised views, exports
│   │   ├── audit/                       #   append-only audit log
│   │   ├── ai/                          #   provider registry, feature bindings, metering
│   │   ├── feature-flags/               #   flags, rollout, evaluation
│   │   ├── admin/                       #   back-office orchestration endpoints
│   │   └── health/                      #   /health/live, /health/ready
│   │
│   └── workers/                         # ── background processors ──
│       ├── outbox-relay.worker.ts       #   publishes domain events
│       ├── notification.worker.ts
│       ├── indexing.worker.ts
│       ├── invoice-pdf.worker.ts
│       ├── report.worker.ts
│       ├── export.worker.ts
│       ├── ai-enrichment.worker.ts
│       ├── saga-retry.worker.ts
│       └── schedulers/                  #   cron — every one takes an advisory lock
│           ├── expiry-alert.scheduler.ts
│           ├── licence-expiry.scheduler.ts
│           ├── credit-reconcile.scheduler.ts
│           ├── stock-reconcile.scheduler.ts
│           ├── payment-reconcile.scheduler.ts
│           ├── search-reindex.scheduler.ts
│           ├── partition-maintenance.scheduler.ts
│           ├── idempotency-cleanup.scheduler.ts
│           └── outbox-cleanup.scheduler.ts
│
├── test/
│   ├── unit/                            #   domain logic, no I/O
│   ├── integration/                     #   repositories + transactions (Testcontainers)
│   ├── e2e/                             #   full HTTP flows
│   ├── contract/                        #   OpenAPI conformance
│   ├── concurrency/                     #   money-path race tests — run on every PR
│   └── fixtures/
│
├── prisma/                              # (if using Prisma's own layout)
├── Dockerfile
├── .env.example
├── nest-cli.json
├── tsconfig.json
├── jest.config.ts
└── package.json
```

### The `index.ts` boundary rule

Each module exports **only** what other modules may use:

```ts
// modules/orders/index.ts
export { OrderStatus } from './domain/entities/order.entity';
export { ORDER_REPOSITORY } from './application/ports/order.repository.port';
export type { OrderRepository } from './application/ports/order.repository.port';
// NOT exported: entities, handlers, controllers, prisma repositories
```

```jsonc
// .eslintrc — enforced, not advisory
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        {
          "group": ["**/modules/*/domain/**", "**/modules/*/infrastructure/**",
                    "**/modules/*/application/handlers/**"],
          "message": "Import another module only through its index.ts public API."
        }
      ]
    }]
  }
}
```

This is what stops a modular monolith from decaying into a big ball of mud. Without
a mechanical boundary, "just one quick import" happens forty times and the modules
are no longer separable — which destroys the option to extract a service later.

---

## 3. Website (customer-facing)

```
website/
├── src/
│   ├── app/                             # ── Next.js App Router ──
│   │   ├── layout.tsx                   #   root layout, providers, fonts
│   │   ├── page.tsx                     #   public landing
│   │   ├── globals.css
│   │   │
│   │   ├── (public)/                    #   unauthenticated route group
│   │   │   ├── layout.tsx
│   │   │   ├── products/
│   │   │   │   ├── page.tsx             #   SSR catalogue (SEO)
│   │   │   │   └── [slug]/page.tsx      #   SSR product detail
│   │   │   ├── categories/[slug]/page.tsx
│   │   │   ├── salt-search/page.tsx     #   public salt combination search
│   │   │   ├── about/page.tsx
│   │   │   ├── contact/page.tsx
│   │   │   └── apply/page.tsx           #   "Apply to join" onboarding entry
│   │   │
│   │   ├── (auth)/                      #   authentication
│   │   │   ├── layout.tsx
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   ├── otp/page.tsx
│   │   │   ├── forgot-password/page.tsx
│   │   │   └── reset-password/page.tsx
│   │   │
│   │   ├── (app)/                       #   authenticated route group
│   │   │   ├── layout.tsx               #   auth guard + app shell
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── catalog/
│   │   │   │   ├── page.tsx             #   browse with facets
│   │   │   │   └── [productId]/page.tsx
│   │   │   ├── search/page.tsx          #   salt + general search
│   │   │   ├── cart/page.tsx
│   │   │   ├── checkout/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── review/page.tsx
│   │   │   │   └── confirmation/[orderId]/page.tsx
│   │   │   ├── orders/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [orderId]/page.tsx
│   │   │   ├── quick-order/page.tsx     #   paste SKUs / CSV indent
│   │   │   ├── prescriptions/page.tsx
│   │   │   ├── invoices/page.tsx
│   │   │   ├── payments/page.tsx
│   │   │   ├── credit/page.tsx          #   limit, ledger, statement
│   │   │   ├── returns/page.tsx
│   │   │   ├── reports/page.tsx
│   │   │   └── account/
│   │   │       ├── profile/page.tsx
│   │   │       ├── addresses/page.tsx
│   │   │       ├── users/page.tsx
│   │   │       └── security/page.tsx
│   │   │
│   │   ├── api/                         #   BFF route handlers (proxy + cookie mgmt)
│   │   │   ├── auth/[...]/route.ts      #   keeps refresh token in HttpOnly cookie
│   │   │   └── revalidate/route.ts
│   │   │
│   │   ├── error.tsx
│   │   ├── not-found.tsx
│   │   └── loading.tsx
│   │
│   ├── components/                      # ── presentational, reusable ──
│   │   ├── ui/                          #   shadcn/ui primitives (owned, not a dependency)
│   │   ├── layout/{header,sidebar,footer,mobile-nav}.tsx
│   │   ├── forms/                       #   form field wrappers
│   │   ├── data-table/                  #   TanStack Table wrapper
│   │   ├── charts/
│   │   └── feedback/{toast,modal,skeleton,empty-state}.tsx
│   │
│   ├── features/                        # ── feature modules (mirror backend contexts) ──
│   │   ├── auth/{components,hooks,api,schemas,store}.ts
│   │   ├── catalog/
│   │   ├── salt-search/
│   │   ├── cart/{components,hooks,api,store}.ts
│   │   ├── checkout/
│   │   ├── orders/
│   │   ├── prescriptions/
│   │   ├── invoices/
│   │   ├── credit/
│   │   ├── returns/
│   │   └── account/
│   │
│   ├── hooks/                           # ── shared hooks ──
│   │   ├── use-auth.ts
│   │   ├── use-permission.ts
│   │   ├── use-debounce.ts
│   │   ├── use-media-query.ts
│   │   └── use-pagination.ts
│   │
│   ├── lib/                             # ── infrastructure for the frontend ──
│   │   ├── api/
│   │   │   ├── client.ts                #   from @medichain/api-client
│   │   │   ├── interceptors.ts          #   auth header, refresh, error mapping
│   │   │   └── query-client.ts          #   TanStack Query config
│   │   ├── auth/
│   │   │   ├── session.ts
│   │   │   └── permissions.ts
│   │   ├── formatters/                  #   money, date, quantity (decimal-safe)
│   │   ├── validation/                  #   Zod schemas shared with the API client
│   │   └── utils.ts
│   │
│   ├── styles/
│   ├── types/
│   └── middleware.ts                    # route protection, redirects
│
├── public/
│   ├── images/
│   ├── icons/
│   └── locales/{en,hi}/
├── e2e/                                 # Playwright
├── Dockerfile
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

**Why route groups `(public)` / `(auth)` / `(app)`:** they give each area its own
layout and its own auth posture without affecting the URL. Public pages are
server-rendered for SEO; the authenticated app behaves like a SPA. A shared
`(app)/layout.tsx` enforces authentication once, for every nested route.

**Why `features/` mirrors the backend modules:** a developer working on orders finds
`features/orders/` and `modules/orders/` with the same name and the same vocabulary.
Cognitive overhead drops, and the API contract is easier to reason about.

---

## 4. Admin portal

```
admin-portal/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                     #   redirect to /dashboard
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx           #   MFA mandatory for staff
│   │   │   └── mfa/page.tsx
│   │   └── (admin)/
│   │       ├── layout.tsx               #   RBAC-aware shell
│   │       ├── dashboard/page.tsx
│   │       ├── onboarding/              #   application review queue
│   │       │   ├── page.tsx
│   │       │   └── [applicationId]/page.tsx
│   │       ├── organizations/
│   │       │   ├── page.tsx
│   │       │   └── [orgId]/{page,users,credit,pricing}.tsx
│   │       ├── catalog/
│   │       │   ├── products/{page,[productId]}.tsx
│   │       │   ├── salts/{page,[saltId]}.tsx
│   │       │   ├── manufacturers/page.tsx
│   │       │   ├── categories/page.tsx
│   │       │   └── import/page.tsx
│   │       ├── pricing/
│   │       │   ├── price-lists/page.tsx
│   │       │   ├── schemes/page.tsx
│   │       │   ├── overrides/page.tsx
│   │       │   └── simulator/page.tsx   #   "what would customer X pay?"
│   │       ├── orders/
│   │       │   ├── page.tsx
│   │       │   └── [orderId]/page.tsx
│   │       ├── inventory/
│   │       │   ├── stock/page.tsx
│   │       │   ├── batches/page.tsx
│   │       │   ├── grn/page.tsx
│   │       │   ├── adjustments/page.tsx
│   │       │   ├── transfers/page.tsx
│   │       │   ├── expiry/page.tsx
│   │       │   └── reconciliation/page.tsx
│   │       ├── credit/
│   │       │   ├── accounts/page.tsx
│   │       │   ├── limits/page.tsx
│   │       │   ├── holds/page.tsx
│   │       │   └── ageing/page.tsx
│   │       ├── payments/
│   │       │   ├── page.tsx
│   │       │   ├── reconciliation/page.tsx
│   │       │   └── offline/page.tsx
│   │       ├── invoices/
│   │       │   ├── page.tsx
│   │       │   ├── credit-notes/page.tsx
│   │       │   └── gst/page.tsx
│   │       ├── logistics/
│   │       │   ├── shipments/page.tsx
│   │       │   ├── transporters/page.tsx
│   │       │   └── eway-bills/page.tsx
│   │       ├── returns/page.tsx
│   │       ├── prescriptions/page.tsx   #   verification queue
│   │       ├── reports/
│   │       │   ├── sales/page.tsx
│   │       │   ├── inventory/page.tsx
│   │       │   ├── outstanding/page.tsx
│   │       │   ├── gst/page.tsx
│   │       │   └── builder/page.tsx
│   │       ├── users/page.tsx
│   │       ├── roles/page.tsx
│   │       ├── audit-logs/page.tsx
│   │       ├── jobs/page.tsx            #   queue monitor + dead letters
│   │       ├── settings/
│   │       │   ├── general/page.tsx
│   │       │   ├── ai-providers/page.tsx      # runtime AI config
│   │       │   ├── payment-gateways/page.tsx
│   │       │   ├── notifications/page.tsx
│   │       │   ├── feature-flags/page.tsx
│   │       │   └── security/page.tsx
│   │       └── support/tickets/page.tsx
│   ├── components/  features/  hooks/  lib/  styles/  types/
│   └── middleware.ts                    #   staff-only + optional IP allow-list
├── e2e/
├── Dockerfile
├── next.config.ts
└── package.json
```

**Why a separate app rather than routes inside the website:** the admin surface has a
different threat model (staff-only, ideally IP-restricted), a different release
cadence, and a much heavier UI (large tables, exports, charts). Bundling it into the
customer app would ship that weight to every buyer.

---

## 5. Mobile

```
mobile/
├── src/
│   ├── App.tsx                          #   root: providers, navigation container
│   │
│   ├── app/                             # ── app-level setup ──
│   │   ├── providers/
│   │   │   ├── QueryProvider.tsx        #   TanStack Query + MMKV persister
│   │   │   ├── AuthProvider.tsx
│   │   │   ├── ThemeProvider.tsx
│   │   │   ├── NotificationProvider.tsx
│   │   │   └── NetworkProvider.tsx      #   offline detection
│   │   ├── store/                       #   Zustand stores
│   │   │   ├── auth.store.ts
│   │   │   ├── cart.store.ts
│   │   │   └── ui.store.ts
│   │   └── bootstrap.ts
│   │
│   ├── navigation/                      # ── React Navigation ──
│   │   ├── RootNavigator.tsx            #   auth vs app switch
│   │   ├── AuthNavigator.tsx
│   │   ├── AppTabs.tsx                  #   bottom tabs
│   │   ├── CatalogStack.tsx
│   │   ├── OrdersStack.tsx
│   │   ├── AccountStack.tsx
│   │   ├── linking.ts                   #   deep links
│   │   └── types.ts                     #   typed navigation params
│   │
│   ├── screens/                         # ── one file per screen ──
│   │   ├── auth/{LoginScreen,OtpScreen,RegisterScreen}.tsx
│   │   ├── home/HomeScreen.tsx
│   │   ├── catalog/{CatalogScreen,ProductDetailScreen,CategoryScreen}.tsx
│   │   ├── search/{SearchScreen,SaltSearchScreen}.tsx
│   │   ├── cart/{CartScreen,CheckoutScreen}.tsx
│   │   ├── orders/{OrderListScreen,OrderDetailScreen,TrackOrderScreen}.tsx
│   │   ├── scan/BarcodeScanScreen.tsx
│   │   ├── prescriptions/{UploadScreen,ListScreen}.tsx
│   │   ├── invoices/InvoiceListScreen.tsx
│   │   ├── credit/CreditScreen.tsx
│   │   ├── returns/ReturnRequestScreen.tsx
│   │   ├── notifications/NotificationScreen.tsx
│   │   └── account/{ProfileScreen,AddressesScreen,SecurityScreen,SettingsScreen}.tsx
│   │
│   ├── components/                      # ── reusable UI ──
│   │   ├── ui/{Button,Input,Card,Badge,Modal,Sheet,EmptyState,Skeleton}.tsx
│   │   ├── product/{ProductCard,ProductGrid,PriceTag,StockBadge}.tsx
│   │   ├── cart/{CartItem,CartSummary}.tsx
│   │   ├── order/{OrderCard,OrderTimeline,StatusChip}.tsx
│   │   └── layout/{Header,TabBar,SafeAreaWrapper}.tsx
│   │
│   ├── features/                        # ── feature logic (mirrors web) ──
│   │   ├── auth/
│   │   ├── catalog/
│   │   ├── salt-search/
│   │   ├── cart/
│   │   ├── orders/
│   │   ├── prescriptions/
│   │   └── notifications/
│   │
│   ├── hooks/
│   │   ├── use-auth.ts
│   │   ├── use-network-status.ts
│   │   ├── use-push-notifications.ts
│   │   ├── use-barcode-scanner.ts
│   │   ├── use-debounce.ts
│   │   └── use-app-state.ts
│   │
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts                #   from @medichain/api-client
│   │   │   ├── interceptors.ts          #   token attach + silent refresh
│   │   │   └── query-client.ts
│   │   ├── storage/
│   │   │   ├── mmkv.ts                  #   fast KV cache
│   │   │   ├── secure-store.ts          #   tokens → Keychain/Keystore ONLY
│   │   │   └── query-persister.ts       #   offline cache
│   │   ├── notifications/
│   │   │   ├── push.ts
│   │   │   └── handlers.ts
│   │   ├── analytics/
│   │   ├── crash-reporting/
│   │   └── formatters/
│   │
│   ├── theme/
│   │   ├── colors.ts
│   │   ├── spacing.ts
│   │   ├── typography.ts
│   │   └── index.ts
│   │
│   ├── types/
│   └── i18n/{en,hi}.ts
│
├── assets/
│   ├── images/
│   ├── fonts/
│   └── icons/
├── app.json                             # Expo config
├── eas.json                             # EAS build profiles
├── babel.config.js
├── metro.config.js                      # monorepo-aware (watchFolders)
├── tsconfig.json
└── package.json
```

### Mobile-specific rules

| Rule | Reason |
|---|---|
| Tokens in `expo-secure-store` / Keychain, **never** AsyncStorage | AsyncStorage is unencrypted plaintext on disk |
| `metro.config.js` configured for the monorepo | Metro does not resolve workspace packages by default; without `watchFolders` and `nodeModulesPaths` the shared packages fail to resolve |
| `FlashList` for all long lists | `FlatList` drops frames past a few hundred items |
| Cart persisted in MMKV, server authoritative | Offline-first UX without trusting the client |
| Silent token refresh on 401 | Users must not be logged out mid-session |
| Deep links in `linking.ts` | Push notification taps must open the right screen |
| `X-App-Version` header on every request | Enables the server-side version gate |
| EAS build profiles: `development` / `preview` / `production` | Internal testing without touching production builds |

---

## 6. Shared packages

```
packages/
├── shared-types/
│   ├── src/
│   │   ├── auth/          { user, role, session, permission }.types.ts
│   │   ├── catalog/       { product, salt, category, manufacturer }.types.ts
│   │   ├── orders/        { order, order-line, status }.types.ts
│   │   ├── inventory/     { stock, batch, warehouse }.types.ts
│   │   ├── credit/        { credit-account, ledger-entry }.types.ts
│   │   ├── payments/      { payment, allocation }.types.ts
│   │   ├── invoicing/     { invoice, credit-note }.types.ts
│   │   ├── common/        { pagination, money, address, audit }.types.ts
│   │   └── enums.ts       #   single source of truth for every enum
│   └── index.ts
│
├── shared-utils/
│   ├── src/
│   │   ├── decimal.ts             #   money-safe arithmetic helpers
│   │   ├── salt/
│   │   │   ├── normalize.ts       #   THE shared normaliser (server + client)
│   │   │   ├── composition-key.ts
│   │   │   └── parse-query.ts
│   │   ├── date.ts
│   │   ├── currency.ts
│   │   ├── quantity.ts
│   │   ├── validation.ts
│   │   └── guards.ts
│   └── index.ts
│
├── api-client/
│   ├── src/
│   │   ├── generated/             #   ← generated from OpenAPI, DO NOT EDIT
│   │   ├── client.ts              #   typed fetch wrapper
│   │   ├── error.ts               #   problem+json → typed errors
│   │   └── endpoints/             #   thin typed helpers per module
│   └── index.ts
│
├── ui/
│   ├── src/
│   │   ├── components/            #   design-system primitives
│   │   ├── primitives/            #   tokens, theme
│   │   └── index.ts
│   └── package.json
│
└── config/
    ├── eslint/                    #   shared lint config (incl. module-boundary rules)
    ├── tsconfig/                  #   base / nextjs / nestjs / react-native presets
    ├── tailwind/                  #   shared design tokens
    └── prettier/
```

**The single most important shared file** is `packages/shared-utils/src/salt/normalize.ts`.
It is used by:

- the backend, to build `composition_key` on product save
- the backend, to normalise the search query
- the mobile app, to normalise and validate a query before sending

If the server-side and client-side normalisers ever diverge, exact matching breaks
silently. Sharing one implementation is the only reliable way to prevent that.

---

## 7. Infrastructure

```
infra/
├── docker/
│   ├── docker-compose.yml         #   local: postgres, redis, opensearch, minio, mailhog
│   ├── postgres-init/             #   extensions, roles, initial grants
│   ├── backend.Dockerfile         #   multi-stage, distroless runtime
│   ├── website.Dockerfile
│   └── admin.Dockerfile
│
├── terraform/
│   ├── modules/
│   │   ├── networking/            #   VPC, subnets, security groups
│   │   ├── database/              #   RDS Postgres, parameter groups, backups
│   │   ├── cache/                 #   ElastiCache Redis
│   │   ├── search/                #   OpenSearch domain
│   │   ├── storage/               #   S3 buckets + lifecycle policies
│   │   ├── compute/               #   ECS/EC2, autoscaling, ALB
│   │   ├── cdn/                   #   CloudFront + WAF
│   │   ├── secrets/               #   Secrets Manager
│   │   └── observability/         #   log groups, alarms, dashboards
│   ├── environments/
│   │   ├── dev/
│   │   ├── staging/
│   │   └── prod/
│   └── backend.tf                 #   remote state
│
├── k8s/
│   ├── base/                      #   deployments, services, configmaps
│   ├── overlays/{dev,staging,prod}/
│   ├── hpa/                       #   autoscaling policies
│   └── ingress/
│
├── nginx/
│   ├── nginx.conf                 #   reverse proxy, rate limiting, TLS
│   └── conf.d/
│
├── observability/
│   ├── prometheus/                #   scrape configs, alert rules
│   ├── grafana/dashboards/        #   RED, USE, business metrics
│   ├── loki/                      #   log aggregation
│   └── otel/                      #   collector config
│
└── scripts/
    ├── backup.sh
    ├── restore-drill.sh
    ├── reindex-search.sh
    ├── rebuild-salt-keys.sh
    ├── verify-stock-integrity.sh
    └── seed-demo-data.sh
```

---

## 8. CI/CD

```
.github/workflows/
├── ci.yml                 # lint → typecheck → test → build (every PR)
├── security.yml           # secret scan, dependency audit, SAST, container scan
├── contract.yml           # OpenAPI breaking-change detection
├── concurrency.yml        # money-path race tests — BLOCKING on every PR
├── tenant-isolation.yml   # cross-tenant access tests — BLOCKING on every PR
├── e2e.yml                # Playwright against staging (nightly)
├── load-test.yml          # k6 against staging (weekly)
├── deploy-backend.yml     # build → migrate → rolling deploy
├── deploy-web.yml         # website + admin
├── deploy-mobile.yml      # EAS build + submit
└── reindex-search.yml     # manual trigger
```

**The two blocking workflows that matter most:** `concurrency.yml` and
`tenant-isolation.yml`. The first prevents overselling and double-crediting; the
second prevents cross-tenant data leakage. Neither is reliably caught by code review,
so both are automated gates.

---

## 9. Naming conventions

| Item | Convention | Example |
|---|---|---|
| Files (TS) | `kebab-case` | `place-order.handler.ts` |
| React components | `PascalCase.tsx` | `ProductCard.tsx` |
| Classes | `PascalCase` | `PlaceOrderHandler` |
| Interfaces / ports | `PascalCase`, no `I` prefix | `OrderRepository` |
| Injection tokens | `SCREAMING_SNAKE` symbol | `ORDER_REPOSITORY` |
| DTOs | `<Verb><Noun>Dto` | `CreateOrderDto` |
| Commands | `<Verb><Noun>Command` | `PlaceOrderCommand` |
| Queries | `Get<Noun>Query` | `GetOrderQuery` |
| Events | `<Noun><PastTense>Event` | `OrderPlacedEvent` |
| DB tables | `snake_case`, singular | `order_line` |
| DB columns | `snake_case` | `grand_total` |
| API paths | `kebab-case`, plural nouns | `/catalog/products` |
| Env vars | `SCREAMING_SNAKE` | `DATABASE_URL` |
| Feature flags | `FF_<AREA>_<CAPABILITY>` | `FF_MOBILE_APP_ENABLED` |

Consistency here is not cosmetic. In a codebase with four apps and a shared package,
inconsistent naming is a real tax on every search and every code review.
