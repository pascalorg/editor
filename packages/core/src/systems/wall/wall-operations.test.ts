import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import { getWallCurveFrameAt, getWallCurveLength } from './wall-curve'
import {
  planWallDivision,
  planWallDivisions,
  planWallRectangle,
  wallRectangleCorners,
} from './wall-operations'

const level = LevelNode.parse({ id: 'level_creation', children: [] })
const map = (nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
const rectangle = (offset = 0) => {
  const points = wallRectangleCorners([offset, 0], [offset + 8, 6])
  return points.map((start, i) =>
    WallNode.parse({ parentId: level.id, start, end: points[(i + 1) % 4] }),
  )
}
describe('wall creation operations', () => {
  test('rectangle is closed in every drag direction and the planning graph is untouched', () => {
    const nodes = map([])
    const before = JSON.stringify(nodes)
    for (const [a, b] of [
      [
        [0, 0],
        [8, 6],
      ],
      [
        [8, 0],
        [0, 6],
      ],
      [
        [8, 6],
        [0, 0],
      ],
    ]) {
      const plan = planWallRectangle(nodes, {
        levelId: level.id,
        start: a as [number, number],
        end: b as [number, number],
        wallDefaults: { thickness: 0.22 },
      })
      expect(plan.walls).toHaveLength(4)
      plan.walls.forEach((w, i) => {
        expect(w.end).toEqual(plan.walls[(i + 1) % 4]!.start)
        expect(w.thickness).toBe(0.22)
      })
    }
    expect(JSON.stringify(nodes)).toBe(before)
  })
  test('adjacent rectangles reuse their shared wall', () => {
    const existing = rectangle()
    const plan = planWallRectangle(map(existing), {
      levelId: level.id,
      start: [8, 0],
      end: [12, 6],
    })
    expect(plan.changes.create).toHaveLength(3)
    expect(plan.changes.delete).toHaveLength(0)
  })
  test('a side drawn along an existing wall and past its end adds only the overhang', () => {
    const existing = rectangle()
    const plan = planWallRectangle(map(existing), {
      levelId: level.id,
      start: [8, 0],
      end: [12, 8],
    })
    expect(plan.changes.create).toHaveLength(4)
    expect(plan.changes.delete).toHaveLength(0)
    const alongSharedLine = plan.walls.filter((w) => w.start[0] === 8 && w.end[0] === 8)
    expect(alongSharedLine).toHaveLength(1)
    expect([alongSharedLine[0]!.start[1], alongSharedLine[0]!.end[1]].sort()).toEqual([6, 8])
  })
  test('an existing wall in the middle of a side leaves a remainder on each side of it', () => {
    const middle = WallNode.parse({ parentId: level.id, start: [2, 0], end: [5, 0] })
    const plan = planWallRectangle(map([middle]), {
      levelId: level.id,
      start: [0, 0],
      end: [8, 6],
    })
    expect(plan.changes.create).toHaveLength(5)
    const bottom = plan.walls
      .filter((w) => w.start[1] === 0 && w.end[1] === 0)
      .map((w) => [w.start[0], w.end[0]].sort((a, b) => a - b))
      .sort((a, b) => a[0]! - b[0]!)
    expect(bottom).toEqual([
      [0, 2],
      [5, 8],
    ])
  })
  test('a rectangle side T-joining a room wall keeps the room on the replacement walls', () => {
    const existing = rectangle()
    const room = ZoneNode.parse({
      parentId: level.id,
      name: 'Room',
      polygon: existing.map((w) => w.start),
      autoFromWalls: true,
      boundaryWallIds: existing.map((w) => w.id),
    })
    const plan = planWallRectangle(map([...existing, room]), {
      levelId: level.id,
      start: [4, 6],
      end: [8, 10],
    })
    const top = existing[2]!
    expect(plan.changes.delete).toEqual([top.id])
    const zone = plan.changes.update.find((op) => op.id === room.id)?.data as
      | { boundaryWallIds: string[] }
      | undefined
    expect(zone?.boundaryWallIds).toHaveLength(5)
    expect(zone?.boundaryWallIds).not.toContain(top.id)
    const createdIds = plan.changes.create.map((op) => op.node.id)
    for (const id of zone?.boundaryWallIds ?? []) {
      expect(createdIds.includes(id) || existing.some((w) => w.id === id)).toBe(true)
    }
  })
  test('a gap too short to be a wall counts as covered', () => {
    const almost = WallNode.parse({ parentId: level.id, start: [8, 0], end: [8, 5.995] })
    const plan = planWallRectangle(map([almost]), {
      levelId: level.id,
      start: [8, 0],
      end: [12, 6],
    })
    expect(plan.changes.create).toHaveLength(3)
  })
  test('invalid rectangle has no partial result', () => {
    for (const end of [
      [0, 5],
      [5, 0.01],
      [NaN, 5],
    ])
      expect(() =>
        planWallRectangle(map([]), {
          levelId: level.id,
          start: [0, 0],
          end: end as [number, number],
        }),
      ).toThrow()
  })
  test('split preserves original id and remaps openings without changing their world placement', () => {
    const wall = WallNode.parse({
      parentId: level.id,
      start: [2, 3],
      end: [8, 11],
      thickness: 0.3,
      slots: { exterior: 'preset:brick' },
    })
    const opening = WindowNode.parse({
      parentId: wall.id,
      wallId: wall.id,
      position: [8, 1.5, 0],
      width: 1,
    })
    wall.children = [opening.id]
    const zone = ZoneNode.parse({
      name: 'Room',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ],
      parentId: level.id,
      boundaryWallIds: [wall.id],
      autoFromWalls: true,
    })
    const plan = planWallDivision(map([wall, opening, zone]), wall.id, 4)
    expect(plan.changes.delete).toEqual([])
    expect(plan.changes.create).toHaveLength(1)
    const first = plan.changes.update.find((op) => op.id === wall.id)!.data as WallNode
    const second = plan.changes.create[0]!.node as WallNode
    expect(first.end).toEqual(second.start)
    expect(second.slots).toEqual(wall.slots)
    const moved = plan.changes.update.find((op) => op.id === opening.id)!.data as WindowNode
    expect(moved.position).toEqual([4, 1.5, 0])
    expect(moved.parentId).toBe(second.id)
    expect(plan.changes.update.find((op) => op.id === zone.id)!.data).toMatchObject({
      boundaryWallIds: [wall.id, second.id],
    })
  })
  test('split refuses cuts through windows and near endpoints', () => {
    const wall = rectangle()[0]!
    const opening = WindowNode.parse({
      parentId: wall.id,
      wallId: wall.id,
      position: [4, 1.5, 0],
      width: 2,
    })
    wall.children = [opening.id]
    for (const distance of [0, 0.01, 4, 8, NaN])
      expect(() => planWallDivision(map([wall, opening]), wall.id, distance)).toThrow()
  })
  test('several cuts commit as one plan: first id kept, openings follow their segment', () => {
    const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [8, 0] })
    const opening = WindowNode.parse({
      parentId: wall.id,
      wallId: wall.id,
      position: [7, 1.5, 0],
      width: 1,
    })
    wall.children = [opening.id]
    const nodes = map([wall, opening])
    const plan = planWallDivisions(nodes, wall.id, [2, 4, 6])
    expect(plan.points).toEqual([
      [2, 0],
      [4, 0],
      [6, 0],
    ])
    expect(plan.changes.delete).toEqual([])
    const walls = [
      plan.changes.update.find((op) => op.id === wall.id)!.data as WallNode,
      ...plan.changes.create.map((op) => op.node as WallNode),
    ].sort((a, b) => a.start[0] - b.start[0])
    expect(walls.map((w) => [w.start[0], w.end[0]])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [6, 8],
    ])
    expect(walls[0]!.id).toBe(wall.id)
    const moved = plan.changes.update.find((op) => op.id === opening.id)!.data as WindowNode
    expect(moved.parentId).toBe(walls[3]!.id)
    expect(moved.position).toEqual([1, 1.5, 0])
    expect(nodes[wall.id]).toBe(wall)
  })
  test('cuts closer than 5 cm apart are refused as a whole', () => {
    const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [8, 0] })
    expect(() => planWallDivisions(map([wall]), wall.id, [4, 4.02])).toThrow()
  })
  test('curved splits preserve total arc length and curve endpoint', () => {
    const wall = WallNode.parse({
      parentId: level.id,
      start: [0, 0],
      end: [8, 0],
      curveOffset: 1,
    })
    const length = getWallCurveLength(wall)
    const expected = getWallCurveFrameAt(wall, 0.4).point
    const plan = planWallDivision(map([wall]), wall.id, length * 0.4)
    const first = plan.changes.update[0]!.data as WallNode
    const second = plan.changes.create[0]!.node as WallNode
    expect(first.end[0]).toBeCloseTo(expected.x)
    expect(first.end[1]).toBeCloseTo(expected.y)
    expect(getWallCurveLength(first) + getWallCurveLength(second)).toBeCloseTo(length)
  })
})
