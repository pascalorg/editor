import type { FloorplanGeometry } from '@pascal-app/core'
import type { SpawnNode } from './schema'

const SPAWN_COLOR = '#818cf8'

/**
 * 2D floor-plan marker for a spawn point. A small filled circle at the
 * spawn's position, with a triangular arrow indicating the facing
 * direction (rotation around Y, looking down at the X-Z plane).
 */
export function buildSpawnFloorplan(node: SpawnNode): FloorplanGeometry {
  const [px, , pz] = node.position
  const ry = node.rotation

  return {
    kind: 'group',
    transform: { translate: [px, pz], rotate: ry },
    children: [
      {
        kind: 'polygon',
        points: [
          [0, -0.28],
          [-0.18, 0.12],
          [0.18, 0.12],
        ],
        fill: SPAWN_COLOR,
        opacity: 0.85,
      },
      {
        kind: 'circle',
        cx: 0,
        cy: 0,
        r: 0.34,
        stroke: SPAWN_COLOR,
        strokeWidth: 0.025,
        fill: SPAWN_COLOR,
        opacity: 0.18,
      },
    ],
  }
}
