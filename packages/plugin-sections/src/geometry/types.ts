import type { AnyNode, AnyNodeId, FloorplanGeometry, SceneSnapshot } from '@pascal-app/core'

/**
 * The only bit of a scene the drawing builders read. `SceneSnapshot` itself
 * carries collections / materials / plugin state the builders never touch, so
 * the builders accept the narrower shape and any real snapshot satisfies it.
 */
export type DrawingScene = Pick<SceneSnapshot, 'nodes'>

export type Nodes = Readonly<Record<AnyNodeId, AnyNode>>

export type DrawingBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * DRAWING SPACE — read this before consuming `primitives`.
 *
 * `x` is the horizontal drawing axis in metres (distance along the cut line
 * for a section, distance along the view's right axis for an elevation).
 *
 * `y` is **negated world elevation**: `y = -elevationMetres`. The floor-plan
 * SVG renderer this feeds (`FloorplanGeometryRenderer`) has y growing DOWN the
 * screen, so a drawing that stores `+elevation` would render upside-down. Every
 * primitive therefore carries `-elevation`, and `bounds` is in the same
 * (already negated) space so it can be handed straight to a viewBox.
 *
 * `elevationRange` restates the vertical extent in true world metres for
 * callers that need real heights (schedules, height dimensions, sheet notes).
 */
export type DrawingResult = {
  primitives: FloorplanGeometry[]
  bounds: DrawingBounds
  /** Vertical extent in TRUE world elevation metres (not negated). */
  elevationRange: { min: number; max: number }
  /**
   * Honest record of everything the builder could not compute exactly for
   * this scene — unsupported roof shapes, missing levels, curved walls
   * approximated as chords. Surfaced in the Sections panel; never silent.
   */
  warnings: string[]
}

export type Vec2 = readonly [number, number]

export const EMPTY_BOUNDS: DrawingBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
