import { area, intersection } from '../../lib/polygon-boolean'
import { extractRooms, sampleWallPointsForRoomDetection } from '../../lib/room-graph'
import { type AnyNodeId, SeparatorNode, type WallNode } from '../../schema'
import { omitUndefined } from '../../utils/omit-undefined'
import { planZoneRemoval } from './delete-zone'
import {
  at,
  boundaries,
  project,
  roomFace,
  type StructureNodes,
  type StructurePlan,
} from './shared'

/** Plans user deletion, including room-preserving boundaries, before reconciliation. */
export function planWallDeletion(
  nodes: StructureNodes,
  input: {
    nodeIds: readonly string[]
    mintId: (kind: 'separator') => string
    /** Authored batch state, so replacement walls/separators do not get duplicated. */
    nextNodes?: StructureNodes
  },
): StructurePlan {
  const deleted = new Set(input.nodeIds)
  const collect = () => {
    let changed = true
    while (changed) {
      changed = false
      for (const previous of Object.values(nodes)) {
        const node = input.nextNodes?.[previous.id] ?? previous
        if (deleted.has(node.id)) {
          if ('children' in node && Array.isArray(node.children))
            for (const id of node.children)
              if (!deleted.has(id)) {
                const child = input.nextNodes?.[id]
                if (child && child.parentId !== nodes[id]?.parentId && child.parentId !== node.id)
                  continue
                deleted.add(id)
                changed = true
              }
        } else if (
          (node.parentId && deleted.has(node.parentId)) ||
          ((node.type === 'door' || node.type === 'window') &&
            node.wallId &&
            deleted.has(node.wallId))
        ) {
          deleted.add(node.id)
          changed = true
        }
      }
    }
  }
  collect()
  const walls = Object.values(nodes).filter(
    (n): n is WallNode => n.type === 'wall' && deleted.has(n.id),
  )
  const changes: StructurePlan['changes'] = []
  for (const levelId of new Set(walls.map((wall) => wall.parentId))) {
    if (!levelId || deleted.has(levelId)) continue
    const faces = extractRooms(boundaries(nodes, levelId))
    const rooms = Object.values(nodes).flatMap((zone) => {
      if (zone.type !== 'zone' || zone.spaceRole !== 'room' || zone.parentId !== levelId) return []
      const face = roomFace(nodes, zone, faces)
      if (!face) return []
      const stored = { outer: zone.polygon, holes: zone.holes }
      const current = { outer: face.referencePolygon, holes: face.holes }
      const overlap = area(intersection(stored, current))
      if (overlap / Math.max(area([stored]) + area([current]) - overlap, 1e-9) < 0.9) return []
      return [{ zone, spans: face.spans }]
    })
    const replacements = boundaries(input.nextNodes ?? nodes, levelId).filter(
      (n) => !deleted.has(n.id),
    )
    // Topology planners replace walls in their own patches. Only fill uncovered
    // portions, using the same sampled reference lines as the room graph.
    const uncovered = (start: [number, number], end: [number, number]) => {
      let ranges: [number, number][] = [[0, 1]]
      for (const boundary of replacements) {
        const points =
          boundary.type === 'wall'
            ? sampleWallPointsForRoomDetection(boundary).map((p): [number, number] => [p.x, p.y])
            : [boundary.start, boundary.end]
        for (let i = 1; i < points.length; i++) {
          const a = project(points[i - 1]!, start, end),
            b = project(points[i]!, start, end)
          const onLine = (p: [number, number]) =>
            Math.abs(
              (p[0] - start[0]) * (end[1] - start[1]) - (p[1] - start[1]) * (end[0] - start[0]),
            ) < 1e-7
          if (!onLine(points[i - 1]!) || !onLine(points[i]!)) continue
          const lo = Math.min(a.t, b.t),
            hi = Math.max(a.t, b.t)
          ranges = ranges.flatMap(([from, to]) => {
            if (hi <= from || lo >= to) return [[from, to]]
            return [
              ...(lo > from ? [[from, lo] as [number, number]] : []),
              ...(hi < to ? [[hi, to] as [number, number]] : []),
            ]
          })
        }
      }
      return ranges
    }
    for (const { zone, spans } of rooms) {
      const wallSpans = spans.filter((s) => s.kind === 'wall')
      // Removing the final wall individually leaves a valid separator-only terrace.
      if (
        deleted.has(zone.id) ||
        new Set(wallSpans.map((s) => s.boundaryId)).size < 2 ||
        !wallSpans.every((s) => deleted.has(s.boundaryId))
      )
        continue
      if (
        wallSpans.some((span) => {
          const boundary = nodes[span.boundaryId]
          if (boundary?.type !== 'wall' && boundary?.type !== 'separator') return false
          return (
            uncovered(
              at(boundary.start, boundary.end, span.t0),
              at(boundary.start, boundary.end, span.t1),
            ).reduce((sum, [a, b]) => sum + b - a, 0) <
            1 - 1e-7
          )
        })
      )
        continue
      deleted.add(zone.id)
      const payload = planZoneRemoval(nodes, { zoneId: zone.id, contents: 'delete' }).payload
      for (const id of [...payload.itemIds, ...payload.separatorIds]) deleted.add(id)
    }
    for (const wall of walls) {
      if (wall.parentId !== levelId) continue
      const spans = rooms.flatMap(({ zone, spans }) =>
        spans.filter((s) => s.boundaryId === wall.id).map((s) => ({ ...s, zoneId: zone.id })),
      )
      const stations = [...new Set(spans.flatMap((s) => [s.t0, s.t1]))].sort((a, b) => a - b)
      const points = sampleWallPointsForRoomDetection(wall)
      for (let i = 1; i < stations.length; i++) {
        const t0 = stations[i - 1]!,
          t1 = stations[i]!,
          mid = (t0 + t1) / 2
        const owners = [
          ...new Set(
            spans
              .filter((s) => !deleted.has(s.zoneId) && s.t0 < mid && s.t1 > mid)
              .map((s) => s.zoneId),
          ),
        ]
        if (owners.length !== 1 || deleted.has(owners[0]!)) continue
        for (let j = 1; j < points.length; j++) {
          const a: [number, number] = [points[j - 1]!.x, points[j - 1]!.y]
          const b: [number, number] = [points[j]!.x, points[j]!.y]
          const from = project(a, wall.start, wall.end).t,
            to = project(b, wall.start, wall.end).t
          const lo = Math.max(t0, from),
            hi = Math.min(t1, to)
          if (hi - lo < 1e-7) continue
          const start = at(a, b, (lo - from) / (to - from)),
            end = at(a, b, (hi - from) / (to - from))
          for (const [u, v] of uncovered(start, end))
            changes.push({
              op: 'create',
              node: omitUndefined(
                SeparatorNode.parse({
                  id: input.mintId('separator'),
                  parentId: levelId,
                  start: at(start, end, u),
                  end: at(start, end, v),
                }),
              ),
            })
        }
      }
    }
  }
  collect()
  for (const node of Object.values(input.nextNodes ?? nodes))
    if (node.type === 'unit' && !deleted.has(node.id) && node.members.some((id) => deleted.has(id)))
      changes.push({
        op: 'update',
        id: node.id,
        data: { members: node.members.filter((id) => !deleted.has(id)) },
      })
  changes.push(...[...deleted].map((id) => ({ op: 'delete' as const, id: id as AnyNodeId })))
  return { changes }
}
