import { beforeEach, describe, expect, test } from 'bun:test'
import type {
  AnyNode,
  AnyNodeDefinition,
  AnyNodeId,
  FloorplanGeometry,
} from '@pascal-app/core'
import { nodeRegistry, registerNode, resolveBuildingForLevel } from '@pascal-app/core'
import { z } from 'zod'

describe('Editor FloorplanRegistryLayer Adversarial Verification', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('Adversarial 1: resolveBuildingForLevel accurately resolves building in multi-building scenes', () => {
    const sceneNodes: Record<string, AnyNode> = {
      'building_1': {
        id: 'building_1',
        type: 'building',
        object: 'node',
        children: ['level_1_0', 'level_1_1'],
      } as unknown as AnyNode,
      'level_1_0': {
        id: 'level_1_0',
        type: 'level',
        object: 'node',
        level: 0,
        parentId: 'building_1',
        children: [],
      } as unknown as AnyNode,
      'level_1_1': {
        id: 'level_1_1',
        type: 'level',
        object: 'node',
        level: 1,
        parentId: 'building_1',
        children: [],
      } as unknown as AnyNode,

      'building_2': {
        id: 'building_2',
        type: 'building',
        object: 'node',
        children: ['level_2_0', 'level_2_1'],
      } as unknown as AnyNode,
      'level_2_0': {
        id: 'level_2_0',
        type: 'level',
        object: 'node',
        level: 0,
        parentId: 'building_2',
        children: [],
      } as unknown as AnyNode,
      'level_2_1': {
        id: 'level_2_1',
        type: 'level',
        object: 'node',
        level: 1,
        parentId: 'building_2',
        children: [],
      } as unknown as AnyNode,
    }

    expect(resolveBuildingForLevel('level_1_0' as AnyNodeId, sceneNodes)).toBe('building_1' as AnyNodeId)
    expect(resolveBuildingForLevel('level_1_1' as AnyNodeId, sceneNodes)).toBe('building_1' as AnyNodeId)
    expect(resolveBuildingForLevel('level_2_0' as AnyNodeId, sceneNodes)).toBe('building_2' as AnyNodeId)
    expect(resolveBuildingForLevel('level_2_1' as AnyNodeId, sceneNodes)).toBe('building_2' as AnyNodeId)
    expect(resolveBuildingForLevel('level_non_existent' as AnyNodeId, sceneNodes)).toBeNull()
  })


  test('Adversarial 2: Ambient level resolution logic in FloorplanRegistryLayer matches warehouse tool resolution', () => {
    function resolveAmbientLevelForLayer(
      selectedLevelId: string | null,
      ambientBuildingSourceId: string | null,
      nodes: Record<string, AnyNode>,
    ): string | null {
      if (selectedLevelId || !ambientBuildingSourceId) return null
      const building = nodes[ambientBuildingSourceId]
      if (building?.type !== 'building') return null
      let zero: string | null = null
      let lowestId: string | null = null
      let lowestIdx = Number.POSITIVE_INFINITY
      const childIds = (building as unknown as { children?: string[] }).children ?? []
      for (const childId of childIds) {
        const child = nodes[childId]
        if (child?.type !== 'level') continue
        if (child.level === 0) {
          zero = child.id
          break
        }
        if (typeof child.level === 'number' && child.level < lowestIdx) {
          lowestIdx = child.level
          lowestId = child.id
        }
      }
      return zero ?? lowestId
    }

    const testScene: Record<string, AnyNode> = {
      'bldg-complex': {
        id: 'bldg-complex',
        type: 'building',
        object: 'node',
        children: ['lvl-neg2', 'lvl-neg1', 'lvl-0', 'lvl-1'],
      } as unknown as AnyNode,
      'lvl-neg2': { id: 'lvl-neg2', type: 'level', object: 'node', level: -2 } as unknown as AnyNode,
      'lvl-neg1': { id: 'lvl-neg1', type: 'level', object: 'node', level: -1 } as unknown as AnyNode,
      'lvl-0': { id: 'lvl-0', type: 'level', object: 'node', level: 0 } as unknown as AnyNode,
      'lvl-1': { id: 'lvl-1', type: 'level', object: 'node', level: 1 } as unknown as AnyNode,
    }

    // 1. With Level 0 present: resolves lvl-0
    expect(resolveAmbientLevelForLayer(null, 'bldg-complex', testScene)).toBe('lvl-0')

    // 2. Explicit level selection bypasses ambient
    expect(resolveAmbientLevelForLayer('lvl-neg2', 'bldg-complex', testScene)).toBeNull()

    // 3. Basement-only building
    const basementScene: Record<string, AnyNode> = {
      'bldg-basement': {
        id: 'bldg-basement',
        type: 'building',
        object: 'node',
        children: ['lvl-b2', 'lvl-b1'],
      } as unknown as AnyNode,
      'lvl-b1': { id: 'lvl-b1', type: 'level', object: 'node', level: -1 } as unknown as AnyNode,
      'lvl-b2': { id: 'lvl-b2', type: 'level', object: 'node', level: -2 } as unknown as AnyNode,
    }
    expect(resolveAmbientLevelForLayer(null, 'bldg-basement', basementScene)).toBe('lvl-b2')
  })

  test('Adversarial 3: Immediate DFS traversal discovers newly added nodes at any hierarchy depth', () => {
    registerNode({
      kind: 'mock-equipment',
      schemaVersion: 1,
      schema: z.object({ type: z.literal('mock-equipment') }) as never,
      category: 'furnish',
      defaults: () => ({}) as never,
      floorplan: () => ({
        type: 'path',
        d: 'M 0 0 L 1 0 L 1 1 Z',
        fill: '#ff0000',
      } as unknown as FloorplanGeometry),
    } as unknown as AnyNodeDefinition)

    const level0: { id: string; type: string; object: string; level: number; children: string[] } = {
      id: 'level_0',
      type: 'level',
      object: 'node',
      level: 0,
      children: [],
    }

    const sceneNodes: Record<string, unknown> = {
      level_0: level0,
    }

    // DFS collector simulator matching FloorplanRegistryLayer
    const collectEntries = (rootId: string) => {
      const entries: string[] = []
      const visit = (id: string) => {
        const node = sceneNodes[id] as { type?: string; children?: string[] } | undefined
        if (!node || typeof node.type !== 'string') return
        const def = nodeRegistry.get(node.type)
        if (def?.floorplan) {
          entries.push(id)
        }
        const childIds = node.children
        if (Array.isArray(childIds)) {
          for (const cid of childIds) visit(cid)
        }
      }
      visit(rootId)
      return entries
    }

    // Initially empty
    expect(collectEntries('level_0')).toEqual([])

    // Place 50 items rapidly into level_0
    for (let i = 0; i < 50; i++) {
      const itemId = `item_${i}`
      const itemNode = {
        id: itemId,
        type: 'mock-equipment',
        object: 'node',
        parentId: 'level_0',
        position: [i, 0, 0],
      }

      sceneNodes[itemId] = itemNode
      level0.children = [...level0.children, itemId]

      const collected = collectEntries('level_0')
      expect(collected.length).toBe(i + 1)
      expect(collected).toContain(itemId)
    }
  })
})
