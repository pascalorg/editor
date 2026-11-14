import type { WallNode } from '../../schema'
import { getWallCurveFrameAt } from '../../systems/wall/wall-curve'
import type { WallPlanPoint } from '../../systems/wall/wall-move'

/** The floor plan's affordance id for a wall end's pull grip (a `move-arrow`, variant `pull`). */
export const WALL_PULL_AFFORDANCE = 'wall-pull'

/** What a pull grip carries: the wall, and which of its ends it pulls from. */
export type WallPullGripPayload = { wallId: string; endpoint: 'start' | 'end' }

/** The grip's tooltip, in both views. */
export const WALL_PULL_GRIP_TITLE = 'Drag to draw the next wall'

/**
 * The pulled end of `wall` and the direction out of it: along the wall for a
 * straight one, along its tangent for a curved one.
 */
export function wallPullSeed(
  wall: Pick<WallNode, 'start' | 'end' | 'curveOffset'>,
  endpoint: 'start' | 'end',
): { start: WallPlanPoint; reference: WallPlanPoint } | null {
  const start: WallPlanPoint =
    endpoint === 'start' ? [wall.start[0], wall.start[1]] : [wall.end[0], wall.end[1]]
  const tangent = getWallCurveFrameAt(wall as WallNode, endpoint === 'start' ? 0 : 1).tangent
  const sign = endpoint === 'start' ? -1 : 1
  const length = Math.hypot(tangent.x, tangent.y)
  if (!(length > 1e-9)) return null
  return { start, reference: [(tangent.x / length) * sign, (tangent.y / length) * sign] }
}

/**
 * The affordance a floor-plan `move-arrow` carries to be a wall push arrow;
 * its payload is a `WallPushArrowPayload`. The editor's floor plan runs its
 * wall push for it instead of a registry affordance session.
 */
export const WALL_PUSH_AFFORDANCE = 'wall-push'

/** A wall's or an invisible wall's side arrow: `wallId` is either. */
export type WallPushArrowPayload = { wallId: string; side: 'a' | 'b' }
