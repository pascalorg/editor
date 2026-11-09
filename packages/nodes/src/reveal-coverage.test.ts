import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, nodeRegistry, registerNode } from '@pascal-app/core'
import { commitRevealCandidates } from '@pascal-app/viewer'
import { builtinPlugin } from './index'

// What an agent builds appears as a construction, not a pop (the construction reveal). A kind either
// declares its reveal or comes in with the default one; the kinds below draw nothing of their own
// (data, containers, annotations, a hole cut in a slab), so there is nothing to move in.
const DRAWS_NOTHING_OF_ITS_OWN = new Set([
  'site',
  'building',
  'level',
  'unit',
  'floor-opening',
  'structural-grid',
  'construction-dimension',
  'measurement',
])

let restore: () => void = () => {}
beforeAll(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  for (const definition of builtinPlugin.nodes ?? []) registerNode(definition)
})
afterAll(() => restore())

const nodes = {
  building: { id: 'building', type: 'building', parentId: null },
  level: { id: 'level', type: 'level', level: 0, parentId: 'building' },
  roof: { id: 'roof', type: 'roof', parentId: 'level' },
} as unknown as Record<AnyNodeId, AnyNode>

/** What a commit that adds one node of `type` stages at `at`, standing on `parentId`. */
function staged(type: string, at: 'full' | 'framing', parentId: string) {
  const added = { id: 'added', type, parentId } as unknown as AnyNode
  return commitRevealCandidates(
    {
      before: { nodes },
      current: { nodes: { ...nodes, added } },
      author: 'agent',
    } as never,
    at,
  )
}

describe('every built-in kind an agent can create', () => {
  const kinds = (builtinPlugin.nodes ?? []).map((definition) => definition.kind)

  test.each(kinds.filter((kind) => !DRAWS_NOTHING_OF_ITS_OWN.has(kind)))(
    '%s is staged, on a level and on a roof, at the full and the framing levels',
    (kind) => {
      for (const at of ['full', 'framing'] as const) {
        for (const parentId of ['level', 'roof']) {
          const [candidate] = staged(kind, at, parentId)
          expect(candidate?.id).toBe('added')
        }
      }
    },
  )

  test.each([...DRAWS_NOTHING_OF_ITS_OWN])(
    '%s stages nothing: it draws nothing of its own',
    (kind) => {
      expect(staged(kind, 'full', 'level')).toEqual([])
    },
  )

  test('the exemptions are kinds that exist', () => {
    for (const kind of DRAWS_NOTHING_OF_ITS_OWN) expect(kinds).toContain(kind)
  })
})

describe('the fields an edit replays a node for', () => {
  const withEdits = (builtinPlugin.nodes ?? []).filter(
    (definition) => definition.capabilities?.revealOnEdit,
  )

  test('the kinds an agent edits most are listed', () => {
    const kinds = withEdits.map((definition) => definition.kind)
    for (const kind of ['wall', 'slab', 'ceiling', 'roof-segment', 'stair', 'door', 'window'])
      expect(kinds).toContain(kind)
  })

  test('a roof segment replays for the barrel arch and the glazing it can be given', () => {
    const roofSegment = withEdits.find((definition) => definition.kind === 'roof-segment')
    expect(roofSegment?.capabilities?.revealOnEdit).toEqual(
      expect.arrayContaining(['barrelRise', 'barrelSegments', 'roofSystem', 'glazing']),
    )
  })

  test.each(withEdits.map((definition) => [definition.kind, definition] as const))(
    '%s lists only fields its schema has',
    (_kind, definition) => {
      const shape = (definition.schema as unknown as { shape: Record<string, unknown> }).shape
      for (const field of definition.capabilities?.revealOnEdit ?? [])
        expect(shape).toHaveProperty(field)
    },
  )
})
