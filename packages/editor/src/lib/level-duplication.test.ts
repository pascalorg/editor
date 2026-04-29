// @ts-expect-error — bun:test is provided by the Bun runtime; editor does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  WallNode,
} from '@pascal-app/core/schema'
import { buildLevelDuplicateCreateOps } from './level-duplication'

describe('buildLevelDuplicateCreateOps', () => {
  test('parents a duplicated bootstrap level back to its building', () => {
    const level = LevelNode.parse({ level: 0, children: [] })
    const building = BuildingNode.parse({ children: [level.id] })
    const wall = WallNode.parse({
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const sourceLevel = { ...level, children: [wall.id] } satisfies LevelNode
    const nodes = {
      [building.id]: building,
      [sourceLevel.id]: sourceLevel,
      [wall.id]: wall,
    } as Record<AnyNodeId, AnyNode>

    const { createOps, newLevelId } = buildLevelDuplicateCreateOps({
      nodes,
      level: sourceLevel,
      levels: [sourceLevel],
      preset: 'everything',
    })

    const levelCreateOp = createOps.find((op) => op.node.id === newLevelId)

    expect(sourceLevel.parentId).toBeNull()
    expect(levelCreateOp?.parentId).toBe(building.id)
  })
})
