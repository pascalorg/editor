import type { FloorplanGeometry, FloorplanPoint } from '@pascal-app/core'
import { isCurvedWall, sampleWallCenterline } from '@pascal-app/core'
import type { FenceNode } from './schema'

/**
 * Stage C floor-plan builder for fence. Draws the fence centerline as
 * a polyline; thickness becomes the stroke width.
 *
 * Curved fences sample the centerline at 24 segments — same density the
 * legacy `floorplanFenceEntries` useMemo uses, so straight + curved
 * fences look comparable to the legacy rendering.
 *
 * Visual nuances the legacy ships (side hatching to indicate thickness
 * direction, post markers along the centerline) are deferred — Phase 5
 * Stage D will revisit if real visual parity is needed.
 */
export function buildFenceFloorplan(node: FenceNode): FloorplanGeometry {
  const points: FloorplanPoint[] = isCurvedWall(node)
    ? sampleWallCenterline(node, 24).map((p) => [p.x, p.y] as FloorplanPoint)
    : [
        [node.start[0], node.start[1]],
        [node.end[0], node.end[1]],
      ]

  return {
    kind: 'polyline',
    points,
    stroke: node.color || '#475569',
    strokeWidth: Math.max(node.thickness, 0.05),
    opacity: 0.9,
  }
}
