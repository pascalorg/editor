import { describe, expect, test } from 'bun:test'
import {
  AssemblyNode,
  BoxNode,
  BuildingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core/schema'
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

  test('uses fallback parent when generated parent ids are not in the current scene', () => {
    const child = BoxNode.parse({
      id: 'box_factory_part',
      name: 'Factory part',
      parentId: 'level_factory',
    })

    const operations = buildFactoryScenePatchOperations(
      [{ op: 'create', parentId: 'level_factory', node: child }],
      { existingNodeIds: ['level_selected'], fallbackParentId: 'level_selected' },
    )

    expect(operations.createOps).toEqual([
      {
        parentId: 'level_selected',
        node: child,
      },
    ])
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

  test('skips updates whose target is not in the current scene', () => {
    const level = LevelNode.parse({ id: 'level_factory' })
    const box = BoxNode.parse({ id: 'box_factory_part' })

    const operations = buildFactoryScenePatchOperations(
      [
        { op: 'update', id: 'site_generated', data: { name: 'Generated site' } },
        { op: 'create', parentId: level.id, node: box },
      ],
      { existingNodeIds: [level.id] },
    )

    expect(operations.updateOps).toEqual([])
    expect(operations.createOps).toEqual([{ parentId: level.id, node: box }])
  })

  test('applies generated levels and roof children created in the same patch batch', () => {
    const ground = LevelNode.parse({ id: 'level_ground', level: 0 })
    const building = BuildingNode.parse({ id: 'building_main', children: [ground.id] })
    const upper = LevelNode.parse({ id: 'level_upper', level: 1, parentId: building.id })
    const roofSegment = RoofSegmentNode.parse({ id: 'rseg_top', roofType: 'gable' })
    const roof = RoofNode.parse({ id: 'roof_top', children: [roofSegment.id] })

    const graph = applyFactoryScenePatchesToGraph(
      {
        nodes: {
          [building.id]: building,
          [ground.id]: { ...ground, parentId: building.id },
        },
        rootNodeIds: [building.id],
      },
      [
        { op: 'create', parentId: building.id, node: upper },
        { op: 'create', parentId: upper.id, node: roof },
        { op: 'create', parentId: roof.id, node: roofSegment },
      ],
    )

    expect(graph.nodes[building.id]).toMatchObject({
      children: [ground.id, upper.id],
    })
    expect(graph.nodes[upper.id]).toMatchObject({
      parentId: building.id,
      children: [roof.id],
    })
    expect(graph.nodes[roof.id]).toMatchObject({
      parentId: upper.id,
      children: [roofSegment.id],
    })
    expect(graph.nodes[roofSegment.id]).toMatchObject({
      parentId: roof.id,
    })
  })
})
