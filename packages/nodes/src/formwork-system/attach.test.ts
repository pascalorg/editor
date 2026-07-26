import { describe, expect, test } from 'bun:test'
import type { WallNode } from '@pascal-app/core'
import { buildFormworkNode } from './attach'

function makeWall(overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id: 'wall_test',
    type: 'wall',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [3, 0],
    thickness: 0.2,
    height: 2.4,
    frontSide: 'unknown',
    backSide: 'unknown',
    ...overrides,
  } as WallNode
}

describe('buildFormworkNode', () => {
  test('stays at identity transform regardless of wall position/heading', () => {
    // WallRenderer nests the formwork node inside the wall's own <mesh>,
    // and WallSystem already sets that mesh's position/rotation to
    // wall.start / wall heading. The formwork node must NOT re-apply
    // that transform itself or it double-rotates/double-translates for
    // any wall that isn't sitting at the origin along +X.
    const offOriginWall = makeWall({ start: [5, -3], end: [2, 4] })
    const node = buildFormworkNode(offOriginWall)
    expect(node.position).toEqual([0, 0, 0])
    expect(node.rotation).toEqual([0, 0, 0])
  })

  test('parents to the host wall', () => {
    const node = buildFormworkNode(makeWall())
    expect(node.parentId).toBe('wall_test')
  })
})
