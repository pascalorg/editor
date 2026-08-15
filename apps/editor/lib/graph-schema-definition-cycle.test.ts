import { describe, expect, test } from 'bun:test'
import { apiGraphSchema } from './graph-schema'

const graph = {
  nodes: {
    level_root: {
      object: 'node',
      id: 'level_root',
      type: 'level',
      parentId: null,
      children: ['instance_b'],
      level: 0,
      height: 2.5,
    },
    instance_b: {
      object: 'node',
      id: 'instance_b',
      type: 'instance',
      parentId: 'level_root',
      definitionId: 'definition_b',
    },
    level_b: {
      object: 'node',
      id: 'level_b',
      type: 'level',
      parentId: null,
      children: ['instance_a'],
      level: 0,
      height: 2.5,
    },
    instance_a: {
      object: 'node',
      id: 'instance_a',
      type: 'instance',
      parentId: 'level_b',
      definitionId: 'definition_a',
    },
  },
  rootNodeIds: ['level_root'],
  definitions: {
    definition_a: { id: 'definition_a', name: 'A', rootNodeId: 'level_root' },
    definition_b: { id: 'definition_b', name: 'B', rootNodeId: 'level_b' },
  },
}

describe('apiGraphSchema component definitions', () => {
  test('rejects nested definition cycles', () => {
    const result = apiGraphSchema.safeParse(graph)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(
      result.error.issues.some((issue) => issue.message.includes('must not contain cycles')),
    ).toBe(true)
  })

  test('accepts acyclic nested definitions', () => {
    const result = apiGraphSchema.safeParse({
      ...graph,
      nodes: {
        ...graph.nodes,
        level_b: { ...graph.nodes.level_b, children: [] },
      },
    })
    expect(result.success).toBe(true)
  })
})
