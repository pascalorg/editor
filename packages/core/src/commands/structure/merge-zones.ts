import { extractRooms } from '../../lib/room-graph'
import {
  boundaries,
  conflict,
  requireZone,
  roomFace,
  type StructureNodes,
  type StructurePlan,
} from './shared'

export function mergeZones(
  nodes: StructureNodes,
  input: { zoneIds: [string, string] },
): StructurePlan {
  const [a, b] = input.zoneIds.map((id) => requireZone(nodes, id))
  if (a!.id === b!.id || a!.parentId !== b!.parentId)
    return conflict(
      'different-levels',
      input.zoneIds,
      'Select two different rooms on the same level.',
    )
  const left = roomFace(nodes, a!)?.spans ?? []
  const right = roomFace(nodes, b!)?.spans ?? []
  const common = left.filter((s) =>
    right.some(
      (r) =>
        r.boundaryId === s.boundaryId &&
        r.face !== s.face &&
        Math.min(r.t1, s.t1) - Math.max(r.t0, s.t0) > 1e-6,
    ),
  )
  const separators = new Set(common.filter((s) => s.kind === 'separator').map((s) => s.boundaryId))
  if (!separators.size)
    return conflict(
      'wall-boundary',
      common.map((s) => s.boundaryId),
      common.length
        ? 'These rooms are separated by walls. Merge never removes walls.'
        : 'These rooms do not share a separator.',
    )
  const before = boundaries(nodes, a!.parentId!)
  const after = before.filter((n) => !separators.has(n.id))
  if (extractRooms(after).length !== extractRooms(before).length - 1)
    return conflict(
      'shared-separator',
      [...separators],
      'Removing these separators would affect additional rooms.',
    )
  return { changes: [...separators].map((id) => ({ op: 'delete', id: nodes[id]!.id })) }
}
