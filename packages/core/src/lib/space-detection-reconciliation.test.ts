import { describe, expect, test } from 'bun:test'
import { CeilingNode, SlabNode, WallNode } from '../schema'
import {
  detectSpacesForLevel,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  surfaceTouchesRooms,
} from './space-detection'

type Tuple = [number, number]

function bounded(polygon: Tuple[]) {
  return {
    polygon: polygon.map(([x, y]) => ({ x, y })),
    bbox: {
      minX: Math.min(...polygon.map(([x]) => x)),
      minY: Math.min(...polygon.map(([, y]) => y)),
      maxX: Math.max(...polygon.map(([x]) => x)),
      maxY: Math.max(...polygon.map(([, y]) => y)),
    },
  }
}

function rectangle(x: number, y: number, width: number, height: number): Tuple[] {
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ]
}

describe('surfaceTouchesRooms bounding-box rejection', () => {
  const surface = bounded(rectangle(0, 0, 4, 4))
  const cases: Array<[string, Tuple[], boolean]> = [
    ['disjoint right', rectangle(5, 0, 4, 4), false],
    ['disjoint left', rectangle(-5, 0, 4, 4), false],
    ['disjoint above', rectangle(0, 5, 4, 4), false],
    ['disjoint below', rectangle(0, -5, 4, 4), false],
    ['touching edge', rectangle(4, 0, 4, 4), false],
    ['touching corner', rectangle(4, 4, 4, 4), false],
    ['overlapping', rectangle(2, 2, 4, 4), true],
    ['contained room', rectangle(1, 1, 2, 2), true],
    ['contained surface', rectangle(-1, -1, 6, 6), true],
    ['identical', rectangle(0, 0, 4, 4), true],
    [
      'overlapping bounds without polygon coverage',
      [
        [3, 6],
        [6, 3],
        [6, 6],
      ],
      false,
    ],
  ]

  for (const [name, polygon, expected] of cases) {
    test(name, () => {
      const room = bounded(polygon)
      expect(surfaceTouchesRooms(surface, [room])).toBe(expected)
      expect(surfaceTouchesRooms(room, [surface])).toBe(expected)
    })
  }

  test('disjoint bounds skip coverage and touching bounds retain coverage', () => {
    for (const x of [4, 5]) {
      const room = bounded(rectangle(x, 0, 4, 4))
      let reads = 0
      const measuredRoom = {
        bbox: room.bbox,
        get polygon() {
          reads += 1
          return room.polygon
        },
      }
      expect(surfaceTouchesRooms(surface, [measuredRoom])).toBe(false)
      expect(reads > 0).toBe(x === 4)
    }
  })

  test('continues past disjoint rooms and handles no rooms', () => {
    expect(surfaceTouchesRooms(surface, [])).toBe(false)
    expect(surfaceTouchesRooms(surface, [bounded(rectangle(5, 5, 1, 1)), surface])).toBe(true)
  })
})

describe('auto surface planner ring preservation', () => {
  const vertices = rectangle(0, 0, 4, 3)
  const walls = vertices.map((start, index) =>
    WallNode.parse({ start, end: vertices[(index + 1) % vertices.length] }),
  )
  const { roomPolygons } = detectSpacesForLevel('level_rotation', walls)
  const ring = roomPolygons[0]!.map(({ x, y }): Tuple => [x, y])

  for (const kind of ['slab', 'ceiling'] as const) {
    function plan(polygon: Tuple[]) {
      if (kind === 'slab') {
        const surface = SlabNode.parse({ polygon, autoFromWalls: true })
        return { surface, result: planAutoSlabsForLevel(roomPolygons, [surface]) }
      }
      const surface = CeilingNode.parse({ polygon, autoFromWalls: true })
      return { surface, result: planAutoCeilingsForLevel(roomPolygons, [surface]) }
    }

    test(`${kind}: every exact start rotation preserves the existing polygon`, () => {
      for (let offset = 0; offset < ring.length; offset += 1) {
        const polygon = [...ring.slice(offset), ...ring.slice(0, offset)]
        const { surface, result } = plan(polygon)
        const existingPolygon = surface.polygon
        expect(result.update).toEqual([])
        expect(result.create).toEqual([])
        expect(result.delete).toEqual([])
        expect(surface.polygon).toBe(existingPolygon)
        expect(surface.polygon).toEqual(polygon)
      }
    })

    test(`${kind}: changed geometry still updates even within signature rounding`, () => {
      for (const delta of [0.2, 0.00001]) {
        const polygon = ring.map(([x, y]): Tuple => [x, y])
        polygon[0]![0] += delta
        const { surface, result } = plan(polygon)
        expect(result.update).toEqual([{ id: surface.id, data: { polygon: ring } }])
        expect(result.create).toEqual([])
        expect(result.delete).toEqual([])
      }
    })

    test(`${kind}: reversed winding still updates`, () => {
      const { surface, result } = plan([...ring].reverse())
      expect(result.update).toEqual([{ id: surface.id, data: { polygon: ring } }])
      expect(result.create).toEqual([])
      expect(result.delete).toEqual([])
    })
  }
})
