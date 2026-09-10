import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spatialGridManager } from '../../hooks/spatial-grid/spatial-grid-manager'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  WallNode,
} from '../../schema'
import { planWallSplitAtPoint } from '../wall/wall-topology'
import { resolveRoofElevation } from './roof-elevation'

beforeEach(() => spatialGridManager.clear())
afterEach(() => spatialGridManager.clear())

function room(level: LevelNode, heights: Array<number | undefined>, offsetX = 0) {
  const polygon: Array<[number, number]> = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  return polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!
    return WallNode.parse({
      parentId: level.id,
      start: [point[0] + offsetX, point[1]],
      end: [next[0] + offsetX, next[1]],
      height: heights[index % heights.length],
    })
  })
}

function scene(heights: Array<number | undefined>) {
  const level = LevelNode.parse({ height: 3, level: 0 })
  const upper = LevelNode.parse({ height: 3, level: 1 })
  const walls = room(level, heights)
  const roof = RoofNode.parse({
    parentId: upper.id,
    support: { kind: 'walls' },
    position: [2, 0, 1],
  })
  level.children = walls.map((wall) => wall.id)
  upper.children = [roof.id]
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, upper, roof, ...walls].map((node) => [node.id, node]),
  )
  return { level, upper, walls, roof, nodes }
}

describe('resolveRoofElevation', () => {
  test("follows walls on the roof's own level when it sits on the top floor", () => {
    const { roof, level, upper, nodes } = scene([2.5])
    // Move the roof onto the walls' level: no storey above, roof and walls share it.
    delete nodes[upper.id]
    roof.parentId = level.id
    level.children = [...level.children, roof.id]
    roof.position = [2, 2.5, 1]
    expect(resolveRoofElevation(roof, nodes)).toBe(2.5)
  })

  test('follows the walls under the segment footprint when the room is not closed', () => {
    const { roof, walls, nodes, level } = scene([4.5])
    // Drop the east wall: point-in-room finds no enclosure, the footprint still does.
    const east = walls[1]!
    delete nodes[east.id]
    level.children = level.children.filter((id) => id !== east.id)
    const segment = RoofSegmentNode.parse({
      parentId: roof.id,
      roofType: 'gable',
      width: 4,
      depth: 3,
      position: [0, 0, 0],
    })
    roof.children = [segment.id]
    nodes[segment.id] = segment
    expect(resolveRoofElevation(roof, nodes)).toBe(1.5)
  })

  test('honors an explicit height above the storey in the roof level frame', () => {
    const { roof, nodes } = scene([4.5])
    expect(resolveRoofElevation(roof, nodes)).toBe(1.5)
  })

  test('takes the highest top across mixed explicit and plane-bound walls', () => {
    const { roof, nodes } = scene([3, undefined, 5, 2])
    expect(resolveRoofElevation(roof, nodes)).toBe(2)
  })

  test('includes the elected slab base and wall support offset', () => {
    const { level, walls, roof, nodes } = scene([4.5])
    const slab = SlabNode.parse({
      parentId: level.id,
      elevation: 0.8,
      polygon: [
        [-1, -1],
        [5, -1],
        [5, 4],
        [-1, 4],
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

  test('2.5 m walls under a 3 m storey pull the roof down to -0.5 m', () => {
    const { roof, nodes } = scene([2.5])
    expect(resolveRoofElevation(roof, nodes)).toBe(-0.5)
  })

  test('freezes without an enclosure, retaining follow intent', () => {
    const { walls, roof, nodes } = scene([4])
    const remaining = { ...nodes }
    delete remaining[walls[0]!.id]
    expect(resolveRoofElevation(roof, remaining)).toBe(0)
    for (const wall of walls) delete remaining[wall.id]
    expect(resolveRoofElevation(roof, remaining)).toBe(0)
    expect(roof.support).toEqual({ kind: 'walls' })
    expect(resolveRoofElevation(roof, nodes)).toBe(1)
  })

  test('level roofs and roof-surface attachments keep their Y', () => {
    const { roof, nodes } = scene([4])
    expect(resolveRoofElevation({ ...roof, support: { kind: 'level' } }, nodes)).toBe(0)
    const attached = RoofNode.parse({
      ...roof,
      support: { kind: 'roof', roofSegmentId: 'rseg_host', localPosition: [0, 0] },
    })
    expect(resolveRoofElevation(attached, nodes)).toBe(0)
  })

  test('re-resolves replacement wall pieces after a topology split', () => {
    const { level, walls, roof, nodes } = scene([4])
    const split = planWallSplitAtPoint(nodes, { levelId: level.id, point: [2, 0], radius: 0.05 })
    expect(split.ok).toBe(true)
    if (!split.ok) throw new Error(split.reason)
    const { create, delete: deleted } = split.plan.changes
    expect(create).toHaveLength(2)
    const next = { ...nodes }
    for (const id of deleted) delete next[id]
    for (const { node } of create) next[node.id] = { ...node, height: 5 } as WallNode
    next[level.id] = {
      ...level,
      children: [
        ...walls.filter((wall) => !deleted.includes(wall.id)).map((wall) => wall.id),
        ...create.map(({ node }) => node.id),
      ],
    }
    expect(resolveRoofElevation(roof, next)).toBe(2)
  })

  test('chooses the smallest enclosure containing the roof centre', () => {
    const { level, roof, nodes } = scene([5])
    const innerPolygon: Array<[number, number]> = [
      [1, 0.5],
      [3, 0.5],
      [3, 2.5],
      [1, 2.5],
    ]
    const innerWalls = innerPolygon.map((start, index) =>
      WallNode.parse({
        parentId: level.id,
        start,
        end: innerPolygon[(index + 1) % innerPolygon.length],
        height: 2.5,
      }),
    )
    const next = {
      ...nodes,
      ...Object.fromEntries(innerWalls.map((wall) => [wall.id, wall])),
      [level.id]: { ...level, children: [...level.children, ...innerWalls.map((wall) => wall.id)] },
    }
    expect(resolveRoofElevation(roof, next)).toBe(-0.5)
  })

  test('moving XZ chooses the enclosure at the new centre', () => {
    const { level, roof, nodes } = scene([4])
    const secondWalls = room(level, [5], 10)
    const next = {
      ...nodes,
      ...Object.fromEntries(secondWalls.map((wall) => [wall.id, wall])),
      [level.id]: {
        ...level,
        children: [...level.children, ...secondWalls.map((wall) => wall.id)],
      },
    }
    expect(resolveRoofElevation(roof, next)).toBe(1)
    expect(resolveRoofElevation({ ...roof, position: [12, 1, 1] }, next)).toBe(2)
    expect(resolveRoofElevation({ ...roof, position: [20, 7, 1] }, next)).toBe(7)
  })

  test('uses the lower neighbour in the same building across ordinal gaps and offsets', () => {
    const { level, upper, roof, nodes } = scene([4.5])
    const building = BuildingNode.parse({ children: [level.id, upper.id] })
    const otherBuilding = BuildingNode.parse({})
    const unrelated = LevelNode.parse({ parentId: otherBuilding.id, level: 8, height: 100 })
    const next = {
      ...nodes,
      [building.id]: building,
      [otherBuilding.id]: otherBuilding,
      [unrelated.id]: unrelated,
      [level.id]: { ...level, parentId: building.id, level: -2, baseElevation: 2 },
      [upper.id]: { ...upper, parentId: building.id, level: 10, baseElevation: 0.5 },
    }
    expect(resolveRoofElevation(roof, next)).toBe(1)
  })

  test('looks at its own level and the one below, never two floors down', () => {
    const { level, upper, roof, nodes } = scene([4])
    const middle = LevelNode.parse({ level: 0.5, height: 2 })
    // A wall-less storey slipped between roof and walls: the walls are now two
    // floors down and the roof freezes where it is.
    expect(resolveRoofElevation(roof, { ...nodes, [middle.id]: middle })).toBe(0)
    // Walls on the roof's own level count (top floor without a storey above).
    const onParent = room(upper, [20])
    const next = {
      ...nodes,
      [upper.id]: { ...upper, children: [...upper.children, ...onParent.map((wall) => wall.id)] },
      ...Object.fromEntries(onParent.map((wall) => [wall.id, wall])),
    }
    expect(resolveRoofElevation(roof, next)).toBe(20)
    expect(resolveRoofElevation({ ...roof, parentId: level.id }, nodes)).toBe(4)
  })

  test('matches a conical arc by centre and radius after replacement, without an enclosure', () => {
    const { level, roof, nodes } = scene([4])
    const segment = RoofSegmentNode.parse({
      parentId: roof.id,
      roofType: 'conical',
      width: 4,
      depth: 4,
      conicalFullCircle: true,
    })
    const curved = WallNode.parse({
      parentId: level.id,
      start: [-2, 0],
      end: [2, 0],
      curveOffset: 2,
      height: 2.5,
    })
    const cone = {
      ...roof,
      children: [segment.id],
      position: [0, 0, 0] as [number, number, number],
    }
    const next = {
      ...nodes,
      [level.id]: { ...level, children: [curved.id] },
      [curved.id]: curved,
      [segment.id]: segment,
    }
    expect(resolveRoofElevation(cone, next)).toBe(-0.5)
    const replacement = WallNode.parse({ ...curved, id: undefined, height: 5 })
    const replaced = {
      ...next,
      [level.id]: { ...level, children: [replacement.id] },
      [replacement.id]: replacement,
    }
    delete replaced[curved.id]
    expect(resolveRoofElevation(cone, replaced)).toBe(2)
    expect(resolveRoofElevation({ ...cone, position: [1, 7, 0] }, replaced)).toBe(7)
    expect(
      resolveRoofElevation(cone, { ...replaced, [segment.id]: { ...segment, width: 6 } }),
    ).toBe(0)
  })
})
