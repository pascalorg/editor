/**
 * One coherent cable guard laid out along a rail path, as oriented boxes — the
 * modern metal cable rail in metres: a slim square post at each end (and every
 * bay ≤ 4 ft between), a flat cap rail following the path over them, and
 * slender round cables run as straight spans from post to post, with a short
 * swage sleeve where each cable dies into a terminal post. It shares the path
 * sampling, corner finding and newel/picket stations in `guard-path.ts` with
 * the baluster and deck post-and-rail guards, so a straight flight, a chained
 * L/U landing turn, a winder, a curved or spiral sweep and an integrated top
 * landing all read as the same cable rail; only the sections and the infill
 * differ. Pure data — no Three.js, no React.
 *
 * The cables are the physical intent of a cable rail, not a fiction: real cable
 * is pulled taut, so on a curved or spiral sweep it cannot follow the arc. Each
 * cable level is therefore a run of straight chords between consecutive posts
 * (the posts are the support stations, spaced by run and so independent of the
 * tread count), while the cap rail follows the curve. On a straight flight the
 * collinear posts make those chords read as one line.
 *
 * `reach` runs the cap and the top cables that far past the top vertex along
 * the final slope to die into a post standing there; `topPost: false` then
 * omits the top post. `postThrough` runs the posts past the cap with a small
 * cap of their own.
 */

import {
  add,
  barBox,
  type GuardBox,
  type GuardRail,
  postBox,
  railBars,
  resolveGuardPath,
  scale,
  sub,
  type Vec3,
} from './guard-path'

export type CableGuardOptions = {
  railHeight: number
  /** Metres between posts along the run; omit (or Infinity) for ends only. */
  postSpacing?: number
  topPost?: boolean
  postThrough?: boolean
  /** Metres the rails run past the top vertex, along the final slope. */
  reach?: number
}

// Dressed metal cable rail, in metres.
const POST = 0.0508 // a 2 in slim square post
const POST_EMBED = 0.05 // the post foot runs this far below the nosing line
const CAP_W = 0.0635 // a flat 2½ in cap over the posts
const CAP_T = 0.0381
const CABLE_D = 0.0095 // 3⁄8 in round cable
const CABLE_PITCH = 0.0762 // 3 in on centre (IRC-style infill limit)
const CABLE_BOTTOM = 0.0762 // the lowest cable sits this far over the nosing line
const CABLE_CLEAR = 0.025 // the top cable stays this far under the cap underside
const SLEEVE_D = 0.019 // a 3⁄4 in swage sleeve at a cable's terminal post
const SLEEVE_LEN = 0.05
const POST_ABOVE_CAP = 0.0762 // a through-post stands this far above the cap…
const POST_CAP_T = 0.0254 // …under a 1 in cap of its own
const POST_CAP_OVERHANG = 0.0381

/** The cable guard's single flat cap rail. Shared with the flight connector so
 * a bridge between flights carries the same cap as the guards it joins. */
export function cableGuardRails(railHeight: number): GuardRail[] {
  return [{ y: railHeight - CAP_T / 2, across: CAP_W, vertical: CAP_T }]
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

/** Cable centreline heights off the nosing line, bottom-to-top. */
function cableLevels(railHeight: number): number[] {
  const top = railHeight - CAP_T - CABLE_CLEAR - CABLE_D / 2
  const levels: number[] = []
  for (let y = CABLE_BOTTOM; y <= top + 1e-9; y += CABLE_PITCH) levels.push(y)
  return levels
}

export function buildCableGuard(points: Vec3[], options: CableGuardOptions): GuardBox[] {
  const path = resolveGuardPath(points, {
    postSpacing: options.postSpacing,
    cornerPosts: true,
    topPost: options.topPost,
    reach: options.reach,
    // Cables are not pickets; this pitch is unused but the chassis requires one.
    picketPitch: CABLE_PITCH,
    picketMinPitch: CABLE_PITCH,
    picketMaxPitch: CABLE_PITCH,
  })
  if (!path) return []
  const { railHeight } = options
  const postThrough = options.postThrough === true
  const rise = postRise(railHeight, postThrough)

  if (path.kind === 'pivot') {
    // A zero-radius winder's inner pivot: one plumb post keeps the inner edge's
    // support; a single pivot has nothing to span a cable between.
    const { lo, hi } = path
    const base: Vec3 = [lo[0], lo[1] - POST_EMBED, lo[2]]
    const height = hi[1] - lo[1] + rise + POST_EMBED
    const pivot: GuardBox[] = [postBox(base, height, POST)]
    if (postThrough) pivot.push(postCap(lo[0], base[1] + height, lo[2]))
    return pivot
  }

  const { railPoints, isCorner, postPositions } = path

  // The flat cap follows the path; a fitting block closes each real corner.
  const boxes: GuardBox[] = railBars(railPoints, isCorner, cableGuardRails(railHeight))

  // Posts: both ends (the top only when `topPost`), every bay ≤ spacing between.
  for (const p of postPositions) {
    boxes.push(postBox(add(p, [0, -POST_EMBED, 0]), rise + POST_EMBED, POST))
    if (postThrough) boxes.push(postCap(p[0], p[1] + rise, p[2]))
  }

  // Cables: a run of straight chords between consecutive posts at each level,
  // with a swage sleeve where the terminal posts anchor the ends.
  const levels = cableLevels(railHeight)
  for (const y of levels) {
    for (let i = 1; i < postPositions.length; i++) {
      const cable = barBox(
        add(postPositions[i - 1]!, [0, y, 0]),
        add(postPositions[i]!, [0, y, 0]),
        CABLE_D,
        CABLE_D,
      )
      if (cable) boxes.push({ ...cable, round: true })
    }
    for (let i = 1; i < postPositions.length - 1; i++) {
      const post = postPositions[i]!
      if (
        railPoints.some((point, index) => isCorner(index) && Math.hypot(...sub(point, post)) < 1e-6)
      ) {
        boxes.push(terminalSleeve(post, postPositions[i - 1]!, y))
        boxes.push(terminalSleeve(post, postPositions[i + 1]!, y))
      }
    }
    if (postPositions.length >= 2) {
      boxes.push(terminalSleeve(postPositions[0]!, postPositions[1]!, y))
      boxes.push(terminalSleeve(postPositions.at(-1)!, postPositions.at(-2)!, y))
    }
  }

  return boxes
}

/** A short round sleeve sitting at `post` at height `y`, pointing along the
 * cable toward `toward` — the swage fitting that terminates a cable. */
function terminalSleeve(post: Vec3, toward: Vec3, y: number): GuardBox {
  const along = sub(toward, post)
  const length = Math.hypot(along[0], along[1], along[2])
  const unit: Vec3 = length > 1e-6 ? scale(along, 1 / length) : [0, 0, 1]
  const base: Vec3 = add(post, [0, y, 0])
  return {
    center: add(base, scale(unit, SLEEVE_LEN / 2)),
    size: [SLEEVE_D, SLEEVE_D, SLEEVE_LEN],
    direction: unit,
    round: true,
  }
}
