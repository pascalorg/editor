import { describe, expect, test } from 'bun:test'
import { AssemblyNode, BoxNode, LevelNode } from '@pascal-app/core/schema'
import {
  applyFactoryScenePatchesToGraph,
  buildFactoryScenePatchOperations,
} from './factory-scene-patch-apply'

describe('factory scene patch apply', () => {
  test('preserves patch parent ids when building canvas create operations', () => {
    const child = BoxNode.parse({
      id: 'box_factory_part',
      name: 'Factory part',
      parentId: 'level_fallback',
    })

    const operations = buildFactoryScenePatchOperations(
      [{ op: 'create', parentId: 'assembly_equipment', node: child }],
      { fallbackParentId: 'level_fallback' },
    )

    expect(operations.createOps).toHaveLength(1)
    expect(operations.createOps[0]).toMatchObject({
      parentId: 'assembly_equipment',
      node: { id: 'box_factory_part' },
    })
  })

  test('applies full-run parent relationships to persisted scene graphs', () => {
    const level = LevelNode.parse({ id: 'level_factory' })
    const assembly = AssemblyNode.parse({
      id: 'assembly_preheater',
      name: '预热器塔',
    })
    const shell = BoxNode.parse({
      id: 'box_preheater_shell',
      name: '预热器塔外壳',
      parentId: undefined,
    })

    const graph = applyFactoryScenePatchesToGraph(
      {
        nodes: { [level.id]: level },
        rootNodeIds: [level.id],
      },
      [
        { op: 'create', parentId: level.id, node: assembly },
        { op: 'create', parentId: assembly.id, node: shell },
      ],
    )

    expect(graph.rootNodeIds).toEqual([level.id])
    expect(graph.nodes[level.id]).toMatchObject({
      children: [assembly.id],
    })
    expect(graph.nodes[assembly.id]).toMatchObject({
      parentId: level.id,
      children: [shell.id],
    })
    expect(graph.nodes[shell.id]).toMatchObject({
      parentId: assembly.id,
    })
  })

  test('normalizes nullable material update fields for the scene store', () => {
    const level = LevelNode.parse({ id: 'level_factory' })

    const operations = buildFactoryScenePatchOperations(
      [
        {
          op: 'update',
          id: level.id,
          data: {
            material: null,
            shellMaterialPreset: null,
            name: 'Factory level',
          },
        },
      ],
      { existingNodeIds: [level.id] },
    )

    expect(operations.updateOps).toEqual([
      {
        id: level.id,
          data: {
            material: undefined,
            shellMaterialPreset: undefined,
            name: 'Factory level',
          } as Record<string, unknown>,
        },
      ])
  })

  test('keeps updates that target nodes created earlier in the same run', () => {
    const box = BoxNode.parse({ id: 'box_factory_part' })

    const operations = buildFactoryScenePatchOperations(
      [
        { op: 'create', node: box },
        { op: 'update', id: box.id, data: { name: 'Updated part' } },
      ],
      { existingNodeIds: [] },
    )

    expect(operations.createdIds).toEqual([box.id])
    expect(operations.updateOps).toEqual([
      {
        id: box.id,
        data: { name: 'Updated part' },
      },
    ])
  })
})
