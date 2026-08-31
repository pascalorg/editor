import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
} from '@pascal-app/core'
import { isLeanToHostOnLevel } from './placement-scope'

describe('lean-to placement scope', () => {
  test('accepts hosts only when their level ancestor is active', () => {
    const ground = LevelNode.parse({ id: 'level_ground', level: 0 })
    const upper = LevelNode.parse({ id: 'level_upper', level: 1 })
    const groundWall = WallNode.parse({
      id: 'wall_ground',
      parentId: ground.id,
      start: [0, 0],
      end: [4, 0],
    })
    const upperWall = WallNode.parse({
      id: 'wall_upper',
      parentId: upper.id,
      start: [0, 0],
      end: [4, 0],
    })
    const upperRoof = RoofNode.parse({ id: 'roof_upper', parentId: upper.id })
    const upperSegment = RoofSegmentNode.parse({
      id: 'rseg_upper',
      parentId: upperRoof.id,
      roofType: 'conical',
    })
    const nodes = Object.fromEntries(
      [ground, upper, groundWall, upperWall, upperRoof, upperSegment].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<AnyNodeId, AnyNode>

    expect(isLeanToHostOnLevel(groundWall, nodes, ground.id)).toBe(true)
    expect(isLeanToHostOnLevel(upperWall, nodes, ground.id)).toBe(false)
    expect(isLeanToHostOnLevel(upperSegment, nodes, ground.id)).toBe(false)
    expect(isLeanToHostOnLevel(upperSegment, nodes, upper.id)).toBe(true)
  })

  test('rejects an orphaned host', () => {
    const wall = WallNode.parse({ id: 'wall_orphan', start: [0, 0], end: [4, 0] })

    expect(isLeanToHostOnLevel(wall, { [wall.id]: wall }, 'level_active')).toBe(false)
  })
})
