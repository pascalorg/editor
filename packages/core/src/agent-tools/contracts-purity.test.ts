import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

// Tool contracts are imported wherever an agent's tools are declared, including the hosted chat's
// durable workflow, whose sandbox rejects packages that depend on Node modules (nanoid among
// them). So the contracts may import zod, the dependency-free unit parser, and their own
// dependency-free files.
const ALLOWED_PACKAGES = new Set(['zod', '@pascal-app/lingo'])
const ENTRY = resolve(import.meta.dir, 'index.ts')

function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [
    ...source.matchAll(/^(?:import|export)\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]/gm),
  ].map((match) => match[1]!)
}

test('agent tool contracts reach only zod and dependency-free files', () => {
  const seen = new Set<string>()
  const offenders: string[] = []
  const queue = [ENTRY]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of runtimeImports(file)) {
      if (!specifier.startsWith('.')) {
        if (!ALLOWED_PACKAGES.has(specifier))
          offenders.push(`${relative(import.meta.dir, file)} imports ${specifier}`)
        continue
      }
      const base = resolve(dirname(file), specifier)
      const next = [`${base}.ts`, resolve(base, 'index.ts')].find(existsSync)
      if (next) queue.push(next)
    }
  }
  expect(offenders).toEqual([])
  expect(seen.size).toBeGreaterThan(3)
})
