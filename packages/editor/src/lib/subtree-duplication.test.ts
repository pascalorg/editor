import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  AssemblyNode,
  BoxNode,
  LevelNode,
} from '@pascal-app/core/schema'
import { buildSubtreeDuplicateCreateOps } from './subtree-duplication'

describe('buildSubtreeDuplicateCreateOps', () => {
  test('deep-copies assembly children with fresh ids and parent links', () => {
    const level = LevelNode.parse({ id: 'level_source', level: 0, children: [] })
    const box = BoxNode.parse({
      id: 'box_child',
      parentId: 'assembly_source',
      length: 1,
      width: 1,
      height: 1,
    })
    const assembly = AssemblyNode.parse({
      id: 'assembly_source',
      parentId: level.id,
      children: [box.id],
      position: [2, 0, 3],
    })
    const nodes = {
      [level.id]: { ...level, children: [assembly.id] },
      [assembly.id]: assembly,
      [box.id]: box,
    } as Record<AnyNodeId, AnyNode>

    const { createOps, idMap, rootId } = buildSubtreeDuplicateCreateOps({
      nodes,
      rootId: assembly.id as AnyNodeId,
    })

    const clonedAssembly = createOps.find((op) => op.node.id === rootId)?.node
    const clonedBoxId = idMap.get(box.id as AnyNodeId)
    if (!clonedBoxId) throw new Error('Expected cloned box id')
    const clonedBox = createOps.find((op) => op.node.id === clonedBoxId)?.node

    expect(rootId).not.toBe(assembly.id)
    expect(clonedBoxId).not.toBe(box.id)
    expect(clonedAssembly?.type).toBe('assembly')
    expect((clonedAssembly as typeof assembly).children).toEqual([clonedBoxId])
    expect(clonedAssembly?.parentId).toBe(level.id)
    expect((clonedAssembly as typeof assembly).position).toEqual([3, 0, 4])
    expect(clonedBox?.type).toBe('box')
    expect(clonedBox?.parentId).toBe(rootId)
  })

  test('uses traversal parent instead of stale child parentId', () => {
    const orphanOwner = AssemblyNode.parse({ id: 'assembly_other', children: [] })
    const sharedBox = BoxNode.parse({
      id: 'box_shared',
      parentId: orphanOwner.id,
    })
    const corruptAssembly = AssemblyNode.parse({
      id: 'assembly_corrupt',
      children: [sharedBox.id],
    })
    const nodes = {
      [orphanOwner.id]: orphanOwner,
      [corruptAssembly.id]: corruptAssembly,
      [sharedBox.id]: sharedBox,
    } as Record<AnyNodeId, AnyNode>

    const { createOps, idMap, rootId } = buildSubtreeDuplicateCreateOps({
      nodes,
      rootId: corruptAssembly.id as AnyNodeId,
    })

    const clonedBox = createOps.find(
      (op) => op.node.id === idMap.get(sharedBox.id as AnyNodeId),
    )?.node

    expect(clonedBox?.parentId).toBe(rootId)
  })
})
