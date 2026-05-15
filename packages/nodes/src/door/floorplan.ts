import type {
  DoorNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  WallNode,
} from '@pascal-app/core'

/**
 * Stage C floor-plan builder for door. Doors render as a small polygon
 * sitting in the wall's cutout — width = door.width along the wall
 * direction, depth = wall.thickness perpendicular.
 *
 * Requires `ctx.parent` to be a wall (door.parentId is the wall it's
 * mounted on). Returns null when the parent isn't a wall (orphaned
 * doors during placement etc.).
 *
 * Inlined from the legacy `getOpeningFootprint` helper in
 * floorplan-panel.tsx. Window's builder is structurally identical.
 */
export function buildDoorFloorplan(node: DoorNode, ctx: GeometryContext): FloorplanGeometry | null {
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

  const distance = node.position[0] // door's local X = distance along wall
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
    fill: '#f8fafc',
    stroke: '#374151',
    strokeWidth: 0.015,
    opacity: 0.95,
  }
}
