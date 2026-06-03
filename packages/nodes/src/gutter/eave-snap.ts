import type { RoofSegmentNode, RoofType } from '@pascal-app/core'

/**
 * Shared eave-snap math for the gutter's placement + move tools.
 *
 * `resolveEaveSnap` finds the drip edge of the eave closest to a
 * cursor hit in segment-local coords. It supports every roof type the
 * segment renderer can produce; the difference vs the original
 * `±Z`-only resolver is hip/flat awareness (4-way eave instead of 2)
 * and shed's single low eave.
 *
 * Why this lives outside the tools: the two tool files used to inline
 * an identical copy of the resolver + the tuck constants, with a
 * "keep in sync" comment that becomes a landmine as soon as the
 * resolver grows non-trivial. Hip's 4-way picker pushed it past that
 * threshold.
 */

// Real gutters mount on the fascia (slightly inside the drip edge),
// with the rim at the deck-top line rather than the slope-surface-at-
// drip-edge. These tuck the snap so the gutter reads as "attached to
// the fascia" rather than "floating at the very tip of the overhang".
// Tuned by feel — bump them up if the gutter looks too low / outboard.
export const EAVE_TUCK_INWARD = 0.04
export const EAVE_TUCK_UP = 0.04

export type EaveSide = '+X' | '-X' | '+Z' | '-Z'

export type EaveSnap = {
  /** Segment-local X of the snapped gutter position. */
  eaveX: number
  /** Segment-local Y of the snapped gutter position (drip-edge Y). */
  eaveY: number
  /** Segment-local Z of the snapped gutter position. */
  eaveZ: number
  /**
   * Gutter's segment-local Y rotation: orients gutter's outward axis
   * (+Z local) toward the side picked. Length axis (+X local) falls
   * out along the eave direction (±X or ±Z depending on the side).
   */
  rotation: number
  /** Which side of the segment the snap landed on. */
  side: EaveSide
}

/**
 * Live eave Y from a segment's wallHeight + overhang + pitch. Pulled
 * out as a shared helper because the renderer derives Y from this same
 * formula on every frame (the gutter tracks the segment's height
 * instead of trusting `node.position[1]` from placement time), and
 * `resolveEaveSnap` uses the same formula at placement.
 */
export function computeEaveY(
  segment: Pick<RoofSegmentNode, 'wallHeight' | 'overhang' | 'pitch' | 'roofType'>,
): number {
  const wallHeight = segment.wallHeight ?? 0
  // Flat roofs have no slope drop and no slope-surface-vs-deck-top
  // offset — the deck top IS the eave line. EAVE_TUCK_UP is a
  // correction that lifts a SLOPED gutter from the slope-surface up to
  // the deck-top line; applying it to a flat deck floats the gutter
  // above the roof and leaves a visible gap between the edge and the
  // gutter. So mount flat gutters right at the deck top.
  if ((segment.roofType ?? 'gable') === 'flat') return wallHeight
  const overhang = segment.overhang ?? 0
  const pitchRad = ((segment.pitch ?? 0) * Math.PI) / 180
  return wallHeight - overhang * Math.tan(pitchRad) + EAVE_TUCK_UP
}

/**
 * Pick which of the segment's eaves is closest to the cursor.
 *
 *  - `shed`: low side only. The segment-hit's analytical surface for
 *    a shed has `t = (lz + depth/2)/depth`, so the eave is at +Z
 *    regardless of which side the cursor is on — clicking on the high
 *    side still rolls the gutter down to the low eave.
 *
 *  - `hip` / `flat` / `dutch`: 4-way. The slope the user is standing
 *    on is determined by whichever of `|lx|/halfW` or `|lz|/halfD` is
 *    larger — same `max(fx, fz)` discriminator the segment-hit's
 *    `analyticalSurfaceY` uses for hip. Sign of the dominant axis
 *    picks +/-. Dutch is a hip base with a gablet on top, so its
 *    lower run has all four eaves at the eave line — it gets the same
 *    4-way snap as hip.
 *
 *  - `gable` / `gambrel` / `mansard`: 2-way `±Z`. Mansard has real
 *    4-side eaves in plan, but the segment-hit formula approximates it
 *    as 2-slope (depth-only), so we stay consistent here — the user
 *    can re-place the gutter manually on a side eave if mansard
 *    becomes important.
 */
function pickEaveSide(
  roofType: RoofType,
  localX: number,
  localZ: number,
  halfW: number,
  halfD: number,
): EaveSide {
  if (roofType === 'shed') return '+Z'

  if (roofType === 'hip' || roofType === 'flat' || roofType === 'dutch') {
    const fx = halfW > 0 ? Math.abs(localX) / halfW : 0
    const fz = halfD > 0 ? Math.abs(localZ) / halfD : 0
    if (fx > fz) return localX < 0 ? '-X' : '+X'
    return localZ < 0 ? '-Z' : '+Z'
  }

  return localZ < 0 ? '-Z' : '+Z'
}

export function resolveEaveSnap(
  segment: RoofSegmentNode,
  localX: number,
  localZ: number,
): EaveSnap {
  const halfW = (segment.width ?? 0) / 2
  const halfD = (segment.depth ?? 0) / 2
  const overhang = segment.overhang ?? 0

  // The slope keeps descending past the wall edge by the overhang
  // span; same drop on every eave (pitch is the segment-wide primary
  // slope). EAVE_TUCK_UP raises the rim back toward the deck-top line.
  // Shared formula with the renderer so placement and live tracking
  // agree exactly.
  const eaveY = computeEaveY(segment)

  const side = pickEaveSide(segment.roofType ?? 'gable', localX, localZ, halfW, halfD)

  // For `±Z` eaves the eave runs along ±X so the parallel axis stays
  // free (snapped to cursor's X), and Z pins to the drip edge. `±X`
  // eaves swap which axis is free vs pinned. Rotation aligns the
  // gutter's outward (+Z local) with the picked side; length (+X
  // local) then falls along the eave.
  switch (side) {
    case '+Z':
      return {
        eaveX: localX,
        eaveY,
        eaveZ: Math.max(halfD, halfD + overhang - EAVE_TUCK_INWARD),
        rotation: 0,
        side,
      }
    case '-Z':
      return {
        eaveX: localX,
        eaveY,
        eaveZ: -Math.max(halfD, halfD + overhang - EAVE_TUCK_INWARD),
        rotation: Math.PI,
        side,
      }
    case '+X':
      return {
        eaveX: Math.max(halfW, halfW + overhang - EAVE_TUCK_INWARD),
        eaveY,
        eaveZ: localZ,
        rotation: Math.PI / 2,
        side,
      }
    case '-X':
      return {
        eaveX: -Math.max(halfW, halfW + overhang - EAVE_TUCK_INWARD),
        eaveY,
        eaveZ: localZ,
        rotation: -Math.PI / 2,
        side,
      }
  }
}
