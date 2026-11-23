import type { HedgeNode } from '../schema'
import type { HedgeFootRun } from './hedge-ground'

/**
 * THE CONTRACT OF A HEDGE'S FORM.
 *
 * A form is the part of the hedge that is craft: the section, the bulges, the leaves, the colour.
 * It is one object, registered under the generator version a hedge stores as `gen`. Everything
 * around it is not the form's concern and does not change when a form is replaced: the stored
 * node, the smoothing of the line, the openings, the ground under each station, the caps, the
 * material, the 2D symbol and the agent tool.
 *
 * In: `HedgeFormInput`. The planted runs as stations already standing on the ground (Site frame,
 * metres, y up): each station gives its centre, its direction of travel, the metres travelled,
 * its curvature, and the ground under its centre and under both base edges. Plus the hedge's own
 * numbers and seed.
 *
 * Out, from `build`: one `HedgeMesh` a chunk, as indexed triangles in the Site's frame.
 *   - `position`, `normal`, `color`: three floats a vertex. `color` is linear RGB, 0 to 1, and is
 *     the whole look: the material samples no texture and reads no UV. No other attribute.
 *   - `index`: the body's triangles first (`bodyIndexCount` indices), then the leaves', so a
 *     reader can draw the body alone. Triangles are wound counter-clockwise seen from outside.
 *   - The body is one surface with shared vertices and smooth normals; two chunks of one run
 *     meet on the same ring of positions and normals.
 *   - The base stands on the ground the stations give, sunk by `HEDGE_EMBED`; nothing reaches
 *     beyond the ground band `hedgeBands` gives by more than the form's own bulge.
 *
 * `estimate` answers what `build` would emit and allocates nothing whose size grows with the
 * hedge. It is exact for the forms here; a form may answer an upper bound, never less than it
 * builds. It keeps `triangles` within `HEDGE_MAX_TRIANGLES` by thinning, never by cutting the
 * hedge short. `buildHedge` refuses to call `build` on an estimate over the cap.
 *
 * Determinism: the same input gives the same bytes. A form uses no `Math.random`, no clock and
 * nothing outside its input; the forms here use only `+ − × ÷` and `Math.sqrt`, `floor`, `imul`,
 * which are bit-exact across engines. (The line work before a form calls `Math.hypot` inside the
 * fence's spline when `curve` is set: the same engine gives the same bytes; two engines were not
 * compared.)
 */
export type HedgeFormInput = Pick<
  HedgeNode,
  'height' | 'width' | 'clip' | 'leafSize' | 'leafColor' | 'seed'
> & {
  runs: readonly HedgeFootRun[]
  /** The length over which a run's end is rounded (`HedgeLine.endRadius`). */
  endRadius: number
}

export type HedgeMesh = {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  index: Uint16Array | Uint32Array
  /** The first `bodyIndexCount` indices draw the body; the rest draw the leaves. */
  bodyIndexCount: number
}

export type HedgeEstimate = {
  triangles: number
  vertices: number
  bodyTriangles: number
  leaves: number
  meshes: number
}

/**
 * The most triangles one hedge may hold, however long: the builder thins leaves to stay under it.
 */
export const HEDGE_MAX_TRIANGLES = 120_000
