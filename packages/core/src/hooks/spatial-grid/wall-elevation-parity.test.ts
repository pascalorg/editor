import { expect, test } from 'bun:test'
import { SlabNode, WallNode } from '../../schema'
import { SpatialGridManager } from './spatial-grid-manager'

test.each([
  'a',
  'b',
] as const)('wall elevation wrapper matches body support for justification %s', (justification) => {
  const levelId = 'level_wall-elevation-parity'
  const side = justification === 'a' ? 1 : -1
  const wall = WallNode.parse({
    parentId: levelId,
    start: [0, 0],
    end: [4, 0],
    thickness: 0.2,
    justification,
  })
  const slab = SlabNode.parse({
    parentId: levelId,
    elevation: 0.6,
    polygon: [
      [-1, side * 0.15],
      [5, side * 0.15],
      [5, side],
      [-1, side],
    ],
  })
  const manager = new SpatialGridManager()
  manager.handleNodeCreated(wall, levelId)
  manager.handleNodeCreated(slab, levelId)
  const args = [levelId, wall.start, wall.end, 0, wall.thickness, wall.supportSlabId] as const

  expect(manager.getSlabElevationForWall(...args)).toBe(0)
  const support = manager.getSlabSupportForWall(...args, undefined, 0, wall.justification)
  expect(support.elevation).toBe(0.6)
  expect(manager.getSlabElevationForWall(...args, wall.justification)).toBe(support.elevation)
})
