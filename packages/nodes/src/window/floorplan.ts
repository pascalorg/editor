import type {
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  WallNode,
  WindowNode,
} from '@pascal-app/core'

/**
 * Stage C floor-plan builder for window. Mirrors door's shape — window
 * polygon sits in the wall's cutout, width along wall, depth = wall
 * thickness. Visually distinct via a glass-blue tint.
 */
export function buildWindowFloorplan(
  node: WindowNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const wall = ctx.parent as WallNode | null
  if (!wall || wall.type !== 'wall') return null

  const [x1, z1] = wall.start
  const [x2, z2] = wall.end
  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length < 1e-9) return null

  const dirX = dx / length
  const dirZ = dz / length
  const perpX = -dirZ
  const perpZ = dirX

  const distance = node.position[0]
  const width = node.width
  const depth = wall.thickness ?? 0.1
  const cx = x1 + dirX * distance
  const cz = z1 + dirZ * distance
  const halfWidth = width / 2
  const halfDepth = depth / 2

  const points: readonly FloorplanPoint[] = [
    [cx - dirX * halfWidth + perpX * halfDepth, cz - dirZ * halfWidth + perpZ * halfDepth],
    [cx + dirX * halfWidth + perpX * halfDepth, cz + dirZ * halfWidth + perpZ * halfDepth],
    [cx + dirX * halfWidth - perpX * halfDepth, cz + dirZ * halfWidth - perpZ * halfDepth],
    [cx - dirX * halfWidth - perpX * halfDepth, cz - dirZ * halfWidth - perpZ * halfDepth],
  ]

  return {
    kind: 'polygon',
    points,
    fill: '#bae6fd',
    stroke: '#0c4a6e',
    strokeWidth: 0.015,
    opacity: 0.8,
  }
}
