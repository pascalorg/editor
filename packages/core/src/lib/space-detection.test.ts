import { describe, expect, test } from 'bun:test'
import { CeilingNode, SlabNode, WallNode } from '../schema'
import {
  detectSpacesForLevel,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  wallClosesRoom,
} from './space-detection'

const square: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

function roomPolygon() {
  return square.map(([x, y]) => ({ x, y }))
}

function squareWalls(height = 2.5) {
  return [
    WallNode.parse({ start: [0, 0], end: [4, 0], height }),
    WallNode.parse({ start: [4, 0], end: [4, 3], height }),
    WallNode.parse({ start: [4, 3], end: [0, 3], height }),
    WallNode.parse({ start: [0, 3], end: [0, 0], height }),
  ]
}

function slab(elevation: number) {
  return SlabNode.parse({
    polygon: square,
    elevation,
    autoFromWalls: true,
  })
}

describe('planAutoCeilingsForLevel', () => {
  test('creates auto ceilings at the top of the room walls', () => {
    const created = planAutoCeilingsForLevel([roomPolygon()], [], {
      walls: squareWalls(),
      slabs: [slab(0.05)],
    }).create[0]

    expect(created?.height).toBeCloseTo(2.55)
  })

  test('updates existing auto ceiling height when the slab elevation changes', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      height: 2.55,
      autoFromWalls: true,
    })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [ceiling], {
      walls: squareWalls(),
      slabs: [slab(0.4)],
    })

    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.id).toBe(ceiling.id)
    expect(plan.update[0]?.data.polygon).toBeUndefined()
    expect(plan.update[0]?.data.height).toBeCloseTo(2.9)
  })

  test('updates existing auto ceiling height when wall height changes', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      height: 2.55,
      autoFromWalls: true,
    })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [ceiling], {
      walls: squareWalls(3),
      slabs: [slab(0.05)],
    })

    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.data.height).toBeCloseTo(3.05)
  })

  test('does not replace a manual ceiling with an auto ceiling', () => {
    const manualCeiling = CeilingNode.parse({
      polygon: square,
      height: 2.5,
      autoFromWalls: false,
    })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [manualCeiling], {
      walls: squareWalls(),
      slabs: [slab(0.4)],
    })

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
  })

  test('demotes an orphaned auto ceiling to manual with its polygon untouched', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      height: 2.55,
      autoFromWalls: true,
    })

    const plan = planAutoCeilingsForLevel([], [ceiling])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.id).toBe(ceiling.id)
    // Ceilings render the stored polygon in both modes, so no polygon bake.
    expect(plan.update[0]?.data).toEqual({ autoFromWalls: false })
  })

  test('deletes an unmatched auto ceiling absorbed by a room merge', () => {
    const leftCeiling = CeilingNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: true,
    })
    const rightCeiling = CeilingNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      autoFromWalls: true,
    })
    const mergedRoom = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 0, y: 3 },
    ]

    const plan = planAutoCeilingsForLevel([mergedRoom], [leftCeiling, rightCeiling])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(1)
    const survivorId = plan.update[0]?.id
    expect([leftCeiling.id, rightCeiling.id]).toContain(plan.delete[0]!)
    expect(plan.delete[0]).not.toBe(survivorId)
  })

  test('a demoted ceiling suppresses re-creating an auto ceiling when the room re-forms', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      height: 2.55,
      autoFromWalls: true,
    })

    const demotion = planAutoCeilingsForLevel([], [ceiling]).update[0]
    const demoted = CeilingNode.parse({ ...ceiling, ...demotion?.data })
    expect(demoted.autoFromWalls).toBe(false)

    const plan = planAutoCeilingsForLevel([roomPolygon()], [demoted], {
      walls: squareWalls(),
      slabs: [slab(0.05)],
    })

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
  })
})

describe('detectSpacesForLevel', () => {
  const areaOf = (polygon: Array<{ x: number; y: number }>) => {
    let area = 0
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i]!
      const b = polygon[(i + 1) % polygon.length]!
      area += a.x * b.y - b.x * a.y
    }
    return Math.abs(area / 2)
  }

  test('detects an isolated four-wall room', () => {
    const walls = squareWalls()
    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', walls)
    expect(roomPolygons).toHaveLength(1)
    expect(spaces[0]?.wallIds.sort()).toEqual(walls.map((wall) => wall.id).sort())
    expect(spaces[0]?.boundaryFaces).toHaveLength(4)
    expect(
      spaces[0]?.boundaryFaces.map((boundary) => [boundary.wallId, boundary.face]).sort(),
    ).toEqual(walls.map((wall) => [wall.id, 'front']).sort())
  })

  test('detects a room closed against the middle of an existing wall (T-junction)', () => {
    // Big 6×5 room; a smaller room hangs below, its two verticals landing on the
    // interior of the big room's bottom wall (x=1 and x=3, not endpoints). Before
    // planarization those touch points were dangling nodes and the small room
    // was never detected.
    const walls = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 0], end: [6, 5] }),
      WallNode.parse({ start: [6, 5], end: [0, 5] }),
      WallNode.parse({ start: [0, 5], end: [0, 0] }),
      WallNode.parse({ start: [1, 0], end: [1, -2] }),
      WallNode.parse({ start: [1, -2], end: [3, -2] }),
      WallNode.parse({ start: [3, -2], end: [3, 0] }),
    ]

    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', walls)
    const areas = roomPolygons.map((poly) => areaOf(poly)).sort((a, b) => a - b)

    expect(roomPolygons).toHaveLength(2)
    expect(areas[0]).toBeCloseTo(4, 1) // small room: 2×2
    expect(areas[1]).toBeCloseTo(30, 1) // big room: 6×5

    const longWallId = walls[0]!.id
    const longWallBoundaries = spaces.flatMap((space) =>
      space.boundaryFaces.filter((boundary) => boundary.wallId === longWallId),
    )
    expect(longWallBoundaries).toHaveLength(4)
    expect(longWallBoundaries.filter((boundary) => boundary.face === 'back')).toHaveLength(1)
    expect(longWallBoundaries.filter((boundary) => boundary.face === 'front')).toHaveLength(3)
    expect(longWallBoundaries.map((boundary) => boundary.points)).toContainEqual([
      [1, 0],
      [3, 0],
    ])
  })
})

describe('wallClosesRoom', () => {
  test('is false while a chain is still open, true once it encloses a room', () => {
    const open = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
    ]
    const closing = WallNode.parse({ start: [0, 3], end: [0, 0] })

    expect(wallClosesRoom(open, closing)).toBe(false)
    expect(wallClosesRoom([...open, closing], closing)).toBe(true)
  })

  test('fires when a bay is sealed against the middle of an existing wall', () => {
    const bigRoom = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 0], end: [6, 5] }),
      WallNode.parse({ start: [6, 5], end: [0, 5] }),
      WallNode.parse({ start: [0, 5], end: [0, 0] }),
    ]
    const bayLeft = WallNode.parse({ start: [1, 0], end: [1, -2] })
    const bayBottom = WallNode.parse({ start: [1, -2], end: [3, -2] })
    const bayRight = WallNode.parse({ start: [3, -2], end: [3, 0] })

    // Two sides down and across: not enclosed yet.
    expect(wallClosesRoom([...bigRoom, bayLeft, bayBottom], bayBottom)).toBe(false)
    // The final side lands on the interior of the big room's bottom wall.
    expect(wallClosesRoom([...bigRoom, bayLeft, bayBottom, bayRight], bayRight)).toBe(true)
  })
})

describe('planAutoSlabsForLevel', () => {
  test('matches two identical rooms to their own existing auto-slabs without churn', () => {
    // Two rooms with identical polygon signatures previously collided in a
    // signature-keyed Map, so one detected room never matched an existing slab
    // and churned (delete + recreate) on every pass.
    const slabA = slab(0.05)
    const slabB = slab(0.05)

    const plan = planAutoSlabsForLevel([roomPolygon(), roomPolygon()], [slabA, slabB])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
  })

  test('deletes an extra auto-slab when only one identical room is detected', () => {
    const plan = planAutoSlabsForLevel([roomPolygon()], [slab(0.05), slab(0.05)])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(1)
  })

  test('demotes an orphaned auto slab to manual when its room disappears', () => {
    const painted = SlabNode.parse({
      polygon: square,
      elevation: 0.4,
      autoFromWalls: true,
    })

    const plan = planAutoSlabsForLevel([], [painted])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toHaveLength(1)

    const update = plan.update[0]
    expect(update?.id).toBe(painted.id)
    // Demotion flips only the flag — the stored polygon stays untouched
    // (render offsets derive from level context at geometry build time).
    expect(update?.data).toEqual({ autoFromWalls: false })
  })

  test('deletes an unmatched auto slab whose area was absorbed by a room merge', () => {
    const leftSlab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: true,
    })
    const rightSlab = SlabNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      autoFromWalls: true,
    })
    const mergedRoom = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 0, y: 3 },
    ]

    const plan = planAutoSlabsForLevel([mergedRoom], [leftSlab, rightSlab])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(1)
    expect(plan.update).toHaveLength(1)
    const survivorId = plan.update[0]?.id
    expect([leftSlab.id, rightSlab.id]).toContain(plan.delete[0]!)
    expect(plan.delete[0]).not.toBe(survivorId)
    // The survivor stays auto — updated to the merged polygon, not demoted.
    expect(plan.update[0]?.data.autoFromWalls).toBeUndefined()
  })

  test('a demoted slab suppresses re-creating an auto slab when the room re-forms', () => {
    const auto = slab(0.05)

    const demotion = planAutoSlabsForLevel([], [auto]).update[0]
    const demoted = SlabNode.parse({ ...auto, ...demotion?.data })
    expect(demoted.autoFromWalls).toBe(false)

    const plan = planAutoSlabsForLevel([roomPolygon()], [demoted])

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
  })

  test('manual slabs that split one room suppress a replacement full-room slab', () => {
    const left = SlabNode.parse({
      polygon: [
        [0, 0],
        [2, 0],
        [2, 3],
        [0, 3],
      ],
      autoFromWalls: false,
    })
    const right = SlabNode.parse({
      polygon: [
        [2, 0],
        [4, 0],
        [4, 3],
        [2, 3],
      ],
      autoFromWalls: false,
    })

    const plan = planAutoSlabsForLevel([roomPolygon()], [left, right])

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
  })
})
