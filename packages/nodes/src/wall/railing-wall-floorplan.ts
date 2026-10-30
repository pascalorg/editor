import {
  type AnyNode,
  type FloorplanGeometry,
  getRailingWallConfig,
  type WallNode,
} from '@pascal-app/core'
import { buildRailingWallGuard } from './railing-wall-guard'

/**
 * A railing's posts in plan: a small square at each post the guard stands
 * (`railing-wall-guard.ts`), inside the thin, unfilled outline the wall builder draws. `walls`
 * are the level's, read for the ends that die into a wall.
 */
export function buildRailingWallFloorplan(
  wall: WallNode,
  children: readonly AnyNode[],
  walls: readonly WallNode[],
  stroke: string,
): FloorplanGeometry[] {
  const half = getRailingWallConfig(wall).postSize / 2
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  // The posts stand square to the wall's chord, as in 3D.
  const along = [Math.cos(angle) * half, Math.sin(angle) * half] as const
  const across = [-along[1], along[0]] as const
  return buildRailingWallGuard(wall, children, walls, 'plan').posts.map(
    ([x, , z]): FloorplanGeometry => ({
      kind: 'polygon',
      points: [
        [x - along[0] - across[0], z - along[1] - across[1]],
        [x + along[0] - across[0], z + along[1] - across[1]],
        [x + along[0] + across[0], z + along[1] + across[1]],
        [x - along[0] + across[0], z - along[1] + across[1]],
      ],
      fill: stroke,
      stroke,
      strokeWidth: 0.004,
      pointerEvents: 'none',
    }),
  )
}
