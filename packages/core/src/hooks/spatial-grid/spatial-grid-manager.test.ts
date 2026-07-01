import { describe, expect, test } from 'bun:test'
import type { CeilingNode, ItemNode, WallNode } from '../../schema'
import { SpatialGridManager } from './spatial-grid-manager'

function item(
  id: string,
  overrides: Omit<Partial<ItemNode>, 'asset'> & {
    asset?: Partial<ItemNode['asset']>
  } = {},
): ItemNode {
  const { asset: assetOverrides, ...nodeOverrides } = overrides
  return {
    id,
    object: 'node',
    type: 'item',
    parentId: 'level-1',
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    children: [],
    asset: {
      id: `asset-${id}`,
      category: 'test',
      name: id,
      thumbnail: '',
      source: 'library',
      src: '',
      dimensions: [1, 1, 1],
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      ...assetOverrides,
    },
    ...nodeOverrides,
  } as unknown as ItemNode
}

function wall(id: string, start: [number, number], end: [number, number]): WallNode {
  return {
    id,
    object: 'node',
    type: 'wall',
    parentId: 'level-1',
    visible: true,
    metadata: {},
    children: [],
    start,
    end,
    height: 3,
    frontSide: 'unknown',
    backSide: 'unknown',
  } as unknown as WallNode
}

function ceiling(id: string): CeilingNode {
  return {
    id,
    object: 'node',
    type: 'ceiling',
    parentId: 'level-1',
    visible: true,
    metadata: {},
    children: [],
    polygon: [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ],
    holes: [],
    holeMetadata: [],
    height: 3,
    autoFromWalls: false,
  } as unknown as CeilingNode
}

describe('SpatialGridManager placement indices', () => {
  test('floor validation uses grid candidates and ignores low-profile surfaces', () => {
    const manager = new SpatialGridManager()
    manager.handleNodeCreated(
      item('rug', {
        asset: {
          dimensions: [2, 0.05, 2],
          surface: { height: 0.05 },
        },
      }),
      'level-1',
    )

    expect(manager.canPlaceOnFloor('level-1', [0, 0, 0], [1, 1, 1], [0, 0, 0])).toMatchObject({
      valid: true,
      conflictIds: [],
    })

    manager.handleNodeCreated(item('table'), 'level-1')

    expect(manager.canPlaceOnFloor('level-1', [0, 0, 0], [1, 1, 1], [0, 0, 0])).toMatchObject({
      valid: false,
      conflictIds: ['table'],
    })
  })

  test('item updates remove stale floor placement before reindexing to ceiling', () => {
    const manager = new SpatialGridManager()
    const ceilingNode = ceiling('ceiling-1')
    const floorItem = item('light')
    const ceilingItem = item('light', {
      parentId: 'ceiling-1',
      asset: { attachTo: 'ceiling' },
    })

    manager.handleNodeCreated(ceilingNode, 'level-1')
    manager.handleNodeCreated(floorItem, 'level-1')
    expect(manager.canPlaceOnFloor('level-1', [0, 0, 0], [1, 1, 1], [0, 0, 0]).valid).toBe(false)

    manager.handleNodeUpdated(ceilingItem, 'level-1')

    expect(manager.canPlaceOnFloor('level-1', [0, 0, 0], [1, 1, 1], [0, 0, 0])).toMatchObject({
      valid: true,
      conflictIds: [],
    })
    expect(manager.canPlaceOnCeiling('ceiling-1', [0, 0, 0], [1, 1, 1], [0, 0, 0])).toMatchObject({
      valid: false,
      conflictIds: ['light'],
    })
  })

  test('wall supplemental validation is scoped to items indexed on the same wall', () => {
    const manager = new SpatialGridManager()
    manager.handleNodeCreated(wall('wall-1', [0, 0], [4, 0]), 'level-1')
    manager.handleNodeCreated(wall('wall-2', [0, 2], [4, 2]), 'level-1')
    manager.handleNodeCreated(
      item('same-wall', {
        parentId: 'wall-1',
        position: [2, 0, 0],
        asset: { attachTo: 'wall' },
      }),
      'level-1',
    )
    manager.handleNodeCreated(
      item('other-wall', {
        parentId: 'wall-2',
        position: [2, 0, 0],
        asset: { attachTo: 'wall' },
      }),
      'level-1',
    )

    expect(manager.canPlaceOnWall('level-1', 'wall-1', 2, 0, [1, 1, 1], 'wall')).toMatchObject({
      valid: false,
      conflictIds: ['same-wall'],
    })
  })
})
