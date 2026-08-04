import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { formworkAssembliesAffectedBy } from './dirty-scope'

function scene(...nodes: Array<Record<string, unknown>>): Record<string, AnyNode> {
  const out: Record<string, AnyNode> = {}
  for (const node of nodes) out[node.id as string] = node as unknown as AnyNode
  return out
}

function wall(id: string, parentId: string | null) {
  return { object: 'node', id, type: 'wall', parentId, children: [`formwork-assembly_${id}`] }
}

function formwork(hostId: string) {
  return {
    object: 'node',
    id: `formwork-assembly_${hostId}`,
    type: 'formwork-assembly',
    parentId: hostId,
    children: [],
  }
}

describe('formworkAssembliesAffectedBy', () => {
  test('includes the edited wall and its level siblings', () => {
    const nodes = scene(
      { object: 'node', id: 'level_1', type: 'level', parentId: null, children: [] },
      wall('wall_a', 'level_1'),
      formwork('wall_a'),
      wall('wall_b', 'level_1'),
      formwork('wall_b'),
    )
    expect(formworkAssembliesAffectedBy('wall_a' as AnyNodeId, nodes).sort()).toEqual([
      'formwork-assembly_wall_a',
      'formwork-assembly_wall_b',
    ])
  })

  test('excludes assemblies on other levels — cast order is level-scoped', () => {
    const nodes = scene(
      { object: 'node', id: 'level_1', type: 'level', parentId: null, children: [] },
      { object: 'node', id: 'level_2', type: 'level', parentId: null, children: [] },
      wall('wall_a', 'level_1'),
      formwork('wall_a'),
      wall('wall_far', 'level_2'),
      formwork('wall_far'),
    )
    expect(formworkAssembliesAffectedBy('wall_a' as AnyNodeId, nodes)).toEqual([
      'formwork-assembly_wall_a',
    ])
  })

  test("returns the wall's own assembly even when it has no siblings", () => {
    const nodes = scene(wall('wall_a', 'level_1'), formwork('wall_a'))
    expect(formworkAssembliesAffectedBy('wall_a' as AnyNodeId, nodes)).toEqual([
      'formwork-assembly_wall_a',
    ])
  })

  test("an opening edit dirties its host's assembly — the shutter is cut around it", () => {
    const nodes = scene(
      { object: 'node', id: 'level_1', type: 'level', parentId: null, children: [] },
      wall('wall_a', 'level_1'),
      formwork('wall_a'),
      wall('wall_b', 'level_1'),
      formwork('wall_b'),
      {
        object: 'node',
        id: 'window_1',
        type: 'window',
        parentId: 'wall_a',
        wallId: 'wall_a',
        children: [],
      },
    )
    // Host only: no neighbour's coverage depends on where this window sits.
    expect(formworkAssembliesAffectedBy('window_1' as AnyNodeId, nodes)).toEqual([
      'formwork-assembly_wall_a',
    ])
  })

  test('an opening follows wallId when it differs from parentId', () => {
    const nodes = scene(
      { object: 'node', id: 'level_1', type: 'level', parentId: null, children: [] },
      wall('wall_a', 'level_1'),
      formwork('wall_a'),
      {
        object: 'node',
        id: 'door_1',
        type: 'door',
        parentId: 'level_1',
        wallId: 'wall_a',
        children: [],
      },
    )
    expect(formworkAssembliesAffectedBy('door_1' as AnyNodeId, nodes)).toEqual([
      'formwork-assembly_wall_a',
    ])
  })

  test('an opening on a wall with no formwork affects nothing', () => {
    const nodes = scene(wall('wall_a', 'level_1'), {
      object: 'node',
      id: 'door_1',
      type: 'door',
      parentId: 'wall_a',
      wallId: 'wall_a',
      children: [],
    })
    expect(formworkAssembliesAffectedBy('door_1' as AnyNodeId, nodes)).toEqual([])
  })

  test('unknown wall affects nothing', () => {
    const nodes = scene(wall('wall_a', 'level_1'), formwork('wall_a'))
    expect(formworkAssembliesAffectedBy('wall_missing' as AnyNodeId, nodes)).toEqual([])
  })
})
