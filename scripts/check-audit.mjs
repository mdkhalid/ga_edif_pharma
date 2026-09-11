#!/usr/bin/env node
/**
 * Dependency audit gate.
 *
 * ## Why not just `npm audit --audit-level=high`
 *
 * A blanket threshold gate has two failure modes, and a monorepo hits both:
 *
 *   - A high advisory arrives in a transitive dependency with **no fix
 *     available**. The gate goes red through no fault of the change under
 *     review, so it gets ignored, then disabled.
 *   - The only "fix" npm offers is nonsense. For the `multer` advisories below,
 *     `npm audit` recommends downgrading `@nestjs/core` to **7.5.5** — four
 *     majors back. Following that advice would be far worse than the finding.
 *
 * So the threshold stays high, and exceptions become **explicit, justified and
 * time-boxed** instead of implicit. An allow-list entry that has passed its
 * `reviewBy` date fails the build: an accepted risk that is never re-examined
 * is just an unowned one.
 *
 * Usage:  node scripts/check-audit.mjs
 * Exit:   0 no unaccepted high/critical findings · 1 otherwise
 */

import { spawnSync } from 'node:child_process';

/**
 * High/critical advisories accepted as known and not currently exploitable.
 * Every entry MUST carry a reason and a review date. Remove an entry the moment
 * its fix lands — this list should trend toward empty.
 */
const ACCEPTED = [
  {
    package: 'multer',
    advisory: 'GHSA-wc9g-mqfw-jrwm',
    reason:
      'DoS via crafted multipart field names. Reached only through ' +
      '@nestjs/platform-express, which pins multer to the vulnerable 2.2.0 exactly; ' +
      'patched in 2.3.0. There are no multipart/upload routes in the codebase yet ' +
      '(Phase 0), so the parser is never invoked. Fix lands with the first upload ' +
      'endpoint (prescriptions / KYC documents, Phase 1) by bumping ' +
      '@nestjs/platform-express once it widens its pin, or by vendoring multer.',
    reviewBy: '2027-03-01',
  },
  {
    package: 'multer',
    advisory: 'GHSA-qfvm-cv95-jqjf',
    reason: 'File-descriptor leak on aborted uploads. Same reachability as above: no upload routes exist.',
    reviewBy: '2027-03-01',
  },
  {
    package: 'multer',
    advisory: 'GHSA-535w-7cp7-47q4',
    reason: 'DoS via oversized array index in field names. Same reachability as above: no upload routes exist.',
    reviewBy: '2027-03-01',
  },
];

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

const result = spawnSync('npm', ['audit', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 32 * 1024 * 1024,
});

if (result.error) {
  console.error(`Failed to run npm audit: ${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  // `npm audit` exits non-zero when it finds anything, and writes the report to
  // stdout. A parse failure means something else went wrong (no network, no
  // lockfile), which must not be silently treated as "clean".
  console.error('Could not parse `npm audit --json` output.\n');
  console.error(result.stdout?.slice(0, 2000) ?? '(no stdout)');
  console.error(result.stderr?.slice(0, 2000) ?? '');
  process.exit(1);
}

/** Flatten the audit tree into concrete advisory findings. */
const findings = new Map();
for (const [pkg, entry] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of entry.via ?? []) {
    // A string entry is a pointer to another vulnerable package, not an
    // advisory in its own right. Counting them would report the same finding
    // several times under different names.
    if (typeof via === 'string') continue;
    if (!BLOCKING_SEVERITIES.has(via.severity)) continue;
    if (!findings.has(via.url)) {
      findings.set(via.url, {
        package: pkg,
        severity: via.severity,
        title: via.title,
        url: via.url,
        range: via.range,
        advisory: via.url.split('/').pop(),
      });
    }
  }
}

const today = new Date();
today.setHours(0, 0, 0, 0);

const acceptedNow = [];
const expired = [];
const unaccepted = [];

for (const finding of findings.values()) {
  const match = ACCEPTED.find(
    (a) => a.package === finding.package && a.advisory === finding.advisory,
  );
  if (match === undefined) {
    unaccepted.push(finding);
    continue;
  }
  if (new Date(`${match.reviewBy}T00:00:00Z`) < today) {
    expired.push({ ...finding, reviewBy: match.reviewBy });
  } else {
    acceptedNow.push({ ...finding, reason: match.reason, reviewBy: match.reviewBy });
  }
}

// Entries that no longer match any finding are stale and should be deleted —
// otherwise the list quietly grows and stops describing reality.
const staleEntries = ACCEPTED.filter(
  (a) => ![...findings.values()].some((f) => f.package === a.package && f.advisory === a.advisory),
);

console.log(`Dependency audit — ${findings.size} high/critical advisory(ies) found.\n`);

for (const f of acceptedNow) {
  console.log(`  ACCEPTED  [${f.severity}] ${f.package} — ${f.title}`);
  console.log(`            ${f.advisory} · review by ${f.reviewBy}`);
  console.log(`            ${f.reason}\n`);
}

for (const f of expired) {
  console.error(`  EXPIRED   [${f.severity}] ${f.package} — ${f.title}`);
  console.error(`            ${f.advisory} was accepted until ${f.reviewBy} and has not been re-reviewed.\n`);
}

for (const f of unaccepted) {
  console.error(`  BLOCKING  [${f.severity}] ${f.package} — ${f.title}`);
  console.error(`            ${f.url}`);
  console.error(`            affected: ${f.range}\n`);
}

if (staleEntries.length > 0) {
  console.log('Stale allow-list entries (no longer matching a finding — delete them):');
  for (const a of staleEntries) console.log(`  ${a.package} / ${a.advisory}`);
  console.log('');
}

if (unaccepted.length === 0 && expired.length === 0) {
  console.log('Audit gate passed.');
  process.exit(0);
}

console.error(
  `Audit gate failed: ${unaccepted.length} unaccepted, ${expired.length} expired.\n` +
    'Fix the dependency, or add an entry to ACCEPTED in scripts/check-audit.mjs\n' +
    'with a reason and a review date.\n',
);
process.exit(1);
