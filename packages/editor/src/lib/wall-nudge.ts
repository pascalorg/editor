/**
 * Arrow keys nudge the selected wall square to itself in the floor plan: one
 * inch a press (a centimetre in metric), or less when a parallel wall it lines
 * up with comes first (`wall-parallel-snap`), so it stops flush. The arrow's
 * direction on screen picks the way; an arrow along the wall does nothing.
 * The nudge is the side arrows' push (`commitRoomPush`), so joined walls
 * follow, jogs and overlaps come out as when the wall is pushed, and each
 * press is one undo step.
 */

import {
  type AnyNodeId,
  getPerpendicularWallMoveAxis,
  useScene,
  type WallNode,
  type WallPlanPoint,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { commitRoomPush } from './room-handle-drag'
import { levelSeparatorLines, separatorWallLine } from './separator-lines'
import { nudgeWallPosition, wallParallelTargets } from './wall-parallel-snap'

/** One nudge in feet and inches, in metres. */
export const WALL_NUDGE_IMPERIAL = 0.0254
/** One nudge in metric, in metres. */
export const WALL_NUDGE_METRIC = 0.01

const ARROW_SCREEN_DIRECTIONS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}

// An arrow within about 67° of the wall's own direction runs along it.
const MIN_ACROSS = 0.4

/** True for the four bare arrow keys. */
export function isWallNudgeKey(key: string): boolean {
  return key in ARROW_SCREEN_DIRECTIONS
}

/**
 * The plan direction an arrow points on screen: the shown floor plan's scene
 * transform, turned or not, maps it back. Null when no floor plan is shown.
 */
export function floorplanArrowDirection(key: string): WallPlanPoint | null {
  const screen = ARROW_SCREEN_DIRECTIONS[key]
  if (!screen || typeof document === 'undefined') return null
  const scenes = document.querySelectorAll<SVGGraphicsElement>('[data-floorplan-scene]')
  for (const scene of scenes) {
    const rect = scene.ownerSVGElement?.getBoundingClientRect()
    const ctm = scene.getScreenCTM()
    if (!ctm || !rect || rect.width === 0 || rect.height === 0) continue
    const inverse = ctm.inverse()
    const origin = new DOMPoint(0, 0).matrixTransform(inverse)
    const tip = new DOMPoint(screen[0], screen[1]).matrixTransform(inverse)
    const dx = tip.x - origin.x
    const dz = tip.y - origin.y
    const length = Math.hypot(dx, dz)
    if (length > 1e-12) return [dx / length, dz / length]
  }
  return null
}

/**
 * How far (signed, along the wall's move axis) one nudge of `wall` in plan
 * direction `direction` goes; null when the direction runs along the wall.
 */
export function wallNudgeDistance(
  wall: WallNode,
  direction: WallPlanPoint,
  walls: readonly WallNode[],
  step: number,
): { axis: WallPlanPoint; distance: number } | null {
  const axis = getPerpendicularWallMoveAxis(wall.start, wall.end)
  if (!axis) return null
  const across = direction[0] * axis[0] + direction[1] * axis[1]
  if (Math.abs(across) < MIN_ACROSS) return null
  const position = wall.start[0] * axis[0] + wall.start[1] * axis[1]
  const end = nudgeWallPosition(
    wallParallelTargets(wall, axis, walls),
    position,
    Math.sign(across) * step,
  )
  return { axis, distance: end - position }
}

/**
 * Nudge the one selected wall for an arrow key while the floor plan is shown.
 * An invisible wall nudges the same way, as a line: it stops flush with the
 * walls and the other invisible walls, and those joined to it follow.
 * Returns true when the key was used.
 */
export function nudgeSelectedWall(key: string): boolean {
  const { selectedIds } = useViewer.getState().selection
  if (selectedIds.length !== 1) return false
  const nodes = useScene.getState().nodes
  const selected = nodes[selectedIds[0] as AnyNodeId]
  if (selected?.type !== 'wall' && selected?.type !== 'separator') return false
  const direction = floorplanArrowDirection(key)
  if (!direction) return false

  const walls = Object.values(nodes).filter(
    (entry): entry is WallNode => entry?.type === 'wall' && entry.parentId === selected.parentId,
  )
  const step = useViewer.getState().unit === 'imperial' ? WALL_NUDGE_IMPERIAL : WALL_NUDGE_METRIC
  const nudge =
    selected.type === 'wall'
      ? wallNudgeDistance(selected, direction, walls, step)
      : wallNudgeDistance(
          separatorWallLine(selected),
          direction,
          [...walls, ...levelSeparatorLines(nodes, selected.parentId, new Set([selected.id]))],
          step,
        )
  if (!nudge) return false
  commitRoomPush(
    selected.type === 'wall'
      ? { wallId: selected.id, t0: 0, t1: 1 }
      : {
          wallId: selected.id,
          t0: 0,
          t1: 1,
          separators: [{ separatorId: selected.id, t0: 0, t1: 1 }],
        },
    nudge.axis,
    nudge.distance,
  )
  return true
}
