import { expect, test } from 'bun:test'
import { type WallMoveBridgePlan, WallNode } from '@pascal-app/core'
import { buildBridgeWallCreates, type LinkedWallSnapshot } from './move-shared'

test('bridge duplicate detection ignores identical wall segments on other levels', () => {
  const source = WallNode.parse({
    id: 'wall_source',
    parentId: 'level_lower',
    start: [0, 0],
    end: [4, 0],
  })
  const stackedWall = WallNode.parse({
    id: 'wall_stacked',
    parentId: 'level_upper',
    start: [0, 0],
    end: [0, 1],
  })
  const bridgePlans: Array<WallMoveBridgePlan<LinkedWallSnapshot>> = [
    {
      wall: source,
      originalPoint: [0, 0],
      movedEndpoint: 'start',
    },
  ]

  const creates = buildBridgeWallCreates({
    bridgePlans,
    nextStart: [0, 1],
    nextEnd: [4, 1],
    existingWalls: [source, stackedWall],
    wallCount: 2,
  })

  expect(creates).toHaveLength(1)
  expect(creates[0]?.parentId).toBe(source.parentId)
  expect(creates[0]?.node).toMatchObject({ start: [0, 0], end: [0, 1] })
})
