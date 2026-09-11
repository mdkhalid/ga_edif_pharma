# Shared packages

TypeScript libraries shared by the backend, website, admin portal and mobile app.

| Package | Purpose | Consumers |
|---|---|---|
| `@medichain/shared-types` | DTOs, enums, domain types | all |
| `@medichain/shared-utils` | Decimal, date, salt normalisation, guards | all |
| `@medichain/api-client` | Typed API client, **generated from OpenAPI** | website, admin, mobile |
| `@medichain/ui` | Design-system primitives (web) | website, admin |
| `@medichain/config` | Shared eslint / tsconfig / tailwind presets | all |

---

## `@medichain/shared-types`

Single source of truth for every type that crosses a network boundary.

```
src/
├── auth/         user, role, session, permission
├── catalog/      product, salt, category, manufacturer, composition
├── orders/       order, order-line, order-status
├── inventory/    stock, batch, warehouse, reservation
├── credit/       credit-account, ledger-entry
├── payments/     payment, allocation, refund
├── invoicing/    invoice, invoice-line, credit-note
├── common/       pagination, money, address, audit, problem-details
└── enums.ts      every shared enum, defined once
```

**Enums are defined once and imported everywhere.** A status string duplicated in four
codebases is a status string that will eventually disagree with itself.

---

## `@medichain/shared-utils`

### The most important file in the repository

`src/salt/normalize.ts` — the salt normaliser.

```ts
export function normalizeToken(input: string): string;
export function normalizeStrength(value: number | string, unit: string): string;
export function buildCompositionKey(parts: CompositionPart[]): string;
```

**This module must be used by both the product side and the query side.** The backend
uses it to build `composition_key` when a product is saved; the backend *and* the
mobile app use it to normalise a search query before sending it.

If the two ever diverge — even by one character of casing or whitespace — exact
composition matching breaks **silently**. Products remain in the catalogue but become
invisible to the platform's most important feature. There is no error, no log, no
alert; just a search that returns fewer results than it should.

This is why the normaliser is a shared package rather than duplicated logic. It is
also why `packages/shared-utils/src/salt/normalize.spec.ts` has 100% branch coverage
and runs on every commit.

Other utilities:

| Module | Purpose |
|---|---|
| `decimal.ts` | Money-safe arithmetic helpers built on `decimal.js` |
| `date.ts` | Date parsing, formatting, timezone handling |
| `currency.ts` | Locale-aware money formatting **from a decimal string** |
| `quantity.ts` | Unit conversion (unit ↔ pack ↔ case) |
| `validation.ts` | Zod schemas shared between server and client |
| `guards.ts` | Type guards |

**Money is always a string.** `formatMoney("1234.5600")`, never
`formatMoney(1234.56)`. The helper functions accept only strings to make the
mistake impossible.

---

## `@medichain/api-client`

**Generated from the OpenAPI spec. Never hand-edited.**

```bash
pnpm --filter @medichain/backend openapi:generate
pnpm --filter @medichain/api-client generate
```

```
src/
├── generated/       # ← do not edit; regenerated on every contract change
├── client.ts        # typed fetch wrapper
├── error.ts         # RFC 9457 problem+json → typed errors
└── endpoints/       # thin typed helpers per module
```

**Why generate rather than hand-write:** a hand-written client drifts from the server
the moment someone forgets to update it. The failure surfaces as a runtime
`undefined` in production, not a compile error. Generation makes the contract change
visible in a diff and in the type checker.

The generated client is committed, so a contract change is always reviewable.

---

## `@medichain/ui`

Design-system primitives for the web apps: buttons, inputs, cards, badges, modals,
sheets, tables, empty states, skeletons. Built on Tailwind and shadcn/ui.

Components are **copied in and owned**, not consumed from a versioned dependency. That
means no version lock-in and no waiting for an upstream fix.

The mobile app does **not** use this package — React Native cannot render DOM
components. Mobile has its own primitives in `mobile/src/components/ui/`, sharing only
the design tokens.

---

## `@medichain/config`

| Preset | Purpose |
|---|---|
| `eslint/` | Shared lint rules, **including the module-boundary rule** |
| `tsconfig/` | `base`, `nestjs`, `nextjs`, `react-native` presets |
| `tailwind/` | Shared design tokens |
| `prettier/` | Shared formatting |

### The module-boundary ESLint rule

```jsonc
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [{
        "group": [
          "**/modules/*/domain/**",
          "**/modules/*/infrastructure/**",
          "**/modules/*/application/handlers/**"
        ],
        "message": "Import another module only through its index.ts public API."
      }]
    }]
  }
}
```

This rule is what keeps the modular monolith modular. Without a mechanical boundary,
"just one quick import" happens forty times, the modules become inseparable, and the
option to extract a service later — the entire premise of ADR-000 — is quietly lost.

**A boundary enforced only by convention is not enforced.**

---

## Development

```bash
pnpm --filter @medichain/shared-types build
pnpm --filter @medichain/shared-utils test
pnpm --filter @medichain/api-client generate
```

Packages are consumed as TypeScript source in development (via path mappings) and as
compiled output in production, so changes are picked up immediately without a build
step during local development.
