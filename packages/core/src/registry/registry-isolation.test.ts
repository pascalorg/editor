import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Bun runs a package's test files in one process, in an order that differs by platform: a file
// that leaves a definition behind (a stub `wall` with a loose schema) changes what a later file
// validates. Every file that writes the registry gives it back (`nodeRegistry._snapshot()`).
const WRITES = /\b(registerNode|registerPlugin|loadPlugin)\(|nodeRegistry\.(register|_reset)\(/

test('every test file that writes the node registry restores it', () => {
  const root = join(import.meta.dir, '..')
  const leaking: string[] = []
  for (const file of new Bun.Glob('**/*.test.{ts,tsx}').scanSync(root)) {
    const source = readFileSync(join(root, file), 'utf8')
    if (WRITES.test(source) && !source.includes('_snapshot()')) leaking.push(file)
  }
  expect(leaking).toEqual([])
})
