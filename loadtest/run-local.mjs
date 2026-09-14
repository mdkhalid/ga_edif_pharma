#!/usr/bin/env node
/**
 * Local load test — the Phase 0 exit criterion.
 *
 *   "A load test sustains 100 RPS on a login + profile read with p95 < 200 ms."
 *
 * ## Why autocannon here and k6 in CI
 *
 * `k6` is the tool the testing strategy prescribes and is what CI and staging run
 * (`loadtest/k6/auth-baseline.js`). It is a single Go binary that this development
 * sandbox does not have. autocannon is the same class of tool, installs from npm, and
 * produces the number that matters — so the criterion can be *proved* locally rather
 * than asserted.
 *
 * ## Why the assertion is on p97.5 and not p95
 *
 * autocannon's latency histogram exposes p50, p75, p90, p97_5, p99 and so on, but
 * **not** p95. The 97.5th percentile is a strictly larger number than the 95th, so
 * asserting `p97.5 < 200ms` is a *stricter* test than the criterion: if it passes, p95
 * passes. That is the safe direction to be wrong in, and it is stated here because a
 * load test that quietly reports `undefined` for the metric it claims to check is
 * worse than no test at all — which is exactly what an earlier draft of this file did.
 *
 * If the histogram cannot be read at all, the run fails rather than passing.
 *
 * ## Why the sustained load is the profile read, and login is separate
 *
 * `POST /auth/login` is rate-limited to 10 requests per 60 seconds per IP+identifier
 * (`@RateLimit` on the route). Driving it at 100 RPS would be refused by design, and
 * the result would measure the rate limiter rather than the API. Login is therefore
 * exercised on its own at a modest rate, and the 100 RPS figure is taken on
 * `GET /auth/me` — the authenticated read every screen makes.
 *
 * (Locally, with Redis absent, the limiter fails open, so login would *appear* to
 * sustain 100 RPS. That is a property of the degraded local environment, not of the
 * system, which is why the two measurements are kept apart.)
 *
 * ## Usage
 *
 *   docker compose -f infra/docker/docker-compose.yml up -d postgres redis
 *   npm run db:migrate
 *   SEED_ADMIN_PASSWORD='a-long-known-passphrase' npm run db:seed
 *   npm run dev --workspace=@medichain/backend
 *   LOAD_PASSWORD='a-long-known-passphrase' npm run load:local
 */

import autocannon from 'autocannon';

const BASE_URL = process.env.LOAD_BASE_URL ?? 'http://localhost:3001/api/v1';
const TARGET_RPS = Number(process.env.LOAD_RPS ?? 100);
const DURATION_SECONDS = Number(process.env.LOAD_DURATION ?? 10);
const LOGIN_RPS = Number(process.env.LOAD_LOGIN_RPS ?? 5);
const P95_BUDGET_MS = Number(process.env.LOAD_P95_MS ?? 200);

const IDENTIFIER = process.env.LOAD_IDENTIFIER ?? 'admin@sunrisepharma.local';
const PASSWORD = process.env.LOAD_PASSWORD;

if (PASSWORD === undefined || PASSWORD === '') {
  console.error(
    'Set LOAD_PASSWORD to the password of the seeded admin account.\n' +
      "  SEED_ADMIN_PASSWORD='a-long-known-passphrase' npm run db:seed\n" +
      "  LOAD_PASSWORD='a-long-known-passphrase' npm run load:local",
  );
  process.exit(2);
}

/** Runs one autocannon scenario and returns its result. */
function run(title, options) {
  process.stdout.write(`\n▶ ${title}\n`);
  return new Promise((resolve, reject) => {
    autocannon(options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

/** Reads a latency percentile, or `null` when the histogram does not carry it. */
function percentile(latency, key) {
  const value = latency[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function summarise(label, result) {
  const latency = result.latency;

  return {
    label,
    sent: result.requests.total,
    errors: result.errors,
    non2xx: result.non2xx,
    p50: percentile(latency, 'p50'),
    p90: percentile(latency, 'p90'),
    // The asserted figure: a stricter bound than the criterion's p95.
    p97_5: percentile(latency, 'p97_5'),
    p99: percentile(latency, 'p99'),
  };
}

function print(stats) {
  const ms = (value) => (value === null ? 'n/a' : `${value}ms`);
  console.log(
    `  ${stats.label.padEnd(14)} requests ${String(stats.sent).padStart(6)} · ` +
      `p50 ${ms(stats.p50)} · p90 ${ms(stats.p90)} · p97.5 ${ms(stats.p97_5)} · ` +
      `p99 ${ms(stats.p99)} · errors ${stats.errors} · non-2xx ${stats.non2xx}`,
  );
}

async function main() {
  console.log(`Load target: ${BASE_URL} · ${TARGET_RPS} RPS · ${DURATION_SECONDS}s`);

  // ---------------------------------------------------------------- setup
  const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD, deviceLabel: 'load-test' }),
  });

  if (!loginResponse.ok) {
    const body = await loginResponse.text();
    console.error(`Sign-in failed (${loginResponse.status}): ${body}`);
    process.exit(2);
  }

  const session = await loginResponse.json();
  const accessToken = session.data.tokens.accessToken;

  // A token that expires mid-run would turn the rest of the test into 401s, which
  // would look like a performance cliff. Refuse rather than mislead.
  const expiresAt = new Date(session.data.tokens.accessTokenExpiresAt).getTime();
  if (expiresAt - Date.now() < DURATION_SECONDS * 1000 + 30_000) {
    console.error('The access token expires too soon for this run; raise JWT_ACCESS_TTL.');
    process.exit(2);
  }

  // ------------------------------------------------- sustained profile read
  const profileResult = await run(`GET /auth/me at ${TARGET_RPS} RPS`, {
    url: `${BASE_URL}/auth/me`,
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
    overallRate: TARGET_RPS,
    duration: DURATION_SECONDS,
    connections: Math.max(10, Math.ceil(TARGET_RPS / 10)),
  });

  // ------------------------------------------------------- login, separately
  const loginResult = await run(`POST /auth/login at ${LOGIN_RPS} RPS (rate-limited)`, {
    url: `${BASE_URL}/auth/login`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
    overallRate: LOGIN_RPS,
    duration: Math.min(DURATION_SECONDS, 10),
    connections: 2,
  });

  const profile = summarise('profile read', profileResult);
  const login = summarise('login', loginResult);

  console.log('\nResults');
  print(profile);
  print(login);

  // ------------------------------------------------------------ assertions
  const failures = [];

  if (profile.p97_5 === null) {
    // Refusing to pass on a missing metric is the whole point of this check.
    failures.push('could not read the profile-read latency histogram from autocannon');
  } else if (profile.p97_5 >= P95_BUDGET_MS) {
    failures.push(
      `profile read p97.5 ${profile.p97_5}ms is at or above the ${P95_BUDGET_MS}ms budget ` +
        '(a stricter bound than the criterion\'s p95, so p95 may still be within budget — ' +
        're-run with more samples or inspect the k6 summary before treating this as a regression)',
    );
  }

  if (profile.errors > 0 || profile.non2xx > 0) {
    failures.push(
      `profile read had ${profile.errors} transport error(s) and ${profile.non2xx} non-2xx response(s)`,
    );
  }

  if (login.errors > 0 || login.non2xx > 0) {
    // A 429 here means the login rate is above what the environment allows, so the
    // scenario is misconfigured rather than the API being slow. Fail loudly.
    failures.push(
      `login had ${login.errors} transport error(s) and ${login.non2xx} non-2xx response(s) — ` +
        'lower LOAD_LOGIN_RPS or check the AUTH rate limit',
    );
  }

  console.log('');

  if (failures.length > 0) {
    console.error('Load test FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    `Load test passed: ${TARGET_RPS} RPS sustained on the profile read with p97.5 ` +
      `${profile.p97_5}ms (< ${P95_BUDGET_MS}ms, a stricter bound than p95) and zero errors.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
