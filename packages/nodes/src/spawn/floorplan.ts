import type { FloorplanGeometry } from '@pascal-app/core'
import type { SpawnNode } from './schema'

/**
 * 2D floor-plan marker for a spawn point. A small filled circle at the
 * spawn's position, with a triangular arrow indicating the facing
 * direction (rotation around Y, looking down at the X-Z plane).
 *
 * Color matches the 3D renderer's `SPAWN_COLOR = '#22c55e'` so the user
 * sees the same visual identity in both views.
 *
 * Coordinates are level-local meters; rotation is radians.
 */
export function buildSpawnFloorplan(node: SpawnNode): FloorplanGeometry {
  const [px, , pz] = node.position
  const ry = node.rotation

  return {
    kind: 'group',
    transform: { translate: [px, pz], rotate: ry },
    children: [
      // Direction-pointing triangle, base centered at origin, tip in -Z
      // (forward). Matches the 3D arrow's orientation.
      {
        kind: 'polygon',
        points: [
          [0, -0.28],
          [-0.18, 0.12],
          [0.18, 0.12],
        ],
        fill: '#22c55e',
        opacity: 0.85,
      },
      // Spawn body marker — circle outline so the spawn is legible at
      // small zoom levels where the triangle would shrink past visibility.
      {
        kind: 'circle',
        cx: 0,
        cy: 0,
        r: 0.34,
        stroke: '#22c55e',
        strokeWidth: 0.025,
        fill: '#22c55e',
        opacity: 0.18,
      },
    ],
  }
}
