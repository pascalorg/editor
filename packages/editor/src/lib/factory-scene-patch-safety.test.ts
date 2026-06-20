import { describe, expect, test } from 'bun:test'
import { BoxNode, ItemNode, LevelNode, ZoneNode } from '@pascal-app/core/schema'
import { validateFactoryScenePatches } from './factory-scene-patch-safety'

describe('factory scene patch safety', () => {
  test('accepts valid create and update patches against known scene ids', () => {
    const level = LevelNode.parse({ id: 'level_1' })
    const zone = ZoneNode.parse({
      id: 'zone_1',
      name: 'Process zone',
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    })

    const result = validateFactoryScenePatches(
      [
        { op: 'create', parentId: level.id, node: zone },
        { op: 'update', id: level.id, data: { name: 'Factory level' } },
      ],
      { existingNodeIds: [level.id] },
    )

    expect(result.safe).toBe(true)
    expect(result.createCount).toBe(1)
    expect(result.deleteCount).toBe(0)
    expect(result.updateCount).toBe(1)
    expect(result.issues).toEqual([])
  })

  test('accepts delete patches against known scene ids', () => {
    const result = validateFactoryScenePatches([{ op: 'delete', id: 'box_1' }], {
      existingNodeIds: ['box_1'],
    })

    expect(result.safe).toBe(true)
    expect(result.createCount).toBe(0)
    expect(result.deleteCount).toBe(1)
    expect(result.updateCount).toBe(0)
    expect(result.issues).toEqual([])
  })

  test('rejects delete patches whose target is missing', () => {
    const result = validateFactoryScenePatches([{ op: 'delete', id: 'box_missing' }], {
      existingNodeIds: ['box_1'],
    })

    expect(result.safe).toBe(false)
    expect(result.issues.map((item) => item.code)).toContain('delete_missing_target')
  })

  test('rejects create patches whose parent is missing', () => {
    const box = BoxNode.parse({ id: 'box_1', name: 'Cabinet' })

    const result = validateFactoryScenePatches(
      [{ op: 'create', parentId: 'level_missing', node: box }],
      {
        existingNodeIds: ['level_1'],
      },
    )

    expect(result.safe).toBe(false)
    expect(result.issues.map((item) => item.code)).toContain('create_missing_parent')
  })

  test('rejects catalog item nodes inside automatic process-line patches', () => {
    const item = ItemNode.parse({
      id: 'item_1',
      asset: {
        id: 'factory-electric-box',
        category: 'equipment',
        name: 'Factory Electric Box',
        src: '/items/factory-electric-box/model.glb',
        thumbnail: '/icons/appliance.webp',
        dimensions: [1, 1, 1],
      },
      metadata: {
        processId: 'water_electrolysis_hydrogen',
      },
    })

    const result = validateFactoryScenePatches([{ op: 'create', node: item }])

    expect(result.safe).toBe(false)
    expect(result.issues.map((item) => item.code)).toContain('process_line_catalog_item')
  })

  test('allows explicitly qualified process-line catalog item nodes when enabled', () => {
    const item = ItemNode.parse({
      id: 'item_1',
      asset: {
        id: 'factory-electric-box',
        category: 'equipment',
        name: 'Factory Electric Box',
        src: '/items/factory-electric-box/model.glb',
        thumbnail: '/icons/appliance.webp',
        dimensions: [1, 1, 1],
      },
      metadata: {
        processId: 'water_electrolysis_hydrogen',
        processCatalogQualified: true,
      },
    })

    const result = validateFactoryScenePatches([{ op: 'create', node: item }], {
      allowProcessLineCatalogItems: true,
    })

    expect(result.safe).toBe(true)
    expect(result.issues).toEqual([])
  })

  test('rejects unqualified process-line catalog item nodes even when catalog items are enabled', () => {
    const item = ItemNode.parse({
      id: 'item_1',
      asset: {
        id: 'factory-electric-box',
        category: 'equipment',
        name: 'Factory Electric Box',
        src: '/items/factory-electric-box/model.glb',
        thumbnail: '/icons/appliance.webp',
        dimensions: [1, 1, 1],
      },
      metadata: {
        processId: 'water_electrolysis_hydrogen',
      },
    })

    const result = validateFactoryScenePatches([{ op: 'create', node: item }], {
      allowProcessLineCatalogItems: true,
    })

    expect(result.safe).toBe(false)
    expect(result.issues.map((item) => item.code)).toContain(
      'process_line_unqualified_catalog_item',
    )
  })

  test('rejects update patches that mutate structural identity fields', () => {
    const result = validateFactoryScenePatches(
      [{ op: 'update', id: 'box_1', data: { type: 'tank', name: 'Bad update' } }],
      { existingNodeIds: ['box_1'] },
    )

    expect(result.safe).toBe(false)
    expect(result.issues.map((item) => item.code)).toContain('update_forbidden_field')
  })
})
