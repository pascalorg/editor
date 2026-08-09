import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'

/**
 * What a Route Handler is allowed to import.
 *
 * A Next Route Handler is a Server Component, so React client hooks anywhere in its
 * import graph are a *build failure* rather than dead weight — and the failure is one
 * `bun test` and `bun run check-types` both pass, because both of them happily import
 * React. It surfaces only in `next build`, as fifty-odd copies of the same error with
 * an import trace forty lines long, which is why it sat in the tree unnoticed: the
 * chain ran `chat-ai.ts` → `@pascal-app/nodes/formwork-assembly` → the validation panel
 * → `@pascal-app/editor` → every tool in the editor.
 *
 * `@pascal-app/nodes` publishes narrow `headless` entry points for exactly this, and
 * the mistake is not importing React on purpose — it is reaching a pure function
 * through a barrel that also exports a panel. So this walks the source from each
 * handler and fails on the barrel, naming the entry point to use instead.
 */

const HERE = dirname(import.meta.dir)

/** Barrels that carry a React component, and the narrow entry point to use instead. */
const CLIENT_BARRELS: Record<string, string> = {
  '@pascal-app/nodes/formwork-assembly': '@pascal-app/nodes/formwork-assembly/headless',
  '@pascal-app/nodes/construction-joint': '@pascal-app/nodes/construction-joint/headless',
  '@pascal-app/nodes': 'the kind-specific `/headless` entry point',
  '@pascal-app/editor': 'nothing — the editor is client-only',
  '@pascal-app/viewer': 'nothing — the viewer is client-only',
}

/** Where a specifier resolves in this repo, or null when it leaves it. */
function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(HERE, specifier.slice(2))
    : specifier.startsWith('.')
      ? normalize(join(dirname(from), specifier))
      : null
  if (base === null) return null
  const found = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(
    (path) => existsSync(path) && statSync(path).isFile(),
  )
  // An unresolvable local import would silently shrink the walk, so the check would
  // pass by having looked at less of the graph than it claims to.
  expect(found).toBeDefined()
  return found as string
}

function importsIn(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '')
}

/** Every package the handler reaches, with the file that reached for it. */
function externalsFrom(entry: string): Map<string, string> {
  const externals = new Map<string, string>()
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of importsIn(readFileSync(file, 'utf8'))) {
      const local = resolveLocal(file, specifier)
      if (local === null) {
        if (!externals.has(specifier)) externals.set(specifier, relative(HERE, file))
        continue
      }
      queue.push(local)
    }
  }
  return externals
}

function routeHandlers(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...routeHandlers(path))
    else if (entry.name === 'route.ts' || entry.name === 'route.tsx') out.push(path)
  }
  return out
}

describe('the server-side import graph', () => {
  const handlers = routeHandlers(join(HERE, 'app/api'))

  test('there are handlers to check, so an empty sweep cannot pass', () => {
    expect(handlers.length).toBeGreaterThan(0)
  })

  for (const handler of handlers) {
    test(`${relative(HERE, handler)} reaches no client-only barrel`, () => {
      const externals = externalsFrom(handler)

      const offenders = [...externals]
        .filter(([specifier]) => specifier in CLIENT_BARRELS)
        .map(([specifier, via]) => `${via} imports ${specifier} — use ${CLIENT_BARRELS[specifier]}`)

      expect(offenders).toEqual([])
    })
  }

  test('the chat route still reaches the formwork solve, through the narrow door', () => {
    // Otherwise the check above passes on a route that has simply stopped doing the
    // work — and the formwork tools are the reason the graph is this wide at all.
    const externals = externalsFrom(join(HERE, 'app/api/chat/route.ts'))

    expect([...externals.keys()]).toContain('@pascal-app/nodes/formwork-assembly/headless')
    expect([...externals.keys()]).toContain('@pascal-app/nodes/construction-joint/headless')
  })

  test('the barrels it avoids do carry React, so the rule is not decorative', () => {
    const panel = join(HERE, '../../packages/nodes/src/formwork-assembly/index.ts')
    const joint = join(HERE, '../../packages/nodes/src/construction-joint/index.ts')

    expect(readFileSync(panel, 'utf8')).toContain('validation-panel')
    expect(readFileSync(joint, 'utf8')).toContain('definition')
  })
})
