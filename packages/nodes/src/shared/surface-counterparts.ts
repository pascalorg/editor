import type { AnyNode, AnyNodeId } from '@pascal-app/core'

const POINT_EPSILON = 1e-6

type SurfaceNode = AnyNode & { polygon: readonly (readonly [number, number])[] }

function isSurface(node: AnyNode | undefined): node is SurfaceNode {
  return (
    (node?.type === 'slab' || node?.type === 'ceiling') &&
    Array.isArray((node as { polygon?: unknown }).polygon)
  )
}

function samePolygon(a: SurfaceNode['polygon'], b: SurfaceNode['polygon']) {
  return (
    a.length === b.length &&
    a.every(
      (point, index) =>
        Math.abs(point[0] - b[index]![0]) <= POINT_EPSILON &&
        Math.abs(point[1] - b[index]![1]) <= POINT_EPSILON,
    )
  )
}

/**
 * The other surface of the same room: a slab's ceiling, a ceiling's slab —
 * on the same level with the same outline. The plan draws them on top of each
 * other (only the slab takes a click), so deselecting one deselects both.
 * Both kinds declare it as their plan `selectionCounterparts`.
 */
export function sameOutlineSurfaceCounterparts({
  node,
  nodes,
}: {
  node: AnyNode
  nodes: Readonly<Record<string, AnyNode | undefined>>
}): AnyNodeId[] {
  if (!isSurface(node)) return []
  const other = node.type === 'slab' ? 'ceiling' : 'slab'
  return Object.values(nodes)
    .filter(
      (candidate): candidate is SurfaceNode =>
        isSurface(candidate) &&
        candidate.type === other &&
        (candidate.parentId ?? null) === (node.parentId ?? null) &&
        samePolygon(candidate.polygon, node.polygon),
    )
    .map((candidate) => candidate.id as AnyNodeId)
}
