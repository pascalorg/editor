import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  createRoomTopologyIndex,
  LevelNode,
  type Point,
  WallNode,
} from '@pascal-app/core'
import { formatLinearMeasurement } from './measurements'
import {
  DIMENSION_FLOOR_LIFT,
  mezzanineEdgeDimensions,
  type RoomDimension,
  wallPushDimensionRooms,
  wallPushDimensions,
} from './room-push-dimensions'

// Rooms are real: the walls go through core's room topology, so the faces the
// dimensions read are the ones the push arrows and the room outline use. Walls
// are 0.2 m thick and centred, so a clear width is the centreline span − 0.2.

const LEVEL = 'level_push_dimensions'
const THICKNESS = 0.2

type Scene = { nodes: Record<string, AnyNode>; walls: WallNode[] }

function scene(segments: Array<[Point, Point]>, extra: Partial<WallNode> = {}): Scene {
  const walls = segments.map(([start, end], i) =>
    WallNode.parse({
      id: `wall_d${i}`,
      parentId: LEVEL,
      start,
      end,
      thickness: THICKNESS,
      ...extra,
    }),
  )
  const level = LevelNode.parse({ id: LEVEL, children: walls.map((wall) => wall.id) })
  return {
    walls,
    nodes: Object.fromEntries([level, ...walls].map((node) => [node.id, node as AnyNode])),
  }
}

function ring(points: Point[]): Array<[Point, Point]> {
  return points.map((p, i) => [p, points[(i + 1) % points.length]!])
}

function measure(
  { nodes }: Scene,
  wall: WallNode,
  outward: Point,
  distance: number,
  span: { t0: number; t1: number } = { t0: 0, t1: 1 },
  elevationOf: (roomId: string) => number = () => 0,
): RoomDimension[] {
  const index = createRoomTopologyIndex()
  index.rebuildLevel(LEVEL, nodes)
  const rooms = index.getLevelTopology(LEVEL)?.rooms ?? []
  return wallPushDimensions({
    rooms: wallPushDimensionRooms(rooms, { wallId: wall.id, ...span }, elevationOf),
    wall,
    outward,
    distance,
    resolve: (id) => nodes[id],
  })
}

const distances = (dimensions: RoomDimension[]) =>
  dimensions.map((dimension) => Number(dimension.distance.toFixed(4)))

const wallAt = ({ walls }: Scene, start: Point, end: Point) =>
  walls.find(
    (wall) =>
      Math.hypot(wall.start[0] - start[0], wall.start[1] - start[1]) < 1e-9 &&
      Math.hypot(wall.end[0] - end[0], wall.end[1] - end[1]) < 1e-9,
  )!

describe('a rectangular room', () => {
  const room = scene(
    ring([
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ]),
  )
  const east = wallAt(room, [6, 0], [6, 4])

  test('at rest: the clear width, east face to west face, across the room', () => {
    const [dimension, ...rest] = measure(room, east, [1, 0], 0)
    expect(rest).toEqual([])
    expect(dimension!.distance).toBeCloseTo(6 - THICKNESS)
    // Face to face along the push axis, at the middle of the shared stretch.
    expect(dimension!.from[0]).toBeCloseTo(6 - THICKNESS / 2)
    expect(dimension!.to[0]).toBeCloseTo(THICKNESS / 2)
    expect(dimension!.from[1]).toBeCloseTo(dimension!.to[1])
    expect(dimension!.from[1]).toBeGreaterThan(0)
    expect(dimension!.from[1]).toBeLessThan(4)
  })

  test('follows the push both ways; only the room side is measured', () => {
    expect(distances(measure(room, east, [1, 0], 1.5))).toEqual([7.3])
    expect(distances(measure(room, east, [1, 0], -2))).toEqual([3.8])
  })

  test('the room on a raised floor measures just above that floor', () => {
    const [dimension] = measure(room, east, [1, 0], 0, undefined, () => 0.45)
    expect(dimension!.elevation).toBeCloseTo(0.45 + DIMENSION_FLOOR_LIFT)
  })

  test('a far wall split in two collinear pieces is one dimension', () => {
    const split = scene([
      [
        [0, 0],
        [6, 0],
      ],
      [
        [6, 0],
        [6, 4],
      ],
      [
        [6, 4],
        [0, 4],
      ],
      [
        [0, 4],
        [0, 2],
      ],
      [
        [0, 2],
        [0, 0],
      ],
    ])
    expect(distances(measure(split, wallAt(split, [6, 0], [6, 4]), [1, 0], 0))).toEqual([5.8])
  })

  test('a curved moving wall gets no dimension', () => {
    const curved = scene(
      ring([
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ]),
    )
    const wall = wallAt(curved, [6, 0], [6, 4])
    expect(measure(curved, { ...wall, curveOffset: 0.8 }, [1, 0], 0)).toEqual([])
  })
})

describe('an L-shaped room', () => {
  // The notch is the top right: the south wall faces the notch wall (y = 2)
  // and the north wall (y = 4), two distinct widths, nearest first.
  const room = scene(
    ring([
      [0, 0],
      [6, 0],
      [6, 2],
      [3, 2],
      [3, 4],
      [0, 4],
    ]),
  )
  const south = wallAt(room, [0, 0], [6, 0])

  test('every facing parallel wall, nearest first', () => {
    const dimensions = measure(room, south, [0, -1], 0)
    expect(distances(dimensions)).toEqual([1.8, 3.8])
    // Each is measured where the two faces overlap: the notch over x 3..6, the north wall over 0..3.
    expect(dimensions[0]!.from[0]).toBeGreaterThan(3)
    expect(dimensions[1]!.from[0]).toBeLessThan(3)
    expect(new Set(dimensions.map((dimension) => dimension.key)).size).toBe(2)
  })

  test('a wall that no longer faces the moving one drops out', () => {
    // Pulled north past the notch wall (y = 2), only the north wall is ahead.
    expect(distances(measure(room, south, [0, -1], -2.5))).toEqual([1.3])
  })
})

describe('two rooms sharing the moving wall', () => {
  const rooms = scene([
    ...ring([
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ]),
    [
      [4, 0],
      [4, 4],
    ],
  ])
  const middle = wallAt(rooms, [4, 0], [4, 4])

  test('one width per side, each from its own face of the wall', () => {
    const dimensions = measure(rooms, middle, [1, 0], 1)
    expect(dimensions).toHaveLength(2)
    const west = dimensions.find((dimension) => dimension.to[0] < 4)!
    const east = dimensions.find((dimension) => dimension.to[0] > 4)!
    expect(west.distance).toBeCloseTo(5 - THICKNESS)
    expect(east.distance).toBeCloseTo(3 - THICKNESS)
    expect(west.from[0]).toBeCloseTo(5 - THICKNESS / 2)
    expect(east.from[0]).toBeCloseTo(5 + THICKNESS / 2)
    expect(west.key).not.toBe(east.key)
  })

  test('a push over part of the wall measures only the rooms along that part', () => {
    const dimensions = measure(rooms, middle, [1, 0], 0, { t0: 0, t1: 0.5 })
    expect(dimensions).toHaveLength(2)
    for (const dimension of dimensions) {
      expect(dimension.from[1]).toBeGreaterThan(0)
      expect(dimension.from[1]).toBeLessThan(2)
    }
  })
})

describe('a rotated room', () => {
  const angle = Math.PI / 6
  const rotate = ([x, z]: Point): Point => [
    x * Math.cos(angle) - z * Math.sin(angle),
    x * Math.sin(angle) + z * Math.cos(angle),
  ]
  const corners = (
    [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ] as Point[]
  ).map(rotate)
  const room = scene(ring(corners))
  const east = wallAt(room, corners[1]!, corners[2]!)
  const outward = rotate([1, 0])

  test('measures along the rotated axis, the same widths', () => {
    const [dimension] = measure(room, east, outward, 0.5)
    expect(dimension!.distance).toBeCloseTo(6.5 - THICKNESS)
    const { from, to, distance } = dimension!
    expect((to[0] - from[0]) / distance).toBeCloseTo(-outward[0])
    expect((to[1] - from[1]) / distance).toBeCloseTo(-outward[1])
  })

  test('a wall about 2° off parallel is not measured', () => {
    const skewed = scene(
      ring([
        [0, 0],
        [6, 0],
        [6, 4],
        [0.15, 4],
      ]),
    )
    expect(measure(skewed, wallAt(skewed, [6, 0], [6, 4]), [1, 0], 0)).toEqual([])
  })
})

describe('a mezzanine edge', () => {
  const rest: Point[] = [
    [0, 0],
    [5, 0],
    [5, 3],
    [2, 3],
    [2, 2],
    [0, 2],
  ]

  test('measures to each facing parallel edge of the outline it would leave', () => {
    // Edge 0 (south, y = 0) pushed 0.5 m south: the outline follows.
    const outline = rest.map(([x, z], i): Point => (i < 2 ? [x, z - 0.5] : [x, z]))
    const dimensions = mezzanineEdgeDimensions({
      rest,
      outline,
      edgeIndex: 0,
      outward: [0, -1],
      distance: 0.5,
      elevation: 1.2,
    })
    expect(distances(dimensions)).toEqual([2.5, 3.5])
    expect(dimensions[0]!.elevation).toBeCloseTo(1.2 + DIMENSION_FLOOR_LIFT)
  })

  test('a refused push still measures, from the edge where the arrow is', () => {
    const dimensions = mezzanineEdgeDimensions({
      rest,
      outline: rest,
      edgeIndex: 0,
      outward: [0, -1],
      distance: -1,
      elevation: 1.2,
    })
    expect(distances(dimensions)).toEqual([1, 2])
  })
})

describe('units', () => {
  test('a dimension reads in the viewer’s units', () => {
    const room = scene(
      ring([
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ]),
    )
    const [dimension] = measure(room, wallAt(room, [6, 0], [6, 4]), [1, 0], 0)
    expect(formatLinearMeasurement(dimension!.distance, 'metric')).toBe('5.8m')
    expect(formatLinearMeasurement(dimension!.distance, 'metric', 'millimeters')).toBe('5800mm')
    expect(formatLinearMeasurement(dimension!.distance, 'imperial')).toBe(`19'0"`)
  })
})
