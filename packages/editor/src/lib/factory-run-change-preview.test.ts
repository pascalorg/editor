import { describe, expect, test } from 'bun:test'
import { AssemblyNode, BoxNode, LevelNode } from '@pascal-app/core/schema'
import { buildFactoryRunChangePreview } from './factory-run-change-preview'

describe('factory run change preview', () => {
  test('summarizes before and after counts for create and update patches', () => {
    const level = LevelNode.parse({ id: 'level_1', name: 'Ground level' })
    const pump = BoxNode.parse({ id: 'box_pump', name: 'Old pump', parentId: level.id })
    const newTank = BoxNode.parse({ id: 'box_tank', name: 'New tank', parentId: level.id })

    const preview = buildFactoryRunChangePreview({
      nodes: {
        [level.id]: level,
        [pump.id]: pump,
      },
      patches: [
        { op: 'create', parentId: level.id, node: newTank },
        { op: 'update', id: pump.id, data: { name: 'Feed pump' } },
      ],
      fallbackParentId: level.id,
    })

    expect(preview.beforeNodeCount).toBe(2)
    expect(preview.afterNodeCount).toBe(3)
    expect(preview.created).toEqual([{ id: newTank.id, label: 'New tank', type: 'box' }])
    expect(preview.updated).toEqual([{ id: pump.id, label: 'Feed pump', type: 'box' }])
    expect(preview.lines).toContain('Before: 2 nodes')
    expect(preview.lines).toContain('After: 3 nodes')
  })

  test('counts owned descendants when previewing deletes', () => {
    const level = LevelNode.parse({ id: 'level_1', children: ['assembly_station'] })
    const assembly = AssemblyNode.parse({
      id: 'assembly_station',
      name: 'Station',
      parentId: level.id,
      children: ['box_child'],
    })
    const child = BoxNode.parse({ id: 'box_child', name: 'Old child', parentId: assembly.id })

    const preview = buildFactoryRunChangePreview({
      nodes: {
        [level.id]: level,
        [assembly.id]: assembly,
        [child.id]: child,
      },
      patches: [{ op: 'delete', id: assembly.id }],
      fallbackParentId: level.id,
    })

    expect(preview.beforeNodeCount).toBe(3)
    expect(preview.afterNodeCount).toBe(1)
    expect(preview.deleted.map((node) => node.id).sort()).toEqual([assembly.id, child.id].sort())
    expect(preview.lines).toContain('Delete: Station, Old child')
  })
})
