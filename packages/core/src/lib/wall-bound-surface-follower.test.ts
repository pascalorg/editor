import { expect, test } from 'bun:test'
import { SlabNode, WallNode } from '../schema'
import { createWallBoundSurfaceFollower } from './space-detection'

test('a collinear branch outside a room cannot carry its corner', () => {
  const levelId = 'level_collinear-follower'
  const branch = WallNode.parse({ parentId: levelId, start: [2, 0], end: [4, 0] })
  const walls = [
    branch,
    WallNode.parse({ parentId: levelId, start: [0, 0], end: [2, 0] }),
    WallNode.parse({ parentId: levelId, start: [2, 0], end: [2, 4] }),
    WallNode.parse({ parentId: levelId, start: [2, 4], end: [0, 4] }),
    WallNode.parse({ parentId: levelId, start: [0, 4], end: [0, 0] }),
  ]
  const slab = SlabNode.parse({
    parentId: levelId,
    autoFromWalls: true,
    polygon: [
      [0, 0],
      [2, 0],
      [2, 4],
      [0, 4],
    ],
  })
  const nodes = Object.fromEntries([...walls, slab].map((node) => [node.id, node]))
  const follow = createWallBoundSurfaceFollower(levelId, nodes, new Set([branch.id]))
  const preview = new Map(follow(new Map([[branch.id, { start: [2, -1], end: [4, -1] }]])))
  expect(preview.get(slab.id) ?? slab.polygon).toEqual(slab.polygon)
})
