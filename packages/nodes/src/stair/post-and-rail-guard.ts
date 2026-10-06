/**
 * One coherent deck post-and-rail guard laid out along a rail path, as oriented
 * boxes — the AWC Deck Construction Guide (DCA 6) guard in metres: a 4x4 post
 * at each end (and every bay ≤ 4 ft between), a flat 2x6 cap over them with a
 * 2x4 top rail on edge under it, a 2x4 bottom rail held off the nosing line,
 * and 1½ in square pickets between the rails at a gap under the 4 in sphere
 * (IRC R312.1.3). It shares the path sampling, corner finding and newel/picket
 * stations in `guard-path.ts` with the baluster guard, so a straight flight, a
 * chained L/U landing turn, a winder, a curved or spiral sweep and an
 * integrated top landing all read as the same guard; only the sections and
 * joinery differ from the balusters. Pure data — no Three.js, no React.
 *
 * `reach` runs the rails that far past the top vertex along the final slope to
 * die into a post standing there; `topPost: false` then omits the top post.
 * `postThrough` runs the posts past the cap with a small cap of their own.
 */

import {
  buildGuardChassis,
  type GuardBox,
  type GuardRail,
  guardPickets,
  type Vec3,
} from './guard-path'

export type PostAndRailGuardOptions = {
  railHeight: number
  /** Metres between posts along the run; omit (or Infinity) for ends only. */
  postSpacing?: number
  topPost?: boolean
  postThrough?: boolean
  /** Metres the rails run past the top vertex, along the final slope. */
  reach?: number
}

// Dressed deck lumber, in metres.
const POST = 0.0889 // 4x4
const POST_EMBED = 0.05 // the post foot runs this far below the nosing line
const CAP_W = 0.1397 // 2x6 cap, laid flat
const CAP_T = 0.0381
const RAIL_T = 0.0381 // 2x4 rail across the run
const RAIL_D = 0.0889 // on edge, so this is its vertical depth
const BOTTOM_CLEAR = 0.0889 // underside of the bottom rail over the nosing line
const PICKET = 0.0381 // 2x2 picket
const PICKET_GAP = 0.0889 // 3½ in nominal gap
/** The widest clear gap left between pickets, in metres (0.1016 m = 4 in sphere). */
const PICKET_MAX_GAP = 0.1016
const POST_ABOVE_CAP = 0.0762 // a through-post stands this far above the cap…
const POST_CAP_T = 0.0254 // …under a 1 in cap of its own
const POST_CAP_OVERHANG = 0.0508

/** The deck guard's rails, bottom-to-top: a 2x4 bottom rail, a 2x4 top rail on
 * edge under the cap, and the flat 2x6 cap. Shared with the flight connector. */
export function postAndRailGuardRails(railHeight: number): GuardRail[] {
  return [
    { y: BOTTOM_CLEAR + RAIL_D / 2, across: RAIL_T, vertical: RAIL_D },
    { y: railHeight - CAP_T - RAIL_D / 2, across: RAIL_T, vertical: RAIL_D },
    { y: railHeight - CAP_T / 2, across: CAP_W, vertical: CAP_T },
  ]
}

export function buildPostAndRailGuard(
  points: Vec3[],
  options: PostAndRailGuardOptions,
): GuardBox[] {
  const { railHeight } = options
  const chassis = buildGuardChassis(
    points,
    options,
    postAndRailGuardRails(railHeight),
    {
      width: POST,
      embed: POST_EMBED,
      top: -CAP_T,
      throughTop: POST_ABOVE_CAP,
      capThickness: POST_CAP_T,
      capOverhang: POST_CAP_OVERHANG,
    },
    {
      picketPitch: PICKET + PICKET_GAP,
      picketMinPitch: PICKET + 0.02,
      picketMaxPitch: PICKET_MAX_GAP + PICKET,
    },
  )
  if (!chassis) return []
  const { path, boxes } = chassis
  if (path.kind === 'pivot') return boxes
  boxes.push(
    ...guardPickets(path, PICKET, POST, BOTTOM_CLEAR + RAIL_D, railHeight - CAP_T - RAIL_D),
  )

  return boxes
}
