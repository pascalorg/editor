import { describe, expect, test } from 'bun:test'
import {
  AnyNode,
  type AnyNodeId,
  BuildingNode,
  CeilingNode,
  ColumnNode,
  DEFAULT_UNIT_COLOR,
  HvacEquipmentNode,
  ImportedMeshNode,
  LevelNode,
  ShelfNode,
  SiteNode,
  SlabNode,
  UnitNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { detectSpacesForLevel } from './space-detection'
import { deriveUnit, unassignedZoneIds, unitsForZone, unitWarnings } from './unit-containment'

function rectangle(x = 0, z = 0, width = 4, depth = 4): [number, number][] {
  return [
    [x, z],
    [x + width, z],
    [x + width, z + depth],
    [x, z + depth],
  ]
}

function scene() {
  const site = SiteNode.parse({})
  const building = BuildingNode.parse({ parentId: site.id })
  const lower = LevelNode.parse({ parentId: building.id, level: 0 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1 })
  const nodes: Record<AnyNodeId, AnyNode> = {}
  const add = <T extends AnyNode>(node: T): T => {
    nodes[node.id] = node
    return node
  }
  for (const node of [site, building, lower, upper]) add(node)
  const zone = (level = lower, polygon = rectangle(), name = 'Room') =>
    add(ZoneNode.parse({ parentId: level.id, name, polygon }))
  const unit = (members: ZoneNode[], name = 'Unit') =>
    add(
      UnitNode.parse({ parentId: building.id, name, members: members.map((member) => member.id) }),
    )
  return { site, building, lower, upper, nodes, add, zone, unit }
}

describe('unit schema', () => {
  test('round trips defaults through the node union and building children', () => {
    const unit = UnitNode.parse({})
    expect(unit.name).toBe('Unit')
    expect(unit.kind).toBe('apartment')
    expect(unit.color).toBe(DEFAULT_UNIT_COLOR)
    expect(unit.members).toEqual([])
    expect(AnyNode.parse(JSON.parse(JSON.stringify(unit)))).toEqual(unit)
    expect(BuildingNode.parse({ children: [unit.id] }).children).toEqual([unit.id])
  })
})

describe('deriveUnit', () => {
  test('derives a duplex across levels sorted by ordinal and keeps its hierarchy visible', () => {
    const s = scene()
    const downstairs = s.zone()
    const upstairs = s.zone(s.upper)
    const unit = s.unit([upstairs, downstairs])
    const column = s.add(ColumnNode.parse({ parentId: s.lower.id, position: [1, 0, 1] }))
    const shelf = s.add(ShelfNode.parse({ parentId: s.upper.id, position: [4, 0, 2] }))
    const hvac = s.add(HvacEquipmentNode.parse({ parentId: s.upper.id, position: [2, 0, 2] }))
    const outside = s.add(ColumnNode.parse({ parentId: s.lower.id, position: [8, 0, 8] }))
    const slab = s.add(SlabNode.parse({ parentId: s.lower.id, polygon: rectangle(-1, -1, 6, 6) }))
    const ceiling = s.add(CeilingNode.parse({ parentId: s.upper.id, polygon: rectangle(3, 3) }))
    const before = structuredClone(s.nodes)

    const result = deriveUnit(unit, s.nodes)

    expect(result.levelIds).toEqual([s.lower.id, s.upper.id])
    expect(result.memberZoneIds).toEqual([upstairs.id, downstairs.id])
    expect(new Set(result.containedNodeIds)).toEqual(new Set([column.id, shelf.id, hvac.id]))
    expect(result.supportIds).toEqual([slab.id, ceiling.id])
    expect(result.visibleNodeIds).not.toContain(s.site.id)
    expect(result.visibleNodeIds).not.toContain(s.building.id)
    expect(result.visibleNodeIds).not.toContain(unit.id)
    expect(result.visibleNodeIds).not.toContain(s.lower.id)
    expect(result.visibleNodeIds).not.toContain(outside.id)
    expect(new Set(result.visibleNodeIds).size).toBe(result.visibleNodeIds.length)
    expect(s.nodes).toEqual(before)
  })

  test('lists a party wall for both neighboring units', () => {
    const s = scene()
    const left = s.unit([s.zone()])
    const right = s.unit([s.zone(s.lower, rectangle(4, 0))])
    const wall = s.add(WallNode.parse({ parentId: s.lower.id, start: [4, 0], end: [4, 4] }))
    expect(deriveUnit(left, s.nodes).boundaryWallIds).toEqual([wall.id])
    expect(deriveUnit(right, s.nodes).boundaryWallIds).toEqual([wall.id])
  })

  test('contains a balcony without walls and drops dangling member ids', () => {
    const s = scene()
    const balcony = s.zone(s.upper, rectangle(10, 0, 3, 2), 'Balcony')
    const unit = s.unit([balcony])
    unit.members.push('zone_missing')
    const mesh = s.add(ImportedMeshNode.parse({ parentId: s.upper.id, position: [11, 0, 1] }))
    const result = deriveUnit(unit, s.nodes)
    expect(result.memberZoneIds).toEqual([balcony.id])
    expect(result.containedNodeIds).toEqual([mesh.id])
    expect(result.boundaryWallIds).toEqual([])
  })

  test('keeps kitchen and living zones as two members of one detected room', () => {
    const s = scene()
    const polygon = rectangle(0, 0, 8, 4)
    const walls = polygon.map((start, index) =>
      s.add(
        WallNode.parse({ parentId: s.lower.id, start, end: polygon[(index + 1) % polygon.length] }),
      ),
    )
    const kitchen = s.zone(s.lower, rectangle(), 'Kitchen')
    const living = s.zone(s.lower, rectangle(4, 0), 'Living')
    const unit = s.unit([kitchen, living])
    const result = deriveUnit(unit, s.nodes)
    expect(detectSpacesForLevel(s.lower.id, walls).rooms).toHaveLength(1)
    expect(result.memberZoneIds).toEqual([kitchen.id, living.id])
    expect(new Set(result.boundaryWallIds)).toEqual(new Set(walls.map((wall) => wall.id)))
  })

  test('adopts the walls of the detected room that encloses a zone drawn short of them', () => {
    const s = scene()
    const polygon = rectangle(0, 0, 8, 6)
    const walls = polygon.map((start, index) =>
      s.add(
        WallNode.parse({ parentId: s.lower.id, start, end: polygon[(index + 1) % polygon.length] }),
      ),
    )
    const farWall = s.add(WallNode.parse({ parentId: s.lower.id, start: [20, 0], end: [24, 0] }))
    const inset = s.zone(s.lower, rectangle(1, 1, 6, 4), 'Inset')
    const result = deriveUnit(s.unit([inset]), s.nodes)
    expect(new Set(result.boundaryWallIds)).toEqual(new Set(walls.map((wall) => wall.id)))
    expect(result.boundaryWallIds).not.toContain(farWall.id)
  })

  test('resolves auto zones from current walls instead of the stored polygon', () => {
    const s = scene()
    const polygon = rectangle()
    const walls = polygon.map((start, index) =>
      s.add(
        WallNode.parse({ parentId: s.lower.id, start, end: polygon[(index + 1) % polygon.length] }),
      ),
    )
    const zone = s.add(
      ZoneNode.parse({
        name: 'Auto',
        parentId: s.lower.id,
        polygon: rectangle(20, 20),
        autoFromWalls: true,
        boundaryWallIds: walls.map((wall) => wall.id),
      }),
    )
    const column = s.add(ColumnNode.parse({ parentId: s.lower.id, position: [2, 0, 2] }))
    expect(deriveUnit(s.unit([zone]), s.nodes).containedNodeIds).toEqual([column.id])
  })

  test('finds crossing supports and excludes holes and supports on other levels', () => {
    const s = scene()
    const unit = s.unit([s.zone(s.lower, rectangle(-2, -0.5, 4, 1))])
    const crossing = s.add(
      SlabNode.parse({ parentId: s.lower.id, polygon: rectangle(-0.5, -2, 1, 4) }),
    )
    s.add(
      SlabNode.parse({
        parentId: s.lower.id,
        polygon: rectangle(-5, -5, 10, 10),
        holes: [rectangle(-3, -3, 6, 6)],
      }),
    )
    s.add(CeilingNode.parse({ parentId: s.upper.id, polygon: rectangle(-5, -5, 10, 10) }))
    expect(deriveUnit(unit, s.nodes).supportIds).toEqual([crossing.id])
  })
})

describe('unit membership and warnings', () => {
  test('finds every referencing unit and only unassigned zones in the building', () => {
    const s = scene()
    const shared = s.zone()
    const common = s.zone(s.upper)
    const first = s.unit([shared])
    const second = s.unit([shared])
    s.add(ZoneNode.parse({ parentId: 'level_elsewhere', name: 'Elsewhere', polygon: rectangle() }))
    expect(unitsForZone(shared.id, s.nodes)).toEqual([first, second])
    expect(unassignedZoneIds(s.building.id, s.nodes)).toEqual([common.id])
    expect(unitWarnings(first, s.nodes)).toEqual([{ code: 'shared-zone', zoneId: shared.id }])
  })

  test('warns for empty and non-adjacent levels, allowing adjacent duplexes', () => {
    const s = scene()
    const empty = s.unit([])
    empty.members.push('zone_missing')
    expect(unitWarnings(empty, s.nodes)).toEqual([{ code: 'empty' }])
    const unit = s.unit([s.zone(), s.zone(s.upper)])
    expect(unitWarnings(unit, s.nodes)).toEqual([])
    s.nodes[s.upper.id] = { ...s.upper, level: 3 }
    expect(unitWarnings(unit, s.nodes)).toEqual([{ code: 'non-adjacent-levels' }])
  })
})
