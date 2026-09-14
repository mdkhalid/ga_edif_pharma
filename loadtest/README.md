# Load tests

The Phase 0 exit criterion:

> A load test sustains **100 RPS** on a login + profile read with **p95 < 200 ms**.

| File | Tool | Where it runs |
|---|---|---|
| `run-local.mjs` | [autocannon](https://github.com/mcollina/autocannon) | A developer machine (`npm run load:local`) |
| `k6/auth-baseline.js` | [k6](https://k6.io) | CI and staging (`npm run load:k6`, or the `load-test` workflow) |

`k6` is the tool the testing strategy prescribes. It is a single Go binary that the
development sandbox does not have, so `run-local.mjs` exists to actually *prove* the
number locally rather than assert it; both scripts assert the same threshold.

## What is measured, and what is deliberately not

`GET /auth/me` carries the sustained 100 RPS. `POST /auth/login` is measured
separately at a low rate, because the route is rate-limited to **10 requests per 60
seconds per IP+identifier** — driving it at 100 RPS measures the rate limiter, not
the API.

Locally, with Redis absent, the limiter fails open, so login *appears* to sustain
100 RPS. That is a property of the degraded local environment; on any environment
with Redis the limit applies. Keeping the two measurements apart is what makes the
result meaningful.

## Running locally

```bash
# 1. Infrastructure (Docker Desktop)
docker compose -f infra/docker/docker-compose.yml up -d postgres redis

# 2. Seed a known password so the test can sign in
npm run db:migrate
SEED_ADMIN_PASSWORD='a-long-known-passphrase' npm run db:seed

# 3. Backend
npm run dev --workspace=@medichain/backend

# 4. Load test — exits non-zero if p95 >= 200 ms or any request fails
LOAD_PASSWORD='a-long-known-passphrase' npm run load:local
```

Environment overrides: `LOAD_BASE_URL`, `LOAD_RPS` (default 100), `LOAD_DURATION`
(seconds, default 10), `LOAD_LOGIN_RPS` (default 5), `LOAD_P95_MS` (default 200),
`LOAD_IDENTIFIER`, `LOAD_PASSWORD`.

## Running with k6

```bash
k6 run \
  -e BASE_URL=https://api.staging.medichain.example/api/v1 \
  -e IDENTIFIER=admin@sunrisepharma.local \
  -e PASSWORD="$LOAD_PASSWORD" \
  -e TARGET_RPS=100 \
  -e DURATION=10m \
  loadtest/k6/auth-baseline.js
```

The sustained-load figure the criterion names is 100 RPS for **10 minutes**. The local
runner defaults to a shorter duration because it is a development feedback loop, not
the acceptance run.
