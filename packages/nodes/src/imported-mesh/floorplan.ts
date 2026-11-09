import type {
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  ImportedMeshNode,
} from '@pascal-app/core'

/** A compact plan proxy for imported geometry, derived from its XZ bounds. */
export function buildImportedMeshFloorplan(
  node: ImportedMeshNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const primitive of node.primitives) {
    for (let i = 0; i + 2 < primitive.positions.length; i += 3) {
      minX = Math.min(minX, primitive.positions[i]!)
      maxX = Math.max(maxX, primitive.positions[i]!)
      minZ = Math.min(minZ, primitive.positions[i + 2]!)
      maxZ = Math.max(maxZ, primitive.positions[i + 2]!)
    }
  }
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) return null

  const yaw = node.rotation[1]
  const cos = Math.cos(-yaw)
  const sin = Math.sin(-yaw)
  const toPlan = (x: number, z: number): FloorplanPoint => [
    node.position[0] + x * cos - z * sin,
    node.position[2] + x * sin + z * cos,
  ]
  const selected = Boolean(ctx.viewState?.selected || ctx.viewState?.highlighted)
  return {
    kind: 'polygon',
    points: [toPlan(minX, minZ), toPlan(maxX, minZ), toPlan(maxX, maxZ), toPlan(minX, maxZ)],
    fill: '#94a3b8',
    fillOpacity: selected ? 0.28 : 0.14,
    stroke: selected ? (ctx.viewState?.palette?.selectedStroke ?? '#f97316') : '#64748b',
    strokeWidth: selected ? 0.04 : 0.025,
    vectorEffect: 'non-scaling-stroke',
  }
}
