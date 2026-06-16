import { type AlignmentAnchor, resolveAlignment, type WallNode } from '@pascal-app/core'
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
 * given `width`). `bypass` disables alignment; `bypassSnap` also skips the
 * half-metre fallback.
 *
 * `freePlace` (Shift) is the "place anywhere, but still show me where I'd
 * align" mode: the opening lands at the EXACT raw cursor (no grid snap, no
 * jump-to-guide), yet the alignment guides are still computed and shown so the
 * user keeps the visual reference while overriding the magnetic pull. It
 * supersedes `bypass`/`bypassSnap` when set.
 */
export function resolveWallSlideAlignment(args: {
  wallNode: WallNode
  rawLocalX: number
  width: number
  candidates: readonly AlignmentAnchor[]
  bypass: boolean
  bypassSnap?: boolean
  freePlace?: boolean
}): number {
  const {
    wallNode,
    rawLocalX,
    width,
    candidates,
    bypass,
    bypassSnap = false,
    freePlace = false,
  } = args
  const base = bypassSnap || freePlace ? rawLocalX : snapToHalf(rawLocalX)

  const dxAxis = wallNode.end[0] - wallNode.start[0]
  const dzAxis = wallNode.end[1] - wallNode.start[1]
  const axisLength = Math.sqrt(dxAxis * dxAxis + dzAxis * dzAxis)

  // Shift / free-place: land at the raw cursor but still publish the guides so
  // the user sees alignment relationships without being snapped to them. The
  // guides are re-resolved at the freely-placed point so they connect to the
  // opening, not the snap target.
  if (freePlace) {
    if (candidates.length === 0 || axisLength < 1e-6) {
      useAlignmentGuides.getState().clear()
      return base
    }
    const c = dxAxis / axisLength
    const s = dzAxis / axisLength
    const placedX = Math.max(width / 2, Math.min(axisLength - width / 2, base))
    const shown = resolveAlignment({
      moving: [
        {
          nodeId: '__wall-opening-draft__',
          kind: 'corner',
          x: wallNode.start[0] + placedX * c,
          z: wallNode.start[1] + placedX * s,
        },
      ],
      candidates,
      threshold: WALL_OPENING_ALIGNMENT_THRESHOLD_M,
    })
    const axisGuides = shown.guides.filter(
      (g) => Math.abs(g.axis === 'x' ? c : s) >= MIN_AXIS_COMPONENT,
    )
    if (axisGuides.length === 0) useAlignmentGuides.getState().clear()
    else useAlignmentGuides.getState().set(axisGuides)
    return placedX
  }

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
