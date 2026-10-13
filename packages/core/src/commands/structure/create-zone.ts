import { newZone } from '../../lib/new-zone'
import { area, intersection } from '../../lib/polygon-boolean'
import { polygonInteriorPoint } from '../../lib/polygon-label'
import { segmentsIntersect } from '../../lib/polygon-relations'
import { extractRooms } from '../../lib/room-graph'
import { isAllocatedRoomName } from '../../lib/room-name'
import { adoptableFace, zoneFaceFits } from '../../lib/room-zone-adoption'
import { type AnyNodeId, SeparatorNode, type WallNode, ZoneNode } from '../../schema'
import { getWallCurveFrameAt } from '../../systems/wall/wall-curve'
import { planWallInsertion, uncoveredWallSegments } from '../../systems/wall/wall-topology'
import { setZoneIntent, type ZoneIntentPatch } from './set-zone-intent'
import {
  applyToScratch,
  boundaries,
  diffStructure,
  type Point,
  type StructureMintId,
  type StructureNodes,
  type StructurePlan,
  structureChangeBatch,
} from './shared'

type Edge =
  | { wallId: string; face: 'a' | 'b'; t0: number; t1: number }
  | { separator: [Point, Point] }
export type CreateZoneInput = {
  levelId: string
  polygon?: Point[]
  boundaryIds?: string[]
  edges?: Edge[]
  name?: string
  intent?: ZoneIntentPatch
  enclose?: boolean
  /** Name the walled room a person already named, instead of stacking a zone on it (an agent's explicit rename). */
  adoptNamed?: boolean
  wall?: Pick<Partial<WallNode>, 'height' | 'thickness' | 'justification'>
  mintId: StructureMintId
}

export function outdoorRoomConflicts(nodes: StructureNodes, levelId: string, polygon: Point[]) {
  return Object.values(nodes).flatMap((node) =>
    node.type === 'zone' &&
    node.parentId === levelId &&
    node.spaceRole === 'room' &&
    node.enclosureStatus !== 'open' &&
    node.floor?.support !== 'open' &&
    area(intersection(polygon, { outer: node.polygon, holes: node.holes })) > 1e-6
      ? [
          {
            code: 'outdoor-room-overlap',
            nodeIds: [node.id],
            message: `The terrace overlaps ${node.name || 'an existing room'}.`,
          },
        ]
      : [],
  )
}

/**
 * The room walls already make where a room is drawn, to name rather than stack a second zone on
 * (run 6: walls first, then create_room, gave every room a "Room N" twin). Only when every edge of
 * the polygon runs along a wall, so nothing is built and the rooms stand as they are; the room the
 * polygon fits by the reconciler's own adoption rule, and only while it keeps the name the
 * reconciler gave it.
 */
export function walledRoomAt(
  nodes: StructureNodes,
  levelId: string,
  polygon: Point[],
): ZoneNode | undefined {
  const walls = boundaries(nodes, levelId).filter((n): n is WallNode => n.type === 'wall')
  const walled = polygon.every((start, i) => {
    const end = polygon[(i + 1) % polygon.length]!
    return (
      Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-8 ||
      uncoveredWallSegments(start, end, walls).length === 0
    )
  })
  if (!walled) return
  const rooms = Object.values(nodes).filter(
    (node): node is ZoneNode =>
      node.type === 'zone' &&
      node.parentId === levelId &&
      node.spaceRole === 'room' &&
      node.autoFromWalls &&
      node.enclosureStatus !== 'open',
  )
  const fit = adoptableFace(
    zoneFaceFits(
      { id: '', polygon },
      rooms.map((room) => ({
        key: room.id,
        polygon: { outer: room.polygon, holes: room.holes ?? [] },
        clear: { outer: [], holes: [] },
      })),
    ),
  )
  return fit && rooms[fit.face]
}

/**
 * The walled room a drawn polygon names instead of stacking a zone on: one that still has the name
 * the reconciler gave it, or any walled room when `adoptNamed` says its person's name may change.
 */
export function walledRoomToName(
  nodes: StructureNodes,
  levelId: string,
  polygon: Point[],
  adoptNamed = false,
): ZoneNode | undefined {
  const room = walledRoomAt(nodes, levelId, polygon)
  return room && (adoptNamed || isAllocatedRoomName(room.name)) ? room : undefined
}

export function createZone(
  nodes: StructureNodes,
  input: CreateZoneInput,
): StructurePlan & { zoneId: string; renamed?: string } {
  if (nodes[input.levelId]?.type !== 'level') throw Error('Select an editable floor.')
  if ([input.polygon, input.boundaryIds, input.edges].filter(Boolean).length !== 1)
    throw Error('Supply exactly one polygon, boundary set or edge list.')
  let scratch = { ...nodes }
  let polygon = input.polygon
  let segments: [Point, Point][] = []
  if (input.boundaryIds) {
    const selected = boundaries(nodes, input.levelId).filter((n) =>
      input.boundaryIds!.includes(n.id),
    )
    const faces = extractRooms(selected)
    if (selected.length !== input.boundaryIds.length || faces.length !== 1)
      throw Error('The boundary set must enclose one room.')
    polygon = faces[0]!.referencePolygon
  } else if (input.edges) {
    const edges = input.edges.map((edge): Point[] => {
      if ('separator' in edge) {
        segments.push(edge.separator)
        return edge.separator
      }
      const wall = nodes[edge.wallId]
      if (
        wall?.type !== 'wall' ||
        wall.parentId !== input.levelId ||
        !(edge.t0 >= 0 && edge.t1 <= 1 && edge.t0 < edge.t1)
      )
        throw Error('Invalid wall edge.')
      const count = wall.curveOffset ? 64 : 1
      const points = Array.from({ length: count + 1 }, (_, i): Point => {
        const t = edge.t0 + ((edge.t1 - edge.t0) * i) / count
        const { point } = getWallCurveFrameAt(wall, t)
        return [point.x, point.y]
      })
      return edge.face === 'a' ? points : points.reverse()
    })
    segments.push(
      ...edges.map((edge, i): [Point, Point] => [edge.at(-1)!, edges[(i + 1) % edges.length]![0]!]),
    )
    polygon = edges.flat()
  } else if (polygon) segments = polygon.map((p, i) => [p, polygon![(i + 1) % polygon!.length]!])
  polygon = polygon?.filter((point, i, points) => {
    const next = points[(i + 1) % points.length]!
    return Math.hypot(point[0] - next[0], point[1] - next[1]) > 1e-8
  })
  if (
    !polygon ||
    polygon.length < 3 ||
    !polygon.flat().every(Number.isFinite) ||
    area([{ outer: polygon, holes: [] }]) < 0.01 ||
    polygon.some((a, i) =>
      polygon!.some(
        (b, j) =>
          j > i + 1 &&
          !(i === 0 && j === polygon!.length - 1) &&
          segmentsIntersect(
            a,
            polygon![(i + 1) % polygon!.length]!,
            b,
            polygon![(j + 1) % polygon!.length]!,
          ),
      ),
    )
  )
    throw Error('A room needs a valid polygon.')
  const walledRoom = walledRoomToName(nodes, input.levelId, polygon, input.adoptNamed)
  if (walledRoom) {
    scratch[walledRoom.id] = { ...walledRoom, name: input.name ?? walledRoom.name }
    if (input.intent)
      scratch = applyToScratch(
        scratch,
        structureChangeBatch(
          setZoneIntent(scratch, { zoneId: walledRoom.id, patch: input.intent }).changes,
        ),
      )
    return {
      changes: diffStructure(nodes, scratch),
      zoneId: walledRoom.id,
      renamed: walledRoom.name,
    }
  }
  if (input.enclose === false) {
    const conflicts = outdoorRoomConflicts(nodes, input.levelId, polygon)
    if (conflicts.length) return { changes: [], conflicts, zoneId: '' }
  }
  for (const [start, end] of segments) {
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-8) continue
    const walls = boundaries(scratch, input.levelId).filter((n): n is WallNode => n.type === 'wall')
    for (const [a, b] of uncoveredWallSegments(start, end, walls)) {
      if (input.enclose) {
        const result = planWallInsertion(scratch, {
          levelId: input.levelId as AnyNodeId,
          start: a,
          end: b,
          joinRadius: 0.001,
          wallDefaults: input.wall,
          mintId: () => input.mintId('wall'),
        })
        if (!result.ok) throw Error(`Cannot enclose room: ${result.reason}`)
        scratch = applyToScratch(scratch, result.plan.changes)
      } else {
        const separator = SeparatorNode.parse({
          id: input.mintId('separator'),
          parentId: input.levelId,
          start: a,
          end: b,
        })
        scratch[separator.id] = separator
      }
    }
  }
  const zone = newZone({
    id: input.mintId('zone'),
    parentId: input.levelId,
    name: input.name ?? 'Room',
    polygon,
    seed: polygonInteriorPoint({ polygon }, true),
    spaceRole: 'room',
  })
  if (scratch[zone.id]) throw Error(`Duplicate zone id: ${zone.id}`)
  scratch[zone.id] = zone
  if (input.intent)
    scratch = applyToScratch(
      scratch,
      structureChangeBatch(
        setZoneIntent(scratch, { zoneId: zone.id, patch: input.intent }).changes,
      ),
    )
  return { changes: diffStructure(nodes, scratch), zoneId: zone.id }
}
