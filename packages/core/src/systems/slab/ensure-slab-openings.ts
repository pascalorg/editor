import { area, difference, union } from '../../lib/polygon-boolean'
import type { AnyNode, AnyNodeId, SlabNode, SurfaceHoleMetadata } from '../../schema'

function sameOwner(left: SurfaceHoleMetadata, right: SurfaceHoleMetadata) {
  return (
    left.source === right.source &&
    ((right.source === 'stair' && !!right.stairId && left.stairId === right.stairId) ||
      (right.source === 'elevator' && !!right.elevatorId && left.elevatorId === right.elevatorId))
  )
}

export function ensureMissingSlabOpenings(
  nodes: Record<string, AnyNode>,
  updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  return updates.flatMap((update) => {
    const slab = nodes[update.id]
    if (slab?.type !== 'slab') return [update]
    const data = update.data as Partial<SlabNode>
    const holes = slab.holes ?? []
    const metadata = holes.map((_, i) => slab.holeMetadata?.[i] ?? { source: 'manual' as const })
    const existing = union(holes)
    const additions = (data.holes ?? []).flatMap((polygon, i) => {
      const owner = data.holeMetadata?.[i]
      if (!owner || (owner.source !== 'stair' && owner.source !== 'elevator')) return []
      // Ownership preserves deliberately edited openings; geometric coverage also
      // recognizes older saves whose holes have no ownership metadata.
      if (metadata.some((entry) => sameOwner(entry, owner))) return []
      const proposed = union([polygon])
      if (area(difference(proposed, existing)) <= Math.max(1e-8, area(proposed) * 1e-3)) return []
      return [{ polygon, owner }]
    })
    if (!additions.length) return []
    return [
      {
        id: slab.id,
        data: {
          holes: [...holes, ...additions.map(({ polygon }) => polygon)],
          holeMetadata: [...metadata, ...additions.map(({ owner }) => owner)],
        },
      },
    ]
  })
}
