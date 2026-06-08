import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import type { SpawnNode } from './schema'

const SPAWN_COLOR = '#818cf8'
const ROTATE_ARROW_CORNER_OFFSET = 0.22

/**
 * 2D floor-plan marker for a spawn point. A small filled circle at the
 * spawn's position, with a triangular arrow indicating the facing
 * direction (rotation around Y, looking down at the X-Z plane).
 *
 * Color matches the 3D renderer's indigo spawn material so the user
 * sees the same visual identity in both views.
 *
 * Coordinates are level-local meters; rotation is radians.
 */
export function buildSpawnFloorplan(node: SpawnNode, ctx: GeometryContext): FloorplanGeometry {
  const [px, , pz] = node.position
  const ry = node.rotation
  const isSelected = ctx.viewState?.selected ?? false

  const children: FloorplanGeometry[] = [
    {
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
          fill: SPAWN_COLOR,
          opacity: 0.85,
        },
        // Spawn body marker — circle outline so the spawn is legible at
        // small zoom levels where the triangle would shrink past visibility.
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
    },
  ]

  if (isSelected) {
    const cornerLocalX = 0.34 + ROTATE_ARROW_CORNER_OFFSET
    const cornerLocalZ = 0.34 + ROTATE_ARROW_CORNER_OFFSET
    const [cornerX, cornerZ] = rotatePlanVector(cornerLocalX, cornerLocalZ, ry)
    const [radialX, radialZ] = rotatePlanVector(1, 1, ry)
    children.push({
      kind: 'rotate-arrow',
      point: [px + cornerX, pz + cornerZ],
      angle: Math.atan2(radialZ, radialX),
      affordance: 'spawn-rotate',
      pivot: [px, pz],
    })
  }

  return {
    kind: 'group',
    children,
  }
}

function rotatePlanVector(x: number, y: number, rotation: number): FloorplanPoint {
  const c = Math.cos(rotation)
  const s = Math.sin(rotation)
  return [x * c - y * s, x * s + y * c]
}
