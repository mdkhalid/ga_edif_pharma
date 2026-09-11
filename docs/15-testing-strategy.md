# 15 — Testing Strategy

> **Status:** Approved · **Owner:** Engineering · **Last updated:** 2026-09-11

The test strategy is shaped by one observation: **the expensive bugs in this system
are not logic bugs, they are concurrency, isolation and integration bugs.** A
pricing rule that computes wrong is caught by a unit test. Two concurrent orders
overselling the last unit, or one tenant reading another's data, are not — and they
are far more damaging.

So the pyramid here is deliberately bottom-heavy on **integration and concurrency**
tests, not just unit tests.

---

## 1. Test pyramid

```
                    ┌─────────────────────┐
                    │   Manual / UAT      │   ~10 scenarios per release
                    ├─────────────────────┤
                    │   E2E (Playwright)  │   ~40 critical paths
                    ├─────────────────────┤
                    │ Contract tests      │   OpenAPI conformance
                    ├─────────────────────┤
                    │ Integration tests   │   Repositories, transactions, sagas
                    │ + CONCURRENCY tests │   ← the highest-value tests here
                    ├─────────────────────┤
                    │   Unit tests        │   Domain logic, pure functions
                    └─────────────────────┘
```

| Layer | Count target | Runtime | Runs on |
|---|---|---|---|
| Unit | ~2,000 | < 30 s | Every commit |
| Integration | ~400 | < 5 min | Every PR |
| Concurrency | ~60 | < 3 min | **Every PR (blocking)** |
| Tenant isolation | ~80 | < 2 min | **Every PR (blocking)** |
| Contract | ~120 | < 1 min | Every PR |
| E2E | ~40 | < 15 min | Every PR (against staging) |
| Load | ~10 | < 60 min | Weekly + pre-release |

---

## 2. Coverage targets and what they mean

| Layer | Target | Rationale |
|---|---|---|
| Domain entities / value objects | **≥ 95%** | Pure logic, cheap to test, highest value |
| Application handlers | **≥ 85%** | Orchestration and invariants |
| Repositories | **≥ 70%** | Covered mostly by integration tests |
| Controllers | **≥ 60%** | Thin; covered by E2E |
| Infrastructure adapters | **≥ 60%** | Covered by integration tests |
| **Money paths** | **100% branch** | Non-negotiable |
| **Salt normalisation** | **100% branch** | A regression silently halves search recall |

**Coverage is a floor, not a goal.** 95% coverage of getters and setters is worth
nothing. The number that matters is coverage of **decision points** in the domain and
the money paths.

---

## 3. Unit tests — the domain

```ts
describe('Money', () => {
  it('refuses to add different currencies', () => {
    const inr = Money.of('100.00', 'INR');
    const usd = Money.of('100.00', 'USD');
    expect(() => inr.add(usd)).toThrow(CurrencyMismatchError);
  });

  it('serialises as a string, never a number', () => {
    expect(Money.of('1234.56').toJSON()).toBe('1234.5600');
    expect(typeof Money.of('1234.56').toJSON()).toBe('string');
  });

  it('rounds only at the documented boundary', () => {
    const line = Money.of('0.005');
    expect(line.multiply(3).roundToCurrency().toJSON()).toBe('0.0200');  // HALF_UP
  });
});

describe('CompositionKey', () => {
  it('is order-independent', () => {
    const a = CompositionKey.from([
      { canonicalSalt: 'Paracetamol', strength: '500mg' },
      { canonicalSalt: 'Cetirizine',  strength: '10mg'  },
    ]);
    const b = CompositionKey.from([
      { canonicalSalt: 'Cetirizine',  strength: '10mg'  },
      { canonicalSalt: 'Paracetamol', strength: '500mg' },
    ]);
    expect(a.value).toBe(b.value);
    expect(a.value).toBe('cetirizine-10mg|paracetamol-500mg');
  });

  it('normalises equivalent strengths to the same key', () => {
    const mg = CompositionKey.from([{ canonicalSalt: 'Paracetamol', strength: '500mg' }]);
    const g  = CompositionKey.from([{ canonicalSalt: 'Paracetamol', strength: '0.5g'  }]);
    expect(mg.value).toBe(g.value);
  });

  it('distinguishes different strengths', () => {
    const a = CompositionKey.from([{ canonicalSalt: 'Paracetamol', strength: '500mg' }]);
    const b = CompositionKey.from([{ canonicalSalt: 'Paracetamol', strength: '650mg' }]);
    expect(a.value).not.toBe(b.value);
  });
});

describe('Order state machine', () => {
  it('rejects an illegal transition', () => {
    const order = OrderFixture.placed();
    expect(() => order.transitionTo('DELIVERED', actor))
      .toThrow(InvalidOrderTransitionError);
  });

  it('records every legal transition as an event', () => {
    const order = OrderFixture.placed();
    order.transitionTo('CONFIRMED', actor);
    expect(order.pullEvents()).toContainEqual(
      expect.objectContaining({ type: 'order.status.changed', to: 'CONFIRMED' }),
    );
  });

  it.each(ALL_LEGAL_TRANSITIONS)('allows %s → %s', (from, to) => {
    const order = OrderFixture.inStatus(from);
    expect(() => order.transitionTo(to, actor)).not.toThrow();
  });

  it.each(ALL_ILLEGAL_TRANSITIONS)('rejects %s → %s', (from, to) => {
    const order = OrderFixture.inStatus(from);
    expect(() => order.transitionTo(to, actor)).toThrow(InvalidOrderTransitionError);
  });
});
```

**The exhaustive transition table tests** (`it.each` over every legal and illegal
pair) are worth more than any amount of hand-picked cases. They make the state machine
provably correct rather than anecdotally correct.

---

## 4. Integration tests — real infrastructure

```ts
describe('OrderRepository (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let db: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('test')
      .withUsername('test')
      .withPassword('test')
      .start();
    db = await createDataSource(container.getConnectionUri());
    await runMigrations(db);
  });

  afterAll(async () => { await db.destroy(); await container.stop(); });

  it('locks the row for update', async () => {
    const order = await seedOrder(db);
    await db.transaction(async (tx) => {
      const locked = await repo.lockForUpdate(order.id, tx);
      expect(locked.id).toBe(order.id);
      // A second transaction attempting the same lock must block
      const blocked = db.transaction(async (tx2) =>
        repo.lockForUpdate(order.id, tx2));
      await expect(withTimeout(blocked, 200)).rejects.toThrow(/timeout/);
    });
  });

  it('enforces tenant scoping at the query level', async () => {
    const other = await seedOrder(db, { tenantId: OTHER_TENANT });
    const found = await repo.findById(other.id, tenantCtx(TENANT_A));
    expect(found).toBeNull();          // not "found then rejected" — simply absent
  });
});
```

**Testcontainers, not an in-memory database.** The behaviours we need to test —
`FOR UPDATE` locking, `SKIP LOCKED`, partial indexes, `NUMERIC` precision, `jsonb`
operators, array containment — either do not exist or behave differently in SQLite or
`pg-mem`. A test that passes against a fake database proves nothing about production.

---

## 5. Concurrency tests — the highest-value tests here

These run on **every PR** and are **blocking**. They are the tests that catch
overselling and double-crediting.

### 5.1 No overselling

```ts
it('never oversells the last unit under concurrency', async () => {
  const product = await seedProduct(db, { stock: 1 });
  const N = 200;

  const results = await Promise.allSettled(
    Array.from({ length: N }, (_, i) =>
      placeOrder({ productId: product.id, quantity: '1.0000' },
                 { idempotencyKey: `key-${i}` })),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  expect(succeeded).toBe(1);                       // exactly one

  const batch = await db.query(
    'SELECT qty_on_hand, qty_reserved FROM stock_batch WHERE product_id = $1',
    [product.id],
  );
  expect(Number(batch[0].qty_on_hand)).toBe(1);
  expect(Number(batch[0].qty_reserved)).toBe(1);
  expect(Number(batch[0].qty_on_hand)).toBeGreaterThanOrEqual(Number(batch[0].qty_reserved));
});
```

### 5.2 No credit limit breach

```ts
it('never exceeds the credit limit under concurrency', async () => {
  const account = await seedCreditAccount(db, { limit: '10000.0000', exposure: '0.0000' });
  const N = 100;

  const results = await Promise.allSettled(
    Array.from({ length: N }, (_, i) =>
      placeOrder({ total: '1000.0000' }, { organisationId: account.orgId, key: `k-${i}` })),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  expect(succeeded).toBeLessThanOrEqual(10);       // at most 10 × 1000 = 10000

  const after = await getAccount(db, account.id);
  expect(Number(after.exposure)).toBeLessThanOrEqual(10000);
  expect(Number(after.exposure)).toBe(succeeded * 1000);
});
```

### 5.3 Ledger integrity

```ts
it('credits exactly once when the same webhook is delivered 20 times', async () => {
  const payment = await seedPaymentIntent(db, { amount: '5000.0000' });
  const webhook = buildWebhookPayload(payment, { eventId: 'evt_fixed_123' });

  await Promise.all(
    Array.from({ length: 20 }, () => postWebhook('/payments/webhook/razorpay', webhook)),
  );

  const ledger = await db.query(
    `SELECT * FROM credit_ledger WHERE reference_type='PAYMENT' AND reference_id=$1`,
    [payment.id],
  );
  expect(ledger).toHaveLength(1);                  // exactly one entry
  expect(Number(ledger[0].credit)).toBe(5000);
});
```

### 5.4 Ledger always balances

```ts
it('keeps the derived balance equal to the ledger sum', async () => {
  await runRandomisedWorkload(db, { orders: 500, payments: 300, returns: 80 });

  const { rows } = await db.query(`
    SELECT o.id,
           (SELECT COALESCE(SUM(debit) - SUM(credit), 0)
              FROM credit_ledger WHERE organisation_id = o.id) AS ledger_balance,
           ca.exposure
    FROM organisation o
    JOIN credit_account ca ON ca.organisation_id = o.id
  `);

  for (const row of rows) {
    expect(Number(row.exposure)).toBeCloseTo(Number(row.ledger_balance), 4);
  }
});
```

**This is a property-based test.** It generates a randomised workload of orders,
payments and returns, then asserts an invariant that must hold regardless of the
sequence. It finds ordering bugs that hand-written cases miss.

### 5.5 Stock ledger invariant

```ts
it('keeps Σ(stock_ledger) = qty_on_hand for every batch', async () => {
  await runRandomisedStockWorkload(db, { orders: 300, cancellations: 40, returns: 25 });

  const { rows } = await db.query(`
    SELECT sb.id, sb.qty_on_hand,
           COALESCE((SELECT SUM(quantity) FROM stock_ledger WHERE batch_id = sb.id), 0) AS ledger_sum
    FROM stock_batch sb
  `);

  for (const row of rows) {
    expect(Number(row.ledger_sum)).toBe(Number(row.qty_on_hand));
  }
});
```

### 5.6 Advisory lock — cron runs once

```ts
it('runs a scheduled job exactly once across concurrent replicas', async () => {
  const runs: number[] = [];
  const job = new CreditReconcileScheduler(db, {
    run: async () => { runs.push(Date.now()); await sleep(200); },
  });

  await Promise.all([job.execute(), job.execute(), job.execute(), job.execute()]);
  expect(runs).toHaveLength(1);          // exactly one acquired the advisory lock
});
```

---

## 6. Tenant isolation tests — the other blocking suite

```ts
describe('Tenant isolation', () => {
  const RESOURCES = [
    { name: 'order',       path: (id) => `/api/v1/orders/${id}`,        seed: seedOrder },
    { name: 'invoice',     path: (id) => `/api/v1/invoices/${id}`,      seed: seedInvoice },
    { name: 'product',     path: (id) => `/api/v1/catalog/products/${id}`, seed: seedProduct },
    { name: 'credit',      path: (id) => `/api/v1/credit/${id}`,        seed: seedCredit },
    { name: 'prescription',path: (id) => `/api/v1/prescriptions/${id}`, seed: seedPrescription },
    { name: 'return',      path: (id) => `/api/v1/returns/${id}`,       seed: seedReturn },
  ];

  it.each(RESOURCES)('returns 404 (not 403) reading another tenant\'s $name', async ({ path, seed }) => {
    const resource = await seed(db, { tenantId: TENANT_B });
    const res = await request(app.getHttpServer())
      .get(path(resource.id))
      .set('Authorization', `Bearer ${tokenFor(TENANT_A)}`);

    // 404, never 403 — a 403 confirms the resource exists
    expect(res.status).toBe(404);
  });

  it.each(RESOURCES)('cannot list another tenant\'s $name records', async ({ name }) => {
    await seed(db, { tenantId: TENANT_B });
    const res = await request(app.getHttpServer())
      .get(`/api/v1/${name}s`)
      .set('Authorization', `Bearer ${tokenFor(TENANT_A)}`);

    expect(res.body.data).toHaveLength(0);
  });

  it.each(RESOURCES)('cannot mutate another tenant\'s $name', async ({ path, seed }) => {
    const resource = await seed(db, { tenantId: TENANT_B });
    const res = await request(app.getHttpServer())
      .patch(path(resource.id))
      .set('Authorization', `Bearer ${tokenFor(TENANT_A)}`)
      .send({ status: 'CANCELLED' });

    expect([403, 404]).toContain(res.status);
    expect((await reload(db, resource)).status).not.toBe('CANCELLED');
  });

  it('cannot read another tenant\'s data via filter parameters', async () => {
    const other = await seed(db, { tenantId: TENANT_B });
    const res = await request(app.getHttpServer())
      .get(`/api/v1/orders?organisationId=${other.organisationId}`)
      .set('Authorization', `Bearer ${tokenFor(TENANT_A)}`);

    expect(res.body.data).toHaveLength(0);
  });

  it('rejects a forged tenant claim in the JWT', async () => {
    const forged = signJwt({ tid: TENANT_B, sub: userInTenantA.id }, WRONG_SECRET);
    const res = await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});
```

The parameterised shape matters: adding a new resource to `RESOURCES` automatically
gains full isolation coverage. A resource that is not in the list is a gap someone
will forget.

---

## 7. Contract tests

```ts
describe('OpenAPI contract', () => {
  it('every implemented route appears in the spec', async () => {
    const spec = await loadOpenApiSpec();
    const routes = collectAppRoutes(app);
    for (const route of routes) {
      expect(spec.paths[route.path]?.[route.method]).toBeDefined();
    }
  });

  it('every response matches its declared schema', async () => {
    const spec = await loadOpenApiSpec();
    const res = await request(app.getHttpServer()).get('/api/v1/catalog/products')
      .set('Authorization', `Bearer ${validToken}`);
    const validate = compileValidator(spec, '/api/v1/catalog/products', 'get', '200');
    expect(validate(res.body)).toBe(true);
  });

  it('detects breaking changes against main', async () => {
    const diff = await diffOpenApi(baselineSpec, currentSpec);
    expect(diff.breaking).toHaveLength(0);
  });
});
```

The breaking-change detector runs in CI and **fails the build** unless the PR carries
a version-bump label and an approval.

---

## 8. E2E tests

```ts
test('a distributor completes onboarding and places an order', async ({ page }) => {
  await page.goto('/apply');
  await fillOnboardingWizard(page, { orgType: 'DISTRIBUTOR', ...validLicence });
  await page.click('button:has-text("Submit application")');

  await reviewAsAdmin(page, { approve: true });

  await page.goto('/login');
  await loginAs(page, newDistributor);
  await page.goto('/search');
  await page.fill('[data-testid=salt-search]', 'Paracetamol + Cetirizine');
  await page.waitForSelector('[data-testid=product-card]');

  await page.click('[data-testid=add-to-cart]');
  await page.goto('/checkout');
  await page.click('[data-testid=place-order]');

  await expect(page).toHaveURL(/\/orders\/[a-f0-9-]+/);
  await expect(page.getByTestId('order-status')).toHaveText('PLACED');
});
```

Critical paths covered:

| # | Path |
|---|---|
| 1 | Register → verify → login |
| 2 | Apply → admin approves → buyer can log in |
| 3 | Salt combination search → correct products |
| 4 | Add to cart → checkout → order placed |
| 5 | Order appears in admin → approve → dispatch |
| 6 | Invoice generated → PDF downloadable |
| 7 | Payment recorded → ledger updated → credit available |
| 8 | Credit limit exceeded → order blocked with a clear message |
| 9 | Prescription required → order blocked until verified |
| 10 | Return requested → approved → credit note issued |
| 11 | Schedule H1 item without prescription → blocked |
| 12 | Duplicate submit (double-click) → one order |
| 13 | Session expiry → silent refresh → no logout |
| 14 | Admin changes a price → buyer sees the new price |
| 15 | Admin switches AI provider → no restart required |

---

## 9. Performance tests

| Test | Profile | Pass criteria |
|---|---|---|
| Baseline | 100 RPS, 10 min | p95 < 200 ms, 0 errors |
| Peak | 3× expected, 30 min | p95 < 400 ms, < 0.1% errors |
| Spike | 0 → 10× in 60 s | Autoscale reacts, no errors |
| Soak | Expected peak, 8 h | No leak, stable latency |
| Stress | Ramp to failure | Graceful degradation, no corruption |
| Search | 1,200 RPS on salt search | p95 < 150 ms |
| Order placement | 500 RPS | p95 < 800 ms |

Tooling: k6 for API load, custom scripts for concurrency correctness.

---

## 10. Test data

| Approach | Use |
|---|---|
| Factories / builders | Unit and integration tests |
| Seed scripts | Local development, E2E |
| Faker with a fixed seed | Reproducible randomised data |
| Anonymised production copy | Staging only, PII scrubbed |

```ts
export const OrderFixture = {
  placed: (overrides?: Partial<OrderProps>) =>
    Order.create({
      organisationId: 'org-1',
      tenantId: 'tenant-1',
      lines: [OrderLineFixture.standard()],
      ...overrides,
    }),
  inStatus: (status: OrderStatus) => {
    const order = OrderFixture.placed();
    // walk the legal path to reach the requested status
    for (const s of pathTo(status)) order.transitionTo(s, SYSTEM_ACTOR);
    order.pullEvents();
    return order;
  },
};
```

**Deterministic seeds.** `faker.seed(12345)` means a failing test can be reproduced
exactly. Non-deterministic test data produces flaky tests, and flaky tests get
ignored — which is worse than having no test.

---

## 11. What we do not test

| Not tested | Why |
|---|---|
| Framework internals (NestJS DI, Prisma) | Third-party code, tested by its maintainers |
| Trivial getters/setters | Coverage theatre |
| Generated API client | Generated; the contract test covers the spec |
| Exact log message text | Brittle; assert on structured fields instead |
| Private methods | Test through the public API |
| UI pixel layout | Visual regression only for critical screens |

---

## 12. Quality gates

| Gate | Threshold | Blocking? |
|---|---|---|
| Unit test coverage (domain) | ≥ 95% | Yes |
| Unit test coverage (overall) | ≥ 85% | Yes |
| Integration tests | 100% passing | Yes |
| **Concurrency tests** | **100% passing** | **Yes** |
| **Tenant isolation tests** | **100% passing** | **Yes** |
| Contract tests | 100% passing | Yes |
| E2E critical paths | 100% passing | Yes |
| No breaking OpenAPI changes | 0 | Yes |
| Dependency audit (high/critical) | 0 | Yes |
| Secret scan | 0 findings | Yes |
| Load test at 3× peak | Passing | Pre-release |
| Flaky tests | 0 | Yes |

**Flaky tests are treated as failures.** A test that passes 90% of the time is
disabled or fixed immediately — a flaky suite trains the team to hit "re-run" instead
of investigating, and that is how a real regression gets ignored.
