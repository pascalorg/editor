import type {
  AnyNode,
  AnyNodeId,
  BuildingNode,
  LevelNode,
  UnitNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { pointOnPolygonBoundary, wallOverlapsSlabFootprint } from '../systems/slab/slab-support'
import { measurementCentroid } from './measurement-geometry'
import { type Point2D, pointInPolygon } from './polygon-relations'
import { detectSpacesForLevel, resolveAutoZonePolygon } from './space-detection'

export type UnitDerivation = {
  unitId: UnitNode['id']
  memberZoneIds: ZoneNode['id'][]
  levelIds: LevelNode['id'][]
  containedNodeIds: AnyNodeId[]
  boundaryWallIds: WallNode['id'][]
  supportIds: AnyNodeId[]
  visibleNodeIds: AnyNodeId[]
}

type Nodes = Readonly<Record<AnyNodeId, AnyNode>>

function footprintCentroid(node: AnyNode): Point2D | null {
  if ('position' in node && Array.isArray(node.position) && node.position.length === 3) {
    return [node.position[0], node.position[2]]
  }
  if ('polygon' in node && Array.isArray(node.polygon)) {
    const centroid = measurementCentroid(node.polygon.map(([x, z]) => [x, 0, z]))
    return centroid ? [centroid[0], centroid[2]] : null
  }
  return null
}

function polygonCentroid(polygon: Point2D[]): Point2D | null {
  if (polygon.length < 3) return null
  const centroid = measurementCentroid(polygon.map(([x, z]) => [x, 0, z]))
  return centroid ? [centroid[0], centroid[2]] : null
}

function coversPoint(point: Point2D, polygon: Point2D[], holes: Point2D[][] = []): boolean {
  return (
    polygon.length >= 3 &&
    (pointInPolygon(point, polygon) || pointOnPolygonBoundary(point[0], point[1], polygon)) &&
    !holes.some(
      (hole) =>
        pointInPolygon(point, hole, { includeBoundary: false }) &&
        !pointOnPolygonBoundary(point[0], point[1], hole),
    )
  )
}

function overlapsSupport(polygon: Point2D[], support: { polygon: Point2D[]; holes: Point2D[][] }) {
  if (polygon.length < 3 || support.polygon.length < 3) return false
  return (
    polygon.some((point) => coversPoint(point, support.polygon, support.holes)) ||
    support.polygon.some((point) => coversPoint(point, polygon)) ||
    polygon.some((start, index) =>
      wallOverlapsSlabFootprint(
        { start, end: polygon[(index + 1) % polygon.length]!, thickness: 0 },
        support.polygon,
        support.holes,
      ),
    )
  )
}

export function deriveUnit(unit: UnitNode, nodes: Nodes): UnitDerivation {
  const members = [...new Set(unit.members)].flatMap((id) => {
    const zone = nodes[id]
    return zone?.type === 'zone' ? [zone] : []
  })
  const levels = new Map<LevelNode['id'], LevelNode>()
  const polygonsByLevel = new Map<LevelNode['id'], Point2D[][]>()
  for (const zone of members) {
    const level = zone.parentId ? nodes[zone.parentId as AnyNodeId] : undefined
    if (level?.type !== 'level') continue
    levels.set(level.id, level)
    const polygons = polygonsByLevel.get(level.id) ?? []
    polygons.push(resolveAutoZonePolygon(zone, (id) => nodes[id]))
    polygonsByLevel.set(level.id, polygons)
  }
  const levelIds = [...levels.values()]
    .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))
    .map((level) => level.id)
  const containedNodeIds: AnyNodeId[] = []
  const boundaryWalls = new Set<WallNode['id']>()
  const supportIds: AnyNodeId[] = []
  const wallsByLevel = new Map<LevelNode['id'], WallNode[]>()
  for (const node of Object.values(nodes)) {
    const polygons = node.parentId
      ? polygonsByLevel.get(node.parentId as LevelNode['id'])
      : undefined
    if (!polygons) continue
    if (node.type === 'wall') {
      const levelId = node.parentId as LevelNode['id']
      wallsByLevel.set(levelId, [...(wallsByLevel.get(levelId) ?? []), node])
      if (
        polygons.some((polygon) => polygon.length >= 3 && wallOverlapsSlabFootprint(node, polygon))
      ) {
        boundaryWalls.add(node.id)
      }
    } else if (node.type === 'slab' || node.type === 'ceiling') {
      if (polygons.some((polygon) => overlapsSupport(polygon, node))) supportIds.push(node.id)
    } else if (
      node.type !== 'zone' &&
      node.type !== 'level' &&
      node.type !== 'building' &&
      node.type !== 'site' &&
      node.type !== 'unit'
    ) {
      const point = footprintCentroid(node)
      if (point && polygons.some((polygon) => coversPoint(point, polygon)))
        containedNodeIds.push(node.id)
    }
  }
  // A zone drawn inside a room, short of the wall centerlines, still means
  // that room: the walls of every detected space that encloses a member
  // centroid, or whose own centroid the member encloses, are boundary walls.
  for (const [levelId, walls] of wallsByLevel) {
    const polygons = polygonsByLevel.get(levelId) ?? []
    for (const space of detectSpacesForLevel(levelId, walls).spaces) {
      if (space.isExterior) continue
      const spaceCentroid = polygonCentroid(space.polygon)
      const matches = polygons.some((polygon) => {
        const memberCentroid = polygonCentroid(polygon)
        return (
          (memberCentroid !== null && coversPoint(memberCentroid, space.polygon)) ||
          (spaceCentroid !== null && coversPoint(spaceCentroid, polygon))
        )
      })
      if (matches) for (const wallId of space.wallIds) boundaryWalls.add(wallId)
    }
  }
  const boundaryWallIds = [...boundaryWalls]
  const memberZoneIds = members.map((zone) => zone.id)
  // Ancestors (levels, building, site, the unit itself) are left out: the
  // viewer's isolation filter keeps every descendant of a listed id, so
  // listing a level would show the whole storey.
  const visible = new Set<AnyNodeId>([
    ...memberZoneIds,
    ...containedNodeIds,
    ...boundaryWallIds,
    ...supportIds,
  ])
  return {
    unitId: unit.id,
    memberZoneIds,
    levelIds,
    containedNodeIds,
    boundaryWallIds,
    supportIds,
    visibleNodeIds: [...visible],
  }
}

export function unitsForZone(zoneId: ZoneNode['id'], nodes: Nodes): UnitNode[] {
  return Object.values(nodes).filter(
    (node): node is UnitNode => node.type === 'unit' && node.members.includes(zoneId),
  )
}

export function unassignedZoneIds(buildingId: BuildingNode['id'], nodes: Nodes): ZoneNode['id'][] {
  const assigned = new Set(
    Object.values(nodes).flatMap((node) => (node.type === 'unit' ? node.members : [])),
  )
  const building = nodes[buildingId]
  if (building?.type !== 'building') return []
  const levels = new Set(
    Object.values(nodes).flatMap((node) =>
      node.type === 'level' && (node.parentId === buildingId || building.children.includes(node.id))
        ? [node.id]
        : [],
    ),
  )
  return Object.values(nodes).flatMap((node) =>
    node.type === 'zone' &&
    node.parentId &&
    levels.has(node.parentId as LevelNode['id']) &&
    !assigned.has(node.id)
      ? [node.id]
      : [],
  )
}

export function unitWarnings(
  unit: UnitNode,
  nodes: Nodes,
): Array<{
  code: 'empty' | 'non-adjacent-levels'
}> {
  const members = [...new Set(unit.members)].filter((id) => nodes[id]?.type === 'zone')
  const warnings: ReturnType<typeof unitWarnings> = []
  if (members.length === 0) warnings.push({ code: 'empty' })
  const ordinals = [
    ...new Set(
      members.flatMap((id) => {
        const parentId = nodes[id]?.parentId
        const level = parentId ? nodes[parentId as AnyNodeId] : undefined
        return level?.type === 'level' ? [level.level] : []
      }),
    ),
  ].sort((a, b) => a - b)
  if (ordinals.some((ordinal, index) => index > 0 && ordinal - ordinals[index - 1]! > 1)) {
    warnings.push({ code: 'non-adjacent-levels' })
  }
  return warnings
}
