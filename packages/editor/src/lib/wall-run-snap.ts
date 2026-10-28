/**
 * Snapping for the wall tool's line runs once their first point is placed —
 * the Walls run (its tile, the Exterior and Interior wall tools), a Polygon
 * room's sides, and a run pulled from a wall end (`wall-pull.ts`).
 *
 * Each wall holds square: straight on from the wall before it, square to it,
 * or along the house's axes within about 7°, and on 15° steps past that, with
 * its length on the grid; existing walls, the run's start and the projection
 * guides win over that (`snapWallPullPoint`). Alt, or snapping off, leaves the
 * end at the cursor. The run's first point keeps the tool's own snapping.
 *
 * The 3D wall tool and the floor plan each draft a run from their own start,
 * run start and previous wall, and snap through here, so both views place the
 * same point; the view that owns the input publishes the guides and marker.
 */

import type { WallNode, WallPlanPoint } from '@pascal-app/core'
import { getSegmentGridStep } from '../components/tools/wall/wall-drafting'
import { snapWallPullPoint, type WallPullSnapResult } from '../components/tools/wall/wall-pull-snap'
import useAlignmentGuides from '../store/use-alignment-guides'
import { getActiveSnappingMode } from '../store/use-editor'
import useWallSnapIndicator from '../store/use-wall-snap-indicator'

/** True while a run's walls follow the cursor freely: Alt, or snapping off. */
export function isWallRunFree(event?: { altKey?: boolean } | null): boolean {
  return Boolean(event?.altKey) || getActiveSnappingMode() === 'off'
}

/** Unit direction of a placed wall `start` → `end`: the next wall holds square to it. */
export function wallRunDirection(start: WallPlanPoint, end: WallPlanPoint): WallPlanPoint | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return length > 1e-9 ? [dx / length, dz / length] : null
}

/**
 * Snap the drafted end of a run's current wall, which starts at `start`.
 * `runStart` is where the run began, `reference` the direction of the wall
 * before (null for the run's first wall), and `walls` the level's walls with
 * any open Polygon room's sides.
 */
export function snapWallRunDraftPoint(args: {
  point: WallPlanPoint
  start: WallPlanPoint
  runStart: WallPlanPoint
  reference: WallPlanPoint | null
  walls: readonly WallNode[]
  free: boolean
}): WallPullSnapResult {
  return snapWallPullPoint({ ...args, gridStep: getSegmentGridStep() })
}

/**
 * Show a run's snap: its projection guides and crossings (the alignment guide
 * layers draw them) and the snap marker with what it caught. Null clears both.
 */
export function publishWallRunFeedback(result: WallPullSnapResult | null): void {
  if (!result) {
    useAlignmentGuides.getState().clear()
    useWallSnapIndicator.getState().clear()
    return
  }
  useAlignmentGuides.getState().setDraft({
    lines: result.guides.map((guide) => ({
      kind: guide.kind,
      from: [guide.from[0], guide.from[1]],
      to: [guide.to[0], guide.to[1]],
    })),
    intersections: result.intersections.map((point) => [point[0], point[1]]),
  })
  useWallSnapIndicator.getState().set(
    result.snap
      ? {
          x: result.point[0],
          z: result.point[1],
          kind: result.snap,
          wallIds: result.targetWallIds.length > 0 ? result.targetWallIds : undefined,
          label: result.label ?? undefined,
        }
      : null,
  )
}
