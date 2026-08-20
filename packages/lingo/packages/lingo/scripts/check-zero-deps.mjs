// Zero-dependency gate (AGENTS.md hard rule 1, wiki/api-design.md checklist item 3).
// Two mechanical checks behind the prose rule:
//   1. package.json declares no `dependencies`.
//   2. No runtime module under src/ imports a bare specifier. Relative imports
//      only — the single exception is the optional `react` peer inside the
//      React adapter entries.
// Test files (*.test.ts) are exempt (they import vitest). TSDoc @example blocks
// are naturally exempt: their lines start with `*`, not `import`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')
const failures = []

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const deps = Object.keys(pkg.dependencies ?? {})
if (deps.length > 0) {
  failures.push(`package.json declares runtime dependencies: ${deps.join(', ')}`)
}

/** Bare specifiers allowed, keyed to where they may appear. */
const ALLOWED = [
  {
    specifier: 'react',
    where: (file) => file.startsWith('react/') || file.startsWith('react-native/'),
  },
]

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      yield* walk(p)
    } else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) {
      yield p
    }
  }
}

// Statement-anchored: `import … from '…'`, `export … from '…'`,
// side-effect `import '…'`, and dynamic `import('…')`.
const IMPORT_RE =
  /^\s*(?:import|export)\b[^'"]*\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|^\s*.*\bimport\s*\(\s*['"]([^'"]+)['"]/

for (const file of walk(SRC)) {
  const rel = relative(SRC, file)
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const m = IMPORT_RE.exec(line)
    if (!m) {
      return
    }
    const spec = m[1] ?? m[2] ?? m[3]
    if (!spec || spec.startsWith('.')) {
      return
    }
    const allowed = ALLOWED.some((a) => a.specifier === spec && a.where(rel))
    if (!allowed) {
      failures.push(`src/${rel}:${i + 1} imports bare specifier '${spec}'`)
    }
  })
}

if (failures.length > 0) {
  console.error('Zero-dependency gate FAILED:')
  for (const f of failures) {
    console.error(`  ✗ ${f}`)
  }
  console.error(
    '\nThe library ships with zero runtime dependencies (AGENTS.md hard rule 1).' +
      '\nIf a new peer is truly required, allowlist it here in the same change' +
      '\nthat documents the decision in wiki/decisions.md.',
  )
  process.exit(1)
}
console.log(
  'Zero-dependency gate ok: no dependencies, src imports are relative-only (react peer allowed in React adapter entries).',
)
