import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, AnyNode as AnyNodeSchema } from '../schema'
import useScene from './use-scene'

function resetScene() {
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
  } as never)
  useScene.temporal.getState().clear()
}

function baseScene(levelChildren: string[]): Record<string, AnyNode> {
  return {
    site_test: {
      object: 'node',
      id: 'site_test',
      type: 'site',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['building_test'],
    },
    building_test: {
      object: 'node',
      id: 'building_test',
      type: 'building',
      parentId: 'site_test',
      visible: true,
      metadata: {},
      children: ['level_test'],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    },
    level_test: {
      object: 'node',
      id: 'level_test',
      type: 'level',
      parentId: 'building_test',
      visible: true,
      metadata: {},
      children: levelChildren,
      level: 0,
      height: 2.5,
    },
  } as unknown as Record<string, AnyNode>
}

describe('retired floor-plan data migration', () => {
  beforeEach(resetScene)

  test('removes drawing-sheet nodes and their parent references', () => {
    const nodes = baseScene([])
    ;(nodes.building_test as { children: string[] }).children.push('drawing-sheet_a101')
    ;(nodes as Record<string, unknown>)['drawing-sheet_a101'] = {
      object: 'node',
      id: 'drawing-sheet_a101',
      type: 'drawing-sheet',
      parentId: 'building_test',
      visible: true,
      metadata: {},
      sheetNumber: 'A1.01',
      sheetTitle: 'Floor Plan',
    }

    useScene.getState().setScene(nodes, ['site_test'] as never)

    const migrated = useScene.getState().nodes
    expect(migrated['drawing-sheet_a101' as keyof typeof migrated]).toBeUndefined()
    expect((migrated.building_test as { children: string[] }).children).toEqual(['level_test'])
    expect(Object.values(migrated).every((node) => AnyNodeSchema.safeParse(node).success)).toBe(
      true,
    )
  })

  test('converts wall assembly width to plain thickness and removes the legacy field', () => {
    const nodes = baseScene(['wall_test'])
    ;(nodes as Record<string, unknown>).wall_test = {
      object: 'node',
      id: 'wall_test',
      type: 'wall',
      parentId: 'level_test',
      visible: true,
      metadata: {},
      children: [],
      start: [0, 0],
      end: [4, 0],
      thickness: 0.1,
      assemblyLayers: [
        { id: 'finish', role: 'interior-finish', side: 'interior', thickness: 0.0125 },
        { id: 'stud', role: 'structure', side: 'core', thickness: 0.1 },
        { id: 'sheathing', role: 'exterior-sheathing', side: 'exterior', thickness: 0.02 },
      ],
    }

    useScene.getState().setScene(nodes, ['site_test'] as never)

    const wall = useScene.getState().nodes.wall_test as AnyNode & Record<string, unknown>
    expect(wall.thickness).toBeCloseTo(0.1325)
    expect(Object.hasOwn(wall, 'assemblyLayers')).toBe(false)
    expect(AnyNodeSchema.safeParse(wall).success).toBe(true)
  })
})
