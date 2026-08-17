import { describe, expect, test } from 'bun:test'
import { collaborationSnapshot, hashModelSnapshot } from '@pascal-app/core/collaboration'
import { BuildingNode, LevelNode } from '@pascal-app/core/schema'
import { collaborationGraphToReturn } from '@/app/api/scenes/[id]/collaboration/route'
import { apiGraphSchema } from '@/lib/graph-schema'

function graph(name: string) {
  const level = { type: 'level', id: 'l1', parentId: 'b1', children: [], level: 0, name }
  const building = { type: 'building', id: 'b1', parentId: null, children: ['l1'] }
  return { nodes: { b1: building, l1: level }, rootNodeIds: ['b1'] }
}

function signatureOf(g: ReturnType<typeof graph>): string {
  return hashModelSnapshot(
    collaborationSnapshot(g.nodes as never, g.rootNodeIds as never, g as never),
  )
}

describe('collaborationGraphToReturn', () => {
  test('returns the graph when the caller sends no expected signature', () => {
    const g = graph('Ground')
    expect(collaborationGraphToReturn(g, undefined)).toBe(g)
  })

  test('elides the graph when the expected signature matches', () => {
    const g = graph('Ground')
    expect(collaborationGraphToReturn(g, signatureOf(g))).toBeNull()
  })

  test('returns the graph when the content diverged', () => {
    const g = graph('Ground')
    const diverged = graph('Lobby')
    expect(collaborationGraphToReturn(g, signatureOf(diverged))).toBe(g)
  })

  test('matches across a key-order difference, not just identical insertion order', () => {
    const a = graph('Ground')
    const level = {
      name: 'Ground',
      level: 0,
      children: [],
      parentId: 'b1',
      id: 'l1',
      type: 'level',
    }
    const building = { children: ['l1'], id: 'b1', parentId: null, type: 'building' }
    const reordered = { nodes: { l1: level, b1: building }, rootNodeIds: ['b1'] }

    expect(collaborationGraphToReturn(a, signatureOf(reordered))).toBeNull()
  })

  // The elision is only sound if the server's validation pass rewrites nothing
  // a client would already have: `apiGraphSchema` re-parses every node, and if
  // it ever reordered or normalised node content, the signature would silently
  // stop matching and the graph would always come back — the optimisation would
  // be a no-op without a failing test.
  test('a realistic graph survives the API schema with the same model signature', () => {
    const level = LevelNode.parse({
      id: 'level_norm_a',
      parentId: 'building_norm',
      children: [],
      level: 0,
      name: 'Ground',
    })
    const building = BuildingNode.parse({
      id: 'building_norm',
      parentId: null,
      children: ['level_norm_a'],
    })
    const g = {
      nodes: { building_norm: building, level_norm_a: level },
      rootNodeIds: ['building_norm'],
    }

    const validated = apiGraphSchema.parse(g)
    expect(signatureOf(validated as unknown as ReturnType<typeof graph>)).toBe(signatureOf(g))
  })
})
