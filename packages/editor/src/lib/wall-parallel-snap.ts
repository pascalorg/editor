/**
 * Lines a wall that is moving sideways up with the parallel walls around it:
 * a face onto the face on the same side of another wall, or its body centre
 * onto theirs. An outside wall broken up by partitions moves one piece at a
 * time, so each piece can be pulled back flush with the rest of the outside.
 *
 * A wall with an outdoor face lines up only with other outside walls; any
 * other wall lines up with every wall on its level. The 2D and 3D wall moves
 * snap through here, and the arrow-key nudge stops on these positions.
 */

import {
  getWallFaceOffsets,
  isCurvedWall,
  type WallNode,
  type WallPlanPoint,
} from '@pascal-app/core'
import useAlignmentGuides from '../store/use-alignment-guides'

/** How near (metres) a moving wall comes to lining up before it snaps there. */
export const WALL_PARALLEL_SNAP_RADIUS = 0.15

// Walls within about 1° of each other count as parallel.
const PARALLEL_TOLERANCE = Math.sin(Math.PI / 180)
const SAME_POSITION = 1e-6

type MovingWall = Pick<
  WallNode,
  'id' | 'start' | 'end' | 'thickness' | 'justification' | 'frontSide' | 'backSide'
> &
  Partial<Pick<WallNode, 'curveOffset'>>

/**
 * A position where the moving wall lines up with another: `position` is where
 * its reference line sits along the move axis, `from` → `to` the shared face
 * or centre line, drawn along both walls.
 */
export type WallParallelTarget = {
  position: number
  wallId: string
  from: WallPlanPoint
  to: WallPlanPoint
}

function isOutsideWall(wall: Pick<WallNode, 'frontSide' | 'backSide'>): boolean {
  return wall.frontSide === 'exterior' || wall.backSide === 'exterior'
}

function direction(wall: Pick<WallNode, 'start' | 'end'>): WallPlanPoint | null {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  return length > 1e-9 ? [dx / length, dz / length] : null
}

const dot = (a: readonly [number, number], b: readonly [number, number]) =>
  a[0] * b[0] + a[1] * b[1]

// Which way the wall's left normal (-dy, dx) runs along `axis`.
function normalSign(dir: WallPlanPoint, axis: WallPlanPoint): number {
  return Math.sign(dot([-dir[1], dir[0]], axis)) || 1
}

/**
 * The wall's faces and body centre along `axis`, relative to its reference
 * line: the face on the axis's positive side, the other face, the centre.
 */
function sidePlanes(wall: MovingWall, dir: WallPlanPoint, axis: WallPlanPoint) {
  const sign = normalSign(dir, axis)
  const { a, b } = getWallFaceOffsets(wall)
  const high = Math.max(a * sign, b * sign)
  const low = Math.min(a * sign, b * sign)
  return [high, low, (high + low) / 2] as const
}

/**
 * The order to try a wall's planes in, so the guide of planes that coincide
 * is drawn on its outdoor face (frontSide is the left-normal side), else on
 * its centre.
 */
function planeOrder(wall: MovingWall, dir: WallPlanPoint, axis: WallPlanPoint): number[] {
  const outdoor = wall.frontSide === 'exterior' ? 1 : wall.backSide === 'exterior' ? -1 : 0
  const outward = outdoor * normalSign(dir, axis)
  return outward > 0 ? [0, 1, 2] : outward < 0 ? [1, 0, 2] : [2, 0, 1]
}

/**
 * Every position along `axis` (a unit vector square to the wall) where `wall`
 * lines up with a parallel wall in `walls`.
 */
export function wallParallelTargets(
  wall: MovingWall,
  axis: WallPlanPoint,
  walls: readonly WallNode[],
): WallParallelTarget[] {
  const dir = direction(wall)
  if (!dir || isCurvedWall(wall)) return []
  const own = sidePlanes(wall, dir, axis)
  const outsideOnly = isOutsideWall(wall)
  const ownSpan = [dot(wall.start, dir), dot(wall.end, dir)]
  const targets: WallParallelTarget[] = []

  for (const other of walls) {
    if (other.id === wall.id || isCurvedWall(other)) continue
    if (outsideOnly && !isOutsideWall(other)) continue
    const otherDir = direction(other)
    if (!otherDir || Math.abs(otherDir[0] * dir[1] - otherDir[1] * dir[0]) > PARALLEL_TOLERANCE) {
      continue
    }
    const line = dot(other.start, axis)
    const planes = sidePlanes(other, otherDir, axis)
    const along = [...ownSpan, dot(other.start, dir), dot(other.end, dir)]
    const lo = Math.min(...along)
    const hi = Math.max(...along)
    const seen: number[] = []
    for (const index of planeOrder(other, otherDir, axis)) {
      const shared = line + planes[index]!
      const position = shared - own[index]!
      if (seen.some((value) => Math.abs(value - position) < SAME_POSITION)) continue
      seen.push(position)
      targets.push({
        position,
        wallId: other.id,
        from: [dir[0] * lo + axis[0] * shared, dir[1] * lo + axis[1] * shared],
        to: [dir[0] * hi + axis[0] * shared, dir[1] * hi + axis[1] * shared],
      })
    }
  }
  return targets
}

/** The target nearest `position`, if one is within `radius`. */
export function nearestWallParallelTarget(
  targets: readonly WallParallelTarget[],
  position: number,
  radius = WALL_PARALLEL_SNAP_RADIUS,
): WallParallelTarget | null {
  let best: WallParallelTarget | null = null
  for (const target of targets) {
    const gap = Math.abs(target.position - position)
    if (gap > radius) continue
    if (!best || gap < Math.abs(best.position - position)) best = target
  }
  return best
}

/**
 * Where a nudge of `step` (signed, along the axis) from `position` ends: the
 * full step, or the first line-up it passes on the way.
 */
export function nudgeWallPosition(
  targets: readonly WallParallelTarget[],
  position: number,
  step: number,
): number {
  let end = position + step
  for (const target of targets) {
    const travel = (target.position - position) * Math.sign(step)
    if (travel > SAME_POSITION && travel < Math.abs(step) - SAME_POSITION) {
      if (Math.abs(target.position - position) < Math.abs(end - position)) end = target.position
    }
  }
  return end
}

/** Show the line a moving wall has snapped onto (null clears it). */
export function publishWallParallelGuide(target: WallParallelTarget | null): void {
  if (!target) {
    useAlignmentGuides.getState().clear()
    return
  }
  useAlignmentGuides.getState().setDraft({
    lines: [{ kind: 'alignment', from: target.from, to: target.to }],
    intersections: [],
  })
}
