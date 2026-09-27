import {
  type BlockNode,
  type BlockTopology,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getBlockFaceNormal,
  pointInPolygon2D,
  unionPolygons,
} from '@pascal-app/core'

const VERTICAL_FACE_MAX_NORMAL_Y = 1e-3

const planRingsByTopology = new WeakMap<BlockTopology, [number, number][][]>()

/**
 * The block's plan footprint: the union of every non-vertical face projected
 * onto the level, so L-shapes keep their notch, rings keep their opening and
 * separate parts stay apart. Cached per topology: selection and hover
 * rebuild the plan without re-running the union.
 */
function blockPlanRings(topology: BlockTopology): [number, number][][] {
  const cached = planRingsByTopology.get(topology)
  if (cached) return cached
  const vertexById = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
  const projected: [number, number][][] = []
  for (const face of topology.faces) {
    const normal = getBlockFaceNormal(topology, face, vertexById)
    if (!normal || Math.abs(normal[1]) <= VERTICAL_FACE_MAX_NORMAL_Y) continue
    const ring = face.vertexIds.flatMap((id) => {
      const position = vertexById.get(id)
      return position ? [[position[0], position[2]] as [number, number]] : []
    })
    if (ring.length === face.vertexIds.length) projected.push(ring)
  }
  const rings = unionPolygons(projected)
  planRingsByTopology.set(topology, rings)
  return rings
}

/** A ring inside another is a hole (or an island in one): draw all rings as one evenodd path. */
function hasNestedRing(rings: [number, number][][]): boolean {
  return rings.some((ring, index) =>
    rings.some(
      (other, otherIndex) =>
        otherIndex !== index && pointInPolygon2D(ring[0]!, other, { includeBoundary: false }),
    ),
  )
}

function ringPath(rings: readonly (readonly FloorplanPoint[])[]): string {
  return rings.map((ring) => `M${ring.map(([x, y]) => `${x} ${y}`).join('L')}Z`).join('')
}

export function buildBlockFloorplan(
  node: BlockNode,
  ctx?: GeometryContext,
): FloorplanGeometry | null {
  const rings = blockPlanRings(node.topology)
  if (rings.length === 0) return null
  const selected = ctx?.viewState?.selected ?? false
  const style = {
    fill: selected ? '#fed7aa' : '#cbd5e1',
    fillOpacity: selected ? 0.55 : 0.72,
    stroke: selected ? (ctx?.viewState?.palette?.selectedStroke ?? '#f97316') : '#475569',
    strokeWidth: selected ? 0.03 : 0.018,
    pointerEvents: 'all' as const,
  }
  return {
    kind: 'group',
    transform: { translate: [node.position[0], node.position[2]], rotate: -node.rotation },
    children: hasNestedRing(rings)
      ? [{ kind: 'path', d: ringPath(rings), fillRule: 'evenodd', ...style }]
      : rings.map((points) => ({ kind: 'polygon', points, ...style })),
  }
}
