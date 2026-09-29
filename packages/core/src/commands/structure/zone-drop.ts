import { area, containsPoint, difference, intersection } from '../../lib/polygon-boolean'
import { polygonInteriorPoint } from '../../lib/polygon-label'
import { extractRooms } from '../../lib/room-graph'
import type { AnyNode, WallNode, ZoneNode } from '../../schema'
import { at, boundaries, type Point, project } from './shared'
import { collinearOverlap, wallStation } from './zone-wall-merge'

export function snapDroppedWalls(
  nodes: Record<string, AnyNode>,
  moving: Set<string>,
  levelId: string,
) {
  for (const id of moving) {
    const wall = nodes[id]
    if (wall?.type !== 'wall') continue
    const destination = Object.values(nodes)
      .filter(
        (node): node is WallNode =>
          node.type === 'wall' &&
          node.parentId === levelId &&
          !moving.has(node.id) &&
          collinearOverlap(wall, node),
      )
      .sort(
        (a, b) =>
          project(wall.start, a.start, a.end).distance -
            project(wall.start, b.start, b.end).distance || a.id.localeCompare(b.id),
      )[0]
    if (!destination) continue
    const snap = (point: Point): Point => {
      const onWall = project(point, wall.start, wall.end)
      if (onWall.distance > 1e-6) return point
      return at(destination.start, destination.end, wallStation(destination, point))
    }
    for (const movingId of moving) {
      const node = nodes[movingId]!
      if (node.type === 'wall' || node.type === 'separator')
        nodes[movingId] = { ...node, start: snap(node.start), end: snap(node.end) }
    }
  }
}

export function preserveDroppedRoomSeeds(nodes: Record<string, AnyNode>, placedZoneId: string) {
  const placed = nodes[placedZoneId] as ZoneNode
  const dropped = [{ outer: placed.polygon, holes: placed.holes ?? [] }]
  const faces = extractRooms(boundaries(nodes, placed.parentId!)).map((face) => ({
    face,
    polygon: [{ outer: face.referencePolygon, holes: face.holes }],
  }))
  for (const zone of Object.values(nodes)) {
    if (zone.type !== 'zone' || zone.parentId !== placed.parentId) continue
    const moving = zone.id === placedZoneId
    if (!moving && zone.seed && !containsPoint(dropped, zone.seed)) continue
    const old = [{ outer: zone.polygon, holes: zone.holes ?? [] }]
    const candidates = faces
      .map(({ face, polygon }) => ({
        face,
        overlap: area(intersection(polygon, old)),
        outside: area(intersection(polygon, difference(old, dropped))),
        size: area(polygon),
      }))
      .filter(({ overlap }) => overlap > 1e-6)
    // Prefer whole resulting faces inside the owner's intent; snapped boundaries
    // may protrude slightly, so overlap supplies a fallback when none fit exactly.
    const owned = candidates.filter(({ overlap, size }) => overlap >= size - 1e-5)
    const available = owned.length ? owned : candidates
    const outside = moving ? [] : available.filter(({ outside, size }) => outside >= size - 1e-5)
    const target = (outside.length ? outside : available).sort(
      (a, b) => b.overlap - a.overlap || a.face.id.localeCompare(b.face.id),
    )[0]
    if (!target) continue
    const polygon = { polygon: target.face.referencePolygon, holes: target.face.holes }
    if (zone.seed && containsPoint([{ outer: polygon.polygon, holes: polygon.holes }], zone.seed))
      continue
    nodes[zone.id] = { ...zone, seed: polygonInteriorPoint(polygon) }
  }
}
