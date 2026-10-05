import { describe, expect, spyOn, test } from 'bun:test'
import clipping from 'polygon-clipping'
import { LevelNode, SeparatorNode, SlabNode, WallNode } from '../schema'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { getWallCurveFrameAt } from '../systems/wall/wall-curve'
import { exposedIntervals, plateFootprint, roomClearPolygon } from './level-footprints'
import { area, containsPoint, difference, intersection, type Ring, union } from './polygon-boolean'
import type { BoundaryNode, LevelTopology } from './room-topology-index'
import { createRoomTopologyIndex, detectSpacesForLevel } from './space-detection'

const levelId = 'level_topology' as const
function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  extra: Partial<WallNode> = {},
) {
  return WallNode.parse({
    id: `wall_${id}`,
    parentId: levelId,
    start,
    end,
    thickness: 0.2,
    ...extra,
  })
}
function enclosure(polygon: Ring): WallNode[] {
  return polygon.map((p, i) => wall(`${i}`, p, polygon[(i + 1) % polygon.length]!))
}
function rectangle() {
  return enclosure([
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ])
}
function scene(boundaries: BoundaryNode[]) {
  const level = LevelNode.parse({ id: levelId, children: boundaries.map((node) => node.id) })
  return Object.fromEntries([level, ...boundaries].map((node) => [node.id, node]))
}
function topology(boundaries: BoundaryNode[]) {
  const index = createRoomTopologyIndex()
  index.rebuild(scene(boundaries))
  return { index, level: index.getLevelTopology(levelId)! }
}
function assertTiling(level: LevelTopology, boundaries: BoundaryNode[]) {
  const all = [...level.rooms.flatMap((room) => room.spans), ...level.exteriorSpans]
  for (const boundary of boundaries) {
    for (const face of ['a', 'b'] as const) {
      const spans = all
        .filter((span) => span.boundaryId === boundary.id && span.face === face)
        .sort((a, b) => a.t0 - b.t0)
      expect(spans[0]!.t0).toBe(0)
      expect(spans.at(-1)!.t1).toBe(1)
      spans.forEach((span, i) => {
        expect(span.t1).toBeGreaterThan(span.t0)
        if (i) expect(span.t0).toBeCloseTo(spans[i - 1]!.t1, 12)
      })
    }
  }
  for (const room of level.rooms) {
    const perimeter = [room.polygon, ...room.holes].reduce(
      (total, ring) =>
        total +
        ring.reduce((sum, p, i) => {
          const q = ring[(i + 1) % ring.length]!
          return sum + Math.hypot(q[0] - p[0], q[1] - p[1])
        }, 0),
      0,
    )
    const spanLength = room.spans.reduce((sum, span) => {
      const boundary = boundaries.find((node) => node.id === span.boundaryId)!
      return (
        sum +
        (span.t1 - span.t0) *
          Math.hypot(boundary.end[0] - boundary.start[0], boundary.end[1] - boundary.start[1])
      )
    }, 0)
    expect(spanLength).toBeCloseTo(perimeter, 6)
  }
}

const cases: Array<{ name: string; boundaries: () => BoundaryNode[]; rooms: number }> = [
  { name: '4×3 room with centred 0.2 m walls', boundaries: rectangle, rooms: 1 },
  {
    name: '4×3 room with two b-justified walls',
    boundaries: () =>
      rectangle().map((node, i) => (i < 2 ? { ...node, justification: 'b' as const } : node)),
    rooms: 1,
  },
  {
    name: 'two rooms sharing a wall',
    boundaries: () => [...rectangle(), wall('shared', [2, 0], [2, 3])],
    rooms: 2,
  },
  {
    name: 'L-shaped room with a dangling T-stem',
    boundaries: () => [
      ...enclosure([
        [0, 0],
        [4, 0],
        [4, 2],
        [2, 2],
        [2, 3],
        [0, 3],
      ]),
      wall('stem', [1, 0], [1, -2]),
      wall('free', [6, 0], [6, 2]),
    ],
    rooms: 1,
  },
  {
    name: 'room split by a separator',
    boundaries: () => [
      ...rectangle(),
      SeparatorNode.parse({ id: 'separator_split', parentId: levelId, start: [2, 0], end: [2, 3] }),
    ],
    rooms: 2,
  },
]

describe('level footprint agreement', () => {
  test.each(cases)('$name', ({ boundaries: build, rooms: count }) => {
    const boundaries = build()
    const { index, level } = topology(boundaries)
    expect(level.rooms).toHaveLength(count)
    const plate = plateFootprint(level.rooms)
    expect(plate).toHaveLength(1)
    expect(plateFootprint([...level.rooms].reverse())).toBe(plate)
    const slab = SlabNode.parse({
      polygon: plate[0]!.outer,
      holes: plate[0]!.holes,
      elevation: 0.2,
    })
    const walls = boundaries.filter((node): node is WallNode => node.type === 'wall')
    const boundaryIds = new Set(
      level.rooms.flatMap((room) =>
        room.spans.filter((span) => span.kind === 'wall').map((span) => span.boundaryId),
      ),
    )
    for (const id of boundaryIds) {
      const footprint = level.rooms[0]!.context.wallFootprints.get(id)!
      expect(area(difference(footprint, plate))).toBeLessThan(1e-6)
      const support = computeWallSlabSupport(walls.find((node) => node.id === id)!, [slab], walls)
      expect(support.electedSlabId).toBe(slab.id)
      const coverage = support.baseSegments
        .filter((segment) => segment.elevation === slab.elevation)
        .reduce((sum, segment) => sum + segment.end - segment.start, 0)
      expect(coverage).toBeCloseTo(1, 6)
    }
    for (const room of level.rooms) {
      const footprints = union(
        room.spans
          .filter((span) => span.kind === 'wall')
          .map((span) => room.context.wallFootprints.get(span.boundaryId)!),
      )
      const face = { outer: room.polygon, holes: room.holes }
      const expected = area(union([face])) - area(intersection(face, footprints))
      expect(Math.abs(area(roomClearPolygon(room)) - expected)).toBeLessThan(1e-6)
      expect(roomClearPolygon(room)).toBe(roomClearPolygon(room))
      for (const span of room.spans) {
        expect(
          index.roomForWallHit(levelId, span.boundaryId, span.face, (span.t0 + span.t1) / 2)?.id,
        ).toBe(room.id)
      }
    }
    assertTiling(level, boundaries)
    if (boundaryIds.has('wall_shared')) {
      expect(index.roomForWallHit(levelId, 'wall_shared', 'a', 0.5)).toBe(
        index.roomAtPoint(levelId, [1, 1]),
      )
      expect(index.roomForWallHit(levelId, 'wall_shared', 'b', 0.5)).toBe(
        index.roomAtPoint(levelId, [3, 1]),
      )
      expect(index.spansForWall(levelId, 'wall_0').map(({ t0, t1 }) => [t0, t1])).toEqual([
        [0, 0.5],
        [0.5, 1],
      ])
    }
    expect(boundaryIds.has('wall_stem')).toBe(false)
    expect(boundaryIds.has('wall_free')).toBe(false)
    if (boundaries.some((node) => node.id === 'wall_stem')) {
      expect(
        area(
          intersection(plate, [
            [0.9, -1],
            [1.1, -1],
            [1.1, -0.5],
            [0.9, -0.5],
          ]),
        ),
      ).toBe(0)
    }
    expect(index.roomAtPoint(levelId, [20, 20])).toBeNull()
    expect(index.roomForWallHit(levelId, 'wall_0', 'b', 0.5)).toBeNull()
  })

  test('exposed intervals split outer edges at covered portions, including collinear rims', () => {
    const plate = union([
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    ])
    const walls = [wall('cover', [1, 0.1], [3, 0.1])]
    const bottom = exposedIntervals(plate, walls).filter((interval) => interval.edgeIndex === 0)
    expect(bottom).toHaveLength(2)
    expect(bottom[0]!.t0).toBe(0)
    expect(bottom[0]!.t1).toBeCloseTo(0.25, 12)
    expect(bottom[1]!.t0).toBeCloseTo(0.75, 12)
    expect(bottom[1]!.t1).toBe(1)
    expect(exposedIntervals(plate, [])).toHaveLength(4)
    expect(exposedIntervals([], walls)).toEqual([])
    const closed = topology(rectangle()).level
    expect(exposedIntervals(plateFootprint(closed.rooms), rectangle())).toEqual([])
  })

  test('separator delta splits and merges the graph without wall classification or miter participation', () => {
    const walls = rectangle()
    const separator = SeparatorNode.parse({ parentId: levelId, start: [2, 0], end: [2, 3] })
    const before = scene(walls),
      after = scene([...walls, separator])
    const { index, level: previous } = topology(walls)
    const delta = index.applyWallDelta(levelId, new Set([separator.id]), before, after)
    expect(delta.strategy).toBe('indexed')
    expect(delta.beforeRooms).toHaveLength(1)
    expect(delta.currentRooms).toHaveLength(2)
    const next = index.getLevelTopology(levelId)!
    expect(next.revision).toBeGreaterThan(previous.revision)
    expect(plateFootprint(next.rooms)).toEqual(plateFootprint(previous.rooms))
    expect(next.rooms[0]!.context.wallFootprints).toEqual(previous.rooms[0]!.context.wallFootprints)
    expect(
      detectSpacesForLevel(levelId, [...walls, separator]).wallUpdates.map(
        (update) => update.wallId,
      ),
    ).not.toContain(separator.id)
    index.applyWallDelta(levelId, new Set([separator.id]), after, before)
    expect(index.getLevelTopology(levelId)!.rooms).toHaveLength(1)
  })

  test('thickness changes invalidate footprints and keep earlier revision snapshots intact', () => {
    const walls = rectangle()
    const { index, level: previous } = topology(walls)
    const oldPlate = plateFootprint(previous.rooms)
    const changed = walls.map((node) =>
      node.id === walls[0]!.id ? { ...node, thickness: 0.6 } : node,
    )
    index.applyWallDelta(levelId, new Set([walls[0]!.id]), scene(walls), scene(changed))
    const next = index.getLevelTopology(levelId)!
    expect(area(plateFootprint(next.rooms))).toBeGreaterThan(area(oldPlate))
    expect(plateFootprint(previous.rooms)).toBe(oldPlate)
    expect(() => plateFootprint([previous.rooms[0]!, next.rooms[0]!])).toThrow()
  })

  test('one wall face can be exterior on only part of its stored reference line', () => {
    const boundaries = [
      wall('long', [0, 0], [8, 0]),
      wall('right', [4, 0], [4, 3]),
      wall('top', [4, 3], [0, 3]),
      wall('left', [0, 3], [0, 0]),
    ]
    const { index, level } = topology(boundaries)
    expect(index.spansForWall(levelId, 'wall_long')).toMatchObject([{ face: 'a', t0: 0, t1: 0.5 }])
    expect(level.exteriorSpans.filter((span) => span.boundaryId === 'wall_long')).toEqual([
      { roomId: null, boundaryId: 'wall_long', kind: 'wall', face: 'a', t0: 0.5, t1: 1 },
      { roomId: null, boundaryId: 'wall_long', kind: 'wall', face: 'b', t0: 0, t1: 0.5 },
      { roomId: null, boundaryId: 'wall_long', kind: 'wall', face: 'b', t0: 0.5, t1: 1 },
    ])
    expect(index.roomForWallHit(levelId, 'wall_long', 'a', 0.25)).toBe(level.rooms[0]!)
    expect(index.roomForWallHit(levelId, 'wall_long', 'a', 0.5)).toBeNull()
    expect(index.roomForWallHit(levelId, 'wall_long', 'a', -1)).toBeNull()
    assertTiling(level, boundaries)
  })

  test('separator movement uses the indexed component and agrees with a full rebuild', () => {
    const separator = SeparatorNode.parse({ parentId: levelId, start: [2, 0], end: [2, 3] })
    const remote = rectangle().map((node) => ({
      ...node,
      id: `${node.id}_remote` as WallNode['id'],
      start: [node.start[0] + 20, node.start[1]] as [number, number],
      end: [node.end[0] + 20, node.end[1]] as [number, number],
    }))
    const before = [...rectangle(), ...remote, separator]
    const after = before.map((node) =>
      node.id === separator.id
        ? { ...separator, start: [1, 0] as [number, number], end: [1, 3] as [number, number] }
        : node,
    )
    const { index } = topology(before)
    const delta = index.applyWallDelta(
      levelId,
      new Set([separator.id]),
      scene(before),
      scene(after),
    )
    expect(delta.examinedWallIds).not.toContain(remote[0]!.id)
    expect(delta.currentRooms).toHaveLength(2)
    expect(
      index
        .getLevelTopology(levelId)!
        .rooms.map(({ id, polygon, spans }) => ({ id, polygon, spans })),
    ).toEqual(topology(after).level.rooms.map(({ id, polygon, spans }) => ({ id, polygon, spans })))
    expect(index.roomForWallHit(levelId, 'wall_0', 'a', 0.25)).toBe(
      index.roomAtPoint(levelId, [3, 1]),
    )
    expect(index.roomForWallHit(levelId, 'wall_0', 'a', 1)).toBe(index.roomAtPoint(levelId, [3, 1]))
  })

  test('separator-only enclosures contribute faces and no physical footprints', () => {
    const boundaries = rectangle().map(({ start, end }) =>
      SeparatorNode.parse({ parentId: levelId, start, end }),
    )
    const { level } = topology(boundaries)
    expect(level.rooms).toHaveLength(1)
    expect(level.rooms[0]!.context.wallFootprints.size).toBe(0)
    expect(area(plateFootprint(level.rooms))).toBe(12)
    expect(area(roomClearPolygon(level.rooms[0]!))).toBe(12)
    assertTiling(level, boundaries)
  })

  test('curved wall spans use stored chord parameters and stored direction', () => {
    const walls = rectangle()
    walls[0] = { ...walls[0]!, curveOffset: 0.5 }
    const { index, level } = topology(walls)
    const span = index.spansForWall(levelId, walls[0]!.id)[0]!
    expect(span).toMatchObject({ face: 'a', t0: 0, t1: 1 })
    const point = getWallCurveFrameAt(walls[0]!, 0.25).point
    const chordT = point.x / 4
    expect(index.roomForWallHit(levelId, walls[0]!.id, 'a', chordT)?.id).toBe(level.rooms[0]!.id)
    const reverse = walls.map((node, i) =>
      i === 0
        ? { ...node, start: node.end, end: node.start, curveOffset: -node.curveOffset! }
        : node,
    )
    expect(topology(reverse).index.spansForWall(levelId, walls[0]!.id)[0]).toMatchObject({
      face: 'b',
      t0: 0,
      t1: 1,
    })
  })
})

function nestedWalls() {
  const outer = enclosure([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ])
  const inner = enclosure([
    [3, 3],
    [7, 3],
    [7, 7],
    [3, 7],
  ]).map((node) => ({ ...node, id: `${node.id}_inner` as WallNode['id'] }))
  return { outer, inner, walls: [...outer, ...inner] }
}

describe('nested reference faces', () => {
  test('10×10 outer and 4×4 inner have disjoint faces, holes, clear polygons and two-sided spans', () => {
    const { walls, inner: innerWalls } = nestedWalls()
    const { index, level } = topology(walls)
    const outer = index.roomAtPoint(levelId, [1, 1])!
    const inner = index.roomAtPoint(levelId, [5, 5])!
    expect(level.rooms).toHaveLength(2)
    expect(inner.id).not.toBe(outer.id)
    expect(outer.holes).toHaveLength(1)
    expect(inner.holes).toHaveLength(0)
    const outerFace = { outer: outer.polygon, holes: outer.holes }
    const innerFace = { outer: inner.polygon, holes: inner.holes }
    expect(area([outerFace])).toBe(84)
    expect(area([innerFace])).toBe(16)
    expect(intersection(outerFace, innerFace)).toEqual([])
    expect(area(roomClearPolygon(outer))).toBeCloseTo(78.4, 6)
    expect(area(roomClearPolygon(inner))).toBeCloseTo(14.44, 6)
    const outerPlate = plateFootprint([outer])
    expect(outerPlate[0]!.holes).toHaveLength(1)
    expect(containsPoint(outerPlate, [5, 5])).toBe(false)
    expect(area(outerPlate)).toBeCloseTo(89.6, 6)
    const filled = plateFootprint([outer, inner])
    expect(filled[0]!.holes).toHaveLength(0)
    expect(containsPoint(filled, [5, 5])).toBe(true)
    expect(area(filled)).toBeCloseTo(104.04, 6)
    for (const boundary of innerWalls) {
      expect(index.spansForWall(levelId, boundary.id)).toHaveLength(2)
      expect(index.roomForWallHit(levelId, boundary.id, 'a', 0.5)).toBe(inner)
      expect(index.roomForWallHit(levelId, boundary.id, 'b', 0.5)).toBe(outer)
      expect(level.exteriorSpans.some((span) => span.boundaryId === boundary.id)).toBe(false)
      expect(difference(outer.context.wallFootprints.get(boundary.id)!, outerPlate)).toEqual([])
    }
    assertTiling(level, walls)
    const legacy = detectSpacesForLevel(levelId, walls)
    expect(
      legacy.spaces.map((space) => area([{ outer: space.polygon, holes: space.holes ?? [] }])),
    ).toEqual([84, 16])
    expect(legacy.spaces.map((space) => space.wallIds.length)).toEqual([8, 4])
  })

  test('a partitioned inner enclosure has one surrounding hole and no outer spans on its divider', () => {
    const { walls } = nestedWalls()
    const divider = wall('inner_divider', [5, 3], [5, 7])
    const { index, level } = topology([...walls, divider])
    const outer = index.roomAtPoint(levelId, [1, 1])!
    expect(level.rooms).toHaveLength(3)
    expect(outer.holes).toHaveLength(1)
    expect(area([{ outer: outer.polygon, holes: outer.holes }])).toBe(84)
    expect(outer.spans.some((span) => span.boundaryId === divider.id)).toBe(false)
    expect(index.spansForWall(levelId, divider.id)).toHaveLength(2)
    expect(plateFootprint(level.rooms)[0]!.holes).toHaveLength(0)
    assertTiling(level, [...walls, divider])
  })

  test('each nested boundary belongs to its smallest containing face', () => {
    const { walls } = nestedWalls()
    const centre = enclosure([
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ]).map((node) => ({ ...node, id: `${node.id}_centre` as WallNode['id'] }))
    const { index, level } = topology([...walls, ...centre])
    expect(level.rooms).toHaveLength(3)
    for (const [point, expected] of [
      [[1, 1], 84],
      [[3.5, 3.5], 12],
      [[5, 5], 4],
    ] as Array<[[number, number], number]>) {
      const room = index.roomAtPoint(levelId, point)!
      expect(area([{ outer: room.polygon, holes: room.holes }])).toBe(expected)
    }
    assertTiling(level, [...walls, ...centre])
  })

  test('nested creation, opening, restoration and movement agree with a full rebuild', () => {
    const { outer, inner, walls } = nestedWalls()
    const { index, level: original } = topology(outer)
    let before: BoundaryNode[] = outer
    const opened = walls.filter((node) => node.id !== inner[0]!.id)
    const moved = [
      ...outer,
      ...inner.map((node) => ({
        ...node,
        start: [node.start[0] + 15, node.start[1]] as [number, number],
        end: [node.end[0] + 15, node.end[1]] as [number, number],
      })),
    ]
    for (const after of [walls, opened, walls, moved, walls, inner]) {
      const ids = new Set(
        [...before, ...after]
          .map((node) => node.id)
          .filter(
            (id) => before.find((node) => node.id === id) !== after.find((node) => node.id === id),
          ),
      )
      index.applyWallDelta(levelId, ids, scene(before), scene(after))
      const snapshot = (value: LevelTopology) =>
        value.rooms.map(({ id, polygon, holes, spans }) => ({ id, polygon, holes, spans }))
      expect(snapshot(index.getLevelTopology(levelId)!)).toEqual(snapshot(topology(after).level))
      before = after
    }
    expect(original.rooms[0]!.holes).toEqual([])
  })
})

describe('curved boundary junctions and exposure caching', () => {
  test.each([
    'separator',
    'wall',
  ] as const)('%s endpoint splits a curved wall at mid-span', (kind) => {
    for (const arcT of [0.5, 0.37]) {
      const walls = rectangle()
      walls[0] = { ...walls[0]!, curveOffset: 0.5 }
      const point = getWallCurveFrameAt(walls[0]!, arcT).point
      const start: [number, number] = [point.x, point.y]
      const end: [number, number] = [point.x, 3]
      const divider =
        kind === 'separator'
          ? SeparatorNode.parse({ parentId: levelId, start, end })
          : wall('curve_divider', start, end)
      const { index, level } = topology([...walls, divider])
      expect(level.rooms).toHaveLength(2)
      const spans = index.spansForWall(levelId, walls[0]!.id)
      const chordT = point.x / 4
      expect(spans).toHaveLength(2)
      expect(spans[0]).toMatchObject({ face: 'a', t0: 0 })
      expect(spans[0]!.t1).toBeCloseTo(chordT, 12)
      expect(spans[1]!.t0).toBeCloseTo(chordT, 12)
      expect(spans[1]).toMatchObject({ face: 'a', t1: 1 })
      const dividerSpans = index.spansForWall(levelId, divider.id)
      expect(dividerSpans).toHaveLength(2)
      expect(new Set(dividerSpans.map((span) => span.roomId)).size).toBe(2)
      expect(index.roomForWallHit(levelId, divider.id, 'a', 0.5)).toBe(
        index.roomAtPoint(levelId, [1, 2]),
      )
      expect(index.roomForWallHit(levelId, divider.id, 'b', 0.5)).toBe(
        index.roomAtPoint(levelId, [3, 2]),
      )
      const before = topology(walls).index
      before.applyWallDelta(
        levelId,
        new Set([divider.id]),
        scene(walls),
        scene([...walls, divider]),
      )
      expect(
        before.getLevelTopology(levelId)!.rooms.map(({ holes, spans }) => ({ holes, spans })),
      ).toEqual(level.rooms.map(({ holes, spans }) => ({ holes, spans })))
    }
  })

  test('exposure preparation is reused across plates and invalidated by topology revision', () => {
    const walls = rectangle()
    const { index, level } = topology(walls)
    const plate = plateFootprint(level.rooms)
    const otherPlate = union([
      [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
    ])
    const changed = walls.map((node, i) => (i === 0 ? { ...node, thickness: 0.6 } : node))
    index.applyWallDelta(levelId, new Set([walls[0]!.id]), scene(walls), scene(changed))
    const next = index.getLevelTopology(levelId)!
    const nextPlate = plateFootprint(next.rooms)
    const clip = spyOn(clipping, 'union')
    try {
      expect(exposedIntervals(plate, walls)).toEqual([])
      const calls = clip.mock.calls.length
      expect(calls).toBeGreaterThan(0)
      expect(exposedIntervals(plate, [...walls])).toEqual([])
      expect(exposedIntervals(otherPlate, level.rooms[0]!.context).length).toBeGreaterThan(0)
      expect(clip.mock.calls.length).toBe(calls)
      expect(exposedIntervals(nextPlate, next.rooms[0]!.context)).toEqual([])
      expect(clip.mock.calls.length).toBeGreaterThan(calls)
    } finally {
      clip.mockRestore()
    }
  })

  test('wall-array exposure cache follows geometry changes', () => {
    const plate = union([
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    ])
    const walls = [wall('cover_cache', [1, 0.1], [3, 0.1])]
    const first = exposedIntervals(plate, walls)
    expect(exposedIntervals(plate, walls)).toEqual(first)
    walls[0] = { ...walls[0]!, start: [0, 0.1], end: [4, 0.1] }
    expect(exposedIntervals(plate, walls).some((span) => span.edgeIndex === 0)).toBe(false)
  })
})

test('plate boundary wall coverage stops at the group spans while retaining corner miters', () => {
  const boundaries = [
    ...enclosure([
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ]),
    wall('divider_span', [4, 0], [4, 4]),
  ]
  const { level } = topology(boundaries)
  const left = level.rooms.find((room) =>
    containsPoint([{ outer: room.polygon, holes: room.holes }], [2, 2]),
  )!
  const plate = plateFootprint([left])
  expect(containsPoint(plate, [-0.09, -0.09])).toBe(true)
  expect(containsPoint(plate, [4.09, 2])).toBe(true)
  expect(containsPoint(plate, [6, 0])).toBe(false)
  expect(containsPoint(plate, [6, 4])).toBe(false)
  expect(Math.max(...plate.flatMap((part) => part.outer.map(([x]) => x)))).toBeCloseTo(4.1)
})

test('near-terminal spans retain the stored miter instead of a perpendicular cut', () => {
  const boundaries = enclosure([
    [0, 0],
    [4, 0],
    [3, 3],
    [0, 3],
  ])
  const { level } = topology(boundaries)
  const original = level.rooms[0]!
  const room = {
    ...original,
    id: `${original.id}-snapped`,
    spans: original.spans.map((span) => ({
      ...span,
      t0: span.t0 === 0 ? 0.001 : span.t0,
      t1: span.t1 === 1 ? 0.999 : span.t1,
    })),
  }
  const plate = plateFootprint([room])
  for (const footprint of original.context.wallFootprints.values())
    expect(area(difference(footprint, plate))).toBeLessThan(1e-6)
})

test('a T-stem snapped into its host keeps support to the host near face', () => {
  const boundaries = [
    wall('host_near', [-2, 0], [4, 0], { thickness: 0.4 }),
    wall('right_near', [4, 0], [4, 3]),
    wall('top_near', [4, 3], [0, 3]),
    wall('stem_near', [0, 3], [0, 0.05]),
  ]
  const { level } = topology(boundaries)
  expect(level.rooms).toHaveLength(1)
  const plate = plateFootprint(level.rooms)
  expect(containsPoint(plate, [0.09, 0.2])).toBe(true)
  expect(containsPoint(plate, [-0.09, 0.2])).toBe(true)
  expect(containsPoint(plate, [-1, 0])).toBe(false)
})
