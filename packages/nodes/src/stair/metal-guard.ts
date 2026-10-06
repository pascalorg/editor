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
  add,
  barBox,
  type GuardBox,
  type GuardRail,
  postBox,
  railBars,
  resolveGuardPath,
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

/** How far above the nosing line a post rises: under the top rail, or through it. */
function postRise(railHeight: number, postThrough: boolean): number {
  return postThrough ? railHeight + POST_ABOVE_RAIL : railHeight - TOP_RAIL_T
}

/** The flat baseplate welded under a post foot, sitting on the nosing line. */
function baseplate(x: number, footY: number, z: number): GuardBox {
  return {
    center: [x, footY + BASEPLATE_T / 2, z],
    size: [BASEPLATE_W, BASEPLATE_T, BASEPLATE_W],
    direction: [0, 1, 0],
  }
}

/** The small cap sitting on a through-post's top. */
function postCap(x: number, topY: number, z: number): GuardBox {
  return {
    center: [x, topY + POST_CAP_T / 2, z],
    size: [POST + POST_CAP_OVERHANG, POST_CAP_T, POST + POST_CAP_OVERHANG],
    direction: [0, 1, 0],
  }
}

export function buildMetalGuard(points: Vec3[], options: MetalGuardOptions): GuardBox[] {
  const path = resolveGuardPath(points, {
    postSpacing: options.postSpacing,
    topPost: options.topPost,
    reach: options.reach,
    picketPitch: INFILL_PITCH,
    picketMinPitch: INFILL + 0.02,
    picketMaxPitch: INFILL_MAX_GAP + INFILL,
  })
  if (!path) return []
  const { railHeight } = options
  const postThrough = options.postThrough === true
  const rise = postRise(railHeight, postThrough)

  if (path.kind === 'pivot') {
    // A zero-radius winder's inner pivot: one plumb post on its baseplate keeps
    // the inner edge's support; a single pivot has no bay to infill.
    const { lo, hi } = path
    const height = hi[1] - lo[1] + rise
    const pivot: GuardBox[] = [postBox(lo, height, POST), baseplate(lo[0], lo[1], lo[2])]
    if (postThrough) pivot.push(postCap(lo[0], lo[1] + height, lo[2]))
    return pivot
  }

  const { railPoints, isCorner, postPositions, picketStations } = path

  // Top and bottom rails follow the path; a fitting block closes each corner.
  const boxes: GuardBox[] = railBars(railPoints, isCorner, metalGuardRails(railHeight))

  // Posts stand on the nosing line on a baseplate — both ends (the top only when
  // `topPost`), every bay ≤ spacing between — never sunk below the structure.
  for (const p of postPositions) {
    boxes.push(postBox(p, rise, POST))
    boxes.push(baseplate(p[0], p[1], p[2]))
    if (postThrough) boxes.push(postCap(p[0], p[1] + rise, p[2]))
  }

  // Slender plumb balusters span the two rails, dropped where a post stands.
  const infillBottom = BOTTOM_CLEAR + BOTTOM_RAIL_T
  const infillTop = railHeight - TOP_RAIL_T
  const clearPost = (p: Vec3) =>
    postPositions.every(
      (post) => Math.hypot(post[0] - p[0], post[2] - p[2]) > POST / 2 + INFILL / 2,
    )
  for (const p of picketStations) {
    if (!clearPost(p)) continue
    const bar = barBox(
      [p[0], p[1] + infillBottom, p[2]],
      [p[0], p[1] + infillTop, p[2]],
      INFILL,
      INFILL,
    )
    if (bar) boxes.push(bar)
  }

  return boxes
}
