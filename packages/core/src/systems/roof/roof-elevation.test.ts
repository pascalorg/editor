import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spatialGridManager } from '../../hooks/spatial-grid/spatial-grid-manager'
import { type AnyNode, LevelNode, RoofNode, SlabNode, WallNode } from '../../schema'
import { resolveRoofElevation } from './roof-elevation'

beforeEach(() => spatialGridManager.clear())
afterEach(() => spatialGridManager.clear())

function scene(heights: Array<number | undefined>) {
  const level = LevelNode.parse({ id: 'level_roof_source', height: 2.5, level: 0 })
  const upper = LevelNode.parse({ id: 'level_roof_target', height: 3, level: 1 })
  const walls = heights.map((height, index) =>
    WallNode.parse({
      parentId: level.id,
      start: [0, index],
      end: [4, index],
      height,
    }),
  )
  const roof = RoofNode.parse({
    parentId: upper.id,
    sourceWallIds: walls.map((wall) => wall.id),
    position: [2, 0, 1],
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, upper, roof, ...walls].map((node) => [node.id, node]),
  )
  return { level, upper, walls, roof, nodes }
}

describe('resolveRoofElevation', () => {
  test('honors an explicit height above the storey and converts to the roof level frame', () => {
    const { roof, nodes } = scene([4])
    expect(resolveRoofElevation(roof, nodes)).toBe(1.5)
  })

  test('takes the highest top across mixed explicit and plane-bound walls', () => {
    const { roof, nodes } = scene([3, undefined, 4.5, 2])
    expect(resolveRoofElevation(roof, nodes)).toBe(2)
  })

  test('includes the elected slab base and wall support offset', () => {
    const { level, walls, roof, nodes } = scene([4])
    const slab = SlabNode.parse({
      parentId: level.id,
      elevation: 0.8,
      polygon: [
        [-1, -1],
        [5, -1],
        [5, 2],
        [-1, 2],
      ],
    })
    spatialGridManager.handleNodeCreated(slab, level.id)
    const wall = { ...walls[0]!, supportSlabId: slab.id, supportOffset: 0.2 }
    expect(resolveRoofElevation(roof, { ...nodes, [wall.id]: wall, [slab.id]: slab })).toBe(2.5)
  })

  test('does not lift a plane-bound top when its base rises', () => {
    const { walls, roof, nodes } = scene([undefined])
    const wall = { ...walls[0]!, supportOffset: 0.6 }
    expect(resolveRoofElevation(roof, { ...nodes, [wall.id]: wall })).toBe(0)
  })

  test('follows tops below the roof level plane so short walls leave no gap', () => {
    const { roof, nodes } = scene([2])
    expect(resolveRoofElevation(roof, nodes)).toBe(-0.5)
  })

  test('preserves manual Y without a footprint or after all sources disappear', () => {
    const { roof, nodes } = scene([4])
    expect(resolveRoofElevation({ ...roof, sourceWallIds: undefined }, nodes)).toBe(0)
    expect(resolveRoofElevation({ ...roof, sourceWallIds: ['wall_deleted'] }, nodes)).toBe(0)
    expect(resolveRoofElevation({ ...roof, sourceWallIds: [] }, nodes)).toBe(0)
  })

  test('ignores missing walls while retaining surviving sources', () => {
    const { roof, nodes } = scene([4])
    expect(
      resolveRoofElevation(
        { ...roof, sourceWallIds: ['wall_deleted', ...roof.sourceWallIds!] },
        nodes,
      ),
    ).toBe(1.5)
  })

  test('leaves roof-surface attachments to their own support rule', () => {
    const { roof, nodes } = scene([4])
    const attached = RoofNode.parse({
      ...roof,
      support: { kind: 'roof', roofSegmentId: 'rseg_host', localPosition: [0, 0] },
    })
    expect(resolveRoofElevation(attached, nodes)).toBe(0)
  })
})
