import { sampleWallPointsForRoomDetection } from '../../lib/room-graph'
import { type AnyNodeId, SeparatorNode, type WallNode } from '../../schema'
import { getWallCurveLength } from '../../systems/wall/wall-curve'
import { planWallDivision } from '../../systems/wall/wall-operations'
import { planWallInsertion } from '../../systems/wall/wall-topology'
import { type MezzanineEdgeInput, resizeMezzanine } from './resize-mezzanine'
import {
  applyToScratch,
  at,
  conflict,
  diffStructure,
  requireZone,
  roomFace,
  type SpanRef,
  type StructureMintId,
  type StructureNodes,
  type StructurePlan,
  sharedSpan,
} from './shared'

export function setZoneEdges(
  nodes: StructureNodes,
  input:
    | MezzanineEdgeInput
    | {
        zoneId: string
        edges: Array<{
          spanRef: SpanRef
          kind: 'wall' | 'separator'
          wall?: Pick<Partial<WallNode>, 'thickness' | 'height' | 'justification'>
        }>
        dropOpenings?: boolean
        mintId: StructureMintId
      },
): StructurePlan {
  if ('edgeIndex' in input) return resizeMezzanine(nodes, input)
  const zone = requireZone(nodes, input.zoneId)
  if (zone.floor?.support === 'open')
    return conflict(
      'invalid-edge',
      [zone.id],
      'Use edgeIndex and distance to push a mezzanine edge.',
    )
  const face = roomFace(nodes, zone)
  let scratch = { ...nodes }
  const edges = [...input.edges].sort(
    (a, b) =>
      a.spanRef.boundaryId.localeCompare(b.spanRef.boundaryId) || b.spanRef.t0 - a.spanRef.t0,
  )
  for (let i = 1; i < edges.length; i++) {
    const left = edges[i - 1]!.spanRef,
      right = edges[i]!.spanRef
    if (left.boundaryId === right.boundaryId && right.t1 > left.t0 + 1e-6)
      return conflict('overlapping-spans', [left.boundaryId], 'Boundary edits must not overlap.')
  }
  for (const edge of edges) {
    const span = edge.spanRef
    if (
      !face?.spans.some(
        (s) =>
          s.boundaryId === span.boundaryId &&
          s.face === span.face &&
          span.t0 >= s.t0 - 1e-6 &&
          span.t1 <= s.t1 + 1e-6 &&
          span.t1 > span.t0,
      )
    )
      return conflict('invalid-span', [span.boundaryId], 'The span is not on this room boundary.')
    const boundary = scratch[span.boundaryId]
    if (boundary?.type !== 'wall' && boundary?.type !== 'separator')
      return conflict('stale-span', [span.boundaryId], 'Replan against the current boundary.')
    if (boundary.type === edge.kind) continue
    const original = nodes[span.boundaryId]
    if (original?.type !== 'wall' && original?.type !== 'separator')
      throw Error('Missing boundary.')
    const originalLength =
      original.type === 'wall'
        ? getWallCurveLength(original)
        : Math.hypot(original.end[0] - original.start[0], original.end[1] - original.start[1])
    const currentLength =
      boundary.type === 'wall'
        ? getWallCurveLength(boundary)
        : Math.hypot(boundary.end[0] - boundary.start[0], boundary.end[1] - boundary.start[1])
    const t0 = (span.t0 * originalLength) / currentLength,
      t1 = (span.t1 * originalLength) / currentLength
    if (boundary.type === 'separator') {
      const start = at(boundary.start, boundary.end, t0),
        end = at(boundary.start, boundary.end, t1)
      const inserted = planWallInsertion(scratch, {
        levelId: zone.parentId as AnyNodeId,
        start,
        end,
        joinRadius: 0.001,
        wallDefaults: edge.wall,
        mintId: () => input.mintId('wall'),
      })
      if (!inserted.ok)
        return conflict(
          inserted.reason,
          [boundary.id],
          'Cannot replace this separator with a wall.',
        )
      scratch = applyToScratch(scratch, inserted.plan.changes)
      delete scratch[boundary.id]
      for (const [from, to] of [
        [0, t0],
        [t1, 1],
      ])
        if (to! - from! > 1e-6) {
          const remainder = SeparatorNode.parse({
            ...boundary,
            id: from === 0 ? boundary.id : input.mintId('separator'),
            start: at(boundary.start, boundary.end, from!),
            end: at(boundary.start, boundary.end, to!),
          })
          scratch[remainder.id] = remainder
        }
    } else {
      if (sharedSpan(nodes, zone, span)) continue
      const length = getWallCurveLength(boundary)
      const attachments = Object.values(scratch).filter(
        (n) => n.parentId === boundary.id || ('wallId' in n && n.wallId === boundary.id),
      )
      const removed = attachments.filter(
        (n) =>
          'position' in n &&
          Array.isArray(n.position) &&
          n.position[0] +
            ('width' in n && typeof n.width === 'number'
              ? n.width / 2
              : n.type === 'item'
                ? (n.asset.dimensions[0] * n.scale[0]) / 2
                : 0) >=
            t0 * length &&
          n.position[0] -
            ('width' in n && typeof n.width === 'number'
              ? n.width / 2
              : n.type === 'item'
                ? (n.asset.dimensions[0] * n.scale[0]) / 2
                : 0) <=
            t1 * length,
      )
      if (removed.length && !input.dropOpenings)
        return conflict(
          'hosted-openings',
          removed.map((n) => n.id),
          'Removing this wall also removes its hosted openings and objects. Pass dropOpenings to confirm.',
        )
      const removedIds = new Set<string>(removed.map((n) => n.id))
      let found = true
      while (found) {
        found = false
        for (const n of Object.values(scratch))
          if (n.parentId && removedIds.has(n.parentId) && !removedIds.has(n.id)) {
            removedIds.add(n.id)
            found = true
          }
      }
      for (const id of removedIds) delete scratch[id]
      scratch[boundary.id] = {
        ...boundary,
        children: boundary.children.filter((id) => !removed.some((n) => n.id === id)),
      }
      let targetId = boundary.id
      try {
        for (const t of [t1, t0])
          if (t > 1e-6 && t < 1 - 1e-6) {
            const division = planWallDivision(scratch, boundary.id, t * length, () =>
              input.mintId('wall'),
            )
            scratch = applyToScratch(scratch, division.changes)
            if (t === t0) targetId = division.changes.create[0]!.node.id as WallNode['id']
          }
      } catch (error) {
        return conflict('occupied-split', [boundary.id], String(error))
      }
      const target = scratch[targetId]
      if (target?.type !== 'wall')
        return conflict('invalid-span', [boundary.id], 'Could not isolate the wall span.')
      delete scratch[target.id]
      const points = sampleWallPointsForRoomDetection(target)
      for (let i = 1; i < points.length; i++) {
        const start = points[i - 1]!,
          end = points[i]!
        const separator = SeparatorNode.parse({
          id: input.mintId('separator'),
          parentId: zone.parentId,
          start: [start.x, start.y],
          end: [end.x, end.y],
        })
        scratch[separator.id] = separator
      }
    }
  }
  return { changes: diffStructure(nodes, scratch) }
}
