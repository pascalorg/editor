import { describe, expect, test } from 'bun:test'
import {
  analyzePolygonGrid,
  collinearOverlapLength,
  isAxisAligned,
  longestExteriorEdge,
  longestSharedEdge,
  parseLayoutIntent,
  pointInPolygon,
  polygonArea,
  polygonSelfIntersects,
  sharedBoundaryLength,
  unionAdjacentPolygons,
} from './layout-plan'

function rect(x: number, z: number, w: number, d: number): Array<[number, number]> {
  return [
    [x, z],
    [x + w, z],
    [x + w, z + d],
    [x, z + d],
  ]
}

describe('parseLayoutIntent', () => {
  test('parses a clean intent', () => {
    const { intent, errors } = parseLayoutIntent(JSON.stringify({
      targetTotalAreaSqm: 75,
      rooms: [
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 14 },
        { id: 'living-1', name: '客厅', type: 'living' },
      ],
      adjacency: [{ a: 'bedroom-1', b: 'living-1' }],
    }))
    expect(errors).toEqual([])
    expect(intent?.targetTotalAreaSqm).toBe(75)
    expect(intent?.rooms).toHaveLength(2)
    expect(intent?.adjacency).toHaveLength(1)
  })

  test('tolerates code fences, prose, stringified numbers and case in type', () => {
    const raw = '好的，这是布局意图：\n```json\n'
      + JSON.stringify({
        targetTotalAreaSqm: '60',
        rooms: [{ name: '客厅厨房', type: 'Living Kitchen', targetAreaSqm: '30' }],
      })
      + '\n```\n请确认。'
    const { intent, errors } = parseLayoutIntent(raw)
    expect(errors).toEqual([])
    expect(intent?.targetTotalAreaSqm).toBe(60)
    expect(intent?.rooms[0]?.type).toBe('living_kitchen')
    expect(intent?.rooms[0]?.targetAreaSqm).toBe(30)
    expect(intent?.rooms[0]?.id).toBeTruthy()
  })

  test('renames duplicate room ids and reports the defect', () => {
    const { intent, errors } = parseLayoutIntent(JSON.stringify({
      targetTotalAreaSqm: 50,
      rooms: [
        { id: 'r', name: 'A', type: 'bedroom' },
        { id: 'r', name: 'B', type: 'bedroom' },
      ],
    }))
    expect(intent?.rooms.map(r => r.id)).toEqual(['r', 'r-2'])
    expect(errors.some(e => e.includes('重复'))).toBe(true)
  })

  test('rejects unknown room types but keeps the rest', () => {
    const { intent, errors } = parseLayoutIntent(JSON.stringify({
      targetTotalAreaSqm: 50,
      rooms: [
        { id: 'a', name: 'A', type: 'garage' },
        { id: 'b', name: 'B', type: 'bedroom' },
      ],
    }))
    expect(intent?.rooms).toHaveLength(1)
    expect(errors.some(e => e.includes('garage'))).toBe(true)
  })

  test('fails without a JSON object or without total area', () => {
    expect(parseLayoutIntent('没有任何 JSON').intent).toBeNull()
    expect(parseLayoutIntent(JSON.stringify({
      rooms: [{ id: 'a', name: 'A', type: 'bedroom' }],
    })).intent).toBeNull()
  })

  test('drops adjacency entries referencing unknown rooms', () => {
    const { intent, errors } = parseLayoutIntent(JSON.stringify({
      targetTotalAreaSqm: 50,
      rooms: [{ id: 'a', name: 'A', type: 'living' }],
      adjacency: [{ a: 'a', b: 'ghost' }],
    }))
    expect(intent?.adjacency).toBeUndefined()
    expect(errors.some(e => e.includes('adjacency'))).toBe(true)
  })
})

describe('geometry helpers', () => {
  test('polygonArea and pointInPolygon', () => {
    const poly = rect(1, 1, 4, 3)
    expect(polygonArea(poly)).toBeCloseTo(12)
    expect(pointInPolygon(2, 2, poly)).toBe(true)
    expect(pointInPolygon(0.5, 2, poly)).toBe(false)
  })

  test('isAxisAligned rejects diagonals and zero-length edges', () => {
    expect(isAxisAligned(rect(0, 0, 2, 2))).toBe(true)
    expect(isAxisAligned([[0, 0], [2, 1], [2, 2], [0, 2]])).toBe(false)
    expect(isAxisAligned([[0, 0], [0, 0], [2, 0], [2, 2], [0, 2]])).toBe(false)
  })

  test('collinearOverlapLength measures 1D overlap on the same line', () => {
    expect(collinearOverlapLength(
      { start: [0, 0], end: [5, 0] },
      { start: [3, 0], end: [8, 0] },
    )).toBeCloseTo(2)
    expect(collinearOverlapLength(
      { start: [0, 0], end: [5, 0] },
      { start: [3, 1], end: [8, 1] },
    )).toBe(0)
    // Looser epsilon accepts near-collinear scene walls.
    expect(collinearOverlapLength(
      { start: [0, 0], end: [5, 0] },
      { start: [3, 0.05], end: [8, 0.05] },
      0.06,
    )).toBeCloseTo(2)
  })

  test('sharedBoundaryLength / longestSharedEdge between adjacent rects', () => {
    const a = rect(0, 0, 4, 3)
    const b = rect(4, 0, 4, 3)
    expect(sharedBoundaryLength(a, b)).toBeCloseTo(3)
    const shared = longestSharedEdge(a, b)
    expect(shared.length).toBeCloseTo(3)
    expect(shared.midpoint[0]).toBeCloseTo(4)
    expect(shared.midpoint[1]).toBeCloseTo(1.5)
    expect(sharedBoundaryLength(a, rect(5, 0, 2, 2))).toBe(0)
  })

  test('longestExteriorEdge measures footprint boundary contact', () => {
    const footprint = { width: 8, depth: 6 }
    expect(longestExteriorEdge(rect(0, 0, 4, 3), footprint)).toBeCloseTo(4)
    expect(longestExteriorEdge(rect(2, 2, 2, 2), footprint)).toBe(0)
  })

  test('polygonSelfIntersects detects a bowtie', () => {
    expect(polygonSelfIntersects([[0, 0], [4, 4], [4, 0], [0, 4]])).toBe(true)
    expect(polygonSelfIntersects(rect(0, 0, 4, 4))).toBe(false)
    // L-shape is fine.
    expect(polygonSelfIntersects([[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]])).toBe(false)
  })

  test('analyzePolygonGrid reports union, overlap and pairs', () => {
    const grid = analyzePolygonGrid([
      { id: 'a', polygon: rect(0, 0, 4, 4) },
      { id: 'b', polygon: rect(3, 0, 4, 4) },
    ], { width: 8, depth: 4 })
    expect(grid.unionArea).toBeCloseTo(28)
    expect(grid.overlapArea).toBeCloseTo(4)
    expect(grid.overlapPairs.get('a|b')).toBeCloseTo(4)
  })

  test('analyzePolygonGrid on a perfect tiling has zero overlap and full union', () => {
    const grid = analyzePolygonGrid([
      { id: 'a', polygon: rect(0, 0, 4, 6) },
      { id: 'b', polygon: rect(4, 0, 4, 6) },
    ], { width: 8, depth: 6 })
    expect(grid.overlapArea).toBe(0)
    expect(grid.unionArea).toBeCloseTo(48)
  })
})

describe('unionAdjacentPolygons', () => {
  test('full shared edge merges into one rectangle', () => {
    const result = unionAdjacentPolygons(rect(0, 0, 2, 2), rect(2, 0, 2, 2))
    expect(result).not.toBeNull()
    expect(polygonArea(result!)).toBeCloseTo(8)
    expect(result!.length).toBe(4)
  })

  test('partial shared edge produces an L-shape', () => {
    const result = unionAdjacentPolygons(rect(0, 0, 2, 4), rect(2, 0, 2, 2))
    expect(result).not.toBeNull()
    expect(polygonArea(result!)).toBeCloseTo(12)
    expect(result!.length).toBe(6)
  })

  test('winding order of inputs does not matter', () => {
    const cw = [...rect(2, 0, 2, 2)].reverse() as Array<[number, number]>
    const result = unionAdjacentPolygons(rect(0, 0, 2, 2), cw)
    expect(result).not.toBeNull()
    expect(polygonArea(result!)).toBeCloseTo(8)
  })

  test('float-noise coordinates on the shared edge still merge', () => {
    const noisy: Array<[number, number]> = [[2 + 1e-12, 0], [4, 0], [4, 2], [2 + 1e-12, 2]]
    const result = unionAdjacentPolygons(rect(0, 0, 2, 2), noisy)
    expect(result).not.toBeNull()
    expect(polygonArea(result!)).toBeCloseTo(8)
  })

  test('sub-millimetre overlap is rejected, not bridged', () => {
    const overlapping: Array<[number, number]> = [[1.9996, 0], [4, 0], [4, 2], [1.9996, 2]]
    expect(unionAdjacentPolygons(rect(0, 0, 2, 2), overlapping)).toBeNull()
  })

  test('sub-millimetre gap is rejected, not bridged', () => {
    const gapped: Array<[number, number]> = [[2.0004, 0], [4, 0], [4, 2], [2.0004, 2]]
    expect(unionAdjacentPolygons(rect(0, 0, 2, 2), gapped)).toBeNull()
  })

  test('exact overlap is rejected', () => {
    expect(unionAdjacentPolygons(rect(0, 0, 3, 2), rect(2, 0, 2, 2))).toBeNull()
  })

  test('point contact is rejected', () => {
    expect(unionAdjacentPolygons(rect(0, 0, 2, 2), rect(2, 2, 2, 2))).toBeNull()
  })

  test('disjoint polygons are rejected', () => {
    expect(unionAdjacentPolygons(rect(0, 0, 2, 2), rect(5, 0, 2, 2))).toBeNull()
  })

  test('identical polygons are rejected', () => {
    expect(unionAdjacentPolygons(rect(0, 0, 2, 2), rect(0, 0, 2, 2))).toBeNull()
  })

  test('union that would enclose a hole is rejected', () => {
    // U-shaped polygon plus the rectangle that caps it — the union would
    // contain an interior hole, which is not a single simple polygon.
    const u: Array<[number, number]> = [
      [0, 0], [6, 0], [6, 4], [4, 4], [4, 2], [2, 2], [2, 4], [0, 4],
    ]
    expect(unionAdjacentPolygons(u, rect(2, 4, 2, 1))).toBeNull()
  })
})
