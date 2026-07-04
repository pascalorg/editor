import { describe, expect, test } from 'bun:test'
import { registerNode, nodeRegistry } from '@pascal-app/core/registry'
import { BoxNode, ItemNode, LevelNode, ZoneNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import { validateFactoryScenePatches } from './factory-scene-patch-safety'

const registeredSafetyTestKind = 'factory:safety-test'

function ensureSafetyTestNodeRegistered() {
  if (nodeRegistry.has(registeredSafetyTestKind)) return
  registerNode({
    kind: registeredSafetyTestKind,
    schemaVersion: 1,
    schema: z.object({
      object: z.literal('node').default('node'),
      id: z.string(),
      type: z.literal(registeredSafetyTestKind),
      parentId: z.string().nullable().default(null),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
    category: 'furnish',
    defaults: () => ({ object: 'node', parentId: null, metadata: {} }),
    capabilities: {},
  })
}

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

  test('warns but does not reject update patches whose target is missing', () => {
    const box = BoxNode.parse({ id: 'box_1', name: 'Pump skid' })

    const result = validateFactoryScenePatches(
      [
        { op: 'update', id: 'site_generated', data: { name: 'Generated site' } },
        { op: 'create', parentId: 'level_1', node: box },
      ],
      { existingNodeIds: ['level_1'] },
    )

    expect(result.safe).toBe(true)
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'update_missing_target',
        severity: 'warning',
      }),
    ])
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

  test('allows missing generated parents when a known fallback parent is available', () => {
    const box = BoxNode.parse({ id: 'box_1', name: 'Cabinet' })

    const result = validateFactoryScenePatches(
      [{ op: 'create', parentId: 'level_factory', node: box }],
      {
        existingNodeIds: ['level_selected'],
        fallbackParentId: 'level_selected',
      },
    )

    expect(result.safe).toBe(true)
    expect(result.issues).toEqual([])
  })

  test('accepts create patches for registered plugin node schemas', () => {
    ensureSafetyTestNodeRegistered()

    const result = validateFactoryScenePatches(
      [
        {
          op: 'create',
          parentId: 'level_1',
          node: {
            id: 'factory-safety-test_1',
            type: registeredSafetyTestKind,
          },
        },
      ],
      { existingNodeIds: ['level_1'] },
    )

    expect(result.safe).toBe(true)
    expect(result.createCount).toBe(1)
    expect(result.issues).toEqual([])
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
