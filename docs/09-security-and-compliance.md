# 09 — Security & Compliance

> **Status:** Approved · **Owner:** Security + Architecture · **Last updated:** 2026-09-11

Two domains in one document, because in pharma they are inseparable: a security
control is often the compliance control, and vice versa.

**Part A** — application security. **Part B** — pharma, tax and data compliance.

---

# Part A — Application Security

## 1. Threat model summary

| Threat | Vector | Primary control |
|---|---|---|
| Credential stuffing | Automated login attempts | Rate limit + lockout + optional MFA |
| Token theft | XSS, insecure mobile storage | HttpOnly cookies, Keychain, short TTL, rotation with reuse detection |
| Privilege escalation | Forged role claim, IDOR | Server-side authorisation, re-checked capability cache |
| Cross-tenant leakage | Missing `WHERE tenant_id` | Auto-injected tenant scope + repository assertion + isolation test suite |
| Price/quantity tampering | Client-supplied money values | **Money is server-computed; client values ignored** |
| Duplicate order / double credit | Retries, redelivered webhooks | Idempotency keys + unique constraints |
| Forged payment webhook | Missing signature check | Signature verification, **fail closed** |
| SQL injection | Unsanitised input | Parameterised queries only; no string concatenation |
| File upload abuse | Malware, oversized files | Type/size allow-list, virus scan, S3 quarantine bucket |
| Data exfiltration | Over-broad queries, exports | Pagination caps, export rate limits, audit logging |
| Insider misuse | Staff with broad access | Least privilege, segregation of duties, full audit trail |
| DoS | Traffic flood | WAF, layered rate limiting, autoscaling, query timeouts |
| Supply chain | Malicious dependency | Lockfile, Renovate, audit in CI, no postinstall scripts |
| Secret leakage | Committed `.env` | Secret scanning in CI, pre-commit hook, encrypted runtime config |

---

## 2. Authentication

| Control | Implementation |
|---|---|
| Password hashing | **argon2id**, memory 19 MiB, iterations 2, parallelism 1 |
| Password policy | ≥ 10 chars, checked against a breached-password list, no composition rules (they reduce entropy) |
| Access token | JWT, HS256, **15 min TTL**, held in memory only |
| Refresh token | Opaque random 256-bit, **30 day TTL**, rotated on every use, stored as a hash |
| Refresh reuse detection | A replayed rotated token revokes the **entire token family** |
| Refresh storage | `HttpOnly; Secure; SameSite=Strict` cookie (web); Keychain/Keystore (mobile) |
| OTP | `crypto.randomInt()` (never `Math.random()`), hashed at rest, **deleted on successful verification**, 5 min TTL, max 5 attempts |
| Account lockout | Exponential backoff after 5 failures: 1 m → 5 m → 15 m → 1 h |
| MFA | TOTP; **mandatory** for all staff/admin roles, optional for buyers |
| Session management | Device registry, list + revoke, `sid` claim enables instant revocation |
| Login notifications | Email on new-device login |

### The OTP detail that is usually wrong

```ts
// WRONG — predictable, and replayable within its TTL
const otp = Math.floor(100000 + Math.random() * 900000).toString();

// RIGHT
import { randomInt } from 'node:crypto';
const otp = randomInt(100000, 1000000).toString();

// And on successful verification — DELETE it, do not just mark it used:
await tx.otpChallenge.delete({ where: { id: challenge.id } });
```

`Math.random()` is a PRNG, not a CSPRNG. Its output is predictable from prior
values, which turns "guess a 6-digit code" into "compute the next 6-digit code".
And an OTP that is only marked consumed can be replayed until it expires.

### The permission re-check

Capabilities are embedded in the JWT for speed, but **the guard re-checks against a
Redis-cached permission set keyed by `sid` on every request**. Without this, revoking
a user's role leaves them with full access for up to 15 minutes — the token's
remaining lifetime.

```
Request → verify JWT signature → extract sid → read caps from Redis (key: sess:<sid>)
        → compare against the required capability
        → if the cached set is missing, fall back to the database
```

---

## 3. Authorisation

**Two independent enforcement layers.** A single missed guard must not become a data
breach.

```
Layer 1 — Guard (declarative, per-route)
  @RequireCapability('order:create')
  @ScopeBy({ organisation: 'own' })
  → rejects with 403 before the handler runs

Layer 2 — Query scope (automatic, per-query)
  Prisma middleware injects `tenant_id = ctx.tenantId`
  Repository asserts the filter is present before executing
  → an unguarded query still cannot cross tenants
```

### Role model

| Role | Scope | Key capabilities |
|---|---|---|
| `SUPER_ADMIN` | Platform | Everything (break-glass, fully audited) |
| `TENANT_ADMIN` | Tenant | Everything within the tenant except money posting |
| `CATALOG_MANAGER` | Tenant | `catalog:*`, `salt:*` |
| `PRICING_MANAGER` | Tenant | `pricing:*`, `scheme:*` |
| `ORDER_MANAGER` | Tenant | `order:*`, `shipment:*` |
| `FINANCE` | Tenant | `invoice:*`, `payment:*`, `credit:*`, `report:financial` |
| `WAREHOUSE_OPERATOR` | Warehouse | `inventory:*` scoped to assigned warehouses |
| `SALES_REP` | Region | `order:create`, `order:read` scoped to assigned organisations |
| `SUPPORT` | Tenant | Read-only + impersonation (audited, time-boxed) |
| `BUYER_ADMIN` | Organisation | Own org's orders, cart, payments, users |
| `BUYER_USER` | Organisation | Own orders, cart |

### Segregation of duties

| Action | Rule |
|---|---|
| Credit limit change | Requester ≠ approver |
| Stock adjustment | Requester ≠ approver |
| Price override above threshold | Requires `PRICING_MANAGER` approval |
| Invoice cancellation | Requires `FINANCE` + reason, fully audited |
| Impersonation | Requires `SUPPORT`, reason mandatory, time-boxed, **read-only by default** |

### IDOR prevention

Every resource lookup includes the tenant and scope filter **in the query**, not in
a post-fetch check:

```ts
// WRONG — fetches any order, then checks (and leaks existence via the error)
const order = await repo.findById(id);
if (order.tenantId !== ctx.tenantId) throw new ForbiddenException();

// RIGHT — the filter is part of the query; a foreign order simply does not exist
const order = await repo.findFirst({ where: { id, tenantId: ctx.tenantId } });
if (!order) throw new NotFoundException();
```

And: a resource belonging to another tenant returns **404, never 403**. A 403
confirms the resource exists.

---

## 4. Input validation

| Layer | Control |
|---|---|
| Transport | Body size limit (1 MB JSON, 25 MB multipart), content-type allow-list |
| DTO | `class-validator` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` |
| Type coercion | `class-transformer` with explicit `@Type()` — no implicit coercion |
| Domain | Invariants re-validated inside the aggregate |
| Database | `CHECK` constraints, `NOT NULL`, foreign keys, unique indexes |
| Output | Response DTOs — never serialise a domain entity directly |

### The ValidationPipe trap

```ts
// BROKEN — the ValidationPipe silently skips validation entirely
// because an `interface` erases at runtime and the metatype resolves to Object
interface CreateOrderDto { lines: OrderLineDto[]; }
@Post() create(@Body() dto: CreateOrderDto) { /* NOT VALIDATED */ }

// CORRECT — a decorated class
export class CreateOrderDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto)
  lines: OrderLineDto[];

  @IsOptional() @IsString() @MaxLength(500)
  buyerNote?: string;
}
@Post() create(@Body() dto: CreateOrderDto) { /* validated */ }
```

This is a silent failure: the endpoint works, tests pass, and **no validation runs
at all**. A lint rule bans interfaces in DTO positions.

### Mass-assignment prevention

DTOs are explicit allow-lists with `whitelist: true`. A client cannot set
`status`, `grandTotal`, `tenantId`, `exposure` or any other server-owned field —
they are not in the DTO, so `forbidNonWhitelisted` rejects the request.

**Money and status are never accepted from a client.** The order endpoint takes
`productId` + `quantity`; everything else is computed.

---

## 5. Rate limiting

Layered, and **fail-open** (see ADR-014).

| Layer | Scope | Limit | Failure behaviour |
|---|---|---|---|
| WAF / CDN | Per IP | 2,000 / min | Block / challenge |
| LB | Per IP | 1,000 / min | 429 |
| App — anonymous | Per IP | 60 / min | 429 |
| App — authenticated | Per principal | 300 / min | 429 |
| App — login / OTP | Per IP **and** username | 10 / min | 429 + lockout escalation |
| App — search | Per principal | 120 / min | 429 |
| App — order creation | Per principal | 60 / min | 429 |
| App — exports | Per principal | 5 / hour | 429 |

Algorithm: **sliding window** (Redis sorted set). A fixed window allows a 2× burst
at the boundary — 60 requests at 11:59:59 and 60 more at 12:00:00 is 120 in one
second.

Headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and
`Retry-After` on 429.

**Fail-open rationale:** if Redis is unreachable, rejecting all traffic turns a cache
outage into a total outage. The WAF still enforces a coarse per-IP limit, so the
system is degraded, not defenceless.

---

## 6. Transport and headers

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(self)` |
| `Cache-Control` | `no-store` on authenticated responses |

TLS 1.2+ only, modern cipher suites, HSTS preloaded. Internal service traffic is
re-encrypted even inside the VPC.

### CORS — the configuration that bites

```ts
// BROKEN — browsers reject this combination outright, and if it ever
// "worked" it would mean any origin can make credentialed requests
app.enableCors({ origin: '*', credentials: true });

// CORRECT — reflect a validated allow-list
app.enableCors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Authorization','Content-Type','Idempotency-Key','X-Correlation-Id','X-App-Version','X-App-Platform'],
  maxAge: 86400,
});
```

A startup check **fails the boot** in production if `origin: '*'` is configured
alongside credentials. This is checked in the deployed task definition, not only in
the code — a config drift in the deployment is the usual root cause.

---

## 7. Encryption and secrets

| Data | At rest | In transit |
|---|---|---|
| Passwords | argon2id hash | TLS |
| OTP codes | SHA-256 hash | TLS |
| Refresh tokens | argon2/SHA-256 hash | TLS |
| TOTP secrets | AES-256-GCM, `bytea` | TLS |
| Third-party API keys | AES-256-GCM in `platform_setting.value_encrypted` | TLS |
| Documents (licences, prescriptions) | S3 SSE-KMS | TLS + pre-signed URLs |
| Database | Volume encryption + TDE where available | TLS |
| Backups | Encrypted, cross-region | TLS |

**Key management**

- The master key (`ENCRYPTION_KEY`, 32 bytes base64) lives in AWS Secrets Manager or
  Vault — **never** in the repository, never in the database it protects.
- Column encryption uses AES-256-GCM with a random 96-bit IV per value and the
  ciphertext stored as `iv || tag || ciphertext`.
- Key rotation is supported: values carry a key-version prefix, and a background job
  re-encrypts on rotation.
- Secrets are **write-only through the API** — a secret can be set but never read
  back. The UI shows `••••••••` and a "last updated" timestamp.

**Secret hygiene**

- Secret scanning (gitleaks) runs in CI **and** as a pre-commit hook.
- A detected secret fails the build and raises a rotation ticket.
- `.env` is gitignored; only `.env.example` with placeholder values is committed.

---

## 8. Money-safety checklist

This is a **merge gate**. Every item must be verified before a money-path change ships.

### Concurrency

- [ ] No read-modify-write on a balance. Every mutation uses `SELECT … FOR UPDATE`
      inside the transaction.
- [ ] The row lock is acquired **before** any check that depends on the locked value.
- [ ] Idempotency checks are **inside** the transaction, after the lock. A check
      before the transaction is a TOCTOU race.
- [ ] Optimistic locking (`version`) on aggregates where pessimistic locks would
      serialise too aggressively.
- [ ] Concurrent tests exist for: credit limit, stock allocation, payment
      application, ledger posting.

### Ordering and atomicity

- [ ] All validation that can throw happens **before** the first write. A guard that
      throws after a partial write strands the row in a half-applied state.
- [ ] A failed upstream call **rolls back** the transaction. Errors are never
      swallowed by a `catch` that then proceeds to mutate state.
- [ ] Multi-step workflows use an orchestrated saga with explicit compensations.
- [ ] Saga steps are idempotent and re-drivable.

### Idempotency

- [ ] Every unsafe endpoint accepts `Idempotency-Key`.
- [ ] Payment webhooks are deduped by `(provider, provider_event_id)` — a unique
      constraint, not application logic.
- [ ] Webhook signature verification **fails closed**: a missing provider config
      throws; it never falls back to a permissive provider.
- [ ] Webhook handlers return `{ received: false }` on error rather than a 500, so
      the provider does not retry forever.

### Arithmetic

- [ ] All money is `NUMERIC(18,4)`; no `float`, no `double`.
- [ ] All arithmetic uses `decimal.js`; native operators on money are lint-banned.
- [ ] Rounding happens exactly once, at the documented boundary.
- [ ] Tax is computed per line and summed — never computed on the aggregate.

### Scheduling

- [ ] Every money-mutating cron takes a **Postgres advisory lock**.
- [ ] The advisory lock uses a dedicated `QueryRunner` for acquire **and** release —
      advisory locks are session-scoped, so a pooled connection breaks them.

```ts
private static readonly LOCK_KEY = 728401993;

@Cron('0 */15 * * * *')
async reconcileCreditExposure() {
  const qr = this.dataSource.createQueryRunner();
  await qr.connect();
  try {
    const [row] = await qr.query('SELECT pg_try_advisory_lock($1) AS acquired', [LOCK_KEY]);
    if (row?.acquired !== true) return;          // another replica owns it — skip
    try {
      await this.run();
    } finally {
      await qr.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    await qr.release();
  }
}
```

### Ledger integrity

- [ ] The ledger is append-only — no `UPDATE`, no `DELETE`.
- [ ] Corrections are compensating entries, never edits.
- [ ] Balance is **derived** from the ledger; any cached balance is reconciled nightly.
- [ ] A unique constraint prevents duplicate postings from the same source document.

---

## 9. OWASP API Top 10 mapping

| Risk | Control in this design |
|---|---|
| API1 Broken Object Level Authorisation | Tenant + scope filter in the query; 404 not 403 |
| API2 Broken Authentication | argon2id, short TTL, rotation with reuse detection, MFA for staff |
| API3 Broken Object Property Level Authorisation | Explicit DTO allow-lists; `forbidNonWhitelisted`; no entity serialisation |
| API4 Unrestricted Resource Consumption | Pagination caps, rate limits, body size limits, query timeouts, export throttling |
| API5 Broken Function Level Authorisation | Capability guards on every route; staff routes under `/admin` |
| API6 Unrestricted Access to Sensitive Business Flows | Idempotency, rate limits, approval workflows, fraud signals |
| API7 SSRF | No user-supplied URLs are fetched; outbound calls are allow-listed |
| API8 Security Misconfiguration | Startup config assertions; no `*` CORS; security headers; no default credentials |
| API9 Improper Inventory Management | Versioned API, `/docs` reflects reality, deprecated endpoints tracked |
| API10 Unsafe Consumption of Third-Party APIs | Timeouts, retries with backoff, circuit breakers, response validation |

---

## 10. Logging and PII

**Never logged:** passwords, OTP codes, tokens, full card numbers, CVV, full bank
account numbers, prescription contents, TOTP secrets.

**Logged with care:** email and phone are masked (`a***@example.com`, `+91*****1234`)
except in the audit log, which is access-controlled.

Structured logging with a redaction allow-list — the logger drops any key matching
`/password|token|secret|otp|card|cvv|authorization/i` by default. Opting *in* to
logging a sensitive field is explicit and reviewed.

---

## 11. Dependency and supply-chain security

| Control | Implementation |
|---|---|
| Lockfile committed | `pnpm-lock.yaml` is the single source of dependency truth |
| No floating versions | Exact pins in `package.json` |
| Automated updates | Renovate, grouped, weekly |
| Vulnerability scanning | `pnpm audit` + Dependabot alerts, CI-blocking on high/critical |
| Install scripts | `ignore-scripts=true` where feasible; any exception is reviewed |
| Container scanning | Trivy on every image build |
| Base images | Distroless / alpine, pinned by digest |
| SBOM | Generated per release |

---

## 12. Security testing

| Type | When | Tooling |
|---|---|---|
| SAST | Every PR | CodeQL / Semgrep |
| Dependency audit | Every PR | `pnpm audit`, Trivy |
| Secret scan | Every commit + PR | gitleaks |
| DAST | Nightly on staging | OWASP ZAP |
| Tenant isolation suite | Every PR | Custom automated test suite |
| Concurrency / money tests | Every PR | Custom integration tests |
| Penetration test | Before each major launch | External firm |
| Chaos / failover drills | Quarterly | Custom runbooks |

**The tenant isolation suite is non-negotiable.** It attempts cross-tenant reads and
writes for every resource type and asserts a 404/403 in every case. A single missing
`tenant_id` filter is a data breach, and code review will not reliably catch it.

---

# Part B — Pharma, Tax and Data Compliance

> **Important:** this section describes the technical controls the system
> implements. It is not legal advice. Statutory requirements must be confirmed with
> the company's regulatory and legal advisors for each jurisdiction of operation.

## 13. Drug licence verification

| Control | Implementation |
|---|---|
| Licence capture | Number, type (20/21, 20B/21B), issuing state, validity, scanned document |
| Verification | Manual review at onboarding; optional API verification where available |
| Expiry monitoring | Nightly job scans `drug_licence_expiry`; reminders at 90/60/30/7 days |
| Auto-suspension | On expiry, the organisation moves to `SUSPENDED` and cannot order |
| Re-verification | Required on expiry or on material change of details |
| Audit | Every verification decision stored with reviewer, timestamp and evidence |

**Auto-suspension is enforced at the order path**, not just as a dashboard warning:
a `SUSPENDED` organisation cannot place an order, full stop.

## 14. Schedule classification and prescription control

| Schedule | Control |
|---|---|
| **OTC** | No restriction |
| **H** | Sale recorded; prescription required per policy; register maintained |
| **H1** | Prescription **mandatory**; separate register; stricter record retention |
| **X** | Prescription mandatory; separate register; dual authorisation; quantity caps |
| **Narcotic** | As X, plus movement register and enhanced audit |

Enforcement points:

1. **Cart** — a schedule H/H1/X line triggers a prescription-required prompt.
2. **Order placement** — the server rejects an order containing a controlled item
   without a verified prescription. This is a **server-side** check; a client-side
   warning is worthless.
3. **Fulfilment** — dispatch is blocked if the prescription was not verified.
4. **Registers** — Schedule H/H1/X registers are generated from the dispensed
   records, not maintained by hand.

**Why server-side enforcement is the whole point:** dispensing a Schedule H1 drug
without a valid prescription is a criminal offence, not a policy violation. Any
control that a modified client can bypass does not exist.

## 15. GST and tax compliance

| Requirement | Implementation |
|---|---|
| GSTIN on every invoice | Captured at onboarding, printed on the invoice |
| Place of supply | Derived from the ship-to state code |
| CGST + SGST (intra-state) / IGST (inter-state) | Computed per line from the supply type |
| HSN codes | Per product, with HSN-wise summary on the invoice |
| Tax rate changes | Effective-dated rates; historical invoices keep their original rate |
| Gapless invoice numbering | Sequence allocated inside the invoice transaction |
| Invoice immutability | No `UPDATE` grant on money columns; corrections via credit note |
| Credit / debit notes | Linked to the original invoice, with a reason |
| E-invoice (IRN) | Generated via the IRP API for eligible invoices |
| E-way bill | Generated for consignments above the threshold |
| GSTR-1 / GSTR-3B | Export from the invoice register |

**The immutability rule is technical, not procedural.** The application's database
role has no `UPDATE` permission on `invoice` money columns. A developer cannot
accidentally edit a legal document, because the database will not allow it.

## 16. Data protection and privacy

| Concern | Approach |
|---|---|
| PII inventory | Email, phone, name, address, GSTIN, PAN, licence details, prescription data |
| Lawful basis | Contractual necessity for business data; consent for marketing |
| Consent capture | Versioned terms and privacy policy, with acceptance recorded per user |
| Purpose limitation | PII is used only for the stated purpose; marketing requires explicit opt-in |
| Data minimisation | Collect only what is needed; prescription images are stored, not mined |
| Retention | Financial records 7 years; PII purged on account closure subject to statutory holds |
| Right of access | User data export (JSON) |
| Right to erasure | Anonymisation where no statutory retention obligation applies |
| Cross-border transfer | Region-pinned storage; no PII transfer outside the designated region without review |
| Breach notification | Documented process with defined timelines |

**Tension to acknowledge explicitly:** the right to erasure conflicts with a 7-year
financial-record retention obligation. The resolution is **anonymisation** — the
person's identifying fields are scrubbed while the financial transaction records are
retained in a form that satisfies the statutory requirement. This must be documented
and approved by legal, not improvised.

## 17. Audit and traceability

Every state change produces an `audit_log` row (append-only, partitioned, 7-year
retention):

```jsonc
{
  "id": "01J8X2...",
  "tenantId": "...",
  "actorId": "user-uuid",
  "actorType": "USER",
  "actorIp": "203.0.113.42",
  "action": "invoice.cancelled",
  "entityType": "invoice",
  "entityId": "inv-uuid",
  "beforeData": { "status": "ISSUED", "grandTotal": "4903.0000" },
  "afterData":  { "status": "CANCELLED", "cancellationReason": "Wrong GSTIN" },
  "changedFields": ["status", "cancellationReason"],
  "correlationId": "01J8X2...",
  "createdAt": "2026-09-11T09:30:00Z"
}
```

Auditable questions the system must answer, and does:

- Who changed this price, when, and from what to what?
- Who approved this credit limit, and who requested it?
- Who verified this prescription, and when?
- Which batch was shipped on this invoice line?
- Who cancelled this invoice, and why?
- Which user accessed this customer's data, and from where?
- What did this order look like before it was modified?

If any of these cannot be answered from the audit log, the audit log is incomplete.

## 18. Business continuity

| Aspect | Target |
|---|---|
| RPO (Recovery Point Objective) | ≤ 5 minutes |
| RTO (Recovery Time Objective) | ≤ 60 minutes |
| Backup verification | Quarterly restore drill on a scratch instance |
| Multi-AZ | Production database and app tier span ≥ 2 availability zones |
| Failover | Automated database failover; tested quarterly |
| Runbooks | DB failover, Redis loss, queue backlog, bad deploy rollback, provider outage |
| On-call | Rotation with escalation policy from phase 4 |

---

## 19. Compliance checklist per release

- [ ] No secrets in code, config or logs.
- [ ] Dependency audit clean (no high/critical).
- [ ] Tenant isolation test suite passing.
- [ ] Money-safety checklist verified for any money-path change.
- [ ] Audit logging present for every new state change.
- [ ] Authorisation enforced at guard **and** query layer.
- [ ] Rate limits configured for any new endpoint.
- [ ] Input validation with class DTOs (no interfaces).
- [ ] No PII in logs.
- [ ] OpenAPI spec updated; no undocumented endpoints.
- [ ] Security headers intact.
- [ ] CORS allow-list unchanged unless deliberately reviewed.
