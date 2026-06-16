import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  AssemblyNode,
  BoxNode,
  LevelNode,
  WallNode,
} from '@pascal-app/core/schema'
import {
  buildGroupSelectedNodesChanges,
  buildUngroupAssemblyChanges,
  getManualAssemblySelectionState,
} from './manual-assembly'

function nodeMap(nodes: AnyNode[]) {
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

describe('manual assembly', () => {
  test('groups same-parent position nodes around a deterministic center', () => {
    const level = LevelNode.parse({ id: 'level_1', level: 0, children: [] })
    const left = BoxNode.parse({ id: 'box_left', parentId: level.id, position: [0, 0, 0] })
    const right = BoxNode.parse({ id: 'box_right', parentId: level.id, position: [2, 0, 0] })
    const nodes = nodeMap([
      { ...level, children: [left.id, right.id] as unknown as typeof level.children },
      left,
      right,
    ])

    const result = buildGroupSelectedNodesChanges(nodes, [left.id, right.id] as AnyNodeId[])

    expect(result?.assemblyId).toMatch(/^assembly_/)
    const assembly = result?.changes.create?.[0]?.node
    expect(assembly?.type).toBe('assembly')
    expect((assembly as ReturnType<typeof AssemblyNode.parse>).position).toEqual([1, 0, 0])
    expect(result?.changes.update).toEqual([
      { id: left.id, data: { position: [-1, 0, 0], parentId: result?.assemblyId } },
      { id: right.id, data: { position: [1, 0, 0], parentId: result?.assemblyId } },
    ])
  })

  test('restores route coordinates when ungrouping', () => {
    const level = LevelNode.parse({ id: 'level_1', level: 0, children: [] })
    const assembly = AssemblyNode.parse({
      id: 'assembly_1',
      parentId: level.id,
      position: [2, 0, 3],
      children: ['wall_1'],
    })
    const wall = WallNode.parse({
      id: 'wall_1',
      parentId: assembly.id,
      start: [-1, -1],
      end: [1, -1],
    })
    const nodes = nodeMap([
      { ...level, children: [assembly.id] as unknown as typeof level.children },
      assembly,
      wall,
    ])

    const result = buildUngroupAssemblyChanges(nodes, assembly.id as AnyNodeId)

    expect(result?.childIds).toEqual([wall.id])
    expect(result?.changes.update).toEqual([
      { id: wall.id, data: { start: [1, 2], end: [3, 2], parentId: level.id } },
    ])
    expect(result?.changes.delete).toEqual([assembly.id])
  })

  test('blocks nested assembly selection instead of creating assembly inside assembly', () => {
    const level = LevelNode.parse({ id: 'level_1', level: 0, children: [] })
    const assembly = AssemblyNode.parse({ id: 'assembly_1', parentId: level.id, children: [] })
    const box = BoxNode.parse({ id: 'box_1', parentId: level.id })
    const nodes = nodeMap([
      { ...level, children: [assembly.id, box.id] as unknown as typeof level.children },
      assembly,
      box,
    ])

    expect(getManualAssemblySelectionState(nodes, [assembly.id, box.id] as AnyNodeId[])).toEqual({
      kind: 'blocked',
      reason: 'nested-assembly',
      selectedIds: [assembly.id, box.id],
    })
  })
})
