import { describe, expect, test } from 'bun:test'
import { lockOutsideFaces } from '../../commands/structure/lock-outside-faces'
import { setWallGeometry } from '../../commands/structure/set-wall-geometry'
import { applyToScratch, structureChangeBatch } from '../../commands/structure/shared'
import { area, intersection, union } from '../../lib/polygon-boolean'
import { reconcileSceneStructure } from '../../lib/structure-reconcile'
import { type AnyNode, LevelNode, WallNode } from '../../schema'
import { calculateLevelMiters, getWallPlanFootprint } from './wall-footprint'
import { faceOnLine, justificationForFaceOnLine, planWallJustification } from './wall-frame'
import { roomSideFaces } from './wall-room-sides'

const grid: [number, number][] = [
  [4, -11],
  [9, -11],
  [9, -5],
  [4, -5],
]
function house(reverse = false) {
  const level = LevelNode.parse({ id: 'level_reference' })
  const walls = grid.map((start, i) =>
    WallNode.parse({
      id: `wall_reference${i}`,
      parentId: level.id,
      thickness: 0.2,
      start: reverse ? grid[(i + 1) % 4]! : start,
      end: reverse ? start : grid[(i + 1) % 4]!,
      frontSide: 'exterior',
      backSide: 'exterior',
    }),
  )
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, ...walls].map((node) => [node.id, node]),
  )
  return { level, walls, nodes }
}
const vertices = (points: [number, number][]) =>
  new Set(points.map(([x, z]) => `${Number(x.toFixed(12))},${Number(z.toFixed(12))}`))

function expectGridMiters(walls: WallNode[], thickness: number) {
  const miters = calculateLevelMiters(walls)
  const footprints = walls.map((wall) =>
    getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]),
  )
  for (const corner of grid)
    expect(
      footprints.filter((polygon) =>
        polygon.some((point) => point[0] === corner[0] && point[1] === corner[1]),
      ),
    ).toHaveLength(2)
  for (let i = 0; i < footprints.length; i++)
    for (let j = i + 1; j < footprints.length; j++)
      expect(area(intersection(footprints[i]!, footprints[j]!))).toBeCloseTo(0, 12)
  const body = union(footprints)
  expect(body).toHaveLength(1)
  expect(vertices(body[0]!.outer)).toEqual(vertices(grid))
  expect(body[0]!.holes).toHaveLength(1)
  expect(vertices(body[0]!.holes[0]!)).toEqual(
    vertices([
      [4 + thickness, -11 + thickness],
      [9 - thickness, -11 + thickness],
      [9 - thickness, -5 - thickness],
      [4 + thickness, -5 - thickness],
    ]),
  )
  expect(area(body)).toBeCloseTo(30 - (5 - 2 * thickness) * (6 - 2 * thickness), 10)
}

describe('fixed wall reference lines', () => {
  test('face-on-line helpers map body sides to the opposite anchored face', () => {
    for (const face of ['a', 'b', 'center'] as const) {
      const justification = justificationForFaceOnLine(face)
      expect(justification).toBe(face === 'a' ? 'b' : face === 'b' ? 'a' : undefined)
      expect(faceOnLine({ justification })).toBe(face)
    }
  })

  for (const reverse of [false, true]) {
    test(`room sides come from spans, not stored classifications (reverse=${reverse})`, () => {
      const { nodes, walls } = house(reverse)
      for (const wall of walls)
        expect(roomSideFaces(nodes, wall.id)).toEqual({
          inside: reverse ? 'b' : 'a',
          outside: reverse ? 'a' : 'b',
        })
    })

    test(`outside-face locking and thickness 0.2→0.4 keep grid corners and clean inner miters (reverse=${reverse})`, () => {
      const { nodes, walls, level } = house(reverse)
      const references = JSON.stringify(walls.map(({ start, end }) => ({ start, end })))
      const plan = lockOutsideFaces(nodes, { levelId: level.id })
      expect(plan.conflicts).toBeUndefined()
      expect(plan.wallIds.sort()).toEqual(walls.map((wall) => wall.id).sort())
      for (const change of plan.changes) {
        expect(change.op).toBe('update')
        if (change.op === 'update') expect(Object.keys(change.data)).toEqual(['justification'])
      }
      let after = applyToScratch(nodes, structureChangeBatch(plan.changes))
      const currentWalls = () => walls.map((wall) => after[wall.id] as WallNode)
      expectGridMiters(currentWalls(), 0.2)
      for (const wall of walls)
        after = applyToScratch(
          after,
          structureChangeBatch(
            setWallGeometry(after, {
              wallId: wall.id,
              thickness: 0.4,
              mintId: () => {
                throw Error('No new boundary IDs')
              },
            }).changes,
          ),
        )
      expectGridMiters(currentWalls(), 0.4)
      expect(JSON.stringify(currentWalls().map(({ start, end }) => ({ start, end })))).toBe(
        references,
      )
      expect(lockOutsideFaces(after, { levelId: level.id })).toEqual({ changes: [], wallIds: [] })
    })
  }

  test('shared and unbounded walls have no unique inside or outside face and are not locked', () => {
    const { nodes, level } = house()
    const shared = WallNode.parse({
      id: 'wall_shared',
      parentId: level.id,
      start: [6, -11],
      end: [6, -5],
    })
    const loose = WallNode.parse({
      id: 'wall_loose',
      parentId: level.id,
      start: [20, 0],
      end: [25, 0],
    })
    const anotherLevel = WallNode.parse({
      id: 'wall_otherlevel',
      parentId: 'level_other',
      start: [4, -11],
      end: [9, -11],
    })
    const graph = {
      ...nodes,
      [shared.id]: shared,
      [loose.id]: loose,
      [anotherLevel.id]: anotherLevel,
    }
    for (const wall of [shared, loose, anotherLevel])
      expect(roomSideFaces(graph, wall.id)).toEqual({ inside: null, outside: null })
    const plan = lockOutsideFaces(graph, { levelId: level.id })
    expect(plan.wallIds).toHaveLength(4)
    expect(plan.wallIds).not.toContain(shared.id)
    expect(plan.wallIds).not.toContain(loose.id)
  })

  test('zone-scoped locking leaves other rooms untouched and reports only changed walls', () => {
    const { nodes, walls } = house()
    const other = walls.map((wall, i) => ({
      ...wall,
      id: `wall_other${i}` as WallNode['id'],
      start: [wall.start[0] + 20, wall.start[1]] as [number, number],
      end: [wall.end[0] + 20, wall.end[1]] as [number, number],
    }))
    let serial = 0
    const graph = reconcileSceneStructure({
      nodes: { ...nodes, ...Object.fromEntries(other.map((wall) => [wall.id, wall])) },
      mintId: (kind) => `${kind}_reference${++serial}`,
    }).nodes
    const zone = Object.values(graph).find(
      (node) => node.type === 'zone' && node.boundaryWallIds.includes(walls[0]!.id),
    )!
    const plan = lockOutsideFaces(graph, { zoneIds: [zone.id] })
    expect(plan.wallIds.sort()).toEqual(walls.map((wall) => wall.id).sort())
    const after = applyToScratch(graph, structureChangeBatch(plan.changes))
    for (const wall of other) expect(after[wall.id]).toEqual(graph[wall.id])
  })

  test('justification planner rejects a missing wall and never mutates its input', () => {
    const { nodes, walls } = house()
    const before = JSON.stringify(nodes)
    expect(() => planWallJustification(nodes, 'wall_missing', 'a')).toThrow('Select a wall')
    const plan = planWallJustification(nodes, walls[0]!.id, 'a')
    expect(plan).toEqual([{ id: walls[0]!.id, data: { justification: 'a' } }])
    expect(JSON.stringify(nodes)).toBe(before)
  })
})
