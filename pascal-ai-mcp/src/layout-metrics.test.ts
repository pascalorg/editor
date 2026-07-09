import { describe, expect, test } from 'bun:test'
import {
  ASPECT_RATIO_HARD,
  bandTableForTotalArea,
  classifyRoomKind,
  computeLayoutQuality,
  polygonArea,
  polygonAspectRatio,
  segmentsCoverSameLine,
  type MetricsWall,
  type MetricsZone,
} from './layout-metrics'

function rect(
  id: string,
  name: string,
  x: number,
  z: number,
  w: number,
  d: number,
): MetricsZone {
  return {
    id,
    name,
    polygon: [
      [x, z],
      [x + w, z],
      [x + w, z + d],
      [x, z + d],
    ],
  }
}

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  openings: Array<{ type: string }> = [],
): MetricsWall {
  return { id, start, end, openings }
}

// A well-formed 70㎡ two-bed used by several tests: entry door on the living
// room's exterior wall, interior doors connecting every room to the living
// room. 10m × 7m footprint.
//
//   z=7 ┌─────────┬────────┐
//       │ 卧室A 15 │ 卧室B 12 │
//   z=4 ├────┬────┴────────┤
//       │卫 6 │  客厅/餐厅 28  │
//       │厨 9 │              │
//   z=0 └────┴──────────────┘  (kitchen+bath stacked left, living right)
function goodTwoBed(): { zones: MetricsZone[]; walls: MetricsWall[] } {
  const zones = [
    rect('living', '客厅/餐厅', 3, 0, 7, 4), // 28
    rect('kitchen', '厨房', 0, 0, 3, 3), // 9
    rect('bath', '卫生间', 0, 3, 3, 2), // 6  (0,3)-(3,5)... adjust below
    rect('bedA', '卧室A', 0, 5, 5, 2), // placeholder, replaced below
  ]
  // Rebuild with a clean partition: living 3..10 × 0..4 (28), kitchen 0..3 ×
  // 0..3 (9), bath 0..3 × 3..7 is 12 — too big; use bath 0..3 × 3..5 (6) and
  // give 0..3 × 5..7 to bedroom A's ensuite? Keep it simple: four rooms that
  // tile 10×7 exactly.
  const tiled = [
    rect('living', '客厅/餐厅', 3, 0, 7, 4), // 28
    rect('kitchen', '厨房', 0, 0, 3, 4), // 12
    rect('bedA', '卧室A', 0, 4, 5, 3), // 15
    rect('bedB', '卧室B', 5, 4, 5, 3), // 15
  ]
  void zones
  const walls = [
    // Entry: door on living's exterior south wall (borders only one zone).
    wall('w-entry', [3, 0], [10, 0], [{ type: 'door' }]),
    // living <-> kitchen shared wall at x=3, z 0..4
    wall('w-lk', [3, 0], [3, 4], [{ type: 'door' }]),
    // living <-> bedB shared wall at z=4, x 5..10
    wall('w-lb2', [5, 4], [10, 4], [{ type: 'door' }]),
    // living <-> bedA shared wall at z=4, x 3..5
    wall('w-lb1', [3, 4], [5, 4], [{ type: 'door' }]),
    // Exterior windows (irrelevant to these metrics, present for realism).
    wall('w-north', [0, 7], [10, 7], [{ type: 'window' }]),
  ]
  return { zones: tiled, walls }
}

describe('classifyRoomKind', () => {
  test('mixed living/kitchen names resolve to living, not kitchen', () => {
    expect(classifyRoomKind('客厅/开放式厨房')).toBe('living')
    expect(classifyRoomKind('living + open kitchen')).toBe('living')
  })

  test('circulation wins over everything', () => {
    expect(classifyRoomKind('玄关')).toBe('circulation')
    expect(classifyRoomKind('走廊')).toBe('circulation')
  })

  test('plain rooms classify by keyword', () => {
    expect(classifyRoomKind('主卧室')).toBe('bedroom')
    expect(classifyRoomKind('厨房')).toBe('kitchen')
    expect(classifyRoomKind('卫生间')).toBe('bathroom')
    expect(classifyRoomKind('书房')).toBe('other')
  })
})

describe('geometry helpers', () => {
  test('polygonArea of a rectangle', () => {
    expect(polygonArea(rect('r', 'x', 0, 0, 4, 3).polygon)).toBe(12)
  })

  test('polygonAspectRatio of a 6x2 room is 3', () => {
    expect(polygonAspectRatio(rect('r', 'x', 0, 0, 6, 2).polygon)).toBe(3)
  })

  test('segmentsCoverSameLine matches partial collinear overlap', () => {
    expect(
      segmentsCoverSameLine(
        { start: [0, 0], end: [10, 0] },
        { start: [3, 0], end: [5, 0] },
      ),
    ).toBe(true)
  })

  test('segmentsCoverSameLine rejects parallel but offset segments', () => {
    expect(
      segmentsCoverSameLine(
        { start: [0, 0], end: [10, 0] },
        { start: [3, 1], end: [5, 1] },
      ),
    ).toBe(false)
  })

  test('segmentsCoverSameLine rejects collinear but disjoint segments', () => {
    expect(
      segmentsCoverSameLine(
        { start: [0, 0], end: [2, 0] },
        { start: [5, 0], end: [8, 0] },
      ),
    ).toBe(false)
  })
})

describe('bandTableForTotalArea', () => {
  test('tiers by total area', () => {
    expect(bandTableForTotalArea(45).bathroom).toEqual([2.5, 7])
    expect(bandTableForTotalArea(90).bathroom).toEqual([3, 9])
    expect(bandTableForTotalArea(200).bathroom).toEqual([3.5, 12])
  })
})

describe('computeLayoutQuality', () => {
  test('a well-formed two-bed scores high with no hard issues', () => {
    const { zones, walls } = goodTwoBed()
    const quality = computeLayoutQuality(zones, walls, { targetTotalAreaSqm: 70 })
    expect(quality.issues).toEqual([])
    expect(quality.entryIssues).toEqual([])
    expect(quality.score).toBeGreaterThanOrEqual(90)
    expect(quality.totalAreaSqm).toBe(70)
    expect(quality.totalAreaDeviation?.ratio ?? 0).toBeLessThan(0.01)
  })

  test('oversized bathroom in a medium flat is a hard finding (case-03 class)', () => {
    // 90㎡ flat with a 16㎡ bathroom: medium band is 3–9, hard above 14.4.
    const zones = [
      rect('living', '客厅', 0, 0, 8, 5), // 40
      rect('bath', '卫生间', 8, 0, 4, 4), // 16
      rect('bedA', '卧室A', 0, 5, 6, 4), // 24
      rect('kit', '厨房', 8, 4, 4, 2.5), // 10
    ]
    const quality = computeLayoutQuality(zones, [])
    const bathFinding = quality.roomAreaFindings.find(f => f.kind === 'bathroom')
    expect(bathFinding?.severity).toBe('hard')
    expect(quality.issues.some(issue => issue.includes('卫生间') && issue.includes('过大'))).toBe(true)
  })

  test('sliver kitchen is a hard aspect finding (case-06 class)', () => {
    const zones = [
      rect('living', '客厅', 0, 0, 6, 6), // 36
      rect('kit', '厨房', 6, 0, 1.5, 6), // 9㎡ but 4:1
    ]
    const quality = computeLayoutQuality(zones, [])
    const kitchenAspect = quality.aspectFindings.find(f => f.room === '厨房')
    expect(kitchenAspect?.severity).toBe('hard')
    expect(kitchenAspect!.ratio).toBeGreaterThan(ASPECT_RATIO_HARD)
    expect(quality.issues.some(issue => issue.includes('厨房') && issue.includes('狭长'))).toBe(true)
  })

  test('corridor eating the flat trips the circulation hard limit', () => {
    // Corridor 12 of 40㎡ total = 30% > 25% hard limit.
    const zones = [
      rect('hall', '走廊', 0, 0, 12, 1), // 12
      rect('bedA', '卧室A', 0, 1, 6, 2.4), // 14.4
      rect('bedB', '卧室B', 6, 1, 6, 2.4), // 14.4
    ]
    const quality = computeLayoutQuality(zones, [])
    expect(quality.circulation.ratio).toBeGreaterThan(0.25)
    expect(quality.issues.some(issue => issue.includes('通行空间'))).toBe(true)
    // Corridors themselves are exempt from the aspect check.
    expect(quality.aspectFindings.find(f => f.room === '走廊')).toBeUndefined()
  })

  test('total-area deviation lowers score but never emits an issue', () => {
    // 105㎡ built vs 70 target: 50% over (case-03's original failure), but
    // total-area repair guidance is owned by checkAreaRequirements.
    const zones = [
      rect('living', '客厅', 0, 0, 10.5, 5), // 52.5
      rect('bedA', '卧室A', 0, 5, 5.25, 4), // 21
      rect('bedB', '卧室B', 5.25, 5, 5.25, 4), // 21
      rect('kit', '厨房', 10.5, 0, 2.1, 5), // 10.5
    ]
    const quality = computeLayoutQuality(zones, [], { targetTotalAreaSqm: 70 })
    expect(quality.totalAreaDeviation!.ratio).toBeGreaterThan(0.4)
    expect(quality.issues.some(issue => issue.includes('总面积'))).toBe(false)
    const onTarget = computeLayoutQuality(zones, [], { targetTotalAreaSqm: 105 })
    expect(quality.score).toBeLessThan(onTarget.score)
  })

  test('missing entry door is a hard issue', () => {
    const { zones, walls } = goodTwoBed()
    const interiorOnly = walls.filter(w => w.id !== 'w-entry')
    const quality = computeLayoutQuality(zones, interiorOnly)
    expect(quality.entryIssues.length).toBe(1)
    expect(quality.entryIssues[0]).toContain('入户门')
  })

  test('room connected to nothing reachable from entry is flagged', () => {
    const { zones, walls } = goodTwoBed()
    // bedB's door now connects bedA<->bedB instead of living<->bedB: bedB is
    // reachable only through bedA... which still reaches living. Instead cut
    // bedB off entirely: its only door is on a wall bordering just bedB and
    // bedA, and bedA loses its living-room door.
    const cutOff = walls
      .filter(w => w.id !== 'w-lb1' && w.id !== 'w-lb2')
      .concat([wall('w-ab', [5, 4], [5, 7], [{ type: 'door' }])])
    const quality = computeLayoutQuality(zones, cutOff)
    expect(quality.entryIssues.some(issue => issue.includes('无法到达'))).toBe(true)
  })

  test('doorless rooms are not double-flagged here', () => {
    const { zones, walls } = goodTwoBed()
    // Remove bedB's door entirely: findDoorlessRooms owns that case.
    const withoutBedBDoor = walls.filter(w => w.id !== 'w-lb2')
    const quality = computeLayoutQuality(zones, withoutBedBDoor)
    expect(quality.entryIssues.some(issue => issue.includes('卧室B'))).toBe(false)
  })

  test('empty scene yields a neutral result', () => {
    const quality = computeLayoutQuality([], [])
    expect(quality.score).toBe(100)
    expect(quality.issues).toEqual([])
    expect(quality.totalAreaDeviation).toBeNull()
  })
})
