#!/usr/bin/env node
/**
 * Modular-monolith boundary check.
 *
 * MediChain is a modular monolith: each folder under `backend/src/modules/` is a
 * bounded context, and the compiler cannot enforce that. Nothing stops a
 * developer in `iam` from reaching into `audit`'s application services, and once
 * that happens the "module" is a folder name rather than an architectural
 * boundary — which is precisely the coupling that makes an eventual extraction
 * (Phase 4) expensive.
 *
 * The rule this script enforces:
 *
 *   A file may only reach into another module through that module's public
 *   barrel (`modules/<name>/index.ts`). Deep imports into another module's
 *   internals are a violation.
 *
 * Why a script and not an ESLint rule: the accurate version of this rule needs
 * `eslint-plugin-import`'s `no-restricted-paths`, which works on path *zones*.
 * `no-restricted-imports` cannot tell "importing my own infrastructure" apart
 * from "importing another module's", so it produces false positives — see the
 * comment in `backend/.eslintrc.cjs`. This script has the path context the
 * pattern-based rule lacks.
 *
 * Usage:  node scripts/check-module-boundaries.mjs [--root backend/src]
 * Exit:   0 clean · 1 violations found
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const SCAN_ROOT = resolve(rootFlag !== -1 ? argv[rootFlag + 1] : 'backend/src');

/** Posix-normalised path, so the rules read the same on Windows and Linux. */
const toPosix = (p) => p.split(sep).join('/');

/** Recursively collect every `.ts` file under a directory. */
function collectTypeScriptFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...collectTypeScriptFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments so a commented-out import is not reported as a violation.
 * Deliberately conservative: a line comment is only stripped when the `//` is
 * not preceded by `:`, which keeps `https://…` inside string literals intact.
 * A missed comment strip can only cause a false positive, never a false
 * negative, so this errs toward not stripping.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** Extract every module specifier with its 1-based line number. */
function extractSpecifiers(source) {
  const found = [];
  const patterns = [
    // `import … from 'x'`, `export … from 'x'`
    /\bfrom\s*['"]([^'"]+)['"]/g,
    // `import 'x'` (side-effect only)
    /^[ \t]*import\s*['"]([^'"]+)['"]/gm,
    // `await import('x')`
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) {
      found.push({
        specifier: m[1],
        line: source.slice(0, m.index).split('\n').length,
      });
    }
  }
  return found;
}

/**
 * Which module does an absolute path belong to?
 * `…/src/modules/iam/application/x.ts` → `iam`; anything outside → null.
 */
function moduleOf(absPath) {
  const rel = toPosix(relative(SCAN_ROOT, absPath));
  const parts = rel.split('/');
  if (parts[0] !== 'modules' || parts.length < 2) return null;
  return parts[1];
}

/** Normalise a resolved target to a comparable, extension-free posix path. */
function normaliseTarget(absPath) {
  let p = toPosix(absPath);
  for (const ext of ['.ts', '.tsx', '.d.ts', '.js']) {
    if (p.endsWith(ext)) {
      p = p.slice(0, -ext.length);
      break;
    }
  }
  if (p.endsWith('/index')) p = p.slice(0, -'/index'.length);
  return p;
}

const files = collectTypeScriptFiles(SCAN_ROOT);
const violations = [];

for (const file of files) {
  const source = stripComments(readFileSync(file, 'utf8'));
  const importerModule = moduleOf(file);

  for (const { specifier, line } of extractSpecifiers(source)) {
    // Only relative imports can cross an internal boundary. Bare specifiers are
    // external packages or workspace packages (`@medichain/*`).
    if (!specifier.startsWith('.')) continue;

    const resolved = resolve(dirname(file), specifier);
    const targetModule = moduleOf(resolved);

    // Not reaching into the module system at all (common/, config/, infra/, …).
    if (targetModule === null) continue;

    // Same module: internal imports are exactly what a module is allowed to do.
    if (targetModule === importerModule) continue;

    // Cross-module. The only legal target is the module barrel.
    const target = normaliseTarget(resolved);
    const barrel = toPosix(join(SCAN_ROOT, 'modules', targetModule));
    const barrelFile = join(SCAN_ROOT, 'modules', targetModule, 'index.ts');

    if (target !== barrel) {
      violations.push({
        file: toPosix(relative(process.cwd(), file)),
        line,
        specifier,
        importerModule: importerModule ?? '(outside src/modules)',
        targetModule,
        reason: `reaches into "${targetModule}" internals`,
        fix: `import from '${relative(dirname(file), join(SCAN_ROOT, 'modules', targetModule)).split(sep).join('/')}' instead`,
      });
    } else if (!existsSync(barrelFile) || !statSync(barrelFile).isFile()) {
      violations.push({
        file: toPosix(relative(process.cwd(), file)),
        line,
        specifier,
        importerModule: importerModule ?? '(outside src/modules)',
        targetModule,
        reason: `"${targetModule}" has no public barrel`,
        fix: `create src/modules/${targetModule}/index.ts`,
      });
    }
  }
}

if (violations.length === 0) {
  console.log(`Module boundaries OK — ${files.length} files scanned.`);
  process.exit(0);
}

console.error(`\nModule boundary violations: ${violations.length}\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.importerModule} → ${v.targetModule}: ${v.reason}`);
  console.error(`    "${v.specifier}"`);
  console.error(`    fix: ${v.fix}\n`);
}
console.error(
  'A module is a bounded context. Reach it through its barrel, or move the\n' +
    'shared code into src/common (the shared kernel).\n',
);
process.exit(1);
