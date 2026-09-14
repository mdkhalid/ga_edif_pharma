// k6 load test — the Phase 0 exit criterion, for CI and staging.
//
//   A load test sustains 100 RPS on a login + profile read with p95 < 200 ms.
//
// Run:  k6 run loadtest/k6/auth-baseline.js
// Env:  BASE_URL, IDENTIFIER, PASSWORD, TARGET_RPS, DURATION
//
// ## Two scenarios, deliberately
//
// `profile_read` carries the 100 RPS the criterion names. `login` runs at a low,
// fixed rate because `POST /auth/login` is rate-limited to 10 requests per 60
// seconds per IP+identifier — driving it at 100 RPS measures the rate limiter, not
// the API. Presenting the two separately is the only honest way to state the result.
//
// ## Why the token is fetched in `setup` and shared
//
// Each VU logging in on every iteration would trip the auth rate limit immediately
// and make the whole run a study in 429s. One token per run is enough: the point is
// to exercise the authenticated read path under sustained load.
//
// The dev-only `devCode` response field is never used here; this runs against a
// normal environment.

import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001/api/v1';
const IDENTIFIER = __ENV.IDENTIFIER || 'admin@sunrisepharma.local';
const PASSWORD = __ENV.PASSWORD || '';
const TARGET_RPS = Number(__ENV.TARGET_RPS || 100);
const DURATION = __ENV.DURATION || '10m';

const loginLatency = new Trend('login_latency', true);
const loginFailures = new Rate('login_failures');

export const options = {
  discardResponseBodies: true,
  scenarios: {
    profile_read: {
      executor: 'constant-arrival-rate',
      exec: 'profileRead',
      rate: TARGET_RPS,
      timeUnit: '1s',
      duration: DURATION,
      // Enough pre-allocated VUs to hold the rate without k6 warning about
      // insufficient capacity, which would otherwise silently under-drive it.
      preAllocatedVUs: Math.max(50, Math.ceil(TARGET_RPS / 2)),
      maxVUs: Math.max(200, TARGET_RPS * 2),
      tags: { scenario: 'profile_read' },
    },
    login: {
      executor: 'constant-arrival-rate',
      exec: 'loginOnce',
      // Well inside the 10-per-60-seconds-per-identifier limit.
      rate: 5,
      timeUnit: '1m',
      duration: DURATION,
      preAllocatedVUs: 2,
      maxVUs: 5,
      tags: { scenario: 'login' },
    },
  },
  thresholds: {
    // The exit criterion, asserted on the sustained read path.
    'http_req_duration{scenario:profile_read}': ['p(95)<200'],
    'http_req_failed{scenario:profile_read}': ['rate<0.01'],
    // Login is allowed a longer tail; it hashes a password with argon2id by design.
    'http_req_duration{scenario:login}': ['p(95)<800'],
    'login_failures': ['rate<0.05'],
  },
};

export function setup() {
  if (PASSWORD === '') {
    fail('Set PASSWORD to the seeded admin account password.');
  }

  const response = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD, deviceLabel: 'k6' }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (response.status !== 200) {
    fail(`Sign-in failed with ${response.status}: ${response.body}`);
  }

  const body = response.json();
  return {
    accessToken: body.data.tokens.accessToken,
    expiresAt: body.data.tokens.accessTokenExpiresAt,
  };
}

export function profileRead(data) {
  const response = http.get(`${BASE_URL}/auth/me`, {
    headers: { authorization: `Bearer ${data.accessToken}` },
  });

  check(response, {
    'profile read is 200': (result) => result.status === 200,
  });
}

export function loginOnce() {
  const response = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  loginLatency.add(response.timings.duration);
  const ok = check(response, { 'login is 200': (result) => result.status === 200 });
  loginFailures.add(!ok);
}
