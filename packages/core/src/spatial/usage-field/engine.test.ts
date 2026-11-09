import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, DoorNode, LevelNode, SlabNode, WallNode } from '../../schema'
import { BucketIndex, bakeGrid, cellOf, cellX, cellZ, makeGrid } from './field'
import { BODY_BAND, buildField, floorGroups } from './level-field'
import { obstaclesInBand, signedDistance } from './obstacles'
import { pathTo, refinePassage, travel, widestPath } from './path'
import { usageShapes } from './shapes'
import type { Nodes } from './walls'

function house(extra: AnyNode[]): Nodes {
  const building = BuildingNode.parse({ id: 'building_1', children: ['level_1'] })
  const level = LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] })
  return Object.fromEntries([building, level, ...extra].map((node) => [node.id, node])) as Nodes
}

const wall = (
  id: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
) => WallNode.parse({ id, parentId: 'level_1', start, end, thickness: 0.1, children })

// A 6 x 4 m shell with a partition at x = 3 and a 0.9 m door in it, on a slab that reaches 0.3 m
// past the shell so the doorway of the south wall has floor to walk out onto.
function twoRooms(partitionDoor = 0.9) {
  const door = DoorNode.parse({
    id: 'door_1',
    parentId: 'wall_p',
    wallId: 'wall_p',
    position: [2, 1.05, 0],
    width: partitionDoor,
    height: 2.1,
  })
  return house([
    SlabNode.parse({
      id: 'slab_1',
      parentId: 'level_1',
      polygon: [
        [-0.3, -0.3],
        [6.3, -0.3],
        [6.3, 4.3],
        [-0.3, 4.3],
      ],
      elevation: 0.05,
    }),
    wall('wall_s', [0, 0], [6, 0]),
    wall('wall_e', [6, 0], [6, 4]),
    wall('wall_n', [6, 4], [0, 4]),
    wall('wall_w', [0, 4], [0, 0]),
    wall('wall_p', [3, 0], [3, 4], ['door_1']),
    door,
  ])
}

describe('the clearance field', () => {
  const shapes = usageShapes(twoRooms())
  const [group] = floorGroups(shapes)
  const field = buildField(shapes, group!, BODY_BAND, 0.02)

  test('the floor group stands at the slab surface and the band above it', () => {
    expect(group!.y).toBeCloseTo(0.05, 6)
    expect(field.band.z0).toBeCloseTo(0.08, 6)
    expect(field.band.z1).toBeCloseTo(2.05, 6)
  })

  test('clearance at the middle of a room is the distance to the nearest wall face', () => {
    // west room: 0.05..2.95 wide and 0.05..3.95 deep: the middle is 1.45 from both partition and west wall
    const c = cellOf(field.grid, 1.5, 2)
    expect(field.F[c]).toBeCloseTo(1.45, 1)
    expect(field.free[c]).toBe(1)
    const inWall = cellOf(field.grid, 3, 3.5)
    expect(field.F[inWall]).toBeLessThan(0)
    expect(field.free[inWall]).toBe(0)
  })

  test('the bucket index answers exactly what a scan of every obstacle does', () => {
    const index = new BucketIndex(field.obstacles, group!.domain)
    for (const [x, z] of [
      [1, 1],
      [2.95, 2],
      [3.04, 0.2],
      [4.5, 3.9],
      [6.1, 4.1],
      [-0.2, 2],
    ] as const) {
      const brute = Math.min(...field.obstacles.map((o) => signedDistance(o.edges, x, z)))
      expect(index.query(x, z).d).toBeCloseTo(brute, 9)
    }
  })

  test('the tiled bake equals the exact field cell for cell', () => {
    const g = makeGrid(group!.domain, 0.1)
    const baked = bakeGrid(g, field.obstacles)
    for (let j = 0; j < g.H; j += 7)
      for (let i = 0; i < g.W; i += 5) {
        const brute = Math.min(
          ...field.obstacles.map((o) => signedDistance(o.edges, cellX(g, i), cellZ(g, j))),
        )
        expect(Math.abs(baked.F[j * g.W + i]! - brute)).toBeLessThan(1e-5)
      }
  })

  test('only prisms meeting the band are obstacles: a door head above it is not, a jamb is', () => {
    const kinds = new Set(field.obstacles.map((o) => o.prism.kind))
    expect(kinds.has('jamb')).toBe(true)
    expect(kinds.has('door-head')).toBe(false)
    expect(
      obstaclesInBand(
        shapes.levels.flatMap((l) => l.prisms),
        { z0: 3, z1: 4 },
      ),
    ).toHaveLength(0)
  })
})

describe('paths through the field', () => {
  test('the widest path to the far room goes through the door and its width is the clear door', () => {
    const shapes = usageShapes(twoRooms(0.9))
    const [group] = floorGroups(shapes)
    const field = buildField(shapes, group!, BODY_BAND, 0.02)
    const source = cellOf(field.grid, 1.5, 2)
    const target = cellOf(field.grid, 4.5, 2)
    const { B, P } = widestPath(field.grid, field.F, field.floor, [source])
    expect(B[target]).toBeGreaterThan(0.39)
    const path = pathTo(P, field.F, target)
    // the grid bottleneck is within a cell of the clear width between the jambs (0.9 less two frame members of 0.05)
    expect(Math.abs(2 * field.F[path.cells[path.narrowest]!]! - 0.8)).toBeLessThan(0.05)
    const refined = refinePassage(
      field.grid,
      field.F,
      field.index,
      path,
      (cell) => cell === source,
      (x, z) => Math.hypot(x - 4.5, z - 2) < 0.2,
    )
    expect(refined.width).toBeGreaterThan(0.79)
    expect(refined.width).toBeLessThan(0.81)
    expect(refined.at[0]).toBeCloseTo(3, 1)
  })

  test('a doorway too narrow for the unit leaves the far room out of reach', () => {
    const shapes = usageShapes(twoRooms(0.6))
    const [group] = floorGroups(shapes)
    const field = buildField(shapes, group!, BODY_BAND, 0.02)
    const pass = new Uint8Array(field.free.length)
    for (let c = 0; c < pass.length; c++) pass[c] = field.floor[c] && field.F[c]! >= 0.3 ? 1 : 0
    const reach = travel(field.grid, pass, [cellOf(field.grid, 1.5, 2)])
    expect(reach[cellOf(field.grid, 1.5, 3)]).toBeGreaterThan(0)
    // 0.6 m door: 0.5 m between the jambs: a clearance of 0.25, below the unit's 0.30
    expect(reach[cellOf(field.grid, 4.5, 2)]).toBe(Number.POSITIVE_INFINITY)
  })

  test('travel distance is the metric length of the way', () => {
    const shapes = usageShapes(twoRooms(0.9))
    const [group] = floorGroups(shapes)
    const field = buildField(shapes, group!, BODY_BAND, 0.05)
    const pass = new Uint8Array(field.free.length)
    for (let c = 0; c < pass.length; c++) pass[c] = field.floor[c] && field.F[c]! >= 0.3 ? 1 : 0
    const from = cellOf(field.grid, 1, 2)
    const reach = travel(field.grid, pass, [from])
    // straight along the room: 1 -> 2.5 is 1.5 m, the 16-neighbour metric overestimates by at most 8%
    const there = reach[cellOf(field.grid, 2.5, 2)]!
    expect(there).toBeGreaterThan(1.49)
    expect(there).toBeLessThan(1.5 * 1.08)
  })
})
