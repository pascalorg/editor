/**
 * The colours a tool in hand draws with, in one place: the cursor target, a
 * draft's outline and fill, and a draft the tool refuses. `CursorSphere` and the
 * floor plan's palette read them here; kind-owned tools import them instead of
 * repeating the values.
 */

/** Cursor target, draft outline and draft fill in 3D, and on the dark plan (indigo-400). */
export const TOOL_PREVIEW_COLOR = '#818cf8'

/** A draft the tool refuses (red-500), as the rectangle room, room divide and floor region show it. */
export const TOOL_INVALID_COLOR = '#ef4444'

/** Opacity of the area a polygon draft encloses in 3D (the slab and zone tools' fill). */
export const TOOL_DRAFT_FILL_OPACITY = 0.15

/** The outline of a selected object's boundary between its handles in 3D (neutral-400), as the slab's. */
export const BOUNDARY_OUTLINE_COLOR = '#a3a3a3'

export type PlanDraftColors = {
  /** Fill of the area being drawn, and of the plan's draft polygons. */
  fill: string
  /** Outline and vertex markers of a draft. */
  stroke: string
  /** The target under the pointer. */
  cursor: string
}

/** The floor plan's draft colours: lighter on the dark sheet, deeper on the white one. */
export function planDraftColors(isDark: boolean): PlanDraftColors {
  return isDark
    ? { fill: TOOL_PREVIEW_COLOR, stroke: '#c7d2fe', cursor: TOOL_PREVIEW_COLOR }
    : { fill: '#6366f1', stroke: '#4338ca', cursor: '#6366f1' }
}
