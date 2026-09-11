#!/usr/bin/env node
/**
 * Coverage gate.
 *
 * ## Why this is two gates and not one
 *
 * A single repo-wide coverage percentage is a bad gate in both directions. Set
 * it where the codebase actually is (low, early on) and it passes while whole
 * security-critical files sit at 0%; set it where you want to be and it fails
 * forever, so someone disables it. Neither outcome protects anything.
 *
 * So this enforces two things:
 *
 *   1. CRITICAL FILES — an explicit allow-list of modules where a bug is a
 *      security or correctness incident, each held to a high bar. This is the
 *      real gate. If a new security-critical module is added, add it here.
 *
 *   2. GLOBAL RATCHET — a floor set just below today's measured value across
 *      the whole of `src`. Its job is not to prove the codebase is well tested
 *      (it is not, yet); it is to stop the number going *down* unnoticed.
 *
 * Requires `coverage/coverage-summary.json`, produced by the `json-summary`
 * reporter configured in `jest.config.js`.
 *
 * Usage:  node scripts/check-coverage.mjs [--dir backend]
 * Exit:   0 within budget · 1 below budget
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const dirFlag = argv.indexOf('--dir');
const BACKEND = resolve(dirFlag !== -1 ? argv[dirFlag + 1] : 'backend');
const SUMMARY = join(BACKEND, 'coverage', 'coverage-summary.json');

/**
 * Files where a coverage hole is a security or correctness incident.
 * `min` is the percentage floor for statements AND lines.
 */
const CRITICAL_FILES = [
  {
    path: 'src/database/tenant-scoping.extension.ts',
    min: 90,
    why: 'the tenant isolation rule — a gap here is cross-tenant data exposure',
  },
  {
    path: 'src/common/utils/encryption.service.ts',
    min: 90,
    why: 'AES-256-GCM envelope encryption for stored provider secrets',
  },
  {
    path: 'src/modules/iam/domain/value-objects/password.vo.ts',
    min: 90,
    why: 'password policy and identity-derivation rules',
  },
  {
    path: 'src/common/utils/crypto.util.ts',
    min: 90,
    why: 'hashing, constant-time comparison, deterministic ids',
  },
  {
    path: 'src/common/utils/pagination.util.ts',
    min: 90,
    why: 'cursor encoding and the sort allow-list (injection surface)',
  },
];

/**
 * Repo-wide floors. These are RATCHETS: raise them as coverage improves, never
 * lower them to make a build pass. Values sit ~1pt under the measured baseline
 * at the time of writing so ordinary refactoring does not trip them.
 */
const GLOBAL_FLOORS = { statements: 16, branches: 9, functions: 13, lines: 16 };

if (!existsSync(SUMMARY)) {
  console.error(
    `Coverage summary not found at ${SUMMARY}\n` +
      'Run the unit suite with coverage first:\n' +
      '  npm run test:unit --workspace=@medichain/backend -- --coverage\n',
  );
  process.exit(1);
}

const summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));
const entries = Object.entries(summary).filter(([k]) => k !== 'total');

/** Match a summary key against a repo-relative path, tolerating separators. */
const findEntry = (needle) => {
  const normalisedNeedle = needle.split('\\').join('/');
  return entries.find(([key]) => {
    const k = key.split('\\').join('/');
    return k.endsWith(normalisedNeedle) || k.endsWith('/' + normalisedNeedle);
  });
};

const failures = [];

// ── Gate 1: critical files ────────────────────────────────────────────────
console.log('Critical files\n');
for (const { path, min, why } of CRITICAL_FILES) {
  const hit = findEntry(path);
  if (hit === undefined) {
    // Not a failure by itself: the file may legitimately not be loaded by any
    // unit test. It IS a failure if the file does not exist at all.
    console.log(`  SKIP  ${path}  (not in this coverage run)`);
    continue;
  }
  const [, metrics] = hit;
  const stmts = metrics.statements.pct;
  const lines = metrics.lines.pct;
  const ok = stmts >= min && lines >= min;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${path}  ` +
      `statements ${stmts.toFixed(2)}% · lines ${lines.toFixed(2)}%  (min ${min}%)`,
  );
  if (!ok) {
    failures.push(`${path} is below the ${min}% floor — ${why}`);
  }
}

// ── Gate 2: global ratchet ────────────────────────────────────────────────
console.log('\nGlobal ratchet (whole of src)\n');
const total = summary.total;
for (const [metric, floor] of Object.entries(GLOBAL_FLOORS)) {
  const pct = total[metric].pct;
  const ok = pct >= floor;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${metric.padEnd(11)} ${pct.toFixed(2)}%  (floor ${floor}%)`);
  if (!ok) {
    failures.push(`global ${metric} coverage ${pct.toFixed(2)}% is below the ${floor}% floor`);
  }
}
console.log(
  `\n  Note: the global floor is a ratchet, not a quality claim. ` +
    `${total.statements.pct.toFixed(1)}% of statements are covered overall.`,
);

if (failures.length === 0) {
  console.log('\nCoverage gate passed.');
  process.exit(0);
}

console.error(`\nCoverage gate failed (${failures.length}):\n`);
for (const f of failures) console.error(`  - ${f}`);
console.error('');
process.exit(1);
