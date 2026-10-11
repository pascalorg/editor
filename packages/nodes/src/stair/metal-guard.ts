/**
 * One coherent metal guard laid out along a rail path, as oriented boxes — a
 * fabricated steel guardrail in metres: a slim square post at each end (and
 * every bay ≤ 4 ft between), welded to a flat baseplate that mounts it to the
 * tread rather than embedding below it, a flat top rail and a bottom rail that
 * follow the path with a fitting block closing every interior corner, and
 * slender square balusters spanning the two rails. It shares the path sampling,
 * corner finding and newel/picket stations in `guard-path.ts` with the baluster,
 * deck post-and-rail, cable, boards and glass guards, so a straight flight, a
 * chained L/U landing turn, a winder, a curved or spiral sweep and an integrated
 * top landing all read as the same guard; only the sections, the surface-mounted
 * feet and the slim infill differ. Pure data — no Three.js, no React.
 *
 * Unlike the wood guards, a steel post is not sunk into the structure: it stands
 * on the nosing line on a baseplate, the mounting foot that grounds it. The
 * infill is plumb slender bars spanning rail to rail, so nothing crosses the
 * walking volume on a slope and every member meets another.
 *
 * `reach` runs the rails that far past the top vertex along the final slope to
 * die into a post standing there; `topPost: false` then omits the top post.
 * `postThrough` runs the posts past the top rail with a small cap of their own.
 */

import {
  buildGuardChassis,
  type GuardBox,
  type GuardRail,
  guardPickets,
  type Vec3,
} from './guard-path'

export type MetalGuardOptions = {
  railHeight: number
  /** Metres between posts along the run; omit (or Infinity) for ends only. */
  postSpacing?: number
  topPost?: boolean
  postThrough?: boolean
  /** Metres the rails run past the top vertex, along the final slope. */
  reach?: number
}

// Fabricated steel guardrail, in metres.
const POST = 0.04 // a slim 1½ in square steel post
const BASEPLATE_W = 0.1 // the welded foot plate that mounts the post…
const BASEPLATE_T = 0.008 // …a thin flat plate sitting on the nosing line
const TOP_RAIL_W = 0.05 // a flat 2 in top rail across the run
const TOP_RAIL_T = 0.03
const BOTTOM_RAIL_W = 0.038 // a slimmer bottom rail across the run
const BOTTOM_RAIL_T = 0.025
const BOTTOM_CLEAR = 0.08 // underside of the bottom rail over the nosing line
const INFILL = 0.016 // a 5⁄8 in square baluster
const INFILL_PITCH = 0.11 // on centre; clears under the 4 in sphere with the bar
/** The widest clear gap left between balusters, in metres (0.1016 m = 4 in sphere). */
const INFILL_MAX_GAP = 0.1016
const POST_ABOVE_RAIL = 0.0762 // a through-post stands this far above the top rail…
const POST_CAP_T = 0.0254 // …under a 1 in cap of its own
const POST_CAP_OVERHANG = 0.0381

/** The metal guard's two rails, bottom-to-top: a slim bottom rail held off the
 * nosing line and a flat top rail with its top at the guard height. Shared with
 * the flight connector so a bridge carries the same rails as the guards it joins. */
export function metalGuardRails(railHeight: number): GuardRail[] {
  return [
    { y: BOTTOM_CLEAR + BOTTOM_RAIL_T / 2, across: BOTTOM_RAIL_W, vertical: BOTTOM_RAIL_T },
    { y: railHeight - TOP_RAIL_T / 2, across: TOP_RAIL_W, vertical: TOP_RAIL_T },
  ]
}

/** The flat baseplate welded under a post foot, sitting on the nosing line. */
function baseplate(x: number, footY: number, z: number): GuardBox {
  return {
    center: [x, footY + BASEPLATE_T / 2, z],
    size: [BASEPLATE_W, BASEPLATE_T, BASEPLATE_W],
    direction: [0, 1, 0],
  }
}

export function buildMetalGuard(points: Vec3[], options: MetalGuardOptions): GuardBox[] {
  const { railHeight } = options
  const chassis = buildGuardChassis(
    points,
    options,
    metalGuardRails(railHeight),
    {
      width: POST,
      embed: 0,
      top: -TOP_RAIL_T,
      throughTop: POST_ABOVE_RAIL,
      capThickness: POST_CAP_T,
      capOverhang: POST_CAP_OVERHANG,
      foot: baseplate,
    },
    {
      picketPitch: INFILL_PITCH,
      picketMinPitch: INFILL + 0.02,
      picketMaxPitch: INFILL_MAX_GAP + INFILL,
    },
  )
  if (!chassis) return []
  const { path, boxes } = chassis
  if (path.kind === 'pivot') return boxes
  boxes.push(
    ...guardPickets(path, INFILL, POST, BOTTOM_CLEAR + BOTTOM_RAIL_T, railHeight - TOP_RAIL_T),
  )

  return boxes
}
