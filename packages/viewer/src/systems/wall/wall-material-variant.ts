/**
 * Which material variant does a wall draw this pass?
 *
 * Extracted from `WallCutout`'s per-wall assignment so the precedence is a
 * testable truth table. Precedence within each display mode:
 *
 *   delete-hover > selection > select-hover > base
 *
 * The SELECT-HOVER variant exists for HIDDEN walls only (QA f2, REVISE):
 * with the Bones X-ray on, hidden walls are hover/selection ray targets
 * (nearest-first, see nodes/wall/pointer-transparency.ts) — but an
 * invisible wall gave no hover feedback at all, so what the user saw
 * lighting up on hover was the furniture BEHIND the wall. Hovering a hidden
 * wall now glows its stipple film. Visible and translucent walls keep their
 * existing hover affordance (the post-processing outline pass) — a material
 * glow there would double-highlight.
 */
export type WallMaterialVariant =
  | 'visible'
  | 'invisible'
  | 'translucent'
  | 'delete-visible'
  | 'delete-invisible'
  | 'delete-translucent'
  | 'selection-visible'
  | 'selection-invisible'
  | 'selection-translucent'
  | 'hover-invisible'

export const resolveWallMaterialVariant = ({
  translucentMode,
  hidden,
  deleteHighlighted,
  selectionHighlighted,
  hoverHighlighted,
}: {
  /** wallMode === 'translucent' (overrides the hide state). */
  translucentMode: boolean
  /** The wall-mode pass hides this wall ('down', cutaway, auto-interior). */
  hidden: boolean
  /** Delete-mode hover on this wall (deleteInvisible flow). */
  deleteHighlighted: boolean
  /** Selected (and the wall's face-band config allows the highlight). */
  selectionHighlighted: boolean
  /** Select-mode hover on this wall (useViewer.hoveredId). */
  hoverHighlighted: boolean
}): WallMaterialVariant => {
  const base = translucentMode ? 'translucent' : hidden ? 'invisible' : 'visible'
  if (deleteHighlighted) return `delete-${base}`
  if (selectionHighlighted) return `selection-${base}`
  if (hoverHighlighted && base === 'invisible') return 'hover-invisible'
  return base
}
