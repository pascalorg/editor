/**
 * GRADE — the reference surface every utility elevation is measured from.
 *
 * A `utility-line` vertex stores its y RELATIVE TO GRADE, not as an absolute
 * site elevation and not relative to a building level origin:
 *   - underground: a NEGATIVE y = cover below grade;
 *   - overhead:    a POSITIVE y = attachment height above grade.
 * `resolveLineEndpoints` turns that into an absolute SITE elevation by adding
 * `gradeElevationAt` at each vertex, and the renderers then convert to the
 * building-local frame. That ordering is the fix for the buried-run defect:
 * previously the stored y went straight into the building-local frame, so a
 * building whose origin sits above grade dragged the trench and the buried
 * tube up with it (`siteToLocal` subtracts `frame.origin[1]`), and the
 * surface trench ribbon was drawn 15 mm above the BUILDING ORIGIN rather
 * than 15 mm above the ground.
 *
 * LIMIT, stated rather than papered over: this package has NO terrain model.
 * There is no elevation grid, no spot-grade node and no contour set in the
 * scene graph today, so grade is the FLAT site plane y = 0 everywhere — the
 * same plane the site plan and the parcel ring live on (WS1 contract,
 * docs/construction-documents.md). The per-vertex signature exists so that
 * when a terrain or spot-grade source does land, every elevation in this
 * package starts reading it from one place instead of thirty. Nothing here
 * asserts a real ground elevation.
 */

import type { LooseNodes } from '../site-frame'

/** Absolute SITE elevation of grade at a plan point, metres. Flat: 0. */
export function gradeElevationAt(
  _nodes: LooseNodes | null,
  _plan: readonly [number, number],
): number {
  return 0
}

/** Height above grade of the faint surface trench ribbon, metres. */
export const TRENCH_HEIGHT_ABOVE_GRADE = 0.015
