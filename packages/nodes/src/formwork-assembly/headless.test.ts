import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { solveProjectFormwork, validateProjectFormwork } from './headless'

/**
 * The narrow entry point, kept narrow.
 *
 * A test about imports rather than about answers, because the thing that breaks here
 * breaks silently: `headless.ts` exists so a server can solve formwork without
 * resolving React, and the day somebody adds `import { FormworkBom } from
 * './parts-summary'` to `solve.ts` the MCP install grows a UI stack and every test
 * still passes. The failure surfaces as a cold-start regression on someone else's
 * machine, months later.
 *
 * Walked over the source rather than the emitted `dist`, so it fails in the editor
 * the moment the import is typed rather than after a build.
 */

/** What the headless chain is allowed to reach outside itself. */
const PERMITTED = new Set([
  '@pascal-app/core/formwork',
  '@pascal-app/core/registry',
  '@pascal-app/core/schema',
  // The part collector reads marks off the meshes the builders emit. The meshes are
  // discarded; the classes need no browser.
  'three',
])

function importedFrom(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '')
}

/** Every module the entry point reaches, and every package it reaches for. */
function reachableFrom(entry: string): { modules: Set<string>; externals: Set<string> } {
  const modules = new Set<string>()
  const externals = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (modules.has(file)) continue
    modules.add(file)
    for (const specifier of importedFrom(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) {
        externals.add(specifier)
        continue
      }
      const base = normalize(join(dirname(file), specifier))
      const found = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(
        existsSync,
      )
      // An unresolvable relative import would silently shrink the walk, so the
      // externals check would pass by having looked at less.
      expect(found).toBeDefined()
      queue.push(found as string)
    }
  }
  return { modules, externals }
}

describe('the headless entry point', () => {
  test('reaches no React, no viewer, no editor — only the engine and three', () => {
    const { externals } = reachableFrom(join(import.meta.dir, 'headless.ts'))

    expect([...externals].filter((name) => !PERMITTED.has(name))).toEqual([])
  })

  test('the barrel does reach them, which is why this file exists', () => {
    // Not a complaint about `index.ts` — the panels belong there. The point is that
    // the two entry points are genuinely different, so a reviewer reading only
    // `headless.ts` cannot conclude the distinction is decorative.
    const { externals } = reachableFrom(join(import.meta.dir, 'index.ts'))

    expect(externals).toContain('react')
    expect([...externals].some((name) => name.startsWith('@pascal-app/viewer'))).toBe(true)
  })

  test('solves and validates a wall with no DOM present', () => {
    // The claim the entry point is making. `document` is absent under bun test, so a
    // chain that had picked up a renderer would throw rather than answer.
    expect(typeof document).toBe('undefined')
    const nodes: Record<string, never> = {}

    expect(solveProjectFormwork(nodes).bom).toEqual([])
    expect(validateProjectFormwork(nodes).report.findings).toEqual([])
  })
})
