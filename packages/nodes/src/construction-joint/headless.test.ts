import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import type { WallNode } from '@pascal-app/core'
import { buildSolverJointNodes } from './headless'

/**
 * The narrow door to the joint solver, kept narrow.
 *
 * `buildSolverJointNodes` is pure, but the barrel beside it exports the node
 * definition, and a definition carries the parametric editors — so reaching the pure
 * function through `index.ts` pulls `'use client'` components into the caller. In a
 * Next Route Handler that is a build failure, and one no unit test or type check sees,
 * because both of them import React without complaint. Hence a test about imports.
 *
 * Walked over the source rather than the emitted `dist`, so it fails the moment the
 * import is typed rather than after a build.
 */

/** What the chain behind this entry point may reach. */
const PERMITTED = new Set(['@pascal-app/core/formwork', '@pascal-app/core/schema'])

function importedFrom(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '')
}

function externalsFrom(entry: string): Set<string> {
  const externals = new Set<string>()
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of importedFrom(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) {
        externals.add(specifier)
        continue
      }
      const base = normalize(join(dirname(file), specifier))
      const found = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(
        existsSync,
      )
      // An unresolvable relative import would shrink the walk silently, so the check
      // would pass by having looked at less of the chain than it claims to.
      expect(found).toBeDefined()
      queue.push(found as string)
    }
  }
  return externals
}

function makeWall(overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id: 'wall_test',
    type: 'wall',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [40, 0],
    thickness: 0.3,
    height: 3,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'plywood',
    ...overrides,
  } as WallNode
}

describe('the construction-joint headless entry point', () => {
  test('reaches the engine and the schemas, and nothing that renders', () => {
    const externals = externalsFrom(join(import.meta.dir, 'headless.ts'))

    expect([...externals].filter((name) => !PERMITTED.has(name))).toEqual([])
  })

  test('the barrel does reach a client component, which is why this file exists', () => {
    // Not a complaint about `index.ts` — the inspector editors belong in the
    // definition. The point is that the two entry points genuinely differ, so a
    // reviewer cannot read the distinction as decorative. Asserted on the directive
    // rather than on a `react` specifier, because the editors reach React through
    // core's client barrel and a bundler follows that just as far.
    const externals = externalsFrom(join(import.meta.dir, 'index.ts'))

    expect([...externals].filter((name) => !PERMITTED.has(name))).not.toEqual([])
    expect(readFileSync(join(import.meta.dir, 'inspector-editors.tsx'), 'utf8')).toStartWith(
      "'use client'",
    )
  })

  test('solves the joints a lift split implies, with no DOM present', () => {
    // The claim the entry point makes. `document` is absent under bun test, so a chain
    // that had picked up an editor would throw here rather than answer.
    expect(typeof document).toBe('undefined')

    const joints = buildSolverJointNodes(makeWall({ height: 9, maxLiftHeight: 3 }))

    expect(joints.map((node) => node.elevation)).toEqual([3, 6])
    expect(joints.every((node) => node.type === 'construction-joint')).toBe(true)
  })
})
