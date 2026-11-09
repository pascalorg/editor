import { roomPolygonKey } from '../../lib/floor-room-faces'
import { area, containsPoint, intersection } from '../../lib/polygon-boolean'
import { extractRooms } from '../../lib/room-graph'
import type { BoundaryNode, BoundarySpan } from '../../lib/room-topology-index'
import type { NodePatch, SceneNodes } from '../../lib/structure-kernel'
import type { AnyNode, AnyNodeId, ZoneNode } from '../../schema'
import type { WallTopologyChanges } from '../../systems/wall/wall-topology'
import { omitUndefined } from '../../utils/omit-undefined'

export type NodeChange = NodePatch
export type StructureNodes = SceneNodes
export type StructureMintId = (kind: 'zone' | 'wall' | 'separator') => string
export type StructureConflict = { code: string; nodeIds: string[]; message: string }
export type StructurePlan = {
  changes: NodeChange[]
  conflicts?: StructureConflict[]
  idMap?: Record<string, string[]>
}
export type Point = [number, number]
export type SpanRef = Pick<BoundarySpan, 'boundaryId' | 'face' | 't0' | 't1'>

export function structureChangeBatch(changes: readonly NodeChange[]): WallTopologyChanges {
  return {
    create: changes.flatMap((c) =>
      c.op === 'create' ? [{ node: c.node, parentId: c.node.parentId as AnyNodeId }] : [],
    ),
    update: changes.flatMap((c) => (c.op === 'update' ? [{ id: c.id, data: c.data }] : [])),
    delete: changes.flatMap((c) => (c.op === 'delete' ? [c.id] : [])),
  }
}

export function applyToScratch(nodes: StructureNodes, batch: WallTopologyChanges) {
  const next: Record<string, AnyNode> = { ...nodes }
  for (const id of batch.delete) delete next[id]
  for (const { node, parentId } of batch.create)
    next[node.id] = { ...node, parentId: parentId ?? node.parentId } as AnyNode
  for (const { id, data } of batch.update)
    if (next[id]) next[id] = { ...next[id], ...data } as AnyNode
  return next
}

export function diffStructure(before: StructureNodes, after: StructureNodes): NodeChange[] {
  return [
    ...Object.values(after)
      .filter((node) => !before[node.id])
      .map((node): NodeChange => ({ op: 'create', node: omitUndefined(node) })),
    ...Object.values(after)
      .filter((node) => before[node.id] && node !== before[node.id])
      .flatMap((node): NodeChange[] => {
        const previous = before[node.id]!
        const data = Object.fromEntries(
          [...new Set([...Object.keys(previous), ...Object.keys(node)])]
            .filter(
              (key) =>
                JSON.stringify(previous[key as keyof typeof previous]) !==
                JSON.stringify(node[key as keyof typeof node]),
            )
            .map((key) => [key, omitUndefined(node[key as keyof typeof node])]),
        ) as Partial<AnyNode>
        return Object.keys(data).length ? [{ op: 'update', id: node.id, data }] : []
      }),
    ...Object.values(before)
      .filter((node) => !after[node.id])
      .map((node): NodeChange => ({ op: 'delete', id: node.id })),
  ]
}

export function conflict(code: string, nodeIds: string[], message: string): StructurePlan {
  return { changes: [], conflicts: [{ code, nodeIds, message }] }
}

export function requireZone(nodes: StructureNodes, id: string): ZoneNode {
  const zone = nodes[id]
  if (zone?.type !== 'zone' || zone.spaceRole !== 'room') throw Error(`Room not found: ${id}`)
  return zone
}

export function boundaries(nodes: StructureNodes, levelId: string): BoundaryNode[] {
  return Object.values(nodes).filter(
    (n): n is BoundaryNode =>
      n.parentId === levelId && (n.type === 'wall' || n.type === 'separator'),
  )
}

const faceMatches = new WeakMap<
  object,
  Map<string, ReturnType<typeof extractRooms>[number] | undefined>
>()

export function roomFace(
  nodes: StructureNodes,
  zone: ZoneNode,
  faces = extractRooms(boundaries(nodes, zone.parentId!)),
) {
  if (zone.floor?.support === 'open') return undefined
  let matches = faceMatches.get(faces)
  if (!matches) {
    matches = new Map()
    faceMatches.set(faces, matches)
  }
  const key = roomPolygonKey(zone.polygon, zone.holes)
  if (matches.has(key)) return matches.get(key)
  const exact = faces.find((face) => roomPolygonKey(face.referencePolygon, face.holes) === key)
  if (exact) {
    matches.set(key, exact)
    return exact
  }
  const scored = faces.map((face) => ({
    face,
    overlap: area(
      intersection(
        { outer: zone.polygon, holes: zone.holes },
        { outer: face.referencePolygon, holes: face.holes },
      ),
    ),
  }))
  const result = scored.sort((a, b) => b.overlap - a.overlap)[0]?.overlap
    ? scored[0]!.face
    : undefined
  matches.set(key, result)
  return result
}

export function sharedSpan(nodes: StructureNodes, zone: ZoneNode, span: SpanRef) {
  return Object.values(nodes).some(
    (other) =>
      other.type === 'zone' &&
      other.id !== zone.id &&
      other.parentId === zone.parentId &&
      other.spaceRole === 'room' &&
      roomFace(nodes, other)?.spans.some(
        (s) =>
          s.boundaryId === span.boundaryId &&
          s.face !== span.face &&
          Math.min(s.t1, span.t1) - Math.max(s.t0, span.t0) > 1e-6,
      ),
  )
}

export function at(start: Point, end: Point, t: number): Point {
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
}

export function project(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0],
    dz = end[1] - start[1]
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / (dx * dx + dz * dz)),
  )
  const result = at(start, end, t)
  return { point: result, t, distance: Math.hypot(result[0] - point[0], result[1] - point[1]) }
}

export function pointInRoom(zone: ZoneNode, point: Point) {
  return containsPoint([{ outer: zone.polygon, holes: zone.holes }], point)
}
