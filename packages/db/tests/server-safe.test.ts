import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `packages/db` runs in API routes, Server Components, the migration step and
 * the MCP process. A React or Three.js import anywhere in it drags a client
 * bundle into all four — the same rule `scene-migrations.ts` lives under.
 */
const FORBIDDEN = ['react', 'react-dom', 'three', 'next/', 'zustand', '@react-three']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

describe('packages/db stays server-safe', () => {
  test('no client-side import anywhere in src', () => {
    const offenders: string[] = []
    const files = sourceFiles(join(import.meta.dir, '..', 'src'))
    expect(files.length).toBeGreaterThan(4)

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1]!
        if (FORBIDDEN.some((bad) => specifier === bad || specifier.startsWith(bad))) {
          offenders.push(`${file}: ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test("no 'use client' directive", () => {
    for (const file of sourceFiles(join(import.meta.dir, '..', 'src'))) {
      expect(readFileSync(file, 'utf8')).not.toContain("'use client'")
    }
  })
})
