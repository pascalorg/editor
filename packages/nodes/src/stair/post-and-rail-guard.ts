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
  add,
  barBox,
  type GuardBox,
  type GuardRail,
  postBox,
  railBars,
  resolveGuardPath,
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

/** How far above the nosing line a post rises: under the cap, or through it. */
function postRise(railHeight: number, postThrough: boolean): number {
  return postThrough ? railHeight + POST_ABOVE_CAP : railHeight - CAP_T
}

/** The small cap sitting on a through-post's top. */
function postCap(x: number, topY: number, z: number): GuardBox {
  return {
    center: [x, topY + POST_CAP_T / 2, z],
    size: [POST + POST_CAP_OVERHANG, POST_CAP_T, POST + POST_CAP_OVERHANG],
    direction: [0, 1, 0],
  }
}

export function buildPostAndRailGuard(
  points: Vec3[],
  options: PostAndRailGuardOptions,
): GuardBox[] {
  const path = resolveGuardPath(points, {
    postSpacing: options.postSpacing,
    topPost: options.topPost,
    reach: options.reach,
    picketPitch: PICKET + PICKET_GAP,
    picketMinPitch: PICKET + 0.02,
    picketMaxPitch: PICKET_MAX_GAP + PICKET,
  })
  if (!path) return []
  const { railHeight } = options
  const postThrough = options.postThrough === true
  const rise = postRise(railHeight, postThrough)

  if (path.kind === 'pivot') {
    // A zero-radius winder's inner pivot: one plumb 4x4 standing the guard's
    // height past the top of the vertical rise, keeping the inner edge's post.
    const { lo, hi } = path
    const base: Vec3 = [lo[0], lo[1] - POST_EMBED, lo[2]]
    const height = hi[1] - lo[1] + rise + POST_EMBED
    const pivot: GuardBox[] = [postBox(base, height, POST)]
    if (postThrough) pivot.push(postCap(lo[0], base[1] + height, lo[2]))
    return pivot
  }

  const { railPoints, isCorner, postPositions, picketStations } = path

  // Cap, top rail and bottom rail follow the path; a block closes each corner.
  const boxes: GuardBox[] = railBars(railPoints, isCorner, postAndRailGuardRails(railHeight))

  // Posts: both ends (the top only when `topPost`), every bay ≤ spacing between.
  for (const p of postPositions) {
    boxes.push(postBox(add(p, [0, -POST_EMBED, 0]), rise + POST_EMBED, POST))
    if (postThrough) boxes.push(postCap(p[0], p[1] + rise, p[2]))
  }

  // Pickets span the two rails, dropped where a post already stands.
  const picketBottom = BOTTOM_CLEAR + RAIL_D
  const picketTop = railHeight - CAP_T - RAIL_D
  const clearPost = (p: Vec3) =>
    postPositions.every(
      (post) => Math.hypot(post[0] - p[0], post[2] - p[2]) > POST / 2 + PICKET / 2,
    )
  for (const p of picketStations) {
    if (!clearPost(p)) continue
    const picket = barBox(
      [p[0], p[1] + picketBottom, p[2]],
      [p[0], p[1] + picketTop, p[2]],
      PICKET,
      PICKET,
    )
    if (picket) boxes.push(picket)
  }

  return boxes
}
