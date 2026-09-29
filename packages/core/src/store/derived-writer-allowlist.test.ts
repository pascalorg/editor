import { expect, test } from 'bun:test'

// Review guardrail for the writers contract (plans/editor-room-first-structure.md):
// derived construction — a slab or ceiling marked `boundary: 'auto'` or the
// legacy `autoFromWalls: true` — is written by the structure kernel and the
// load migrations, and by nobody else. A new writer anywhere under a package's
// `src` fails here instead of quietly becoming a second construction generator.
//
// The scan looks for the object-literal form; reads (`=== 'auto'`,
// `node.autoFromWalls`) are not writes and never match. Comments are stripped
// first, but a string literal that spells a marker out verbatim still trips the
// guard — prose about the contract belongs in a comment or the wiki.
const ALLOWLIST = new Set([
  // The kernel and its plate builder ARE the generator.
  'packages/core/src/lib/structure-kernel.ts',
  'packages/core/src/lib/floor-plates.ts',
  // Load migrations mint the same construction for scenes saved before it.
  'packages/core/src/utils/room-zone-migration.ts',
  'packages/core/src/utils/floor-plate-migration.ts',
])

const MARKERS = [/\bboundary:\s*'auto'/, /\bautoFromWalls:\s*true/]

/** Comments describe the markers; only code that writes them counts. */
function withoutComments(source: string) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/[^\n]*/g, '')
}

function isFixtureOrTest(path: string) {
  return (
    path.includes('.test.') ||
    path.includes('.bench.') ||
    path.includes('.fixtures.') ||
    path.includes('__fixtures__/') ||
    path.includes('__bench__/') ||
    path.includes('__tests__/')
  )
}

const PACKAGE_SOURCES = 'packages/*/src/**/*.{ts,tsx}'

function repoRoot() {
  return new URL('../../../../', import.meta.url).pathname
}

test('only the structure kernel and the load migrations author derived construction', async () => {
  const root = repoRoot()
  const offenders: string[] = []
  for await (const relative of new Bun.Glob(PACKAGE_SOURCES).scan({ cwd: root, onlyFiles: true })) {
    const path = relative.replaceAll('\\', '/')
    if (isFixtureOrTest(path) || ALLOWLIST.has(path)) continue
    const source = withoutComments(await Bun.file(root + relative).text())
    if (MARKERS.some((marker) => marker.test(source))) offenders.push(path)
  }
  expect(offenders).toEqual([])
})

test('every allowlisted file still authors derived construction', async () => {
  const root = repoRoot()
  for (const path of ALLOWLIST) {
    const source = withoutComments(await Bun.file(root + path).text())
    expect([path, MARKERS.some((marker) => marker.test(source))]).toEqual([path, true])
  }
})
