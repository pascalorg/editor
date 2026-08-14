import { describe, expect, test } from 'bun:test'
import { type AnyNode, LeanToExtensionNode, WallNode, WindowNode } from '@pascal-app/core'
import { leanToPlacementConflicts } from './placement-validation'

describe('lean-to placement validation', () => {
  test('rejects a span crossing a host-wall opening', () => {
    const window = WindowNode.parse({ position: [2, 1, 0], width: 1.2 })
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], children: [window.id] })
    const leanTo = LeanToExtensionNode.parse({ parentId: wall.id, position: [2, 0, 0.05] })
    const nodes = { [wall.id]: wall, [window.id]: window } as Record<string, AnyNode>
    expect(leanToPlacementConflicts(leanTo, wall, nodes)).toHaveLength(1)
  })

  test('rejects an overlapping extension hosted by an adjacent wall', () => {
    const wall = WallNode.parse({ id: 'wall_candidate', start: [0, 0], end: [6, 0] })
    const adjacentWall = WallNode.parse({ id: 'wall_adjacent', start: [0.2, 0.2], end: [6.2, 0.2] })
    const leanTo = LeanToExtensionNode.parse({ parentId: wall.id, position: [3, 0, 0.05] })
    const adjacent = LeanToExtensionNode.parse({
      parentId: adjacentWall.id,
      position: [3, 0, 0.05],
    })
    const nodes = Object.fromEntries(
      [wall, adjacentWall, adjacent].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    expect(leanToPlacementConflicts(leanTo, wall, nodes)).toHaveLength(1)
  })
})
