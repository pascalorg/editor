import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, LevelNode, UnitNode, WallNode, ZoneNode } from '../schema'
import { buildUnitReport } from './unit-report'

describe('buildUnitReport', () => {
  test('sums unsigned member areas and reports a duplex level span', () => {
    const lower = LevelNode.parse({ level: -1 })
    const upper = LevelNode.parse({ level: 1 })
    const kitchen = ZoneNode.parse({
      name: 'Kitchen',
      parentId: lower.id,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 3],
        [0, 3],
      ],
    })
    const living = ZoneNode.parse({
      name: 'Living',
      parentId: lower.id,
      polygon: [
        [2, 0],
        [2, 3],
        [6, 3],
        [6, 0],
      ],
    })
    const balcony = ZoneNode.parse({
      name: 'Balcony',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    const unit = UnitNode.parse({ members: [balcony.id, kitchen.id, living.id, 'zone_missing'] })
    const nodes: Record<AnyNodeId, AnyNode> = Object.fromEntries(
      [lower, upper, kitchen, living, balcony, unit].map((node) => [node.id, node]),
    )
    const before = structuredClone(nodes)
    expect(buildUnitReport(unit, nodes)).toEqual({
      memberCount: 3,
      levelSpan: { minOrdinal: -1, maxOrdinal: 1, count: 2 },
      grossAreaM2: 22,
      members: [
        { zoneId: balcony.id, name: 'Balcony', levelId: upper.id, levelOrdinal: 1, areaM2: 4 },
        { zoneId: kitchen.id, name: 'Kitchen', levelId: lower.id, levelOrdinal: -1, areaM2: 6 },
        { zoneId: living.id, name: 'Living', levelId: lower.id, levelOrdinal: -1, areaM2: 12 },
      ],
    })
    expect(nodes).toEqual(before)
  })

  test('reports empty units without a level span', () => {
    expect(buildUnitReport(UnitNode.parse({ members: ['zone_missing'] }), {})).toEqual({
      memberCount: 0,
      levelSpan: null,
      grossAreaM2: 0,
      members: [],
    })
  })

  test('retains orphaned members and counts repeated ids once', () => {
    const zone = ZoneNode.parse({ name: 'Orphan', polygon: [] })
    const report = buildUnitReport(UnitNode.parse({ members: [zone.id, zone.id] }), {
      [zone.id]: zone,
    })
    expect(report.memberCount).toBe(1)
    expect(report.levelSpan).toBeNull()
    expect(report.members[0]).toEqual({
      zoneId: zone.id,
      name: 'Orphan',
      levelId: null,
      levelOrdinal: null,
      areaM2: 0,
    })
  })

  test('measures the resolved auto zone polygon', () => {
    const level = LevelNode.parse({ level: 0 })
    const polygon: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const walls = polygon.map((start, index) =>
      WallNode.parse({ parentId: level.id, start, end: polygon[(index + 1) % polygon.length] }),
    )
    const zone = ZoneNode.parse({
      name: 'Auto',
      parentId: level.id,
      autoFromWalls: true,
      boundaryWallIds: walls.map((wall) => wall.id),
      polygon: [],
    })
    const nodes: Record<AnyNodeId, AnyNode> = Object.fromEntries(
      [level, zone, ...walls].map((node) => [node.id, node]),
    )
    const report = buildUnitReport(UnitNode.parse({ members: [zone.id] }), nodes)
    expect(report.grossAreaM2).toBeCloseTo(12)
  })
})
