// Detects import specifiers whose path CASE does not match the real file on
// disk. Windows resolves these case-insensitively (so `tsc` passes locally),
// but Linux CI fails with "Cannot find module". This is the most common cause
// of "typecheck green locally, red in CI".
import fs from 'node:fs';
import path from 'node:path';

const roots = [
  process.argv[2] || 'backend/src',
  process.argv[3] || 'backend/test',
];

const importRe =
  /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function caseEquals(a, b) {
  return a === b;
}

function realPathExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveImport(fileDir, spec) {
  if (!spec.startsWith('.')) return null; // only relative imports
  const base = path.resolve(fileDir, spec);
  const candidates = [
    base,
    base + '.ts',
    base + '.js',
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
    base + '.d.ts',
  ];
  for (const c of candidates) {
    if (realPathExists(c)) return c;
  }
  return null;
}

function segmentsOf(p) {
  return p.split(path.sep);
}

function findTsFiles(dir) {
  const out = [];
  if (!realPathExists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTsFiles(full));
    else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.ts'))) out.push(full);
  }
  return out;
}

let problems = 0;
for (const root of roots) {
  for (const file of findTsFiles(root)) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(src))) {
      const spec = m[1] || m[2] || m[3];
      if (!spec || !spec.startsWith('.')) continue;
      const resolved = resolveImport(path.dirname(file), spec);
      if (!resolved) continue; // genuinely missing — tsc would catch on both
      // Compare case segment-by-segment between the spec-derived path and the
      // real path. We compare the spec's tail segments to the resolved file.
      const specPath = path.resolve(path.dirname(file), spec);
      const specSegs = segmentsOf(specPath).filter((s) => s && s !== '.');
      const realSegs = segmentsOf(resolved).filter((s) => s && s !== '.');
      // Walk from the end (file name + last dirs matter most for our purpose)
      const n = Math.min(specSegs.length, realSegs.length);
      for (let i = 1; i <= n; i++) {
        const s = specSegs[specSegs.length - i];
        const r = realSegs[realSegs.length - i];
        if (s !== r && s.toLowerCase() === r.toLowerCase()) {
          problems++;
          console.log(
            `CASE MISMATCH in ${path.relative(process.cwd(), file)}:\n` +
              `  import '${spec}'\n` +
              `  resolves to ${path.relative(process.cwd(), resolved)} (real case differs)`,
          );
          break;
        }
      }
    }
  }
}
console.log(problems === 0 ? 'No case mismatches found.' : `\n${problems} case mismatch(es) found.`);
