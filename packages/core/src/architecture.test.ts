import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Layer rule (AGENTS.md): core is pure logic — no Three.js, no rendering.
 * A runtime `three`/`@react-three/*` import in core evaluates R3F (and thus
 * React client context) in every consumer of the barrel, which crashes
 * Next.js route handlers under the RSC server condition (capture uploads
 * 500'd this way once). Type-only imports are erased at build and allowed.
 */
const SRC = resolve(import.meta.dir)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (/\.test\.tsx?$/.test(entry.name)) return []
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const BANNED_SPEC = String.raw`(?:three(?:\/[^'"]*)?|@react-three\/[^'"]*)`
// `import`/`export … from 'three…'` — group 1 captures a whole-clause `type`
// qualifier, the only form guaranteed to be erased by the compiler.
const FROM_RE = new RegExp(
  String.raw`(?:import|export)\s+(type\s)?[\w*{}\s,$]*?from\s*['"]${BANNED_SPEC}['"]`,
  'g',
)
// Bare side-effect form: `import 'three…'` — always a runtime import.
const SIDE_EFFECT_RE = new RegExp(String.raw`import\s*['"]${BANNED_SPEC}['"]`, 'g')

describe('architecture', () => {
  test('core has no runtime three/@react-three imports', () => {
    const files = sourceFiles(SRC)
    const offenders: string[] = []

    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const match of src.matchAll(FROM_RE)) {
        if (!match[1]) offenders.push(`${relative(SRC, file)}: ${match[0].replaceAll('\n', ' ')}`)
      }
      for (const match of src.matchAll(SIDE_EFFECT_RE)) {
        offenders.push(`${relative(SRC, file)}: ${match[0]}`)
      }
    }

    expect(offenders).toEqual([])
    // Guard against the walk passing vacuously.
    expect(files.length).toBeGreaterThan(100)
  })
})
