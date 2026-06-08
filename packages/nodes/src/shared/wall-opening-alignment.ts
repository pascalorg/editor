import {
  type AlignmentAnchor,
  resolveAlignment,
  type WallNode,
} from '@pascal-app/core'
import { snapToHalf, useAlignmentGuides } from '@pascal-app/editor'

/** Figma-style alignment-snap threshold (meters), matching the move tools. */
export const WALL_OPENING_ALIGNMENT_THRESHOLD_M = 0.08
/**
 * A wall opening (door / window) can only slide ALONG its host wall, so it can
 * only satisfy an x- or z-guide when the wall runs along that axis. Below this
 * |component| (≈ wall within 60° of the axis) the along-wall move needed to
 * reach the guide blows up, so we skip it rather than jump the opening across
 * the wall.
 */
const MIN_AXIS_COMPONENT = 0.5

/**
 * Resolve a wall opening's along-wall position with Figma-style alignment to
 * other objects, publishing the matching guide as a side effect.
 *
 * The probe is the RAW cursor position on the wall (not the 0.5m snap) so
 * off-grid anchors are caught; we then keep only the guide on an axis the wall
 * runs along and map it to the along-wall coordinate that lands the opening on
 * it. Falls back to the half-metre snap when nothing aligns, and clears the
 * guide on bypass / no-match. Returns the localX to use (X-clamped to the wall
 * given `width`). `bypass` (Alt) disables alignment.
 */
export function resolveWallSlideAlignment(args: {
  wallNode: WallNode
  rawLocalX: number
  width: number
  candidates: readonly AlignmentAnchor[]
  bypass: boolean
}): number {
  const { wallNode, rawLocalX, width, candidates, bypass } = args
  const base = snapToHalf(rawLocalX)
  if (bypass || candidates.length === 0) {
    useAlignmentGuides.getState().clear()
    return base
  }

  const dx = wallNode.end[0] - wallNode.start[0]
  const dz = wallNode.end[1] - wallNode.start[1]
  const wallLength = Math.sqrt(dx * dx + dz * dz)
  if (wallLength < 1e-6) {
    useAlignmentGuides.getState().clear()
    return base
  }
  const cos = dx / wallLength
  const sin = dz / wallLength
  const clampX = (localX: number) => Math.max(width / 2, Math.min(wallLength - width / 2, localX))

  const probe = resolveAlignment({
    moving: [
      {
        nodeId: '__wall-opening-draft__',
        kind: 'corner',
        x: wallNode.start[0] + rawLocalX * cos,
        z: wallNode.start[1] + rawLocalX * sin,
      },
    ],
    candidates,
    threshold: WALL_OPENING_ALIGNMENT_THRESHOLD_M,
  })

  // Keep only a guide on an axis the wall runs along, mapped to the along-wall
  // position that satisfies it; pick the nearest such.
  let bestLocalX: number | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const guide of probe.guides) {
    const denom = guide.axis === 'x' ? cos : sin
    if (Math.abs(denom) < MIN_AXIS_COMPONENT) continue
    const origin = guide.axis === 'x' ? wallNode.start[0] : wallNode.start[1]
    const targetLocalX = (guide.coord - origin) / denom
    const delta = Math.abs(targetLocalX - rawLocalX)
    if (delta < bestDelta) {
      bestDelta = delta
      bestLocalX = targetLocalX
    }
  }
  if (bestLocalX === null) {
    useAlignmentGuides.getState().clear()
    return base
  }

  const clampedX = clampX(bestLocalX)
  // Re-resolve from where the opening actually lands (post-clamp) so the
  // published guide connects to the opening, not the raw cursor.
  const published = resolveAlignment({
    moving: [
      {
        nodeId: '__wall-opening-draft__',
        kind: 'corner',
        x: wallNode.start[0] + clampedX * cos,
        z: wallNode.start[1] + clampedX * sin,
      },
    ],
    candidates,
    threshold: WALL_OPENING_ALIGNMENT_THRESHOLD_M,
  })
  if (published.guides.length === 0) {
    useAlignmentGuides.getState().clear()
  } else {
    useAlignmentGuides.getState().set(published.guides)
  }
  return clampedX
}
