# @medichain/admin-portal

The back-office application for pharma staff: onboarding review, catalogue, pricing,
inventory, credit, invoicing, logistics, reports and platform configuration.

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · TailwindCSS 4 ·
shadcn/ui · TanStack Query v5 · TanStack Table · Recharts

---

## Why this is a separate application

It could have been a route group inside the website. It is not, for four reasons:

| Reason | Detail |
|---|---|
| **Different threat model** | Staff-only. Can be network-restricted (VPN / IP allow-list) and deployed to a private subnet. |
| **Different release cadence** | Back-office changes must not risk the customer app, and vice versa. |
| **Different bundle profile** | Large tables, exports and charts would bloat every buyer's download. |
| **Different compliance posture** | Mandatory MFA, stricter session policy, full audit of every action. |

Shared code — the design system, API client and types — comes from `packages/`.

---

## Getting started

```bash
cp .env.example .env.local
pnpm install
pnpm --filter @medichain/admin-portal dev
```

Runs at http://localhost:3002.

---

## Modules

| Route | Purpose |
|---|---|
| `/onboarding` | Application review queue, approval, request-info |
| `/organizations` | Buyer profiles, users, credit, assigned pricing |
| `/catalog` | Products, salts, manufacturers, categories, bulk import |
| `/pricing` | Price lists, schemes, overrides, **price simulator** |
| `/orders` | All orders, approval, modification, manual transitions |
| `/inventory` | Stock, batches, GRN, adjustments, transfers, expiry, reconciliation |
| `/credit` | Accounts, limits, holds, ageing |
| `/payments` | Payments, reconciliation, offline recording |
| `/invoices` | Invoices, credit notes, GST |
| `/logistics` | Shipments, transporters, e-way bills |
| `/returns` | Return queue, inspection, credit notes |
| `/prescriptions` | Pharmacist verification queue |
| `/reports` | Sales, inventory, outstanding, GST, custom builder |
| `/users`, `/roles` | Staff and buyer account management |
| `/audit-logs` | Full audit trail with before/after diffs |
| `/jobs` | Background queue monitor, dead letters, retry |
| `/settings` | **Runtime configuration: AI providers, payment gateways, notifications, feature flags** |
| `/support` | Tickets |

---

## Security

| Control | Implementation |
|---|---|
| Authentication | Email + password + **mandatory TOTP MFA** for all staff roles |
| Session | Shorter TTL than buyer sessions; idle timeout |
| Authorisation | Capability-based, enforced server-side; the UI hides what the user cannot do |
| Network | Optional VPN / IP allow-list at the ingress |
| Impersonation | Requires `SUPPORT`, reason mandatory, time-boxed, **read-only by default**, fully audited |
| Audit | Every action logged with actor, IP, before/after |

**The UI hiding a button is not access control.** Every action is authorised on the
server. A staff member who crafts a request for a capability they lack gets a 403.

---

## The settings area — runtime configuration

This is where the "change the AI provider without redeploying" requirement is
fulfilled. See [docs/13-runtime-configuration.md](../docs/13-runtime-configuration.md).

| Screen | What it does |
|---|---|
| **AI Providers** | Enable/disable AI, pick the default provider, set per-feature provider and model, set the monthly budget, **test a connection before saving** |
| **Payment Gateways** | Select provider, set key id / secret / webhook secret |
| **Notifications** | Email, SMS and WhatsApp provider configuration |
| **Feature Flags** | Toggle capabilities with percentage rollout and per-role / per-organisation targeting |
| **Business Rules** | Minimum order value, near-expiry horizon, credit check mode, salt fuzzy threshold |

### Rules the settings UI enforces

- **Secrets are write-only.** A stored key displays as `••••••••` with a
  last-updated timestamp. It can be replaced but never read back.
- **Test before save.** A new provider key can be validated against the live API
  before it is committed, so a broken key is caught in the UI, not in production.
- **Every change is audited** with actor and before/after. Secrets are recorded as
  `[REDACTED]`.
- **Changes are live within 30 seconds** across every backend pod, with no restart
  and no deploy.

---

## Table and export conventions

| Concern | Convention |
|---|---|
| Pagination | Server-side, offset for admin lists, cursor for large logs |
| Sorting | Always includes a unique tiebreaker so pagination is stable |
| Filters | Persisted in URL search params so a view is shareable |
| Exports | Always a **background job** with a download link — never a blocking request |
| Large tables | Virtualised via TanStack Table |
| Empty states | Explain what would appear here and how to make it appear |

**Why exports are always async:** a 200,000-row export would hold an HTTP connection
for minutes, consume a database connection, and time out at the load balancer.
Generating it as a job and emailing a link is the only approach that scales.

---

## Testing

```bash
pnpm test        # Vitest
pnpm test:e2e    # Playwright
```

Critical journeys:

1. Review and approve an onboarding application
2. Approve an order pending approval
3. Adjust stock with approval workflow
4. Change a credit limit and see it reflected in the buyer's available credit
5. Issue a credit note against an invoice
6. Cancel an invoice with a mandatory reason
7. **Switch the AI provider and verify it takes effect without a restart**
8. Toggle a feature flag and observe the effect on the buyer side
9. Generate a report export and download it
10. Impersonate a buyer (read-only) and verify the action is audited
